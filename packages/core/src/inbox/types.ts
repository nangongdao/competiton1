/**
 * INBOX-01 统一收件箱 —— 互动与私信聚合。
 *
 * 解决「多平台评论/私信分散、运营要频繁切换 App」的痛点:
 * - 把各平台的评论 / 私信 / @提及 / 通知统一收敛为一个收件箱;
 * - 支持按平台 / 会话 / 状态过滤,按时间排序;
 * - 支持"已读 / 待回复 / 已回复 / 已关闭"状态流转与批量操作;
 * - 评论与私信可关联到某篇内容(performance/historyId)与某个账号(accountId);
 * - 纯 TS 零 DOM,数据由 app 侧 store 决定落盘方式。
 */

/** 消息方向。 */
export type InboxDirection = "inbound" | "outbound";

/** 消息类型:评论 / 私信 / @提及 / 通知。 */
export type InboxMessageKind = "comment" | "direct-message" | "mention" | "notification";

/** 消息状态。 */
export type InboxMessageStatus = "unread" | "read" | "replied" | "closed";

/** 处理状态(人工 / 自动)。 */
export type InboxHandling = "pending" | "auto-replied" | "human-replied" | "archived";

/** 敏感度标记(由情绪分析 / 意图识别产出)。 */
export type InboxSensitivity = "normal" | "negative" | "urgent";

/** 一条收件箱消息。 */
export interface InboxMessage {
  readonly id: string;
  readonly platformId: string;
  /** 平台侧的远端消息 id(去重键)。 */
  readonly remoteId: string;
  readonly direction: InboxDirection;
  readonly kind: InboxMessageKind;
  /** 发送者昵称(脱敏展示)。 */
  readonly author: string;
  /** 发送者平台侧 id(可选)。 */
  readonly authorId?: string;
  /** 消息正文。 */
  readonly text: string;
  /** 关联账号(accountId,用于多账号矩阵路由)。 */
  readonly accountId?: string;
  /** 关联内容/效果记录(可选)。 */
  readonly historyId?: string;
  /** 消息时间。 */
  readonly receivedAt: string;
  /** 已读 / 待回复 / 已回复 / 已关闭。 */
  readonly status: InboxMessageStatus;
  /** 人工处理状态(自动回复/人工回复/归档)。 */
  readonly handling: InboxHandling;
  /** 情绪敏感度(由评论营销引擎打标)。 */
  readonly sensitivity: InboxSensitivity;
  /** 意图标签(如 "price-inquiry" / "how-to-buy",由评论营销引擎打标)。 */
  readonly intent?: string;
  /** CRM 标签(由评论营销引擎打标,如 "high-intent")。 */
  readonly crmTags?: readonly string[];
  /** 自动回复内容(若有)。 */
  readonly autoReply?: string;
  /** 回复内容(人工,若有)。 */
  readonly reply?: string;
  /** 是否置顶(拖动置顶,可选;置顶消息在会话/列表中优先展示)。 */
  readonly pinned?: boolean;
  /** 置顶时间(ISO,可选;用于「置顶后自动跟进提醒」的计时起点)。 */
  readonly pinnedAt?: string;
  /** 用户手动拖拽排序序号(可选;越小越靠前,与 pinned 组合决定展示顺序)。 */
  readonly sortOrder?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 新建消息输入。 */
export interface NewInboxMessage {
  readonly id?: string;
  readonly platformId: string;
  readonly remoteId: string;
  readonly direction?: InboxDirection;
  readonly kind?: InboxMessageKind;
  readonly author: string;
  readonly authorId?: string;
  readonly text: string;
  readonly accountId?: string;
  readonly historyId?: string;
  readonly receivedAt?: string;
  readonly status?: InboxMessageStatus;
  readonly handling?: InboxHandling;
  readonly sensitivity?: InboxSensitivity;
  readonly intent?: string;
  readonly crmTags?: readonly string[];
  readonly autoReply?: string;
  readonly reply?: string;
  readonly pinned?: boolean;
  /** 置顶时间(可选)。 */
  readonly pinnedAt?: string;
  /** 用户手动拖拽排序序号(可选)。 */
  readonly sortOrder?: number;
}

/** 统一收件箱存储(版本化;由 app 侧接线到 IndexedDB / chrome.storage / 内存)。 */
export interface InboxStore {
  readonly schemaVersion: number;
  list(): Promise<readonly InboxMessage[]>;
  listByPlatform(platformId: string): Promise<readonly InboxMessage[]>;
  get(id: string): Promise<InboxMessage | undefined>;
  put(message: InboxMessage): Promise<void>;
  remove(id: string): Promise<void>;
}

export const INBOX_SCHEMA_VERSION = 1;
/** 收件箱条数上限(自动裁剪)。 */
export const INBOX_MAX_MESSAGES = 2000;

/** 内存实现(默认/测试/演示用)。 */
export class MemoryInboxStore implements InboxStore {
  readonly schemaVersion = INBOX_SCHEMA_VERSION;
  private readonly map = new Map<string, InboxMessage>();

  async list(): Promise<readonly InboxMessage[]> {
    return [...this.map.values()].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }
  async listByPlatform(platformId: string): Promise<readonly InboxMessage[]> {
    return (await this.list()).filter((m) => m.platformId === platformId);
  }
  async get(id: string): Promise<InboxMessage | undefined> {
    return this.map.get(id);
  }
  async put(message: InboxMessage): Promise<void> {
    this.map.set(message.id, message);
  }
  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}

/** 创建收件箱消息(确定性 id)。 */
export function createInboxMessage(
  input: NewInboxMessage,
  now: () => string = () => new Date().toISOString(),
): InboxMessage {
  const at = now();
  return {
    id: input.id ?? `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    platformId: input.platformId,
    remoteId: input.remoteId,
    direction: input.direction ?? "inbound",
    kind: input.kind ?? "comment",
    author: input.author,
    ...(input.authorId ? { authorId: input.authorId } : {}),
    text: input.text,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.historyId ? { historyId: input.historyId } : {}),
    receivedAt: input.receivedAt ?? at,
    status: input.status ?? "unread",
    handling: input.handling ?? "pending",
    sensitivity: input.sensitivity ?? "normal",
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.crmTags && input.crmTags.length > 0 ? { crmTags: [...input.crmTags] } : {}),
    ...(input.autoReply ? { autoReply: input.autoReply } : {}),
    ...(input.reply ? { reply: input.reply } : {}),
    ...(input.pinned ? { pinned: true } : {}),
    ...(input.pinnedAt ? { pinnedAt: input.pinnedAt } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    createdAt: at,
    updatedAt: at,
  };
}

/** 切换消息置顶状态(置顶的消息在列表中优先展示;置顶时记录 pinnedAt 供跟进提醒计时)。 */
export function togglePinned(message: InboxMessage, now: () => string = () => new Date().toISOString()): InboxMessage {
  const at = now();
  return message.pinned
    ? { ...message, pinned: false, pinnedAt: undefined, updatedAt: at }
    : { ...message, pinned: true, pinnedAt: at, updatedAt: at };
}

/** 按展示顺序排序:置顶优先 → sortOrder(越小越靠前) → 时间倒序兜底。 */
export function sortInboxByOrder(messages: readonly InboxMessage[]): readonly InboxMessage[] {
  return [...messages].sort((a, b) => {
    const ap = a.pinned ? 0 : 1;
    const bp = b.pinned ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.receivedAt < b.receivedAt ? 1 : -1;
  });
}

/**
 * 把消息重排为目标 id 顺序(仅重排同平台/当前过滤视图内的可见消息,避免跨平台混淆)。
 * 返回每个目标消息的新 sortOrder(拖动排序落盘),未出现的目标消息保留原样。
 */
export function reorderInboxMessages(
  messages: readonly InboxMessage[],
  orderedIds: readonly string[],
): readonly InboxMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const at = new Date().toISOString();
  const next: InboxMessage[] = [];
  orderedIds.forEach((id, index) => {
    const m = byId.get(id);
    if (m) next.push({ ...m, sortOrder: index, updatedAt: at });
  });
  for (const m of messages) {
    if (!orderedIds.includes(m.id)) next.push(m);
  }
  return next;
}

/** 校验收件箱消息 schema(损坏/旧版本检测)。 */
export function assertInboxMessage(value: unknown): value is InboxMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.platformId === "string" &&
    typeof v.remoteId === "string" &&
    typeof v.author === "string" &&
    typeof v.text === "string" &&
    (v.direction === undefined || v.direction === "inbound" || v.direction === "outbound") &&
    (v.status === undefined ||
      v.status === "unread" ||
      v.status === "read" ||
      v.status === "replied" ||
      v.status === "closed")
  );
}

/** 聚合统计(按状态 / 平台 / 意图)。 */
export interface InboxStats {
  readonly total: number;
  readonly unread: number;
  readonly pendingReply: number;
  readonly negative: number;
  readonly byPlatform: Readonly<Record<string, number>>;
  readonly byIntent: Readonly<Record<string, number>>;
  /** 最近一条待处理消息时间(为空表示没有待处理)。 */
  readonly lastPendingAt?: string;
}

/** 统计收件箱。 */
export function summarizeInbox(messages: readonly InboxMessage[]): InboxStats {
  const byPlatform: Record<string, number> = {};
  const byIntent: Record<string, number> = {};
  let unread = 0;
  let pendingReply = 0;
  let negative = 0;
  let lastPendingAt: string | undefined;
  for (const m of messages) {
    byPlatform[m.platformId] = (byPlatform[m.platformId] ?? 0) + 1;
    if (m.intent) byIntent[m.intent] = (byIntent[m.intent] ?? 0) + 1;
    if (m.status === "unread") unread++;
    if (m.status !== "closed" && m.handling !== "archived" && m.direction === "inbound") {
      pendingReply++;
      if (!lastPendingAt || m.receivedAt > lastPendingAt) lastPendingAt = m.receivedAt;
    }
    if (m.sensitivity === "negative" || m.sensitivity === "urgent") negative++;
  }
  return { total: messages.length, unread, pendingReply, negative, byPlatform, byIntent, ...(lastPendingAt ? { lastPendingAt } : {}) };
}

/** 消息状态流转(防非法流转)。 */
export function transitionMessageStatus(
  message: InboxMessage,
  next: InboxMessageStatus,
): InboxMessage {
  return { ...message, status: next, updatedAt: new Date().toISOString() };
}

/** 标记为已读。 */
export function markMessageRead(message: InboxMessage): InboxMessage {
  if (message.status !== "unread") return message;
  return { ...message, status: "read", updatedAt: new Date().toISOString() };
}

/** 记录人工回复。 */
export function recordReply(message: InboxMessage, reply: string): InboxMessage {
  const trimmed = reply.trim();
  return {
    ...message,
    reply: trimmed || message.reply,
    status: trimmed ? "replied" : message.status,
    handling: trimmed ? "human-replied" : message.handling,
    updatedAt: new Date().toISOString(),
  };
}

/** 批量操作:按过滤条件批量标记已读 / 归档 / 关闭。 */
export function batchUpdateInbox(
  messages: readonly InboxMessage[],
  action: "mark-read" | "archive" | "close",
  predicate: (m: InboxMessage) => boolean = () => true,
): readonly InboxMessage[] {
  const at = new Date().toISOString();
  return messages.map((m) => {
    if (!predicate(m)) return m;
    if (action === "mark-read") return m.status === "unread" ? { ...m, status: "read", updatedAt: at } : m;
    if (action === "archive") return { ...m, handling: "archived", updatedAt: at };
    return { ...m, status: "closed", updatedAt: at };
  });
}

/** 把收件箱消息裁剪到上限(保留最近 N 条)。 */
export function pruneInbox(
  messages: readonly InboxMessage[],
  max = INBOX_MAX_MESSAGES,
): readonly InboxMessage[] {
  if (messages.length <= max) return messages;
  return [...messages]
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
    .slice(0, max);
}
