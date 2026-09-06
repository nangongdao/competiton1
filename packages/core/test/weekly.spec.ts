/**
 * v4 Phase 2 · WEEKLY-01 内容智能周报核心测试。
 *
 * 覆盖:
 * - buildWeeklyReport:近 7 天窗口裁剪 / LLM 总结段 / 规则总结兜底 / 空态;
 * - generateWeeklySummary:LLM 可用 / LLM 失败回退规则 / 空记录规则;
 * - parseWeeklySummary:JSON 数组 / 代码块包裹 / 非法回退;
 * - WeeklyReportService:创建 / 更新 / 暂停恢复 / 生成编排 / 投递记录 / 失败记录;
 * - filterByWindowDays:窗口 + 起始偏移。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildWeeklyReport,
  generateWeeklySummary,
  parseWeeklySummary,
  ruleWeeklySummary,
  weeklySummaryRequest,
  WeeklyReportService,
  filterByWindowDays,
  MemoryWeeklyStore,
  type WeeklyReportJob,
} from "../src/weekly/index.js";
import type { PerformanceRecord } from "../src/analytics/types.js";
import type { LlmAdapter, LlmRequest } from "../src/llm/types.js";

const NOW = "2026-08-08T12:00:00Z";

function rec(partial: Partial<PerformanceRecord> & Pick<PerformanceRecord, "platformId" | "title">): PerformanceRecord {
  return {
    id: partial.id ?? `r-${Math.random().toString(36).slice(2)}`,
    platformId: partial.platformId,
    title: partial.title,
    remoteId: partial.remoteId,
    remoteUrl: partial.remoteUrl,
    publishedAt: partial.publishedAt ?? "2026-08-05T10:00:00Z",
    collectedAt: partial.collectedAt ?? "2026-08-07T10:00:00Z",
    metrics: partial.metrics ?? {},
    source: partial.source ?? "manual",
  };
}

function llmReturning(text: string): LlmAdapter {
  return {
    id: "test-llm",
    available: true,
    async run(_req: LlmRequest) {
      return text;
    },
  };
}

describe("buildWeeklyReport", () => {
  it("默认近 7 天窗口,空态带窗口说明", () => {
    const report = buildWeeklyReport({ records: [], now: () => NOW });
    expect(report).toContain("# 内容周报");
    expect(report).toContain("近 7 天");
  });

  it("窗口内数据生成周报:含周报总结/规则要点/智能分析", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", metrics: { views: 1000, likes: 50 }, publishedAt: "2026-08-06T10:00:00Z" }),
      rec({ platformId: "zhihu", title: "B", metrics: { views: 500 }, publishedAt: "2026-08-05T10:00:00Z" }),
    ];
    const report = buildWeeklyReport({ records, now: () => NOW });
    expect(report).toContain("# 内容周报");
    expect(report).toContain("本周要点");
    expect(report).toContain("## 智能分析");
    expect(report).toContain("| wechat | 1 |");
  });

  it("注入 LLM 总结时插入「周报总结(LLM)」段", () => {
    const records = [rec({ platformId: "wechat", title: "A", metrics: { views: 1000 } })];
    const report = buildWeeklyReport({
      records,
      llmSummary: "本周公众号表现最佳,建议下周聚焦实操类内容。",
      now: () => NOW,
    });
    expect(report).toContain("## 周报总结(LLM)");
    expect(report).toContain("本周公众号表现最佳");
  });

  it("窗口外记录被裁剪(近 7 天不包含 10 天前)", () => {
    const records = [
      rec({ platformId: "wechat", title: "新", metrics: { views: 100 }, publishedAt: "2026-08-06T10:00:00Z" }),
      rec({ platformId: "wechat", title: "旧", metrics: { views: 999 }, publishedAt: "2026-07-25T10:00:00Z" }),
    ];
    const report = buildWeeklyReport({ records, now: () => NOW });
    // 旧记录(10 天前)不在窗口内,不出现。
    expect(report).not.toContain("旧");
  });

  it("自定义模板与标题生效", () => {
    const records = [rec({ platformId: "wechat", title: "A", metrics: { views: 1 } })];
    const report = buildWeeklyReport({ records, template: "monthly", windowDays: 30, title: "月度复盘", now: () => NOW });
    expect(report).toContain("# 月度复盘");
  });
});

describe("ruleWeeklySummary", () => {
  it("空记录给出引导性总结", () => {
    const out = ruleWeeklySummary([]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.source).toBe("rule");
  });

  it("有记录时从洞察派生总结(含最佳平台/建议)", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", metrics: { views: 1000, likes: 100 } }),
      rec({ platformId: "wechat", title: "B", metrics: { views: 1500, likes: 120 } }),
    ];
    const out = ruleWeeklySummary(records);
    expect(out.some((i) => i.text.includes("wechat"))).toBe(true);
  });
});

describe("parseWeeklySummary", () => {
  it("解析 JSON 字符串数组", () => {
    const out = parseWeeklySummary('["总结1","总结2"]');
    expect(out).toEqual(["总结1", "总结2"]);
  });

  it("兼容代码块包裹", () => {
    const out = parseWeeklySummary('```json\n["总结A"]\n```');
    expect(out).toEqual(["总结A"]);
  });

  it("非法输入回退空数组", () => {
    expect(parseWeeklySummary("not json")).toEqual([]);
    expect(parseWeeklySummary("{}")).toEqual([]);
  });
});

describe("generateWeeklySummary", () => {
  it("LLM 可用时使用 LLM 总结", async () => {
    const out = await generateWeeklySummary(llmReturning('["AI 总结"]'), [
      rec({ platformId: "wechat", title: "A" }),
    ]);
    expect(out.usedLlm).toBe(true);
    expect(out.items[0]?.text).toBe("AI 总结");
    expect(out.items[0]?.source).toBe("llm");
  });

  it("LLM 返回非法时回退规则", async () => {
    const out = await generateWeeklySummary(llmReturning("not json"), [
      rec({ platformId: "wechat", title: "A", metrics: { views: 100 } }),
    ]);
    expect(out.usedLlm).toBe(false);
    expect(out.items.every((i) => i.source === "rule")).toBe(true);
  });

  it("空记录直接规则兜底(不调 LLM)", async () => {
    const spy = vi.fn();
    const out = await generateWeeklySummary(
      {
        id: "t",
        available: true,
        async run() {
          spy();
          return "[]";
        },
      },
      [],
    );
    expect(out.usedLlm).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("weeklySummaryRequest", () => {
  it("构造包含脱敏上下文的 prompt", () => {
    const req = weeklySummaryRequest([rec({ platformId: "wechat", title: "A", remoteUrl: "https://x/secret", metrics: { views: 1 } })]);
    expect(req.task).toBe("rewrite");
    expect(req.input).toContain("周效果数据");
    expect(req.input).not.toContain("secret");
  });
});

describe("WeeklyReportService", () => {
  it("创建周报任务(默认 weekly 模板 + 近 7 天)", async () => {
    const svc = new WeeklyReportService({ now: () => NOW });
    const job = await svc.create({ name: "主编周报" });
    expect(job.name).toBe("主编周报");
    expect(job.template).toBe("weekly");
    expect(job.windowDays).toBe(7);
    expect(job.status).toBe("enabled");
    expect(job.deliveries).toEqual([]);
  });

  it("更新 / 暂停 / 恢复 / 删除(状态机守卫)", async () => {
    const svc = new WeeklyReportService({ now: () => NOW });
    const job = await svc.create({ name: "A" });
    const updated = await svc.update(job.id, { name: "B", windowDays: 14, useLlm: false });
    expect(updated.name).toBe("B");
    expect(updated.windowDays).toBe(14);
    expect(updated.useLlm).toBe(false);

    const paused = await svc.pause(job.id);
    expect(paused.status).toBe("paused");
    const resumed = await svc.resume(job.id);
    expect(resumed.status).toBe("enabled");

    await svc.remove(job.id);
    const removed = await svc.get(job.id);
    expect(removed?.status).toBe("removed");
  });

  it("generate:成功生成周报并记录运行历史(含投递结果)", async () => {
    const records = [rec({ platformId: "wechat", title: "A", metrics: { views: 100 } })];
    const deliverer = {
      async deliver(_job: WeeklyReportJob, delivery: { kind: string }) {
        return { kind: delivery.kind, ok: true, message: "ok" } as const;
      },
    };
    const svc = new WeeklyReportService({
      now: () => NOW,
      recordsProvider: async () => records,
      deliverer,
    });
    const job = await svc.create({ name: "周报", deliveries: [{ kind: "email", target: "boss@example.com" }] });
    const run = await svc.generate(job.id);
    expect(run.outcome).toBe("succeeded");
    expect(run.recordsUsed).toBe(1);
    expect(run.reportLength).toBeGreaterThan(0);
    expect(run.deliveryResults?.[0]?.ok).toBe(true);
    expect(run.deliveryResults?.[0]?.kind).toBe("email");

    const stored = await svc.get(job.id);
    expect(stored?.runs[0]?.seq).toBe(1);
  });

  it("generate:未注入投递器时投递渠道返回 skipped 提示", async () => {
    const svc = new WeeklyReportService({
      now: () => NOW,
      recordsProvider: async () => [rec({ platformId: "wechat", title: "A" })],
    });
    const job = await svc.create({ deliveries: [{ kind: "webhook", target: "https://example.com/hook" }] });
    const run = await svc.generate(job.id);
    expect(run.outcome).toBe("succeeded");
    expect(run.deliveryResults?.[0]?.ok).toBe(false);
    expect(run.deliveryResults?.[0]?.message).toContain("未配置");
  });

  it("generate:未启用任务返回 skipped", async () => {
    const svc = new WeeklyReportService({ now: () => NOW });
    const job = await svc.create({ name: "暂停的周报" });
    await svc.pause(job.id);
    const run = await svc.generate(job.id);
    expect(run.outcome).toBe("skipped");
  });

  it("generate:recordsProvider 抛错 → failed 并记录错误", async () => {
    const svc = new WeeklyReportService({
      now: () => NOW,
      recordsProvider: async () => {
        throw new Error("存储不可用");
      },
    });
    const job = await svc.create({ name: "报错周报" });
    const run = await svc.generate(job.id);
    expect(run.outcome).toBe("failed");
    expect(run.error).toContain("存储不可用");
  });

  it("generate:LLM 总结失败自动回退规则(不阻断生成)", async () => {
    const svc = new WeeklyReportService({
      now: () => NOW,
      recordsProvider: async () => [rec({ platformId: "wechat", title: "A", metrics: { views: 100 } })],
      llm: llmReturning("not json"),
    });
    const job = await svc.create({ name: "LLM 回退", useLlm: true });
    const run = await svc.generate(job.id);
    expect(run.outcome).toBe("succeeded");
    expect(run.usedLlm).toBe(false);
  });

  it("内存存储保留最近记录并裁剪", async () => {
    const store = new MemoryWeeklyStore();
    const svc = new WeeklyReportService({ store, now: () => NOW, recordsProvider: async () => [] });
    const job = await svc.create({ name: "多跑几次" });
    for (let i = 0; i < 3; i++) {
      await svc.generate(job.id);
    }
    const stored = await svc.get(job.id);
    expect(stored?.runs).toHaveLength(3);
    expect(stored?.runs[0]?.seq).toBe(3);
  });
});

describe("filterByWindowDays", () => {
  it("按窗口天数 + 起始偏移裁剪", () => {
    const records = [
      rec({ platformId: "w", title: "今", publishedAt: "2026-08-08T09:00:00Z" }),
      rec({ platformId: "w", title: "昨", publishedAt: "2026-08-07T09:00:00Z" }),
      rec({ platformId: "w", title: "上周", publishedAt: "2026-07-30T09:00:00Z" }),
    ];
    const out = filterByWindowDays(records, 7, 0, () => NOW);
    expect(out.map((r) => r.title)).toEqual(["今", "昨"]);
  });

  it("offset=1 时窗口整体前移一天", () => {
    const records = [
      rec({ platformId: "w", title: "今", publishedAt: "2026-08-08T09:00:00Z" }),
      rec({ platformId: "w", title: "昨", publishedAt: "2026-08-07T09:00:00Z" }),
      rec({ platformId: "w", title: "前日", publishedAt: "2026-08-06T09:00:00Z" }),
    ];
    const out = filterByWindowDays(records, 7, 1, () => NOW);
    // 今天被排除,昨天+前日保留。
    expect(out.map((r) => r.title)).toEqual(["昨", "前日"]);
  });
});
