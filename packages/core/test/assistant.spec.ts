import { describe, expect, it } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import { scoreTypography } from "../src/quality/typography.js";
import {
  deriveTypographySuggestions,
  deriveValidationSuggestions,
  countFixable,
  splitParagraphByBlock,
  insertHeadingBeforeLongParagraph,
  truncateFirstHeading,
  ruleVariants,
  factCheckDocument,
  summarizeFactCheck,
  applyVariantToOverride,
} from "../src/assistant/suggestions.js";
import { generateVariants, parseVariantList } from "../src/assistant/variants.js";
import { NoopLlm } from "../src/llm/noop-llm.js";

function docFrom(md: string) {
  return markdownToIR(md).document;
}

describe("AI-01 结构化质量建议", () => {
  it("deriveTypographySuggestions 从排版建议派生结构化建议(带定位)", () => {
    const md = "# 标题\n\n" + "字".repeat(300) + "\n\n" + "短段落";
    const doc = docFrom(md);
    const raw = scoreTypography(doc, "wechat").suggestions;
    const suggestions = deriveTypographySuggestions(doc, "wechat", raw);
    expect(suggestions.length).toBeGreaterThan(0);
    // 至少一条带段落定位(超长段落)。
    const located = suggestions.find((s) => s.locate?.blockType === "paragraph");
    expect(located).toBeDefined();
    expect(located!.locate!.charCount).toBeGreaterThan(90);
    // 超长段落可拆段修复。
    const fixable = suggestions.filter((s) => s.fix?.kind === "split-paragraph");
    expect(fixable.length).toBeGreaterThan(0);
    expect(countFixable(suggestions)).toBeGreaterThan(0);
  });

  it("splitParagraphByBlock 把超长段落按句号拆行", () => {
    const md = "这是第一句。这是第二句。这是第三句。\n\n短段落";
    const out = splitParagraphByBlock(md, { type: "paragraph", inlines: [] }, 0);
    const lineCount = out.split("\n").filter((l) => l.trim().length > 0).length;
    expect(lineCount).toBeGreaterThan(2);
    expect(out).toContain("这是第一句");
  });

  it("insertHeadingBeforeLongParagraph 在长段前插入 H2", () => {
    const md = "短段\n\n" + "字".repeat(200) + "。结束";
    const doc = docFrom(md);
    const out = insertHeadingBeforeLongParagraph(md, doc.blocks);
    expect(out).toContain("## ");
    expect(out.indexOf("## ")).toBeLessThan(out.indexOf("字".repeat(200)));
  });

  it("truncateFirstHeading 截断 H1 到指定字数", () => {
    const out = truncateFirstHeading("# 这是一个非常非常非常长的标题用于测试截断\n\n正文", 10);
    expect(out).toMatch(/^# .{0,10}$/m);
  });

  it("deriveValidationSuggestions 从校验 issue 派生建议(含修复)", () => {
    const doc = docFrom("# 标题\n\n正文");
    const issues = [
      { severity: "error" as const, code: "title-too-long", message: "标题超长", field: "title" },
      { severity: "warning" as const, code: "body-too-long", message: "正文超长", field: "body" },
    ];
    const suggestions = deriveValidationSuggestions(issues, "wechat", doc);
    expect(suggestions).toHaveLength(2);
    const titleFix = suggestions.find((s) => s.code === "title-too-long");
    expect(titleFix?.fix?.kind).toBe("truncate");
    expect(titleFix?.locate?.blockType).toBe("heading");
  });
});

describe("AI-02 标题/摘要多方案对比", () => {
  it("ruleVariants 离线生成确定性候选(含原标题)", () => {
    const variants = ruleVariants({
      platformId: "wechat",
      title: "我用效率工具省两小时",
      contentText: "最近发现 3 个时间管理方法。专注不是天赋。",
      titleMax: 30,
      summaryMax: 120,
    });
    expect(variants.length).toBeGreaterThanOrEqual(2);
    const original = variants.find((v) => v.source === "original");
    expect(original?.text).toBe("我用效率工具省两小时");
    // 数字句被提取为规则候选。
    expect(variants.some((v) => v.text.includes("3"))).toBe(true);
  });

  it("generateVariants 在 LLM 不可用时回退规则候选", async () => {
    const result = await generateVariants(
      { platformId: "wechat", title: "t", contentText: "正文有 5 个要点", titleMax: 20, summaryMax: 100 },
      new NoopLlm(),
      3,
    );
    expect(result.usedLlm).toBe(false);
    expect(result.titles.length).toBeGreaterThan(0);
    expect(result.summaries.length).toBeGreaterThan(0);
  });

  it("parseVariantList 解析 JSON 数组与逐行格式", () => {
    expect(parseVariantList('["标题一","标题二"]')).toEqual(["标题一", "标题二"]);
    expect(parseVariantList("1. 标题一\n2. 标题二")).toEqual(["标题一", "标题二"]);
  });
});

describe("AI-03 事实/引用检查", () => {
  it("含数字无来源的句子被标记为 unverified-claim", () => {
    const md = "# 标题\n\n根据权威数据,90% 的用户更喜欢短内容。这是纯观点陈述。";
    const doc = docFrom(md);
    const items = factCheckDocument(doc);
    expect(items.length).toBeGreaterThan(0);
    const unverified = items.find((i) => i.verdict === "unverified-claim");
    expect(unverified).toBeDefined();
    expect(unverified!.hasVerifiableClue).toBe(true);
    expect(unverified!.message).toContain("缺少来源标注");
    const sum = summarizeFactCheck(items);
    expect(sum.unverified).toBeGreaterThan(0);
  });

  it("含外链的句子被标记为 has-citation(不显示为已核验以外的误导)", () => {
    const md = "# 标题\n\n据[研究报告](https://example.com/r)显示,增长 20%。";
    const doc = docFrom(md);
    const items = factCheckDocument(doc);
    const withCitation = items.find((i) => i.verdict === "has-citation");
    expect(withCitation).toBeDefined();
    expect(withCitation!.hasCitation).toBe(true);
  });
});

describe("FLOW-01 模板覆盖层应用", () => {
  it("applyVariantToOverride 把选定标题写入平台覆盖层", () => {
    const override = applyVariantToOverride(undefined, "title", "新标题");
    expect(override.title).toBe("新标题");
    const merged = applyVariantToOverride({ summary: "旧摘要" }, "summary", "新摘要");
    expect(merged.summary).toBe("新摘要");
    expect(merged.title).toBeUndefined();
  });
});
