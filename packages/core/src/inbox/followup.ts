/**
 * INBOX-07 评论置顶后自动跟进提醒。
 *
 * 运营场景:把高意向/待处理评论「置顶」后,常常忘记跟进。本模块在置顶消息上
 * 记录 pinnedAt,由心跳(复用 NOTIFY 能力)检查「置顶超过阈值仍未回复」的消息,
 * 生成提醒摘要并发系统通知,点击直达收件箱。
 *
 * 设计:
 * - 纯函数可单测;提醒策略(阈值/上限)可注入;
 * - 已回复/已归档/已关闭/已取消置顶的消息不再提醒;
 * - 同一天不重复提醒(由调用方持久化 lastPinnedRemindedAt)。
 */
import type { InboxMessage } from "./types.js";

/** 置顶跟进提醒策略。 */
export interface PinnedFollowUpPolicy {
  /** 置顶超过该时长(ms)仍未回复才提醒。默认 30 分钟。 */
  readonly graceMs?: number;
  /** 单次提醒最多列出条数。默认 10。 */
  readonly maxItems?: number;
}

export const DEFAULT_PINNED_FOLLOW_UP_POLICY: Required<PinnedFollowUpPolicy> = {
  graceMs: 30 * 60 * 1000,
  maxItems: 10,
};

/** 一条需要跟进提醒的置顶消息。 */
export interface PinnedFollowUpItem {
  readonly message: InboxMessage;
  /** 置顶已持续毫秒数。 */
  readonly pinnedForMs: number;
  /** 是否已超阈值(应提醒)。 */
  readonly overdue: boolean;
}

/** 置顶跟进提醒摘要(供通知/面板展示)。 */
export interface PinnedFollowUpDigest {
  readonly shouldNotify: boolean;
  /** 应提醒的置顶消息(按置顶时长倒序)。 */
  readonly items: readonly PinnedFollowUpItem[];
  /** 置顶中的消息总数。 */
  readonly pinnedTotal: number;
  readonly notifyTitle: string;
  readonly notifyBody: string;
  readonly summary: string;
  readonly generatedAt: string;
}

/** 消息是否已处理(无需再跟进)。 */
function isHandled(message: InboxMessage): boolean {
  return (
    message.status === "replied" ||
    message.status === "closed" ||
    message.handling === "auto-replied" ||
    message.handling === "human-replied" ||
    message.handling === "archived"
  );
}

/**
 * 构建置顶跟进提醒摘要。
 * @param messages 收件箱全部消息。
 * @param policy 提醒策略(graceMs / maxItems)。
 * @param now 时间注入。
 */
export function buildPinnedFollowUpDigest(
  messages: readonly InboxMessage[],
  policy: PinnedFollowUpPolicy = {},
  now: () => string = () => new Date().toISOString(),
): PinnedFollowUpDigest {
  const graceMs = policy.graceMs ?? DEFAULT_PINNED_FOLLOW_UP_POLICY.graceMs;
  const maxItems = policy.maxItems ?? DEFAULT_PINNED_FOLLOW_UP_POLICY.maxItems;
  const at = Date.parse(now());
  const pinned = messages.filter((m) => m.pinned && m.pinnedAt);

  const items: PinnedFollowUpItem[] = pinned
    .map((m) => {
      const pinnedAt = Date.parse(m.pinnedAt!);
      const pinnedForMs = Number.isNaN(pinnedAt) ? 0 : Math.max(0, at - pinnedAt);
      return { message: m, pinnedForMs, overdue: pinnedForMs >= graceMs && !isHandled(m) };
    })
    .sort((a, b) => b.pinnedForMs - a.pinnedForMs);

  const overdue = items.filter((i) => i.overdue).slice(0, maxItems);
  const shouldNotify = overdue.length > 0;
  const platformLabel = (pid: string) => pid;
  const summary = shouldNotify
    ? `有 ${overdue.length} 条置顶评论待跟进(置顶超过 ${
        graceMs >= 3600_000 ? `${Math.round(graceMs / 3600_000)} 小时` : `${Math.round(graceMs / 60_000)} 分钟`
      } 未回复)`
    : "置顶评论均在跟进时效内";

  const notifyTitle = shouldNotify ? `置顶评论待跟进:${overdue.length} 条` : "置顶评论跟进正常";
  const notifyBody = shouldNotify
    ? overdue
        .slice(0, 5)
        .map((i) => `[${platformLabel(i.message.platformId)}] ${i.message.author}: ${i.message.text.slice(0, 30)}`)
        .join("；") + (overdue.length > 5 ? ` 等 ${overdue.length} 条` : "")
    : "无超时未回复的置顶评论";

  return {
    shouldNotify,
    items,
    pinnedTotal: pinned.length,
    notifyTitle,
    notifyBody,
    summary,
    generatedAt: now(),
  };
}
