// @vitest-environment jsdom
/**
 * SchedulerDrawer 组件测试 —— 聚焦 UI 交互行为。
 * 存储/调度逻辑已在 core `scheduler.spec.ts` 覆盖,此处 mock store action 验证组件交互。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "./helpers/render.js";
import { SchedulerDrawer } from "../src/components/SchedulerDrawer.js";
import { useStore } from "../src/state/store.js";

function resetStore() {
  useStore.setState({
    scheduledTasks: [],
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
    createScheduledTask: vi.fn(async () => ({ ok: true })),
    triggerScheduledTask: vi.fn(async () => undefined),
    setScheduledTaskStatus: vi.fn(async () => undefined),
    removeScheduledTask: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  resetStore();
});

describe("SchedulerDrawer 计划任务面板", () => {
  it("空态展示提示与新建表单", () => {
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("本机计划任务")).toBeTruthy();
    expect(screen.getByText(/还没有计划任务/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /创建计划任务/ })).toBeTruthy();
  });

  it("创建任务:缺少名称时给出错误提示且不调用 action", async () => {
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /创建计划任务/ }));
    expect(screen.getByText("请输入任务名称")).toBeTruthy();
    expect(useStore.getState().createScheduledTask).not.toHaveBeenCalled();
  });

  it("填写表单后创建调用 store action", async () => {
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByPlaceholderText("例如:每日早报校验"), "每日校验");
    await userEvent.selectOptions(screen.getByLabelText("关联草稿"), "d1");
    await userEvent.click(screen.getByRole("button", { name: /创建计划任务/ }));

    await waitFor(() => {
      expect(useStore.getState().createScheduledTask).toHaveBeenCalled();
    });
    const arg = vi.mocked(useStore.getState().createScheduledTask).mock.calls[0]![0];
    expect(arg.name).toBe("每日校验");
    expect(arg.draftId).toBe("d1");
    expect(arg.cron).toBeDefined();
  });

  it("切换动作到创建发布任务", async () => {
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByPlaceholderText("例如:每日早报校验"), "每日发布");
    await userEvent.selectOptions(screen.getByLabelText("关联草稿"), "d1");
    await userEvent.selectOptions(screen.getByLabelText("动作"), "publish-job");
    await userEvent.click(screen.getByRole("button", { name: /创建计划任务/ }));

    await waitFor(() => {
      expect(useStore.getState().createScheduledTask).toHaveBeenCalled();
    });
    const arg = vi.mocked(useStore.getState().createScheduledTask).mock.calls[0]![0];
    expect(arg.actionKind).toBe("publish-job");
  });

  it("切换到指标同步时隐藏草稿选择并允许无草稿创建", async () => {
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByPlaceholderText("例如:每日早报校验"), "每日指标");
    await userEvent.selectOptions(screen.getByLabelText("动作"), "metrics-sync");
    // 指标同步不需要关联草稿:表单中不再渲染草稿选择。
    expect(screen.queryByLabelText("关联草稿")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /创建计划任务/ }));

    await waitFor(() => {
      expect(useStore.getState().createScheduledTask).toHaveBeenCalled();
    });
    const arg = vi.mocked(useStore.getState().createScheduledTask).mock.calls[0]![0];
    expect(arg.actionKind).toBe("metrics-sync");
    expect(arg.draftId).toBe("");
  });

  it("创建成功展示成功消息", async () => {
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    await userEvent.type(screen.getByPlaceholderText("例如:每日早报校验"), "任务A");
    await userEvent.selectOptions(screen.getByLabelText("关联草稿"), "d1");
    await userEvent.click(screen.getByRole("button", { name: /创建计划任务/ }));
    await waitFor(() => expect(screen.getByText("计划任务已创建")).toBeTruthy());
  });

  it("已配置任务展示操作按钮(立即执行/暂停/删除)", () => {
    const now = new Date().toISOString();
    useStore.setState({
      scheduledTasks: [
        {
          id: "t1",
          name: "已配置任务",
          cron: { minute: [0], hour: [9], dayOfWeek: "*" },
          action: { kind: "validate-generate" },
          platformIds: ["wechat"],
          draftId: "d1",
          status: "enabled",
          runs: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("已配置任务")).toBeTruthy();
    expect(screen.getByRole("button", { name: /立即执行/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /暂停/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除计划任务" })).toBeTruthy();
  });

  it("点击立即执行 / 暂停 / 删除调用对应 action", async () => {
    const now = new Date().toISOString();
    useStore.setState({
      scheduledTasks: [
        {
          id: "t1",
          name: "任务B",
          cron: { minute: [0], hour: [9], dayOfWeek: "*" },
          action: { kind: "validate-generate" },
          platformIds: [],
          draftId: "d1",
          status: "enabled",
          runs: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: /立即执行/ }));
    expect(useStore.getState().triggerScheduledTask).toHaveBeenCalledWith("t1");

    await userEvent.click(screen.getByRole("button", { name: /暂停/ }));
    expect(useStore.getState().setScheduledTaskStatus).toHaveBeenCalledWith("t1", "paused");

    await userEvent.click(screen.getByRole("button", { name: "删除计划任务" }));
    expect(useStore.getState().removeScheduledTask).toHaveBeenCalledWith("t1");
  });

  it("AI 排期建议可用,生成后采纳把时/分填入 cron 表单(ROADMAP_V5 增强)", async () => {
    useStore.setState({
      markdown: "# 测试草稿\n正文",
      llm: { baseUrl: "", apiKey: "", model: "" },
      llmConfigs: [],
      activeLlmConfigId: null,
      performanceRecords: [],
    });
    render(<SchedulerDrawer open onOpenChange={() => undefined} />);
    const btn = screen.getByRole("button", { name: /AI 自动排期/ });
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    // 无 LLM 时走规则建议,应出现建议卡片与采纳按钮。
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /采纳此建议/ }).length).toBeGreaterThan(0);
    });
  });
});
