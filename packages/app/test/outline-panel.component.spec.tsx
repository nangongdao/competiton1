/**
 * OutlinePanel —— 组件测试(v7 Phase 4 OUTLINE-01)。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { OutlinePanel } from "../src/components/OutlinePanel.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const MD = `# 主标题

## 小节一

正文内容`;

describe("OutlinePanel — 文档大纲", () => {
  it("无标题时展示空态提示", () => {
    render(<OutlinePanel markdown="正文内容" cursorLine={0} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/暂无标题/)).toBeTruthy();
  });

  it("渲染标题树", () => {
    render(<OutlinePanel markdown={MD} cursorLine={3} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("主标题")).toBeTruthy();
    expect(screen.getByText("小节一")).toBeTruthy();
  });

  it("点击标题触发定位回调", () => {
    const onNavigate = vi.fn();
    render(<OutlinePanel markdown={MD} cursorLine={3} onNavigate={onNavigate} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("小节一"));
    expect(onNavigate).toHaveBeenCalledWith(7); // "## 小节一" 的 charIndex
  });

  it("关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    render(<OutlinePanel markdown={MD} cursorLine={0} onNavigate={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭大纲"));
    expect(onClose).toHaveBeenCalled();
  });
});
