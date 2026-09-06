/**
 * v10 Phase 1 · REFRESH-QUEUE-01 老化内容批量翻新入队 —— 纯函数测试。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import { detectAgingContent } from "../src/lifecycle/aging.js";
import { planRefreshQueue, refreshableAgingItems } from "../src/lifecycle/refresh-queue.js";

function rec(partial: Partial<PerformanceRecord> & { id: string; platformId: string; title: string }): PerformanceRecord {
  return {
    historyId: undefined,
    remoteId: undefined,
    remoteUrl: undefined,
    publishedAt: "2026-08-01T10:00:00.000Z",
    collectedAt: "2026-08-01T10:00:00.000Z",
    metrics: {},
    source: "manual",
    ...partial,
  };
}

const NOW = () => "2026-08-07T00:00:00.000Z";

describe("refreshableAgingItems — 取可翻新条目", () => {
  it("只返回 action=refresh", () => {
    const items = [
      { action: "refresh" as const, title: "A" },
      { action: "reuse" as const, title: "B" },
      { action: "refresh" as const, title: "C" },
    ];
    const r = refreshableAgingItems(items);
    expect(r.map((i) => i.title)).toEqual(["A", "C"]);
  });
});

describe("planRefreshQueue — REFRESH-QUEUE-01 批量翻新入队计划", () => {
  it("无老化条目 → 空计划", () => {
    const p = planRefreshQueue([], () => undefined, { now: NOW });
    expect(p.planned).toBe(0);
    expect(p.items).toEqual([]);
    expect(p.summary).toContain("没有可翻新");
  });

  it("可翻新条目生成翻新草稿 + 排队输入 + 预测", () => {
    // 60 天前发布且阅读低迷 → refresh。
    const records = [
      rec({ id: "old", platformId: "wechat", title: "旧文", publishedAt: "2026-06-01T10:00:00Z", metrics: { views: 10 } }),
      rec({ id: "hot", platformId: "wechat", title: "热文", publishedAt: "2026-08-05T10:00:00Z", metrics: { views: 500 } }),
    ];
    const aging = detectAgingContent(records, { now: NOW });
    const refreshItems = refreshableAgingItems(aging.items);
    expect(refreshItems.length).toBeGreaterThan(0);

    const p = planRefreshQueue(
      refreshItems,
      (draftId, title) => (draftId === "old" || title === "旧文" ? { title: "旧文", markdown: "# 旧文\n\n正文内容" } : undefined),
      { performanceRecords: records, defaultPlatformIds: ["wechat"], now: NOW },
    );
    expect(p.planned).toBe(1);
    expect(p.failed).toBe(0);
    const item = p.items[0]!;
    expect(item.ok).toBe(true);
    expect(item.refreshed.title).toContain("旧文");
    expect(item.refreshed.markdown).toContain("翻新");
    expect(item.queueInput.name).toBe(item.refreshed.title);
    expect(item.queueInput.platformIds).toEqual(["wechat"]);
    expect(item.queueInput.scheduledAt).toBeTruthy();
    expect(item.forecast.safeFallback).toBe(false);
  });

  it("无正文的条目跳过并如实计数", () => {
    const agingItems = [
      { action: "refresh" as const, title: "无正文", draftId: "no-body" },
    ];
    const p = planRefreshQueue(
      agingItems as never,
      (draftId) => (draftId === "no-body" ? { title: "无正文", markdown: "  " } : undefined),
      { now: NOW },
    );
    expect(p.planned).toBe(0);
    expect(p.failed).toBe(1);
  });

  it("找不到草稿的条目跳过", () => {
    const agingItems = [{ action: "refresh" as const, title: "孤儿", draftId: "ghost" }];
    const p = planRefreshQueue(agingItems as never, () => undefined, { now: NOW });
    expect(p.planned).toBe(0);
    expect(p.failed).toBe(1);
  });

  it("默认排队时间 = now + 1h", () => {
    const p = planRefreshQueue(
      [{ action: "refresh" as const, title: "A", draftId: "a" }] as never,
      (_d, _t) => (_d === "a" || _t === "A" ? { title: "A", markdown: "内容" } : undefined),
      { now: NOW },
    );
    expect(p.items[0]?.queueInput.scheduledAt).toBe("2026-08-07T01:00:00.000Z");
  });
});

// ---- v11 深化:REFRESH-TRACK-CLOSED-01 翻新入队自动打标 ----
describe("planRefreshQueue refreshMark (v11 深化)", () => {
  it("翻新计划携带 refreshMark(原版→翻新标题)", () => {
    const records = [
      rec({ id: "old", platformId: "wechat", title: "旧文", publishedAt: "2026-06-01T10:00:00Z", metrics: { views: 10 } }),
      rec({ id: "hot", platformId: "wechat", title: "热文", publishedAt: "2026-08-05T10:00:00Z", metrics: { views: 500 } }),
    ];
    const aging = detectAgingContent(records, { now: NOW });
    const refreshItems = refreshableAgingItems(aging.items);
    const p = planRefreshQueue(
      refreshItems,
      (draftId, title) => (draftId === "old" || title === "旧文" ? { title: "旧文", markdown: "# 旧文\n\n正文" } : undefined),
      { now: NOW },
    );
    expect(p.items[0]!.refreshMark).toBeTruthy();
    expect(p.items[0]!.refreshMark!.originalTitle).toBe("旧文");
    expect(p.items[0]!.refreshMark!.refreshedTitle).toContain("旧文");
    expect(p.items[0]!.refreshMark!.refreshedTitle).toContain("翻新");
  });
});
