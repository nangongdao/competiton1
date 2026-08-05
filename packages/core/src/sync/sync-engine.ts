/**
 * 同步引擎 —— 把"适配 → 校验 → 暂存 → 确认"串成流水线。
 *
 * - 有界并发(默认 3)处理多平台,避免一次性打满。
 * - 各平台独立成败上报:一个平台失败不影响其它平台。
 * - 核心只依赖适配器注册表迭代,绝无 switch(platform)。
 */
import type { Document, PlatformOverride } from "../ir/types.js";
import { getAdapter } from "../adapters/registry.js";
import { validate } from "../validate/validator.js";
import type { ValidationReport } from "../validate/types.js";
import { MockPublisher } from "../publish/mock-publisher.js";
import type { PublishArtifact, PublishContext, Publisher, PublishReceipt } from "../publish/types.js";
import type { PlatformConfigMap } from "../config/platform-config.js";
import { resolveConfig } from "../config/platform-config.js";
import type { RehostContext } from "../adapters/types.js";
import { rehostDocumentAssets, type RehostFailure } from "../assets/rehost-engine.js";
import type { LlmAdapter } from "../llm/types.js";
import { enhancePayload, type EnhanceOptions } from "../llm/enhance.js";
import type { AssetTable } from "../assets/asset-table.js";
import { scoreTypography, type TypographyScore } from "../quality/typography.js";

export interface PlatformResult {
  readonly platformId: string;
  readonly platformName: string;
  readonly ok: boolean;
  readonly report?: ValidationReport;
  readonly artifact?: PublishArtifact;
  readonly receipt?: PublishReceipt;
  readonly error?: string;
  /** 该平台图片重托管的失败明细(供 UI 提示用户哪些图未上传成功)。 */
  readonly rehostFailures?: readonly RehostFailure[];
  /** 该平台的排版质量评分(0-100)与改进建议。 */
  readonly quality?: TypographyScore;
}

export interface SyncOptions {
  /** 每平台覆盖层。 */
  readonly overrides?: Readonly<Record<string, PlatformOverride>>;
  /** 每平台发布器(缺省用 MockPublisher)。 */
  readonly publishers?: Readonly<Record<string, Publisher>>;
  /** 是否在仅 stage(不 confirm)。默认 false(stage+confirm)。 */
  readonly stageOnly?: boolean;
  /** 校验出 error 时是否仍 confirm。默认 false(阻止发布)。 */
  readonly publishOnError?: boolean;
  /** 并发上限。默认 3。 */
  readonly concurrency?: number;
  /** 平台运行时配置(违禁词表/上限覆盖)。 */
  readonly config?: PlatformConfigMap;
  /** 每平台图片重托管上下文(网络注入)。不传则跳过重托管,保留原始图片引用。 */
  readonly rehost?: Readonly<Record<string, RehostContext>>;
  /** LLM 适配器(风格改写)。不传或不可用则跳过增强。 */
  readonly llm?: LlmAdapter;
  /** LLM 增强项(启用哪些字段);需 llm 可用方生效。 */
  readonly enhance?: EnhanceOptions;
  /** 资产表(解析阶段产出);传入后经 recordRehost 规范化回填重托管记录。 */
  readonly assetTable?: AssetTable;
  /** 时间戳注入。 */
  readonly now?: () => string;
}

/** 对一组平台执行适配与(模拟)发布,返回各平台独立结果。 */
export async function syncToPlatforms(
  doc: Document,
  platformIds: readonly string[],
  options: SyncOptions = {},
): Promise<PlatformResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const now = options.now ?? (() => new Date().toISOString());
  const results: PlatformResult[] = new Array(platformIds.length);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, platformIds.length) }, async () => {
    while (cursor < platformIds.length) {
      const idx = cursor++;
      const id = platformIds[idx]!;
      results[idx] = await processPlatform(doc, id, options, now);
    }
  });
  await Promise.all(workers);
  return results;
}

async function processPlatform(
  doc: Document,
  platformId: string,
  options: SyncOptions,
  now: () => string,
): Promise<PlatformResult> {
  const adapter = getAdapter(platformId);
  if (!adapter) {
    return { platformId, platformName: platformId, ok: false, error: `未注册的平台: ${platformId}` };
  }
  const override = options.overrides?.[platformId];
  const config = options.config?.[platformId];
  const rehostFailures: RehostFailure[] = [];
  try {
    let processed = adapter.preprocess(doc, override, config);
    // 图片重托管阶段(异步,可选):注入了该平台 rehost 上下文时,把图片重托管到平台图床,
    // 结果回填 IR,使 serialize 的 resolveImageSrc 取到平台 URL。单图失败不阻断整篇,
    // 但通过 onFailure 累积失败明细,经 PlatformResult.rehostFailures 透出给用户。
    const rehostCtx = options.rehost?.[platformId];
    if (rehostCtx) {
      processed = await rehostDocumentAssets(adapter, processed, rehostCtx, options.assetTable, (f) =>
        rehostFailures.push(f),
      );
    }
    // 解析运行时配置(主题/排版等),serialize 层据此选择主题。
    const resolvedConfig = config ? resolveConfig(adapter.capabilities.limits, config) : undefined;
    const payload = adapter.serialize(processed, override, resolvedConfig);
    // 排版质量评分:基于 preprocess 后的文档(结构仍保留段落/标题/图片),供 UI 展示"分 + 建议"。
    const quality = scoreTypography(processed, platformId);
    // LLM 增强阶段(异步,可选):注入了可用 llm 且指定 enhance 项时,做风格改写。
    let finalPayload = payload;
    if (options.llm && options.enhance) {
      finalPayload = await enhancePayload(platformId, payload, adapter.capabilities, options.llm, options.enhance);
    }
    const report = validate(platformId, processed, finalPayload, adapter.capabilities, doc, config);

    const publisher = options.publishers?.[platformId] ?? new MockPublisher();
    const ctx: PublishContext = { platformId, document: processed, override, now };
    const artifact = publisher.stage(finalPayload, ctx);

    if (options.stageOnly) {
      return { platformId, platformName: adapter.name, ok: !report.hasError, report, artifact, quality, rehostFailures };
    }

    if (report.hasError && !options.publishOnError) {
      return {
        platformId,
        platformName: adapter.name,
        ok: false,
        report,
        artifact,
        error: "校验未通过(存在 error),已阻止发布",
        quality,
        rehostFailures,
      };
    }

    const receipt = await publisher.confirm(artifact, ctx);
    return {
      platformId,
      platformName: adapter.name,
      ok: receipt.status !== "failed",
      report,
      artifact,
      receipt,
      quality,
      rehostFailures,
    };
  } catch (err) {
    return {
      platformId,
      platformName: adapter.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      rehostFailures,
    };
  }
}
