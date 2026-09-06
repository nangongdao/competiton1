/**
 * AI 连接中心抽屉组件测试(Roadmap v2 Phase A/B)。
 *
 * 覆盖:
 * - 渲染标题/预设/表单/已保存配置区;
 * - 预设点击 → 自动创建配置并设为当前(表单被填充);
 * - 保存配置 → 出现在列表且标记"当前";
 * - 切换配置 → 全局 llm 同步;
 * - 删除配置 → 从列表移除;
 * - 连通性检测:未填 key 提示 / 成功展示消息。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { AiConnectDrawer } from "../src/components/AiConnectDrawer.js";
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

describe("AiConnectDrawer — AI 连接中心", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      llmConfigs: [],
      activeLlmConfigId: null,
      llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
      persistLlmKey: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染标题、预设区与已保存配置区", () => {
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("AI 连接中心")).toBeTruthy();
    expect(screen.getByText(/预设模板/)).toBeTruthy();
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    expect(screen.getByText("Ollama (本地)")).toBeTruthy();
    expect(screen.getByText(/已保存配置/)).toBeTruthy();
  });

  it("点击预设 → 自动创建配置并设为当前,表单被填充", async () => {
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByText("DeepSeek"));
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.llmConfigs.length).toBe(1);
      expect(state.activeLlmConfigId).toBe(state.llmConfigs[0].id);
      expect(state.llm.baseUrl).toBe("https://api.deepseek.com/v1");
    });
    // 表单被填充。
    const baseUrlInput = screen.getByDisplayValue("https://api.deepseek.com/v1");
    expect(baseUrlInput).toBeTruthy();
  });

  it("保存配置 → 出现在列表且标记当前", async () => {
    useStore.setState({
      llmConfigs: [],
      activeLlmConfigId: null,
      llm: { baseUrl: "", apiKey: "", model: "" },
    });
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    // 填表单。
    fireEvent.change(screen.getByPlaceholderText("如:我的 DeepSeek / 本地 Ollama"), { target: { value: "我的测试配置" } });
    fireEvent.change(screen.getByPlaceholderText("https://api.deepseek.com/v1"), { target: { value: "https://api.mo.com/v1" } });
    fireEvent.change(screen.getByPlaceholderText("deepseek-chat"), { target: { value: "test-model" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: /保存并设为当前/ }));
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.llmConfigs.length).toBe(1);
      expect(state.llmConfigs[0].name).toBe("我的测试配置");
      expect(state.llmConfigs[0].baseUrl).toBe("https://api.mo.com/v1");
      expect(state.llm.baseUrl).toBe("https://api.mo.com/v1");
    });
    expect(screen.getByText("我的测试配置")).toBeTruthy();
  });

  it("编辑已有配置并保存 → 更新而不新增", async () => {
    // 先建一条。
    const id = useStore.getState().saveLlmConfig({
      name: "旧配置",
      baseUrl: "https://api.old.com/v1",
      apiKey: "k",
      model: "m1",
    });
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    // 点编辑。
    fireEvent.click(screen.getByLabelText("编辑 旧配置"));
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue("旧配置");
      expect(nameInput).toBeTruthy();
    });
    fireEvent.change(screen.getByDisplayValue("旧配置"), { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: /保存并设为当前/ }));
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.llmConfigs.length).toBe(1);
      expect(state.llmConfigs[0].name).toBe("新名字");
      expect(state.llmConfigs[0].id).toBe(id);
    });
  });

  it("切换配置 → 全局 llm 同步", async () => {
    // 先重置(防止与其他测试共享状态)。
    useStore.setState({ llmConfigs: [], activeLlmConfigId: null });
    useStore.getState().saveLlmConfig({ name: "A", baseUrl: "https://api.a.com/v1", apiKey: "ka", model: "ma" });
    const bId = useStore.getState().saveLlmConfig({ name: "B", baseUrl: "https://api.b.com/v1", apiKey: "kb", model: "mb" });
    // 切回 A(当前是 B)。
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByLabelText("切换到 A"));
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.activeLlmConfigId).not.toBe(bId);
      expect(state.llm.baseUrl).toBe("https://api.a.com/v1");
    });
  });

  it("删除配置 → 从列表移除,若删除当前配置则回退空 llm", async () => {
    useStore.setState({ llmConfigs: [], activeLlmConfigId: null });
    useStore.getState().saveLlmConfig({ name: "待删", baseUrl: "https://api.d.com/v1", apiKey: "kd", model: "md" });
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByLabelText("删除 待删"));
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.llmConfigs.length).toBe(0);
      expect(state.llm.apiKey).toBe("");
    });
  });

  it("未填 key 时测试连接给出明确提示", async () => {
    render(<AiConnectDrawer open onOpenChange={() => undefined} />);
    // 填充 baseUrl 与 model(缺 key),使测试按钮可用。
    fireEvent.change(screen.getByPlaceholderText("https://api.deepseek.com/v1"), { target: { value: "https://api.x.com/v1" } });
    fireEvent.change(screen.getByPlaceholderText("deepseek-chat"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));
    await waitFor(() => {
      expect(screen.getByText(/请先填写 API 基址、模型与 API Key/)).toBeTruthy();
    });
  });
});
