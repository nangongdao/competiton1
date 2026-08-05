import { describe, it, expect } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import { scoreTypography } from "../src/quality/typography.js";
import type { Document } from "../src/ir/types.js";

function docFrom(md: string): Document {
  return markdownToIR(md).document;
}

/** 构造 paraCount 段、每段 paraLen 个汉字的文档(段落间空行分隔)。 */
function paragraphDoc(paraLen: number, paraCount = 4): Document {
  let md = "# 标题\n";
  for (let i = 0; i < paraCount; i++) md += `\n\n${"字".repeat(paraLen)}`;
  return docFrom(md);
}

describe("scoreTypography — 排版质量评分", () => {
  it("结构良好的短段落 + 配图在各维度得高分,无建议", () => {
    let md = "# 标题\n";
    for (let i = 0; i < 4; i++) md += `\n\n${"字".repeat(30)}`;
    md += "\n\n![配图](https://img.example.com/1.png)";
    const score = scoreTypography(docFrom(md), "wechat");
    expect(score.overall).toBeGreaterThanOrEqual(80);
    expect(score.paragraphRhythm).toBe(100);
    expect(score.imageBalance).toBe(100);
    expect(score.suggestions).toHaveLength(0);
  });

  it("总分恒在 0-100", () => {
    for (const platformId of ["wechat", "zhihu", "bilibili", "xiaohongshu"]) {
      const score = scoreTypography(paragraphDoc(120), platformId);
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(100);
      for (const dim of [score.paragraphRhythm, score.imageBalance, score.headingStructure, score.readability]) {
        expect(dim).toBeGreaterThanOrEqual(0);
        expect(dim).toBeLessThanOrEqual(100);
      }
    }
  });

  it("同一文档在公众号比知乎更易被判「段偏长」(偏好更严格)", () => {
    const doc = paragraphDoc(100);
    const wechat = scoreTypography(doc, "wechat");
    const zhihu = scoreTypography(doc, "zhihu");
    expect(wechat.paragraphRhythm).toBeLessThan(zhihu.paragraphRhythm);
    expect(wechat.suggestions.some((s) => s.includes("拆成 2-3 段"))).toBe(true);
  });

  it("缺图时给出补充配图的建议(图文平衡)", () => {
    const doc = docFrom("# 标题\n\n" + "啊".repeat(800));
    const wechat = scoreTypography(doc, "wechat");
    expect(wechat.imageBalance).toBe(0); // 800 字期望 2 张图,实际 0
    expect(wechat.suggestions.some((s) => s.includes("补充配图"))).toBe(true);
  });

  it("配图充足时图文平衡得满分", () => {
    let md = "# 标题\n\n" + "啊".repeat(400);
    for (let i = 0; i < 3; i++) md += `\n\n![图${i}](https://img.example.com/${i}.png)`;
    const wechat = scoreTypography(docFrom(md), "wechat");
    expect(wechat.imageBalance).toBe(100);
  });

  it("标题跳级扣分并给出补层级建议", () => {
    const doc = docFrom("# 标题\n\n## 章节A\n\n正文。\n\n#### 小节B\n\n正文。\n\n###### 深层C\n\n正文。");
    const score = scoreTypography(doc, "wechat");
    expect(score.headingStructure).toBeLessThan(100);
    expect(score.suggestions.some((s) => s.includes("跳级"))).toBe(true);
  });

  it("超长无分隔文本块拖低可读性", () => {
    const score = scoreTypography(paragraphDoc(400, 1), "wechat");
    expect(score.readability).toBeLessThan(100);
    expect(score.suggestions.some((s) => s.includes("超长文本块"))).toBe(true);
  });

  it("无小标题的长文提示分节", () => {
    const doc = paragraphDoc(40, 12); // 12 段无标题
    const score = scoreTypography(doc, "wechat");
    expect(score.headingStructure).toBeLessThan(100);
  });

  it("未知平台回退通用偏好,不抛异常", () => {
    const score = scoreTypography(paragraphDoc(60), "some-platform");
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
  });
});
