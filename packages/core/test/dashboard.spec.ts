/**
 * 运营驾驶舱 —— 纯函数测试(v8 Phase 1 DASH-01~04)。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import { buildTrendSeries } from "../src/dashboard/trend.js";
import { comparePlatforms, platformDisplayName } from "../src/dashboard/compare.js";
import { rankContent } from "../src/dashboard/ranking.js";
import { goalProgress } from "../src/dashboard/goals.js";

function rec(partial: Partial<PerformanceRecord> & { id: string; platformId: string; title: string }): PerformanceRecord {
  return {
    historyId: undefined,
    remoteId: undefined,
    remoteUrl: undefined,
    publishedAt: "2026-08-01T00:00:00.000Z",
    collectedAt: "2026-08-01T00:00:00.000Z",
    metrics: {},
    source: "manual",
    ...partial,
  };
}

describe("buildTrendSeries — 按日趋势", () => {
  it("空数据返回空序列", () => {
    const s = buildTrendSeries([]);
    expect(s.points).toEqual([]);
    expect(s.totalViews).toBe(0);
    expect(s.peakDay).toBeNull();
    expect(s.peakViews).toBe(0);
  });

  it("按日聚合阅读/互动", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T10:00:00Z", metrics: { views: 10, likes: 2 } }),
      rec({ id: "b", platformId: "wechat", title: "B", collectedAt: "2026-08-01T12:00:00Z", metrics: { views: 20, comments: 1 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", collectedAt: "2026-08-02T09:00:00Z", metrics: { views: 5 } }),
    ];
    const s = buildTrendSeries(records);
    expect(s.points).toHaveLength(2);
    expect(s.points[0].day).toBe("2026-08-01");
    expect(s.points[0].views).toBe(30);
    expect(s.points[0].likes).toBe(2);
    expect(s.points[0].comments).toBe(1);
    expect(s.points[0].count).toBe(2);
    expect(s.points[1].day).toBe("2026-08-02");
    expect(s.points[1].views).toBe(5);
    expect(s.totalViews).toBe(35);
    expect(s.totalEngagement).toBe(3);
    expect(s.peakDay).toBe("2026-08-01");
    expect(s.peakViews).toBe(30);
  });

  it("按日排序且截断到最近 maxPoints", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      rec({ id: `r${i}`, platformId: "wechat", title: `T${i}`, collectedAt: `2026-08-0${i + 1}T00:00:00Z`, metrics: { views: i + 1 } }),
    );
    const s = buildTrendSeries(records, 3);
    expect(s.points.map((p) => p.day)).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
    expect(s.points[2].views).toBe(5);
  });

  it("缺指标按 0 聚合不报错", () => {
    const records = [rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: {} })];
    const s = buildTrendSeries(records);
    expect(s.points[0].views).toBe(0);
    expect(s.points[0].likes).toBe(0);
    expect(s.peakDay).toBeNull();
  });
});

describe("comparePlatforms — 平台对比", () => {
  it("空数据 hasData=false", () => {
    const r = comparePlatforms([]);
    expect(r.hasData).toBe(false);
    expect(r.items).toEqual([]);
    expect(r.bestByViews).toBeNull();
  });

  it("按平均阅读与互动率派生", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100, likes: 10 } }),
      rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 300, likes: 30 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", metrics: { views: 80, likes: 1 } }),
    ];
    const r = comparePlatforms(records);
    expect(r.hasData).toBe(true);
    const wechat = r.items.find((i) => i.platformId === "wechat")!;
    const zhihu = r.items.find((i) => i.platformId === "zhihu")!;
    expect(wechat.count).toBe(2);
    expect(wechat.avgViews).toBe(200);
    expect(wechat.engagementRate).toBe(40 / 400); // 40 互动 / 400 阅读
    expect(zhihu.avgViews).toBe(80);
    expect(r.bestByViews).toBe("wechat");
  });

  it("缺失指标不计入互动率", () => {
    const records = [rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } })];
    const r = comparePlatforms(records);
    expect(r.items[0].engagementRate).toBe(0);
  });

  it("platformDisplayName 映射中文名", () => {
    expect(platformDisplayName("wechat")).toBe("公众号");
    expect(platformDisplayName("cnblogs")).toBe("博客园");
    expect(platformDisplayName("unknown")).toBe("unknown");
  });
});

describe("rankContent — 内容排行", () => {
  it("空数据返回空", () => {
    const r = rankContent([]);
    expect(r.hasData).toBe(false);
    expect(r.items).toEqual([]);
  });

  it("按综合得分降序", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "弱", metrics: { views: 10 } }),
      rec({ id: "b", platformId: "zhihu", title: "强", metrics: { views: 10, likes: 5, comments: 2 } }),
      rec({ id: "c", platformId: "bilibili", title: "中", metrics: { views: 50 } }),
    ];
    const r = rankContent(records, 10);
    expect(r.items[0].title).toBe("强");
    expect(r.items[1].title).toBe("中");
    expect(r.items[2].title).toBe("弱");
    expect(r.items[0].score).toBe(10 + 70);
  });

  it("limit 生效", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      rec({ id: `r${i}`, platformId: "wechat", title: `T${i}`, metrics: { views: i } }),
    );
    const r = rankContent(records, 2);
    expect(r.items).toHaveLength(2);
  });

  it("综合得分相同按发布时间新到旧", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "旧", publishedAt: "2026-08-01T00:00:00Z", metrics: { views: 1 } }),
      rec({ id: "b", platformId: "wechat", title: "新", publishedAt: "2026-08-05T00:00:00Z", metrics: { views: 1 } }),
    ];
    const r = rankContent(records, 10);
    expect(r.items[0].title).toBe("新");
  });
});

describe("goalProgress — 目标进度", () => {
  it("空数据且无目标 → 未设定", () => {
    const items = goalProgress([], { month: "2026-08" });
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.hasGoal).toBe(false);
      expect(it.progress).toBe(0);
      expect(it.achieved).toBe(false);
    }
  });

  it("按自然月统计阅读与发布数", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: { views: 30 } }),
      rec({ id: "b", platformId: "wechat", title: "B", collectedAt: "2026-08-15T00:00:00Z", metrics: { views: 70 } }),
      rec({ id: "c", platformId: "wechat", title: "C", collectedAt: "2026-07-31T00:00:00Z", metrics: { views: 999 } }),
    ];
    const items = goalProgress(records, {
      month: "2026-08",
      monthlyViewsGoal: 100,
      monthlyPostsGoal: 2,
    });
    expect(items[0].label).toBe("月阅读量");
    expect(items[0].actual).toBe(100);
    expect(items[0].goal).toBe(100);
    expect(items[0].progress).toBe(1);
    expect(items[0].achieved).toBe(true);
    expect(items[1].actual).toBe(2);
    expect(items[1].achieved).toBe(true);
    expect(items[1].remaining).toBe(0);
  });

  it("目标 0/负值安全处理", () => {
    const records = [rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 5 } })];
    const items = goalProgress(records, { month: "2026-08", monthlyViewsGoal: 0 });
    expect(items[0].hasGoal).toBe(false);
    expect(items[0].progress).toBe(0);
    expect(items[0].achieved).toBe(false);
  });

  it("未达成时 remaining 正确", () => {
    const records = [rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 40 } })];
    const items = goalProgress(records, { month: "2026-08", monthlyViewsGoal: 100 });
    expect(items[0].progress).toBeCloseTo(0.4);
    expect(items[0].remaining).toBe(60);
  });

  it("now 默认当前月", () => {
    const items = goalProgress([]);
    expect(items).toHaveLength(2);
    expect(items[0].hasGoal).toBe(false);
  });
});
