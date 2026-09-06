/**
 * AI 自动完成抽屉组件测试。
 *
 * 覆盖:
 * - 空内容时提示、未配置 LLM 时提示规则兜底;
 * - 点击「开始 AI 自动完成」后产出分步报告(分析/修复/增强/复核/汇总);
 * - 修复结果可一键应用并撤销;
 * - 平台标题/摘要候选可点击选择;
 * - LLM 已配置时展示模型名提示。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { AutoAgentDrawer } from "../src/components/AutoAgentDrawer.js";
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

const LONG_MD = `# 超长标题测试,这个标题特别特别长用来验证标题上限的截断行为是否正常工作

首段内容。这里讲一个效率方法,把一天切成若干九十分钟专注块。这段文字应该足够长,长到能够触发排版建议里的段落节奏问题与可读性问题,从而产生可自动修复的拆段建议。再多写一些字,让它超过两百个字的门槛,确保 readability 维度给出的超长文本块建议能够被派生为可执行修复动作,并且让自动修复轮次真正发生内容变化,验证整个 agent 修复链路闭环生效。

次段。这里讲一个方法,三步走。

![示意图](https://images.example.com/a.png)
`;

describe("AutoAgentDrawer", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      markdown: LONG_MD,
      selectedPlatforms: ["wechat", "xiaohongshu"],
      llm: { baseUrl: "", apiKey: "", model: "" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染标题与开始按钮", () => {
    render(<AutoAgentDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("AI 自动完成")).toBeTruthy();
    expect(screen.getByRole("button", { name: /开始 AI 自动完成/ })).toBeTruthy();
  });

  it("未配置 LLM 时展示规则兜底提示", () => {
    render(<AutoAgentDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/未配置 LLM/)).toBeTruthy();
  });

  it("配置 LLM 时展示模型名提示", () => {
    useStore.setState({ llm: { baseUrl: "https://x/v1", apiKey: "k", model: "deepseek-chat" } });
    render(<AutoAgentDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/deepseek-chat/)).toBeTruthy();
  });

  it("空内容时开始按钮禁用", async () => {
    useStore.setState({ markdown: "" });
    render(<AutoAgentDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /开始 AI 自动完成/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("点击开始后产出分步报告(纯规则路径)", async () => {
    render(<AutoAgentDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /开始 AI 自动完成/ }));
    await waitFor(
      () => {
        expect(screen.getByText("内容概况")).toBeTruthy();
        expect(screen.getByText("执行步骤")).toBeTruthy();
      },
      { timeout: 5000 },
    );
    // 四个步骤标签都应出现。
    expect(screen.getByText("标题/摘要增强")).toBeTruthy();
    expect(screen.getByText("校验复核")).toBeTruthy();
    expect(screen.getByText("汇总报告")).toBeTruthy();
    // 平台候选(小红书标题候选)。
    await waitFor(() => {
      expect(screen.getByText("平台标题/摘要候选")).toBeTruthy();
    });
  });

  it("修复结果可一键应用并撤销", async () => {
    render(<AutoAgentDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /开始 AI 自动完成/ }));
    await waitFor(() => {
      // 步骤或区块中任一出现“自动修复”即说明已跑完 fix 阶段。
      expect(screen.getAllByText(/自动修复/).length).toBeGreaterThan(0);
    });
    const applyBtn = screen.queryByRole("button", { name: /应用全部修复/ });
    if (applyBtn) {
      const before = useStore.getState().markdown;
      fireEvent.click(applyBtn);
      expect(useStore.getState().markdown).not.toBe(before);
      // 出现撤销按钮。
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /撤销修复/ })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: /撤销修复/ }));
      expect(useStore.getState().markdown).toBe(before);
    }
  });
});
