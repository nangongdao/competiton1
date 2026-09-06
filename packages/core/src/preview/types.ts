/**
 * 预览管线(PERF-01)—— 类型契约。
 *
 * 把"解析 → 变换 → 序列化 → 校验 → 排版评分"串成可缓存的纯管线,供 Web/Worker 复用。
 * 与同步引擎(sync-engine)的区别:
 * - 无发布语义:只产出预览(暂存产物 + 校验 + 评分),不 confirm;
 * - 分层缓存:parse(源哈希)为第一层,平台链路(preprocess→serialize→validate→quality)
 *   为第二层 —— 源变化只重解析,单平台配置/覆盖变化只重跑该平台;
 * - 缓存产物按引用复用(零拷贝),上层按结果引用比较命中。
 */
import type { Document, PlatformOverride } from "../ir/types.js";
import type { PlatformConfigMap, ResolvedPlatformConfig } from "../config/platform-config.js";
import type { PlatformResult } from "../sync/sync-engine.js";
import type { SerializedPayload } from "../adapters/types.js";
import type { ValidationReport } from "../validate/types.js";
import type { TypographyScore } from "../quality/typography.js";
import type { AssetTable } from "../assets/asset-table.js";

/** 预览管线输入。 */
export interface PreviewInput {
  readonly markdown: string;
  readonly authorName?: string;
  readonly tags?: readonly string[];
  readonly canonicalUrl?: string;
  readonly selectedPlatforms: readonly string[];
  /** 每平台覆盖层。 */
  readonly overrides?: Readonly<Record<string, PlatformOverride>>;
  /** 每平台运行时配置。 */
  readonly config?: PlatformConfigMap;
}

/** 单平台缓存命中层级(从内到外)。 */
export type PreviewCacheLayer = "parse" | "platform" | "none";

/** 预览管线结果(与 PlatformResult 同构,便于 UI 直接消费)。 */
export interface PreviewResult extends PlatformResult {
  /** 单平台缓存追踪(测试/性能诊断用)。 */
  readonly trace: {
    readonly platformId: string;
    readonly cacheLayer: PreviewCacheLayer;
  };
}

/** 解析阶段缓存条目。 */
export interface ParseCacheEntry {
  readonly document: Document;
  readonly assetTable: AssetTable;
  readonly sourceHash: string;
}

/** 平台链路缓存条目(同一 (source, platformId, override, config) 的结果)。 */
export interface PlatformCacheEntry {
  readonly processed: Document;
  readonly payload: SerializedPayload;
  readonly report: ValidationReport;
  readonly quality: TypographyScore;
  readonly resolvedConfig?: ResolvedPlatformConfig;
}

/** 缓存统计(供性能预算测试断言)。 */
export interface PreviewCacheStats {
  readonly parseHits: number;
  readonly parseMisses: number;
  readonly platformHits: number;
  readonly platformMisses: number;
}
