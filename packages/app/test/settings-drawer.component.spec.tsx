/**
 * TEST-03 —— 设置抽屉组件测试(SEC-04 LLM key + 交互回归)。
 *
 * 验证:
 * - 打开时展示「API Key」输入与「持久化保存 API Key」开关;
 * - 默认 persistLlmKey=false 显示「仅本次会话」;
 * - 切换持久化开关触发 onPersistLlmKey;
 * - 点击「清除已保存的 API Key」触发 onClearLlmKey;
 * - 未配置 key 时增强开关 disabled(ready=false);
 * - 配置 key 后增强开关可用。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { SettingsDrawer } from "../src/components/SettingsDrawer.js";

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
  persistLlmKey: false,
  enhance: {},
  ready: false,
  serverUrl: "http://127.0.0.1:8787",
  runnerUrl: "http://127.0.0.1:8790",
  serverToken: "",
  runnerToken: "",
  wechatPublishMode: "mock" as const,
  automationModes: {},
  onLlm: vi.fn(),
  onPersistLlmKey: vi.fn(),
  onClearLlmKey: vi.fn(),
  onEnhance: vi.fn(),
  onServerUrl: vi.fn(),
  onRunnerUrl: vi.fn(),
  onServerToken: vi.fn(),
  onRunnerToken: vi.fn(),
  onWechatPublishMode: vi.fn(),
  onAutomationMode: vi.fn(),
};

describe("SettingsDrawer — 设置抽屉(SEC-04)", () => {
  it("打开时展示 API Key 输入与持久化开关,默认显示仅本次会话", () => {
    render(<SettingsDrawer {...BASE_PROPS} />);
    // LLM API Key 输入框以 placeholder="sk-..." 定位(避免与 Server/Runner token 冲突)。
    expect(screen.getByPlaceholderText("sk-...")).toBeTruthy();
    expect(screen.getByLabelText("持久化保存 API Key")).toBeTruthy();
    expect(screen.getAllByText(/仅本次会话/).length).toBeGreaterThan(0);
    // 未配置 key:增强开关 disabled。
    const enhanceSwitch = document.querySelector("[data-disabled]");
    expect(enhanceSwitch).toBeTruthy();
  });

  it("关闭时不渲染内容", () => {
    render(<SettingsDrawer {...BASE_PROPS} open={false} />);
    expect(screen.queryByPlaceholderText("sk-...")).toBeNull();
  });

  it("开启持久化后显示已持久化", () => {
    render(<SettingsDrawer {...BASE_PROPS} persistLlmKey />);
    expect(screen.getByText(/已持久化/)).toBeTruthy();
  });

  it("切换持久化开关触发 onPersistLlmKey", async () => {
    const onPersist = vi.fn();
    render(<SettingsDrawer {...BASE_PROPS} onPersistLlmKey={onPersist} />);
    const sw = screen.getByLabelText("持久化保存 API Key");
    sw.click();
    await vi.waitFor(() => expect(onPersist).toHaveBeenCalled());
  });

  it("点击清除已保存的 API Key 触发 onClearLlmKey", () => {
    const onClear = vi.fn();
    render(<SettingsDrawer {...BASE_PROPS} onClearLlmKey={onClear} />);
    const clearBtn = screen.getByRole("button", { name: /清除已保存的 API Key/ });
    clearBtn.click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("已配置 key(ready)时增强开关可用且展示 AI 设置标题", () => {
    render(
      <SettingsDrawer
        {...BASE_PROPS}
        ready
        llm={{ baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-chat" }}
        enhance={{ title: true }}
      />,
    );
    expect(screen.getByText("已配置，可启用下列增强")).toBeTruthy();
    // ready 时 switch-row 不再带 data-disabled。
    expect(document.querySelector("[data-disabled]")).toBeNull();
  });

  it("修改 API Key 输入触发 onLlm", async () => {
    const onLlm = vi.fn();
    render(<SettingsDrawer {...BASE_PROPS} onLlm={onLlm} />);
    const input = screen.getByPlaceholderText("sk-...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-new" } });
    await vi.waitFor(() => expect(onLlm).toHaveBeenCalled());
    expect(onLlm).toHaveBeenCalledWith({ apiKey: "sk-new" });
  });
});
