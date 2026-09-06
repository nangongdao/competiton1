/**
 * DocWriteBar —— 组件测试(v7 Phase 4 AI-WRITE-01)。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { DocWriteBar } from "../src/components/DocWriteBar.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DocWriteBar — 整篇 AI 写作", () => {
  it("渲染四个动作按钮", () => {
    render(<DocWriteBar llmReady={true} busy={false} onRun={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("整篇润色")).toBeTruthy();
    expect(screen.getByLabelText("扩写")).toBeTruthy();
    expect(screen.getByLabelText("续写")).toBeTruthy();
    expect(screen.getByLabelText("生成摘要")).toBeTruthy();
  });

  it("LLM 未配置时展示规则兜底提示", () => {
    render(<DocWriteBar llmReady={false} busy={false} onRun={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/规则兜底/)).toBeTruthy();
  });

  it("点击动作触发 onRun", () => {
    const onRun = vi.fn();
    render(<DocWriteBar llmReady={true} busy={false} onRun={onRun} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("续写"));
    expect(onRun).toHaveBeenCalledWith("continue-doc");
  });

  it("busy 时禁用按钮", () => {
    render(<DocWriteBar llmReady={true} busy={true} onRun={vi.fn()} onClose={vi.fn()} />);
    const btn = screen.getByLabelText("整篇润色") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("展示最近一次执行状态", () => {
    render(
      <DocWriteBar
        llmReady={true}
        busy={false}
        lastResult={{ op: "summarize-doc", usedLlm: true, changed: true }}
        onRun={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/生成摘要 完成\(AI 生成\)/)).toBeTruthy();
  });
});
