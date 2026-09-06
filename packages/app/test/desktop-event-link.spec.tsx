// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "./helpers/render.js";
import { App } from "../src/App.js";
import { useStore } from "../src/state/store.js";
import type { PlatformBridge, DesktopEventAction } from "../src/bridge/types.js";

/** 桌面端桥:实现 onDesktopEvent,模拟托盘/全局快捷键事件。 */
class DesktopStubBridge implements PlatformBridge {
  readonly env = "desktop" as const;
  readonly settings = new Map<string, string>();
  desktopHandlers = new Set<(action: DesktopEventAction) => void>();

  /** 触发一次桌面端功能面板事件(模拟托盘菜单 / 全局快捷键)。 */
  emitDesktop(action: DesktopEventAction): void {
    for (const h of this.desktopHandlers) h(action);
  }

  async writeClipboard() { return true; }
  async assistedHandoff() { return { ok: true, method: "clipboard" as const, message: "ok" }; }
  async publishWechat() { return { ok: true, message: "ok" }; }
  async publishAutomation() { return { ok: false, status: "failed" as const, message: "n/a" }; }
  async uploadAsset() { return { ok: false, message: "n/a" }; }
  async onDesktopEvent(handler: (action: DesktopEventAction) => void) {
    this.desktopHandlers.add(handler);
    return () => this.desktopHandlers.delete(handler);
  }
  async getSetting(key: string) { return this.settings.get(key); }
  async setSetting(key: string, value: string) { this.settings.set(key, value); }
}

describe("App — 桌面端托盘/全局快捷键联动(v3 功能面板)", () => {
  let bridge: DesktopStubBridge;
  beforeEach(() => {
    bridge = new DesktopStubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({ markdown: "# 标题\n\n正文。\n", llm: { baseUrl: "", apiKey: "", model: "" } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("托盘/快捷键 ai-agent 事件打开 AI 自动完成抽屉", async () => {
    render(<App />);
    bridge.emitDesktop("ai-agent");
    await waitFor(() => {
      expect(screen.getByText("AI 自动完成")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("托盘/快捷键 calendar 事件打开内容日历抽屉", async () => {
    render(<App />);
    bridge.emitDesktop("calendar");
    await waitFor(() => {
      expect(screen.getByText("内容日历")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("托盘/快捷键 report 事件打开复盘报告抽屉", async () => {
    render(<App />);
    bridge.emitDesktop("report");
    await waitFor(() => {
      expect(screen.getByText("发布复盘报告")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("托盘/快捷键 command-palette 事件打开命令面板", async () => {
    render(<App />);
    bridge.emitDesktop("command-palette");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索命令/)).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("v4:托盘/快捷键 accounts 事件打开账号管理抽屉", async () => {
    render(<App />);
    bridge.emitDesktop("accounts");
    await waitFor(() => {
      expect(screen.getByText("账号管理")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("v4 Phase 3:托盘/快捷键 collab 事件打开协作共享抽屉", async () => {
    render(<App />);
    bridge.emitDesktop("collab");
    await waitFor(() => {
      expect(screen.getByText("协作共享")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("v5:托盘/快捷键 publish-queue 事件打开发布队列抽屉(一键排入队列入口)", async () => {
    render(<App />);
    bridge.emitDesktop("publish-queue");
    await waitFor(() => {
      expect(screen.getByText("发布队列")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("v6 Phase 2:托盘/快捷键 publish-batch 事件打开发布批次抽屉(一键入口)", async () => {
    render(<App />);
    bridge.emitDesktop("publish-batch");
    await waitFor(() => {
      expect(screen.getByText("发布批次")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("v6 Phase 2:Web 通知点击 `mpp:notification-click` 事件打开对应面板", async () => {
    render(<App />);
    window.dispatchEvent(new CustomEvent("mpp:notification-click", { detail: "publish-batch" }));
    await waitFor(() => {
      expect(screen.getByText("发布批次")).toBeTruthy();
    }, { timeout: 5000 });
  });
});
