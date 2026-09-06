/**
 * v9 Phase 2 发布效果预测 —— 纯函数测试(FORECAST-01/02)。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import { forecastPerformance } from "../src/forecast/forecast.js";
import { buildPublishDecision } from "../src/forecast/decision.js";

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

describe("forecastPerformance — FORECAST-01 效果预测", () => {
  it("空数据安全回退", () => {
    const r = forecastPerformance([], { now: NOW });
    expect(r.safeFallback).toBe(true);
    expect(r.platforms).toEqual([]);
    expect(r.summary).toContain("暂无");
  });

  it("按平台聚合预测区间与推荐平台", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 100 } }),
      rec({ id: "b", platformId: "wechat", title: "B", publishedAt: "2026-08-02T08:30:00Z", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", publishedAt: "2026-08-03T18:00:00Z", metrics: { views: 50 } }),
      rec({ id: "d", platformId: "zhihu", title: "D", publishedAt: "2026-08-04T19:00:00Z", metrics: { views: 60 } }),
    ];
    const r = forecastPerformance(records, { now: NOW, topN: 2 });
    expect(r.safeFallback).toBe(false);
    expect(r.platforms.length).toBe(2);
    // 按中位降序:wechat(150) > zhihu(55)。
    expect(r.platforms[0]!.platformId).toBe("wechat");
    expect(r.recommendedPlatforms).toEqual(["wechat", "zhihu"]);
    const wx = r.platforms[0]!;
    expect(wx.range.median).toBe(150);
    expect(wx.range.lower).toBeLessThanOrEqual(wx.range.median);
    expect(wx.range.upper).toBeGreaterThanOrEqual(wx.range.median);
    expect(wx.confidence).toBeGreaterThan(0);
    // 最佳时段 8:00。
    expect(r.bestHour).toBe(8);
  });

  it("样本越多置信度越高", () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      rec({ id: `r${i}`, platformId: "wechat", title: `T${i}`, metrics: { views: 100 + i } }),
    );
    const r = forecastPerformance(records, { now: NOW });
    const wx = r.platforms.find((p) => p.platformId === "wechat")!;
    expect(wx.confidence).toBe(0.5);
  });

  it("区间不越界", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 5 } }),
      rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 10 } }),
    ];
    const r = forecastPerformance(records, { now: NOW });
    const wx = r.platforms[0]!;
    expect(wx.range.lower).toBeGreaterThanOrEqual(0);
    expect(wx.range.lower).toBeLessThanOrEqual(wx.range.upper);
  });
});

describe("buildPublishDecision — FORECAST-02 发布决策", () => {
  it("有阻塞问题 → 优化后发", () => {
    const d = buildPublishDecision({ hasBlockers: true, allPassed: false });
    expect(d.kind).toBe("optimize-first");
    expect(d.recommendPublish).toBe(false);
  });

  it("无预测数据 → 建议立即发并说明数据不足", () => {
    const d = buildPublishDecision({ allPassed: true });
    expect(d.kind).toBe("publish-now");
    expect(d.recommendPublish).toBe(true);
    expect(d.reason).toContain("暂无效果预测");
  });

  it("目标进度不足且有预测 → 立即发追目标", () => {
    const forecast = forecastPerformance(
      [
        rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
        rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 200 } }),
      ],
      { now: NOW },
    );
    const d = buildPublishDecision({
      allPassed: true,
      forecast,
      monthlyViewsGoal: 1000,
      currentMonthlyViews: 300,
    });
    expect(d.kind).toBe("publish-now");
    expect(d.recommendPublish).toBe(true);
    expect(d.reason).toContain("追");
  });

  it("预测中位极低 → 优化后发", () => {
    const forecast = forecastPerformance(
      [
        rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 1 } }),
        rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 2 } }),
      ],
      { now: NOW },
    );
    const d = buildPublishDecision({ allPassed: true, forecast });
    expect(d.kind).toBe("optimize-first");
    expect(d.recommendPublish).toBe(false);
  });

  it("目标已达成 → 改期发", () => {
    const forecast = forecastPerformance(
      [
        rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
        rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 200 } }),
      ],
      { now: NOW },
    );
    const d = buildPublishDecision({
      allPassed: true,
      forecast,
      monthlyViewsGoal: 500,
      currentMonthlyViews: 600,
    });
    expect(d.kind).toBe("reschedule");
    expect(d.recommendPublish).toBe(true);
  });
});
