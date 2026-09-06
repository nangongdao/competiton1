// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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

describe("App — AI 自动完成快捷键", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({ markdown: "# 标题\n\n正文。\n", llm: { baseUrl: "", apiKey: "", model: "" } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("Ctrl/Cmd+Shift+A 打开 AI 自动完成抽屉", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByText("AI 自动完成")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("Ctrl/Cmd+K 打开全局命令面板", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索命令/)).toBeTruthy();
    }, { timeout: 5000 });
    // 输入过滤:搜索「日历」命中内容日历命令
    fireEvent.change(screen.getByPlaceholderText(/搜索命令/), { target: { value: "日历" } });
    await waitFor(() => {
      expect(screen.getByText("内容日历")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("命令面板执行命令打开对应抽屉", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索命令/)).toBeTruthy();
    }, { timeout: 5000 });
    fireEvent.change(screen.getByPlaceholderText(/搜索命令/), { target: { value: "复盘" } });
    await waitFor(() => {
      expect(screen.getByText("发布复盘报告")).toBeTruthy();
    }, { timeout: 5000 });
    fireEvent.click(screen.getByText("发布复盘报告"));
    await waitFor(() => {
      expect(screen.getByText("发布复盘报告", { selector: ".drawer-title" })).toBeTruthy();
    }, { timeout: 5000 });
  });
});
