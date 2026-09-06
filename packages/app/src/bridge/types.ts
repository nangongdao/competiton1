/**
 * PlatformBridge —— 隔离 chrome.* 的抽象层。
 *
 * UI 只调 bridge 接口,从不直接碰 chrome.*。web 环境注入 MockBridge(浏览器原生 API),
 * 扩展环境注入 ChromeBridge(chrome.* + 转发 server)。这是 web/扩展双构建复用同一套 UI 的关键。
 */

export interface ClipboardPayload {
  /** 富文本 HTML(公众号/知乎/B站)。 */
  readonly html?: string;
  /** 纯文本兜底(必须,Chrome 要求)。 */
  readonly text: string;
}

export interface AssistedHandoffRequest {
  readonly platformId: string;
  readonly clipboard: ClipboardPayload;
  /** 是否尝试自动注入编辑器(best-effort)。 */
  readonly tryInject?: boolean;
}

export interface AssistedHandoffResult {
  readonly ok: boolean;
  /** 实际采用的方式。 */
  readonly method: "clipboard" | "injected" | "failed";
  readonly message: string;
}

export interface WechatPublishRequest {
  readonly serverUrl: string;
  /** 本机 capability token(server 启动时生成,存本地设置)。 */
  readonly token?: string;
  readonly payload: unknown;
  /** ACCOUNT-03:公众号账号的 server profile 引用(多账号凭据选择)。 */
  readonly serverProfileId?: string;
}

export interface WechatPublishResult {
  readonly ok: boolean;
  readonly message: string;
  readonly remoteId?: string;
}

export type AutomationPublishMode = "mock" | "assist" | "draft" | "full-auto";

export interface AutomationPublishRequest {
  readonly runnerUrl: string;
  /** 本机 capability token(runner 启动时生成,存本地设置)。 */
  readonly token?: string;
  readonly platformId: string;
  readonly mode: Exclude<AutomationPublishMode, "mock" | "assist">;
  readonly payload: unknown;
  /** RUN-01:full-auto 二次确认绑定内容摘要。 */
  readonly contentDigest?: string;
  /** RUN-01:用户对真实发布的显式确认。 */
  readonly confirmed?: boolean;
  /** ACCOUNT-03:会话平台账号选择 —— 该账号的浏览器登录 profile 目录名。 */
  readonly profileDir?: string;
}

export interface AutomationPublishResult {
  readonly ok: boolean;
  readonly status: "drafted" | "submitted" | "published" | "unknown" | "needs-user-action" | "failed";
  readonly message: string;
  readonly remoteUrl?: string;
  readonly remoteId?: string;
  readonly screenshotPath?: string;
  readonly tracePath?: string;
  readonly diagnosticsPath?: string;
  readonly evidence?: readonly string[];
}

/** 图片上传请求(转发到 server /upload)。 */
export interface UploadAssetRequest {
  readonly serverUrl: string;
  /** 本机 capability token。 */
  readonly token?: string;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime: string;
}

export interface UploadAssetResult {
  readonly ok: boolean;
  readonly url?: string;
  readonly mediaId?: string;
  readonly message?: string;
}

/** server 持久化任务元信息(GET /jobs 返回的摘要,不含正文 payload)。 */
export interface ServerJobSummary {
  readonly id: string;
  readonly stage: string;
  readonly contentDigest: string;
  readonly platforms: {
    readonly platformId: string;
    readonly stage: string;
    readonly attemptCount: number;
    readonly error?: string;
    readonly remoteId?: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ServerJobApiResult {
  readonly ok: boolean;
  readonly jobs?: ServerJobSummary[];
  readonly job?: ServerJobSummary;
  readonly error?: string;
  readonly message?: string;
}

export interface ServerJobRequest {
  readonly serverUrl: string;
  /** 本机 capability token。 */
  readonly token?: string;
}

/** 桌面端托盘/全局快捷键触发的功能面板动作(与 Rust AppEventAction 一一对应)。 */
export type DesktopEventAction =
  | "ai-agent"
  | "calendar"
  | "report"
  | "command-palette"
  | "accounts"
  | "collab"
  | "publish-queue"
  | "publish-batch"
  | "creator-copy"
  | "creator-export"
  | "creator-save"
  | "creator-clear";

/** 平台一键连接请求(转发到 server/runner /platform-api/connect)。 */
export interface PlatformConnectRequest {
  readonly baseUrl: string;
  /** 本机 capability token。 */
  readonly token?: string;
  readonly platformId: string;
  readonly credentials: Readonly<Record<string, string>>;
  /** ACCOUNT-03:会话平台账号的浏览器登录 profile 目录名。 */
  readonly profileDir?: string;
  /** ACCOUNT-03:公众号账号的 server profile 引用(多账号凭据选择)。 */
  readonly serverProfileId?: string;
}

/** 平台一键连接结果(与 core ConnectionCheckResult 对齐)。 */
export interface PlatformConnectResult {
  readonly ok: boolean;
  readonly platformId: string;
  readonly message: string;
  readonly account?: { id?: string; name?: string; avatar?: string; url?: string };
  readonly parsed?: Readonly<Record<string, unknown>>;
  readonly errorKind?: string;
  readonly latencyMs?: number;
  readonly at: string;
}

export interface PlatformBridge {
  readonly env: "web" | "extension" | "desktop";

  /** 写富文本到剪贴板(用户手势中调用)。 */
  writeClipboard(payload: ClipboardPayload): Promise<boolean>;

  /** 辅助发布:复制粘贴 + best-effort 注入(仅扩展)。 */
  assistedHandoff(req: AssistedHandoffRequest): Promise<AssistedHandoffResult>;

  /** 公众号真实发布(转发到本地 server)。 */
  publishWechat(req: WechatPublishRequest): Promise<WechatPublishResult>;

  /** Playwright runner real web publishing. */
  publishAutomation(req: AutomationPublishRequest): Promise<AutomationPublishResult>;

  /** 图片上传到图床(转发到本地 server /upload)。 */
  uploadAsset(req: UploadAssetRequest): Promise<UploadAssetResult>;

  /** 查询 server 持久化发布任务列表(GET /jobs,含重启后恢复入口)。 */
  listServerJobs?(req: ServerJobRequest): Promise<ServerJobApiResult>;
  /** 恢复/续跑 server 任务(POST /jobs/:id/resume)。 */
  resumeServerJob?(req: ServerJobRequest & { jobId: string }): Promise<ServerJobApiResult>;
  /** 取消 server 任务(POST /jobs/:id/cancel)。 */
  cancelServerJob?(req: ServerJobRequest & { jobId: string }): Promise<ServerJobApiResult>;
  /** 重试 server 任务平台(POST /jobs/:id/retry)。 */
  retryServerJob?(req: ServerJobRequest & { jobId: string; platformId?: string }): Promise<ServerJobApiResult>;

  /** 平台一键连接/一键解析(公众号走 server,会话平台走 runner)。 */
  connectPlatform?(req: PlatformConnectRequest): Promise<PlatformConnectResult>;

  /** INBOX-03:同步平台消息(评论/私信等)到本地收件箱。 */
  syncInbox?(req: import("./inbox-sync.js").InboxSyncBridgeRequest): Promise<import("./inbox-sync.js").InboxSyncBridgeResult>;

  /** INBOX-04:单条评论真实回发到平台(AI 自动回复 / 人工回复落平台)。 */
  replyInbox?(req: import("./inbox-reply.js").InboxReplyBridgeRequest): Promise<import("./inbox-reply.js").InboxReplyBridgeResult>;
  /** INBOX-04:批量自动回复真实回发到平台(单平台一次多条)。 */
  autoReplyInbox?(req: import("./inbox-reply.js").InboxAutoReplyBridgeRequest): Promise<import("./inbox-reply.js").InboxAutoReplyBridgeResult>;

  /** COLLAB-01/03:拉取 server 共享内容列表(可按 kind 过滤)。 */
  listSharedItems?(req: ServerJobRequest & { kind?: import("@mpp/core").SharedContentKind }): Promise<import("./server-share.js").ShareListResult>;
  /** COLLAB-01/03:拉取单条共享内容(含正文)。 */
  getSharedItem?(req: ServerJobRequest & { kind: import("@mpp/core").SharedContentKind; id: string }): Promise<import("./server-share.js").ShareItemResult>;
  /** COLLAB-01/03:推送/覆盖单条共享内容到 server。 */
  pushSharedItem?(req: ServerJobRequest & { item: import("@mpp/core").SharedItem }): Promise<import("./server-share.js").ShareApiResult>;
  /** COLLAB-01/03:删除 server 共享内容。 */
  deleteSharedItem?(req: ServerJobRequest & { kind: import("@mpp/core").SharedContentKind; id: string }): Promise<import("./server-share.js").ShareApiResult>;

  /** COLLAB-01/03:桌面端本地共享库(FileSharedStore,应用数据目录)读写能力。 */
  readLocalSharedStore?(): Promise<string>;
  /** 写入桌面端本地共享库(整个 JSON 文件原子写)。 */
  writeLocalSharedStore?(raw: string): Promise<void>;

  /** 订阅桌面端托盘/全局快捷键触发的「AI 自动完成」事件(仅桌面端实现)。 */
  onAiAgent?(handler: () => void): Promise<import("@tauri-apps/api/event").UnlistenFn>;

  /** 订阅桌面端托盘/全局快捷键触发的功能面板事件(统一 `desktop://app-event` 通道,仅桌面端实现)。 */
  onDesktopEvent?(handler: (action: DesktopEventAction) => void): Promise<import("@tauri-apps/api/event").UnlistenFn>;

  /** 读取持久化设置。 */
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  /** DATA-01:下载文本文件(桌面端可用原生保存对话框;web 端缺省走浏览器下载)。 */
  downloadText?(filename: string, content: string, mime: string): Promise<void>;

  /** v6 NOTIFY-01:发送系统级通知(发布/任务完成时调用;未实现则忽略)。
   *  @param action 可选:点击通知后要打开的桌面/前端面板动作(如 "publish-queue" / "publish-batch"),
   *           Web 端通过 Notification.onclick 分发 `mpp:notification-click` 事件;桌面端透传 Rust 通知命令。
   */
  showNotification?(title: string, body: string, action?: string): Promise<void>;
}
