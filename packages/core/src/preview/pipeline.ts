/**
 * 预览管线(PERF-01)—— 缓存 parse/preprocess/serialize/validate/quality 的纯预览引擎。
 *
 * 目标(路线图 Phase 3):
 * - 单平台配置变化不重跑其他平台;
 * - 源文本未变时复用解析出的 IR(parse 是最重阶段);
 * - 同一 (source, platformId, override, config) 组合返回同一产物引用(零拷贝);
 * - 纯 TS、零 DOM,可放入 Web Worker(见 app 的 preview-worker)。
 *
 * 与 sync-engine 的关系:预览使用本管线,真实发布仍走 PublishJobService(带发布语义)。
 * 缓存层:
 *   1. parse:源文本哈希 → Document + AssetTable;
 *   2. platform:(sourceHash, platformId, override, config) → 该平台完整产物链路
 *      (preprocess → serialize → validate → quality),避免重复计算。
 */
import type { PlatformOverride } from "../ir/types.js";
import { markdownToIR } from "../parse/md-to-ir.js";
import { getAdapter } from "../adapters/registry.js";
import { validate } from "../validate/validator.js";
import { scoreTypography } from "../quality/typography.js";
import { resolveConfig, type PlatformConfigMap } from "../config/platform-config.js";
import type { PlatformAdapter } from "../adapters/types.js";
import type { PlatformResult } from "../sync/sync-engine.js";
import type { PreviewInput, PreviewResult, ParseCacheEntry, PlatformCacheEntry } from "./types.js";
import { fnv1a } from "../publish/idempotency.js";

/** 内部可变统计(对外经 getter 暴露只读拷贝)。 */
interface MutableStats {
  parseHits: number;
  parseMisses: number;
  platformHits: number;
  platformMisses: number;
}

/** 结构哈希:对任意可 JSON 序列化的值求稳定哈希,用于失效判断。 */
function hashInput(value: unknown): string {
  return fnv1a(JSON.stringify(value ?? null));
}

/**
 * 预览管线实例。同一实例持有缓存;每次 adapt() 只重算变化的层级。
 */
export class PreviewPipeline {
  /** 解析层缓存:源文本哈希 → IR + 资产表。 */
  private readonly parseCache = new Map<string, ParseCacheEntry>();
  /** 平台链路缓存:(sourceHash + platformId + override + config) → 完整结果。 */
  private readonly platformCache = new Map<string, PlatformCacheEntry>();
  /** 统计(供性能预算测试)。 */
  private readonly stats: MutableStats = { parseHits: 0, parseMisses: 0, platformHits: 0, platformMisses: 0 };

  get cacheStats(): Readonly<MutableStats> {
    return { ...this.stats };
  }

  /**
   * 计算多平台预览。
   *
   * @param input 预览输入(markdown + 平台选择 + 覆盖/配置)
   * @returns 各平台预览结果(与 syncToPlatforms(stageOnly) 同构,含 trace)
   */
  adapt(input: PreviewInput): readonly PreviewResult[] {
    const { markdown, authorName, tags, canonicalUrl, selectedPlatforms, overrides, config } = input;

    const sourceHash = hashInput(markdown);
    let parseEntry = this.parseCache.get(sourceHash);
    if (!parseEntry) {
      const { document, assetTable } = markdownToIR(markdown, {
        meta: {
          authorName: authorName ?? "",
          tags: tags ?? [],
          canonicalUrl: canonicalUrl ?? "https://example.com/post",
        },
      });
      parseEntry = { document, assetTable, sourceHash };
      this.parseCache.set(sourceHash, parseEntry);
      this.stats.parseMisses++;
      // 源变化时旧平台缓存基于旧 IR,必须清空(引用一致性)。
      this.platformCache.clear();
    } else {
      this.stats.parseHits++;
    }

    const results: PreviewResult[] = [];
    for (const platformId of selectedPlatforms) {
      const adapter = getAdapter(platformId);
      if (!adapter) {
        results.push({
          platformId,
          platformName: platformId,
          ok: false,
          error: `未注册的平台: ${platformId}`,
          trace: { platformId, cacheLayer: "none" },
        });
        continue;
      }
      results.push(this.adaptPlatform(adapter, platformId, parseEntry, overrides, config));
    }
    return results;
  }

  /** 单平台链路:命中平台缓存则零拷贝直出,否则全链路重算并写入缓存。 */
  private adaptPlatform(
    adapter: PlatformAdapter,
    platformId: string,
    parseEntry: ParseCacheEntry,
    overrides?: Readonly<Record<string, PlatformOverride>>,
    config?: PlatformConfigMap,
  ): PreviewResult {
    const override = overrides?.[platformId];
    const platformConfig = config?.[platformId];
    const key = this.platformKey(parseEntry.sourceHash, platformId, override, platformConfig);

    const cached = this.platformCache.get(key);
    if (cached) {
      this.stats.platformHits++;
      return this.buildResult(adapter, platformId, cached, "platform");
    }
    this.stats.platformMisses++;

    // —— 全链路:preprocess → serialize → validate → quality ——
    const processed = adapter.preprocess(parseEntry.document, override, platformConfig);
    const resolvedConfig = platformConfig
      ? resolveConfig(adapter.capabilities.limits, platformConfig)
      : undefined;
    const payload = adapter.serialize(processed, override, resolvedConfig);
    const quality = scoreTypography(processed, platformId);
    const report = validate(
      platformId,
      processed,
      payload,
      adapter.capabilities,
      parseEntry.document,
      platformConfig,
    );

    const entry: PlatformCacheEntry = { processed, payload, report, quality, resolvedConfig };
    this.platformCache.set(key, entry);
    return this.buildResult(adapter, platformId, entry, "none");
  }

  /** 由缓存条目组装可消费的 PlatformResult(与 stageOnly 同构)。 */
  private buildResult(
    adapter: PlatformAdapter,
    platformId: string,
    entry: PlatformCacheEntry,
    cacheLayer: "platform" | "none",
  ): PreviewResult {
    const { payload, report, quality } = entry;
    const artifact: PlatformResult["artifact"] = {
      platformId,
      payload,
      deliverable: payload.content,
      instructions: [],
    };
    return {
      platformId,
      platformName: adapter.name,
      ok: !report.hasError,
      report,
      artifact,
      quality,
      trace: { platformId, cacheLayer },
    };
  }

  /** 平台链路缓存键:源哈希 + 平台 + 覆盖 + 配置(稳定、可预测)。 */
  private platformKey(
    sourceHash: string,
    platformId: string,
    override?: PlatformOverride,
    config?: PlatformConfigMap[string],
  ): string {
    return `${sourceHash}|${platformId}|${hashInput(override)}|${hashInput(config)}`;
  }

  /** 强制下次全量重算(平台能力变更/外部数据变化时调用)。 */
  clear(): void {
    this.parseCache.clear();
    this.platformCache.clear();
    this.stats.parseHits = 0;
    this.stats.parseMisses = 0;
    this.stats.platformHits = 0;
    this.stats.platformMisses = 0;
  }
}
