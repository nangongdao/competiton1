/**
 * v4 Phase 3 · 协作共享模块统一导出。
 */
export {
  SHARED_SCHEMA_VERSION,
  SHARE_BUNDLE_SCHEMA_VERSION,
  SHARE_BUNDLE_APP_ID,
  SHARE_BUNDLE_KIND,
  SHARED_ITEMS_PER_KIND_MAX,
  type SharedContentKind,
  type SharedItemMeta,
  type SharedItem,
  type SharedPayload,
  type SharedDraftPayload,
  type SharedTemplatePayload,
  type SharedReportPayload,
  type SharedStore,
  type SharedItemPutMode,
  type SharedItemPutResult,
  type ShareBundleFile,
  type ShareBundleParseResult,
  type ShareBundleImportResult,
} from "./types.js";
export {
  serializeShareBundle,
  buildShareBundle,
  computeShareDigest,
  fnv1aHex,
  parseShareBundle,
  importShareBundle,
  countByKind,
  sharedItemFrom,
  normalizeSharedItem,
} from "./bundle.js";
export {
  MemorySharedStore,
  assertSharedItem,
  bumpSharedVersion,
  mergeSharedItem,
} from "./store.js";
