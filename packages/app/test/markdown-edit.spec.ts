/**
 * Markdown 编辑器快捷操作测试。
 *
 * 覆盖 markdown-edit.ts 的纯函数语义:
 * - 包裹语法(加粗/斜体/删除线/行内代码)在选区前后插入定界符;
 * - 行首语法(标题/引用/无序列表/有序列表/代码块)toggle 语义;
 * - 链接/图片占位符替换与光标预选;
 * - 撤销为 no-op(由调用方维护历史栈)。
 */
import { describe, expect, it } from "vitest";
import {
  bold,
  italic,
  strikethrough,
  inlineCode,
  heading,
  quote,
  bulletList,
  orderedList,
  codeBlock,
  link,
  image,
  undoEdit,
} from "../src/components/markdown-edit.js";

describe("markdown-edit — 包裹语法", () => {
  it("加粗:有选区时包裹选区", () => {
    const r = bold("你好 world", 3, 8);
    expect(r.text).toBe("你好 **world**");
  });

  it("加粗:无选区时插入占位符并把光标放在占位符后", () => {
    const r = bold("abc", 1, 1);
    expect(r.text).toBe("a**加粗文字**bc");
    expect(r.selectionStart).toBe(1 + "**".length + "加粗文字".length);
  });

  it("斜体与删除线", () => {
    expect(italic("a bc d", 2, 4).text).toBe("a *bc* d");
    expect(strikethrough("a bc d", 2, 4).text).toBe("a ~~bc~~ d");
  });

  it("斜体:空选区插入占位符并把光标放在占位符后", () => {
    const r = italic("abc", 1, 1);
    expect(r.text).toBe("a*斜体文字*bc");
    expect(r.selectionStart).toBe(1 + 1 + "斜体文字".length);
  });

  it("行内代码包裹", () => {
    const r = inlineCode("useState()", 0, 11);
    expect(r.text).toBe("`useState()`");
  });
});

describe("markdown-edit — 行首语法", () => {
  it("标题:在行首插入前缀;再次执行 toggle 移除", () => {
    const r1 = heading("标题", 0, 2);
    expect(r1.text).toBe("## 标题");
    const r2 = heading(r1.text, 0, r1.text.length);
    expect(r2.text).toBe("标题");
  });

  it("引用与无序列表 toggle", () => {
    const q = quote("引用", 0, 2);
    expect(q.text).toBe("> 引用");
    expect(quote(q.text, 0, q.text.length).text).toBe("引用");
    const b = bulletList("item", 0, 4);
    expect(b.text).toBe("- item");
  });

  it("有序列表与代码块", () => {
    const o = orderedList("x\ny", 0, 3);
    expect(o.text).toBe("1. x\n1. y");
    const c = codeBlock("const a = 1;", 0, 13);
    expect(c.text).toBe("```\nconst a = 1;\n```");
  });
});

describe("markdown-edit — 链接/图片/撤销", () => {
  it("链接:保留选区文本作 label,预选 URL", () => {
    const r = link("点我", 0, 2);
    expect(r.text).toBe("[点我](https://)");
    expect(r.selectionStart).toBe(2 + 3);
  });

  it("图片:插入占位图", () => {
    const r = image("图", 0, 1);
    expect(r.text).toBe("![图](https://)");
  });

  it("撤销:返回原文本 no-op", () => {
    const r = undoEdit("hello", 2, 3);
    expect(r.text).toBe("hello");
    expect(r.selectionStart).toBe(2);
  });
});
