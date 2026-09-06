// @vitest-environment jsdom
/**
 * PublishBatchDrawer 组件测试 —— 发布批次面板交互(ROADMAP_V5 Phase 2)。
 * 存储/调度逻辑已在 core `publish-batch.spec.ts` 与 store 测试覆盖,此处验证组件行为。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "./helpers/render.js";
import { PublishBatchDrawer } from "../src/components/PublishBatchDrawer.js";
import { useStore } from "../src/state/store.js";

function resetStore() {
  useStore.setState({
    publishBatches: [],
    lastBatchCollect: null,
    drafts: [
      {
        id: "d1",
        title: "草稿一",
        markdown: "# 标题\n正文",
        authorName: "作者",
        tags: [],
        updatedAt: "2026-08-05T00:00:00Z",
      },
      {
        id: "d2",
        title: "草稿二",
        markdown: "# 标题二\n正文",
        authorName: "作者",
        tags: [],
        updatedAt: "2026-08-05T00:00:00Z",
      },
    ],
    currentDraftId: "d1",
    selectedPlatforms: ["wechat", "zhihu"],
    loadPublishBatches: vi.fn(async () => undefined),
    createPublishBatch: vi.fn(async () => ({ ok: true, id: "b1" })),
    triggerPublishBatchItem: vi.fn(async () => ({ ok: true })),
    retryPublishBatchFailed: vi.fn(async () => ({ ok: true, retried: 1 })),
    cancelPublishBatch: vi.fn(async () => ({ ok: true })),
    removePublishBatch: vi.fn(async () => undefined),
    collectBatchMetrics: vi.fn(async () => ({ ok: true, imported: 2, skipped: 0 })),
    reschedulePublishBatchItem: vi.fn(async () => ({ ok: true })),
  });
}

beforeEach(() => {
  resetStore();
});

describe("PublishBatchDrawer 发布批次面板", () => {
  it("空态展示提示与创建表单", () => {
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("发布批次")).toBeTruthy();
    expect(screen.getByText(/暂无发布批次/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /创建发布批次/ })).toBeTruthy();
  });

  it("未勾选草稿时给出错误提示且不调用 action", async () => {
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /创建发布批次/ }));
    expect(screen.getByText("请至少勾选一篇草稿")).toBeTruthy();
    expect(useStore.getState().createPublishBatch).not.toHaveBeenCalled();
  });

  it("勾选草稿并创建批次调用 store action", async () => {
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /草稿一/ }));
    await userEvent.click(screen.getByRole("button", { name: /创建发布批次（1 篇）/ }));

    await waitFor(() => {
      expect(useStore.getState().createPublishBatch).toHaveBeenCalled();
    });
    const arg = vi.mocked(useStore.getState().createPublishBatch).mock.calls[0]![0];
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0]!.draftId).toBe("d1");
    expect(arg.scheduledAt).toBeTruthy();
  });

  it("批次列表展示状态与操作按钮(重试失败/批量回收效果/删除)", () => {
    useStore.setState({
      publishBatches: [
        {
          id: "b1",
          name: "晨间三篇",
          items: [
            {
              itemId: "b1-d1",
              draftId: "d1",
              draftTitle: "草稿一",
              platformIds: ["wechat", "zhihu"],
              accountRefs: [],
              realPublish: true,
              scheduledAt: "2026-08-12T10:00:00Z",
              status: "failed",
              error: "平台返回 401",
              createdAt: "2026-08-10T00:00:00Z",
              updatedAt: "2026-08-10T00:00:00Z",
            },
          ],
          status: "failed",
          scheduledAt: "2026-08-12T10:00:00Z",
          accountRefs: [],
          realPublish: true,
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-10T00:00:00Z",
          retro: {
            total: 1,
            succeeded: 0,
            failed: 1,
            skipped: 0,
            successRate: 0,
            platformCount: 1,
            byPlatform: [{ platformId: "wechat", ok: 0, total: 1 }],
            suggestions: ["1 篇发布失败,建议检查对应平台登录态与凭据后重试。"],
            collectibleRemoteIds: 0,
          },
        },
      ],
    });
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("晨间三篇")).toBeTruthy();
    expect(screen.getAllByText("失败").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /重试失败/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /批量回收效果/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /删除/ })).toBeTruthy();
  });

  it("v6:批次条目可单条改期(调用 reschedulePublishBatchItem)", async () => {
    useStore.setState({
      publishBatches: [
        {
          id: "b1",
          name: "晨间三篇",
          items: [
            {
              itemId: "b1-d1",
              draftId: "d1",
              draftTitle: "草稿一",
              platformIds: ["wechat"],
              accountRefs: [],
              realPublish: true,
              scheduledAt: "2026-08-12T10:00:00Z",
              status: "queued",
              createdAt: "2026-08-10T00:00:00Z",
              updatedAt: "2026-08-10T00:00:00Z",
            },
          ],
          status: "queued",
          scheduledAt: "2026-08-12T10:00:00Z",
          accountRefs: [],
          realPublish: true,
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-10T00:00:00Z",
        },
      ],
      reschedulePublishBatchItem: vi.fn(async () => ({ ok: true })),
    });
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /^改期$/ }));
    expect(screen.getByText(/改期批次条目「草稿一」/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /确认改期/ }));
    const spy = useStore.getState().reschedulePublishBatchItem as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    const [batchId, itemId, iso] = spy.mock.calls[0] as [string, string, string];
    expect(batchId).toBe("b1");
    expect(itemId).toBe("b1-d1");
    expect(Number.isFinite(Date.parse(iso))).toBe(true);
  });

  it("AI 排期建议可用,勾选草稿后生成并采纳(ROADMAP_V5 增强)", async () => {
    useStore.setState({
      markdown: "# 当前编辑\n正文",
      llm: { baseUrl: "", apiKey: "", model: "" },
      llmConfigs: [],
      activeLlmConfigId: null,
      performanceRecords: [],
    });
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /AI 自动排期/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /采纳此建议/ }).length).toBeGreaterThan(0);
    });
  });

  it("v6 Phase 2:批次整体改期按钮调用 reschedulePublishBatchAll", async () => {
    useStore.setState({
      publishBatches: [
        {
          id: "b1",
          name: "晨间三篇",
          items: [
            {
              itemId: "b1-d1",
              draftId: "d1",
              draftTitle: "草稿一",
              platformIds: ["wechat"],
              accountRefs: [],
              realPublish: true,
              scheduledAt: "2026-08-12T10:00:00Z",
              status: "queued",
              createdAt: "2026-08-10T00:00:00Z",
              updatedAt: "2026-08-10T00:00:00Z",
            },
          ],
          status: "queued",
          scheduledAt: "2026-08-12T10:00:00Z",
          accountRefs: [],
          realPublish: true,
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-10T00:00:00Z",
        },
      ],
      reschedulePublishBatchAll: vi.fn(async () => ({ ok: true, rescheduled: 1, skipped: 0 })),
      loadPublishBatches: vi.fn(async () => undefined),
    });
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /整体改期/ }));
    expect(screen.getByText(/整体改期批次「晨间三篇」/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /确认整体改期/ }));
    const spy = useStore.getState().reschedulePublishBatchAll as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    const [batchId, iso] = spy.mock.calls[0] as [string, string];
    expect(batchId).toBe("b1");
    expect(Number.isFinite(Date.parse(iso))).toBe(true);
  });

  it("效果预测区块:有历史数据时可生成(v10 FORECAST-QUEUE-01 批次表单)", async () => {
    useStore.setState({
      markdown: "# 批次草稿\n正文",
      performanceRecords: [
        {
          id: "p1",
          platformId: "zhihu",
          title: "历史A",
          remoteId: undefined,
          remoteUrl: undefined,
          publishedAt: "2026-08-01T10:00:00.000Z",
          collectedAt: "2026-08-01T10:00:00.000Z",
          metrics: { views: 120 },
          source: "manual",
        },
        {
          id: "p2",
          platformId: "zhihu",
          title: "历史B",
          remoteId: undefined,
          remoteUrl: undefined,
          publishedAt: "2026-08-02T10:00:00.000Z",
          collectedAt: "2026-08-02T10:00:00.000Z",
          metrics: { views: 180 },
          source: "manual",
        },
      ],
    });
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /效果预测/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/预测完成/)).toBeTruthy();
    });
  });

  it("内容矩阵平台建议区块:有数据时生成建议(v10 MATRIX-QUEUE 批次表单)", async () => {
    useStore.setState({
      markdown: "# 批次草稿\n正文",
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
    render(<PublishBatchDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /平台建议/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /采纳此建议/ }).length).toBeGreaterThan(0);
    });
  });
});
