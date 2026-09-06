/**
 * v4 Phase 2 · WEEKLY-04 周报自动化 UI 组件测试。
 *
 * 覆盖:
 * - 「周报自动化」tab 存在并可切换;
 * - 创建周报任务表单(模板/窗口/投递渠道);
 * - 已配置周报任务列表展示(模板/窗口/投递/运行历史);
 * - 立即生成按钮触发 store 生成并展示预览。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { ReportDrawer } from "../src/components/ReportDrawer.js";
import { ToastHost } from "../src/components/ToastHost.js";
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

function seedState(records = 1) {
  useStore.setState({
    markdown: "# 我的文章\n\n正文内容",
    llm: { baseUrl: "", apiKey: "", model: "" },
    llmConfigs: [],
    activeLlmConfigId: null,
    performanceRecords: Array.from({ length: records }, (_, i) => ({
      id: `p${i}`,
      platformId: "wechat",
      title: `文章 ${i}`,
      publishedAt: "2026-08-06T10:00:00Z",
      collectedAt: "2026-08-06T10:00:00Z",
      metrics: { views: 1000 + i, likes: 50 },
      source: "manual",
    })),
  });
}

describe("ReportDrawer · WEEKLY-04 周报自动化", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    seedState(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("提供「周报自动化」tab 并可切换", async () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    const tab = screen.getByRole("button", { name: /周报自动化/ });
    expect(tab).toBeTruthy();
    fireEvent.click(tab);
    await waitFor(() => {
      expect(screen.getByText("新建周报任务")).toBeTruthy();
      expect(screen.getByText(/已配置周报任务/)).toBeTruthy();
    });
  });

  it("创建周报任务表单包含模板/窗口/投递渠道/LLM 开关", async () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /周报自动化/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("投递渠道")).toBeTruthy();
      expect(screen.getByText("使用 AI 周报总结")).toBeTruthy();
    });
    // 默认近 7 天窗口
    expect(screen.getByDisplayValue("7")).toBeTruthy();
  });

  it("创建周报任务后列表展示(模板/窗口/投递)", async () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /周报自动化/ }));
    await waitFor(() => expect(screen.getByText("新建周报任务")).toBeTruthy());
    // 填写名称并创建
    const nameInput = screen.getByPlaceholderText("例如:主编每周五周报");
    fireEvent.change(nameInput, { target: { value: "主编周报" } });
    fireEvent.click(screen.getByRole("button", { name: /创建周报任务/ }));
    await waitFor(() => {
      expect(screen.getByText("主编周报")).toBeTruthy();
    });
    // 列表展示模板与窗口信息
    expect(screen.getByText(/周报 · 近 7 天/)).toBeTruthy();
  });

  it("选择邮件渠道时出现目标输入框,为空时创建被拦截", async () => {
    render(<ToastHost />);
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /周报自动化/ }));
    await waitFor(() => expect(screen.getByText("新建周报任务")).toBeTruthy());
    const delivery = screen.getByLabelText("投递渠道") as HTMLSelectElement;
    fireEvent.change(delivery, { target: { value: "email" } });
    const target = screen.getByLabelText("投递目标") as HTMLInputElement;
    expect(target).toBeTruthy();
    // 不填目标直接创建 → toast 提示
    fireEvent.click(screen.getByRole("button", { name: /创建周报任务/ }));
    await waitFor(() => {
      expect(screen.getByText(/请填写投递目标/)).toBeTruthy();
    });
  });

  it("已配置任务显示运行历史摘要", async () => {
    // 通过 store 真实创建 + 生成,产生运行历史
    const created = await useStore.getState().createWeeklyJob({ name: "周五周报", useLlm: false });
    await useStore.getState().generateWeeklyReport(created.id!);
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /周报自动化/ }));
    await waitFor(() => {
      expect(screen.getByText("周五周报")).toBeTruthy();
      expect(document.body.textContent).toContain("规则总结");
    });
  });

  it("点击「立即生成」触发 store 生成并写入预览", async () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /周报自动化/ }));
    await waitFor(() => expect(screen.getByText("新建周报任务")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /立即生成预览/ }));
    await waitFor(() => {
      expect(useStore.getState().weeklyReportPreview).toContain("# 内容周报");
    });
  });
});
