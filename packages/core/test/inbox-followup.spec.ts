/**
 * v11 INBOX-07 评论置顶后自动跟进提醒 —— 纯函数测试。
 */
import { describe, expect, it } from "vitest";
import { createInboxMessage, togglePinned } from "../src/inbox/types.js";
import { buildPinnedFollowUpDigest } from "../src/inbox/followup.js";

const NOW = "2026-08-08T10:00:00.000Z";

function msg(partial: Partial<Parameters<typeof createInboxMessage>[0]> = {}) {
  return createInboxMessage(
    {
      platformId: "xiaohongshu",
      remoteId: `r-${Math.random()}`,
      author: "测试用户",
      text: "这个多少钱?",
      ...partial,
    },
    () => NOW,
  );
}

describe("inbox/followup — INBOX-07 置顶后自动跟进提醒", () => {
  it("置顶超过阈值未回复 → 应提醒", () => {
    const m = togglePinned(msg({ author: "A" }), () => "2026-08-08T10:00:00.000Z");
    // 置顶于 10:00,当前 10:31(超 30 分钟阈值)。
    const digest = buildPinnedFollowUpDigest([m], {}, () => "2026-08-08T10:31:00.000Z");
    expect(digest.shouldNotify).toBe(true);
    expect(digest.items[0]!.overdue).toBe(true);
    expect(digest.notifyTitle).toContain("置顶评论待跟进");
  });

  it("置顶未超阈值 → 不提醒", () => {
    const m = togglePinned(msg({ author: "B" }), () => "2026-08-08T10:00:00.000Z");
    const digest = buildPinnedFollowUpDigest([m], {}, () => "2026-08-08T10:10:00.000Z");
    expect(digest.shouldNotify).toBe(false);
  });

  it("已回复的置顶消息不再提醒", () => {
    const m = { ...togglePinned(msg({ author: "C" }), () => "2026-08-08T10:00:00.000Z"), status: "replied" as const };
    const digest = buildPinnedFollowUpDigest([m], {}, () => "2026-08-08T12:00:00.000Z");
    expect(digest.shouldNotify).toBe(false);
  });

  it("取消置顶后不再参与提醒(pinnedAt 清除)", () => {
    const pinned = togglePinned(msg({ author: "D" }), () => "2026-08-08T10:00:00.000Z");
    const unpinned = togglePinned(pinned);
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.pinnedAt).toBeUndefined();
    const digest = buildPinnedFollowUpDigest([unpinned], {}, () => "2026-08-08T12:00:00.000Z");
    expect(digest.shouldNotify).toBe(false);
  });

  it("自定义阈值与 maxItems 生效", () => {
    const m = togglePinned(msg({ author: "E" }), () => "2026-08-08T10:00:00.000Z");
    const digest = buildPinnedFollowUpDigest(
      [m],
      { graceMs: 60 * 60 * 1000, maxItems: 5 },
      () => "2026-08-08T11:00:00.000Z", // 置顶 1 小时,刚达阈值
    );
    expect(digest.shouldNotify).toBe(true);
    expect(digest.items.length).toBe(1);
  });
});
