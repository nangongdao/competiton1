/**
 * Phase D AI-INSIGHT-01 —— AI 发布策略建议测试。
 *
 * 覆盖:
 * - 空效果数据 → 规则兜底通用建议;
 * - 有效果数据 → 规则派生最佳平台/时段/选题建议;
 * - buildStrategyContext 上下文脱敏(不含敏感字段);
 * - LLM 可用时生成 JSON 建议(任务级参数透传);
 * - LLM 返回非法/空 → 回退规则;
 * - parseStrategySuggestions 宽松解析(JSON 数组 / 代码块包裹)。
 */
import { describe, expect, it, vi } from "vitest";
import {
  generatePublishStrategy,
  ruleStrategySuggestions,
  parseStrategySuggestions,
  buildStrategyContext,
  strategyRequest,
} from "../src/insight/publish-strategy.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";
import type { PerformanceRecord } from "../src/analytics/types.js";

const NOW = "2026-08-06T12:00:00Z";
const now = () => NOW;

function rec(partial: Partial<PerformanceRecord> & Pick<PerformanceRecord, "platformId" | "title">): PerformanceRecord {
  return {
    id: partial.id ?? `r-${Math.random().toString(36).slice(2)}`,
    platformId: partial.platformId,
    title: partial.title,
    publishedAt: partial.publishedAt ?? "2026-08-05T09:00:00Z",
    collectedAt: partial.collectedAt ?? "2026-08-05T09:00:00Z",
    metrics: partial.metrics ?? { views: 100 },
    source: partial.source ?? "manual",
    ...(partial.remoteId !== undefined ? { remoteId: partial.remoteId } : {}),
  };
}

function makeLlm(content: string) {
  return new OpenAiCompatLlm({
    baseUrl: "https://x/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    })) as unknown as typeof fetch,
  });
}

describe("AI 发布策略建议(AI-INSIGHT-01)", () => {
  it("空效果数据时规则兜底给出通用建议", async () => {
    const result = await generatePublishStrategy(undefined, { now, title: "效率工具" });
    expect(result.usedLlm).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.every((s) => s.source === "rule")).toBe(true);
    expect(result.suggestions.map((s) => s.kind)).toContain("topic");
    expect(result.suggestions.map((s) => s.kind)).toContain("platform-mix");
    expect(result.suggestions.map((s) => s.kind)).toContain("timing");
  });

  it("有效果数据时规则派生最佳平台/时段/选题", () => {
    const records = [
      rec({ platformId: "wechat", title: "爆款", remoteId: "1001", metrics: { views: 1200, likes: 80 }, publishedAt: "2026-08-05T09:00:00Z" }),
      rec({ platformId: "zhihu", title: "知乎答", remoteId: "2001", metrics: { views: 300, likes: 30 }, publishedAt: "2026-08-04T20:00:00Z" }),
    ];
    const suggestions = ruleStrategySuggestions(records, "时间管理");
    expect(suggestions.some((s) => s.kind === "platform-mix" && s.platformId === "wechat")).toBe(true);
    expect(suggestions.some((s) => s.kind === "timing")).toBe(true);
    expect(suggestions.some((s) => s.kind === "topic" && s.text.includes("时间管理"))).toBe(true);
  });

  it("buildStrategyContext 只返回脱敏上下文", () => {
    const records = [
      rec({ platformId: "wechat", title: "爆款", remoteId: "1001", remoteUrl: "https://secret.example/1", metrics: { views: 1200 } }),
    ];
    const ctx = buildStrategyContext(records);
    expect(ctx.bestPlatform).toBe("wechat");
    expect(ctx.totalRecords).toBe(1);
    const joined = ctx.insights.join("\n");
    expect(joined).not.toContain("secret.example");
    expect(joined).not.toContain("remoteId");
  });

  it("LLM 可用时生成 JSON 策略建议", async () => {
    const llm = makeLlm(
      '[{"kind":"topic","text":"做时间块方法实操篇","reason":"数据验证有效"},{"kind":"platform-mix","text":"公众号+知乎首发","reason":"阅读最高"},{"kind":"timing","text":"9:00 发布","reason":"时段最优"}]',
    );
    const records = [rec({ platformId: "wechat", title: "爆款", metrics: { views: 1200 } })];
    const result = await generatePublishStrategy(llm, { performanceRecords: records, now, title: "时间管理" });
    expect(result.usedLlm).toBe(true);
    expect(result.suggestions.length).toBe(3);
    expect(result.suggestions.every((s) => s.source === "llm")).toBe(true);
    expect(result.suggestions.map((s) => s.kind)).toEqual(["topic", "platform-mix", "timing"]);
  });

  it("LLM 返回非法/空内容时回退规则", async () => {
    const llm = makeLlm("不是 JSON");
    const records = [rec({ platformId: "wechat", title: "爆款", metrics: { views: 1200 } })];
    const result = await generatePublishStrategy(llm, { performanceRecords: records, now, title: "时间管理" });
    expect(result.usedLlm).toBe(false);
    expect(result.suggestions.every((s) => s.source === "rule")).toBe(true);
    expect(result.summary).toContain("回退");
  });

  it("parseStrategySuggestions 支持代码块包裹的 JSON 数组", () => {
    const raw = '```json\n[{"kind":"topic","text":"选题A","reason":"理由A"}]\n```';
    const parsed = parseStrategySuggestions(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.kind).toBe("topic");
    expect(parsed[0]!.text).toBe("选题A");
    expect(parsed[0]!.source).toBe("llm");
  });

  it("strategyRequest 不包含敏感字段", () => {
    const records = [
      rec({ platformId: "wechat", title: "爆款", remoteUrl: "https://secret.example/1", metrics: { views: 100 } }),
    ];
    const req = strategyRequest(records, { title: "标题", contentText: "正文" });
    expect(req.input).not.toContain("secret.example");
    expect(req.task).toBe("rewrite");
    expect(req.systemPrompt).toBeTruthy();
  });
});
