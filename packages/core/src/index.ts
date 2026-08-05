/** @mpp/core 公共 API。 */

// IR
export * from "./ir/types.js";
export * from "./ir/guards.js";
export * from "./ir/builders.js";

// 资产
export { AssetTable, assetTableFrom } from "./assets/asset-table.js";
export {
  type ImageHost,
  type ImageUploadResult,
  decodeDataUrl,
  assetFilename,
} from "./assets/image-host.js";
export { rehostDocumentAssets, mapWithConcurrency } from "./assets/rehost-engine.js";
export type { RehostFailure, RehostFailureHandler } from "./assets/rehost-engine.js";
export { isSafeImageUrl } from "./assets/url-guard.js";
export { computeContentHash } from "./assets/content-hash.js";
export {
  PLATFORM_RATE_POLICY,
  DEFAULT_RATE_POLICY,
  ratePolicyFor,
  AdaptiveConcurrency,
} from "./assets/rate-policy.js";
export type { RatePolicy } from "./assets/rate-policy.js";

// 解析
export { createMarkdownParser } from "./parse/markdown.js";
export { markdownToIR, splitInlineMath } from "./parse/md-to-ir.js";
export type { ParseOptions, ParseResult } from "./parse/md-to-ir.js";

// 变换
export type { Transform, TransformContext } from "./transforms/pipeline.js";
export { runPipeline } from "./transforms/pipeline.js";
export { buildPipeline, ALL_TRANSFORMS } from "./transforms/registry.js";
export { graphemeCount, graphemeTruncate } from "./transforms/grapheme-count.js";
export { equationImageUrl } from "./transforms/math-to-image.js";
export { parseTableAsset, TABLE_ASSET_SCHEME } from "./transforms/table-to-image.js";
export { scanBannedWords, DEFAULT_BANNED_WORDS } from "./transforms/banned-word-filter.js";
export { buildCoverSpec } from "./transforms/cover-spec.js";
export type { CoverSpec, CoverRatio, CoverSpecOptions } from "./transforms/cover-spec.js";

// 管线(增量适配)
export { IncrementalAdapter } from "./pipeline/incremental.js";
export type { IncrementalOptions, IncrementalResult } from "./pipeline/incremental.js";

// 质量(排版评分)
export { scoreTypography, TYPOGRAPHY_PREFERENCES, DEFAULT_TYPOGRAPHY_PREFERENCE } from "./quality/typography.js";
export type { TypographyScore, TypographyPreference } from "./quality/typography.js";

// 适配器
export type { PlatformAdapter, SerializedPayload, RehostContext, RehostResult } from "./adapters/types.js";
export { BaseAdapter } from "./adapters/base-adapter.js";
export {
  registerAdapter,
  getAdapter,
  listAdapters,
  listPlatformIds,
} from "./adapters/registry.js";
export { escapeHtml } from "./adapters/shared/html-render.js";
export { sanitizeHtml, shouldSanitize } from "./adapters/shared/sanitize-html.js";

// 配置
export {
  resolveConfig,
  type PlatformConfig,
  type ResolvedPlatformConfig,
  type PlatformConfigMap,
} from "./config/platform-config.js";

// 校验
export { validate } from "./validate/validator.js";
export type { ValidationReport, ValidationIssue, Severity } from "./validate/types.js";

// 发布
export type { Publisher, PublishArtifact, PublishReceipt, PublishContext } from "./publish/types.js";
export { MockPublisher } from "./publish/mock-publisher.js";
export { instructionsFor } from "./publish/instructions.js";
export { buildIdempotencyKey, contentHashOfPayload, fnv1a } from "./publish/idempotency.js";
export type { PublishIntent } from "./publish/idempotency.js";
export * as WechatApi from "./publish/wechat-official-api.js";

// LLM
export type { LlmAdapter, LlmRequest, LlmTask } from "./llm/types.js";
export { NoopLlm, noopLlm } from "./llm/noop-llm.js";
export { buildPrompt } from "./llm/prompt-templates.js";
export { OpenAiCompatLlm, type OpenAiCompatOptions } from "./llm/openai-compat-llm.js";
export { enhancePayload, type EnhanceOptions } from "./llm/enhance.js";

// 同步引擎
export { syncToPlatforms } from "./sync/sync-engine.js";
export type { PlatformResult, SyncOptions } from "./sync/sync-engine.js";
