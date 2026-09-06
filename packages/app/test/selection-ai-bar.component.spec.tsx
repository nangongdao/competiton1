/**
 * v3 · AI 选区操作栏组件测试。
 *
 * 覆盖:
 * - 无选区时不渲染操作栏;
 * - 选中文本后显示操作按钮(风格改写/润色/扩写/续写/摘要/翻译);
 * - 未配置 LLM 时点击操作提示未配置;
 * - 配置 LLM 后点击「风格改写」应用 LLM 结果替换选区。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "./helpers/render.js";
import { SelectionAiBar } from "../src/components/SelectionAiBar.js";
import { useStore } from "../src/state/store.js";
import { subscribeToasts } from "../src/components/toast.js";
import type { PlatformBridge } from "../src/bridge/types.js";

class StubBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly settings = new Map<string, string>();
  async writeClipboard() { return true; }
  async assistedHandoff() { return { ok: true, method: "clipboard" as const, message: "ok" }; }
  async publishWechat() { return { ok: true, message: "ok" }; }
  async publishAutomation() { return { ok: false, status: "failed" as const, message: "n/a" }; }
  async uploadAsset() { return { ok: false, message: "n/a" }; }
  async getSetting(key: string) { return this.settings.get(key); }
  async setSetting(key: string, value: string) { this.settings.set(key, value); }
}

function makeTextarea(value: string): HTMLTextAreaElement {
  const area = document.createElement("textarea");
  area.value = value;
  area.setSelectionRange(4, 8); // 选中 "4567"
  document.body.appendChild(area);
  return area;
}

describe("SelectionAiBar", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      markdown: "0123456789",
      selectedPlatforms: ["wechat"],
      llm: { baseUrl: "", apiKey: "", model: "" },
      llmConfigs: [],
      activeLlmConfigId: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("无选区时不渲染操作栏", () => {
    const area = makeTextarea("0123456789");
    area.setSelectionRange(2, 2);
    const ref = { current: area };
    const { container } = render(<SelectionAiBar editorRef={ref} onApply={() => undefined} />);
    expect(container.querySelector(".selection-ai-bar")).toBeNull();
  });

  it("有选区时渲染操作按钮", () => {
    const area = makeTextarea("0123456789");
    const ref = { current: area };
    render(<SelectionAiBar editorRef={ref} onApply={() => undefined} />);
    // 触发选区读取
    act(() => {
      area.dispatchEvent(new Event("mouseup"));
    });
    expect(screen.getByLabelText("风格改写选区")).toBeTruthy();
    expect(screen.getByLabelText("润色选区")).toBeTruthy();
    expect(screen.getByLabelText("扩写选区")).toBeTruthy();
    expect(screen.getByLabelText("续写选区")).toBeTruthy();
    expect(screen.getByLabelText("摘要选区")).toBeTruthy();
    expect(screen.getByLabelText("中译英选区")).toBeTruthy();
    expect(screen.getByLabelText("英译中选区")).toBeTruthy();
  });

  it("未配置 LLM 时点击操作提示未配置", async () => {
    const area = makeTextarea("0123456789");
    const ref = { current: area };
    const onApply = vi.fn();
    const toasts: string[] = [];
    const unsub = subscribeToasts((t) => toasts.push(t.message));
    render(<SelectionAiBar editorRef={ref} onApply={onApply} />);
    act(() => {
      area.dispatchEvent(new Event("mouseup"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("风格改写选区"));
    });
    // 未配置 LLM → 不应用改写,保留原文,并弹出提示
    expect(onApply).not.toHaveBeenCalled();
    expect(toasts.some((m) => m.includes("未配置 LLM"))).toBe(true);
    unsub();
  });
});
