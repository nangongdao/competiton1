/**
 * App 编辑器智能输入辅助 —— 集成测试。
 *
 * 验证 textarea 上的按键处理:
 * - Tab 缩进当前行/光标处;
 * - Shift+Tab 反缩进;
 * - Enter 在列表项续行;
 * - 输入 `*` 自动补全闭合符。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { App } from "../src/App.js";
import { useStore } from "../src/state/store.js";
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

describe("App — 编辑器智能输入辅助 (v7 Phase 3)", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({ markdown: "", selectedPlatforms: [] });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("Tab 在光标处插入缩进", async () => {
    render(<App />);
    const area = screen.getByLabelText("Markdown 内容") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "hello" } });
    area.setSelectionRange(2, 2);
    fireEvent.keyDown(area, { key: "Tab" });
    await waitFor(() => {
      expect(useStore.getState().markdown).toBe("he  llo");
    });
  });

  it("Shift+Tab 反缩进当前行", async () => {
    render(<App />);
    const area = screen.getByLabelText("Markdown 内容") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "  hello" } });
    area.setSelectionRange(5, 5);
    fireEvent.keyDown(area, { key: "Tab", shiftKey: true });
    await waitFor(() => {
      expect(useStore.getState().markdown).toBe("hello");
    });
  });

  it("Enter 在无序列表项续行", async () => {
    render(<App />);
    const area = screen.getByLabelText("Markdown 内容") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "- item" } });
    area.setSelectionRange(6, 6);
    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() => {
      expect(useStore.getState().markdown).toBe("- item\n- ");
    });
  });

  it("输入 `*` 自动补全闭合符", async () => {
    render(<App />);
    const area = screen.getByLabelText("Markdown 内容") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "a" } });
    area.setSelectionRange(1, 1);
    fireEvent.keyDown(area, { key: "*" });
    await waitFor(() => {
      expect(useStore.getState().markdown).toBe("a**");
    });
  });

  it("Enter 在普通行不干预(默认换行)", async () => {
    render(<App />);
    const area = screen.getByLabelText("Markdown 内容") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "plain" } });
    area.setSelectionRange(5, 5);
    fireEvent.keyDown(area, { key: "Enter" });
    // 普通行不拦截:value 未变(React 受控),无 "- " 注入。
    await new Promise((r) => setTimeout(r, 50));
    expect(useStore.getState().markdown).toBe("plain");
  });
});
