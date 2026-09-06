/**
 * 发布效果智能分析测试(insights)。
 *
 * 覆盖:
 * - 空数据返回 no-data 洞察与引导建议;
 * - buildDailyTrend 按日聚合/升序/窗口裁剪;
 * - computeGrowth 近期 vs 上一周期增长率(含分母为 0 的 null);
 * - rankPlatforms 综合得分排序与互动率;
 * - bestPostingHour 最佳时段;
 * - bestPerformingPost 最佳单篇;
 * - analyzePerformance 汇总(趋势/增长/排名/建议/洞察);
 * - 缺 remoteId 时给出数据缺口提醒。
 */
import { describe, expect, it } from "vitest";
import {
  analyzePerformance,
  bestPerformingPost,
  bestPostingHour,
  buildDailyTrend,
  computeGrowth,
  rankPlatforms,
} from "../src/analytics/insights.js";
import type { PerformanceRecord } from "../src/analytics/types.js";

/** 固定 now:2026-08-06T12:00:00Z,便于增长率窗口计算。 */
const NOW = "2026-08-06T12:00:00Z";
const now = () => NOW;

function rec(partial: Partial<PerformanceRecord> & Pick<PerformanceRecord, "platformId" | "title">): PerformanceRecord {
  return {
    id: partial.id ?? `r-${Math.random().toString(36).slice(2)}`,
    platformId: partial.platformId,
    title: partial.title,
    publishedAt: partial.publishedAt ?? "2026-08-01T10:00:00Z",
    collectedAt: partial.collectedAt ?? NOW,
    metrics: partial.metrics ?? { views: 100 },
    source: partial.source ?? "manual",
    ...(partial.remoteId !== undefined ? { remoteId: partial.remoteId } : {}),
  };
}

describe("发布效果智能分析", () => {
  it("空数据返回 no-data 洞察与引导建议", () => {
    const result = analyzePerformance([], { now });
    expect(result.trends).toEqual([]);
    expect(result.growth).toEqual([]);
    expect(result.ranking).toEqual([]);
    expect(result.insights[0]?.kind).toBe("no-data");
    expect(result.recommendations[0]).toContain("还没有效果数据");
  });

  it("buildDailyTrend 按日聚合、升序、窗口裁剪", () => {
    const records = [
      rec({ platformId: "wechat", title: "a", collectedAt: "2026-08-05T10:00:00Z", metrics: { views: 10 } }),
      rec({ platformId: "wechat", title: "b", collectedAt: "2026-08-05T22:00:00Z", metrics: { views: 20 } }),
      rec({ platformId: "wechat", title: "c", collectedAt: "2026-08-06T01:00:00Z", metrics: { views: 30 } }),
      rec({ platformId: "wechat", title: "d", collectedAt: "2026-08-03T01:00:00Z", metrics: { views: 5 } }),
    ];
    const trend = buildDailyTrend(records, 2);
    expect(trend.map((t) => t.day)).toEqual(["2026-08-05", "2026-08-06"]);
    expect(trend[0]!.views).toBe(30);
    expect(trend[1]!.views).toBe(30);
  });

  it("computeGrowth 计算近期 vs 上一周期增长率", () => {
    const records = [
      // 近 7 天(>= 2026-07-30T12:00:00Z)
      rec({ platformId: "wechat", title: "a", collectedAt: "2026-08-05T10:00:00Z", metrics: { views: 300 } }),
      // 上一周期(>= 2026-07-23T12:00:00Z 且 < 2026-07-30T12:00:00Z)
      rec({ platformId: "wechat", title: "b", collectedAt: "2026-07-25T10:00:00Z", metrics: { views: 100 } }),
      rec({ platformId: "zhihu", title: "c", collectedAt: "2026-08-04T10:00:00Z", metrics: { views: 50 } }),
    ];
    const growth = computeGrowth(records, 7, now);
    const wechat = growth.find((g) => g.platformId === "wechat");
    const zhihu = growth.find((g) => g.platformId === "zhihu");
    expect(wechat?.recentViews).toBe(300);
    expect(wechat?.previousViews).toBe(100);
    expect(wechat?.rate).toBe(2); // +200%
    // zhihu 无上一周期 → rate null
    expect(zhihu?.rate).toBeNull();
  });

  it("rankPlatforms 综合得分排序与互动率", () => {
    const records = [
      rec({ platformId: "wechat", title: "a", metrics: { views: 1000, likes: 50, comments: 10, shares: 5 } }),
      rec({ platformId: "zhihu", title: "b", metrics: { views: 100, likes: 50, comments: 20, shares: 10 } }),
    ];
    const ranking = rankPlatforms(records);
    expect(ranking[0]!.platformId).toBe("wechat"); // 平均阅读更高
    const zhihu = ranking.find((r) => r.platformId === "zhihu")!;
    expect(zhihu.engagementRate).toBeCloseTo(0.8); // (50+20+10)/100
  });

  it("bestPostingHour 返回阅读最高的时段", () => {
    const records = [
      rec({ platformId: "wechat", title: "a", publishedAt: "2026-08-05T09:30:00Z", metrics: { views: 200 } }),
      rec({ platformId: "wechat", title: "b", publishedAt: "2026-08-04T09:10:00Z", metrics: { views: 300 } }),
      rec({ platformId: "zhihu", title: "c", publishedAt: "2026-08-03T20:00:00Z", metrics: { views: 100 } }),
    ];
    const best = bestPostingHour(records);
    expect(best?.hour).toBe(9);
    expect(best?.views).toBe(500);
  });

  it("bestPerformingPost 返回阅读最高的单篇", () => {
    const records = [
      rec({ platformId: "wechat", title: "甲", metrics: { views: 50 } }),
      rec({ platformId: "zhihu", title: "乙", metrics: { views: 900 } }),
    ];
    expect(bestPerformingPost(records)?.title).toBe("乙");
  });

  it("analyzePerformance 汇总完整洞察与建议", () => {
    const records = [
      rec({ platformId: "wechat", title: "爆款", remoteId: "1001", publishedAt: "2026-08-05T09:00:00Z", collectedAt: "2026-08-05T09:00:00Z", metrics: { views: 1200, likes: 80, comments: 12, shares: 5 } }),
      rec({ platformId: "wechat", title: "旧文", remoteId: "1002", publishedAt: "2026-07-24T09:00:00Z", collectedAt: "2026-07-24T09:00:00Z", metrics: { views: 100 } }),
      rec({ platformId: "zhihu", title: "知乎答", remoteId: "2001", publishedAt: "2026-08-04T20:00:00Z", collectedAt: "2026-08-04T20:00:00Z", metrics: { views: 300, likes: 30 } }),
    ];
    const result = analyzePerformance(records, { now, recentDays: 7 });
    expect(result.trends.length).toBe(2);
    expect(result.ranking[0]!.platformId).toBe("wechat");
    expect(result.insights.some((i) => i.kind === "best-platform")).toBe(true);
    expect(result.insights.some((i) => i.kind === "growth")).toBe(true); // wechat 100→1200
    expect(result.insights.some((i) => i.kind === "best-time")).toBe(true);
    expect(result.insights.some((i) => i.kind === "content-pattern")).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("缺 remoteId 时给出数据缺口提醒", () => {
    const records = [rec({ platformId: "wechat", title: "无远端" })];
    const result = analyzePerformance(records, { now });
    expect(result.insights.some((i) => i.kind === "data-gap")).toBe(true);
    expect(result.recommendations.some((r) => r.includes("remoteId"))).toBe(true);
  });
});
