/**
 * INBOX-04 runner 评论网页自动化 —— 选择器契约 + 归一化测试(纯逻辑,无浏览器)。
 */
import { describe, expect, it } from "vitest";
import {
  COMMENT_SYNC_SELECTORS,
  COMMENT_REPLY_SELECTORS,
  assertValidCommentSyncSelectors,
  assertValidCommentReplySelectors,
  assertAllCommentSelectors,
  isCommentAutomationPlatform,
} from "../src/comment/selectors.js";
import { normalizeScrapedItem } from "../src/comment/automation.js";

describe("INBOX-04 评论同步/回发选择器契约", () => {
  it("全部会话平台已注册同步与回发选择器且通过契约校验", () => {
    assertAllCommentSelectors();
    for (const pid of ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs"]) {
      expect(COMMENT_SYNC_SELECTORS[pid]).toBeDefined();
      expect(COMMENT_REPLY_SELECTORS[pid]).toBeDefined();
      expect(COMMENT_SYNC_SELECTORS[pid]!.pageUrl).toMatch(/^https?:\/\//);
    }
  });

  it("isCommentAutomationPlatform 只放行会话平台", () => {
    expect(isCommentAutomationPlatform("zhihu")).toBe(true);
    expect(isCommentAutomationPlatform("bilibili")).toBe(true);
    expect(isCommentAutomationPlatform("wechat")).toBe(false); // 公众号走 server
    expect(isCommentAutomationPlatform("douyin")).toBe(true); // 短视频会话平台
    expect(isCommentAutomationPlatform("unknown-foo")).toBe(false);
  });

  it("非法选择器被契约校验拒绝", () => {
    expect(() =>
      assertValidCommentSyncSelectors("zhihu", {
        version: "2026-08",
        pageUrl: "https://x",
        items: "",
        author: "a",
        text: "b",
      }),
    ).toThrow(/items/);
    expect(() =>
      assertValidCommentReplySelectors("zhihu", {
        version: "bad",
        input: ["textarea"],
        submit: ["button"],
      }),
    ).toThrow(/version/);
  });

  it("normalizeScrapedItem 归一化 + 评论营销打标", () => {
    const item = normalizeScrapedItem({
      remoteId: "zhihu-123",
      author: "知乎用户",
      text: "这个多少钱?",
    });
    expect(item?.remoteId).toBe("zhihu-123");
    expect(item?.kind).toBe("comment");
    expect(item?.author).toBe("知乎用户");
    expect(item?.intent).toBe("price-inquiry");
    expect(item?.autoReply).toBeTruthy();
  });

  it("normalizeScrapedItem 缺 remoteId/text 返回 undefined", () => {
    expect(normalizeScrapedItem({ remoteId: "x" })).toBeUndefined();
    expect(normalizeScrapedItem({ text: "hi" })).toBeUndefined();
  });
});
