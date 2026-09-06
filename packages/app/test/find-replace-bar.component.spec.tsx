/**
 * FindReplaceBar —— 组件测试。
 *
 * 覆盖:
 * - 渲染查找/替换输入与按钮;
 * - 输入查询实时计数;
 * - 下一个 / 上一个跳转;
 * - 替换 / 全部替换回调;
 * - 关闭按钮。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { FindReplaceBar } from "../src/components/FindReplaceBar.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeEditorRef(value = "foo bar foo") {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  const ref = { current: textarea as HTMLTextAreaElement };
  return ref;
}

describe("FindReplaceBar — 查找与替换", () => {
  it("渲染查询/替换输入与操作按钮", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<FindReplaceBar text="foo bar" editorRef={makeEditorRef()} onApply={onApply} onClose={onClose} />);
    expect(screen.getByLabelText("查找内容")).toBeTruthy();
    expect(screen.getByLabelText("替换为")).toBeTruthy();
    expect(screen.getByLabelText("下一个匹配")).toBeTruthy();
    expect(screen.getByLabelText("上一个匹配")).toBeTruthy();
    expect(screen.getByLabelText("关闭查找")).toBeTruthy();
  });

  it("输入查询显示匹配计数", () => {
    const onApply = vi.fn();
    render(<FindReplaceBar text="foo bar foo" editorRef={makeEditorRef()} onApply={onApply} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "foo" } });
    // 计数 1/2 + 分布行数(第一个匹配高亮)。
    expect(screen.getByText(/1\/2/)).toBeTruthy();
    expect(screen.getByText(/1 行/)).toBeTruthy();
  });

  it("无结果时显示提示", () => {
    render(<FindReplaceBar text="foo bar" editorRef={makeEditorRef()} onApply={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("无结果")).toBeTruthy();
  });

  it("下一个匹配切换计数", () => {
    render(<FindReplaceBar text="foo foo foo" editorRef={makeEditorRef("foo foo foo")} onApply={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "foo" } });
    expect(screen.getByText(/1\/3/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("下一个匹配"));
    expect(screen.getByText(/2\/3/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("下一个匹配"));
    expect(screen.getByText(/3\/3/)).toBeTruthy();
  });

  it("替换当前匹配:调用 onApply 并前进到下一处", () => {
    const onApply = vi.fn();
    render(<FindReplaceBar text="foo foo" editorRef={makeEditorRef("foo foo")} onApply={onApply} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "foo" } });
    const replaceInput = screen.getByLabelText("替换为");
    fireEvent.change(replaceInput, { target: { value: "bar" } });
    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    expect(onApply).toHaveBeenCalledWith("bar foo");
  });

  it("全部替换:调用 onApply 并替换全部", () => {
    const onApply = vi.fn();
    render(<FindReplaceBar text="foo foo foo" editorRef={makeEditorRef("foo foo foo")} onApply={onApply} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "foo" } });
    const replaceInput = screen.getByLabelText("替换为");
    fireEvent.change(replaceInput, { target: { value: "bar" } });
    fireEvent.click(screen.getByRole("button", { name: /全部替换/ }));
    expect(onApply).toHaveBeenCalledWith("bar bar bar");
  });

  it("关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    render(<FindReplaceBar text="foo" editorRef={makeEditorRef()} onApply={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭查找"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("v7 Phase 2 — 正则开关", () => {
  it("正则模式:按表达式匹配计数", () => {
    render(<FindReplaceBar text="a1 b2 c3" editorRef={makeEditorRef("a1 b2 c3")} onApply={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "\\d" } });
    fireEvent.click(screen.getByLabelText("正则匹配"));
    expect(screen.getByText(/1\/3/)).toBeTruthy();
  });

  it("非法正则显示「正则错误」", () => {
    render(<FindReplaceBar text="abc" editorRef={makeEditorRef("abc")} onApply={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "(" } });
    fireEvent.click(screen.getByLabelText("正则匹配"));
    expect(screen.getByText("正则错误")).toBeTruthy();
  });
});
