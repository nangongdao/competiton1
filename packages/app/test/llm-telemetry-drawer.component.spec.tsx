/**
 * LLM 调用观测抽屉组件测试(AI-ROBUST-03)。
 *
 * 覆盖:
 * - 渲染标题与空态提示;
 * - 有调用记录时展示汇总卡片与最近调用列表;
 * - 清空记录按钮清空观测器并刷新快照。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { LlmTelemetryDrawer } from "../src/components/LlmTelemetryDrawer.js";
import { useStore } from "../src/state/store.js";
import { llmTelemetry } from "@mpp/core";
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

describe("LlmTelemetryDrawer — LLM 调用观测", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    llmTelemetry.clear();
    useStore.setState({
      llmCalls: [],
      llmTelemetrySummary: {
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        successRate: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        byTask: {},
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    llmTelemetry.clear();
  });

  it("渲染标题与空态提示", () => {
    render(<LlmTelemetryDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("LLM 调用观测")).toBeTruthy();
    expect(screen.getByText(/还没有 LLM 调用/)).toBeTruthy();
    expect(screen.getByText("总调用")).toBeTruthy();
  });

  it("有调用记录时展示汇总与最近列表", async () => {
    // 先写入观测器。
    llmTelemetry.record({
      task: "title",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      durationMs: 120,
      ok: true,
      inputText: "效率工具",
      outputText: "5 个效率神器!",
      adapterId: "openai-compat",
    });
    llmTelemetry.record({
      task: "rewrite",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      durationMs: 300,
      ok: false,
      inputText: "原文",
      error: new Error("LLM 请求失败: HTTP 429"),
      adapterId: "openai-compat",
    });
    useStore.getState().refreshLlmTelemetry();

    render(<LlmTelemetryDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("2")).toBeTruthy(); // 总调用
    expect(screen.getAllByText("标题生成").length).toBeGreaterThan(0);
    expect(screen.getAllByText("润色").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/deepseek-chat@https:\/\/api.deepseek.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/HTTP 429/).length).toBeGreaterThan(0);
  });

  it("清空记录按钮清空观测器并刷新快照", async () => {
    llmTelemetry.record({
      task: "title",
      model: "m",
      baseUrl: "https://x/v1",
      durationMs: 10,
      ok: true,
      inputText: "a",
      outputText: "b",
      adapterId: "a",
    });
    useStore.getState().refreshLlmTelemetry();
    render(<LlmTelemetryDrawer open onOpenChange={() => undefined} />);
    const clearBtn = screen.getByRole("button", { name: /清空记录/ });
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(useStore.getState().llmCalls).toHaveLength(0);
      expect(useStore.getState().llmTelemetrySummary.totalCalls).toBe(0);
      expect(screen.getByText(/还没有 LLM 调用/)).toBeTruthy();
    });
  });
});
