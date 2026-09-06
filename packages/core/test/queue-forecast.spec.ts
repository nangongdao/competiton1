/**
 * v10 深化 · 发布队列/批次 × 效果预测 + 内容矩阵 + 待跟进提醒 —— 纯函数测试。
 *
 * 覆盖:
 * - FORECAST-QUEUE-01 UI 辅助:`forecastForQueue`(预测展示载荷 + 决策 + 平台交集);
 * - MATRIX-QUEUE 联动:`matrixQueuePlatformSuggestions`(补空窗 / 强化最佳 / 均衡 / 兜底);
 * - FOLLOWUP-NOTIFY 辅助:`buildFollowUpReminderDigest`(严重度排序 / 通知载荷 / 无跟进回退)。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import { forecastForQueue, matrixQueuePlatformSuggestions, buildFollowUpReminderDigest } from "../src/insight/queue-forecast.js";

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

describe("forecastForQueue — FORECAST-QUEUE-01 UI 辅助", () => {
  it("空数据安全回退且决策建议立即发", () => {
    const v = forecastForQueue({ performanceRecords: [], now: NOW, allPassed: true });
    expect(v.safeFallback).toBe(true);
    expect(v.platforms).toEqual([]);
    expect(v.decision.kind).toBe("publish-now");
    expect(v.summary).toContain("暂无效果数据");
  });

  it("有数据时返回平台预测 + 推荐 + 决策", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
      rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", metrics: { views: 50 } }),
      rec({ id: "d", platformId: "zhihu", title: "D", metrics: { views: 60 } }),
    ];
    const v = forecastForQueue({
      performanceRecords: records,
      platformIds: ["wechat", "zhihu", "bilibili"],
      now: NOW,
    });
    expect(v.safeFallback).toBe(false);
    expect(v.platforms.length).toBe(2);
    expect(v.recommendedPlatforms.every((p) => ["wechat", "zhihu", "bilibili"].includes(p))).toBe(true);
    // 决策不推荐跳到未选平台。
    expect(v.recommendedPlatforms).not.toContain("bilibili");
    expect(v.decision.reason).toBeTruthy();
    expect(v.summary).toContain("预测完成");
  });

  it("推荐平台与已选平台取交集(不越界)", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
      rec({ id: "b", platformId: "zhihu", title: "B", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "bilibili", title: "C", metrics: { views: 300 } }),
    ];
    // 只选 wechat → 推荐只含 wechat。
    const v = forecastForQueue({ performanceRecords: records, platformIds: ["wechat"], now: NOW });
    expect(v.recommendedPlatforms).toEqual(["wechat"]);
  });

  it("存在校验阻塞问题时决策为先优化再发", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
    ];
    const v = forecastForQueue({ performanceRecords: records, allPassed: false, now: NOW });
    expect(v.decision.kind).toBe("optimize-first");
    expect(v.decision.recommendPublish).toBe(false);
  });
});

describe("matrixQueuePlatformSuggestions — MATRIX-QUEUE 联动", () => {
  it("无数据回退通用建议(全平台)", () => {
    const s = matrixQueuePlatformSuggestions([], { platformIds: ["wechat", "zhihu"], topN: 3 });
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.source).toBe("fallback");
    expect(s[0]!.platformIds).toEqual(["wechat", "zhihu"]);
  });

  it("单平台 + 已选含未覆盖平台 → 补空窗建议", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
      rec({ id: "b", platformId: "wechat", title: "B", metrics: { views: 200 } }),
    ];
    const s = matrixQueuePlatformSuggestions(records, { platformIds: ["wechat", "zhihu", "bilibili"], topN: 3 });
    // 第一条应为补空窗(wechat + zhihu + bilibili)。
    expect(s[0]!.source).toBe("matrix");
    expect(s[0]!.name).toContain("补齐平台空窗");
    expect(s[0]!.platformIds).toEqual(expect.arrayContaining(["wechat", "zhihu", "bilibili"]));
  });

  it("多平台数据 → 强化最佳 + 均衡组合(不越界)", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", metrics: { views: 300 } }),
      rec({ id: "b", platformId: "zhihu", title: "B", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "bilibili", title: "C", metrics: { views: 100 } }),
    ];
    const s = matrixQueuePlatformSuggestions(records, { platformIds: ["wechat", "zhihu", "bilibili"], topN: 2 });
    // 强化最佳:wechat + zhihu(均阅前二)。
    const best = s.find((x) => x.name.includes("强化历史最佳平台"));
    expect(best).toBeTruthy();
    expect(best!.platformIds).toEqual(["wechat", "zhihu"]);
    // 所有建议平台都在已选集合内。
    for (const item of s) {
      for (const p of item.platformIds) {
        expect(["wechat", "zhihu", "bilibili"]).toContain(p);
      }
    }
  });

  it("无任何可派生时兜底保持当前选择", () => {
    // 空 records 已回退；这里验证全部建议都不为空。
    const s = matrixQueuePlatformSuggestions([], { platformIds: [], topN: 3 });
    expect(s.length).toBeGreaterThan(0);
  });
});

describe("buildFollowUpReminderDigest — FOLLOWUP-NOTIFY 辅助", () => {
  it("无记录回退:无待跟进、不提醒", () => {
    const d = buildFollowUpReminderDigest([], { now: NOW });
    expect(d.shouldNotify).toBe(false);
    expect(d.items).toEqual([]);
    expect(d.safeFallback).toBe(true);
    expect(d.notifyTitle).toContain("无待跟进");
  });

  it("数据缺口条目最高严重度且触发提醒", () => {
    const records = [
      // 无任何指标 → 数据缺口(high)。
      rec({ id: "a", platformId: "wechat", title: "缺数据", metrics: {} }),
    ];
    const d = buildFollowUpReminderDigest(records, { now: NOW });
    expect(d.shouldNotify).toBe(true);
    expect(d.items.length).toBe(1);
    expect(d.items[0]!.kind).toBe("data-gap");
    expect(d.items[0]!.severity).toBe("high");
    expect(d.counts.high).toBe(1);
    expect(d.notifyBody).toContain("缺数据");
  });

  it("按严重度排序:high → medium → low", () => {
    const records = [
      // low:有阅读无互动。
      rec({ id: "a", platformId: "wechat", title: "低互动", metrics: { views: 100 } }),
      // high:无任何指标。
      rec({ id: "b", platformId: "zhihu", title: "缺口", metrics: {} }),
      // medium:互动高(平均 2 倍以上)。构造:两条有互动,一条高互动。
      rec({ id: "c", platformId: "bilibili", title: "高互动", metrics: { views: 100, likes: 20, comments: 10 } }),
    ];
    const d = buildFollowUpReminderDigest(records, { now: NOW });
    expect(d.items.length).toBeGreaterThanOrEqual(3);
    const order = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < d.items.length; i++) {
      expect(order[d.items[i - 1]!.severity]).toBeLessThanOrEqual(order[d.items[i]!.severity]);
    }
    expect(d.counts.high).toBe(1);
    expect(d.counts.low).toBeGreaterThanOrEqual(1);
  });

  it("通知标题与正文已拼好(供 NOTIFY 复用)", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "待跟进A", metrics: {} }),
      rec({ id: "b", platformId: "zhihu", title: "待跟进B", metrics: { views: 50 } }),
    ];
    const d = buildFollowUpReminderDigest(records, { now: NOW });
    expect(d.notifyTitle).toContain("待跟进");
    expect(d.notifyBody.length).toBeGreaterThan(0);
    expect(d.summary).toContain("条待跟进");
  });
});
