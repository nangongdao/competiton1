/**
 * v11 Part 1 · 统一收件箱(互动与私信聚合)纯函数测试。
 */
import { describe, expect, it } from "vitest";
import {
  createInboxMessage,
  transitionMessageStatus,
  markMessageRead,
  recordReply,
  batchUpdateInbox,
  pruneInbox,
  summarizeInbox,
  assertInboxMessage,
  togglePinned,
  sortInboxByOrder,
  reorderInboxMessages,
  INBOX_MAX_MESSAGES,
} from "../src/inbox/types.js";
import {
  filterInbox,
  queryInbox,
  groupByThread,
  groupByContent,
  buildInboxDigest,
  threadKeyOf,
} from "../src/inbox/aggregate.js";

const NOW = () => "2026-08-07T00:00:00.000Z";

function msg(partial: Partial<Parameters<typeof createInboxMessage>[0]> = {}) {
  return createInboxMessage(
    {
      platformId: "xiaohongshu",
      remoteId: `r-${Math.random()}`,
      author: "测试用户",
      text: "测试内容",
      ...partial,
    },
    NOW,
  );
}

describe("inbox/types — INBOX-01 收件箱消息模型", () => {
  it("创建消息带默认值", () => {
    const m = msg();
    expect(m.status).toBe("unread");
    expect(m.handling).toBe("pending");
    expect(m.sensitivity).toBe("normal");
    expect(m.direction).toBe("inbound");
    expect(m.kind).toBe("comment");
    expect(m.receivedAt).toBe(NOW());
    expect(assertInboxMessage(m)).toBe(true);
  });

  it("状态流转与已读/回复", () => {
    const m = msg();
    const read = markMessageRead(m);
    expect(read.status).toBe("read");
    // 已读不再变化。
    expect(markMessageRead(read).status).toBe("read");
    const replied = recordReply(read, " 好的,已私信你 ");
    expect(replied.status).toBe("replied");
    expect(replied.handling).toBe("human-replied");
    expect(replied.reply).toBe("好的,已私信你");
  });

  it("非法流转被防御(transitionMessageStatus 只改状态)", () => {
    const m = msg();
    const closed = transitionMessageStatus(m, "closed");
    expect(closed.status).toBe("closed");
  });

  it("批量操作", () => {
    const msgs = [msg({ status: "unread" }), msg({ status: "read" }), msg({ status: "closed" })];
    // mark-read 只把 unread → read,其余保持。
    const batch = batchUpdateInbox(msgs, "mark-read");
    expect(batch[0]!.status).toBe("read");
    expect(batch[1]!.status).toBe("read");
    expect(batch[2]!.status).toBe("closed");
    const archived = batchUpdateInbox(batch, "archive");
    expect(archived.filter((m) => m.handling === "archived").length).toBe(3);
    // 带条件:只归档 unread 状态。
    const partial = batchUpdateInbox(msgs, "archive", (m) => m.status === "unread");
    expect(partial.filter((m) => m.handling === "archived").length).toBe(1);
  });

  it("裁剪到上限", () => {
    const msgs = Array.from({ length: INBOX_MAX_MESSAGES + 50 }, (_, i) =>
      msg({ receivedAt: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` }),
    );
    const pruned = pruneInbox(msgs);
    expect(pruned.length).toBe(INBOX_MAX_MESSAGES);
  });

  it("汇总统计", () => {
    const msgs = [
      msg({ status: "unread", sensitivity: "negative", intent: "price-inquiry" }),
      msg({ status: "read" }),
      msg({ platformId: "wechat", kind: "direct-message", status: "unread" }),
    ];
    const s = summarizeInbox(msgs);
    expect(s.total).toBe(3);
    expect(s.unread).toBe(2);
    expect(s.pendingReply).toBe(3);
    expect(s.negative).toBe(1);
    expect(s.byPlatform["xiaohongshu"]).toBe(2);
    expect(s.byIntent["price-inquiry"]).toBe(1);
  });
});

describe("inbox/aggregate — INBOX-02 聚合与查询", () => {
  it("按条件过滤", () => {
    const msgs = [
      msg({ platformId: "xiaohongshu", status: "unread" }),
      msg({ platformId: "wechat", kind: "direct-message", status: "read" }),
      msg({ platformId: "zhihu", status: "closed" }),
    ];
    expect(filterInbox(msgs, { platformIds: ["wechat"] }).length).toBe(1);
    expect(filterInbox(msgs, { kinds: ["direct-message"] }).length).toBe(1);
    expect(filterInbox(msgs, { statuses: ["unread"] }).length).toBe(1);
    expect(filterInbox(msgs, { pendingOnly: true }).length).toBe(2);
    expect(filterInbox(msgs, { keyword: "测试内容" }).length).toBe(3);
    expect(filterInbox(msgs, { keyword: "不存在" }).length).toBe(0);
  });

  it("按时间倒序查询并统计未读", () => {
    const msgs = [
      msg({ receivedAt: "2026-08-01T00:00:00Z", status: "unread" }),
      msg({ receivedAt: "2026-08-03T00:00:00Z", status: "read" }),
      msg({ receivedAt: "2026-08-02T00:00:00Z", status: "unread" }),
    ];
    const q = queryInbox(msgs);
    expect(q.total).toBe(3);
    expect(q.unread).toBe(2);
    expect(q.items[0]!.receivedAt).toBe("2026-08-03T00:00:00Z");
  });

  it("按会话分组", () => {
    const msgs = [
      msg({ platformId: "xiaohongshu", author: "A", status: "unread" }),
      msg({ platformId: "xiaohongshu", author: "A", status: "read" }),
      msg({ platformId: "wechat", author: "B", status: "unread" }),
    ];
    const threads = groupByThread(msgs);
    expect(threads.length).toBe(2);
    const tA = threads.find((t) => t.author === "A")!;
    expect(tA.messageCount).toBe(2);
    expect(tA.unreadCount).toBe(1);
    expect(threadKeyOf(msgs[0]!)).toBe(threadKeyOf(msgs[1]!));
  });

  it("按内容聚合", () => {
    const msgs = [
      msg({ historyId: "h1", author: "A" }),
      msg({ historyId: "h1", author: "B" }),
      msg({ historyId: "h2", author: "C" }),
    ];
    const groups = groupByContent(msgs);
    expect(groups["h1"]!.length).toBe(2);
    expect(groups["h2"]!.length).toBe(1);
  });

  it("待跟进摘要(热会话/负面)", () => {
    const msgs = [
      msg({ author: "A", status: "unread" }),
      msg({ author: "A", status: "unread" }),
      msg({ author: "B", status: "unread", sensitivity: "negative" }),
      msg({ author: "C", status: "closed" }),
    ];
    const d = buildInboxDigest(msgs);
    expect(d.unreadCount).toBe(3);
    expect(d.negativeCount).toBe(1);
    expect(d.hotThreads.length).toBeGreaterThanOrEqual(1);
    expect(d.pending.length).toBe(3);
  });
});


describe("inbox/types — INBOX-05 消息拖动排序", () => {
  it("sortInboxByOrder:置顶优先 → sortOrder → 时间倒序", () => {
    const older = msg({ author: "A", receivedAt: "2026-08-01T00:00:00.000Z" });
    const newer = msg({ author: "B", receivedAt: "2026-08-08T00:00:00.000Z" });
    const pinned = msg({ author: "C", receivedAt: "2026-08-08T00:00:00.000Z", pinned: true });
    const sorted = sortInboxByOrder([older, newer, pinned]);
    expect(sorted[0]!.id).toBe(pinned.id); // 置顶优先
    expect(sorted[1]!.id).toBe(newer.id); // 无 sortOrder,按时间倒序
  });

  it("sortInboxByOrder:sortOrder 越小越靠前", () => {
    const a = { ...msg({ author: "A", receivedAt: "2026-08-08T00:00:00.000Z" }), sortOrder: 5 };
    const b = { ...msg({ author: "B", receivedAt: "2026-08-08T00:00:00.000Z" }), sortOrder: 0 };
    const c = msg({ author: "C", receivedAt: "2026-08-09T00:00:00.000Z" });
    const sorted = sortInboxByOrder([a, b, c]);
    expect(sorted.map((m) => m.id)).toEqual([b.id, a.id, c.id]);
  });

  it("reorderInboxMessages:重排并落盘新 sortOrder,未出现消息保留", () => {
    const a = msg({ author: "A" });
    const b = msg({ author: "B" });
    const c = msg({ author: "C" });
    const reordered = reorderInboxMessages([a, b, c], [c.id, a.id]);
    const byId = new Map(reordered.map((m) => [m.id, m]));
    expect(byId.get(c.id)!.sortOrder).toBe(0);
    expect(byId.get(a.id)!.sortOrder).toBe(1);
    expect(byId.get(b.id)).toBeDefined(); // 未出现保留
    expect(byId.get(b.id)!.sortOrder).toBeUndefined();
  });

  it("togglePinned 与 sortOrder 组合不影响既有行为", () => {
    const m = msg({ author: "A" });
    const pinned = togglePinned(m);
    expect(pinned.pinned).toBe(true);
    const unpinned = togglePinned(pinned);
    expect(unpinned.pinned).toBe(false);
  });
});
