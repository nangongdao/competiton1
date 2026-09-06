/**
 * ROADMAP_V5 Phase 4 AI-QUEUE-01/02 —— AI 自动排期建议 + 批量排队测试。
 *
 * 覆盖:
 * - nextAtForHour:把小时建议落地为 ISO(越过 earliest);
 * - ruleScheduleSuggestions:空数据 → 通用黄金档;有效果数据 → 最佳时段/平台;
 * - scheduleRequest:prompt 含平台集合与最早时间(可脱敏);
 * - parseScheduleSuggestions:JSON 数组 / 代码块包裹 / 非法回退空;
 * - generateQueueSchedule:LLM 可用 → LLM 建议(平台交集);失败 → 规则兜底;
 * - buildQueueEntriesFromBatch:批量 AI 结果 → 队列条目输入(只排有变化的篇目)。
 */
import { describe, expect, it, vi } from "vitest";
import {
  generateQueueSchedule,
  ruleScheduleSuggestions,
  parseScheduleSuggestions,
  scheduleRequest,
  nextAtForHour,
  buildQueueEntriesFromBatch,
} from "../src/insight/queue-scheduler.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";
import type { PerformanceRecord } from "../src/analytics/types.js";

const NOW = "2026-08-06T12:00:00Z";
const now = () => NOW;

function rec(partial: Partial<PerformanceRecord> & Pick<PerformanceRecord, "platformId" | "title">): PerformanceRecord {
  return {
    id: partial.id ?? `r-${Math.random().toString(36).slice(2)}`,
    platformId: partial.platformId,
    title: partial.title,
    publishedAt: partial.publishedAt ?? "2026-08-05T18:00:00Z",
    collectedAt: partial.collectedAt ?? "2026-08-05T18:00:00Z",
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

describe("AI-QUEUE-01 排期建议核心", () => {
  it("nextAtForHour 把小时建议落地为 ISO(越过 earliest)", () => {
    // earliest 在 12:00,建议 18:00 → 当天 18:00。
    const r1 = nextAtForHour(18, "2026-08-06T12:00:00Z", now);
    expect(r1).toBe("2026-08-06T18:00:00.000Z");
    // earliest 在 20:00,建议 18:00 已过 → 下一天 18:00。
    const r2 = nextAtForHour(18, "2026-08-06T20:00:00Z", now);
    expect(r2).toBe("2026-08-07T18:00:00.000Z");
  });

  it("ruleScheduleSuggestions 空数据 → 通用黄金档", () => {
    const suggestions = ruleScheduleSuggestions([], { platformIds: ["wechat", "zhihu"], now });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]!.source).toBe("rule");
    expect(suggestions[0]!.platformIds).toContain("wechat");
    expect(Date.parse(suggestions[0]!.suggestedAt)).toBeGreaterThan(Date.parse(NOW));
  });

  it("ruleScheduleSuggestions 有效果数据 → 最佳时段/平台建议", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", publishedAt: "2026-08-05T18:00:00Z", metrics: { views: 500, likes: 30 } }),
      rec({ platformId: "wechat", title: "B", publishedAt: "2026-08-04T18:00:00Z", metrics: { views: 300, likes: 10 } }),
      rec({ platformId: "zhihu", title: "C", publishedAt: "2026-08-03T09:00:00Z", metrics: { views: 50 } }),
    ];
    const suggestions = ruleScheduleSuggestions(records, { platformIds: ["wechat", "zhihu"], now });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    // 最佳时段应为 18:00。
    expect(suggestions.some((s) => s.name.includes("18"))).toBe(true);
    // 平台建议聚焦最佳平台(wechat)。
    expect(suggestions.some((s) => s.platformIds.includes("wechat"))).toBe(true);
  });

  it("OPT-QUEUE-01 有学习时段时优先复用 bestTimeFromRecords", () => {
    // 所有记录阅读集中在 18:00(UTC),bestTimeFromRecords 应学习到 18。
    const records = [
      rec({ platformId: "wechat", title: "A", publishedAt: "2026-08-05T18:00:00Z", metrics: { views: 500 } }),
      rec({ platformId: "wechat", title: "B", publishedAt: "2026-08-04T18:00:00Z", metrics: { views: 400 } }),
      rec({ platformId: "wechat", title: "C", publishedAt: "2026-08-03T18:00:00Z", metrics: { views: 300 } }),
    ];
    const suggestions = ruleScheduleSuggestions(records, { platformIds: ["wechat"], now });
    const learned = suggestions.find((s) => s.name.includes("学习最佳时段"));
    expect(learned).toBeDefined();
    expect(learned?.name).toContain("18");
    expect(learned?.reason).toContain("3 条样本");
  });

  it("scheduleRequest 包含平台集合与最早时间", () => {
    const req = scheduleRequest([], { platformIds: ["wechat", "zhihu"], earliestAt: NOW, title: "测试" });
    expect(req.input).toContain("wechat");
    expect(req.input).toContain("zhihu");
    expect(req.input).toContain(NOW);
    expect(req.temperature).toBe(0.6);
  });

  it("parseScheduleSuggestions 解析 JSON 数组", () => {
    const raw = JSON.stringify([
      { hour: 18, platformIds: ["wechat"], name: "黄金档", reason: "阅读高" },
      { hour: 7, platformIds: ["zhihu"], name: "早间", reason: "通勤" },
    ]);
    const parsed = parseScheduleSuggestions(raw);
    expect(parsed.length).toBe(2);
    expect(parsed[0]!.hour).toBe(18);
    expect(parsed[0]!.platformIds).toEqual(["wechat"]);
  });

  it("parseScheduleSuggestions 支持代码块包裹与非法回退", () => {
    const raw = "```json\n[{\"hour\":20,\"platformIds\":[],\"name\":\"晚间\",\"reason\":\"x\"}]\n```";
    expect(parseScheduleSuggestions(raw).length).toBe(1);
    expect(parseScheduleSuggestions("not json").length).toBe(0);
    expect(parseScheduleSuggestions('[{"hour":25,"name":"bad"}]').length).toBe(0);
  });

  it("generateQueueSchedule LLM 可用 → LLM 建议(平台交集)", async () => {
    const llm = makeLlm(
      JSON.stringify([
        { hour: 18, platformIds: ["wechat", "csdn"], name: "黄金档", reason: "阅读高" },
      ]),
    );
    const result = await generateQueueSchedule(llm, {
      performanceRecords: [],
      platformIds: ["wechat", "zhihu"],
      now,
    });
    expect(result.usedLlm).toBe(true);
    expect(result.suggestions.length).toBe(1);
    // csdn 不在允许集合内 → 被过滤,只留 wechat。
    expect(result.suggestions[0]!.platformIds).toEqual(["wechat"]);
    expect(result.suggestions[0]!.source).toBe("llm");
  });

  it("generateQueueSchedule LLM 失败/空 → 规则兜底", async () => {
    const llm = makeLlm("not json");
    const result = await generateQueueSchedule(llm, {
      performanceRecords: [],
      platformIds: ["wechat"],
      now,
    });
    expect(result.usedLlm).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]!.source).toBe("rule");
  });

  it("generateQueueSchedule 未配置 LLM → 直接规则", async () => {
    const result = await generateQueueSchedule(undefined, {
      performanceRecords: [],
      platformIds: ["wechat"],
      now,
    });
    expect(result.usedLlm).toBe(false);
    expect(result.summary).toContain("规则");
  });
});

describe("AI-QUEUE-02 批量 AI 一键排队", () => {
  it("buildQueueEntriesFromBatch 只排有变化的篇目", () => {
    const specs = buildQueueEntriesFromBatch(
      [
        { id: "d1", title: "文章一", changed: true },
        { id: "d2", title: "文章二", changed: false },
        { id: "current", title: "当前编辑", changed: true },
      ],
      { platformIds: ["wechat", "zhihu"], scheduledAt: "2026-08-07T18:00:00Z" },
    );
    expect(specs.length).toBe(2);
    expect(specs[0]!.draftId).toBe("d1");
    expect(specs[1]!.draftId).toBeUndefined(); // current → 省略 draftId(store 先保存)
    expect(specs[0]!.scheduledAt).toBe("2026-08-07T18:00:00Z");
    expect(specs[0]!.platformIds).toEqual(["wechat", "zhihu"]);
    expect(specs[0]!.realPublish).toBe(true);
  });

  it("buildQueueEntriesFromBatch 无平台时留空(store 回退到已选平台)", () => {
    const specs = buildQueueEntriesFromBatch(
      [{ id: "d1", title: "文章一", changed: true }],
      { scheduledAt: "2026-08-07T18:00:00Z", now },
    );
    expect(specs.length).toBe(1);
    // 空数组 = 使用当前已选平台(store 层回退)。
    expect(specs[0]!.platformIds).toEqual([]);
  });

  it("buildQueueEntriesFromBatch 全部无变化 → 空数组", () => {
    const specs = buildQueueEntriesFromBatch(
      [{ id: "d1", title: "文章一", changed: false }],
      { platformIds: ["wechat"] },
    );
    expect(specs.length).toBe(0);
  });
});
