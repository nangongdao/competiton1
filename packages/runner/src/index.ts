export type {
  AutomationMode,
  AutomationOptions,
  AutomationPlatformId,
  AutomationPublishReceipt,
  AutomationPublishRequest,
  AutomationStatus,
} from "./types.js";
export {
  automationModes,
  automationPlatformIds,
  automationStatuses,
  isAutomationMode,
  isAutomationPlatformId,
  isAutomationPublishReceipt,
  isAutomationStatus,
  parseAutomationPublishRequest,
} from "./types.js";
export { buildRunnerApp, type AutomationPublisher, type RunnerAppOptions } from "./server.js";
export { loadRunnerConfig, type RunnerConfig } from "./config.js";
export { BrowserSessionManager, resolveProfileDir, type BrowserSessionOptions } from "./browser/session.js";
export {
  createRunArtifacts,
  redactForArtifact,
  pruneRunArtifacts,
  parseArtifactTimestamp,
  RUN_ARTIFACTS_MAX_DIRS,
  RUN_ARTIFACTS_TTL_MS,
  type RunArtifacts,
} from "./diagnostics/artifacts.js";
export {
  getAutomationAdapter,
  listAutomationAdapters,
  registerAutomationAdapter,
} from "./platforms/registry.js";
export type { AutomationPlatformAdapter } from "./platforms/types.js";
export {
  prepareEditor,
  submitEditor,
  verifyEditor,
  confirmContent,
  detectHumanBlocker,
  HumanBlockerError,
  type EditorSelectors,
} from "./platforms/common.js";
export {
  registerPlatformApiConnectRoute,
  type PlatformApiConnectOptions,
} from "./platform-api/routes.js";
export {
  makeRunnerCommentReplyAdapter,
  fetchCommentsFromPage,
  normalizeScrapedItem,
  type CommentSessionOpener,
} from "./comment/automation.js";
export {
  COMMENT_SYNC_SELECTORS,
  COMMENT_REPLY_SELECTORS,
  isCommentAutomationPlatform,
  assertAllCommentSelectors,
} from "./comment/selectors.js";
export {
  registerRunnerInboxRoutes,
  type RegisterRunnerInboxRoutesOptions,
} from "./comment/routes.js";
export {
  makeSessionConnectionChecker,
  makeCsdnConnectionChecker,
  type SessionOpener,
} from "./platform-api/connect.js";
