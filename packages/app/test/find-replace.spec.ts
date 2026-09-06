/**
 * 编辑器查找/替换纯函数测试。
 *
 * 覆盖:
 * - findMatches:空查询 / 大小写 / 整词 / 多匹配;
 * - nextMatch:循环、包含、光标位置;
 * - replaceRange:单区间替换与选区;
 * - replaceAll:全部替换与次数。
 */
import { describe, expect, it } from "vitest";
import { findMatches, nextMatch, replaceRange, replaceAll, isValidRegex, lineOfIndex } from "../src/components/find-replace.js";

describe("findMatches — 查找匹配", () => {
  it("空查询返回空", () => {
    expect(findMatches("abc", "")).toEqual([]);
  });

  it("普通多匹配", () => {
    const m = findMatches("foo bar foo", "foo");
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("大小写不敏感默认:忽略大小写", () => {
    expect(findMatches("Foo FOO foo", "foo")).toHaveLength(3);
  });

  it("caseSensitive=true 区分大小写", () => {
    expect(findMatches("Foo foo", "foo", { caseSensitive: true })).toEqual([{ start: 4, end: 7 }]);
  });

  it("整词匹配:词边界", () => {
    const m = findMatches("cat category cat.", "cat", { wholeWord: true });
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 13, end: 16 },
    ]);
  });

  it("整词匹配:中文字符两侧不触发单词边界问题", () => {
    const m = findMatches("中文abc中文", "abc", { wholeWord: true });
    expect(m).toHaveLength(1);
  });

  it("重叠匹配依次推进", () => {
    expect(findMatches("aaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
    ]);
  });
});

describe("nextMatch — 下一个匹配(循环)", () => {
  it("无匹配返回 undefined", () => {
    expect(nextMatch("abc", "z", 0)).toBeUndefined();
  });

  it("光标在匹配前取该匹配", () => {
    const m = nextMatch("foo bar", "foo", 0);
    expect(m).toEqual({ start: 0, end: 3 });
  });

  it("光标在匹配中间取包含匹配", () => {
    const m = nextMatch("foo bar", "oo", 2);
    expect(m).toEqual({ start: 1, end: 3 });
  });

  it("光标在匹配内部取包含匹配(即使接近结尾)", () => {
    const m = nextMatch("foo foo", "foo", 5);
    expect(m).toEqual({ start: 4, end: 7 });
  });

  it("光标在最后一个匹配之后 → 循环回第一个", () => {
    const m = nextMatch("foo foo", "foo", 8);
    expect(m).toEqual({ start: 0, end: 3 });
  });
});

describe("replaceRange — 单区间替换", () => {
  it("替换并返回新选区", () => {
    const r = replaceRange("foo bar", { start: 0, end: 3 }, "baz");
    expect(r.text).toBe("baz bar");
    expect(r.selectionStart).toBe(0);
    expect(r.selectionEnd).toBe(3);
  });
});

describe("replaceAll — 全部替换", () => {
  it("全部替换并计数", () => {
    const r = replaceAll("foo foo foo", "foo", "bar");
    expect(r.text).toBe("bar bar bar");
    expect(r.count).toBe(3);
  });

  it("无匹配返回原文本", () => {
    const r = replaceAll("hello", "x", "y");
    expect(r.text).toBe("hello");
    expect(r.count).toBe(0);
  });

  it("区分大小写替换", () => {
    const r = replaceAll("Foo foo", "foo", "bar", { caseSensitive: true });
    expect(r.text).toBe("Foo bar");
    expect(r.count).toBe(1);
  });
});

describe("v7 Phase 2 — 正则匹配(useRegex)", () => {
  it("正则模式按表达式匹配", () => {
    const m = findMatches("foo 123 bar 456", "\\d+", { useRegex: true });
    expect(m).toEqual([
      { start: 4, end: 7 },
      { start: 12, end: 15 },
    ]);
  });

  it("正则模式大小写不敏感默认忽略大小写", () => {
    const m = findMatches("Foo FOO foo", "foo", { useRegex: true });
    expect(m).toHaveLength(3);
  });

  it("正则模式 caseSensitive=true 区分大小写", () => {
    const m = findMatches("Foo foo", "foo", { useRegex: true, caseSensitive: true });
    expect(m).toEqual([{ start: 4, end: 7 }]);
  });

  it("正则模式整词匹配仍生效", () => {
    const m = findMatches("cat category cat.", "cat", { useRegex: true, wholeWord: true });
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 13, end: 16 },
    ]);
  });

  it("非法正则返回空(由 isValidRegex 提示)", () => {
    expect(findMatches("abc", "(", { useRegex: true })).toEqual([]);
    expect(isValidRegex("(")).toBe(false);
    expect(isValidRegex("\\d+")).toBe(true);
  });

  it("零宽匹配被跳过,避免死循环", () => {
    const m = findMatches("abc", "a*", { useRegex: true });
    // a* 会匹配 'a' 与多处零宽;零宽被跳过,只保留非空匹配。
    expect(m.every((r) => r.end > r.start)).toBe(true);
  });

  it("正则替换 all", () => {
    const r = replaceAll("a1b2c3", "\\d", "X", { useRegex: true });
    expect(r.text).toBe("aXbXcX");
    expect(r.count).toBe(3);
  });

  it("正则单个替换", () => {
    const r = replaceRange("a1b2c3", { start: 1, end: 2 }, "X");
    expect(r.text).toBe("aXb2c3");
  });
});

describe("v7 Phase 2 — 当前行高亮辅助", () => {
  it("lineOfIndex 返回字符所在行号(0 基)", () => {
    expect(lineOfIndex("abc", 0)).toBe(0);
    expect(lineOfIndex("a\nbc", 2)).toBe(1);
    expect(lineOfIndex("a\nb\nc", 4)).toBe(2);
  });

  it("lineOfIndex 越界钳制", () => {
    expect(lineOfIndex("abc", 999)).toBe(0);
    expect(lineOfIndex("a\nbc", -1)).toBe(0);
  });
});
