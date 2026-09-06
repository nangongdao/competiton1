/**
 * 平台产物对比 —— 源文 vs 产物降级差异测试。
 */
import { describe, expect, it } from "vitest";
import {
  compareArtifact,
  diffLines,
  htmlToPlainText,
  markdownToPlainText,
} from "../src/compare/index.js";

describe("markdownToPlainText", () => {
  it("去除标题符与行内标记", () => {
    const out = markdownToPlainText("# 标题\n\n**加粗**与*斜体*和`代码`");
    expect(out).toContain("标题");
    expect(out).toContain("加粗与斜体和代码");
    expect(out).not.toContain("**");
  });
  it("图片引用转为可读标记", () => {
    expect(markdownToPlainText("![图](https://x/a.png)")).toContain("图片:");
  });
  it("链接只保留文字", () => {
    expect(markdownToPlainText("[链接文字](https://x)")).toContain("链接文字");
    expect(markdownToPlainText("[链接文字](https://x)")).not.toContain("https://x");
  });
});

describe("htmlToPlainText", () => {
  it("标签转行、实体解码", () => {
    const out = htmlToPlainText("<p>第一段</p><p>第二段</p>");
    expect(out).toContain("第一段");
    expect(out).toContain("第二段");
    expect(out).not.toContain("<p>");
  });
  it("br 转行", () => {
    expect(htmlToPlainText("a<br>b")).toContain("a\nb");
  });
});

describe("diffLines — 行级 diff", () => {
  it("相同文本全 equal", () => {
    const ops = diffLines("a\nb", "a\nb");
    expect(ops.every((o) => o.type === "equal")).toBe(true);
  });
  it("插入行", () => {
    const ops = diffLines("a\nb", "a\nX\nb");
    expect(ops.some((o) => o.type === "insert" && o.line === "X")).toBe(true);
  });
  it("删除行", () => {
    const ops = diffLines("a\nY\nb", "a\nb");
    expect(ops.some((o) => o.type === "delete" && o.line === "Y")).toBe(true);
  });
});

describe("compareArtifact", () => {
  it("一致时 identical=true 且无操作", () => {
    const c = compareArtifact("juejin", "标题\n正文", "text/markdown", "标题\n正文");
    expect(c.identical).toBe(true);
    expect(c.added).toBe(0);
    expect(c.removed).toBe(0);
    expect(c.notes[0]).toContain("一致");
  });
  it("截断(删除行)时给出明确说明", () => {
    const c = compareArtifact("xiaohongshu", "第一段\n第二段\n第三段", "text/plain", "第一段\n第二段");
    expect(c.identical).toBe(false);
    expect(c.removed).toBeGreaterThan(0);
    expect(c.notes.some((n) => n.includes("截断"))).toBe(true);
  });
  it("HTML 产物先抽纯文本再对比", () => {
    const c = compareArtifact("wechat", "标题\n正文", "text/html", "<h1>标题</h1><p>正文</p>");
    expect(c.identical).toBe(true);
  });
});
