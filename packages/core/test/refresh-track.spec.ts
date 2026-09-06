/**
 * v11 Phase 1 · REFRESH-TRACK-01 翻新效果追踪单元测试。
 */
import { describe, it, expect } from "vitest";
import {
  trackRefreshPerformance,
  originalTitleFromRefreshed,
} from "../src/strategy/refresh-track.js";
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

describe("originalTitleFromRefreshed", () => {
  it("剥离翻新日期后缀", () => {
    expect(originalTitleFromRefreshed("如何写出爆款(翻新 2026-08-08)")).toBe("如何写出爆款");
  });
  it("无后缀原样返回", () => {
    expect(originalTitleFromRefreshed("如何写出爆款")).toBe("如何写出爆款");
  });
});

describe("trackRefreshPerformance", () => {
  it("空数据安全回退", () => {
    const r = trackRefreshPerformance([], { now: () => NOW });
    expect(r.safeFallback).toBe(true);
    expect(r.comparisons).toEqual([]);
  });

  it("无翻新版本安全回退", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "如何写出爆款", metrics: { views: 100 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.safeFallback).toBe(true);
    expect(r.paired).toBe(0);
  });

  it("同平台标题一致配对并判定提升", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "如何写出爆款", metrics: { views: 100, likes: 5 } }),
      rec({ id: "ref", platformId: "wechat", title: "如何写出爆款(翻新 2026-08-08)", metrics: { views: 200, likes: 12 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.paired).toBe(1);
    expect(r.improved).toBe(1);
    expect(r.totalViewDelta).toBe(100);
    expect(r.comparisons[0]!.outcome).toBe("improved");
    expect(r.comparisons[0]!.viewDeltaRate).toBe(1);
    expect(r.comparisons[0]!.engagementDelta).toBe(7);
  });

  it("判定下降", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "如何写出爆款", metrics: { views: 200 } }),
      rec({ id: "ref", platformId: "wechat", title: "如何写出爆款(翻新 2026-08-08)", metrics: { views: 80 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.declined).toBe(1);
    expect(r.comparisons[0]!.outcome).toBe("declined");
    expect(r.totalViewDelta).toBe(-120);
  });

  it("判定持平(区间内)", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "如何写出爆款", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "wechat", title: "如何写出爆款(翻新 2026-08-08)", metrics: { views: 110 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.flat).toBe(1);
    expect(r.comparisons[0]!.outcome).toBe("flat");
  });

  it("跨平台标题一致回退配对", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "如何写出爆款", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "zhihu", title: "如何写出爆款(翻新 2026-08-08)", metrics: { views: 150 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.paired).toBe(1);
    expect(r.comparisons[0]!.outcome).toBe("improved");
  });

  it("匹配不上标记未配对", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "完全不同的标题", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "wechat", title: "如何写出爆款(翻新 2026-08-08)", metrics: { views: 150 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.unpaired).toBe(1);
    expect(r.comparisons[0]!.outcome).toBe("unpaired");
    expect(r.comparisons[0]!.original).toBeUndefined();
  });

  it("自定义阈值", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "A", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "wechat", title: "A(翻新 2026-08-08)", metrics: { views: 110 } }),
    ];
    // 严格阈值: +10% 判定为提升。
    const r = trackRefreshPerformance(records, { now: () => NOW, improvedRatio: 0.05 });
    expect(r.improved).toBe(1);
  });

  it("原版无阅读数据 → flat(无法判定)", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "A", metrics: {} }),
      rec({ id: "ref", platformId: "wechat", title: "A(翻新 2026-08-08)", metrics: { views: 100 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.comparisons[0]!.outcome).toBe("flat");
    expect(r.comparisons[0]!.viewDelta).toBe(100);
  });

  it("自定义后缀模式", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "A", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "wechat", title: "A【翻新版】", metrics: { views: 160 } }),
    ];
    const r = trackRefreshPerformance(records, {
      now: () => NOW,
      refreshSuffixPattern: /【翻新版】\s*$/,
    });
    expect(r.paired).toBe(1);
    expect(r.comparisons[0]!.outcome).toBe("improved");
  });
});

// ---- v11 深化:REFRESH-TRACK-CLOSED-01 翻新入队自动打标 → 效果回收自动配对 ----
describe("trackRefreshPerformance with refreshMarks (v11 深化)", () => {
  it("优先按显式标记配对(翻新后标题被编辑也能配对)", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "如何写出爆款", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "wechat", title: "爆款重写新标题(2026)", metrics: { views: 260 } }),
    ];
    const r = trackRefreshPerformance(records, {
      now: () => NOW,
      refreshMarks: [{ originalTitle: "如何写出爆款", refreshedTitle: "爆款重写新标题(2026)" }],
    });
    expect(r.paired).toBe(1);
    expect(r.improved).toBe(1);
    expect(r.comparisons[0]!.originalTitle).toBe("如何写出爆款");
    expect(r.comparisons[0]!.refreshedTitle).toBe("爆款重写新标题(2026)");
  });

  it("无显式标记时仍按标题后缀回退匹配", () => {
    const records = [
      rec({ id: "orig", platformId: "wechat", title: "如何写出爆款", metrics: { views: 100 } }),
      rec({ id: "ref", platformId: "wechat", title: "如何写出爆款(翻新 2026-08-08)", metrics: { views: 200 } }),
    ];
    const r = trackRefreshPerformance(records, { now: () => NOW });
    expect(r.paired).toBe(1);
  });
});
