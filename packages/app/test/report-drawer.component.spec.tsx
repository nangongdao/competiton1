/**
 * v3 · 复盘报告抽屉组件测试。
 *
 * 覆盖:
 * - 空效果记录时按钮禁用并提示;
 * - 有效果记录时点击生成报告展示 Markdown 预览;
 * - 复制与导出按钮存在。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { ReportDrawer } from "../src/components/ReportDrawer.js";
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

describe("ReportDrawer", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      markdown: "# 我的文章\n\n正文内容",
      llm: { baseUrl: "", apiKey: "", model: "" },
      llmConfigs: [],
      activeLlmConfigId: null,
      performanceRecords: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("空效果记录时按钮禁用并提示", () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("发布复盘报告")).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成报告/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/暂无效果记录/)).toBeTruthy();
  });

  it("有效果记录时点击生成报告展示 Markdown 预览", async () => {
    useStore.setState({
      performanceRecords: [
        {
          id: "m1",
          platformId: "wechat",
          title: "A 文章",
          publishedAt: "2026-08-01T10:00:00Z",
          collectedAt: "2026-08-01T10:00:00Z",
          metrics: { views: 1000, likes: 50 },
          source: "manual",
        },
      ],
    });
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /生成报告/ });
    expect(btn).toHaveProperty("disabled", false);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText("复制 Markdown")).toBeTruthy();
      expect(screen.getByText("导出 .md")).toBeTruthy();
    });
    expect(screen.getAllByText(/多平台发布复盘报告/).length).toBeGreaterThan(0);
    expect(screen.getByText(/总阅读/)).toBeTruthy();
  });
});

describe("ReportDrawer · REP-03 模板与导出", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      markdown: "# 我的文章\n\n正文内容",
      llm: { baseUrl: "", apiKey: "", model: "" },
      llmConfigs: [],
      activeLlmConfigId: null,
      performanceRecords: [
        {
          id: "m1",
          platformId: "wechat",
          title: "A 文章",
          publishedAt: "2026-08-05T10:00:00Z",
          collectedAt: "2026-08-05T10:00:00Z",
          metrics: { views: 1000, likes: 50 },
          source: "manual",
        },
        {
          id: "m2",
          platformId: "zhihu",
          title: "B 文章",
          publishedAt: "2026-08-01T10:00:00Z",
          collectedAt: "2026-08-01T10:00:00Z",
          metrics: { views: 500 },
          source: "manual",
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("提供模板选择器(综合/周报/月报/平台专项)", () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    const sel = screen.getByLabelText("报告模板") as HTMLSelectElement;
    expect(sel).toBeTruthy();
    const options = [...sel.options].map((o) => o.value);
    expect(options).toEqual(["overview", "weekly", "monthly", "platform"]);
  });

  it("选择平台专项模板时出现目标平台选择", async () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    const sel = screen.getByLabelText("报告模板") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "platform" } });
    expect(screen.getByLabelText("目标平台")).toBeTruthy();
  });

  it("周报模板生成报告标题为周报", async () => {
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    const sel = screen.getByLabelText("报告模板") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: /生成报告/ }));
    await waitFor(() => {
      // 报告正文包含周报标题与近 7 天说明
      const pre = document.querySelector(".report-preview")?.textContent ?? "";
      expect(pre).toContain("# 周报");
      expect(pre).toContain("近 7 天数据");
    });
  });

  it("REPORT-AI-01 渲染 AI 解读区块", async () => {
    useStore.setState({
      performanceRecords: [
        {
          id: "m1",
          platformId: "wechat",
          title: "A 文章",
          publishedAt: "2026-08-01T10:00:00Z",
          collectedAt: "2026-08-01T10:00:00Z",
          metrics: { views: 500 },
          source: "manual",
        },
      ],
    });
    render(<ReportDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /生成报告/ }));
    await waitFor(() => {
      expect(document.querySelector(".report-preview")?.textContent).toContain("复盘报告");
    });
    // AI 解读入口出现。
    expect(screen.getByText(/AI 报告解读/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI 解读/ })).toBeTruthy();
    // 点击后规则解读(无 LLM)。
    fireEvent.click(screen.getByRole("button", { name: /AI 解读/ }));
    await waitFor(() => {
      expect(screen.getByText(/亮点/)).toBeTruthy();
    });
  });
});
