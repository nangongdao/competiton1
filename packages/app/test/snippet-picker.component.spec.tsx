/**
 * SnippetPicker —— 组件测试(v7 Phase 4 SNIPPET-01)。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { SnippetPicker } from "../src/components/SnippetPicker.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SnippetPicker — Markdown 片段库", () => {
  it("渲染内置片段(表格/代码块等)", () => {
    render(<SnippetPicker onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("表格")).toBeTruthy();
    expect(screen.getByText("代码块")).toBeTruthy();
    expect(screen.getByText("任务列表")).toBeTruthy();
  });

  it("搜索过滤片段", () => {
    render(<SnippetPicker onInsert={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("搜索片段");
    fireEvent.change(input, { target: { value: "公式" } });
    expect(screen.getByText("行内公式")).toBeTruthy();
    expect(screen.queryByText("表格")).toBeNull();
  });

  it("点击片段触发插入回调", () => {
    const onInsert = vi.fn();
    render(<SnippetPicker onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("代码块"));
    expect(onInsert).toHaveBeenCalledWith(expect.stringContaining("```"));
  });

  it("关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    render(<SnippetPicker onInsert={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭片段库"));
    expect(onClose).toHaveBeenCalled();
  });
});
