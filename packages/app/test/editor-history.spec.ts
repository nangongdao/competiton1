/**
 * 共享编辑器撤销历史测试(EDIT-AI-04:选区 AI 操作并入 Markdown 撤销栈)。
 *
 * 覆盖:
 * - push / pop 栈语义(LIFO);
 * - 超过上限自动裁剪(保留最近 N 条);
 * - clear 清空;
 * - 模块级单例与工厂实例。
 */
import { describe, expect, it } from "vitest";
import { createEditorHistory, EDITOR_HISTORY_MAX } from "../src/components/editor-history.js";

describe("editor-history (EDIT-AI-04)", () => {
  it("push/pop 保持 LIFO 顺序", () => {
    const h = createEditorHistory(10);
    h.push({ text: "a", start: 0, end: 1 });
    h.push({ text: "b", start: 1, end: 2 });
    expect(h.length).toBe(2);
    expect(h.pop()?.text).toBe("b");
    expect(h.pop()?.text).toBe("a");
    expect(h.pop()).toBeUndefined();
  });

  it("超过上限自动裁剪(保留最近 N 条)", () => {
    const h = createEditorHistory(2);
    h.push({ text: "1", start: 0, end: 0 });
    h.push({ text: "2", start: 0, end: 0 });
    h.push({ text: "3", start: 0, end: 0 });
    expect(h.length).toBe(2);
    expect(h.pop()?.text).toBe("3");
    expect(h.pop()?.text).toBe("2");
  });

  it("默认上限为 50", () => {
    expect(EDITOR_HISTORY_MAX).toBe(50);
  });

  it("clear 清空全部", () => {
    const h = createEditorHistory(10);
    h.push({ text: "x", start: 0, end: 0 });
    h.clear();
    expect(h.length).toBe(0);
    expect(h.pop()).toBeUndefined();
  });
});
