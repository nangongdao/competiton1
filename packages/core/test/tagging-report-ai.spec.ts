/**
 * v9 Phase 3 统一标签 + AI 报告解读 —— 纯函数测试(TAG-01 / REPORT-AI-01)。
 */
import { describe, expect, it } from "vitest";
import {
  deriveRuleTags,
  mergeTags,
  parseLlmTags,
  deriveContentTags,
  llmTagRequest,
} from "../src/tagging/tagging.js";
import {
  ruleReportInsight,
  parseReportInsightJson,
  summarizeReportWithLlm,
  reportInsightRequest,
} from "../src/report/ai-insight.js";

describe("deriveRuleTags — TAG-01 规则标签", () => {
  it("从标题与正文提炼标签", () => {
    const tags = deriveRuleTags({
      title: "高效写作技巧",
      contentText: "写作效率提升方法,写作技巧分享,内容创作经验。",
    });
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((t) => t.includes("写作"))).toBe(true);
  });

  it("附加标签合并归一", () => {
    const tags = deriveRuleTags({
      title: "AI 工具",
      extraTags: ["效率", " 写作 ", "AI"],
    });
    expect(tags).toContain("效率");
    expect(tags).toContain("写作");
    expect(tags).toContain("ai");
  });

  it("空输入返回空", () => {
    expect(deriveRuleTags({})).toEqual([]);
  });

  it("上限保护", () => {
    const tags = deriveRuleTags({ title: "一 二 三 四 五 六 七 八 九 十", maxTags: 5 });
    expect(tags.length).toBeLessThanOrEqual(5);
  });
});

describe("mergeTags / parseLlmTags — TAG-01 辅助", () => {
  it("mergeTags 去重归一", () => {
    const r = mergeTags(["效率", "写作"], ["写作", " AI "]);
    expect(r).toEqual(["效率", "写作", "ai"]);
  });

  it("parseLlmTags 解析 JSON 数组", () => {
    const r = parseLlmTags('["效率", "写作"]');
    expect(r).toEqual(["效率", "写作"]);
  });

  it("parseLlmTags 解析行式", () => {
    const r = parseLlmTags("1. 效率\n2. 写作");
    expect(r).toEqual(["效率", "写作"]);
  });
});

describe("deriveContentTags — TAG-01 入口", () => {
  it("无 LLM 时回退规则", async () => {
    const r = await deriveContentTags({ title: "测试标题" }, undefined);
    expect(r.usedLlm).toBe(false);
    expect(r.tags.length).toBeGreaterThan(0);
  });

  it("LLM 可用时合并 LLM 标签", async () => {
    const fakeLlm = {
      available: true,
      run: async () => '["llm标签"]',
    };
    const r = await deriveContentTags({ title: "规则标题" }, fakeLlm as never);
    expect(r.usedLlm).toBe(true);
    expect(r.tags).toContain("llm标签");
  });

  it("LLM 失败回退规则", async () => {
    const fakeLlm = {
      available: true,
      run: async () => {
        throw new Error("boom");
      },
    };
    const r = await deriveContentTags({ title: "规则标题" }, fakeLlm as never);
    expect(r.usedLlm).toBe(false);
    expect(r.tags.length).toBeGreaterThan(0);
  });

  it("llmTagRequest 构造 prompt", () => {
    const req = llmTagRequest({ title: "标题", contentText: "正文" });
    expect(req.input).toContain("标题");
    expect(req.input).toContain("正文");
    expect(req.task).toBe("rewrite");
  });
});

describe("ruleReportInsight — REPORT-AI-01 规则解读", () => {
  const report = `
# 周报

## 概览
本周总阅读 **1200**,较上周 **增长 25%**。
小红书阅读 **下滑 10%**,需关注。

## 行动建议
建议下一步在最佳时段发布。
优先修复公众号封面问题。
`;

  it("提取亮点 / 问题 / 行动", () => {
    const r = ruleReportInsight(report);
    expect(r.highlights.length).toBeGreaterThan(0);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.actions.length).toBeGreaterThan(0);
    expect(r.usedLlm).toBe(false);
  });

  it("空报告不报错", () => {
    const r = ruleReportInsight("");
    expect(r.highlights).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.actions).toEqual([]);
  });
});

describe("summarizeReportWithLlm — REPORT-AI-01 入口", () => {
  const report = "# 周报\n本周增长 25%,小红书下滑。\n建议下一步优化。";

  it("无 LLM 回退规则", async () => {
    const r = await summarizeReportWithLlm(report, undefined);
    expect(r.usedLlm).toBe(false);
  });

  it("LLM 可用时返回三段式", async () => {
    const fakeLlm = {
      available: true,
      run: async () => JSON.stringify({ highlights: ["增长25%"], issues: ["小红书下滑"], actions: ["优化"] }),
    };
    const r = await summarizeReportWithLlm(report, fakeLlm as never);
    expect(r.usedLlm).toBe(true);
    expect(r.highlights).toContain("增长25%");
    expect(r.issues).toContain("小红书下滑");
    expect(r.actions).toContain("优化");
  });

  it("LLM 失败回退规则", async () => {
    const fakeLlm = {
      available: true,
      run: async () => {
        throw new Error("boom");
      },
    };
    const r = await summarizeReportWithLlm(report, fakeLlm as never);
    expect(r.usedLlm).toBe(false);
  });
});

describe("parseReportInsightJson — REPORT-AI-01 解析", () => {
  it("解析合法 JSON", () => {
    const r = parseReportInsightJson('{"highlights":["a"],"issues":["b"],"actions":["c"]}');
    expect(r?.highlights).toEqual(["a"]);
    expect(r?.issues).toEqual(["b"]);
    expect(r?.actions).toEqual(["c"]);
  });

  it("非法 JSON 返回 null", () => {
    expect(parseReportInsightJson("not json")).toBeNull();
  });
});

describe("reportInsightRequest — REPORT-AI-01 prompt", () => {
  it("包含报告内容", () => {
    const req = reportInsightRequest("报告正文");
    expect(req.input).toContain("报告正文");
    expect(req.task).toBe("rewrite");
  });
});
