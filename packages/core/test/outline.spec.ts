/**
 * 文档大纲提取 —— 纯函数测试(v7 Phase 4 OUTLINE-01)。
 */
import { describe, expect, it } from "vitest";
import {
  extractOutline,
  collectHeadings,
  buildOutlineTree,
  headingTextOf,
  activeNodeAtLine,
} from "../src/outline/outline.js";

describe("headingTextOf — 标题文本提取", () => {
  it("去掉 # 前缀", () => {
    expect(headingTextOf("# 标题")).toBe("标题");
  });
  it("去掉行内代码/链接/强调标记", () => {
    expect(headingTextOf("## 使用 `code` 与 [链接](https://a.com)")).toBe("使用 code 与 链接");
  });
  it("去掉尾部闭合 #", () => {
    expect(headingTextOf("### 标题 ###")).toBe("标题");
  });
  it("去掉强调符号", () => {
    expect(headingTextOf("## **加粗标题**")).toBe("加粗标题");
  });
});

describe("collectHeadings — 标题行收集", () => {
  it("提取全部标题带行号与字符索引", () => {
    const md = "# 标题\n\n正文\n\n## 小节\n";
    const hs = collectHeadings(md);
    expect(hs).toHaveLength(2);
    expect(hs[0]).toMatchObject({ title: "标题", level: 1, lineIndex: 0, charIndex: 0 });
    expect(hs[1]).toMatchObject({ title: "小节", level: 2, lineIndex: 4, charIndex: 10 });
  });
  it("忽略代码块内 # 与无标题内容的 #", () => {
    const md = "```\n# 不是标题\n```\n普通文本 # 也不是";
    const hs = collectHeadings(md);
    expect(hs).toHaveLength(0);
  });
});

describe("buildOutlineTree — 标题树构造", () => {
  it("按层级构造父子结构", () => {
    const hs = collectHeadings("# A\n\n## A1\n\n### A1a\n\n# B\n");
    const tree = buildOutlineTree(hs);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
  });
  it("跳级标题补位到最近父级", () => {
    const hs = collectHeadings("# A\n\n### A1\n");
    const tree = buildOutlineTree(hs);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.title).toBe("A1");
  });
});

describe("extractOutline — 总入口", () => {
  it("无标题返回空大纲", () => {
    const r = extractOutline("正文\n\n更多正文");
    expect(r.hasHeadings).toBe(false);
    expect(r.headingCount).toBe(0);
    expect(r.nodes).toHaveLength(0);
  });
  it("有标题返回树与计数", () => {
    const r = extractOutline("# A\n\n## B\n");
    expect(r.hasHeadings).toBe(true);
    expect(r.headingCount).toBe(2);
    expect(r.nodes).toHaveLength(1);
  });
});

describe("activeNodeAtLine — 当前章节高亮", () => {
  it("光标行位于小节内时返回小节", () => {
    const r = extractOutline("# A\n\n## B\n\n内容\n");
    // 内容行(第 4 行)。
    const active = activeNodeAtLine(r.nodes, 4);
    expect(active?.title).toBe("B");
  });
  it("光标行位于标题前返回 undefined", () => {
    const r = extractOutline("# A\n\n## B\n");
    // 没有标题之前的行(第一个标题在第 0 行)—— 构造前置文本。
    const md2 = "开头文字\n\n# A\n";
    const r2 = extractOutline(md2);
    expect(activeNodeAtLine(r2.nodes, 0)).toBeUndefined();
    void r;
  });
  it("光标行位于大标题区返回大标题", () => {
    const r = extractOutline("# A\n\n## B\n");
    const active = activeNodeAtLine(r.nodes, 0);
    expect(active?.title).toBe("A");
  });
});
