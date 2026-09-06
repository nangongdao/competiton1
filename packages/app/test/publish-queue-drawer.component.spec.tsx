// @vitest-environment jsdom
/**
 * PublishQueueDrawer 组件测试 —— 发布队列面板交互(ROADMAP_V5 Phase 1)。
 * 存储/调度逻辑已在 core `publish-queue.spec.ts` 与 store 测试覆盖,此处验证组件行为。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "./helpers/render.js";
import { PublishQueueDrawer } from "../src/components/PublishQueueDrawer.js";
import { useStore } from "../src/state/store.js";

function resetStore() {
  useStore.setState({
    publishQueue: [],
    drafts: [
      {
        id: "d1",
        title: "测试草稿",
        markdown: "# 标题\n正文",
        authorName: "作者",
        tags: [],
        updatedAt: "2026-08-05T00:00:00Z",
      },
    ],
    currentDraftId: "d1",
    selectedPlatforms: ["wechat", "zhihu"],
    loadPublishQueue: vi.fn(async () => undefined),
    enqueuePublish: vi.fn(async () => ({ ok: true, id: "q1" })),
    triggerPublishQueue: vi.fn(async () => ({ ok: true })),
    reschedulePublishQueue: vi.fn(async () => ({ ok: true })),
    cancelPublishQueue: vi.fn(async () => ({ ok: true })),
    removePublishQueue: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  resetStore();
});

describe("PublishQueueDrawer 发布队列面板", () => {
  it("空态展示提示与排入队列表单", () => {
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("发布队列")).toBeTruthy();
    expect(screen.getByText(/发布队列为空/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /排入发布队列/ })).toBeTruthy();
  });

  it("创建时缺少草稿给出错误提示且不调用 action", async () => {
    useStore.setState({ currentDraftId: null });
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /排入发布队列/ }));
    expect(screen.getByText("请选择要发布的草稿")).toBeTruthy();
    expect(useStore.getState().enqueuePublish).not.toHaveBeenCalled();
  });

  it("选择草稿并排入队列调用 store action", async () => {
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("关联草稿"), "d1");
    await userEvent.click(screen.getByRole("button", { name: /排入发布队列/ }));

    await waitFor(() => {
      expect(useStore.getState().enqueuePublish).toHaveBeenCalled();
    });
    const arg = vi.mocked(useStore.getState().enqueuePublish).mock.calls[0]![0];
    expect(arg.draftId).toBe("d1");
    expect(arg.platformIds).toContain("wechat");
    expect(arg.scheduledAt).toBeTruthy();
  });

  it("列表展示条目状态与操作按钮", () => {
    useStore.setState({
      publishQueue: [
        {
          id: "q1",
          name: "周五发布",
          draftId: "d1",
          platformIds: ["wechat"],
          scheduledAt: "2026-08-12T10:00:00Z",
          accountRefs: [{ platformId: "wechat", serverProfileId: "p" }],
          realPublish: true,
          status: "queued",
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-10T00:00:00Z",
        },
      ],
    });
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("周五发布")).toBeTruthy();
    expect(screen.getByText("排队中")).toBeTruthy();
    expect(screen.getByRole("button", { name: /立即执行/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /取消/ })).toBeTruthy();
  });

  it("已取消条目不显示立即执行/取消按钮,但可删除", () => {
    useStore.setState({
      publishQueue: [
        {
          id: "q2",
          name: "取消测试",
          draftId: "d1",
          platformIds: ["wechat"],
          scheduledAt: "2026-08-12T10:00:00Z",
          accountRefs: [],
          realPublish: true,
          status: "cancelled",
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-10T00:00:00Z",
        },
      ],
    });
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("已取消")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /立即执行/ })).toBeNull();
    expect(screen.getByRole("button", { name: /删除/ })).toBeTruthy();
  });

  it("AI 自动排期按钮可用,生成建议后可采纳(ROADMAP_V5 Phase 4)", async () => {
    // mock generateQueueSchedule 经 buildLlmAdapter → 无 key 走规则兜底,应返回规则建议。
    useStore.setState({
      llm: { baseUrl: "", apiKey: "", model: "" },
      llmConfigs: [],
      activeLlmConfigId: null,
      performanceRecords: [],
      markdown: "# 测试草稿\n正文",
    });
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /AI 自动排期/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    // 规则建议会立即返回(无 LLM)。
    await waitFor(() => {
      expect(screen.getAllByText(/规则/).length).toBeGreaterThan(0);
    });
    // 至少出现一条建议与采纳按钮。
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /采纳此建议/ }).length).toBeGreaterThan(0);
    });
  });

  it("效果预测区块:有历史数据时可生成并展示预期阅读区间(v10 FORECAST-QUEUE-01)", async () => {
    useStore.setState({
      markdown: "# 测试草稿\n正文",
      performanceRecords: [
        {
          id: "p1",
          platformId: "wechat",
          title: "历史A",
          remoteId: undefined,
          remoteUrl: undefined,
          publishedAt: "2026-08-01T10:00:00.000Z",
          collectedAt: "2026-08-01T10:00:00.000Z",
          metrics: { views: 100 },
          source: "manual",
        },
        {
          id: "p2",
          platformId: "wechat",
          title: "历史B",
          remoteId: undefined,
          remoteUrl: undefined,
          publishedAt: "2026-08-02T10:00:00.000Z",
          collectedAt: "2026-08-02T10:00:00.000Z",
          metrics: { views: 200 },
          source: "manual",
        },
      ],
    });
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /效果预测/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/预测完成/)).toBeTruthy();
    });
    // 展示推荐平台采纳按钮。
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /采纳推荐平台/ })).toBeTruthy();
    });
  });

  it("内容矩阵平台建议区块:有数据时生成建议并可采纳(v10 MATRIX-QUEUE)", async () => {
    useStore.setState({
      markdown: "# 测试草稿\n正文",
      performanceRecords: [
        {
          id: "p1",
          platformId: "wechat",
          title: "历史A",
          remoteId: undefined,
          remoteUrl: undefined,
          publishedAt: "2026-08-01T10:00:00.000Z",
          collectedAt: "2026-08-01T10:00:00.000Z",
          metrics: { views: 100 },
          source: "manual",
        },
        {
          id: "p2",
          platformId: "wechat",
          title: "历史B",
          remoteId: undefined,
          remoteUrl: undefined,
          publishedAt: "2026-08-02T10:00:00.000Z",
          collectedAt: "2026-08-02T10:00:00.000Z",
          metrics: { views: 200 },
          source: "manual",
        },
      ],
    });
    render(<PublishQueueDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /平台建议/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    // 有数据时生成矩阵建议。
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /采纳此建议/ }).length).toBeGreaterThan(0);
    });
  });
});
