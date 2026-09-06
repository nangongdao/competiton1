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
export { isSafeImageUrl, isBlockedIp } from "./assets/url-guard.js";
export { computeContentHash } from "./assets/content-hash.js";
export {
  ContentHashUploadCache,
  uploadCacheKey,
  UPLOAD_CACHE_DEFAULT_MAX_BYTES,
  UPLOAD_CACHE_DEFAULT_TTL_MS,
} from "./assets/upload-cache.js";
export type { UploadCacheEntry, UploadCacheOptions } from "./assets/upload-cache.js";
export { UploadScheduler, RateLimitedError } from "./assets/upload-scheduler.js";
export type { UploadOutcome, RawUpload, UploadSchedulerOptions } from "./assets/upload-scheduler.js";
export {
  PLATFORM_RATE_POLICY,
  DEFAULT_RATE_POLICY,
  ratePolicyFor,
  AdaptiveConcurrency,
  jitteredBackoff,
  parseRetryAfter,
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

// 管线(增量适配 + 预览管线)
export { IncrementalAdapter } from "./pipeline/incremental.js";
export type { IncrementalOptions, IncrementalResult } from "./pipeline/incremental.js";
export { PreviewPipeline } from "./preview/pipeline.js";
export type {
  PreviewInput,
  PreviewResult,
  ParseCacheEntry,
  PlatformCacheEntry,
  PreviewCacheLayer,
  PreviewCacheStats,
} from "./preview/types.js";

// 发布前健康检查(v7 PREFLIGHT)
export { runPreflight, preflightPlainText, preflightTitle } from "./preflight/preflight.js";
export { autoFixPreflight, fixMissingImageAlt, altFromUrl, AUTO_FIX_CAPABILITIES } from "./preflight/fix.js";
export type { AutoFixResult, AutoFixKind } from "./preflight/fix.js";
export type {
  PreflightIssue,
  PreflightPlatformSummary,
  PreflightReport,
  PreflightInput,
  PreflightSeverity,
} from "./preflight/preflight.js";

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
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS } from "./llm/openai-compat-constants.js";
export { enhancePayload, type EnhanceOptions } from "./llm/enhance.js";

// AI 连接中心(Roadmap v2 Phase A/B)
export { listLlmPresets, getLlmPreset, configFromPreset, type LlmPreset } from "./llm/presets.js";
export {
  validateLlmConfig,
  normalizeLlmConfig,
  stripApiKey,
  isConfigReady,
  type LlmConfig,
  type LlmConfigValidation,
} from "./llm/config.js";
export {
  testLlmConnection,
  type ConnectivityResult,
  type ConnectivityOptions,
} from "./llm/connectivity.js";
export {
  LlmRetry,
  isRetryableLlmError,
  backoffDelay,
  type LlmRetryOptions,
} from "./llm/retry.js";
export { FallbackLlm, type FallbackLlmOptions } from "./llm/fallback.js";
export { adapterFromConfig, fallbackFromConfigs } from "./llm/factory.js";

// AI-ROBUST-03:LLM 调用成本/响应观测
// 成本/响应观测:记录每次 LLM 调用(任务/模型/耗时/成功与否/token 估算),不落 key
export {
  LlmTelemetry,
  llmTelemetry,
  estimateTokens,
  hostOfBaseUrl,
  classifyLlmError,
  type LlmCallRecord,
  type LlmTelemetrySummary,
  type LlmTelemetryOptions,
} from "./llm/telemetry.js";

// 同步引擎
export { syncToPlatforms } from "./sync/sync-engine.js";
export type { PlatformResult, SyncOptions } from "./sync/sync-engine.js";

// 内容助手(Phase 5:AI-01/02/03, FLOW-01/02/04, PLAT-02/SDK-01)
export * from "./assistant/index.js";

// AI 自动完成 Agent(让大模型自动完成分析/修复/增强/复核)
export * from "./agent/index.js";

// 文章版本历史(快照时间线/差异对比/一键回滚)
export * from "./versions/index.js";

// 平台产物对比(源文 vs 产物降级差异)
export * from "./compare/index.js";

// 本机计划任务(FLOW-03)
export * from "./scheduler/index.js";

// 效果回收与官方指标同步(DATA-02/03)
export * from "./analytics/index.js";

// Phase D 内容智能(AI-INSIGHT-01/02/03)
export * from "./insight/index.js";

// 发布任务(JOB-01/02/03)
export {
  jobStages,
  platformJobStages,
} from "./jobs/types.js";
export type {
  JobStage,
  PlatformJobStage,
  JobAttempt,
  JobReceipt,
  PlatformJob,
  PublishJob,
  UploadedAssetRef,
  NewPublishJob,
  JobCancellation,
} from "./jobs/types.js";
export {
  canTransitionJob,
  canTransitionPlatform,
  transitionJob,
  transitionPlatform,
  isTerminalStage,
  isSafeToRetry,
  coarseStageOf,
  aggregateJobStage,
} from "./jobs/state-machine.js";
export {
  JOB_SCHEMA_VERSION,
  JOB_RETENTION_MAX,
  JOB_RETENTION_TTL_MS,
  MemoryJobStore,
  isTerminalJob,
  isResumable,
  assertJobSchema,
} from "./jobs/store.js";
export type { JobStore } from "./jobs/store.js";
export {
  PublishJobService,
  jobProgressStages,
  platformStageLabel,
  jobStageLabel,
} from "./jobs/service.js";
export type { PlatformExecutor, CreateJobInput, JobServiceOptions } from "./jobs/service.js";
export { FaultInjectionExecutor } from "./jobs/fault-injection.js";
export type { FaultKind, FaultRule, FaultInjectionOptions } from "./jobs/fault-injection.js";
export type { PlatformExecutorHooks, PlatformExecutorHookName } from "./jobs/executor-types.js";

// 平台 API 契约层(一键连接/一键解析/真实发布)
export * from "./platform-api/index.js";

// v4 Phase 1 · 多账号平台管理(ACCOUNT-01/02)
export * from "./accounts/index.js";

// v4 Phase 2 · 内容智能周报自动化(WEEKLY-01/02)
export * from "./weekly/index.js";

// v4 Phase 3 · 协作共享(COLLAB-01/02/04)
export * from "./collab/index.js";

// v3 · AI 选区操作
export {
  runSelectionAi,
  runSelectionAiForPlatforms,
  selectionAiRequest,
  selectionOpToLlmTask,
  isBlockishOutput,
  mapBounded,
  platformStyleHint,
  SELECTION_AI_OP_LABELS,
  type SelectionAiOp,
  type SelectionAiRequest,
  type SelectionAiResult,
  type PlatformSelectionAiResult,
  type MultiPlatformSelectionAiResult,
} from "./editor-ai/index.js";

// v3 · 内容日历
export {
  buildCalendar,
  toIsoDate,
  parseIsoDate,
  daysInMonth,
  matchesCronOnDate,
  shiftCronToDate,
  shiftIsoToDate,
  dayOfWeekIndex,
  weekDates,
  addDaysIso,
  isInWeek,
  collectReschedulableInRange,
  type CalendarDay,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarInput,
  type CalendarReschedulable,
  type BuildCalendarOptions,
} from "./calendar/index.js";

// v3 · 发布复盘报告
// v9 Phase 3 · AI 报告解读(REPORT-AI-01)
export {
  buildPerformanceReport,
  formatCount,
  suggestionsToMarkdown,
  filterRecordsByWindow,
  reportMarkdownToHtml,
  REPORT_TEMPLATE_LABELS,
  type BuildReportOptions,
  type ReportTemplate,
  // REPORT-AI-01
  ruleReportInsight,
  reportInsightRequest,
  parseReportInsightJson,
  summarizeReportWithLlm,
  type ReportAiInsight,
} from "./report/index.js";

// v5 Phase 1 · 发布队列与定时发布(稍后发布 / 账号级路由)
export * from "./publish-queue/index.js";

// v5 Phase 2 · 发布批次与批量复盘(一次排队多篇 / 批量效果回收 / 批次复盘)
export * from "./publish-batch/index.js";

// v5 Phase 3 · 内容资产库(封面/图床/平台产物/草稿快照统一索引与检索)
export * from "./asset-library/index.js";

// v7 Phase 4 · 文档大纲提取(OUTLINE-01)
export * from "./outline/index.js";

// v7 Phase 4 · Markdown 片段库(SNIPPET-01)
export * from "./snippets/index.js";

// v7 Phase 4 · 整篇 AI 写作增强(AI-WRITE-01)
export * from "./doc-write/index.js";

// v8 Phase 1/2 · 运营驾驶舱与发布执行增强(DASH-01~04 / EXEC-01/02)
export * from "./dashboard/index.js";

// v9 Phase 1 · 内容生命周期管理(LC-01/02/03)
export * from "./lifecycle/index.js";

// v9 Phase 2 · 发布效果预测(FORECAST-01/02)
export * from "./forecast/index.js";

// v9 Phase 3 · 统一内容标签(TAG-01)
export * from "./tagging/index.js";

// v11 Part 1 · 互动与私信聚合(INBOX-01/02,统一收件箱;INBOX-04 自动回复回发)
export * from "./inbox/index.js";

// v11 Part 1 · 账号矩阵分组管理(BRAND-01)
export * from "./brand/index.js";

// v11 Part 2 · AI 内容一键裂变(FISSION-01/02/03)
export * from "./fission/index.js";

// v11 Part 2 · AI 跨平台本土化(LOCALIZE-01/02)
export * from "./localize/index.js";

// v11 Part 2 · 视觉与多媒体 AI(MEDIA-01)
export * from "./media-ai/index.js";

// v11 Part 2 · AI 智能客服与评论营销(CRM-01)
export * from "./crm/index.js";

// v11 Part 2 · 合规与安全审查(COMPLIANCE-01)
export * from "./compliance/index.js";

// v11 · 内容策略智能引擎(REFRESH-TRACK / ATTRIBUTE / STRATEGY / GOAL-STRATEGY)
export * from "./strategy/index.js";
