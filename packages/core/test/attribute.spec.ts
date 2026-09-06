/**
 * v11 Phase 2 · ATTRIBUTE-01 效果归因分析单元测试。
 */
import { describe, it, expect } from "vitest";
import { attributePerformance } from "../src/strategy/attribute.js";
import type { PerformanceRecord } from "../src/analytics/types.js";

const NOW = "2026-08-08T00:00:00.000Z";

function rec(partial: Partial<PerformanceRecord> & { id: string; platformId: string; title: string }): PerformanceRecord {
  return {
    collectedAt: NOW,
    publishedAt: NOW,
    metrics: {},
    source: "manual",
    ...partial,
  };
}

describe("attributePerformance", () => {
  it("空数据安全回退", () => {
    const r = attributePerformance([], { now: () => NOW });
    expect(r.safeFallback).toBe(true);
    expect(r.factors).toEqual([]);
  });

  it("数据不足安全回退", () => {
    const r = attributePerformance(
      [rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } })],
      { now: () => NOW },
    );
    expect(r.safeFallback).toBe(true);
  });

  it("平台维度归因", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 500 } }),
      rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 400 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", metrics: { views: 50 } }),
      rec({ id: "d", platformId: "zhihu", title: "D", metrics: { views: 30 } }),
    ];
    const r = attributePerformance(records, { now: () => NOW, dimensions: ["platform"] });
    expect(r.safeFallback).toBe(false);
    const platform = r.factors.find((f) => f.dimension === "platform");
    expect(platform).toBeDefined();
    expect(platform!.highFeature).toBe("wechat");
    expect(platform!.lowFeature).toBe("zhihu");
    expect(platform!.ratio).toBeGreaterThan(5);
  });

  it("时段维度归因", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 300 } }),
      rec({ id: "b", platformId: "wechat", title: "B", publishedAt: "2026-08-02T09:00:00Z", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", publishedAt: "2026-08-03T23:00:00Z", metrics: { views: 20 } }),
      rec({ id: "d", platformId: "zhihu", title: "D", publishedAt: "2026-08-04T22:00:00Z", metrics: { views: 10 } }),
    ];
    const r = attributePerformance(records, { now: () => NOW, dimensions: ["hour"] });
    const hour = r.factors.find((f) => f.dimension === "hour");
    expect(hour).toBeDefined();
    // 6-11 桶应优于 18-23 桶。
    expect(hour!.highFeature).toBe("6-11:00");
    expect(hour!.lowFeature).toBe("18-23:00");
  });

  it("标题风格维度归因", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "短", metrics: { views: 300 } }),
      rec({ id: "b", platformId: "wechat", title: "也短", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "zhihu", title: "这是一个非常非常非常长的标题用来测试归因", metrics: { views: 20 } }),
    ];
    const r = attributePerformance(records, { now: () => NOW, dimensions: ["title-style"] });
    const style = r.factors.find((f) => f.dimension === "title-style");
    expect(style).toBeDefined();
    expect(style!.highFeature).toContain("短标题");
  });

  it("标签维度归因", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "人工智能写作指南", metrics: { views: 400 } }),
      rec({ id: "b", platformId: "wechat", title: "人工智能排版技巧", metrics: { views: 300 } }),
      rec({ id: "c", platformId: "zhihu", title: "美食探店分享", metrics: { views: 20 } }),
    ];
    const r = attributePerformance(records, { now: () => NOW, dimensions: ["tag"] });
    const tag = r.factors.find((f) => f.dimension === "tag");
    expect(tag).toBeDefined();
    // deriveRuleTags 按标题分词,「人工智能写作指南」整体作为一个标签。
    expect(tag!.highFeature).toBe("人工智能写作指南");
  });

  it("维度不足安全回退", () => {
    // 只有一条平台 + 无法分桶。
    const r = attributePerformance(
      [rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } })],
      { now: () => NOW },
    );
    expect(r.safeFallback).toBe(true);
  });
});
