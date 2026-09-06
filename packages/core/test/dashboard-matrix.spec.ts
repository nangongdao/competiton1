/**
 * v10 Phase 1/3 内容矩阵与发布后运营闭环 —— 纯函数测试(TAG-FILTER-01 / MATRIX-01 / LOOP-01)。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import {
  aggregateByTag,
  buildContentMatrix,
  buildPostPublishLoop,
} from "../src/dashboard/matrix.js";

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

describe("aggregateByTag — TAG-FILTER-01 按标签聚合", () => {
  it("空数据安全回退", () => {
    const r = aggregateByTag([]);
    expect(r.safeFallback).toBe(true);
    expect(r.tags).toEqual([]);
  });

  it("按传入 tagOf 聚合篇数/阅读/互动", () => {
    const records = [
      rec({ id: "1", platformId: "wechat", title: "A", metrics: { views: 100, likes: 5 } }),
      rec({ id: "2", platformId: "zhihu", title: "B", metrics: { views: 200, likes: 3, shares: 1 } }),
      rec({ id: "3", platformId: "bilibili", title: "C", metrics: { views: 50 } }),
    ];
    const r = aggregateByTag(records, {
      tagOf: (rec2) => (rec2.id === "3" ? ["AI"] : ["科技"]),
    });
    expect(r.safeFallback).toBe(false);
    const tech = r.tags.find((t) => t.tag === "科技");
    expect(tech).toBeDefined();
    expect(tech?.count).toBe(2);
    expect(tech?.views).toBe(300);
    // 互动 = 5 + 3 + 1 = 9,平均 = 4(取整)。
    expect(tech?.avgEngagement).toBe(5);
    const ai = r.tags.find((t) => t.tag === "AI");
    expect(ai?.count).toBe(1);
    expect(ai?.views).toBe(50);
  });

  it("默认按标题关键词派生标签", () => {
    const r = aggregateByTag([rec({ id: "1", platformId: "wechat", title: "AI 应用指南" })]);
    expect(r.tags.some((t) => t.tag === "AI")).toBe(true);
    expect(r.tags.some((t) => t.tag === "应用指南")).toBe(true);
  });
});

describe("buildContentMatrix — MATRIX-01 内容矩阵", () => {
  it("空数据安全回退", () => {
    const m = buildContentMatrix([]);
    expect(m.safeFallback).toBe(true);
    expect(m.health).toBe("gaps");
  });

  it("单平台占比 >80% → 偏科", () => {
    const records = [
      rec({ id: "1", platformId: "wechat", title: "A", metrics: { views: 10 } }),
      rec({ id: "2", platformId: "wechat", title: "B", metrics: { views: 20 } }),
      rec({ id: "3", platformId: "wechat", title: "C", metrics: { views: 30 } }),
      rec({ id: "4", platformId: "wechat", title: "D", metrics: { views: 40 } }),
      rec({ id: "5", platformId: "zhihu", title: "E", metrics: { views: 5 } }),
    ];
    const m = buildContentMatrix(records);
    expect(m.safeFallback).toBe(false);
    expect(m.health).toBe("skewed");
    expect(m.platformCoverage.length).toBe(2);
  });

  it("覆盖均衡 → balanced", () => {
    const records = [
      rec({ id: "1", platformId: "wechat", title: "A", metrics: { views: 10 } }),
      rec({ id: "2", platformId: "zhihu", title: "B", metrics: { views: 20 } }),
    ];
    const m = buildContentMatrix(records);
    expect(m.health).toBe("balanced");
  });

  it("仅 1 平台 → 空窗", () => {
    const m = buildContentMatrix([rec({ id: "1", platformId: "wechat", title: "A", metrics: { views: 10 } })]);
    expect(m.health).toBe("gaps");
  });

  it("带标签聚合", () => {
    const records = [
      rec({ id: "1", platformId: "wechat", title: "AI", metrics: { views: 100 } }),
      rec({ id: "2", platformId: "zhihu", title: "AI", metrics: { views: 200 } }),
    ];
    const m = buildContentMatrix(records, { tagOf: () => ["科技"] });
    expect(m.byTag.length).toBe(1);
    expect(m.byTag[0]?.views).toBe(300);
  });
});

describe("buildPostPublishLoop — LOOP-01 发布后运营", () => {
  it("空数据安全回退", () => {
    const r = buildPostPublishLoop([]);
    expect(r.safeFallback).toBe(true);
    expect(r.dataGapNote).toBeTruthy();
  });

  it("无任何指标 → 数据缺口", () => {
    const r = buildPostPublishLoop([rec({ id: "1", platformId: "wechat", title: "A", metrics: {} })]);
    expect(r.followUps.length).toBe(1);
    expect(r.followUps[0]?.kind).toBe("data-gap");
  });

  it("高互动 → 待回复提醒", () => {
    const records = [
      rec({ id: "1", platformId: "wechat", title: "A", metrics: { views: 100 } }),
      rec({ id: "2", platformId: "wechat", title: "B", metrics: { views: 50, likes: 60, comments: 20 } }),
    ];
    const r = buildPostPublishLoop(records);
    const high = r.followUps.find((f) => f.kind === "high-engagement");
    expect(high).toBeDefined();
    expect(high?.title).toBe("B");
  });

  it("有阅读无互动 → 低互动复盘提醒", () => {
    const r = buildPostPublishLoop([
      rec({ id: "1", platformId: "wechat", title: "A", metrics: { views: 80 } }),
    ]);
    const low = r.followUps.find((f) => f.kind === "low-engagement");
    expect(low).toBeDefined();
    expect(low?.note).toContain("0 互动");
  });

  it("按日期聚合互动趋势", () => {
    const records = [
      rec({ id: "1", platformId: "wechat", title: "A", collectedAt: "2026-08-01T10:00:00Z", metrics: { views: 100, likes: 5 } }),
      rec({ id: "2", platformId: "zhihu", title: "B", collectedAt: "2026-08-01T12:00:00Z", metrics: { views: 200, likes: 3 } }),
    ];
    const r = buildPostPublishLoop(records);
    expect(r.engagementTrend.length).toBe(1);
    expect(r.engagementTrend[0]?.engagement).toBe(8);
    expect(r.engagementTrend[0]?.views).toBe(300);
  });
});
