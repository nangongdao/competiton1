// @vitest-environment jsdom
/**
 * PerformanceDrawer 组件测试 —— 聚焦 UI 交互行为。
 * CSV 解析/汇总逻辑已在 core `analytics.spec.ts` 覆盖,此处 mock store action 验证组件交互。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, userEvent } from "./helpers/render.js";
import { PerformanceDrawer } from "../src/components/PerformanceDrawer.js";
import { useStore } from "../src/state/store.js";

const CSV = `platform,title,remote_id,views,likes,comments,shares
wechat,文章A,1001,1200,80,12,5
zhihu,回答B,2001,800,50,6,2
`;

function resetStore() {
  useStore.setState({
    performanceRecords: [],
    importPerformanceCsv: vi.fn(async () => ({ ok: true, imported: 2 })),
    addManualPerformance: vi.fn(async () => ({ ok: true })),
    removePerformanceRecord: vi.fn(async () => undefined),
    syncPerformanceFromApi: vi.fn(async () => ({ ok: true, message: "已同步 1 条" })),
    performanceSummary: () => [],
    performanceInsights: () => ({
      generatedAt: new Date().toISOString(),
      trends: [],
      growth: [],
      ranking: [],
      recommendations: [],
      insights: [],
    }),
  });
}

beforeEach(() => {
  resetStore();
});

describe("PerformanceDrawer 效果回收面板", () => {
  it("空态提示与各部分渲染", () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("发布效果回收")).toBeTruthy();
    expect(screen.getByText(/还没有效果记录/)).toBeTruthy();
    expect(screen.getByText("CSV 导入")).toBeTruthy();
    expect(screen.getByText("手工录入")).toBeTruthy();
    expect(screen.getAllByText(/官方 API 同步/).length).toBeGreaterThan(0);
  });

  it("CSV 空文本给出错误提示且不调用 action", async () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /导入 CSV/ }));
    expect(screen.getByText(/请先粘贴 CSV 内容/)).toBeTruthy();
    expect(useStore.getState().importPerformanceCsv).not.toHaveBeenCalled();
  });

  it("粘贴 CSV 后导入调用 store action 并展示结果", async () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    const textarea = screen.getByPlaceholderText(/platform,title,remote_id/);
    fireEvent.change(textarea, { target: { value: CSV } });
    await userEvent.click(screen.getByRole("button", { name: /导入 CSV/ }));

    await waitFor(() => {
      expect(useStore.getState().importPerformanceCsv).toHaveBeenCalledWith(CSV);
    });
    await waitFor(() => expect(screen.getByText(/已导入 2 条效果记录/)).toBeTruthy());
  });

  it("手工录入填写后调用 store action", async () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByPlaceholderText("标题"), "手工文章");
    await userEvent.type(screen.getByLabelText("阅读量"), "500");
    await userEvent.type(screen.getByLabelText("点赞数"), "30");
    await userEvent.click(screen.getByRole("button", { name: "录入" }));

    await waitFor(() => {
      expect(useStore.getState().addManualPerformance).toHaveBeenCalled();
    });
    const arg = vi.mocked(useStore.getState().addManualPerformance).mock.calls[0]![0];
    expect(arg.title).toBe("手工文章");
    expect(arg.metrics.views).toBe(500);
  });

  it("手工录入缺少标题给出错误且不调用 action", async () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "录入" }));
    expect(screen.getByText("请输入标题")).toBeTruthy();
    expect(useStore.getState().addManualPerformance).not.toHaveBeenCalled();
  });

  it("官方 API 同步按钮触发 sync action", async () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /从官方 API 同步指标/ }));
    await waitFor(() => {
      expect(useStore.getState().syncPerformanceFromApi).toHaveBeenCalled();
    });
  });

  it("AI 发布策略建议:点击生成后展示规则建议", async () => {
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /生成发布策略/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    await waitFor(
      () => {
        expect(screen.getAllByText(/规则建议/).length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    expect(screen.getAllByText(/选题/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/平台组合/).length).toBeGreaterThan(0);
  });

  it("有数据时展示智能分析洞察与行动建议", () => {
    useStore.setState({
      performanceRecords: [
        {
          id: "r1",
          platformId: "wechat",
          title: "爆款",
          remoteId: "1001",
          publishedAt: "2026-08-05T09:00:00Z",
          collectedAt: "2026-08-05T09:00:00Z",
          metrics: { views: 1200, likes: 80 },
          source: "manual",
        },
      ],
      performanceInsights: () => ({
        generatedAt: new Date().toISOString(),
        trends: [
          {
            platformId: "wechat",
            dailyViews: [{ day: "2026-08-05", views: 1200, likes: 80, comments: 0, shares: 0, count: 1 }],
            totalViews: 1200,
            totalEngagement: 80,
          },
        ],
        growth: [{ platformId: "wechat", recentViews: 1200, previousViews: 0, rate: null }],
        ranking: [
          { platformId: "wechat", count: 1, totalViews: 1200, avgViews: 1200, engagementRate: 0.067, score: 1280 },
        ],
        recommendations: ["优先在 wechat 发布高价值内容"],
        insights: [
          {
            kind: "best-platform",
            severity: "positive",
            title: "最佳平台:wechat",
            detail: "综合得分最高。",
          },
        ],
      }),
    });
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("发布效果智能分析")).toBeTruthy();
    expect(screen.getByText("最佳平台:wechat")).toBeTruthy();
    expect(screen.getByText("行动建议")).toBeTruthy();
    expect(screen.getByText(/优先在 wechat 发布高价值内容/)).toBeTruthy();
  });

  it("展示已有记录并提供删除按钮", async () => {
    useStore.setState({
      performanceRecords: [
        {
          id: "r1",
          platformId: "wechat",
          title: "已有文章",
          publishedAt: "2026-08-05T00:00:00Z",
          collectedAt: "2026-08-05T10:00:00Z",
          metrics: { views: 1200, likes: 80 },
          source: "manual",
        },
      ],
    });
    render(<PerformanceDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("已有文章")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "删除记录" }));
    expect(useStore.getState().removePerformanceRecord).toHaveBeenCalledWith("r1");
  });
});
