/**
 * FLOW-02 多草稿批量校验/生成产物 + FLOW-04 发布前审批清单。
 *
 * - 批量:对一组草稿(markdown)批量跑"校验 + 生成多平台产物",默认不真实发布;
 * - 审批清单:真实发布前把每个平台产物 + 内容摘要 + 影响面整理成清单,
 *   full-auto 必须逐任务确认内容摘要(RUN-01 约束延伸),否则进入 needs-user-action。
 * - 批量 AI 自动完成:对一组草稿批量跑 runAutoAgent(分析 → 修复 → 增强 → 复核),
 *   让大模型一键自动维护多篇草稿质量。
 *
 * 纯 TS 管线,可被 app 服务层(批量任务)与 runner(审批清单)复用。
 */
import type { PlatformOverride } from "../ir/types.js";
import { markdownToIR } from "../parse/md-to-ir.js";
import { getAdapter } from "../adapters/registry.js";
import { validate } from "../validate/validator.js";
import { scoreTypography } from "../quality/typography.js";
import type { SerializedPayload } from "../adapters/types.js";
import type { ValidationReport } from "../validate/types.js";
import type { TypographyScore } from "../quality/typography.js";
import { contentHashOfPayload } from "../publish/idempotency.js";
import type { LlmAdapter } from "../llm/types.js";
import { runAutoAgent } from "../agent/agent.js";

/** 单篇草稿的批量校验/生成结果。 */
export interface BatchItemInput {
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
  readonly authorName?: string;
  readonly tags?: readonly string[];
}

export interface BatchPlatformOutput {
  readonly platformId: string;
  readonly payload?: SerializedPayload;
  readonly report?: ValidationReport;
  readonly quality?: TypographyScore;
  readonly error?: string;
}

export interface BatchItemResult {
  readonly id: string;
  readonly title: string;
  /** 是否所有选定平台均通过校验(无 error)。 */
  readonly ok: boolean;
  readonly platforms: readonly BatchPlatformOutput[];
  /** 内容摘要(供发布审批清单使用)。 */
  readonly contentDigest: string;
  /** 汇总:总平台数 / 通过 / 有错误。 */
  readonly summary: { total: number; passed: number; errored: number };
}

/** 批量校验/生成选项。 */
export interface BatchOptions {
  readonly platformIds: readonly string[];
  readonly overrides?: Readonly<Record<string, PlatformOverride>>;
}

/** 对一篇草稿跑全平台校验 + 生成产物(与 syncToPlatforms(stageOnly) 同构,但纯本地、可批量)。 */
export async function generateForPlatforms(
  item: BatchItemInput,
  options: BatchOptions,
): Promise<BatchItemResult> {
  const { document } = markdownToIR(item.markdown, {
    meta: {
      authorName: item.authorName ?? "",
      tags: item.tags ?? [],
      canonicalUrl: "https://example.com/post",
      title: item.title,
    },
  });

  const platforms: BatchPlatformOutput[] = [];
  for (const platformId of options.platformIds) {
    const adapter = getAdapter(platformId);
    if (!adapter) {
      platforms.push({ platformId, error: `未注册的平台: ${platformId}` });
      continue;
    }
    try {
      const override = options.overrides?.[platformId];
      const processed = adapter.preprocess(document, override);
      const payload = adapter.serialize(processed, override);
      const quality = scoreTypography(processed, platformId);
      const report = validate(platformId, processed, payload, adapter.capabilities, document);
      platforms.push({ platformId, payload, report, quality });
    } catch (err) {
      platforms.push({ platformId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const firstPayload = platforms.find((p) => p.payload)?.payload;
  const digest = firstPayload ? await contentHashOfPayload(firstPayload, false) : `digest-${item.id}`;

  const summary = {
    total: platforms.length,
    passed: platforms.filter((p) => !p.report?.hasError && !p.error).length,
    errored: platforms.filter((p) => !!p.error || !!p.report?.hasError).length,
  };

  return {
    id: item.id,
    title: item.title,
    ok: summary.errored === 0,
    platforms,
    contentDigest: digest,
    summary,
  };
}

/** 批量处理一组草稿(有界并发,默认 2)。 */
export async function batchGenerate(
  items: readonly BatchItemInput[],
  options: BatchOptions,
  concurrency = 2,
): Promise<readonly BatchItemResult[]> {
  const results: BatchItemResult[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await generateForPlatforms(items[idx]!, options);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// 批量 AI 自动完成(runAutoAgent 接入批处理:多草稿一键批量 AI 自动完成)
// ---------------------------------------------------------------------------

/** 批量 AI 自动完成选项。 */
export interface BatchAutoCompleteOptions {
  readonly platformIds: readonly string[];
  /** LLM 适配器(不可用则纯规则兜底)。 */
  readonly llm?: LlmAdapter;
  /** 是否自动应用可修复建议(默认 true)。 */
  readonly autoFix?: boolean;
  /** 是否生成 LLM 标题/摘要候选 + 逐段风格改写(默认 true)。 */
  readonly enhance?: boolean;
  /** 每篇最大修复轮次(默认 3)。 */
  readonly maxFixRounds?: number;
  /** 每篇最多 LLM 改写段落数(默认 3)。 */
  readonly maxRewriteParagraphs?: number;
  /** AI-INSIGHT-02:任务级采样温度(透传给段落改写等 LLM 调用)。 */
  readonly temperature?: number;
  /** AI-INSIGHT-02:任务级单次最大 token。 */
  readonly maxTokens?: number;
  /** AI-INSIGHT-02:任务级系统提示词。 */
  readonly systemPrompt?: string;
}

/** 批量 AI 自动完成结果(每篇一篇)。 */
export interface BatchAutoCompleteResult {
  /** 批量结果序号(与 items 顺序一致)。 */
  readonly index: number;
  readonly id: string;
  readonly title: string;
  /** 是否整体成功(不抛错即视为成功;单篇失败会带 error)。 */
  readonly ok: boolean;
  /** Agent 原始结果(含步骤/分析/候选)。 */
  readonly agent: import("../agent/types.js").AutoAgentResult;
  /** 是否使用了 LLM。 */
  readonly usedLlm: boolean;
  /** 应用了多少处自动修复。 */
  readonly fixCount: number;
  /** LLM 逐段风格改写段落数(按平台汇总)。 */
  readonly paragraphRewriteCount: number;
  /** 复检是否全部平台通过。 */
  readonly allPassed: boolean;
  /** 错误信息(ok=false 时)。 */
  readonly error?: string;
}

/**
 * 批量跑 AI 自动完成:对多篇草稿逐个执行 runAutoAgent,有界并发、逐篇失败隔离。
 * 不改写任何草稿存储(返回改写后的 markdown,由调用方决定是否写回)。
 */
export async function batchAutoComplete(
  items: readonly BatchItemInput[],
  options: BatchAutoCompleteOptions,
  concurrency = 2,
): Promise<readonly BatchAutoCompleteResult[]> {
  const results: BatchAutoCompleteResult[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx]!;
      try {
        const agent = await runAutoAgent(item.markdown, {
          platformIds: options.platformIds,
          llm: options.llm,
          autoFix: options.autoFix ?? true,
          maxFixRounds: Math.max(1, options.maxFixRounds ?? 3),
          enhance: options.enhance ?? true,
          autoApplyOverrides: false,
          maxRewriteParagraphs: Math.max(1, options.maxRewriteParagraphs ?? 3),
          // AI-INSIGHT-02:批量改写任务级参数透传。
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          systemPrompt: options.systemPrompt,
        });
        const paragraphRewriteCount = Object.values(agent.paragraphRewrites).reduce(
          (n, list) => n + list.length,
          0,
        );
        const verify = agent.steps.find((s) => s.kind === "verify");
        results[idx] = {
          index: idx,
          id: item.id,
          title: item.title,
          ok: true,
          agent,
          usedLlm: agent.usedLlm,
          fixCount: agent.appliedFixes.length,
          paragraphRewriteCount,
          allPassed: verify?.kind === "verify" ? verify.allPassed : false,
        };
      } catch (err) {
        results[idx] = {
          index: idx,
          id: item.id,
          title: item.title,
          ok: false,
          agent: {
            ok: false,
            elapsedMs: 0,
            usedLlm: false,
            steps: [],
            analysis: { charCount: 0, paragraphCount: 0, headingCount: 0, imageCount: 0, avgQuality: 0 },
            markdown: item.markdown,
            appliedFixes: [],
            variants: {},
            paragraphRewrites: {},
            error: err instanceof Error ? err.message : String(err),
          },
          usedLlm: false,
          fixCount: 0,
          paragraphRewriteCount: 0,
          allPassed: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// FLOW-04 发布前审批清单
// ---------------------------------------------------------------------------

/** 单个平台的审批条目。 */
export interface ApprovalItem {
  readonly platformId: string;
  readonly platformName: string;
  /** 发布意图(草稿/发布)。 */
  readonly intent: "draft" | "publish";
  /** 该平台产物摘要(标题 + 字数)。 */
  readonly title: string;
  readonly charCount: number;
  /** 校验是否通过(有 error 则不可发布)。 */
  readonly hasError: boolean;
  /** 该平台的内容摘要(用于 full-auto 二次确认)。 */
  readonly digest: string;
  /** 用户确认状态。 */
  readonly confirmed: boolean;
}

/** 审批清单。 */
export interface ApprovalManifest {
  readonly id: string;
  readonly draftTitle: string;
  readonly createdAt: string;
  readonly items: readonly ApprovalItem[];
  /** 是否全部确认。 */
  readonly allConfirmed: boolean;
}

/** 从批量结果 + 意图构造审批清单。 */
export async function buildApprovalManifest(
  result: BatchItemResult,
  intents: Readonly<Record<string, "draft" | "publish">>,
  now: () => string = () => new Date().toISOString(),
): Promise<ApprovalManifest> {
  const items: ApprovalItem[] = result.platforms.map((p) => ({
    platformId: p.platformId,
    platformName: p.platformId,
    intent: intents[p.platformId] ?? "draft",
    title: p.payload?.title ?? p.error ?? "无产物",
    charCount: p.payload ? [...(p.payload.mime === "text/html" ? p.payload.content.replace(/<[^>]+>/g, "") : p.payload.content)].length : 0,
    hasError: !!p.report?.hasError,
    digest: result.contentDigest,
    confirmed: false,
  }));
  return {
    id: `approval-${result.id}`,
    draftTitle: result.title,
    createdAt: now(),
    items,
    allConfirmed: false,
  };
}

/** 标记清单中某平台已确认(校验摘要一致性:确认内容与请求内容不一致时拒绝)。 */
export function confirmApprovalItem(
  manifest: ApprovalManifest,
  platformId: string,
  digest: string,
): ApprovalManifest {
  const items = manifest.items.map((it) =>
    it.platformId === platformId
      ? { ...it, confirmed: it.digest === digest, ...(it.digest === digest ? {} : {}) }
      : it,
  );
  return { ...manifest, items, allConfirmed: items.every((it) => it.confirmed) };
}

/** 检查清单是否满足"全部确认且无 error"的发布前置条件。 */
export function canProceed(manifest: ApprovalManifest): { ok: boolean; reason?: string } {
  if (!manifest.allConfirmed) return { ok: false, reason: "还有平台未确认内容摘要" };
  const errored = manifest.items.filter((it) => it.hasError);
  if (errored.length > 0) {
    return { ok: false, reason: `以下平台校验未通过:${errored.map((e) => e.platformId).join(", ")}` };
  }
  return { ok: true };
}
