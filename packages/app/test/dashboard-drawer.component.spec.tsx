// @vitest-environment jsdom
/**
 * DashboardDrawer 组件测试 —— 运营驾驶舱面板交互(v8 Phase 1/2)。
 * core 派生逻辑已在 `dashboard.spec.ts` / `dashboard-exec.spec.ts` 覆盖,此处验证组件行为。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "./helpers/render.js";
import { DashboardDrawer } from "../src/components/DashboardDrawer.js";
import { useStore } from "../src/state/store.js";
import type { PerformanceRecord } from "@mpp/core";

function makeRecord(partial: Partial<PerformanceRecord> & { id: string; platformId: string; title: string }): PerformanceRecord {
  return {
    historyId: undefined,
    remoteId: undefined,
    remoteUrl: undefined,
    publishedAt: "2026-08-01T00:00:00.000Z",
    collectedAt: "2026-08-01T00:00:00.000Z",
    metrics: {},
    source: "manual",
    ...partial,
  };
}

function resetStore() {
  const records: PerformanceRecord[] = [
    makeRecord({ id: "a", platformId: "wechat", title: "AI 写作入门", metrics: { views: 100, likes: 10 } }),
    makeRecord({ id: "b", platformId: "zhihu", title: "内容日历实践", metrics: { views: 80, likes: 5, comments: 3 } }),
    makeRecord({ id: "c", platformId: "bilibili", title: "桌面端使用技巧", metrics: { views: 200, shares: 20 } }),
  ];
  useStore.setState({
    performanceRecords: records,
    jobs: [],
    wordGoal: 0,
    setWordGoal: vi.fn(),
    retryJobPlatform: vi.fn(async () => undefined),
    loadPerformance: vi.fn(async () => undefined),
    loadJobs: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  resetStore();
});

describe("DashboardDrawer 运营驾驶舱", () => {
  it("渲染标题与各区块", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("运营驾驶舱")).toBeTruthy();
    expect(screen.getByText(/发布概览/)).toBeTruthy();
    expect(screen.getByText(/效果趋势/)).toBeTruthy();
    expect(screen.getByText(/平台对比/)).toBeTruthy();
    expect(screen.getByText(/内容排行/)).toBeTruthy();
    expect(screen.getByText(/目标进度/)).toBeTruthy();
    expect(screen.getByText(/发布健康/)).toBeTruthy();
  });

  it("效果趋势显示总阅读与峰值", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/总阅读 380/)).toBeTruthy();
    expect(screen.getByText(/峰值/)).toBeTruthy();
  });

  it("内容排行显示 Top 内容标题", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("桌面端使用技巧")).toBeTruthy();
    expect(screen.getByText("AI 写作入门")).toBeTruthy();
    expect(screen.getByText("内容日历实践")).toBeTruthy();
  });

  it("平台对比显示公众号/知乎", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getAllByText("公众号").length).toBeGreaterThan(0);
    expect(screen.getAllByText("知乎").length).toBeGreaterThan(0);
  });

  it("空数据时发布概览显示空态", () => {
    useStore.setState({ performanceRecords: [], jobs: [] });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/暂无发布任务记录/)).toBeTruthy();
  });

  it("有失败任务时发布健康展示聚合与重试按钮", () => {
    useStore.setState({
      jobs: [
        {
          id: "j1",
          contentDigest: "abc",
          stage: "failed",
          platformJobs: [
            {
              platformId: "wechat",
              stage: "failed",
              attemptCount: 1,
              attempts: [],
              uploadedAssets: [],
              error: "标题超长",
              createdAt: "2026-08-01T00:00:00Z",
              updatedAt: "2026-08-01T00:00:00Z",
            },
          ],
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getAllByText("公众号").length).toBeGreaterThan(0);
    expect(screen.getByText(/标题超长/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /重试/ })).toBeTruthy();
  });

  it("OPT-01/02 渲染内容优化建议与最佳发布时间区块", () => {
    useStore.setState({ markdown: "# 标题\n\n正文内容。" });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/内容优化建议/)).toBeTruthy();
    expect(screen.getByText(/最佳发布时间/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成优化建议/ })).toBeTruthy();
  });

  it("生成优化建议后展示建议列表与最佳时段", async () => {
    useStore.setState({
      markdown: "# 标题\n\n正文内容。",
      performanceRecords: [],
      llm: {},
      llmConfigs: [],
      activeLlmConfigId: null,
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /生成优化建议/ });
    await userEvent.click(btn);
    expect(await screen.findAllByText(/规则模式/)).toBeTruthy();
    // 空数据:出现数据引导建议。
    expect(screen.getByText(/还没有效果回收数据/)).toBeTruthy();
  });

  it("最佳发布时间学习显示峰值时段", async () => {
    useStore.setState({
      markdown: "# 标题\n\n正文内容。",
      llm: {},
      llmConfigs: [],
      activeLlmConfigId: null,
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 100 } }),
        makeRecord({ id: "b", platformId: "zhihu", title: "B", publishedAt: "2026-08-02T08:30:00Z", metrics: { views: 200 } }),
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /生成优化建议/ }));
    expect((await screen.findAllByText(/8:00 前后/)).length).toBeGreaterThan(0);
  });

  it("应用优化修复后可撤销", async () => {
    useStore.setState({
      // 标题超长触发可截断修复。
      markdown: "# " + "很".repeat(40) + "\n\n正文内容。",
      llm: {},
      llmConfigs: [],
      activeLlmConfigId: null,
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /生成优化建议/ }));
    const applyBtn = await screen.findAllByRole("button", { name: /应用/ });
    expect(applyBtn.length).toBeGreaterThan(0);
    await userEvent.click(applyBtn[0]!);
    expect(useStore.getState().markdown).not.toContain("很".repeat(40));
    // 出现撤销按钮并点击还原。
    const undoBtn = screen.getByRole("button", { name: /撤销/ });
    await userEvent.click(undoBtn);
    expect(useStore.getState().markdown).toContain("很".repeat(40));
  });

  // ---- v9:内容生命周期 / 效果预测 / 标签 ----
  it("v9 渲染内容生命周期与片段复用区块", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/内容生命周期/)).toBeTruthy();
    expect(screen.getByText(/内容片段复用/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /扫描老化内容/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /抽取片段/ })).toBeTruthy();
  });

  it("v9 扫描老化内容展示翻新建议", async () => {
    // 一篇 60 天前发布的低阅读旧文 → 高优先翻新。
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "old", platformId: "wechat", title: "旧文", publishedAt: "2026-06-01T10:00:00Z", metrics: { views: 10 } }),
        makeRecord({ id: "hot1", platformId: "wechat", title: "热文1", publishedAt: "2026-08-05T10:00:00Z", metrics: { views: 500 } }),
        makeRecord({ id: "hot2", platformId: "wechat", title: "热文2", publishedAt: "2026-08-06T10:00:00Z", metrics: { views: 600 } }),
      ],
      llm: {},
      llmConfigs: [],
      activeLlmConfigId: null,
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /扫描老化内容/ }));
    expect((await screen.findAllByText(/旧文/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/翻新/).length).toBeGreaterThan(0);
  });

  it("v9 发布效果预测展示区间与决策", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "A", publishedAt: "2026-08-01T08:00:00Z", metrics: { views: 100 } }),
        makeRecord({ id: "b", platformId: "wechat", title: "B", publishedAt: "2026-08-02T08:30:00Z", metrics: { views: 200 } }),
        makeRecord({ id: "c", platformId: "zhihu", title: "C", publishedAt: "2026-08-03T18:00:00Z", metrics: { views: 50 } }),
      ],
      markdown: "# 测试标题\n\n正文",
      llm: {},
      llmConfigs: [],
      activeLlmConfigId: null,
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /效果预测/ }));
    expect(await screen.findByText(/发布效果预测/)).toBeTruthy();
    // 公众号样本 2 个,中位 150。
    expect(screen.getAllByText(/150/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/立即发布/).length).toBeGreaterThan(0);
  });

  it("v9 内容标签展示当前内容自动标签", () => {
    useStore.setState({ markdown: "# 高效写作技巧\n\n写作效率提升方法" });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/内容标签/)).toBeTruthy();
    // 规则标签包含"写作"或"技巧"。
    expect(screen.getAllByText(/写作|技巧|效率/).length).toBeGreaterThan(0);
  });
});

// ---- v10 ----
describe("DashboardDrawer v10 发布后运营闭环", () => {
  it("渲染 v10 新区块标题", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/内容矩阵/)).toBeTruthy();
    expect(screen.getByText(/发布后运营/)).toBeTruthy();
  });

  it("内容排行可按关键词筛选", async () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    // 排行区块标题显示匹配数。
    expect(screen.getByText(/内容排行 Top 3/)).toBeTruthy();
    const input = screen.getByPlaceholderText(/按关键词\/平台筛选排行/);
    await userEvent.type(input, "AI");
    // 排行区块过滤后只剩 AI 写作入门。
    expect(screen.getByText(/内容排行 Top 1/)).toBeTruthy();
    expect(screen.getByText("AI 写作入门")).toBeTruthy();
  });

  it("内容矩阵构建展示平台覆盖与健康度", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "A", metrics: { views: 100 } }),
        makeRecord({ id: "b", platformId: "wechat", title: "B", metrics: { views: 200 } }),
        makeRecord({ id: "c", platformId: "zhihu", title: "C", metrics: { views: 50 } }),
        makeRecord({ id: "d", platformId: "zhihu", title: "D", metrics: { views: 60 } }),
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /构建矩阵/ }));
    expect((await screen.findAllByText(/内容矩阵/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/公众号/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/知乎/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/均衡/).length).toBeGreaterThan(0);
  });

  it("发布后运营生成待跟进清单", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "高互动文", metrics: { views: 100, likes: 60, comments: 20 } }),
        makeRecord({ id: "b", platformId: "zhihu", title: "低互动文", metrics: { views: 80 } }),
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /生成运营视图/ }));
    expect((await screen.findAllByText(/待跟进/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/高互动文/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/低互动文/).length).toBeGreaterThan(0);
  });

  it("批量翻新入队按钮随勾选启用", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "old", platformId: "wechat", title: "旧文", publishedAt: "2026-06-01T10:00:00Z", metrics: { views: 10 } }),
        makeRecord({ id: "hot", platformId: "wechat", title: "热文", publishedAt: "2026-08-05T10:00:00Z", metrics: { views: 500 } }),
      ],
      llm: {},
      llmConfigs: [],
      activeLlmConfigId: null,
      refreshAndEnqueue: vi.fn(async () => ({ ok: true, planned: 1, enqueued: 1 })),
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /扫描老化内容/ }));
    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);
    const btn = screen.getByRole("button", { name: /批量翻新入队\(0\)/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(checkboxes[0]!);
    const btn2 = screen.getByRole("button", { name: /批量翻新入队\(1\)/ });
    expect((btn2 as HTMLButtonElement).disabled).toBe(false);
  });

  it("发布后运营:待跟进提醒开关与手动提醒(v10 FOLLOWUP-NOTIFY)", async () => {
    // 数据缺口条目(high)→ 应触发提醒。
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "gap", platformId: "wechat", title: "缺数据文章" }),
      ],
      followUpReminderEnabled: false,
      followUpLastRemindedAt: null,
      followUpReminderDigest: null,
      setFollowUpReminderEnabled: vi.fn(),
      runFollowUpReminder: vi.fn(async () => ({ ok: true, notified: true })),
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    // 待跟进提醒开关存在。
    const toggle = screen.getByLabelText("开启待跟进提醒");
    expect(toggle).toBeTruthy();
    await userEvent.click(toggle);
    expect(useStore.getState().setFollowUpReminderEnabled).toHaveBeenCalledWith(true);
    // 手动「提醒我」按钮调用 store action。
    const btn = screen.getByRole("button", { name: /提醒我/ });
    await userEvent.click(btn);
    expect(useStore.getState().runFollowUpReminder).toHaveBeenCalledWith(true);
  });
});

// ---- v11 ----
describe("DashboardDrawer v11 内容策略智能引擎", () => {
  it("渲染 v11 新区块标题", () => {
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText(/翻新效果追踪/)).toBeTruthy();
    expect(screen.getByText(/效果归因/)).toBeTruthy();
    expect(screen.getAllByText(/内容策略/).length).toBeGreaterThan(0);
  });

  it("翻新效果追踪:点击后展示对照", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "orig", platformId: "wechat", title: "AI 写作入门", metrics: { views: 100, likes: 10 } }),
        makeRecord({ id: "ref", platformId: "wechat", title: "AI 写作入门(翻新 2026-08-08)", metrics: { views: 180, likes: 20 } }),
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /追踪翻新效果/ }));
    // 已配对判定「提升」并展示阅读对照。
    expect(await screen.findAllByText(/提升/)).not.toHaveLength(0);
    expect(screen.getAllByText(/AI 写作入门\(翻新 2026-08-08\)/).length).toBeGreaterThan(0);
  });

  it("效果归因:点击后展示维度差异", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "AI 写作入门", metrics: { views: 400 } }),
        makeRecord({ id: "b", platformId: "wechat", title: "AI 排版技巧", metrics: { views: 300 } }),
        makeRecord({ id: "c", platformId: "zhihu", title: "美食探店", metrics: { views: 30 } }),
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /归因分析/ }));
    // 平台维度高表现公众号。
    expect(await screen.findAllByText(/高表现/)).not.toHaveLength(0);
    expect(screen.getAllByText(/公众号|wechat/).length).toBeGreaterThan(0);
  });

  it("内容策略:点击后生成策略与目标预测", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "AI 写作入门", metrics: { views: 500 } }),
        makeRecord({ id: "b", platformId: "wechat", title: "AI 排版技巧", metrics: { views: 400 } }),
        makeRecord({ id: "c", platformId: "zhihu", title: "美食探店", metrics: { views: 50 } }),
      ],
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    // 设定月阅读目标(驱动目标达成预测)。
    await userEvent.type(screen.getByLabelText("月阅读目标"), "1000");
    await userEvent.click(screen.getByRole("button", { name: /生成策略/ }));
    // 目标达成预测卡片 + 策略步骤。
    expect(await screen.findByText(/目标达成预测/)).toBeTruthy();
    expect(screen.getAllByText(/加发|翻新|拓展|时段|优化/).length).toBeGreaterThan(0);
  });
});

// ---- v11 深化 ----
describe("DashboardDrawer v11 深化(策略采纳 + 目标提醒 + 翻新闭环)", () => {
  it("目标达成提醒开关 + 立即检查按钮(v11 深化 GOAL-NOTIFY-01)", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "AI 写作入门", metrics: { views: 500 } }),
        makeRecord({ id: "b", platformId: "wechat", title: "AI 排版技巧", metrics: { views: 400 } }),
      ],
      goalReminderEnabled: false,
      goalReminderDigest: null,
      setGoalReminderEnabled: vi.fn(),
      runGoalReminder: vi.fn(async () => ({ ok: true, notified: true })),
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /生成策略/ }));
    // 目标达成提醒开关。
    const toggle = await screen.findByLabelText("开启目标达成提醒");
    await userEvent.click(toggle);
    expect(useStore.getState().setGoalReminderEnabled).toHaveBeenCalledWith(true);
    // 立即检查按钮。
    const checkBtn = screen.getByRole("button", { name: /立即检查/ });
    await userEvent.click(checkBtn);
    expect(useStore.getState().runGoalReminder).toHaveBeenCalledWith(true);
  });

  it("策略步骤带采纳到发布队列按钮(v11 深化 STRATEGY-ADOPT-01)", async () => {
    useStore.setState({
      performanceRecords: [
        makeRecord({ id: "a", platformId: "wechat", title: "AI 写作入门", metrics: { views: 500 } }),
        makeRecord({ id: "b", platformId: "wechat", title: "AI 排版技巧", metrics: { views: 400 } }),
        makeRecord({ id: "c", platformId: "zhihu", title: "美食探店", metrics: { views: 50 } }),
      ],
      adoptStrategyToQueue: vi.fn(async () => ({ ok: true, id: "q1" })),
    });
    render(<DashboardDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /生成策略/ }));
    // 至少一个可采纳步骤按钮。
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /采纳到发布队列/ }).length).toBeGreaterThan(0);
    });
  });
});
