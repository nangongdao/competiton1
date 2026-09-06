/**
 * Markdown 片段库 —— 纯函数测试(v7 Phase 4 SNIPPET-01)。
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_SNIPPETS,
  insertSnippet,
  cursorIndexIn,
  searchSnippets,
  groupSnippetsByCategory,
} from "../src/snippets/snippets.js";

describe("cursorIndexIn — 光标占位", () => {
  it("找到占位位置", () => {
    expect(cursorIndexIn("```\n{cursor}\n```")).toBe(4);
  });
  it("无占位返回 -1", () => {
    expect(cursorIndexIn("普通文本")).toBe(-1);
  });
});

describe("insertSnippet — 片段插入", () => {
  it("无选区插入代码块,光标落在占位处", () => {
    const r = insertSnippet("", 0, 0, { text: "```\n{cursor}\n```" });
    expect(r.text).toBe("```\n\n```");
    expect(r.selectionStart).toBe(4);
    expect(r.selectionEnd).toBe(4);
  });
  it("有选区时占位被选区内容替换", () => {
    const r = insertSnippet("hello", 0, 5, { text: "`{cursor}`" });
    expect(r.text).toBe("`hello`");
    expect(r.selectionStart).toBe(6);
  });
  it("无占位片段插入到光标处", () => {
    const r = insertSnippet("a|b".replace("|", ""), 1, 1, { text: "**加粗**" });
    expect(r.text).toBe("a**加粗**b");
    expect(r.selectionStart).toBe(1 + "**加粗**".length);
  });
  it("选区替换时保留选区后文本", () => {
    const r = insertSnippet("a选中b", 1, 3, { text: "`{cursor}`" });
    expect(r.text).toBe("a`选中`b");
  });
});

describe("searchSnippets — 片段搜索", () => {
  it("空查询返回全部", () => {
    expect(searchSnippets(BUILTIN_SNIPPETS, "")).toHaveLength(BUILTIN_SNIPPETS.length);
  });
  it("按名称匹配", () => {
    const r = searchSnippets(BUILTIN_SNIPPETS, "表格");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.name).toBe("表格");
  });
  it("按关键词匹配(大小写不敏感)", () => {
    const r = searchSnippets(BUILTIN_SNIPPETS, "todo");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.name).toBe("任务列表");
  });
  it("无匹配返回空", () => {
    expect(searchSnippets(BUILTIN_SNIPPETS, "不存在的片段xyz")).toHaveLength(0);
  });
});

describe("groupSnippetsByCategory — 分类分组", () => {
  it("按分类聚合保持顺序", () => {
    const groups = groupSnippetsByCategory(BUILTIN_SNIPPETS);
    const categories = groups.map((g) => g.category);
    expect(categories).toContain("通用");
    expect(categories).toContain("代码");
    const general = groups.find((g) => g.category === "通用")!;
    expect(general.items.length).toBeGreaterThan(0);
  });
});
