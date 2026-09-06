/**
 * 应用状态(zustand)。
 *
 * 单向数据流:markdown 输入 → 解析为 IR → 对所选平台 syncToPlatforms(stageOnly)→ 结果。
 * 发布动作单独触发(confirm)。bridge 通过 setBridge 注入(web/扩展不同实现)。
 */
import { create } from "zustand";
import {
  type AssetTable,
  markdownToIR,
  syncToPlatforms,
  listAdapters,
  type PlatformResult,
  type RehostContext,
  type EnhanceOptions,
  type SerializedPayload,
  type PublishJob,
  PublishJobService,
  type PlatformExecutor,
  contentHashOfPayload,
} from "@mpp/core";
import type { AutomationPublishMode, PlatformBridge } from "../bridge/types.js";
import { createDraftStore, type Draft, type DraftStore, type HistoryEntry } from "../storage/draft-store.js";
import { parseImport, serializeExport, type MppData } from "../storage/data-transfer.js";
import { createJobStore } from "../storage/job-store.js";
import type { JobStore } from "../storage/job-store.js";
import { createScheduledTaskStore } from "../storage/schedule-store.js";
import type { ScheduledTaskStore } from "../storage/schedule-store.js";
import { createPerformanceStore } from "../storage/performance-store.js";
import type { PerformanceStore } from "../storage/performance-store.js";
import { createVersionStore } from "../storage/version-store.js";
import type { VersionStore } from "../storage/version-store.js";
import { createAccountStore } from "../storage/account-store.js";
import type { AccountStore } from "../storage/account-store.js";
import { createAccountGroupStore } from "../storage/account-group-store.js";
import { createInboxStore } from "../storage/inbox-store.js";
import { createWeeklyStore } from "../storage/weekly-store.js";
import type { WeeklyReportStore } from "../storage/weekly-store.js";
import { createSharedStore } from "../storage/shared-store.js";
import { createPublishQueueStore } from "../storage/publish-queue-store.js";
import type { PublishQueueStore } from "../storage/publish-queue-store.js";
import { createPublishBatchStore } from "../storage/publish-batch-store.js";
import type { PublishBatchStore } from "../storage/publish-batch-store.js";
import { createAssetLibraryStore } from "../storage/asset-library-store.js";
import type { AssetLibraryStore } from "../storage/asset-library-store.js";
import {
  ScheduledTaskService,
  type ScheduledTask,
  type ScheduledTaskRunner,
  type PerformanceRecord,
  type PlatformPerformanceSummary,
  summarizePerformance,
  importPerformanceRecords,
  createManualPerformanceRecord,
  parsePerformanceCsv,
  type CronExpression,
  type PerformanceInsights,
  analyzePerformance,
  type DraftIndex,
  createSnapshot,
  type VersionMeta,
  type VersionDiff,
  diffVersions,
  normalizeLlmConfig,
  stripApiKey,
  getLlmPreset,
  configFromPreset,
  createAccountProfile,
  resolveActiveAccount,
  createAccountGroup,
  addMember,
  removeMember,
  createInboxMessage,
  batchUpdateInbox,
  type AccountProfile,
  type NewAccountProfile,
  WeeklyReportService,
  type WeeklyReportJob,
  type WeeklyDelivery,
  type WeeklyDeliveryKind,
  type ReportTemplate,
  buildWeeklyReport,
  PublishQueueService,
  type QueueAccountRef,
  PublishBatchService,
  type PublishBatch,
  type PublishBatchItemExecutor,
  buildAssetLibraryIndex,
  runPreflight as runPreflightCore,
  searchAssetLibrary,
  pruneAssetLibrary,
  type AssetRecord,
  type AssetLibraryKind,
} from "@mpp/core";
import { createPreviewWorker } from "../preview/worker-host.js";
import { UploadCoordinator } from "../upload/coordinator.js";
import { setSaveStatus } from "../components/save-status.js";
import { toast } from "../components/toast.js";
import { buildLlmAdapter as sharedBuildLlmAdapter } from "../bridge/llm-adapter.js";
import type { LlmConfig, LlmAdapter, LlmCallRecord, LlmTelemetrySummary } from "@mpp/core";
import { llmTelemetry } from "@mpp/core";

/** v6 NOTIFY-01:发送系统级通知(尽力而为,失败静默)。
 *  @param action 可选:点击通知后要打开的桌面/前端面板动作(如 "publish-queue" / "publish-batch")。
 */
async function notify(bridge: PlatformBridge | null, title: string, body: string, action?: string): Promise<void> {
  try {
    await bridge?.showNotification?.(title, body, action);
  } catch {
    /* 通知失败不阻塞业务 */
  }
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** ROADMAP_V5 Phase 3:资产检索命中(UI 读取用,带记录 + 评分)。 */
export interface AssetHitPublic {
  readonly record: AssetRecord;
  readonly score: number;
}

export type WechatPublishMode = "mock" | "draft" | "publish";
export type PlatformAutomationModes = Record<string, AutomationPublishMode>;

function isAutomationPublishMode(value: unknown): value is AutomationPublishMode {
  return value === "mock" || value === "assist" || value === "draft" || value === "full-auto";
}

export interface AppState {
  markdown: string;
  authorName: string;
  tags: string[];
  selectedPlatforms: string[];
  results: PlatformResult[];
  publishing: boolean;
  receipts: Record<string, string>;
  bridge: PlatformBridge | null;
  /** server 地址(图片上传/公众号发布用)。 */
  serverUrl: string;
  /** Playwright runner 地址(真实网页端自动化发布用)。 */
  runnerUrl: string;
  /** server 的 capability token(启动时由服务端生成,存本地设置)。 */
  serverToken: string;
  /** runner 的 capability token。 */
  runnerToken: string;
  /** 上传图床后的 URL 映射:原始(dataURL/URL)→ 图床 URL。 */
  uploadedAssets: Record<string, string>;
  /** LLM 设置(apiKey 仅存本地)。 */
  llm: LlmSettings;
  /** AI 连接中心:已保存的多套 LLM 连接配置(apiKey 遵循 SEC-04)。 */
  llmConfigs: LlmConfig[];
  /** AI 连接中心:当前生效配置 id(与 llm 保持同步)。 */
  activeLlmConfigId: string | null;
  /** 是否持久化 LLM key(SEC-04:默认仅会话保存,持久化需用户显式选择)。 */
  persistLlmKey: boolean;
  /** 启用的 AI 增强项。 */
  enhance: EnhanceOptions;
  /** 公众号发布模式:mock=模拟,draft=创建草稿,publish=提交发布。 */
  wechatPublishMode: WechatPublishMode;
  /** 每个平台的网页自动化发布模式。 */
  automationModes: PlatformAutomationModes;
  /** ACCOUNT-01:账号配置列表(多账号平台管理)。 */
  accounts: AccountProfile[];
  /** ACCOUNT-04:当前全局生效账号 id(账号管理抽屉切换)。 */
  activeAccountId: string | null;
  /** ACCOUNT-04:各平台账号级选择(platformId → accountId)。 */
  accountForPlatform: Record<string, string>;
  /** 已保存草稿(按更新时间倒序)。 */
  drafts: Draft[];
  /** 当前编辑中的草稿 id(null = 尚未落库)。 */
  currentDraftId: string | null;
  /** 发布历史(最近在前)。 */
  history: HistoryEntry[];
  /** 发布任务列表(UI-01 任务面板)。 */
  jobs: PublishJob[];
  /** 当前运行中的任务 id。 */
  activeJobId: string | null;
  /** 任务运行使用的 AbortController(取消贯穿)。 */
  jobAbort: AbortController | null;
  /** FLOW-03:本机计划任务列表。 */
  scheduledTasks: ScheduledTask[];
  /** DATA-02:效果回收记录列表。 */
  performanceRecords: PerformanceRecord[];
  /** AI-INSIGHT-03:草稿摘要索引列表(摘要/关键词/主题,本地)。 */
  draftIndexes: DraftIndex[];
  /** v4 Phase 2:内容智能周报任务列表(WEEKLY-01/02)。 */
  weeklyJobs: WeeklyReportJob[];
  /** v4 Phase 2:最近一次周报生成结果(Markdown,供面板展示)。 */
  weeklyReportPreview: string;
  /** v4 Phase 2:周报面板是否正在生成。 */
  weeklyGenerating: boolean;
  /** COLLAB-01/03:本地共享库内容列表(桌面端/扩展离线副本)。 */
  localSharedItems: import("@mpp/core").SharedItem[];
  /** ROADMAP_V5 Phase 1:发布队列(稍后发布)条目列表。 */
  publishQueue: import("@mpp/core").PublishQueueEntry[];
  /** 发布队列服务单例是否已接线(供面板展示)。 */
  publishQueueReady: boolean;
  /** ROADMAP_V5 Phase 2:发布批次(一次排队多篇)列表。 */
  publishBatches: PublishBatch[];
  /** 发布批次服务单例是否已接线(供面板展示)。 */
  publishBatchReady: boolean;
  /** ROADMAP_V5 Phase 2:最近一次批次批量效果回收结果(供面板展示)。 */
  lastBatchCollect: { batchId: string; imported: number; skipped: number; error?: string } | null;
  /** ROADMAP_V5 Phase 3:内容资产库记录列表。 */
  assetLibrary: AssetRecord[];
  /** ROADMAP_V5 Phase 3:资产库是否已加载。 */
  assetLibraryReady: boolean;
  /** ROADMAP_V5 Phase 3:最近一次资产索引构建结果(供面板展示)。 */
  lastAssetIndex: { added: number; updated: number; ignored: number; total: number } | null;
  /** 版本历史:当前草稿的版本时间线。 */
  versions: VersionMeta[];
  /** 当前选中的对比版本(用于差异视图)。 */
  selectedVersionId: string | null;
  /** 编辑器偏好:目标字数(0 = 不设目标)。 */
  wordGoal: number;
  /** 编辑器偏好:打字机模式(当前行高亮/居中)。 */
  typewriterMode: boolean;
  /** v7 PREFLIGHT:发布前健康检查报告(可由 runPreflight 计算)。 */
  preflightReport: import("@mpp/core").PreflightReport | null;
  /** v7 PREFLIGHT:是否正在计算健康检查。 */
  preflightComputing: boolean;
  /** v7 PREFLIGHT:运行发布前健康检查。 */
  runPreflight: () => void;
  /** v7 Phase 3:一键自动修复健康检查中可自动化的问题(缺 alt 等)。 */
  autoFixPreflightIssues: () => void;
  /** v7 创作工作流:编辑器是否有未保存修改。 */
  editorDirty: boolean;
  /** v7 创作工作流:强制立即保存当前草稿(切换/离开前 flush)。 */
  flushDraft: () => Promise<void>;
  /** v7 Phase 2:托盘创作快捷操作 —— 复制 Markdown(与 CreatorQuickActions 对齐)。 */
  copyMarkdown: () => Promise<void>;
  /** v7 Phase 2:托盘创作快捷操作 —— 导出 .md。 */
  exportMarkdown: () => Promise<void>;
  /** v7 Phase 2:托盘创作快捷操作 —— 清空内容(二次确认由托盘菜单承担,这里直接执行)。 */
  clearMarkdown: () => Promise<void>;
  /** v7 Phase 4 AI-WRITE-01:整篇 AI 写作动作(润色/扩写/续写/摘要)。 */
  runDocWrite: (op: import("@mpp/core").DocWriteOp) => Promise<import("@mpp/core").DocWriteResult>;
  /** v7 Phase 4 AI-WRITE-01:整篇 AI 写作是否执行中。 */
  docWriteBusy: boolean;
  /** v7 Phase 4 AI-WRITE-01:最近一次整篇 AI 写作结果。 */
  docWriteResult: import("@mpp/core").DocWriteResult | null;
  /** v7 Phase 4 SNIPPET-01:在光标处插入片段(纯函数语义,可撤销)。 */
  insertSnippet: (snippetText: string) => void;
  /** AI-INSIGHT-03:覆盖草稿摘要索引列表。 */
  setDraftIndexes: (indexes: DraftIndex[]) => void;
  /** AI-ROBUST-03:LLM 调用观测记录(最近在前)。 */
  llmCalls: readonly LlmCallRecord[];
  /** AI-ROBUST-03:LLM 调用观测汇总。 */
  llmTelemetrySummary: LlmTelemetrySummary;
  /** AI-ROBUST-03:清空 LLM 调用观测记录。 */
  clearLlmCalls: () => void;
  /** AI-ROBUST-03:从全局观测器刷新快照(供 UI 面板读取)。 */
  refreshLlmTelemetry: () => void;
  /** COLLAB-01/03:刷新本地共享库(桌面端/扩展)。 */
  refreshLocalShared: () => Promise<void>;
  /** COLLAB-01/03:推送一条内容到本地共享库(版本化冲突合并)。 */
  localSharedPush: (item: import("@mpp/core").SharedItem) => Promise<import("@mpp/core").SharedItemPutResult>;
  /** COLLAB-01/03:从本地共享库删除一条内容。 */
  localSharedRemove: (kind: import("@mpp/core").SharedContentKind, id: string) => Promise<void>;
  /** ROADMAP_V5 Phase 1:加载发布队列。 */
  loadPublishQueue: () => Promise<void>;
  /** ROADMAP_V5 Phase 1:把当前草稿排入发布队列(稍后发布)。 */
  enqueuePublish: (input: { name?: string; draftId?: string; platformIds?: string[]; scheduledAt: string; realPublish?: boolean }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** ROADMAP_V5 Phase 4:批量 AI 完成后一键把多篇结果排入发布队列。 */
  enqueuePublishBatch: (input: { items: ReadonlyArray<{ draftId?: string; name?: string; platformIds?: string[]; scheduledAt: string; realPublish?: boolean }> }) => Promise<{ ok: boolean; enqueued: number; error?: string }>;
  /** v11 深化 STRATEGY-ADOPT-01:策略动作一键采纳到发布队列(默认用当前草稿 + 建议平台/时段)。 */
  adoptStrategyToQueue: (input: { title?: string; platformIds?: string[]; hour?: number | null; draftId?: string }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** v10 REFRESH-QUEUE-01:老化内容批量翻新入队(生成翻新草稿 + 直接排队)。 */
  refreshAndEnqueue: (input: {
    /** 老化条目(取 action=refresh)。 */
    agingItems: ReadonlyArray<import("@mpp/core").AgingContent>;
    /** 目标平台(默认当前已选)。 */
    platformIds?: string[];
    /** 期望发布时间(ISO;默认 now+1h)。 */
    scheduledAt?: string;
  }) => Promise<{ ok: boolean; planned: number; enqueued: number; error?: string }>;
  /** ROADMAP_V5 Phase 1:检查并执行所有到点条目(心跳调用)。 */
  runDuePublishQueue: () => Promise<void>;
  /** ROADMAP_V5 Phase 1:立即执行某条目。 */
  triggerPublishQueue: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 1:改期。 */
  reschedulePublishQueue: (id: string, scheduledAt: string) => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 1:取消待执行条目。 */
  cancelPublishQueue: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 1:删除条目。 */
  removePublishQueue: (id: string) => Promise<void>;
  /** ROADMAP_V5 Phase 1:拖动排序 —— 把队列重排为目标 id 顺序(落盘新 sortOrder)。 */
  reorderPublishQueue: (orderedIds: readonly string[]) => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 2:加载发布批次。 */
  loadPublishBatches: () => Promise<void>;
  /** ROADMAP_V5 Phase 2:创建发布批次(一次排队多篇)。 */
  createPublishBatch: (input: {
    name?: string;
    items: Array<{ draftId: string; draftTitle?: string; platformIds?: string[]; scheduledAt?: string; realPublish?: boolean }>;
    scheduledAt?: string;
    realPublish?: boolean;
  }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** ROADMAP_V5 Phase 2:检查并执行批次内所有到点条目(心跳调用)。 */
  runDuePublishBatches: () => Promise<void>;
  /** ROADMAP_V5 Phase 2:立即执行批次内某条目。 */
  triggerPublishBatchItem: (batchId: string, itemId: string) => Promise<{ ok: boolean; error?: string }>;
  /** v6 CAL-04:改期批次内某条目(日历拖拽改期)。 */
  reschedulePublishBatchItem: (batchId: string, itemId: string, scheduledAt: string) => Promise<{ ok: boolean; error?: string }>;
  /** v6 Phase 2:批次整体改期(全部可改期条目统一迁移到新时间)。 */
  reschedulePublishBatchAll: (batchId: string, scheduledAt: string) => Promise<{ ok: boolean; error?: string; rescheduled?: number; skipped?: number }>;
  /** ROADMAP_V5 Phase 2:一键重试批次内全部失败条目。 */
  retryPublishBatchFailed: (batchId: string) => Promise<{ ok: boolean; error?: string; retried: number }>;
  /** ROADMAP_V5 Phase 2:取消批次。 */
  cancelPublishBatch: (batchId: string) => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 2:删除批次。 */
  removePublishBatch: (batchId: string) => Promise<void>;
  /** ROADMAP_V5 Phase 2:按批次批量回收效果(写入效果回收库)。 */
  collectBatchMetrics: (batchId: string) => Promise<{ ok: boolean; error?: string; imported?: number; skipped?: number }>;

  setBridge: (b: PlatformBridge) => void;
  setMarkdown: (md: string) => void;
  setAuthorName: (name: string) => void;
  setTags: (tags: string[]) => void;
  setServerUrl: (url: string) => void;
  setRunnerUrl: (url: string) => void;
  setServerToken: (token: string) => void;
  setRunnerToken: (token: string) => void;
  setLlm: (patch: Partial<LlmSettings>) => void;
  /** 是否持久化 LLM key(SEC-04:默认仅会话保存)。 */
  setPersistLlmKey: (persist: boolean) => void;
  /** 一键清除已保存/会话中的 LLM key(SEC-04)。 */
  clearLlmKey: () => void;
  /** AI 连接中心:保存/更新一套配置(apiKey 空时保留原 key)。 */
  saveLlmConfig: (config: Partial<LlmConfig>) => string;
  /** AI 连接中心:删除一套配置。 */
  deleteLlmConfig: (id: string) => void;
  /** AI 连接中心:切换当前生效配置。 */
  activateLlmConfig: (id: string) => void;
  /** AI 连接中心:从预设创建新配置并设为当前。 */
  applyLlmPreset: (presetId: string) => void;
  setEnhance: (patch: Partial<EnhanceOptions>) => void;
  setWechatPublishMode: (mode: WechatPublishMode) => void;
  setAutomationMode: (platformId: string, mode: AutomationPublishMode) => void;
  /** ACCOUNT-04:加载账号列表。 */
  loadAccounts: () => Promise<void>;
  /** ACCOUNT-04:新建/更新账号(secrets 默认仅会话,不落盘)。 */
  saveAccount: (input: NewAccountProfile) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** ACCOUNT-04:删除账号。 */
  deleteAccount: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** ACCOUNT-04:切换全局当前账号。 */
  setActiveAccount: (id: string | null) => void;
  /** ACCOUNT-04:设置平台级账号选择。 */
  setAccountForPlatform: (platformId: string, accountId: string | null) => void;
  /** ACCOUNT-03:取某平台的当前生效账号(发布/连接/指标路由用)。 */
  accountFor: (platformId: string) => AccountProfile | undefined;
  /** v11 BRAND-01:账号矩阵分组列表(按品牌/业务线)。 */
  accountGroups: import("@mpp/core").AccountGroup[];
  /** v11 BRAND-01:加载账号分组。 */
  loadAccountGroups: () => Promise<void>;
  /** v11 BRAND-01:新建/更新账号分组。 */
  saveAccountGroup: (input: import("@mpp/core").NewAccountGroup) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** v11 BRAND-01:删除账号分组。 */
  deleteAccountGroup: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** v11 BRAND-01:向分组加入/移除账号(纯函数落盘)。 */
  setGroupMember: (groupId: string, accountId: string, member: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** v11 BRAND-01:拖动排序 —— 把分组重排为目标 id 顺序(落盘新 sortOrder)。 */
  reorderAccountGroups: (orderedIds: readonly string[]) => Promise<{ ok: boolean; error?: string }>;
  /** v11 INBOX-01:统一收件箱消息列表(评论/私信/@提及/通知)。 */
  inboxMessages: import("@mpp/core").InboxMessage[];
  /** v11 INBOX-01:加载收件箱。 */
  loadInbox: () => Promise<void>;
  /** v11 INBOX-01:新增/更新一条收件箱消息。 */
  upsertInboxMessage: (input: import("@mpp/core").NewInboxMessage) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** v11 INBOX-01:批量更新收件箱消息(mark-read / archive / close)。 */
  batchUpdateInboxMessages: (action: "mark-read" | "archive" | "close", predicate?: (m: import("@mpp/core").InboxMessage) => boolean) => Promise<{ ok: boolean; error?: string }>;
  /** v11 INBOX-01:删除一条收件箱消息。 */
  removeInboxMessage: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** v11 INBOX-01:切换消息置顶(置顶消息在列表中优先展示)。 */
  toggleInboxPinned: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** v11 INBOX-05:拖动排序 —— 把当前视图内消息重排为目标 id 顺序(落盘新 sortOrder)。 */
  reorderInboxMessages: (orderedIds: readonly string[]) => Promise<{ ok: boolean; error?: string }>;
  /** v11 INBOX-03:同步真实平台消息(评论/私信等)并合并进收件箱。 */
  syncInboxFromPlatforms: (platformIds: readonly string[]) => Promise<{ ok: boolean; message: string }>;
  /** v11 INBOX-03:各平台同步游标(增量拉取位置,持久化到本地设置)。 */
  inboxSyncCursors: Record<string, string>;
  /** v11 INBOX-03:设置平台同步游标。 */
  setInboxSyncCursor: (platformId: string, cursor: string) => void;
  /** v11 INBOX-03:同步状态(进行中标记,UI 转圈)。 */
  inboxSyncing: boolean;
  /** v11 INBOX-04:单条评论真实回发到平台(AI 自动回复 / 人工回复落平台)。 */
  replyInboxMessage: (message: import("@mpp/core").InboxMessage, text: string) => Promise<{ ok: boolean; error?: string }>;
  /** v11 INBOX-04:批量 AI 自动回复真实回发到平台(按平台分批)。 */
  autoReplyInboxMessages: (platformId: string, messages?: readonly import("@mpp/core").InboxMessage[], policy?: import("@mpp/core").AutoReplyPolicy) => Promise<{ ok: boolean; message: string }>;
  togglePlatform: (id: string) => void;
  /** 插入一张本地图片(以 dataURL 形式追加到 markdown)。 */
  insertLocalImage: (dataUrl: string, alt: string) => void;
  /** 是否配置了可用 LLM。 */
  llmReady: () => boolean;
  adapt: () => void;
  publishAll: () => Promise<void>;
  /** 从存储加载草稿列表与发布历史(挂载时调用)。 */
  loadDrafts: () => Promise<void>;
  /** 新建空白草稿(清空编辑区并落一条新记录)。 */
  newDraft: () => Promise<void>;
  /** 加载指定草稿到编辑区。 */
  loadDraft: (id: string) => Promise<void>;
  /** 保存当前编辑内容为草稿(无 currentDraftId 时新建)。 */
  saveDraft: () => Promise<void>;
  /** 删除草稿。 */
  deleteDraft: (id: string) => Promise<void>;
  /** 批量 AI 自动完成后,把改写结果写回草稿(仅保留有变化的草稿)。 */
  applyBatchAutoCompleteResults: (items: ReadonlyArray<{ id: string; markdown: string }>) => Promise<{ ok: boolean; saved: number; error?: string }>;
  /** DATA-01:导出全部草稿/历史/设置为 JSON 文件(触发下载)。 */
  exportData: () => Promise<{ ok: boolean; error?: string }>;
  /** DATA-01:从 JSON 文件导入(合并到现有数据)。 */
  importData: (raw: string) => Promise<{ ok: boolean; error?: string; counts?: { drafts: number; history: number } }>;
  /** UI-01:创建并运行发布任务(真实发布路径),返回任务 id。 */
  createPublishJob: () => Promise<string>;
  /** FLOW-03:从指定草稿创建并运行发布任务(供计划任务执行器调用)。 */
  createPublishJobFromDraft: (
    draft: { markdown: string; authorName: string; tags: readonly string[] },
    platformIds?: readonly string[],
    /** ROADMAP_V5 Phase 1:发布队列锁定的账号引用(到点按此账号发布,而非当前账号)。 */
    accountRefs?: readonly QueueAccountRef[],
  ) => Promise<string | null>;
  /** UI-01:按平台重试。 */
  retryJobPlatform: (jobId: string, platformId: string) => Promise<void>;
  /** UI-01:取消任务。 */
  cancelJob: (jobId: string) => Promise<void>;
  /** 从存储加载历史任务(挂载时调用)。 */
  loadJobs: () => Promise<void>;
  /** FLOW-03:加载计划任务列表。 */
  loadScheduledTasks: () => Promise<void>;
  /** FLOW-03:检查并执行所有到期计划任务(定时器心跳调用)。 */
  runDueScheduledTasks: () => Promise<void>;
  /** FLOW-03:创建计划任务。 */
  createScheduledTask: (input: {
    name: string;
    cron: CronExpression;
    actionKind: "validate-generate" | "publish-job" | "metrics-sync" | "ai-auto-complete" | "weekly-report" | "inbox-auto-reply";
    platformIds: string[];
    draftId: string;
    /** WEEKLY-02:周报动作关联的周报任务 id。 */
    weeklyJobId?: string;
    /** INBOX-06:收件箱自动回复策略配置(仅 inbox-auto-reply 动作)。 */
    autoReplyPolicy?: import("@mpp/core").AutoReplyPolicy;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** FLOW-03:手动触发一次计划任务。 */
  triggerScheduledTask: (id: string) => Promise<void>;
  /** FLOW-03:暂停/恢复计划任务。 */
  setScheduledTaskStatus: (id: string, status: "paused" | "enabled") => Promise<void>;
  /** CAL-03:更新计划任务(拖拽改期/改名等)。 */
  updateScheduledTask: (id: string, patch: { name?: string; cron?: CronExpression; platformIds?: string[] }) => Promise<{ ok: boolean; error?: string }>;
  /** FLOW-03:删除计划任务。 */
  removeScheduledTask: (id: string) => Promise<void>;
  /** WEEKLY-01/02:加载周报任务列表。 */
  loadWeeklyJobs: () => Promise<void>;
  /** WEEKLY-04:创建周报任务。 */
  createWeeklyJob: (input: {
    name?: string;
    template?: ReportTemplate;
    windowDays?: number;
    deliveries?: readonly WeeklyDelivery[];
    useLlm?: boolean;
  }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** WEEKLY-04:更新周报任务。 */
  updateWeeklyJob: (
    id: string,
    patch: { name?: string; template?: ReportTemplate; windowDays?: number; deliveries?: readonly WeeklyDelivery[]; useLlm?: boolean },
  ) => Promise<{ ok: boolean; error?: string }>;
  /** WEEKLY-04:暂停/恢复周报任务。 */
  setWeeklyJobStatus: (id: string, status: "paused" | "enabled") => Promise<void>;
  /** WEEKLY-04:删除周报任务。 */
  removeWeeklyJob: (id: string) => Promise<void>;
  /** WEEKLY-04:手动立即生成周报(结果写入 weeklyReportPreview)。 */
  generateWeeklyReport: (id: string) => Promise<{ ok: boolean; error?: string; report?: string }>;
  /** WEEKLY-04:生成一份预览周报(不落任务,直接返回 Markdown)。 */
  previewWeeklyReport: (template?: ReportTemplate, windowDays?: number) => Promise<{ ok: boolean; report?: string; error?: string }>;
  /** WEEKLY-03:把已生成的周报投递到本地 server(多渠道)。 */
  sendWeeklyReport: (id: string, deliveries: readonly WeeklyDelivery[]) => Promise<{ ok: boolean; message?: string; results?: readonly { kind: WeeklyDeliveryKind; ok: boolean; message: string }[] }>;
  /** DATA-02:加载效果记录。 */
  loadPerformance: () => Promise<void>;
  /** DATA-02:CSV 导入效果记录。 */
  importPerformanceCsv: (raw: string) => Promise<{ ok: boolean; error?: string; imported?: number }>;
  /** DATA-02:手工录入一条效果记录。 */
  addManualPerformance: (input: {
    platformId: string;
    title: string;
    remoteId?: string;
    remoteUrl?: string;
    publishedAt: string;
    metrics: { views?: number; likes?: number; comments?: number; shares?: number };
  }) => Promise<{ ok: boolean; error?: string }>;
  /** DATA-02:删除一条效果记录。 */
  removePerformanceRecord: (id: string) => Promise<void>;
  /** DATA-03:官方 API 指标同步(配置了 provider 的平台)。 */
  syncPerformanceFromApi: () => Promise<{ ok: boolean; message: string }>;
  /** 效果记录按平台汇总(派生值)。 */
  performanceSummary: () => readonly PlatformPerformanceSummary[];
  /** 发布效果智能分析(派生值)。 */
  performanceInsights: () => PerformanceInsights;
  /** v10 FOLLOWUP-NOTIFY:待跟进提醒是否开启(开启后心跳检查到待跟进项时发系统通知)。 */
  followUpReminderEnabled: boolean;
  /** v10 FOLLOWUP-NOTIFY:最近一次待跟进提醒时间(ISO;同一天不重复提醒)。 */
  followUpLastRemindedAt: string | null;
  /** v10 FOLLOWUP-NOTIFY:最近一次待跟进提醒摘要(供面板展示)。 */
  followUpReminderDigest: import("@mpp/core").FollowUpReminderDigest | null;
  /** v11 INBOX-07:置顶评论自动跟进提醒摘要。 */
  pinnedFollowUpDigest: import("@mpp/core").PinnedFollowUpDigest | null;
  /** v11 INBOX-07:置顶评论跟进提醒开关(开启后心跳检查发通知)。 */
  pinnedFollowUpEnabled: boolean;
  /** v11 INBOX-07:最近一次置顶跟进提醒时间(ISO;同一天不重复)。 */
  pinnedFollowUpLastRemindedAt: string | null;
  /** v11 INBOX-07:运行置顶评论跟进提醒检查。 */
  runPinnedFollowUpReminder: (force?: boolean) => Promise<{ ok: boolean; notified: boolean }>;
  /** v11 INBOX-07:开关置顶跟进提醒。 */
  setPinnedFollowUpEnabled: (enabled: boolean) => void;
  /** v10 FOLLOWUP-NOTIFY:开关待跟进提醒(持久化)。 */
  setFollowUpReminderEnabled: (enabled: boolean) => void;
  /** v10 FOLLOWUP-NOTIFY:立即检查并发送一次待跟进提醒(手动触发)。 */
  runFollowUpReminder: (force?: boolean) => Promise<{ ok: boolean; notified: boolean; error?: string }>;
  /** v11 深化 GOAL-NOTIFY-01:目标达成预测提醒是否开启(开启后 at-risk/off-track 时心跳提醒)。 */
  goalReminderEnabled: boolean;
  /** v11 深化 GOAL-NOTIFY-01:最近一次目标达成提醒时间(ISO;同日不重复)。 */
  goalLastRemindedAt: string | null;
  /** v11 深化 GOAL-NOTIFY-01:最近一次目标达成提醒摘要(供面板展示)。 */
  goalReminderDigest: import("@mpp/core").GoalReminderDigest | null;
  /** v11 深化 GOAL-NOTIFY-01:开关目标达成提醒(持久化)。 */
  setGoalReminderEnabled: (enabled: boolean) => void;
  /** v11 深化 GOAL-NOTIFY-01:立即检查并发送一次目标达成提醒(手动触发,force 可绕过同日去重)。 */
  runGoalReminder: (force?: boolean) => Promise<{ ok: boolean; notified: boolean; error?: string }>;
  /** v11 深化 REFRESH-TRACK-CLOSED-01:翻新入队时自动打标的历史标记列表(原版→翻新,供效果回收自动配对)。 */
  refreshMarks: readonly { readonly originalTitle: string; readonly refreshedTitle: string }[];
  /** ROADMAP_V5 Phase 3:加载资产库记录。 */
  loadAssetLibrary: () => Promise<void>;
  /** ROADMAP_V5 Phase 3:增量构建资产索引(草稿/队列/批次 → 封面/图床/产物)。 */
  rebuildAssetIndex: () => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 3:检索资产库(本地确定性评分)。 */
  searchAssets: (query: string, kind?: AssetLibraryKind) => readonly AssetHitPublic[];
  /** ROADMAP_V5 Phase 3:手动录入一条资产记录。 */
  addAsset: (input: {
    kind: AssetLibraryKind;
    title: string;
    platformId?: string;
    reference: string;
    bytes?: number;
    mime?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** ROADMAP_V5 Phase 3:删除一条资产记录。 */
  removeAsset: (id: string) => Promise<void>;
  /** 版本历史:加载当前草稿的版本时间线。 */
  loadVersions: () => Promise<void>;
  /** 版本历史:手动保存一个命名快照。 */
  saveVersionSnapshot: (label?: string) => Promise<void>;
  /** 版本历史:对比两个版本,返回 diff。 */
  diffVersion: (aId: string, bId: string) => Promise<VersionDiff | null>;
  /** 版本历史:回滚到指定版本。 */
  restoreVersion: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** 编辑器偏好:设置目标字数。 */
  setWordGoal: (goal: number) => void;
  /** 编辑器偏好:切换打字机模式。 */
  setTypewriterMode: (on: boolean) => void;
}

const DEFAULT_MD = `# 我用这款效率工具,每天省下两小时

最近发现一个时间管理方法,分享给大家。

## 三个核心方法

1. **时间块**:把一天切成若干 90 分钟专注块
2. **单任务**:每个块只做一件事
3. **复盘**:每天结束花 5 分钟记录

> 专注不是天赋,而是可以训练的能力。

参考这篇[研究报告](https://example.com/research)。

![示意图](https://images.example.com/timeblock.png)
`;

const ALL_PLATFORMS = listAdapters().map((a) => a.id);

/** 草稿存储单例:首次访问时按 bridge 环境惰性创建(web=IndexedDB / 扩展=chrome.storage)。 */
let draftStore: DraftStore | null = null;
function getDraftStore(bridge: PlatformBridge | null): DraftStore {
  if (!draftStore) draftStore = createDraftStore(bridge?.env ?? "web");
  return draftStore;
}

/** 发布任务存储单例。 */
let jobStore: JobStore | null = null;
function getJobStore(bridge: PlatformBridge | null): JobStore {
  if (!jobStore) jobStore = createJobStore(bridge?.env ?? "web");
  return jobStore;
}

/** 发布任务服务单例(注册平台执行器一次)。 */
let jobService: PublishJobService | null = null;
function getJobService(bridge: PlatformBridge | null): PublishJobService {
  if (!jobService) {
    jobService = new PublishJobService({ store: getJobStore(bridge) });
    registerDefaultExecutors(jobService, bridge);
  } else if (bridge && jobService) {
    // 确保执行器已注册(环境可能从 web 切到扩展)。
    registerDefaultExecutors(jobService, bridge);
  }
  return jobService;
}

/** 计划任务存储单例。 */
let scheduleStore: ScheduledTaskStore | null = null;
function getScheduleStore(bridge: PlatformBridge | null): ScheduledTaskStore {
  if (!scheduleStore) scheduleStore = createScheduledTaskStore(bridge?.env ?? "web");
  return scheduleStore;
}

/** 计划任务服务单例。 */
let scheduleService: ScheduledTaskService | null = null;
function getScheduleService(bridge: PlatformBridge | null): ScheduledTaskService {
  if (!scheduleService) {
    scheduleService = new ScheduledTaskService({
      store: getScheduleStore(bridge),
      runner: scheduleRunner(bridge),
    });
  }
  return scheduleService;
}

/** 发布队列存储单例。 */
let publishQueueStore: PublishQueueStore | null = null;
function getPublishQueueStore(bridge: PlatformBridge | null): PublishQueueStore {
  if (!publishQueueStore) publishQueueStore = createPublishQueueStore(bridge?.env ?? "web");
  return publishQueueStore;
}

/** 发布队列服务单例(执行器到点把条目转成发布任务)。 */
let publishQueueService: PublishQueueService | null = null;
function getPublishQueueService(bridge: PlatformBridge | null): PublishQueueService {
  if (!publishQueueService) {
    publishQueueService = new PublishQueueService({
      store: getPublishQueueStore(bridge),
      executor: publishQueueExecutor(bridge),
    });
  }
  return publishQueueService;
}

/** 发布批次存储单例。 */
let publishBatchStore: PublishBatchStore | null = null;
function getPublishBatchStore(bridge: PlatformBridge | null): PublishBatchStore {
  if (!publishBatchStore) publishBatchStore = createPublishBatchStore(bridge?.env ?? "web");
  return publishBatchStore;
}

/** 内容资产库存储单例(ROADMAP_V5 Phase 3)。 */
let assetLibraryStore: AssetLibraryStore | null = null;
function getAssetLibraryStore(bridge: PlatformBridge | null): AssetLibraryStore {
  if (!assetLibraryStore) assetLibraryStore = createAssetLibraryStore(bridge?.env ?? "web");
  return assetLibraryStore;
}

/** 发布批次服务单例(执行器到点把批次条目转成发布任务)。 */
let publishBatchService: PublishBatchService | null = null;
function getPublishBatchService(bridge: PlatformBridge | null): PublishBatchService {
  if (!publishBatchService) {
    publishBatchService = new PublishBatchService({
      store: getPublishBatchStore(bridge),
      executor: publishBatchItemExecutor(bridge),
    });
  }
  return publishBatchService;
}

/** 效果记录存储单例。 */
let performanceStore: PerformanceStore | null = null;
function getPerformanceStore(bridge: PlatformBridge | null): PerformanceStore {
  if (!performanceStore) performanceStore = createPerformanceStore(bridge?.env ?? "web");
  return performanceStore;
}

/** 版本历史存储单例。 */
let versionStore: VersionStore | null = null;
function getVersionStore(bridge: PlatformBridge | null): VersionStore {
  if (!versionStore) versionStore = createVersionStore(bridge?.env ?? "web");
  return versionStore;
}

/** ACCOUNT-02 账号存储单例。 */
let accountStore: AccountStore | null = null;
function getAccountStore(bridge: PlatformBridge | null): AccountStore {
  if (!accountStore) accountStore = createAccountStore(bridge?.env ?? "web");
  return accountStore;
}

/** v11 BRAND-01:账号矩阵分组存储单例。 */
let accountGroupStore: import("@mpp/core").AccountGroupStore | null = null;
function getAccountGroupStore(bridge: PlatformBridge | null): import("@mpp/core").AccountGroupStore {
  if (!accountGroupStore) accountGroupStore = createAccountGroupStore(bridge?.env ?? "web");
  return accountGroupStore;
}

/** v11 INBOX-01:统一收件箱存储单例。 */
let inboxStore: import("@mpp/core").InboxStore | null = null;
function getInboxStore(bridge: PlatformBridge | null): import("@mpp/core").InboxStore {
  if (!inboxStore) inboxStore = createInboxStore(bridge?.env ?? "web");
  return inboxStore;
}

/** WEEKLY-02 周报任务存储单例。 */
let weeklyStore: WeeklyReportStore | null = null;
function getWeeklyStore(bridge: PlatformBridge | null): WeeklyReportStore {
  if (!weeklyStore) weeklyStore = createWeeklyStore(bridge?.env ?? "web");
  return weeklyStore;
}

/** WEEKLY-02 周报服务单例。 */
let weeklyService: WeeklyReportService | null = null;
function getWeeklyService(bridge: PlatformBridge | null): WeeklyReportService {
  if (!weeklyService) {
    weeklyService = new WeeklyReportService({
      store: getWeeklyStore(bridge),
      recordsProvider: async () => useStore.getState().performanceRecords,
      llm: undefined,
    });
  }
  return weeklyService;
}

/** COLLAB-01/03:本地共享库单例。
 * - 桌面端:优先用 FileSharedStore(经 Tauri 桥读写应用数据目录,与 server 同格式);
 * - 扩展:chrome.storage.local;web/其余:IndexedDB。
 */
let localSharedStore: import("@mpp/core").SharedStore | null = null;
let localSharedStorePromise: Promise<import("@mpp/core").SharedStore> | null = null;
function getLocalSharedStore(bridge: PlatformBridge | null): Promise<import("@mpp/core").SharedStore> {
  if (localSharedStore) return Promise.resolve(localSharedStore);
  if (localSharedStorePromise) return localSharedStorePromise;
  if (bridge?.env === "desktop" && typeof bridge.readLocalSharedStore === "function") {
    // 桌面端:复用 FileSharedStore(文件由 Rust 原子写,内存缓存 + 版本化合并)。
    localSharedStorePromise = import("../bridge/desktop-shared-store.js").then((m) => {
      const store = new m.DesktopFileSharedStore(bridge as import("../bridge/tauri-bridge.js").TauriBridge);
      localSharedStore = store;
      return store;
    });
    return localSharedStorePromise;
  }
  const store = createSharedStore(bridge?.env ?? "web");
  localSharedStore = store;
  return Promise.resolve(store);
}

/** 预览更新防抖(UPGRADE §3.3):连续输入时只在停顿后触发一次适配,避免每次按键全量重算。 */
const PREVIEW_DEBOUNCE_MS = 250;
/** 适配序号:过期结果守卫,防止慢的旧请求覆盖新结果。 */
let adaptTimer: ReturnType<typeof setTimeout> | null = null;
let adaptSeq = 0;

/** 预览 Web Worker(PERF-02):懒加载单例,把 parse/serialize 移到独立线程。 */
let previewWorker: ReturnType<typeof createPreviewWorker> | null = null;
function getPreviewWorker() {
  if (!previewWorker) {
    previewWorker = createPreviewWorker();
    // Worker 结果回写 store(只接受最新 seq)。
    previewWorker.onResult((results) => {
      useStore.setState({ results: results as unknown as PlatformResult[] });
    });
  }
  return previewWorker;
}

/** 从首行 # 标题或正文首句提取草稿标题。 */
function deriveTitle(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 30) : "未命名草稿";
}

/** 会话级 LLM key 缓存(SEC-04):仅存 sessionStorage,关闭标签页即清空。 */
const SESSION_LLM_KEY = "mpp.llm.sessionApiKey";
function setSessionLlmKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(SESSION_LLM_KEY, key);
    else sessionStorage.removeItem(SESSION_LLM_KEY);
  } catch {
    /* sessionStorage 不可用时忽略(SEC-04 降级为仅内存保存) */
  }
}

/** 空观测汇总(AI-ROBUST-03)。 */
function emptyLlmSummary(): LlmTelemetrySummary {
  return {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    successRate: 0,
    avgDurationMs: 0,
    p95DurationMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byTask: {},
  };
}

export const useStore = create<AppState>((set, get) => ({
  markdown: DEFAULT_MD,
  authorName: "效率君",
  tags: ["效率", "时间管理", "科技"],
  selectedPlatforms: [...ALL_PLATFORMS],
  results: [],
  publishing: false,
  receipts: {},
  bridge: null,
  serverUrl: "http://127.0.0.1:8787",
  runnerUrl: "http://127.0.0.1:8790",
  serverToken: "",
  runnerToken: "",
  uploadedAssets: {},
  llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
  llmConfigs: [],
  activeLlmConfigId: null,
  persistLlmKey: false,
  enhance: {},
  wechatPublishMode: "mock",
  automationModes: Object.fromEntries(ALL_PLATFORMS.map((id) => [id, "mock"])) as PlatformAutomationModes,
  accounts: [],
  accountGroups: [],
  inboxMessages: [],
  inboxSyncCursors: {},
  inboxSyncing: false,
  activeAccountId: null,
  accountForPlatform: {},
  drafts: [],
  currentDraftId: null,
  history: [],
  jobs: [],
  activeJobId: null,
  jobAbort: null,
  scheduledTasks: [],
  performanceRecords: [],
  /** v10 FOLLOWUP-NOTIFY:待跟进提醒开关(默认关闭,开启后心跳检查发通知)。 */
  followUpReminderEnabled: false,
  followUpLastRemindedAt: null,
  followUpReminderDigest: null,
  pinnedFollowUpDigest: null,
  pinnedFollowUpEnabled: false,
  pinnedFollowUpLastRemindedAt: null,
  /** v11 深化 GOAL-NOTIFY-01:目标达成提醒开关(默认关闭,开启后心跳 at-risk/off-track 提醒)。 */
  goalReminderEnabled: false,
  goalLastRemindedAt: null,
  goalReminderDigest: null,
  /** v11 深化 REFRESH-TRACK-CLOSED-01:翻新入队自动打标(原版→翻新),供效果回收自动配对。 */
  refreshMarks: [],
  draftIndexes: [],
  weeklyJobs: [],
  weeklyReportPreview: "",
  weeklyGenerating: false,
  localSharedItems: [],
  publishQueue: [],
  publishQueueReady: false,
  publishBatches: [],
  publishBatchReady: false,
  lastBatchCollect: null,
  assetLibrary: [],
  assetLibraryReady: false,
  lastAssetIndex: null,
  versions: [],
  selectedVersionId: null,
  wordGoal: 0,
  typewriterMode: false,
  preflightReport: null,
  preflightComputing: false,
  /** v7 Phase 4 AI-WRITE-01:整篇 AI 写作状态。 */
  docWriteBusy: false,
  docWriteResult: null,
  /** v7 创作工作流:编辑器是否有未保存修改(供离开提示/切换 flush)。 */
  editorDirty: false,

  setBridge: (b) => set({ bridge: b }),
  setMarkdown: (md) => {
    set({ markdown: md, editorDirty: true });
    setSaveStatus("dirty");
    get().adapt();
  },
  setAuthorName: (name) => {
    set({ authorName: name, editorDirty: true });
    setSaveStatus("dirty");
    get().adapt();
  },
  setTags: (tags) => {
    set({ tags, editorDirty: true });
    setSaveStatus("dirty");
    get().adapt();
  },
  setServerUrl: (url) => {
    set({ serverUrl: url });
    void get().bridge?.setSetting("mpp.serverUrl", url);
  },
  setRunnerUrl: (url) => {
    set({ runnerUrl: url });
    void get().bridge?.setSetting("mpp.runnerUrl", url);
  },
  setServerToken: (token) => {
    set({ serverToken: token });
    void get().bridge?.setSetting("mpp.serverToken", token);
  },
  setRunnerToken: (token) => {
    set({ runnerToken: token });
    void get().bridge?.setSetting("mpp.runnerToken", token);
  },
  setLlm: (patch) => {
    const llm = { ...get().llm, ...patch };
    set({ llm });
    // SEC-04:apiKey 默认仅会话保存(sessionStorage,关标签页即清空);
    // 只有用户显式开启“持久化 LLM key”才写入本地存储(localStorage/chrome.storage)。
    const { persistLlmKey } = get();
    const { apiKey, ...rest } = llm;
    void get().bridge?.setSetting("mpp.llm", JSON.stringify(persistLlmKey ? { ...rest, apiKey } : rest));
    setSessionLlmKey(persistLlmKey ? "" : apiKey);
  },
  setPersistLlmKey: (persist) => {
    set({ persistLlmKey: persist });
    void get().bridge?.setSetting("mpp.persistLlmKey", persist ? "1" : "0");
    // 打开持久化:当前会话 key 落盘,并清空会话缓存;
    // 关闭持久化:从磁盘移除 key(仅保留会话内值)。
    const { apiKey, ...rest } = get().llm;
    void get().bridge?.setSetting("mpp.llm", JSON.stringify(persist ? { ...rest, apiKey } : rest));
    setSessionLlmKey(persist ? "" : apiKey);
  },
  clearLlmKey: () => {
    // SEC-04:一键清除——内存、本地持久化与会话缓存全部清空。
    const { apiKey: _removed, ...rest } = get().llm;
    set({ llm: { ...rest, apiKey: "" } });
    void get().bridge?.setSetting("mpp.llm", JSON.stringify(rest));
    void get().bridge?.setSetting("mpp.persistLlmKey", "0");
    setSessionLlmKey("");
    set({ persistLlmKey: false });
  },
  saveLlmConfig: (config) => {
    const existing = config.id ? get().llmConfigs.find((c) => c.id === config.id) : undefined;
    // apiKey 未填时保留已有配置的 key(避免编辑表单时误清)。
    const merged: LlmConfig = normalizeLlmConfig({
      ...config,
      id: config.id ?? (existing?.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
      apiKey: config.apiKey !== undefined ? config.apiKey : (existing?.apiKey ?? ""),
    });
    const list = existing
      ? get().llmConfigs.map((c) => (c.id === merged.id ? merged : c))
      : [...get().llmConfigs, merged];
    set({ llmConfigs: list, activeLlmConfigId: merged.id });
    // 同步到当前 llm(不包含 key 的部分持久化;key 遵循 SEC-04)。
    const { apiKey, ...rest } = merged;
    set({ llm: { baseUrl: rest.baseUrl, apiKey, model: rest.model } });
    void get().bridge?.setSetting("mpp.llmConfigs", JSON.stringify(list.map((c) => stripApiKey(c))));
    void get().bridge?.setSetting("mpp.activeLlmConfigId", merged.id);
    // apiKey 持久化策略:沿用 SEC-04(persistLlmKey 决定是否落盘)。
    void get().bridge?.setSetting("mpp.llm", JSON.stringify(get().persistLlmKey ? { ...rest, apiKey } : rest));
    setSessionLlmKey(get().persistLlmKey ? "" : apiKey);
    return merged.id;
  },
  deleteLlmConfig: (id) => {
    const list = get().llmConfigs.filter((c) => c.id !== id);
    set({ llmConfigs: list });
    void get().bridge?.setSetting("mpp.llmConfigs", JSON.stringify(list.map((c) => stripApiKey(c))));
    if (get().activeLlmConfigId === id) {
      // 删除当前生效配置:回退到默认空配置。
      const { apiKey: _removed, ...rest } = get().llm;
      set({ llm: { ...rest, apiKey: "" }, activeLlmConfigId: null });
      void get().bridge?.setSetting("mpp.llm", JSON.stringify(rest));
      void get().bridge?.setSetting("mpp.activeLlmConfigId", "");
      setSessionLlmKey("");
    }
  },
  activateLlmConfig: (id) => {
    const cfg = get().llmConfigs.find((c) => c.id === id);
    if (!cfg) return;
    set({ activeLlmConfigId: id, llm: { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model } });
    void get().bridge?.setSetting("mpp.activeLlmConfigId", id);
    const { apiKey, ...rest } = cfg;
    void get().bridge?.setSetting("mpp.llm", JSON.stringify(get().persistLlmKey ? { ...rest, apiKey } : rest));
    setSessionLlmKey(get().persistLlmKey ? "" : apiKey);
  },
  applyLlmPreset: (presetId) => {
    const preset = getLlmPreset(presetId);
    if (!preset) return;
    const cfg = configFromPreset(preset);
    const id = get().saveLlmConfig(cfg);
    get().activateLlmConfig(id);
  },
  setEnhance: (patch) => {
    const merged = { ...get().enhance, ...patch };
    set({ enhance: merged });
    void get().bridge?.setSetting("mpp.enhance", JSON.stringify(merged));
  },
  setWechatPublishMode: (mode) => {
    set({ wechatPublishMode: mode });
    void get().bridge?.setSetting("mpp.wechatPublishMode", mode);
  },
  setAutomationMode: (platformId, mode) => {
    const automationModes = { ...get().automationModes, [platformId]: mode };
    set({ automationModes });
    void get().bridge?.setSetting("mpp.automationModes", JSON.stringify(automationModes));
  },

  // -------------------------------------------------------------------
  // ACCOUNT-04 多账号平台管理(v4 Phase 1)
  // -------------------------------------------------------------------
  loadAccounts: async () => {
    try {
      const store = getAccountStore(get().bridge);
      const accounts = await store.list();
      set({ accounts: [...accounts] });
    } catch {
      /* 存储不可用时静默(内存仍可用) */
    }
  },

  saveAccount: async (input) => {
    const store = getAccountStore(get().bridge);
    try {
      const existing = input.id ? await store.get(input.id) : undefined;
      const profile = createAccountProfile({
        ...input,
        id: input.id ?? existing?.id,
        // 未显式更新 secrets 时保留原账号(编辑场景)与会话密钥(避免编辑表单误清)。
        secrets: input.secrets ?? existing?.secrets ?? {},
        persistSecrets: input.persistSecrets ?? existing?.persistSecrets ?? false,
        lastAccountName: input.lastAccountName ?? existing?.lastAccountName,
        lastConnectedAt: input.lastConnectedAt ?? existing?.lastConnectedAt,
      });
      // 单平台上限守卫(避免本地存储无限增长)。
      if (!existing) {
        const byPlatform = get().accounts.filter((a) => a.platformId === profile.platformId).length;
        if (byPlatform >= 20) {
          return { ok: false, error: `单平台最多保存 20 个账号` };
        }
      }
      await store.put(profile);
      const accounts = [...get().accounts.filter((a) => a.id !== profile.id), profile];
      set({ accounts });
      toast(profile.id === (input.id ?? existing?.id) ? "账号已保存" : "账号已创建", "success");
      return { ok: true, id: profile.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  deleteAccount: async (id) => {
    const store = getAccountStore(get().bridge);
    try {
      await store.remove(id);
      const accounts = get().accounts.filter((a) => a.id !== id);
      set({ accounts });
      // 清理选择引用。
      const activeAccountId = get().activeAccountId === id ? null : get().activeAccountId;
      const accountForPlatform = { ...get().accountForPlatform };
      for (const [k, v] of Object.entries(accountForPlatform)) {
        if (v === id) delete accountForPlatform[k];
      }
      set({ activeAccountId, accountForPlatform });
      void get().bridge?.setSetting("mpp.activeAccountId", activeAccountId ?? "");
      void get().bridge?.setSetting("mpp.accountForPlatform", JSON.stringify(accountForPlatform));
      toast("账号已删除", "info");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  setActiveAccount: (id) => {
    set({ activeAccountId: id });
    void get().bridge?.setSetting("mpp.activeAccountId", id ?? "");
  },

  setAccountForPlatform: (platformId, accountId) => {
    const accountForPlatform = { ...get().accountForPlatform };
    if (accountId === null) delete accountForPlatform[platformId];
    else accountForPlatform[platformId] = accountId;
    set({ accountForPlatform });
    void get().bridge?.setSetting("mpp.accountForPlatform", JSON.stringify(accountForPlatform));
  },

  // -------------------------------------------------------------------
  // v11 BRAND-01 账号矩阵分组管理
  // -------------------------------------------------------------------
  loadAccountGroups: async () => {
    try {
      const store = getAccountGroupStore(get().bridge);
      const groups = await store.list();
      set({ accountGroups: [...groups] });
    } catch {
      /* 存储不可用时静默 */
    }
  },

  saveAccountGroup: async (input) => {
    const store = getAccountGroupStore(get().bridge);
    try {
      const existing = input.id ? await store.get(input.id) : undefined;
      const group = createAccountGroup({
        ...input,
        id: input.id ?? existing?.id,
        name: (input.name ?? existing?.name ?? "").trim(),
        memberIds: input.memberIds ?? existing?.memberIds ?? [],
        description: input.description ?? existing?.description,
        color: input.color ?? existing?.color,
      });
      if (!group.name) return { ok: false, error: "分组名不能为空" };
      await store.put(group);
      const groups = [...get().accountGroups.filter((g) => g.id !== group.id), group];
      set({ accountGroups: groups });
      toast(existing ? "分组已保存" : "分组已创建", "success");
      return { ok: true, id: group.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  deleteAccountGroup: async (id) => {
    const store = getAccountGroupStore(get().bridge);
    try {
      await store.remove(id);
      set({ accountGroups: get().accountGroups.filter((g) => g.id !== id) });
      toast("分组已删除", "info");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  setGroupMember: async (groupId, accountId, member) => {
    const store = getAccountGroupStore(get().bridge);
    try {
      const group = await store.get(groupId);
      if (!group) return { ok: false, error: "分组不存在" };
      const next = member ? addMember(group, accountId) : removeMember(group, accountId);
      await store.put(next);
      set({ accountGroups: get().accountGroups.map((g) => (g.id === groupId ? next : g)) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 BRAND-01:拖动排序 —— 把分组重排为目标 id 顺序,落盘新 sortOrder。
  reorderAccountGroups: async (orderedIds) => {
    const store = getAccountGroupStore(get().bridge);
    try {
      const { reorderGroups } = await import("@mpp/core");
      const next = reorderGroups(get().accountGroups, orderedIds);
      for (const g of next) await store.put(g);
      set({ accountGroups: [...next] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // -------------------------------------------------------------------
  // v11 INBOX-01 统一收件箱
  // -------------------------------------------------------------------
  loadInbox: async () => {
    try {
      const store = getInboxStore(get().bridge);
      const messages = await store.list();
      set({ inboxMessages: [...messages] });
    } catch {
      /* 存储不可用时静默 */
    }
  },

  upsertInboxMessage: async (input) => {
    const store = getInboxStore(get().bridge);
    try {
      const existing = input.id ? await store.get(input.id) : undefined;
      const message = createInboxMessage({ ...input, id: input.id ?? existing?.id });
      await store.put(message);
      const all = [...get().inboxMessages.filter((m) => m.id !== message.id), message];
      set({ inboxMessages: all });
      return { ok: true, id: message.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  batchUpdateInboxMessages: async (action, predicate) => {
    const store = getInboxStore(get().bridge);
    try {
      const current = await store.list();
      const next = batchUpdateInbox(current, action, predicate);
      for (const m of next) await store.put(m);
      set({ inboxMessages: [...next] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removeInboxMessage: async (id) => {
    const store = getInboxStore(get().bridge);
    try {
      await store.remove(id);
      set({ inboxMessages: get().inboxMessages.filter((m) => m.id !== id) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 INBOX-01:切换消息置顶(置顶消息在列表中优先展示)。
  toggleInboxPinned: async (id) => {
    const store = getInboxStore(get().bridge);
    try {
      const message = await store.get(id);
      if (!message) return { ok: false, error: "消息不存在" };
      const { togglePinned } = await import("@mpp/core");
      const next = togglePinned(message);
      await store.put(next);
      set({ inboxMessages: get().inboxMessages.map((m) => (m.id === id ? next : m)) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 INBOX-05:拖动排序 —— 把当前视图内消息重排为目标 id 顺序,落盘新 sortOrder。
  reorderInboxMessages: async (orderedIds) => {
    const store = getInboxStore(get().bridge);
    try {
      const { reorderInboxMessages } = await import("@mpp/core");
      const next = reorderInboxMessages(get().inboxMessages, orderedIds);
      for (const m of next) await store.put(m);
      set({ inboxMessages: [...next] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 INBOX-03:设置平台同步游标(增量拉取位置,持久化到本地设置)。
  setInboxSyncCursor: (platformId, cursor) => {
    set({ inboxSyncCursors: { ...get().inboxSyncCursors, [platformId]: cursor } });
    void get().bridge?.setSetting("mpp.inboxSyncCursors", JSON.stringify(get().inboxSyncCursors));
  },

  // v11 INBOX-03:同步真实平台消息(评论/私信等)并合并进收件箱。
  syncInboxFromPlatforms: async (platformIds) => {
    const bridge = get().bridge;
    try {
      set({ inboxSyncing: true });
      const { syncInboxFromPlatform, registerDemoInboxSyncAdapters, getInboxSyncAdapter } = await import("@mpp/core");
      // 未配置本地服务时,用规则版演示适配器闭环跑通(真实平台接入后替换同名注册即可)。
      registerDemoInboxSyncAdapters();
      const store = getInboxStore(bridge);
      const { serverUrl, serverToken, runnerUrl, runnerToken, inboxSyncCursors } = get();
      const results = [];
      for (const platformId of platformIds) {
        const adapter = getInboxSyncAdapter(platformId);
        const cursor = inboxSyncCursors[platformId];
        if (!bridge?.syncInbox && adapter) {
          // 无本地服务桥:走演示/注册适配器(离线闭环)。
          const r = await syncInboxFromPlatform(store, adapter, {
            platformId,
            cursor,
          });
          if (r.ok && r.cursor) get().setInboxSyncCursor(platformId, r.cursor);
          results.push(r);
          continue;
        }
        if (!bridge?.syncInbox) {
          results.push({
            ok: false,
            platformId,
            fetched: 0,
            added: 0,
            skipped: 0,
            at: new Date().toISOString(),
            error: "当前环境不支持平台消息同步(未接入 server/runner)",
          });
          continue;
        }
        // 有本地服务桥:公众号走 server 官方接口,其余平台尝试 runner。
        const isRunner = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"].includes(platformId);
        const baseUrl = isRunner ? runnerUrl : serverUrl;
        const token = isRunner ? runnerToken : serverToken;
        const account = get().accountFor(platformId);
        const result = await bridge.syncInbox({
          baseUrl,
          token,
          platformId,
          ...(cursor ? { cursor } : {}),
          ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
          ...(account?.profileDir ? { accountId: account.profileDir } : {}),
        });
        // server 返回的远端消息(若有)直接合并进本地收件箱。
        if (result.ok && result.items && result.items.length > 0) {
          const adapter2 = getInboxSyncAdapter(platformId) ?? {
            platformId,
            async fetch() {
              return { ok: true, items: result.items ?? [], cursor: result.cursor };
            },
          };
          const merged = await syncInboxFromPlatform(store, adapter2, {
            platformId,
            cursor,
          });
          if (merged.ok && merged.cursor) get().setInboxSyncCursor(platformId, merged.cursor);
          results.push({ ...merged });
          continue;
        }
        if (result.ok && result.cursor) get().setInboxSyncCursor(platformId, result.cursor);
        results.push(result);
      }
      const all = await store.list();
      set({ inboxMessages: [...all] });
      const { summarizeSyncResults } = await import("@mpp/core");
      const summary = summarizeSyncResults(results);
      const errors = summary.errors.length > 0 ? `; ${summary.errors.join("; ")}` : "";
      const message = `已同步 ${results.length} 个平台,新增 ${summary.added} 条,跳过 ${summary.skipped} 条${errors}`;
      if (summary.added > 0) {
        void notify(bridge, "收到新消息", `收件箱同步新增 ${summary.added} 条`, "inbox");
      }
      return { ok: summary.ok, message };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      set({ inboxSyncing: false });
    }
  },

  // -------------------------------------------------------------------
  // v11 INBOX-04 评论真实回发到平台(AI 自动回复 / 人工回复落平台)
  // -------------------------------------------------------------------
  replyInboxMessage: async (message, text) => {
    const bridge = get().bridge;
    if (!bridge?.replyInbox) {
      // 无本地服务桥:降级为本地记录(不真实回发)。
      const { applyAutoReplyResult } = await import("@mpp/core");
      const next = applyAutoReplyResult(message, text.trim());
      await get().upsertInboxMessage({ ...next });
      return { ok: true };
    }
    const { serverUrl, serverToken, runnerUrl, runnerToken } = get();
    const isRunner = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"].includes(message.platformId);
    const baseUrl = isRunner ? runnerUrl : serverUrl;
    const token = isRunner ? runnerToken : serverToken;
    const account = get().accountFor(message.platformId);
    const result = await bridge.replyInbox({
      baseUrl,
      token,
      platformId: message.platformId,
      message,
      text,
      ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
      ...(account?.profileDir ? { profileDir: account.profileDir } : {}),
    });
    if (!result.ok) {
      return { ok: false, error: result.error ?? "回发失败" };
    }
    // 回发成功 → 本地落地(handling=auto-replied,status=replied,reply=text)。
    const { applyAutoReplyResult } = await import("@mpp/core");
    const next = applyAutoReplyResult(message, text.trim());
    await get().upsertInboxMessage({ ...next });
    return { ok: true };
  },

  autoReplyInboxMessages: async (platformId, messages, policy) => {
    const bridge = get().bridge;
    const store = getInboxStore(bridge);
    const candidates = messages ?? (await store.listByPlatform(platformId));
    if (candidates.length === 0) {
      return { ok: true, message: `「${platformId}」收件箱为空,无需自动回复` };
    }
    const resolvedPolicy = policy ?? (await import("@mpp/core")).DEFAULT_AUTO_REPLY_POLICY;
    // 无本地服务桥:用规则版策略本地演示(不回发,仅展示决策)。
    if (!bridge?.autoReplyInbox) {
      const { planAutoReplies } = await import("@mpp/core");
      const planned = planAutoReplies(candidates, resolvedPolicy);
      const updated: import("@mpp/core").InboxMessage[] = [];
      for (const d of planned) {
        if (!d.text) continue;
        const { applyAutoReplyResult } = await import("@mpp/core");
        const next = applyAutoReplyResult(d.message, d.text);
        await store.put(next);
        updated.push(next);
      }
      const all = await store.list();
      set({ inboxMessages: [...all] });
      return {
        ok: true,
        message: `[本地演示] 「${platformId}」 计划回复 ${planned.length} 条(未配置本地服务,未真实回发)`,
      };
    }
    const { serverUrl, serverToken, runnerUrl, runnerToken } = get();
    const isRunner = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"].includes(platformId);
    const baseUrl = isRunner ? runnerUrl : serverUrl;
    const token = isRunner ? runnerToken : serverToken;
    const account = get().accountFor(platformId);
    const result = await bridge.autoReplyInbox({
      baseUrl,
      token,
      platformId,
      messages: candidates,
      limit: resolvedPolicy.limit ?? 20,
      policy: resolvedPolicy,
      ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
    });
    if (!result.ok) {
      return { ok: false, message: result.error ?? `「${platformId}」自动回复失败` };
    }
    // 回发成功 → 本地落地(避免重复回发)。
    const { planAutoReplies, applyAutoReplyResult } = await import("@mpp/core");
    const planned = planAutoReplies(candidates, resolvedPolicy);
    for (const d of planned) {
      if (!d.text) continue;
      const next = applyAutoReplyResult(d.message, d.text);
      await store.put(next);
    }
    const all = await store.list();
    set({ inboxMessages: [...all] });
    const failedText = result.failed.length > 0 ? `; 失败 ${result.failed.length} 条` : "";
    return {
      ok: result.ok,
      message: `「${platformId}」 自动回复:计划 ${result.planned} 条,已回发 ${result.sent} 条${failedText}`,
    };
  },

  accountFor: (platformId) =>
    resolveActiveAccount(
      platformId,
      get().accounts,
      get().accountForPlatform,
      get().activeAccountId,
    ),

  llmReady: () => {
    const { baseUrl, apiKey, model } = get().llm;
    return !!baseUrl && !!apiKey && !!model;
  },
  togglePlatform: (id) => {
    const cur = get().selectedPlatforms;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ selectedPlatforms: next });
    get().adapt();
  },
  insertLocalImage: (dataUrl, alt) => {
    // 以 dataURL 形式追加图片引用,复用 md-to-ir 的图片解析与 rehost 链路。
    const md = `${get().markdown}\n\n![${alt}](${dataUrl})\n`;
    set({ markdown: md });
    get().adapt();
  },

  adapt: () => {
    // 防抖:连续编辑(敲字/改标签/切平台)只在停顿 PREVIEW_DEBOUNCE_MS 后触发一次适配。
    const seq = ++adaptSeq;
    if (adaptTimer) clearTimeout(adaptTimer);
    adaptTimer = setTimeout(() => {
      const { markdown, authorName, tags, selectedPlatforms } = get();
      // PERF-02:预览计算移入 Web Worker(主线程只做防抖 + 序号过滤)。
      getPreviewWorker().post({
        markdown,
        authorName,
        tags,
        canonicalUrl: "https://example.com/post",
        selectedPlatforms,
      });
      void seq; // 序号由 Worker 内部维护(过期请求自动丢弃)。
    }, PREVIEW_DEBOUNCE_MS);
  },

  publishAll: async () => {
    const {
      markdown,
      authorName,
      tags,
      selectedPlatforms,
      bridge,
      serverUrl,
      runnerUrl,
      serverToken,
      runnerToken,
      wechatPublishMode,
      automationModes,
    } = get();
    // busy 状态在 finally 中复位:任何异常都不会留下永久 loading(REL-03)。
    set({ publishing: true, receipts: {} });
    let results: PlatformResult[] = [];
    let publishError: string | undefined;
    try {
      const { document, assetTable } = markdownToIR(markdown, {
        meta: { authorName, tags, canonicalUrl: "https://example.com/post" },
      });

      // 图片重托管:若有 bridge(可连 server),为每个平台构造 RehostContext,
      // 把本地/外链图上传到图床,产物 <img> 指向图床 URL。无 bridge 时跳过(保留原始引用)。
      // PERF-03/04:上传经 UploadCoordinator —— 内容哈希缓存(同图只传一次)
      // + 每平台自适应并发(AIMD) + 429/Retry-After/抖动退避。
      let rehost: Record<string, RehostContext> | undefined;
      if (bridge) {
        const coordinator = new UploadCoordinator({
          uploadAsset: async (bytes, filename, mime) => {
            const result = await bridge.uploadAsset({
              serverUrl,
              token: serverToken || undefined,
              bytes,
              filename,
              mime,
            });
            return result;
          },
        });
        const makeCtx = (platformId: string): RehostContext => ({
          platformId,
          // 动态并发(函数形式:随限流自适应升降,PERF-03)。
          concurrency: () => coordinator.concurrencyFor(platformId),
          upload: coordinator.uploadFor(platformId),
        });
        rehost = Object.fromEntries(selectedPlatforms.map((id) => [id, makeCtx(id)]));
      }

      results = await syncToPlatforms(document, selectedPlatforms, {
        now: () => new Date().toISOString(),
        rehost,
        assetTable,
        ...buildLlmOptions(get()),
      });
      if (bridge && wechatPublishMode !== "mock") {
        const idx = results.findIndex((r) => r.platformId === "wechat");
        const wechat = idx >= 0 ? results[idx] : undefined;
        if (wechat?.artifact && !wechat.report?.hasError) {
          // ACCOUNT-03:公众号多账号 —— 按当前账号的 server profile 引用路由。
          const wechatAccount = get().accountFor("wechat");
          const outcome = await bridge.publishWechat({
            serverUrl,
            token: serverToken || undefined,
            payload: buildWechatPublishPayload(wechat.artifact.payload, assetTable, wechatPublishMode),
            serverProfileId: wechatAccount?.serverProfileId,
          });
          results[idx] = {
            ...wechat,
            ok: outcome.ok,
            receipt: outcome.ok
              ? {
                  platformId: "wechat",
                  status: wechatPublishMode === "publish" ? "submitted" : "staged",
                  message: outcome.message,
                  remoteId: outcome.remoteId,
                  at: new Date().toISOString(),
                }
              : undefined,
            error: outcome.ok ? undefined : outcome.message,
          };
        }
      }
      if (bridge) {
        await Promise.all(
          results.map(async (result, idx) => {
            const mode = automationModes[result.platformId] ?? "mock";
            if (mode !== "draft" && mode !== "full-auto") return;
            if (!result.artifact || result.report?.hasError) return;

            // ACCOUNT-03:会话平台多账号 —— 按当前账号的浏览器登录 profile 路由。
            const account = get().accountFor(result.platformId);
            const outcome = await bridge.publishAutomation({
              runnerUrl,
              token: runnerToken || undefined,
              platformId: result.platformId,
              mode,
              payload: result.artifact.payload,
              profileDir: account?.profileDir,
            });
            results[idx] = {
              ...result,
              ok: outcome.ok,
              receipt: outcome.ok
                ? {
                    platformId: result.platformId,
                    status: outcome.status === "published" ? "submitted" : "staged",
                    message: outcome.message,
                    previewUrl: outcome.remoteUrl,
                    at: new Date().toISOString(),
                  }
                : undefined,
              error: outcome.ok ? undefined : outcome.message,
            };
          }),
        );
      }
    } catch (err) {
      // 结构化错误:任一 bridge 抛错时,分平台呈现,不让整个 UI 卡死。
      publishError = err instanceof Error ? err.message : String(err);
      if (results.length === 0) {
        const { markdown: md, authorName: author, tags: tagList } = get();
        const { document, assetTable } = markdownToIR(md, {
          meta: { authorName: author, tags: tagList, canonicalUrl: "https://example.com/post" },
        });
        // 重新 stage 以获得纯预览结果(发布环节失败不回滚预览)。
        try {
          results = await syncToPlatforms(document, selectedPlatforms, {
            stageOnly: true,
            assetTable,
            now: () => new Date().toISOString(),
          });
        } catch {
          results = [];
        }
      }
    } finally {
      const receipts: Record<string, string> = {};
      for (const r of results) {
        const failNote =
          (r.rehostFailures ?? []).length > 0 ? `(${r.rehostFailures!.length} 张图重托管失败)` : "";
        receipts[r.platformId] = (r.receipt?.message ?? r.error ?? "未发布") + failNote;
      }
      if (publishError && Object.keys(receipts).length === 0) {
        // 全链路失败且无任何平台结果:给出统一错误。
        receipts["_error"] = publishError;
      }
      // busy 状态复位(关键:异常也必须走到这里)。
      set({ results, receipts, publishing: false });
    }

    // 记录发布历史(失败也记,便于排查)。
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      draftTitle: deriveTitle(markdown),
      at: new Date().toISOString(),
      platforms: results.map((r) => ({
        platformId: r.platformId,
        ok: !!r.receipt,
        message: r.receipt?.message ?? r.error ?? "未发布",
      })),
    };
    try {
      await getDraftStore(bridge).addHistory(entry);
      set({ history: [entry, ...get().history].slice(0, 50) });
    } catch {
      /* 历史记录失败不阻断发布 */
    }

    // 发布结果 Toast:成功/部分成功/全失败分平台呈现。
    const okCount = results.filter((r) => r.ok && r.receipt).length;
    if (okCount === results.length && results.length > 0) {
      toast(`已发布 ${results.length} 个平台`, "success");
    } else if (okCount > 0) {
      const failed = results
        .filter((r) => !r.ok || !r.receipt)
        .map((r) => r.platformName)
        .join("、");
      toast(`${okCount}/${results.length} 发布成功;${failed} 未成功`, "info");
    } else if (publishError) {
      toast(`发布失败:${publishError}`, "error");
    }
  },

  loadDrafts: async () => {
    try {
      const store = getDraftStore(get().bridge);
      const [drafts, history] = await Promise.all([store.listDrafts(), store.listHistory()]);
      set({ drafts, history });
    } catch {
      /* 存储不可用时静默(内存仍可用,含 IndexedDB 不可用环境) */
    }
  },

  newDraft: () => {
    set({ markdown: "", currentDraftId: null, results: [], receipts: {}, editorDirty: false });
    setSaveStatus("saved");
    get().adapt();
    return Promise.resolve();
  },

  loadDraft: async (id) => {
    const draft = await getDraftStore(get().bridge).getDraft(id);
    if (!draft) return;
    set({
      markdown: draft.markdown,
      authorName: draft.authorName,
      tags: [...draft.tags],
      currentDraftId: draft.id,
      results: [],
      receipts: {},
      editorDirty: false,
    });
    setSaveStatus("saved");
    get().adapt();
  },

  saveDraft: async () => {
    const { markdown, authorName, tags, currentDraftId } = get();
    const draft: Draft = {
      id: currentDraftId ?? crypto.randomUUID(),
      title: deriveTitle(markdown),
      markdown,
      authorName,
      tags: [...tags],
      updatedAt: new Date().toISOString(),
    };
    setSaveStatus("saving");
    try {
      await getDraftStore(get().bridge).saveDraft(draft);
      const others = get().drafts.filter((d) => d.id !== draft.id);
      set({ currentDraftId: draft.id, drafts: [draft, ...others], editorDirty: false });
      setSaveStatus("saved");
      // 版本历史:保存成功后在后台记录自动快照(静默,失败不阻断保存)。
      // 内容与最新快照一致时不重复写入(避免自动保存心跳产生大量重复版本)。
      try {
        const store = getVersionStore(get().bridge);
        const latestVersions = await store.list(draft.id);
        const latest = latestVersions[0];
        const hasSameContent = !!latest && latest.charCount === [...markdown].length;
        let snapshotId: string | null = null;
        if (!hasSameContent) {
          const snapshot = createSnapshot({
            draftId: draft.id,
            markdown,
            authorName,
            tags: [...tags],
            label: "自动保存",
          });
          await store.put(snapshot);
          snapshotId = snapshot.id;
        }
        // 若当前草稿刚建立(新建),加载其版本时间线。
        if (!currentDraftId || snapshotId) void get().loadVersions();
      } catch {
        /* 版本快照失败不影响草稿保存 */
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveStatus("error", message);
      toast(`自动保存失败:${message}`, "error");
    }
  },

  deleteDraft: async (id) => {
    await getDraftStore(get().bridge).removeDraft(id);
    // 删除草稿时清理其全部版本快照。
    try {
      await getVersionStore(get().bridge).removeAll(id);
    } catch {
      /* 版本清理失败静默 */
    }
    const drafts = get().drafts.filter((d) => d.id !== id);
    const currentDraftId = get().currentDraftId === id ? null : get().currentDraftId;
    set({ drafts, currentDraftId });
    // 若删除的是当前草稿,清空版本时间线。
    if (currentDraftId === null) set({ versions: [], selectedVersionId: null });
  },

  applyBatchAutoCompleteResults: async (items) => {
    const store = getDraftStore(get().bridge);
    let saved = 0;
    try {
      const existing = await store.listDrafts();
      const byId = new Map(existing.map((d) => [d.id, d]));
      const updates: Draft[] = [];
      for (const item of items) {
        const draft = byId.get(item.id);
        if (!draft || draft.markdown === item.markdown) continue;
        const updated: Draft = {
          ...draft,
          markdown: item.markdown,
          title: deriveTitle(item.markdown),
          updatedAt: new Date().toISOString(),
        };
        await store.saveDraft(updated);
        updates.push(updated);
        saved++;
      }
      if (updates.length > 0) {
        // 刷新草稿列表(保持更新时间倒序)。
        const all = await store.listDrafts();
        set({ drafts: all });
      }
      return { ok: true, saved };
    } catch (err) {
      return { ok: false, saved, error: err instanceof Error ? err.message : String(err) };
    }
  },

  exportData: async () => {
    const { bridge, drafts, history, serverUrl, runnerUrl, wechatPublishMode, automationModes, enhance } = get();
    try {
      const data: MppData = {
        drafts: drafts.map((d) => ({ ...d, tags: [...d.tags] })),
        history: history.map((h) => ({ ...h, platforms: [...h.platforms] })),
        settings: {
          serverUrl,
          runnerUrl,
          wechatPublishMode,
          automationModes: { ...automationModes },
          enhance: { ...enhance },
        },
      };
      const raw = serializeExport(data);
      if (bridge?.downloadText) {
        await bridge.downloadText("mpp-data-export.json", raw, "application/json");
      } else {
        // 无 bridge 下载能力时退化为触发浏览器下载。
        const blob = new Blob([raw], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mpp-data-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast("已导出 JSON 数据", "success");
      return { ok: true };
    } catch (err) {
      toast("导出失败", "error");
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  importData: async (raw) => {
    const result = parseImport(raw);
    if (!result.ok) return { ok: false, error: result.error };
    const { drafts, history, settings } = result.data;
    const store = getDraftStore(get().bridge);
    try {
      // 合并写入:已存在 id 的草稿覆盖,新增的追加。
      const existing = await store.listDrafts();
      const existingIds = new Set(existing.map((d) => d.id));
      for (const d of drafts) {
        await store.saveDraft(d);
      }
      for (const h of history) {
        await store.addHistory(h);
      }
      // 应用设置(仅导入非空字段,避免覆盖用户当前偏好)。
      const patch: Partial<AppState> = {};
      if (settings?.serverUrl) patch.serverUrl = settings.serverUrl;
      if (settings?.runnerUrl) patch.runnerUrl = settings.runnerUrl;
      if (settings?.wechatPublishMode === "mock" || settings?.wechatPublishMode === "draft" || settings?.wechatPublishMode === "publish") {
        patch.wechatPublishMode = settings.wechatPublishMode;
      }
      if (settings?.automationModes) {
        const merged: Record<string, AutomationPublishMode> = { ...get().automationModes };
        for (const [k, v] of Object.entries(settings.automationModes)) {
          if (isAutomationPublishMode(v)) merged[k] = v;
        }
        patch.automationModes = merged;
      }
      if (settings?.enhance) {
        patch.enhance = { ...get().enhance, ...settings.enhance };
      }
      // 重新加载草稿列表(包含合并结果)。
      const [newDrafts, newHistory] = await Promise.all([store.listDrafts(), store.listHistory()]);
      patch.drafts = newDrafts;
      patch.history = newHistory;
      const importedCount = drafts.filter((d) => !existingIds.has(d.id)).length;
      set(patch);
      // 持久化设置到 bridge。
      void get().bridge?.setSetting("mpp.serverUrl", patch.serverUrl ?? "");
      void get().bridge?.setSetting("mpp.runnerUrl", patch.runnerUrl ?? "");
      void get().bridge?.setSetting("mpp.wechatPublishMode", patch.wechatPublishMode ?? "");
      void get().bridge?.setSetting("mpp.automationModes", JSON.stringify(patch.automationModes ?? {}));
      void get().bridge?.setSetting("mpp.enhance", JSON.stringify(patch.enhance ?? {}));
      toast(`导入完成:${importedCount} 条草稿 / ${history.length} 条历史`, "success");
      return { ok: true, counts: { drafts: importedCount, history: history.length } };
    } catch (err) {
      toast("导入失败", "error");
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  loadJobs: async () => {
    try {
      const service = getJobService(get().bridge);
      const jobs = await service.list();
      set({ jobs });
      await getJobStore(get().bridge).prune();
    } catch {
      /* 存储不可用时静默 */
    }
  },

  createPublishJob: async () => {
    const { markdown, authorName, tags, selectedPlatforms } = get();
    if (selectedPlatforms.length === 0) throw new Error("请至少选择一个平台");
    return (
      (await get().createPublishJobFromDraft({ markdown, authorName, tags }, selectedPlatforms)) ??
      ""
    );
  },

  createPublishJobFromDraft: async (draft, platformIds, accountRefs) => {
    const {
      bridge,
      serverUrl,
      runnerUrl,
      serverToken,
      runnerToken,
      wechatPublishMode,
      automationModes,
    } = get();
    const selectedPlatforms = platformIds && platformIds.length > 0 ? [...platformIds] : get().selectedPlatforms;
    const { markdown, authorName, tags } = draft;
    if (selectedPlatforms.length === 0) throw new Error("请至少选择一个平台");

    // ROADMAP_V5 Phase 1:解析队列锁定的账号引用(platformId → {serverProfileId, profileDir})。
    const refByPlatform = new Map<string, QueueAccountRef>();
    for (const ref of accountRefs ?? []) {
      refByPlatform.set(ref.platformId, ref);
    }

    const service = getJobService(bridge);
    const { document, assetTable } = markdownToIR(markdown, {
      meta: { authorName, tags, canonicalUrl: "https://example.com/post" },
    });
    // 先 stage 出各平台产物(真实发布前的暂存/校验)。
    const results = await syncToPlatforms(document, selectedPlatforms, {
      stageOnly: true,
      assetTable,
      now: () => new Date().toISOString(),
    });

    // 内容摘要(SHA-256,客户端不信任外部 key)。
    const first = results[0]?.artifact?.payload;
    const digest = first
      ? await contentHashOfPayload(first, false)
      : `digest-${Date.now()}`;

    const job = await service.create({
      contentDigest: digest,
      platforms: selectedPlatforms,
    });

    // 为每个平台注册执行器(真实发布路径)。
    for (const result of results) {
      const payload = result.artifact?.payload;
      if (!payload) continue;
      const mode =
        result.platformId === "wechat" ? wechatPublishMode : (automationModes[result.platformId] ?? "mock");
      const executor: PlatformExecutor = {
        async prepare(p) {
          return { payload: p };
        },
        async upload(_assets, signal) {
          if (signal?.aborted) throw new Error("已取消");
          return [];
        },
        async submit(p, signal) {
          if (signal?.aborted) throw new Error("已取消");
          if (!bridge) throw new Error("无 bridge");
          if (mode === "mock" || mode === "assist") {
            return {
              platformId: result.platformId,
              status: "staged" as const,
              message: `${result.platformId} 已生成暂存产物(模拟发布)`,
              at: new Date().toISOString(),
            };
          }
          if (result.platformId === "wechat") {
            // ACCOUNT-03:公众号多账号 —— 按当前账号的 server profile 引用路由。
            // ROADMAP_V5 Phase 1:队列锁定的账号引用优先(排队期间切换账号不影响到点发布)。
            const wechatRef = refByPlatform.get("wechat");
            const wechatAccount = wechatRef?.serverProfileId
              ? { serverProfileId: wechatRef.serverProfileId }
              : get().accountFor("wechat");
            const outcome = await bridge.publishWechat({
              serverUrl,
              token: serverToken || undefined,
              payload: buildWechatPublishPayload(p, assetTable, wechatPublishMode),
              serverProfileId: wechatAccount?.serverProfileId,
            });
            return {
              platformId: "wechat",
              status: wechatPublishMode === "publish" ? "submitted" : "staged",
              message: outcome.message,
              remoteId: outcome.remoteId,
              at: new Date().toISOString(),
            };
          }
          // ACCOUNT-03:会话平台多账号 —— 按当前账号的浏览器登录 profile 路由。
          // ROADMAP_V5 Phase 1:队列锁定的账号引用优先。
          const ref = refByPlatform.get(result.platformId);
          const account = ref?.profileDir
            ? { profileDir: ref.profileDir }
            : get().accountFor(result.platformId);
          const outcome = await bridge.publishAutomation({
            runnerUrl,
            token: runnerToken || undefined,
            platformId: result.platformId,
            mode: mode as Exclude<AutomationPublishMode, "mock" | "assist">,
            payload: p,
            contentDigest: digest,
            // full-auto 二次确认:web 环境用户点击任务面板确认后置 true(RUN-01)。
            confirmed: mode === "full-auto",
            profileDir: account?.profileDir,
          });
          return {
            platformId: result.platformId,
            status: outcome.status === "published" ? "published" : outcome.status === "drafted" ? "staged" : outcome.status,
            message: outcome.message,
            remoteId: outcome.remoteId,
            remoteUrl: outcome.remoteUrl,
            at: new Date().toISOString(),
          };
        },
        async verify(_p, receipt) {
          return receipt;
        },
      };
      service.registerExecutor(result.platformId, executor);
    }

    // 运行任务(取消贯穿)。
    const abort = new AbortController();
    set({ activeJobId: job.id, jobAbort: abort, jobs: [job, ...get().jobs] });
    void service
      .run(job.id, abort.signal)
      .then((done) => {
        set({
          jobs: [done, ...get().jobs.filter((j) => j.id !== done.id)],
          activeJobId: null,
          jobAbort: null,
        });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        set({
          activeJobId: null,
          jobAbort: null,
          jobs: get().jobs.map((j) =>
            j.id === job.id ? { ...j, stage: "failed", error: message } : j,
          ),
        });
      });

    return job.id;
  },

  retryJobPlatform: async (jobId, platformId) => {
    const service = getJobService(get().bridge);
    const job = await service.retryPlatform(jobId, platformId);
    set({ jobs: get().jobs.map((j) => (j.id === jobId ? job : j)) });
    // 重试后立即运行该平台(在后台执行)。
    const abort = new AbortController();
    set({ activeJobId: jobId, jobAbort: abort });
    void service
      .run(jobId, abort.signal)
      .then((done) => {
        set({ jobs: get().jobs.map((j) => (j.id === jobId ? done : j)), activeJobId: null, jobAbort: null });
      })
      .catch(() => {
        set({ activeJobId: null, jobAbort: null });
      });
  },

  cancelJob: async (jobId) => {
    const service = getJobService(get().bridge);
    // 先触发 abort,再标记取消。
    get().jobAbort?.abort();
    const job = await service.cancel(jobId, "用户取消");
    set({ jobs: get().jobs.map((j) => (j.id === jobId ? job : j)), activeJobId: null, jobAbort: null });
  },

  // -------------------------------------------------------------------
  // FLOW-03 本机计划任务
  // -------------------------------------------------------------------
  loadScheduledTasks: async () => {
    try {
      const service = getScheduleService(get().bridge);
      const tasks = await service.list();
      set({ scheduledTasks: [...tasks] });
    } catch {
      /* 存储不可用时静默 */
    }
  },

  // FLOW-03 心跳:检查并执行所有到期计划任务,完成后刷新列表(运行记录会更新)。
  runDueScheduledTasks: async () => {
    const service = getScheduleService(get().bridge);
    try {
      await service.runDue();
      const tasks = await service.list();
      set({ scheduledTasks: [...tasks] });
    } catch {
      /* 心跳失败静默,下一拍重试 */
    }
  },

  createScheduledTask: async ({ name, cron, actionKind, platformIds, draftId, weeklyJobId, autoReplyPolicy }) => {
    const service = getScheduleService(get().bridge);
    try {
      const task = await service.create({
        name,
        cron,
        action:
          actionKind === "inbox-auto-reply"
            ? { kind: "inbox-auto-reply", ...(autoReplyPolicy ? { policy: autoReplyPolicy } : {}) }
            : { kind: actionKind },
        platformIds,
        draftId,
        ...(actionKind === "weekly-report" && weeklyJobId
          ? { weeklyReport: { weeklyJobId } }
          : {}),
      });
      set({ scheduledTasks: [task, ...get().scheduledTasks] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  triggerScheduledTask: async (id) => {
    const service = getScheduleService(get().bridge);
    try {
      const result = await service.trigger(id);
      const tasks = await service.list();
      set({ scheduledTasks: [...tasks] });
      void result;
    } catch {
      /* 触发失败静默(UI 在面板展示) */
    }
  },

  setScheduledTaskStatus: async (id, status) => {
    const service = getScheduleService(get().bridge);
    try {
      const task =
        status === "paused" ? await service.pause(id) : await service.resume(id);
      set({ scheduledTasks: get().scheduledTasks.map((t) => (t.id === id ? task : t)) });
    } catch {
      /* 状态切换失败静默 */
    }
  },

  // CAL-03:更新计划任务(日历拖拽改期 / 改名等)。
  updateScheduledTask: async (id, patch) => {
    const service = getScheduleService(get().bridge);
    try {
      const task = await service.update(id, patch);
      set({ scheduledTasks: get().scheduledTasks.map((t) => (t.id === id ? task : t)) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removeScheduledTask: async (id) => {
    const service = getScheduleService(get().bridge);
    try {
      await service.remove(id);
      set({ scheduledTasks: get().scheduledTasks.filter((t) => t.id !== id) });
    } catch {
      /* 删除失败静默 */
    }
  },

  // -------------------------------------------------------------------
  // ROADMAP_V5 Phase 1 · 发布队列与定时发布
  // -------------------------------------------------------------------
  loadPublishQueue: async () => {
    try {
      const service = getPublishQueueService(get().bridge);
      const entries = await service.list();
      set({ publishQueue: [...entries], publishQueueReady: true });
      await service.prune();
    } catch {
      /* 存储不可用时静默 */
    }
  },

  enqueuePublish: async ({ name, draftId, platformIds, scheduledAt, realPublish }) => {
    const service = getPublishQueueService(get().bridge);
    try {
      const targetDraftId = draftId ?? get().currentDraftId;
      if (!targetDraftId && !get().markdown.trim()) {
        return { ok: false, error: "请先编写内容并保存草稿" };
      }
      if (!targetDraftId) {
        // 当前编辑内容尚未落库:先保存再排队。
        await get().saveDraft();
      }
      const finalDraftId = draftId ?? get().currentDraftId;
      if (!finalDraftId) return { ok: false, error: "请先保存草稿" };
      const platforms = platformIds && platformIds.length > 0 ? [...platformIds] : get().selectedPlatforms;
      if (platforms.length === 0) return { ok: false, error: "请至少选择一个平台" };
      if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
        return { ok: false, error: "发布时间格式无效" };
      }
      // 排队时锁定当前账号引用(到点按此账号发布,而非当时当前账号)。
      const accountRefs: QueueAccountRef[] = platforms.map((pid) => {
        const account = get().accountFor(pid);
        return {
          platformId: pid,
          ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
          ...(account?.profileDir ? { profileDir: account.profileDir } : {}),
        };
      });
      const draft = get().drafts.find((d) => d.id === finalDraftId);
      const entry = await service.enqueue({
        name: name ?? draft?.title ?? "待发布",
        draftId: finalDraftId,
        platformIds: platforms,
        scheduledAt,
        accountRefs,
        realPublish: realPublish ?? true,
      });
      set({ publishQueue: [entry, ...get().publishQueue.filter((e) => e.id !== entry.id)] });
      toast(`已排入发布队列,预计 ${new Date(entry.scheduledAt).toLocaleString()} 发布`, "success");
      return { ok: true, id: entry.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 深化 STRATEGY-ADOPT-01:策略动作一键采纳到发布队列。
  // 把策略步骤(平台 + 时段)直接排入发布队列:默认用当前草稿,时间取「下次该时段」。
  adoptStrategyToQueue: async (input: {
    title?: string;
    platformIds?: string[];
    hour?: number | null;
    draftId?: string;
  }) => {
    try {
      const { strategyHourToScheduledAt } = await import("@mpp/core");
      // 该 action 直接从已解析的策略步骤调用,这里由调用方传入已解析的 platform/hour。
      const platforms =
        input.platformIds && input.platformIds.length > 0
          ? [...input.platformIds]
          : get().selectedPlatforms;
      if (platforms.length === 0) return { ok: false, error: "请至少选择一个平台" };
      const scheduledAt = strategyHourToScheduledAt(input.hour ?? 12, { now: () => new Date().toISOString() });
      const result = await get().enqueuePublish({
        name: input.title,
        draftId: input.draftId,
        platformIds: platforms,
        scheduledAt,
        realPublish: true,
      });
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // ROADMAP_V5 Phase 4:批量 AI 完成后一键把多篇结果排入发布队列。
  enqueuePublishBatch: async ({ items }) => {
    const service = getPublishQueueService(get().bridge);
    let enqueued = 0;
    try {
      for (const item of items) {
        if (!item.scheduledAt || Number.isNaN(Date.parse(item.scheduledAt))) {
          return { ok: false, enqueued, error: "发布时间格式无效" };
        }
        // 未关联草稿(当前编辑内容):先保存再排队。
        let targetDraftId = item.draftId;
        if (!targetDraftId) {
          if (!get().markdown.trim()) return { ok: false, enqueued, error: "当前编辑内容为空,无法排队" };
          await get().saveDraft();
          targetDraftId = get().currentDraftId ?? undefined;
        }
        if (!targetDraftId) return { ok: false, enqueued, error: "请先保存草稿再排队" };
        const platforms =
          item.platformIds && item.platformIds.length > 0 ? [...item.platformIds] : get().selectedPlatforms;
        if (platforms.length === 0) return { ok: false, enqueued, error: "请至少选择一个平台" };
        const accountRefs: QueueAccountRef[] = platforms.map((pid) => {
          const account = get().accountFor(pid);
          return {
            platformId: pid,
            ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
            ...(account?.profileDir ? { profileDir: account.profileDir } : {}),
          };
        });
        const draft = get().drafts.find((d) => d.id === targetDraftId);
        const entry = await service.enqueue({
          name: item.name ?? draft?.title ?? "AI 批量排队",
          draftId: targetDraftId,
          platformIds: platforms,
          scheduledAt: item.scheduledAt,
          accountRefs,
          realPublish: item.realPublish ?? true,
        });
        set({ publishQueue: [entry, ...get().publishQueue.filter((e) => e.id !== entry.id)] });
        enqueued++;
      }
      if (enqueued > 0) {
        toast(`已将 ${enqueued} 篇 AI 结果排入发布队列`, "success");
      }
      return { ok: true, enqueued };
    } catch (err) {
      return { ok: false, enqueued, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v10 REFRESH-QUEUE-01:老化内容批量翻新入队(生成翻新草稿 + 直接排队)。
  refreshAndEnqueue: async ({ agingItems, platformIds, scheduledAt }) => {
    try {
      if (!agingItems || agingItems.length === 0) {
        return { ok: false, planned: 0, enqueued: 0, error: "没有可翻新的老化内容" };
      }
      const platforms =
        platformIds && platformIds.length > 0 ? [...platformIds] : get().selectedPlatforms;
      if (platforms.length === 0) {
        return { ok: false, planned: 0, enqueued: 0, error: "请至少选择一个平台" };
      }
      const { planRefreshQueue, refreshableAgingItems } = await import("@mpp/core");
      const refreshItems = refreshableAgingItems(agingItems);
      if (refreshItems.length === 0) {
        return { ok: false, planned: 0, enqueued: 0, error: "所选老化内容中没有可翻新的条目" };
      }
      // 按标题/草稿 id 查找原文(跨平台聚合条目 draftId 可能为空)。
      const drafts = get().drafts;
      const lookup = (draftId: string | undefined, title: string) => {
        const hit =
          drafts.find((d) => d.id === draftId) ??
          drafts.find((d) => d.title === title);
        return hit ? { title: hit.title, markdown: hit.markdown } : undefined;
      };
      const plan = planRefreshQueue(refreshItems, lookup, {
        performanceRecords: get().performanceRecords,
        defaultPlatformIds: platforms,
        defaultScheduledAt: scheduledAt,
      });
      if (plan.planned === 0) {
        return { ok: false, planned: 0, enqueued: 0, error: plan.summary };
      }
      // 逐个落地:保存翻新草稿 + 排入发布队列。
      const service = getPublishQueueService(get().bridge);
      const draftStore = getDraftStore(get().bridge);
      let enqueued = 0;
      const errors: string[] = [];
      for (const item of plan.items) {
        try {
          const draft: Draft = {
            id: crypto.randomUUID(),
            title: item.refreshed.title,
            markdown: item.refreshed.markdown,
            authorName: get().authorName,
            tags: [],
            updatedAt: new Date().toISOString(),
          };
          await draftStore.saveDraft(draft);
          const accountRefs: QueueAccountRef[] = platforms.map((pid) => {
            const account = get().accountFor(pid);
            return {
              platformId: pid,
              ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
              ...(account?.profileDir ? { profileDir: account.profileDir } : {}),
            };
          });
          const entry = await service.enqueue({
            name: item.refreshed.title,
            draftId: draft.id,
            platformIds: platforms,
            scheduledAt: item.queueInput.scheduledAt,
            accountRefs,
            realPublish: true,
          });
          // v11 深化 REFRESH-TRACK-CLOSED-01:翻新入队后自动打标(原版→翻新),供效果回收自动配对。
          if (item.refreshMark) {
            const existing = get().refreshMarks;
            const merged = [item.refreshMark, ...existing.filter(
              (m) => !(m.originalTitle === item.refreshMark!.originalTitle && m.refreshedTitle === item.refreshMark!.refreshedTitle),
            )].slice(0, 200);
            set({ refreshMarks: merged });
            // 持久化到本地设置(效果回收可能发生在重启之后,保证闭环跨会话)。
            try {
              void get().bridge?.setSetting("mpp.refreshMarks", JSON.stringify(merged));
            } catch {
              /* 持久化失败不阻断翻新入队 */
            }
          }
          set({
            drafts: [draft, ...get().drafts.filter((d) => d.id !== draft.id)],
            publishQueue: [entry, ...get().publishQueue.filter((e) => e.id !== entry.id)],
          });
          enqueued++;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (enqueued === 0) {
        return { ok: false, planned: plan.planned, enqueued, error: errors[0] ?? "全部翻新入队失败" };
      }
      toast(
        `已翻新 ${enqueued} 篇并排入发布队列${errors.length > 0 ? `,${errors.length} 篇失败` : ""}`,
        enqueued > 0 ? "success" : "error",
      );
      return { ok: true, planned: plan.planned, enqueued };
    } catch (err) {
      return { ok: false, planned: 0, enqueued: 0, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // 心跳:检查并执行所有到点条目(与 FLOW-03 心跳并列)。
  runDuePublishQueue: async () => {
    const service = getPublishQueueService(get().bridge);
    try {
      const results = await service.runDue();
      if (results.length > 0) {
        const entries = await service.list();
        set({ publishQueue: [...entries] });
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) {
          toast(`${failed.length} 条排队发布执行失败,详见发布队列面板`, "error");
          void notify(get().bridge, "排队发布失败", `${failed.length} 条排队发布执行失败,请打开发布队列查看`, "publish-queue");
        } else {
          toast(`${results.length} 条排队发布已触发`, "info");
          void notify(get().bridge, "排队发布已触发", `${results.length} 条排队发布已到点触发,详见发布队列面板`, "publish-queue");
        }
      }
    } catch {
      /* 心跳失败静默,下一拍重试 */
    }
  },

  triggerPublishQueue: async (id) => {
    const service = getPublishQueueService(get().bridge);
    try {
      const result = await service.trigger(id);
      const entries = await service.list();
      set({ publishQueue: [...entries] });
      if (!result.ok) {
        return { ok: false, error: result.error ?? "执行失败" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  reschedulePublishQueue: async (id, scheduledAt) => {
    const service = getPublishQueueService(get().bridge);
    try {
      if (Number.isNaN(Date.parse(scheduledAt))) return { ok: false, error: "发布时间格式无效" };
      const entry = await service.reschedule(id, scheduledAt);
      set({ publishQueue: get().publishQueue.map((e) => (e.id === id ? entry : e)) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  cancelPublishQueue: async (id) => {
    const service = getPublishQueueService(get().bridge);
    try {
      const entry = await service.cancel(id);
      set({ publishQueue: get().publishQueue.map((e) => (e.id === id ? entry : e)) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removePublishQueue: async (id) => {
    const service = getPublishQueueService(get().bridge);
    try {
      await service.remove(id);
      set({ publishQueue: get().publishQueue.filter((e) => e.id !== id) });
    } catch {
      /* 删除失败静默 */
    }
  },

  // ROADMAP_V5 Phase 1:拖动排序 —— 把队列重排为目标 id 顺序,落盘新 sortOrder。
  reorderPublishQueue: async (orderedIds) => {
    const service = getPublishQueueService(get().bridge);
    try {
      const { reorderQueueEntries } = await import("@mpp/core");
      const current = await service.list();
      const next = reorderQueueEntries(current, orderedIds);
      for (const e of next) await getPublishQueueStore(get().bridge).put(e);
      set({ publishQueue: [...next] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // -------------------------------------------------------------------
  // ROADMAP_V5 Phase 2 · 发布批次与批量复盘(BATCH-01/02/03)
  // -------------------------------------------------------------------
  loadPublishBatches: async () => {
    try {
      const service = getPublishBatchService(get().bridge);
      const batches = await service.list();
      set({ publishBatches: [...batches], publishBatchReady: true });
      await service.prune();
    } catch {
      /* 存储不可用时静默 */
    }
  },

  createPublishBatch: async ({ name, items, scheduledAt, realPublish }) => {
    const service = getPublishBatchService(get().bridge);
    try {
      if (!items || items.length === 0) return { ok: false, error: "请至少选择一篇草稿" };
      if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
        return { ok: false, error: "发布时间格式无效" };
      }
      // 排队时锁定当前账号引用(到点按此账号发布,而非当时当前账号)。
      const refs: QueueAccountRef[] = get().selectedPlatforms.map((pid) => {
        const account = get().accountFor(pid);
        return {
          platformId: pid,
          ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
          ...(account?.profileDir ? { profileDir: account.profileDir } : {}),
        };
      });
      const batch = await service.create({
        name,
        scheduledAt,
        accountRefs: refs,
        realPublish: realPublish ?? true,
        items: items.map((item) => {
          const draft = get().drafts.find((d) => d.id === item.draftId);
          return {
            draftId: item.draftId,
            draftTitle: item.draftTitle ?? draft?.title,
            platformIds: item.platformIds && item.platformIds.length > 0 ? item.platformIds : get().selectedPlatforms,
            scheduledAt: item.scheduledAt,
            realPublish: item.realPublish ?? realPublish ?? true,
          };
        }),
      });
      set({ publishBatches: [batch, ...get().publishBatches] });
      toast(`已创建发布批次「${batch.name}」(${batch.items.length} 篇)`, "success");
      return { ok: true, id: batch.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // 心跳:检查并执行批次内所有到点条目(与发布队列心跳并列)。
  runDuePublishBatches: async () => {
    const service = getPublishBatchService(get().bridge);
    try {
      const results = await service.runDue();
      if (results.length > 0) {
        const batches = await service.list();
        set({ publishBatches: [...batches] });
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) {
          toast(`${failed.length} 篇批次发布失败,详见发布批次面板`, "error");
          void notify(get().bridge, "批次发布失败", `${failed.length} 篇批次发布失败,请打开发布批次面板查看`, "publish-batch");
        } else {
          toast(`${results.length} 篇批次发布已触发`, "info");
          void notify(get().bridge, "批次发布已触发", `${results.length} 篇批次发布已到点触发,详见发布批次面板`, "publish-batch");
        }
      }
    } catch {
      /* 心跳失败静默,下一拍重试 */
    }
  },

  triggerPublishBatchItem: async (batchId, itemId) => {
    const service = getPublishBatchService(get().bridge);
    try {
      const result = await service.triggerItem(batchId, itemId);
      const batches = await service.list();
      set({ publishBatches: [...batches] });
      if (!result.ok) return { ok: false, error: result.error ?? "执行失败" };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v6 CAL-04:日历拖拽改期批次条目。
  reschedulePublishBatchItem: async (batchId, itemId, scheduledAt) => {
    const service = getPublishBatchService(get().bridge);
    try {
      const batch = await service.rescheduleItem(batchId, itemId, scheduledAt);
      set({ publishBatches: get().publishBatches.map((b) => (b.id === batchId ? batch : b)) });
      toast("已改期批次条目,详见发布批次面板", "success");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v6 Phase 2:批次整体改期(发布批次面板/日历批量操作共用)。
  reschedulePublishBatchAll: async (batchId, scheduledAt) => {
    const service = getPublishBatchService(get().bridge);
    try {
      const { batch, rescheduled, skipped } = await service.rescheduleAll(batchId, scheduledAt);
      set({ publishBatches: get().publishBatches.map((b) => (b.id === batchId ? batch : b)) });
      toast(`已整体改期批次(${rescheduled} 篇,${skipped} 篇已终态未改)`, "success");
      return { ok: true, rescheduled, skipped };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  retryPublishBatchFailed: async (batchId) => {
    const service = getPublishBatchService(get().bridge);
    try {
      const results = await service.retryFailed(batchId);
      const batches = await service.list();
      set({ publishBatches: [...batches] });
      return { ok: true, retried: results.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), retried: 0 };
    }
  },

  cancelPublishBatch: async (batchId) => {
    const service = getPublishBatchService(get().bridge);
    try {
      await service.cancel(batchId, "用户取消");
      const batches = await service.list();
      set({ publishBatches: [...batches] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removePublishBatch: async (batchId) => {
    const service = getPublishBatchService(get().bridge);
    try {
      await service.remove(batchId);
      set({ publishBatches: get().publishBatches.filter((b) => b.id !== batchId) });
    } catch {
      /* 删除失败静默 */
    }
  },

  // -------------------------------------------------------------------
  // ROADMAP_V5 Phase 3 · 内容资产库(封面/图床/平台产物/草稿快照)
  // -------------------------------------------------------------------
  loadAssetLibrary: async () => {
    try {
      const store = getAssetLibraryStore(get().bridge);
      const records = await store.list();
      set({ assetLibrary: [...records], assetLibraryReady: true });
    } catch {
      set({ assetLibrary: [], assetLibraryReady: false });
    }
  },

  rebuildAssetIndex: async () => {
    const store = getAssetLibraryStore(get().bridge);
    try {
      const bridge = get().bridge;
      const { drafts, publishQueue, publishBatches } = get();
      // 增量构建:草稿 → 封面/图床;队列 → 待发布产物;批次 → 已发布产物(含回执 URL)。
      const result = await buildAssetLibraryIndex(
        {
          list: () => store.list(),
          putMany: (records) => store.putMany(records),
          remove: (id) => store.remove(id),
        },
        drafts.map((d) => ({ id: d.id, title: d.title, markdown: d.markdown })),
        publishQueue,
        publishBatches,
      );
      // 清理超限终态来源记录。
      await pruneAssetLibrary(
        {
          list: () => store.list(),
          putMany: (records) => store.putMany(records),
          remove: (id) => store.remove(id),
        },
        new Date(),
      );
      void bridge;
      set({ lastAssetIndex: result });
      await get().loadAssetLibrary();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  searchAssets: (query, kind) => {
    // 空查询:返回全部(可按类型过滤);非空走本地相关性检索。
    if (!query.trim()) {
      const records = kind ? get().assetLibrary.filter((r) => r.kind === kind) : get().assetLibrary;
      return records.map((record) => ({ record, score: 1 }));
    }
    const hits = searchAssetLibrary(get().assetLibrary, query, { kind });
    return hits.map((h) => ({ record: h.record, score: h.score }));
  },

  addAsset: async ({ kind, title, platformId, reference, bytes, mime }) => {
    const store = getAssetLibraryStore(get().bridge);
    try {
      const { buildAssetRecord } = await import("@mpp/core");
      const record = buildAssetRecord({
        kind,
        title,
        platformId,
        reference,
        bytes,
        mime,
        source: { from: "manual" },
      });
      await store.put(record);
      set({ assetLibrary: [record, ...get().assetLibrary.filter((r) => r.id !== record.id)] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removeAsset: async (id) => {
    const store = getAssetLibraryStore(get().bridge);
    try {
      await store.remove(id);
      set({ assetLibrary: get().assetLibrary.filter((r) => r.id !== id) });
    } catch {
      /* 删除失败静默 */
    }
  },

  collectBatchMetrics: async (batchId) => {
    const service = getPublishBatchService(get().bridge);
    try {
      const store = getPerformanceStore(get().bridge);
      const result = await service.collectMetrics(batchId, store);
      const all = await store.list();
      set({ performanceRecords: [...all], lastBatchCollect: { batchId, imported: result.imported, skipped: result.skipped } });
      return { ok: true, imported: result.imported, skipped: result.skipped };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastBatchCollect: { batchId, imported: 0, skipped: 0, error: message } });
      return { ok: false, error: message };
    }
  },

  // -------------------------------------------------------------------
  // WEEKLY-01/02 内容智能周报自动化(v4 Phase 2)
  // -------------------------------------------------------------------
  loadWeeklyJobs: async () => {
    try {
      const service = getWeeklyService(get().bridge);
      const jobs = await service.list();
      set({ weeklyJobs: [...jobs] });
    } catch {
      /* 存储不可用时静默 */
    }
  },

  createWeeklyJob: async ({ name, template, windowDays, deliveries, useLlm }) => {
    const service = getWeeklyService(get().bridge);
    try {
      const job = await service.create({
        name,
        template,
        windowDays,
        deliveries: deliveries ?? [],
        useLlm: useLlm ?? true,
      });
      set({ weeklyJobs: [job, ...get().weeklyJobs] });
      return { ok: true, id: job.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  updateWeeklyJob: async (id, patch) => {
    const service = getWeeklyService(get().bridge);
    try {
      const job = await service.update(id, patch);
      set({ weeklyJobs: get().weeklyJobs.map((j) => (j.id === id ? job : j)) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  setWeeklyJobStatus: async (id, status) => {
    const service = getWeeklyService(get().bridge);
    try {
      const job = status === "paused" ? await service.pause(id) : await service.resume(id);
      set({ weeklyJobs: get().weeklyJobs.map((j) => (j.id === id ? job : j)) });
    } catch {
      /* 状态切换失败静默 */
    }
  },

  removeWeeklyJob: async (id) => {
    const service = getWeeklyService(get().bridge);
    try {
      await service.remove(id);
      set({ weeklyJobs: get().weeklyJobs.filter((j) => j.id !== id) });
    } catch {
      /* 删除失败静默 */
    }
  },

  generateWeeklyReport: async (id) => {
    const service = getWeeklyService(get().bridge);
    set({ weeklyGenerating: true });
    try {
      // 动态注入 LLM(每次生成时读取当前生效配置)。
      service.updateLlm(buildLlmAdapter(useStore.getState()));
      const run = await service.generate(id);
      const jobs = await service.list();
      set({ weeklyJobs: [...jobs], weeklyGenerating: false });
      if (run.outcome !== "succeeded") {
        return { ok: false, error: run.error ?? "周报生成未成功" };
      }
      // 用与任务一致的窗口重新渲染报告正文(供面板预览/导出)。
      const job = jobs.find((j) => j.id === id);
      const report = buildWeeklyReport({
        records: useStore.getState().performanceRecords,
        template: job?.template ?? "weekly",
        windowDays: job?.windowDays ?? 7,
      });
      set({ weeklyReportPreview: report });
      return { ok: true, report };
    } catch (err) {
      set({ weeklyGenerating: false });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  previewWeeklyReport: async (template = "weekly", windowDays = 7) => {
    const state = useStore.getState();
    const llm = buildLlmAdapter(state);
    let llmSummary: string | undefined;
    try {
      if (llm?.available) {
        const { generateWeeklySummary } = await import("@mpp/core");
        const summary = await generateWeeklySummary(llm, state.performanceRecords);
        if (summary.usedLlm && summary.items.length > 0) {
          llmSummary = summary.items.map((i) => i.text).join("\n");
        }
      }
    } catch {
      /* LLM 失败回退规则 */
    }
    const report = buildWeeklyReport({
      records: state.performanceRecords,
      template,
      windowDays,
      llmSummary,
    });
    set({ weeklyReportPreview: report });
    return { ok: true, report };
  },

  sendWeeklyReport: async (_id, deliveries) => {
    try {
      const { sendWeeklyViaServer } = await import("../bridge/server-weekly.js");
      const { serverUrl, serverToken } = get();
      const report = get().weeklyReportPreview || buildWeeklyReport({ records: get().performanceRecords });
      const result = await sendWeeklyViaServer({
        serverUrl,
        token: serverToken,
        report,
        title: "内容周报",
        deliveries,
      });
      return { ok: result.ok, message: result.message, results: result.results };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  // -------------------------------------------------------------------
  // DATA-02/03 效果回收与官方指标同步
  // -------------------------------------------------------------------
  loadPerformance: async () => {
    try {
      const store = getPerformanceStore(get().bridge);
      const records = await store.list();
      set({ performanceRecords: [...records] });
    } catch {
      /* 存储不可用时静默(含 IndexedDB 不可用的受限环境) */
    }
  },

  importPerformanceCsv: async (raw) => {
    const store = getPerformanceStore(get().bridge);
    try {
      const { records, errors } = parsePerformanceCsv(raw);
      if (records.length === 0) {
        return { ok: false, error: errors[0] ?? "CSV 没有可导入的记录" };
      }
      const result = await importPerformanceRecords(store, records);
      const all = await store.list();
      set({ performanceRecords: [...all] });
      const errorText = errors.length > 0 ? `; ${errors.length} 行被跳过` : "";
      return { ok: true, imported: result.imported, error: errorText };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  addManualPerformance: async ({ platformId, title, remoteId, remoteUrl, publishedAt, metrics }) => {
    const store = getPerformanceStore(get().bridge);
    try {
      const record = createManualPerformanceRecord({
        platformId,
        title,
        remoteId,
        remoteUrl,
        publishedAt,
        metrics,
      });
      await store.put(record);
      set({ performanceRecords: [record, ...get().performanceRecords] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  removePerformanceRecord: async (id) => {
    const store = getPerformanceStore(get().bridge);
    try {
      await store.remove(id);
      set({ performanceRecords: get().performanceRecords.filter((r) => r.id !== id) });
    } catch {
      /* 删除失败静默 */
    }
  },

  syncPerformanceFromApi: async () => {
    const store = getPerformanceStore(get().bridge);
    try {
      // DATA-03:仅对配置了 provider 的平台同步(公众号 server 转发)。
      const { metricsProviderRegistry, WechatOfficialApiMetricsProvider } = await import("@mpp/core");
      const { syncServerMetrics } = await import("../bridge/server-metrics.js");
      const { serverUrl, serverToken } = get();
      const records = await store.list();
      const remoteIds = [...new Set(records.map((r) => r.remoteId).filter((x): x is string => !!x))];
      if (remoteIds.length === 0) {
        return { ok: false, message: "当前没有带 remoteId(远端文章 ID/URL)的效果记录可同步;请先导入/录入或从发布任务获取远端 ID。" };
      }
      // ACCOUNT-03:公众号指标同步按当前账号的 server profile 引用路由。
      const wechatAccount = get().accountFor("wechat");
      const serverResult = await syncServerMetrics({
        serverUrl,
        token: serverToken,
        remoteIds,
        serverProfileId: wechatAccount?.serverProfileId,
      });
      if (!serverResult.ok) {
        return { ok: false, message: serverResult.message ?? "公众号指标同步失败" };
      }
      const provider = new WechatOfficialApiMetricsProvider({
        serverUrl,
        token: serverToken,
        fetcher: async ({ remoteId }) => {
          const { metricsForRemoteId } = await import("../bridge/server-metrics.js");
          return metricsForRemoteId(serverResult, remoteId);
        },
      });
      metricsProviderRegistry.register(provider);
      const providers = metricsProviderRegistry.list();
      const result = await import("@mpp/core").then((m) =>
        m.syncMetricsFromProviders(store, providers, records),
      );
      const all = await store.list();
      set({ performanceRecords: [...all] });
      const errorText = result.errors.length > 0 ? `; ${result.errors.join("; ")}` : "";
      return {
        ok: result.updated > 0,
        message: `已同步 ${result.updated} 条,跳过 ${result.skipped} 条${errorText}`,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  performanceSummary: () => summarizePerformance(get().performanceRecords),

  performanceInsights: () => analyzePerformance(get().performanceRecords),

  // v10 FOLLOWUP-NOTIFY:待跟进提醒开关(持久化到本地设置)。
  setFollowUpReminderEnabled: (enabled) => {
    set({ followUpReminderEnabled: enabled });
    void get().bridge?.setSetting("mpp.followUpReminderEnabled", enabled ? "1" : "0");
    // 开启时立即检查一次(无需等心跳)。
    if (enabled) void get().runFollowUpReminder(false);
  },

  // v10 FOLLOWUP-NOTIFY:检查并发送待跟进提醒(复用 NOTIFY 能力)。
  // 逻辑:计算待跟进摘要 → 有未跟进项且(force 或非当天重复) → 发系统通知 + 记录时间。
  runFollowUpReminder: async (force) => {
    try {
      const records = get().performanceRecords;
      const { buildFollowUpReminderDigest } = await import("@mpp/core");
      const digest = buildFollowUpReminderDigest(records);
      set({ followUpReminderDigest: digest });
      if (!digest.shouldNotify) {
        return { ok: true, notified: false };
      }
      // 同一天不重复提醒(force 除外)。
      if (!force && get().followUpLastRemindedAt) {
        const last = new Date(get().followUpLastRemindedAt as string);
        const today = new Date();
        if (
          last.getFullYear() === today.getFullYear() &&
          last.getMonth() === today.getMonth() &&
          last.getDate() === today.getDate()
        ) {
          return { ok: true, notified: false };
        }
      }
      await notify(get().bridge, digest.notifyTitle, digest.notifyBody, "performance");
      set({ followUpLastRemindedAt: new Date().toISOString() });
      return { ok: true, notified: true };
    } catch (err) {
      return { ok: false, notified: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 INBOX-07:置顶评论自动跟进提醒开关(持久化到本地设置)。
  setPinnedFollowUpEnabled: (enabled) => {
    set({ pinnedFollowUpEnabled: enabled });
    void get().bridge?.setSetting("mpp.pinnedFollowUpEnabled", enabled ? "1" : "0");
    if (enabled) void get().runPinnedFollowUpReminder(false);
  },

  // v11 INBOX-07:检查并发送「置顶评论跟进」提醒(复用 NOTIFY 能力)。
  // 逻辑:对置顶超过阈值仍未回复的消息构建摘要 → 有待跟进且(force 或非当天重复) → 发系统通知。
  runPinnedFollowUpReminder: async (force) => {
    try {
      const { buildPinnedFollowUpDigest } = await import("@mpp/core");
      const digest = buildPinnedFollowUpDigest(get().inboxMessages);
      set({ pinnedFollowUpDigest: digest });
      if (!digest.shouldNotify) {
        return { ok: true, notified: false };
      }
      if (!force && get().pinnedFollowUpLastRemindedAt) {
        const last = new Date(get().pinnedFollowUpLastRemindedAt as string);
        const today = new Date();
        if (
          last.getFullYear() === today.getFullYear() &&
          last.getMonth() === today.getMonth() &&
          last.getDate() === today.getDate()
        ) {
          return { ok: true, notified: false };
        }
      }
      await notify(get().bridge, digest.notifyTitle, digest.notifyBody, "inbox");
      set({ pinnedFollowUpLastRemindedAt: new Date().toISOString() });
      return { ok: true, notified: true };
    } catch (err) {
      return { ok: false, notified: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v11 深化 GOAL-NOTIFY-01:目标达成预测提醒开关(持久化到本地设置)。
  setGoalReminderEnabled: (enabled) => {
    set({ goalReminderEnabled: enabled });
    void get().bridge?.setSetting("mpp.goalReminderEnabled", enabled ? "1" : "0");
    // 开启时立即检查一次(无需等心跳)。
    if (enabled) void get().runGoalReminder(false);
  },

  // v11 深化 GOAL-NOTIFY-01:检查并发送目标达成提醒(复用 NOTIFY 能力)。
  // 逻辑:计算目标达成预测(at-risk/off-track) → 有风险且(force 或非当天重复) → 发系统通知(action=strategy 直达内容策略)。
  runGoalReminder: async (force) => {
    try {
      const records = get().performanceRecords;
      const { buildGoalReminderDigest } = await import("@mpp/core");
      const digest = buildGoalReminderDigest(records, {
        monthlyViewsGoal: get().wordGoal || undefined,
      });
      set({ goalReminderDigest: digest });
      if (!digest.shouldNotify) {
        return { ok: true, notified: false };
      }
      // 同一天不重复提醒(force 除外)。
      if (!force && get().goalLastRemindedAt) {
        const last = new Date(get().goalLastRemindedAt as string);
        const today = new Date();
        if (
          last.getFullYear() === today.getFullYear() &&
          last.getMonth() === today.getMonth() &&
          last.getDate() === today.getDate()
        ) {
          return { ok: true, notified: false };
        }
      }
      await notify(get().bridge, digest.notifyTitle, digest.notifyBody, "strategy");
      set({ goalLastRemindedAt: new Date().toISOString() });
      return { ok: true, notified: true };
    } catch (err) {
      return { ok: false, notified: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // -------------------------------------------------------------------
  // 文章版本历史(快照时间线/差异对比/一键回滚)
  // -------------------------------------------------------------------
  loadVersions: async () => {
    const draftId = get().currentDraftId;
    if (!draftId) {
      set({ versions: [], selectedVersionId: null });
      return;
    }
    try {
      const versions = await getVersionStore(get().bridge).list(draftId);
      set({ versions: [...versions] });
    } catch {
      set({ versions: [] });
    }
  },

  saveVersionSnapshot: async (label) => {
    const { markdown, authorName, tags, currentDraftId } = get();
    if (!currentDraftId) return;
    const snapshot = createSnapshot({
      draftId: currentDraftId,
      markdown,
      authorName,
      tags: [...tags],
      label: label ?? "手动保存",
    });
    try {
      await getVersionStore(get().bridge).put(snapshot);
      await get().loadVersions();
      toast(`已保存版本快照 ${snapshot.id.slice(-6)}`, "success");
    } catch (err) {
      toast(`保存版本快照失败:${err instanceof Error ? err.message : String(err)}`, "error");
    }
  },

  diffVersion: async (aId, bId) => {
    try {
      const store = getVersionStore(get().bridge);
      const [a, b] = await Promise.all([store.get(aId), store.get(bId)]);
      if (!a || !b) return null;
      return diffVersions(a, b);
    } catch {
      return null;
    }
  },

  restoreVersion: async (id) => {
    try {
      const store = getVersionStore(get().bridge);
      const snapshot = await store.get(id);
      if (!snapshot) return { ok: false, error: "版本不存在" };
      const { markdown, authorName, tags, currentDraftId } = get();
      // 回滚前先保存当前内容快照(可再回退)。
      if (currentDraftId) {
        const before = createSnapshot({
          draftId: currentDraftId,
          markdown,
          authorName,
          tags: [...tags],
          label: "回滚前自动快照",
        });
        try {
          await store.put(before);
        } catch {
          /* 回滚前快照失败不阻断回滚 */
        }
      }
      set({
        markdown: snapshot.markdown,
        authorName: snapshot.authorName,
        tags: [...snapshot.tags],
        results: [],
        receipts: {},
      });
      setSaveStatus("dirty");
      get().adapt();
      // 更新当前草稿存储(保持草稿与回滚内容一致)。
      if (currentDraftId) {
        const draft = {
          id: currentDraftId,
          title: deriveTitle(snapshot.markdown),
          markdown: snapshot.markdown,
          authorName: snapshot.authorName,
          tags: [...snapshot.tags],
          updatedAt: new Date().toISOString(),
        };
        try {
          await getDraftStore(get().bridge).saveDraft(draft);
          set({ drafts: [draft, ...get().drafts.filter((d) => d.id !== draft.id)] });
        } catch {
          /* 草稿落库失败不阻断回滚(编辑区已更新) */
        }
      }
      await get().loadVersions();
      toast("已回滚到历史版本", "success");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  setWordGoal: (goal) => {
    const v = Math.max(0, Math.floor(goal));
    set({ wordGoal: v });
    void get().bridge?.setSetting("mpp.wordGoal", String(v));
  },

  setTypewriterMode: (on) => {
    set({ typewriterMode: on });
    void get().bridge?.setSetting("mpp.typewriterMode", on ? "1" : "0");
  },

  // v7 Phase 4 AI-WRITE-01:整篇 AI 写作(润色/扩写/续写/摘要)。
  runDocWrite: async (op) => {
    const { markdown } = get();
    if (!markdown.trim()) {
      toast("没有可处理的内容", "info");
      return { text: markdown, usedLlm: false, changed: false, op };
    }
    set({ docWriteBusy: true });
    try {
      const llm = get().llmReady() ? buildLlmAdapter(get()) : undefined;
      const { runDocWrite } = await import("@mpp/core");
      const result = await runDocWrite({ markdown, op }, llm);
      if (result.changed && result.text !== markdown) {
        // 写入撤销栈:App 层用 setMarkdown 前先 snapshot。
        get().setMarkdown(result.text);
        setSaveStatus("dirty");
      }
      set({ docWriteBusy: false, docWriteResult: result });
      if (!result.usedLlm) {
        toast(result.changed ? "已用规则完成(未配置 LLM)" : "内容未变化", "info");
      } else {
        toast(result.changed ? "整篇 AI 写作完成" : "内容未变化", "success");
      }
      return result;
    } catch (err) {
      set({ docWriteBusy: false });
      toast("AI 写作失败:" + (err instanceof Error ? err.message : String(err)), "error");
      return { text: markdown, usedLlm: false, changed: false, op, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // v7 Phase 4 SNIPPET-01:在光标处插入片段(由 App 读取 textarea 选区)。
  insertSnippet: (snippetText) => {
    const { markdown } = get();
    const area = document.activeElement as HTMLTextAreaElement | null;
    const start = area?.selectionStart ?? 0;
    const end = area?.selectionEnd ?? 0;
    void import("@mpp/core").then(({ insertSnippet }) => {
      const r = insertSnippet(markdown, start, end, { text: snippetText });
      get().setMarkdown(r.text);
      toast("已插入片段", "success");
      // 下一帧恢复光标。
      requestAnimationFrame(() => {
        if (area) {
          area.focus();
          area.setSelectionRange(r.selectionStart, r.selectionEnd);
        }
      });
    });
  },

  // v7 创作工作流:强制立即保存当前草稿(切换草稿/离开前 flush)。
  flushDraft: async () => {
    const { markdown, editorDirty } = get();
    if (!editorDirty || !markdown.trim()) {
      set({ editorDirty: false });
      return;
    }
    await get().saveDraft();
  },
  runPreflight: () => {
    const { markdown, authorName, tags, selectedPlatforms } = get();
    if (selectedPlatforms.length === 0) {
      set({ preflightReport: null, preflightComputing: false });
      return;
    }
    set({ preflightComputing: true });
    // 微任务后计算,保证 UI 先展示 loading(避免长文卡顿无反馈)。
    setTimeout(() => {
      try {
        const report = runPreflightCore({
          markdown,
          authorName,
          tags,
          selectedPlatforms,
        });
        set({ preflightReport: report, preflightComputing: false });
      } catch {
        set({ preflightReport: null, preflightComputing: false });
      }
    }, 0);
  },

  // v7 Phase 3:一键自动修复健康检查中可自动化的问题(缺 alt 等确定性修复)。
  autoFixPreflightIssues: () => {
    const { markdown } = get();
    void import("@mpp/core").then(({ autoFixPreflight }) => {
      const { text, fixes } = autoFixPreflight(markdown);
      if (fixes.length === 0) {
        toast("没有可自动修复的问题", "info");
        return;
      }
      get().setMarkdown(text);
      toast(`已自动修复 ${fixes.length} 处`, "success");
      // 修复后立即重新体检,更新报告。
      get().runPreflight();
    });
  },

  // v7 Phase 2:托盘创作快捷操作(与 CreatorQuickActions 的复制/导出/保存/清空对齐)。
  copyMarkdown: async () => {
    const { markdown } = get();
    if (!markdown) {
      toast("没有可复制的内容", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      toast("已复制 Markdown 到剪贴板", "success");
    } catch {
      toast("复制失败:当前环境不允许访问剪贴板", "error");
    }
  },
  exportMarkdown: async () => {
    const { markdown } = get();
    if (!markdown.trim()) {
      toast("没有可导出的内容", "info");
      return;
    }
    const cleaned = (deriveTitle(markdown) || "未命名草稿").replace(/[\\/:*?"<>|]/g, "_").trim();
    const name = `${cleaned.slice(0, 60) || "未命名草稿"}.md`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已导出 .md 文件", "success");
  },
  clearMarkdown: async () => {
    // 托盘菜单已承担二次确认;这里直接清空并同步草稿状态。
    set({ markdown: "", editorDirty: true });
    toast("已清空编辑器内容", "success");
  },

  // AI-INSIGHT-03:覆盖草稿摘要索引(仅本地内存态;索引为派生数据,可随时重建)。
  setDraftIndexes: (indexes) => {
    set({ draftIndexes: [...indexes] });
  },

  // AI-ROBUST-03:LLM 调用成本/响应观测(最近在前,内存态,不落盘)。
  llmCalls: [],
  llmTelemetrySummary: {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    successRate: 0,
    avgDurationMs: 0,
    p95DurationMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byTask: {},
  },
  clearLlmCalls: () => {
    llmTelemetry.clear();
    set({ llmCalls: [], llmTelemetrySummary: emptyLlmSummary() });
  },
  refreshLlmTelemetry: () => {
    set({
      llmCalls: [...llmTelemetry.recent(50)],
      llmTelemetrySummary: llmTelemetry.summary(),
    });
  },
  refreshLocalShared: async () => {
    const bridge = get().bridge;
    try {
      const store = await getLocalSharedStore(bridge);
      const items = await store.list();
      set({ localSharedItems: [...items] });
    } catch {
      // 本地共享库不可用(受限环境)时保留空列表,不阻塞 UI。
      set({ localSharedItems: [] });
    }
  },
  localSharedPush: async (item) => {
    const store = await getLocalSharedStore(get().bridge);
    const result = await store.put(item);
    const items = await store.list();
    set({ localSharedItems: [...items] });
    return result;
  },
  localSharedRemove: async (kind, id) => {
    const store = await getLocalSharedStore(get().bridge);
    await store.remove(kind, id);
    const items = await store.list();
    set({ localSharedItems: [...items] });
  },
}));

/**
 * 由当前生效 LLM 配置 + AI 连接中心保存的多配置构造适配器(统一走共享工具)。
 * AI-ROBUST-03:在共享适配器外叠加一层观测同步装饰器 ——
 * 每次 LLM 调用完成后自动把全局观测器快照同步到 store(供观测面板实时展示)。
 */
function buildLlmAdapter(state: Pick<AppState, "llm" | "llmConfigs" | "activeLlmConfigId">) {
  const adapter = sharedBuildLlmAdapter(state);
  if (!adapter) return undefined;
  return withLlmTelemetrySync(adapter);
}

/** 包装适配器:run 之后同步观测快照到 store。 */
function withLlmTelemetrySync(adapter: LlmAdapter): LlmAdapter {
  const sync = () => {
    const s = useStore.getState();
    if (typeof s.refreshLlmTelemetry === "function") s.refreshLlmTelemetry();
  };
  return {
    id: adapter.id,
    get available() {
      return adapter.available;
    },
    async run(req) {
      try {
        const out = await adapter.run(req);
        sync();
        return out;
      } catch (err) {
        sync();
        throw err;
      }
    },
  };
}

/** 构造 LLM 增强选项:llmReady 且启用了增强项时,注入回退/重试适配器。 */
function buildLlmOptions(state: AppState): { llm?: LlmAdapter; enhance?: EnhanceOptions } {
  const enhanceEnabled = state.enhance.title || state.enhance.summary || state.enhance.colloquialize || state.enhance.rewrite;
  if (!state.llmReady() || !enhanceEnabled) return {};
  return {
    llm: buildLlmAdapter(state),
    enhance: state.enhance,
  };
}

/**
 * 注册默认平台执行器(占位):真实执行器在 createPublishJob 时按当前设置注册。
 * 这里只保证服务存在且可被 UI 查询,避免测试/未发布时误报。
 */
function registerDefaultExecutors(_service: PublishJobService, _bridge: PlatformBridge | null): void {
  void _service;
  void _bridge;
}

function buildWechatPublishPayload(
  payload: SerializedPayload,
  assetTable: AssetTable,
  mode: WechatPublishMode,
): {
  title: string;
  content: string;
  summary?: string;
  author?: string;
  contentSourceUrl?: string;
  coverImageUrl?: string;
  bodyImageUrls: readonly string[];
  publish: boolean;
} {
  const bodyImageUrls = payload.imageAssetIds
    .map((id) => assetTable.get(id))
    .filter((asset): asset is NonNullable<typeof asset> => !!asset)
    .map((asset) => asset.rehosted.wechat?.url ?? asset.source.url ?? asset.source.dataUrl)
    .filter((url): url is string => !!url);
  const cover = payload.coverAssetId ? assetTable.get(payload.coverAssetId) : undefined;
  const fallbackCover = payload.imageAssetIds[0] ? assetTable.get(payload.imageAssetIds[0]) : undefined;
  const coverAsset = cover ?? fallbackCover;

  return {
    title: payload.title,
    content: payload.content,
    summary: payload.summary,
    author: typeof payload.extra?.author === "string" ? payload.extra.author : undefined,
    contentSourceUrl:
      typeof payload.extra?.contentSourceUrl === "string" ? payload.extra.contentSourceUrl : undefined,
    coverImageUrl:
      coverAsset?.rehosted.wechat?.url ?? coverAsset?.source.url ?? coverAsset?.source.dataUrl,
    bodyImageUrls,
    publish: mode === "publish",
  };
}

/**
 * v7 Phase 2:发布前置健康检查(计划任务 / 发布队列 / 发布批次共用)。
 * 在真实发布动作前,对目标草稿做一次 runPreflight;存在 error 级问题则拒绝执行。
 * 返回 ok + 摘要;失败时给出可读的阻塞原因。
 */
async function preflightGuard(draft: { markdown: string; authorName?: string; tags?: readonly string[] }, platformIds: readonly string[]): Promise<{ ok: boolean; summary?: string; error?: string }> {
  if (platformIds.length === 0) return { ok: false, error: "未选择平台" };
  const { runPreflight: run } = await import("@mpp/core");
  const report = run({
    markdown: draft.markdown,
    authorName: draft.authorName ?? "",
    tags: [...(draft.tags ?? [])],
    selectedPlatforms: [...platformIds],
  });
  if (report.ready) {
    return { ok: true, summary: `体检通过(${report.counts.errors} 错误 / ${report.counts.warnings} 警告 / ${report.counts.infos} 提示)` };
  }
  const blocked = report.issues
    .filter((i) => i.severity === "error")
    .map((i) => i.message)
    .slice(0, 3);
  return {
    ok: false,
    error: `发布前体检未通过:${blocked.join(";") || "存在 error 级问题"}`,
  };
}

/**
 * FLOW-03 计划任务执行器:到点执行动作(校验生成 / 发布任务)。
 * 约束:机器与登录态必须在线 —— 执行只做本地校验/生成,真实发布需用户确认。
 */
function scheduleRunner(bridge: PlatformBridge | null): ScheduledTaskRunner {
  return {
    async run(task) {
      if (task.action.kind === "validate-generate") {
        // 读取草稿 → 批量校验/生成产物(默认不真实发布)。
        const draftStore = getDraftStore(bridge);
        const draft = await draftStore.getDraft(task.draftId);
        if (!draft) return { ok: false, error: "草稿不存在" };
        const { markdownToIR, syncToPlatforms } = await import("@mpp/core");
        const platformIds =
          task.platformIds.length > 0 ? task.platformIds : useStore.getState().selectedPlatforms;
        if (platformIds.length === 0) return { ok: false, error: "未选择平台" };
        const { document, assetTable } = markdownToIR(draft.markdown, {
          meta: {
            authorName: draft.authorName,
            tags: [...draft.tags],
            canonicalUrl: "https://example.com/post",
          },
        });
        const results = await syncToPlatforms(document, platformIds, {
          stageOnly: true,
          assetTable,
          now: () => new Date().toISOString(),
        });
        const okCount = results.filter((r) => !r.report?.hasError).length;
        return {
          ok: okCount > 0,
          summary: `${okCount}/${results.length} 平台校验通过`,
          error: okCount > 0 ? undefined : "所有平台校验均未通过",
        };
      }
      if (task.action.kind === "publish-job") {
        // 创建发布任务并执行(走 PublishJobService 编排,含鉴权/回执)。
        const draftStore = getDraftStore(bridge);
        const draft = await draftStore.getDraft(task.draftId);
        if (!draft) return { ok: false, error: "草稿不存在" };
        const platformIds =
          task.platformIds.length > 0 ? task.platformIds : useStore.getState().selectedPlatforms;
        // v7 Phase 2:真实发布前置健康检查 —— 存在 error 级问题则拒绝到点发布。
        const guard = await preflightGuard(draft, platformIds);
        if (!guard.ok) return { ok: false, error: guard.error };
        const jobId = await useStore.getState().createPublishJobFromDraft(draft, task.platformIds);
        return {
          ok: !!jobId,
          summary: `已创建发布任务 ${jobId}(体检通过)`,
          jobId: jobId ?? undefined,
        };
      }
      if (task.action.kind === "metrics-sync") {
        // 到点自动同步公众号官方指标(server 转发),无 remoteId 时明确提示。
        const result = await useStore.getState().syncPerformanceFromApi();
        return { ok: result.ok, summary: result.message, error: result.ok ? undefined : result.message };
      }
      if (task.action.kind === "ai-auto-complete") {
        // 到点自动运行 AI 自动完成(分析 → 修复 → 增强 → 复核),并把修复结果写回草稿。
        const draftStore = getDraftStore(bridge);
        const draft = await draftStore.getDraft(task.draftId);
        if (!draft) return { ok: false, error: "草稿不存在" };
        const { runAutoAgent } = await import("@mpp/core");
        const llm = buildLlmAdapter(useStore.getState());
        const platformIds =
          task.platformIds.length > 0 ? task.platformIds : useStore.getState().selectedPlatforms;
        const result = await runAutoAgent(draft.markdown, {
          platformIds,
          llm,
          autoFix: true,
          maxFixRounds: 3,
          enhance: true,
          autoApplyOverrides: false,
        });
        // 若产生修复,更新草稿内容并重新保存(可追溯)。
        if (result.appliedFixes.length > 0 && result.markdown !== draft.markdown) {
          const updated: Draft = {
            ...draft,
            markdown: result.markdown,
            title: deriveTitle(result.markdown),
            updatedAt: new Date().toISOString(),
          };
          await draftStore.saveDraft(updated);
        }
        const fixSummary =
          result.appliedFixes.length > 0
            ? `修复 ${result.appliedFixes.length} 处`
            : "无需修复";
        const verifyStep = result.steps.find((s) => s.kind === "verify");
        const verifySummary =
          verifyStep?.kind === "verify"
            ? verifyStep.allPassed
              ? "全部平台通过校验"
              : `${verifyStep.errorCount} 个平台有错误`
            : "复核完成";
        return { ok: true, summary: `${fixSummary};${verifySummary}` };
      }
      if (task.action.kind === "weekly-report") {
        // WEEKLY-02:到点自动生成周报任务(含 LLM 总结,失败回退规则)。
        const weeklyJobId = task.weeklyReport?.weeklyJobId;
        if (!weeklyJobId) return { ok: false, error: "未关联周报任务" };
        const service = getWeeklyService(bridge);
        const job = await service.get(weeklyJobId);
        if (!job) return { ok: false, error: "周报任务不存在" };
        service.updateLlm(buildLlmAdapter(useStore.getState()));
        const run = await service.generate(weeklyJobId);
        if (run.outcome !== "succeeded") {
          return { ok: false, error: run.error ?? "周报生成失败" };
        }
        const deliveryText =
          run.deliveryResults && run.deliveryResults.length > 0
            ? `;投递 ${run.deliveryResults.filter((d) => d.ok).length}/${run.deliveryResults.length}`
            : ";未配置投递渠道";
        return {
          ok: true,
          summary: `已生成周报(${run.recordsUsed ?? 0} 条记录)${deliveryText}`,
        };
      }
      if (task.action.kind === "inbox-auto-reply") {
        // v11 INBOX-06:到点自动对目标平台批量 AI 自动回复(真实回发到平台)。
        // INBOX-06 增强:支持任务级回复策略(预设/模板/去重/时效窗口)。
        const policy = task.action.policy;
        const platformIds =
          task.platformIds.length > 0 ? task.platformIds : useStore.getState().selectedPlatforms;
        if (platformIds.length === 0) return { ok: false, error: "未选择平台" };
        const results: { platformId: string; message: string }[] = [];
        for (const pid of platformIds) {
          const r = await useStore.getState().autoReplyInboxMessages(pid, undefined, policy);
          results.push({ platformId: pid, message: r.message });
        }
        const summary = results.map((r) => `${r.platformId}: ${r.message}`).join("; ");
        const allOk = results.length > 0;
        return { ok: allOk, summary };
      }
      return { ok: false, error: "未知动作" };
    },
  };
}

/**
 * ROADMAP_V5 Phase 1 · 发布队列执行器:到点把队列条目转为真实发布任务。
 * 约束:机器与登录态必须在线;执行走与"立即真实发布"相同的鉴权与可信回执。
 * 账号引用已在排队时锁定(accountRefs),排队期间切换账号不影响到点发布。
 */
function publishQueueExecutor(bridge: PlatformBridge | null): import("@mpp/core").PublishQueueExecutor {
  return {
    async run(entry) {
      const draftStore = getDraftStore(bridge);
      const draft = await draftStore.getDraft(entry.draftId);
      if (!draft) return { ok: false, error: "草稿不存在(可能已删除)" };
      const platformIds =
        entry.platformIds.length > 0 ? entry.platformIds : useStore.getState().selectedPlatforms;
      if (platformIds.length === 0) return { ok: false, error: "未选择平台" };
      try {
        // v7 Phase 2:发布队列到点前置健康检查 —— 存在 error 级问题则拒绝发布并如实记录。
        const guard = await preflightGuard(draft, platformIds);
        if (!guard.ok) return { ok: false, error: guard.error };
        const jobId = await useStore
          .getState()
          .createPublishJobFromDraft(draft, platformIds, entry.accountRefs);
        if (!jobId) return { ok: false, error: "创建发布任务失败" };
        return { ok: true, jobId, message: `已创建发布任务 ${jobId}(体检通过)` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/**
 * ROADMAP_V5 Phase 2 · 发布批次执行器:到点把批次条目转为真实发布任务,并收集平台回执。
 * 约束:机器与登录态必须在线;执行走与「立即真实发布」相同的鉴权与可信回执;
 * 账号引用在排队时锁定,排队期间切换账号不影响到点发布。
 */
function publishBatchItemExecutor(bridge: PlatformBridge | null): PublishBatchItemExecutor {
  return {
    async run(item) {
      const draftStore = getDraftStore(bridge);
      const draft = await draftStore.getDraft(item.draftId);
      if (!draft) return { ok: false, error: "草稿不存在(可能已删除)" };
      const platformIds =
        item.platformIds.length > 0 ? item.platformIds : useStore.getState().selectedPlatforms;
      if (platformIds.length === 0) return { ok: false, error: "未选择平台" };
      try {
        // v7 Phase 2:发布批次到点前置健康检查 —— 存在 error 级问题则拒绝发布。
        const guard = await preflightGuard(draft, platformIds);
        if (!guard.ok) return { ok: false, error: guard.error };
        const jobId = await useStore
          .getState()
          .createPublishJobFromDraft(draft, platformIds, item.accountRefs);
        if (!jobId) return { ok: false, error: "创建发布任务失败" };
        // 等待任务到达终态(后台异步执行),再收集回执供 BATCH-02 批量效果回收。
        const jobService = getJobService(bridge);
        const job = await waitForJobTerminal(jobService, jobId, 60_000);
        const receipts = (job?.platformJobs ?? [])
          .filter((p) => p.receipt)
          .map((p) => ({
            platformId: p.platformId,
            status: p.receipt!.status,
            ...(p.receipt!.remoteId ? { remoteId: p.receipt!.remoteId } : {}),
            ...(p.receipt!.remoteUrl ? { remoteUrl: p.receipt!.remoteUrl } : {}),
            at: p.receipt!.at,
          }));
        return { ok: true, jobId, message: `已创建发布任务 ${jobId}`, receipts };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** 轮询等待任务到达终态(超时返回当前快照)。 */
async function waitForJobTerminal(
  jobService: import("@mpp/core").PublishJobService,
  jobId: string,
  timeoutMs = 60_000,
): Promise<import("@mpp/core").PublishJob | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await jobService.get(jobId);
    const stage = job?.stage;
    if (
      !job ||
      stage === "succeeded" ||
      stage === "failed" ||
      stage === "unknown" ||
      stage === "cancelled"
    ) {
      return job;
    }
    if (Date.now() > deadline) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
