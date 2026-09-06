/**
 * INBOX-02 跨平台互动聚合与统一收件箱视图。
 *
 * - 把来自不同平台的消息(评论/私信/@提及/通知)归一化后聚合为一个收件箱;
 * - 提供按平台/会话/状态/关键词/时间窗口过滤、按时间排序的视图查询;
 * - 提供"按会话分组"(同平台+作者聚合)与按内容关联(historyId)分组能力;
 * - 纯函数可单测,数据落盘由 app 侧 InboxStore 接线决定。
 */
import type { InboxMessage, InboxMessageKind, InboxMessageStatus } from "./types.js";
import { sortInboxByOrder } from "./types.js";

/** 收件箱过滤条件。 */
export interface InboxFilter {
  /** 平台 id(可多个)。 */
  readonly platformIds?: readonly string[];
  /** 消息类型(评论/私信/@提及/通知)。 */
  readonly kinds?: readonly InboxMessageKind[];
  /** 状态(未读/已读/已回复/已关闭)。 */
  readonly statuses?: readonly InboxMessageStatus[];
  /** 仅待回复(未关闭且未归档且 inbound)。 */
  readonly pendingOnly?: boolean;
  /** 仅负面/紧急(评论营销引擎打标)。 */
  readonly negativeOnly?: boolean;
  /** 关键词(匹配作者/正文)。 */
  readonly keyword?: string;
  /** 关联内容(historyId)。 */
  readonly historyId?: string;
  /** 关联账号(accountId)。 */
  readonly accountId?: string;
  /** 起始时间(含)。 */
  readonly from?: string;
  /** 结束时间(含)。 */
  readonly to?: string;
}

/** 查询结果。 */
export interface InboxQueryResult {
  readonly items: readonly InboxMessage[];
  readonly total: number;
  /** 当前过滤条件下未读数。 */
  readonly unread: number;
}

/** 过滤收件箱(纯函数)。 */
export function filterInbox(
  messages: readonly InboxMessage[],
  filter: InboxFilter = {},
): readonly InboxMessage[] {
  return messages.filter((m) => {
    if (filter.platformIds && filter.platformIds.length > 0 && !filter.platformIds.includes(m.platformId)) return false;
    if (filter.kinds && filter.kinds.length > 0 && !filter.kinds.includes(m.kind)) return false;
    if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(m.status)) return false;
    if (filter.pendingOnly && (m.status === "closed" || m.handling === "archived" || m.direction !== "inbound")) return false;
    if (filter.negativeOnly && m.sensitivity !== "negative" && m.sensitivity !== "urgent") return false;
    if (filter.keyword) {
      const kw = filter.keyword.trim().toLowerCase();
      if (kw && !m.text.toLowerCase().includes(kw) && !m.author.toLowerCase().includes(kw)) return false;
    }
    if (filter.historyId && m.historyId !== filter.historyId) return false;
    if (filter.accountId && m.accountId !== filter.accountId) return false;
    if (filter.from && m.receivedAt < filter.from) return false;
    if (filter.to && m.receivedAt > filter.to) return false;
    return true;
  });
}

/** 按时间倒序排序(最近在前;置顶消息优先,再按 sortOrder 手动排序)。 */
export function sortInboxByTime(messages: readonly InboxMessage[]): readonly InboxMessage[] {
  return sortInboxByOrder(messages);
}

/** 查询收件箱(过滤 + 排序 + 统计)。 */
export function queryInbox(
  messages: readonly InboxMessage[],
  filter: InboxFilter = {},
): InboxQueryResult {
  const filtered = filterInbox(messages, filter);
  const sorted = sortInboxByTime(filtered);
  const unread = filtered.filter((m) => m.status === "unread").length;
  return { items: sorted, total: filtered.length, unread };
}

/** 会话分组键(平台 + 发送者,私信/评论按人聚合)。 */
export function threadKeyOf(m: InboxMessage): string {
  return `${m.platformId}::${m.authorId ?? m.author}`;
}

/** 一个会话线程(聚合同一人在同一平台的多条消息)。 */
export interface InboxThread {
  readonly key: string;
  readonly platformId: string;
  readonly author: string;
  readonly authorId?: string;
  readonly messageCount: number;
  readonly unreadCount: number;
  /** 最近一条消息。 */
  readonly latest: InboxMessage;
  /** 按时间倒序的完整消息列表。 */
  readonly messages: readonly InboxMessage[];
}

/** 按会话分组聚合(评论/私信按平台+发送者聚合)。 */
export function groupByThread(
  messages: readonly InboxMessage[],
  _opts: { onlyInbound?: boolean } = {},
): readonly InboxThread[] {
  const groups = new Map<string, InboxMessage[]>();
  for (const m of messages) {
    if (_opts.onlyInbound && m.direction !== "inbound") continue;
    const key = threadKeyOf(m);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  const threads: InboxThread[] = [];
  for (const [key, list] of groups) {
    const sorted = sortInboxByTime(list);
    const latest = sorted[0]!;
    threads.push({
      key,
      platformId: latest.platformId,
      author: latest.author,
      ...(latest.authorId ? { authorId: latest.authorId } : {}),
      messageCount: list.length,
      unreadCount: list.filter((m) => m.status === "unread").length,
      latest,
      messages: sorted,
    });
  }
  return threads.sort((a, b) => (a.latest.receivedAt < b.latest.receivedAt ? 1 : -1));
}

/** 按内容(historyId)聚合。 */
export function groupByContent(
  messages: readonly InboxMessage[],
): Readonly<Record<string, readonly InboxMessage[]>> {
  const groups = new Map<string, InboxMessage[]>();
  for (const m of messages) {
    if (!m.historyId) continue;
    const list = groups.get(m.historyId) ?? [];
    list.push(m);
    groups.set(m.historyId, list);
  }
  const out: Record<string, readonly InboxMessage[]> = {};
  for (const [k, v] of groups) out[k] = sortInboxByTime(v);
  return out;
}

/** 待跟进摘要(供「发布后运营」视图 / 通知提醒复用)。 */
export interface InboxDigest {
  readonly pending: readonly InboxMessage[];
  /** 高互动待回复(2 条以上或含意图)。 */
  readonly hotThreads: readonly InboxThread[];
  readonly unreadCount: number;
  readonly negativeCount: number;
}

/** 构建待跟进摘要。 */
export function buildInboxDigest(
  messages: readonly InboxMessage[],
  _opts: { negativeThreshold?: number } = {},
): InboxDigest {
  const pending = filterInbox(messages, { pendingOnly: true });
  const threads = groupByThread(pending, { onlyInbound: true });
  const hotThreads = threads.filter(
    (t) => t.messageCount >= 2 || t.latest.intent !== undefined || t.latest.sensitivity === "urgent",
  );
  return {
    pending,
    hotThreads,
    unreadCount: messages.filter((m) => m.status === "unread").length,
    negativeCount: messages.filter((m) => m.sensitivity === "negative" || m.sensitivity === "urgent").length,
  };
}
