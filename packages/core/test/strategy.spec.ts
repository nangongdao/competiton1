/**
 * v11 Phase 3 · STRATEGY-01 内容策略主线 + GOAL-STRATEGY-01 策略对齐目标单元测试。
 */
import { describe, it, expect } from "vitest";
import {
  buildContentStrategy,
  projectGoalAchievement,
  ruleStrategySteps,
  buildV11StrategyContext,
  v11StrategyRequest,
  strategyStepToQueueAdoption,
  strategyHourToScheduledAt,
  buildGoalReminderDigest,
} from "../src/strategy/strategy.js";
import type { PerformanceRecord } from "../src/analytics/types.js";
import type { LlmAdapter, LlmRequest } from "../src/llm/types.js";

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

/** 固定返回文本的 LLM。 */
function fakeLlm(text: string): LlmAdapter {
  return {
    id: "fake",
    available: true,
    run: async (_req: LlmRequest) => text,
  };
}

describe("ruleStrategySteps", () => {
  it("空数据返回空步骤", () => {
    expect(ruleStrategySteps([])).toEqual([]);
  });

  it("从数据派生多步策略", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "人工智能写作指南", metrics: { views: 500 } }),
      rec({ id: "b", platformId: "wechat", title: "人工智能排版技巧", metrics: { views: 400 } }),
      rec({ id: "c", platformId: "zhihu", title: "美食探店分享", metrics: { views: 50 } }),
      rec({ id: "d", platformId: "zhihu", title: "旅行攻略推荐", metrics: { views: 30 } }),
    ];
    const steps = ruleStrategySteps(records);
    expect(steps.length).toBeGreaterThan(0);
    // 应包含最佳平台加发建议。
    expect(steps.some((s) => s.kind === "increase-post" && s.platformId === "wechat")).toBe(true);
    // 所有步骤带来源。
    for (const s of steps) {
      expect(s.source).toBe("rule");
      expect(s.basis.length).toBeGreaterThan(0);
    }
  });
});

describe("projectGoalAchievement", () => {
  it("无目标安全回退", () => {
    const r = projectGoalAchievement([], { now: () => NOW });
    expect(r.status).toBe("no-goal");
    expect(r.safeFallback).toBe(true);
  });

  it("已达标 → on-track", () => {
    // 本月 8 日,目标 100,已有 500 阅读。
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: { views: 500 } }),
    ];
    const r = projectGoalAchievement(records, { now: () => NOW, monthlyViewsGoal: 100 });
    expect(r.status).toBe("on-track");
    expect(r.projection).toBe(1);
    expect(r.gap).toBe(0);
  });

  it("未达标且缺口大 → off-track + 加发建议", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: { views: 100 } }),
      rec({ id: "b", platformId: "wechat", title: "B", collectedAt: "2026-08-02T00:00:00Z", metrics: { views: 80 } }),
    ];
    const r = projectGoalAchievement(records, { now: () => NOW, monthlyViewsGoal: 10000 });
    expect(r.status).toBe("off-track");
    expect(r.gap).toBeGreaterThan(0);
    expect(r.postsNeeded).toBeGreaterThan(0);
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("中途 → at-risk", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: { views: 100 } }),
    ];
    // 8 日,日均 12.5,剩余 24 天 → 预计 ~400,目标 500 → 400/500=0.8 → at-risk。
    const r = projectGoalAchievement(records, { now: () => NOW, monthlyViewsGoal: 500 });
    expect(r.status).toBe("at-risk");
  });
});

describe("buildContentStrategy", () => {
  it("空数据安全回退", async () => {
    const r = await buildContentStrategy([], undefined, { now: () => NOW });
    expect(r.safeFallback).toBe(true);
    expect(r.steps).toEqual([]);
    expect(r.usedLlm).toBe(false);
  });

  it("无 LLM 回退规则步骤", async () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "人工智能写作指南", metrics: { views: 500 } }),
      rec({ id: "b", platformId: "wechat", title: "人工智能排版技巧", metrics: { views: 400 } }),
      rec({ id: "c", platformId: "zhihu", title: "美食探店分享", metrics: { views: 50 } }),
    ];
    const r = await buildContentStrategy(records, undefined, { now: () => NOW });
    expect(r.usedLlm).toBe(false);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.ruleSteps.length).toBeGreaterThan(0);
    expect(r.situation.length).toBeGreaterThan(0);
    expect(r.attribution.length).toBeGreaterThan(0);
  });

  it("LLM 可用时使用 LLM 输出", async () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "人工智能写作指南", metrics: { views: 500 } }),
    ];
    const llm = fakeLlm("1. 加发公众号,该平台表现最佳。\n2. 优先在 8:00 前后发布,历史数据最好。");
    const r = await buildContentStrategy(records, llm, { now: () => NOW });
    expect(r.usedLlm).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.steps[0]!.source).toBe("llm");
    // 规则兜底仍在。
    expect(r.ruleSteps.length).toBeGreaterThan(0);
  });

  it("LLM 失败回退规则", async () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "人工智能写作指南", metrics: { views: 500 } }),
    ];
    const llm: LlmAdapter = {
      id: "fail",
      available: true,
      run: async () => {
        throw new Error("boom");
      },
    };
    const r = await buildContentStrategy(records, llm, { now: () => NOW });
    expect(r.usedLlm).toBe(false);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.steps[0]!.source).toBe("rule");
  });
});

describe("buildV11StrategyContext & v11StrategyRequest", () => {
  it("空数据上下文", () => {
    expect(buildV11StrategyContext([])).toBe("暂无效果数据。");
  });

  it("含数据摘要", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "人工智能写作指南", metrics: { views: 500 } }),
    ];
    const ctx = buildV11StrategyContext(records);
    expect(ctx).toContain("最佳平台");
    expect(ctx).toContain("wechat");
  });

  it("v11StrategyRequest 结构", () => {
    const req = v11StrategyRequest("上下文");
    expect(req.task).toBe("strategy");
    expect(req.input).toContain("上下文");
    expect(req.systemPrompt).toContain("策略");
  });
});

// ---- v11 深化:STRATEGY-ADOPT-01 策略动作一键采纳到发布队列 ----
describe("strategyStepToQueueAdoption & strategyHourToScheduledAt (v11 深化)", () => {
  it("带平台+时段的步骤可直接采纳", () => {
    const step = ruleStrategySteps([
      rec({ id: "a", platformId: "wechat", title: "AI 写作入门", metrics: { views: 500 } }),
      rec({ id: "b", platformId: "zhihu", title: "AI 排版", metrics: { views: 50 } }),
    ]).find((s) => s.platformId === "wechat")!;
    expect(step.adoptable).toBe(true);
    const adoption = strategyStepToQueueAdoption(step);
    expect(adoption.ok).toBe(true);
    expect(adoption.platformIds).toContain("wechat");
    expect(adoption.summary).toContain("wechat");
  });

  it("无平台/时段步骤不可直接采纳", () => {
    const adoption = strategyStepToQueueAdoption({
      kind: "optimize-content",
      title: "优化内容",
      detail: "详情",
      source: "rule",
      basis: "依据",
      adoptable: false,
    });
    expect(adoption.ok).toBe(false);
  });

  it("strategyHourToScheduledAt 返回之后最近一次该小时", () => {
    const at = strategyHourToScheduledAt(10, { now: () => "2026-08-08T09:00:00.000Z" });
    expect(new Date(at).getUTCHours()).toBe(10);
    expect(new Date(at).getTime()).toBeGreaterThan(new Date("2026-08-08T09:00:00.000Z").getTime());
  });
});

// ---- v11 深化:GOAL-NOTIFY-01 目标达成预测接入提醒 ----
describe("buildGoalReminderDigest (v11 深化)", () => {
  it("on-track 不提醒", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: { views: 500 } }),
    ];
    const d = buildGoalReminderDigest(records, { now: () => NOW, monthlyViewsGoal: 100 });
    expect(d.status).toBe("on-track");
    expect(d.shouldNotify).toBe(false);
  });

  it("at-risk 提醒并带建议动作", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", collectedAt: "2026-08-01T00:00:00Z", metrics: { views: 100 } }),
    ];
    const d = buildGoalReminderDigest(records, { now: () => NOW, monthlyViewsGoal: 500 });
    expect(d.status).toBe("at-risk");
    expect(d.shouldNotify).toBe(true);
    expect(d.notifyTitle).toContain("预警");
    expect(d.notifyBody).toContain("建议加发");
  });

  it("无目标安全回退不提醒", () => {
    const d = buildGoalReminderDigest([], { now: () => NOW });
    expect(d.status).toBe("no-goal");
    expect(d.shouldNotify).toBe(false);
    expect(d.safeFallback).toBe(true);
  });
});
