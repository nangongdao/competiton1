import { describe, expect, it } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import {
  deriveTypographySuggestions,
  deriveValidationSuggestions,
  countFixable,
  insertHeadingBeforeLongParagraph,
  factCheckDocument,
  blockText,
  inlineToText,
} from "../src/assistant/suggestions.js";
import { scoreTypography } from "../src/quality/typography.js";

function docFrom(md: string) {
  return markdownToIR(md).document;
}

describe("assistant suggestions — 补充分支", () => {
  it("空文档时排版建议派生为空", () => {
    const doc = docFrom("");
    const suggestions = deriveTypographySuggestions(doc, "wechat", []);
    expect(suggestions).toHaveLength(0);
  });

  it("评分无建议时派生为空", () => {
    const doc = docFrom("# 标题\n\n短段落\n\n![图](https://img.example.com/1.png)");
    const raw = scoreTypography(doc, "wechat").suggestions;
    const suggestions = deriveTypographySuggestions(doc, "wechat", raw);
    expect(suggestions.length).toBeLessThanOrEqual(1); // 可能有 image 建议
  });

  it("deriveValidationSuggestions 对未知字段回退无定位", () => {
    const doc = docFrom("# 标题\n\n正文");
    const issues = [{ severity: "info" as const, code: "unknown-code", message: "未知", field: "tags" }];
    const suggestions = deriveValidationSuggestions(issues, "wechat", doc);
    expect(suggestions[0]!.locate).toBeUndefined();
    expect(suggestions[0]!.fix).toBeUndefined();
  });

  it("insertHeadingBeforeLongParagraph 无长段时原样返回", () => {
    const md = "# 标题\n\n短段";
    const doc = docFrom(md);
    expect(insertHeadingBeforeLongParagraph(md, doc.blocks)).toBe(md);
  });

  it("countFixable 统计可修复建议", () => {
    const suggestions = [
      { id: "a", platformId: "w", code: "c", severity: "info" as const, message: "m", fix: { kind: "truncate" as const, description: "d", apply: (md: string) => md } },
      { id: "b", platformId: "w", code: "c", severity: "info" as const, message: "m" },
    ];
    expect(countFixable(suggestions)).toBe(1);
  });

  it("factCheckDocument 识别引用句与观点句", () => {
    const doc = docFrom("# 标题\n\n该产品在 2024 年发布了新版本,数据来源可靠。\n\n纯个人感受,我觉得不错。");
    const items = factCheckDocument(doc);
    // 第一句含"来源"→ has-citation;第二句观点 → no-clue。
    expect(items.some((i) => i.verdict === "has-citation")).toBe(true);
    expect(items.some((i) => i.verdict === "no-clue")).toBe(true);
  });

  it("blockText / inlineToText 提取纯文本", () => {
    const doc = docFrom("## 小节\n\n**加粗** [链接](https://x.com) `代码`");
    const text = doc.blocks.map(blockText).join(" ");
    expect(text).toContain("小节");
    expect(text).toContain("加粗");
    expect(text).toContain("链接");
    expect(text).toContain("代码");
    expect(inlineToText({ type: "lineBreak" })).toBe(" ");
  });
});
