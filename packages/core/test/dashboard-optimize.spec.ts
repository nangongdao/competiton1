/**
 * v8 Phase 3 内容优化建议 —— 纯函数测试(OPT-01/02)。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import {
  bestTimeFromRecords,
  ruleContentSuggestions,
  generateContentOptimize,
  parseContentOptimizeJson,
  mergeOptimizeSuggestions,
  contentOptimizeRequest,
} from "../src/dashboard/optimize.js";

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

describe("bestTimeFromRecords — OPT-02 最佳发布时间学习", () => {
  it("空数据返回 hasData=false", () => {
    const r = bestTimeFromRecords([]);
    expect(r.hasData).toBe(false);
    expect(r.hour).toBeNull();
    expect(r.buckets).toEqual([]);
  });

  it("从发布时间聚合小时并选出峰值时段", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 100 } }),
      rec({ id: "b", platformId: "wechat", title: "B", publishedAt: "2026-08-02T08:30:00Z", metrics: { views: 200 } }),
      rec({ id: "c", platformId: "zhihu", title: "C", publishedAt: "2026-08-03T18:00:00Z", metrics: { views: 50 } }),
    ];
    const r = bestTimeFromRecords(records);
    expect(r.hasData).toBe(true);
    expect(r.hour).toBe(8);
    expect(r.views).toBe(300);
    expect(r.count).toBe(2);
    expect(r.buckets.map((b) => b.hour)).toEqual([8, 18]);
    expect(r.description).toContain("8:00");
  });

  it("无阅读数据时 hour 回退到有记录的峰值小时", () => {
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: {} }),
      rec({ id: "b", platformId: "zhihu", title: "B", publishedAt: "2026-08-01T18:00:00Z", metrics: {} }),
    ];
    const r = bestTimeFromRecords(records);
    expect(r.hasData).toBe(true);
    expect(r.hour).toBe(8);
    expect(r.views).toBe(0);
  });

  it("发布时间不可解析时 hasData=false", () => {
    const records = [rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "bad-date", metrics: { views: 10 } })];
    const r = bestTimeFromRecords(records);
    expect(r.hasData).toBe(false);
    expect(r.hour).toBeNull();
  });
});

describe("ruleContentSuggestions — OPT-01 规则建议", () => {
  it("空标题 + 空正文给出 error 级建议", () => {
    const out = ruleContentSuggestions("", "", []);
    expect(out.some((s) => s.kind === "title" && s.severity === "error")).toBe(true);
    expect(out.some((s) => s.kind === "body" && s.severity === "error")).toBe(true);
    expect(out.some((s) => s.kind === "data-gap")).toBe(true);
  });

  it("标题超长给出可截断修复动作", () => {
    const md = "# " + "很".repeat(40) + "\n\n正文内容若干字。";
    const out = ruleContentSuggestions(md, "很".repeat(40), []);
    const title = out.find((s) => s.id === "opt-title-long")!;
    expect(title).toBeTruthy();
    expect(title.fix?.kind).toBe("truncate-title");
    const applied = title.fix!.apply(md);
    expect(applied).not.toContain("很".repeat(40));
  });

  it("超长段落给出拆段修复", () => {
    const longPara = "这是第一句。".repeat(30); // 约 150+ 字
    const md = `# 标题\n\n${longPara}\n\n结尾。`;
    const out = ruleContentSuggestions(md, "标题", []);
    const body = out.find((s) => s.id === "opt-body-long-para")!;
    expect(body).toBeTruthy();
    expect(body.fix?.kind).toBe("split-paragraph");
    const applied = body.fix!.apply(md);
    // 拆段会插入换行,断言段落分隔变多而非长度变小。
    const breaksBefore = (md.match(/\n\n/g) ?? []).length;
    const breaksAfter = (applied.match(/\n\n/g) ?? []).length;
    expect(breaksAfter).toBeGreaterThan(breaksBefore);
    expect(applied).toContain("\n\n");
  });

  it("连续空行给出压缩修复", () => {
    const md = "# 标题\n\n\n\n正文。\n\n\n\n结尾。";
    const out = ruleContentSuggestions(md, "标题", []);
    const fix = out.find((s) => s.kind === "body" && s.fix?.kind === "collapse-blank-lines");
    expect(fix).toBeTruthy();
    const applied = fix!.fix!.apply(md);
    expect(applied).not.toMatch(/\n{3,}/);
  });

  it("长文无图 / 无小标题给出对应建议", () => {
    const longBody = "段落文字内容。".repeat(60); // > 500 字
    const md = `# 标题\n\n${longBody}`;
    const out = ruleContentSuggestions(md, "标题", []);
    expect(out.some((s) => s.kind === "image")).toBe(true);
    expect(out.some((s) => s.kind === "heading")).toBe(true);
  });

  it("有效果数据时给出时段与平台建议", () => {
    const md = "# 标题\n\n正文内容。";
    const records = [
      rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 100, likes: 10 } }),
    ];
    const out = ruleContentSuggestions(md, "标题", records);
    expect(out.some((s) => s.kind === "timing")).toBe(true);
    expect(out.some((s) => s.kind === "strategy")).toBe(true);
    expect(out.some((s) => s.kind === "data-gap")).toBe(false);
  });
});

describe("parseContentOptimizeJson / merge — LLM 解析与合并", () => {
  it("解析合法 JSON 数组", () => {
    const raw = JSON.stringify([
      { kind: "title", message: "标题可更抓人" },
      { kind: "timing", message: "建议 8:00 发布" },
    ]);
    const out = parseContentOptimizeJson(raw);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("title");
    expect(out[0].source).toBe("llm");
  });

  it("容忍代码块包裹与非法项", () => {
    const raw = '```json\n[{"kind":"body","message":"拆段"},{},{"kind":"nope","message":"x"}]\n```';
    const out = parseContentOptimizeJson(raw);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("body");
  });

  it("非法输入返回空数组", () => {
    expect(parseContentOptimizeJson("not json")).toEqual([]);
    expect(parseContentOptimizeJson('{"a":1}')).toEqual([]);
  });

  it("merge 按 kind+内容去重保留规则优先", () => {
    const rule = [{ id: "r1", kind: "title" as const, severity: "warning" as const, message: "规则标题", source: "rule" as const }];
    const llm = [
      { id: "l1", kind: "title" as const, severity: "info" as const, message: "规则标题", source: "llm" as const },
      { id: "l2", kind: "timing" as const, severity: "info" as const, message: "LLM 时段", source: "llm" as const },
    ];
    const merged = mergeOptimizeSuggestions(rule, llm);
    expect(merged.map((s) => s.kind)).toEqual(["title", "timing"]);
    expect(merged[0].message).toBe("规则标题");
    expect(merged[1].message).toBe("LLM 时段");
  });
});

describe("generateContentOptimize — 统一入口", () => {
  it("无 LLM 时纯规则,fixableCount 正确", async () => {
    const result = await generateContentOptimize(undefined, {
      title: "很".repeat(40),
      markdown: "# " + "很".repeat(40) + "\n\n正文。",
      performanceRecords: [],
      now: () => "2026-08-01T00:00:00Z",
    });
    expect(result.usedLlm).toBe(false);
    expect(result.fixableCount).toBeGreaterThan(0);
    expect(result.bestTime.hasData).toBe(false);
    expect(result.summary).toContain("规则模式");
  });

  it("LLM 失败自动回退规则", async () => {
    const failingLlm = {
      id: "fail",
      available: true,
      run: async () => {
        throw new Error("network");
      },
    };
    const result = await generateContentOptimize(failingLlm, {
      title: "标题",
      markdown: "# 标题\n\n正文内容若干字。",
      performanceRecords: [],
      now: () => "2026-08-01T00:00:00Z",
    });
    expect(result.usedLlm).toBe(false);
    expect(result.summary).toContain("回退");
  });

  it("LLM 可用时合并增强建议", async () => {
    const okLlm = {
      id: "ok",
      available: true,
      run: async () => JSON.stringify([{ kind: "timing", message: "建议 8:00 发布(LLM)" }]),
    };
    const result = await generateContentOptimize(okLlm, {
      title: "标题",
      markdown: "# 标题\n\n正文内容若干字。",
      performanceRecords: [
        rec({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 100 } }),
      ],
      now: () => "2026-08-01T00:00:00Z",
    });
    expect(result.usedLlm).toBe(true);
    expect(result.suggestions.some((s) => s.source === "llm")).toBe(true);
    expect(result.bestTime.hour).toBe(8);
  });

  it("contentOptimizeRequest 返回可运行请求", () => {
    const req = contentOptimizeRequest("标题", "# 标题\n\n正文。", []);
    expect(req.task).toBe("rewrite");
    expect(req.input).toContain("标题");
  });
});
