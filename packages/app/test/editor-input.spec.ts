/**
 * 编辑器智能输入辅助 —— 纯函数测试。
 *
 * 覆盖:
 * - indentSelection:光标插入缩进 / 多行缩进 / 选区扩展;
 * - outdentSelection:反缩进(空格 / Tab / 空行安全);
 * - autoCloseDelimiter:常规补全 / 跳过闭合 / 补全后居中;
 * - toggleBlockQuote / toggleBulletList / toggleOrderedList:行首语法 toggle;
 * - handleEnter:列表续行 / 空项退出 / 有序列表递增 / 引用续行 / 有选区不干预。
 */
import { describe, expect, it } from "vitest";
import {
  indentSelection,
  outdentSelection,
  autoCloseDelimiter,
  toggleBlockQuote,
  toggleBulletList,
  toggleOrderedList,
  handleEnter,
} from "../src/components/editor-input.js";

describe("indentSelection — Tab 缩进", () => {
  it("光标处插入两个空格", () => {
    const r = indentSelection("hello", 3, 3);
    expect(r.text).toBe("hel  lo");
    expect(r.selectionStart).toBe(5);
    expect(r.selectionEnd).toBe(5);
  });

  it("多行缩进:选区覆盖每行行首插入缩进", () => {
    const r = indentSelection("a\nb\nc", 0, 5);
    expect(r.text).toBe("  a\n  b\n  c");
    expect(r.selectionStart).toBe(0);
    expect(r.selectionEnd).toBe(11);
  });

  it("选区扩展到完整行(行尾结束时不包含下一行)", () => {
    const r = indentSelection("foo\nbar", 1, 3);
    expect(r.text).toBe("  foo\nbar");
  });

  it("选区跨越行尾时包含下一行", () => {
    const r = indentSelection("foo\nbar", 1, 4);
    expect(r.text).toBe("  foo\n  bar");
  });
});

describe("outdentSelection — Shift+Tab 反缩进", () => {
  it("移除行首缩进(两个空格)", () => {
    const r = outdentSelection("  foo\n  bar", 0, 9);
    expect(r.text).toBe("foo\nbar");
  });

  it("Tab 缩进也可移除", () => {
    const r = outdentSelection("\tfoo", 0, 4);
    expect(r.text).toBe("foo");
  });

  it("无缩进行保持不变", () => {
    const r = outdentSelection("foo", 0, 3);
    expect(r.text).toBe("foo");
  });

  it("光标处作用于当前行", () => {
    const r = outdentSelection("  foo", 3, 3);
    expect(r.text).toBe("foo");
  });
});

describe("autoCloseDelimiter — 成对定界符自动补全", () => {
  it("输入 `**` 常规补全,光标居中", () => {
    const r = autoCloseDelimiter("", 0, 0, "**");
    expect(r.text).toBe("****");
    expect(r.selectionStart).toBe(2);
    expect(r.selectionEnd).toBe(2);
  });

  it("输入 `*` 常规补全", () => {
    const r = autoCloseDelimiter("a", 1, 1, "*");
    expect(r.text).toBe("a**");
  });

  it("输入 `` ` `` 常规补全", () => {
    const r = autoCloseDelimiter("a", 1, 1, "`");
    expect(r.text).toBe("a``");
  });

  it("后续字符已是定界符时跳过(不重复插入)", () => {
    // 输入 `*` 时后面已是 `*`(光标在开闭符之间):跳过。
    const r = autoCloseDelimiter("**", 1, 1, "*");
    expect(r.text).toBe("**");
    expect(r.selectionStart).toBe(2);
  });

  it("前一个字符已是定界符时补全闭合", () => {
    // 输入 `*` 时前面已是 `*`:补全闭合符 `**`,光标保持。
    const r = autoCloseDelimiter("**", 2, 2, "*");
    expect(r.text).toBe("***");
    expect(r.selectionStart).toBe(2);
    expect(r.selectionEnd).toBe(2);
  });

  it("不匹配的输入原样返回", () => {
    const r = autoCloseDelimiter("a", 1, 1, "x");
    expect(r).toEqual({ text: "a", selectionStart: 1, selectionEnd: 1 });
  });
});

describe("toggleLinePrefix — 行首语法 toggle", () => {
  it("引用 toggle:加前缀", () => {
    const r = toggleBlockQuote("hello", 0, 5);
    expect(r.text).toBe("> hello");
  });

  it("引用 toggle:去前缀", () => {
    const r = toggleBlockQuote("> hello", 0, 8);
    expect(r.text).toBe("hello");
  });

  it("无序列表 toggle:加前缀", () => {
    const r = toggleBulletList("item", 0, 4);
    expect(r.text).toBe("- item");
  });

  it("无序列表 toggle:去前缀", () => {
    const r = toggleBulletList("- item", 0, 7);
    expect(r.text).toBe("item");
  });

  it("有序列表 toggle:加前缀", () => {
    const r = toggleOrderedList("item", 0, 4);
    expect(r.text).toBe("1. item");
  });

  it("有序列表 toggle:去前缀", () => {
    const r = toggleOrderedList("1. item", 0, 8);
    expect(r.text).toBe("item");
  });

  it("多行统一 toggle", () => {
    const r = toggleBlockQuote("a\nb", 0, 3);
    expect(r.text).toBe("> a\n> b");
  });
});

describe("handleEnter — 回车智能处理", () => {
  it("无序列表续行", () => {
    const r = handleEnter("- item", 6, 6)!;
    expect(r.text).toBe("- item\n- ");
    expect(r.selectionStart).toBe(9);
  });

  it("空无序列表项退出", () => {
    const r = handleEnter("- ", 2, 2)!;
    expect(r.text).toBe("");
    expect(r.selectionStart).toBe(0);
  });

  it("有序列表续行并递增编号", () => {
    const r = handleEnter("1. item", 7, 7)!;
    expect(r.text).toBe("1. item\n2. ");
  });

  it("空有序列表项退出", () => {
    const r = handleEnter("1. ", 3, 3)!;
    expect(r.text).toBe("");
    expect(r.selectionStart).toBe(0);
  });

  it("引用续行", () => {
    const r = handleEnter("> quote", 7, 7)!;
    expect(r.text).toBe("> quote\n> ");
  });

  it("空引用退出", () => {
    const r = handleEnter("> ", 2, 2)!;
    expect(r.text).toBe("");
  });

  it("普通行不干预(返回 null)", () => {
    expect(handleEnter("plain", 5, 5)).toBeNull();
  });

  it("有选区时不干预", () => {
    expect(handleEnter("- item", 0, 4)).toBeNull();
  });
});
