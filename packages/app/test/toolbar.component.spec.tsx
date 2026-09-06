/**
 * TEST-03 —— 工具栏组件测试(a11y 属性 + 交互)。
 *
 * 验证:
 * - 草稿按钮带 aria-haspopup="dialog" 并触发 onOpenDrafts;
 * - 设置按钮触发 onOpenSettings;
 * - 全屏预览按钮带 aria-pressed 双态并触发 onTogglePreviewOnly;
 * - 主题切换按钮循环主题;
 * - 桌面端展示内置终端按钮(showTerminal)且带 aria-pressed;
 * - 非桌面端不展示终端按钮。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen, fireEvent } from "./helpers/render.js";
import { Toolbar } from "../src/components/Toolbar.js";

function renderToolbar(props: Partial<typeof BASE> = {}) {
  return render(
    <Tooltip.Provider delayDuration={0}>
      <Toolbar {...BASE} {...props} />
    </Tooltip.Provider>,
  );
}

const BASE = {
  env: "web" as const,
  themeMode: "light" as const,
  onCycleTheme: vi.fn(),
  previewOnly: false,
  onTogglePreviewOnly: vi.fn(),
  draftCount: 3,
  onOpenDrafts: vi.fn(),
  llmReady: false,
  onOpenSettings: vi.fn(),
};

describe("Toolbar — 工具栏", () => {
  it("草稿按钮带 haspopup 并展示数量", () => {
    renderToolbar();
    const draftsBtn = screen.getByRole("button", { name: /草稿与历史（3）/ });
    expect(draftsBtn.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(draftsBtn);
    expect(BASE.onOpenDrafts).toHaveBeenCalled();
  });

  it("设置按钮触发 onOpenSettings", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /AI 设置（未配置）/ }));
    expect(BASE.onOpenSettings).toHaveBeenCalled();
  });

  it("llmReady 时设置按钮显示已配置", () => {
    renderToolbar({ llmReady: true });
    expect(screen.getByRole("button", { name: /AI 设置（已配置）/ })).toBeTruthy();
  });

  it("全屏预览按钮带 aria-pressed 并切换", () => {
    renderToolbar();
    const previewBtn = screen.getByRole("button", { name: "全屏预览" });
    expect(previewBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(previewBtn);
    expect(BASE.onTogglePreviewOnly).toHaveBeenCalled();
  });

  it("预览模式下按钮 aria-pressed=true 且标签为显示编辑栏", () => {
    renderToolbar({ previewOnly: true });
    const btn = screen.getByRole("button", { name: "显示编辑栏" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("桌面端展示内置终端按钮并切换", () => {
    const onToggle = vi.fn();
    renderToolbar({ showTerminal: true, onToggleTerminal: onToggle });
    const termBtn = screen.getByRole("button", { name: "打开内置终端" });
    expect(termBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(termBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  it("非桌面端不展示终端按钮", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: /内置终端/ })).toBeNull();
  });

  it("主题按钮触发 onCycleTheme", () => {
    renderToolbar();
    const themeBtn = screen.getByRole("button", { name: /主题/ });
    fireEvent.click(themeBtn);
    expect(BASE.onCycleTheme).toHaveBeenCalled();
  });
});

describe("Toolbar — AI 自动完成按钮", () => {
  it("渲染 AI 自动完成按钮并触发 onOpenAutoAgent", () => {
    const onOpen = vi.fn();
    renderToolbar({ onOpenAutoAgent: onOpen });
    const btn = screen.getByRole("button", { name: "AI 自动完成" });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });

  it("active 态按钮带 aria-pressed", () => {
    renderToolbar({ autoAgentOpen: true, onOpenAutoAgent: vi.fn() });
    const btn = screen.getByRole("button", { name: "AI 自动完成" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Toolbar — AI 连接中心按钮", () => {
  it("渲染 AI 连接中心按钮并触发 onOpenAiConnect", () => {
    const onOpen = vi.fn();
    renderToolbar({ onOpenAiConnect: onOpen });
    const btn = screen.getByRole("button", { name: "AI 连接中心" });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });

  it("active 态按钮带 aria-pressed", () => {
    renderToolbar({ aiConnectOpen: true, onOpenAiConnect: vi.fn() });
    const btn = screen.getByRole("button", { name: "AI 连接中心" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Toolbar — LLM 调用观测按钮(AI-ROBUST-03)", () => {
  it("渲染 LLM 调用观测按钮并触发 onOpenLlmTelemetry", () => {
    const onOpen = vi.fn();
    renderToolbar({ onOpenLlmTelemetry: onOpen });
    const btn = screen.getByRole("button", { name: "LLM 调用观测" });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });

  it("active 态按钮带 aria-pressed", () => {
    renderToolbar({ llmTelemetryOpen: true, onOpenLlmTelemetry: vi.fn() });
    const btn = screen.getByRole("button", { name: "LLM 调用观测" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Toolbar — v4 协作共享按钮", () => {
  it("协作共享按钮带 haspopup 并触发 onOpenCollab", () => {
    const onOpenCollab = vi.fn();
    renderToolbar({ collabOpen: true, onOpenCollab });
    const btn = screen.getByRole("button", { name: "协作共享" });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onOpenCollab).toHaveBeenCalled();
  });
});
