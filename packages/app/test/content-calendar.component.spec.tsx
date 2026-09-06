/**
 * v3 · 内容日历组件测试。
 *
 * 覆盖:
 * - 渲染月历与图例;
 * - 展示草稿/任务/发布/效果事件点;
 * - 点击某天展示当天事件详情;
 * - 月份切换。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { ContentCalendar } from "../src/components/ContentCalendar.js";
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

describe("ContentCalendar", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      drafts: [{ id: "d1", title: "我的草稿", markdown: "# x", authorName: "", tags: [], updatedAt: "2026-08-03T10:00:00Z" }],
      scheduledTasks: [],
      history: [{ id: "h1", draftTitle: "发布的文章", at: "2026-08-05T12:00:00Z", platforms: [{ platformId: "wechat", ok: true }] }],
      performanceRecords: [
        {
          id: "m1",
          platformId: "wechat",
          title: "效果文章",
          publishedAt: "2026-08-06T10:00:00Z",
          collectedAt: "2026-08-06T10:00:00Z",
          metrics: { views: 500 },
          source: "manual",
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染月历与图例", () => {
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    expect(screen.getByLabelText("内容日历")).toBeTruthy();
    expect(screen.getByText(/2026 年 8 月/)).toBeTruthy();
    expect(screen.getByText("草稿")).toBeTruthy();
    expect(screen.getByText("计划任务")).toBeTruthy();
    expect(screen.getByText("发布")).toBeTruthy();
    expect(screen.getByText("效果")).toBeTruthy();
  });

  it("点击有事件的日期展示事件详情", () => {
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-05/ }));
    expect(screen.getByText("2026-08-05")).toBeTruthy();
    expect(document.querySelector(".calendar-day-detail")?.textContent).toContain("发布的文章");
    // 事件 note 实际为 "发布 · 发布 1 平台"
    expect(screen.getByText(/发布 1 平台/)).toBeTruthy();
  });

  it("点击效果日期展示阅读量", () => {
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-06/ }));
    expect(document.querySelector(".calendar-day-detail")?.textContent).toContain("效果文章");
    expect(screen.getByText(/500 阅读/)).toBeTruthy();
  });

  it("切换到下个月并展示计划任务", () => {
    // 任务设为每周一 09:00,2026-09-07 是周一
    useStore.setState({
      scheduledTasks: [
        {
          id: "t1",
          name: "周报任务",
          cron: { minute: [0], hour: [9], dayOfWeek: [1] },
          action: { kind: "validate-generate" },
          platformIds: ["wechat"],
          draftId: "d1",
          status: "enabled",
          runs: [],
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByLabelText("下个月"));
    expect(screen.getByText(/2026 年 9 月/)).toBeTruthy();
    // 2026-09-07 是周一
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-09-07/ }));
    expect(document.querySelector(".calendar-day-detail")?.textContent).toContain("周报任务");
  });

  it("空日期显示无事件提示", () => {
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    // 8 月 10 日无事件
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-10/ }));
    expect(screen.getByText(/没有事件/)).toBeTruthy();
  });
});

describe("ContentCalendar · CAL-03 事件联动与拖拽改期", () => {
  it("点击草稿事件调用 onNavigate 打开详情", () => {
    const onNavigate = vi.fn();
    render(<ContentCalendar open onOpenChange={() => undefined} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-03/ }));
    // 点击草稿事件详情里的「打开详情」按钮
    const openBtn = screen.getByLabelText("打开草稿更新详情");
    fireEvent.click(openBtn);
    expect(onNavigate).toHaveBeenCalledWith("draft", "d1");
  });

  it("点击效果事件调用 onNavigate 打开效果抽屉", () => {
    const onNavigate = vi.fn();
    render(<ContentCalendar open onOpenChange={() => undefined} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-06/ }));
    fireEvent.click(screen.getByLabelText("打开效果数据详情"));
    expect(onNavigate).toHaveBeenCalledWith("metric", "m1");
  });

  it("计划任务事件可拖拽到目标日改期(调用 updateScheduledTask)", () => {
    // 先设置任务
    useStore.setState({
      scheduledTasks: [
        {
          id: "t1",
          name: "周报任务",
          cron: { minute: [30], hour: [9], dayOfWeek: [1] },
          action: { kind: "validate-generate" },
          platformIds: ["wechat"],
          draftId: "d1",
          status: "enabled",
          runs: [],
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });
    const updateSpy = vi.spyOn(useStore.getState(), "updateScheduledTask").mockResolvedValue({ ok: true });
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    // 2026-08-03 是周一,任务触发日
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-03/ }));
    const taskEl = Array.from(
      (document.querySelector(".calendar-day-detail") as HTMLElement | null)?.querySelectorAll(".calendar-event") ?? [],
    ).find((el) => el.textContent?.includes("周报任务")) ?? null;
    expect(taskEl).toBeTruthy();
    // 拖拽到 2026-08-05(周三)
    const targetCell = screen.getByRole("gridcell", { name: /2026-08-05/ });
    fireEvent.dragStart(taskEl as HTMLElement);
    fireEvent.drop(targetCell);
    expect(updateSpy).toHaveBeenCalled();
    const [id, patch] = updateSpy.mock.calls[0] as [string, { cron: { dayOfWeek: number[] } }];
    expect(id).toBe("t1");
    expect(patch.cron.dayOfWeek).toEqual([3]);
    updateSpy.mockRestore();
  });
});

describe("ContentCalendar · v6 发布队列/批次联动", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      drafts: [],
      scheduledTasks: [],
      history: [],
      performanceRecords: [],
      publishQueue: [
        {
          id: "q1",
          name: "稍后发布的文章",
          draftId: "d1",
          platformIds: ["wechat"],
          scheduledAt: "2026-08-12T18:00:00Z",
          accountRefs: [],
          realPublish: true,
          status: "queued",
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
      publishBatches: [
        {
          id: "b1",
          name: "本周批次",
          items: [
            {
              itemId: "b1-1",
              draftId: "d1",
              draftTitle: "批次文章",
              platformIds: ["zhihu"],
              accountRefs: [],
              realPublish: true,
              status: "queued",
            },
          ],
          status: "queued",
          scheduledAt: "2026-08-15T09:00:00Z",
          accountRefs: [],
          realPublish: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("发布队列/批次条目在日历中展示并可跳转详情", () => {
    const onNavigate = vi.fn();
    render(<ContentCalendar open onOpenChange={() => undefined} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-12/ }));
    expect(document.querySelector(".calendar-day-detail")?.textContent).toContain("稍后发布的文章");
    expect(screen.getByText("发布队列 · 1 平台")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("打开发布队列详情"));
    expect(onNavigate).toHaveBeenCalledWith("queue", "q1");

    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-15/ }));
    expect(document.querySelector(".calendar-day-detail")?.textContent).toContain("批次文章");
    fireEvent.click(screen.getByLabelText("打开发布批次详情"));
    expect(onNavigate).toHaveBeenCalledWith("batch", "b1-1");
  });

  it("发布队列条目可拖拽到目标日改期(调用 reschedulePublishQueue)", () => {
    const spy = vi
      .spyOn(useStore.getState(), "reschedulePublishQueue")
      .mockResolvedValue({ ok: true });
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-12/ }));
    const el = (document.querySelector(".calendar-day-detail") as HTMLElement | null)?.querySelectorAll(".calendar-event")[0] ?? null;
    expect(el).toBeTruthy();
    const targetCell = screen.getByRole("gridcell", { name: /2026-08-20/ });
    fireEvent.dragStart(el as HTMLElement);
    fireEvent.drop(targetCell);
    expect(spy).toHaveBeenCalledWith("q1", "2026-08-20T18:00:00.000Z");
    spy.mockRestore();
  });

  it("发布批次条目可拖拽到目标日改期(调用 reschedulePublishBatchItem)", () => {
    const spy = vi
      .spyOn(useStore.getState(), "reschedulePublishBatchItem")
      .mockResolvedValue({ ok: true });
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-15/ }));
    const el = (document.querySelector(".calendar-day-detail") as HTMLElement | null)?.querySelectorAll(".calendar-event")[0] ?? null;
    expect(el).toBeTruthy();
    const targetCell = screen.getByRole("gridcell", { name: /2026-08-21/ });
    fireEvent.dragStart(el as HTMLElement);
    fireEvent.drop(targetCell);
    expect(spy).toHaveBeenCalledWith("b1", "b1-1", "2026-08-21T09:00:00.000Z");
    spy.mockRestore();
  });
});

describe("ContentCalendar · v6 Phase 2 周/月视图切换 + 批量改期", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      drafts: [],
      scheduledTasks: [],
      history: [],
      performanceRecords: [],
      publishQueue: [
        {
          id: "q1",
          name: "队列A",
          draftId: "d1",
          platformIds: ["wechat"],
          scheduledAt: "2026-08-18T18:00:00Z",
          accountRefs: [],
          realPublish: true,
          status: "queued",
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
      publishBatches: [
        {
          id: "b1",
          name: "批次B",
          items: [
            {
              itemId: "b1-1",
              draftId: "d1",
              draftTitle: "批次条目",
              platformIds: ["zhihu"],
              accountRefs: [],
              realPublish: true,
              status: "queued",
            },
          ],
          status: "queued",
          scheduledAt: "2026-08-19T09:00:00Z",
          accountRefs: [],
          realPublish: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("切换到周视图并展示本周事件", () => {
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    // 先选中 2026-08-18(周二),周视图锚点定位到该日所在周(8/17~8/23)。
    fireEvent.click(screen.getByRole("gridcell", { name: /2026-08-18/ }));
    fireEvent.click(screen.getByRole("button", { name: "周" }));
    expect(document.querySelector(".calendar-week-grid")).toBeTruthy();
    // 周视图标题包含周一日期。
    expect(screen.getByText(/2026-08-17/)).toBeTruthy();
    // 队列事件在本周视图中展示。
    expect(document.querySelector(".calendar-week-grid")?.textContent).toContain("队列A");
  });

  it("批量操作:勾选队列与批次事件后统一改期到目标日期", async () => {
    const queueSpy = vi.spyOn(useStore.getState(), "reschedulePublishQueue").mockResolvedValue({ ok: true });
    const batchSpy = vi.spyOn(useStore.getState(), "reschedulePublishBatchItem").mockResolvedValue({ ok: true });
    render(<ContentCalendar open onOpenChange={() => undefined} />);
    // 月视图批量区展示「本月可改期事件」
    expect(screen.getByText(/本月可改期事件/)).toBeTruthy();
    // 勾选队列A 与 批次条目
    const items = screen.getAllByRole("button", { pressed: false }).filter((b) => b.className.includes("calendar-batch-item"));
    const queueItem = items.find((b) => b.textContent?.includes("队列A"));
    const batchItem = items.find((b) => b.textContent?.includes("批次条目"));
    expect(queueItem).toBeTruthy();
    expect(batchItem).toBeTruthy();
    fireEvent.click(queueItem as HTMLElement);
    fireEvent.click(batchItem as HTMLElement);
    // 目标日期输入(默认今天)改为 2026-08-25
    const dateInput = screen.getByLabelText("批量改期目标日期") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-08-25" } });
    fireEvent.click(screen.getByRole("button", { name: /批量改期到该日/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(queueSpy).toHaveBeenCalledWith("q1", "2026-08-25T18:00:00.000Z");
    expect(batchSpy).toHaveBeenCalledWith("b1", "b1-1", "2026-08-25T09:00:00.000Z");
    queueSpy.mockRestore();
    batchSpy.mockRestore();
  });
});
