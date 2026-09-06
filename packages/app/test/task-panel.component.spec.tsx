/**
 * TEST-03 —— 发布任务面板组件测试(UI-01 + 交互回归)。
 *
 * 验证:
 * - 空状态提示「暂无发布任务」;
 * - 有任务时展示阶段标签、耗时、平台行;
 * - failed 平台展示「重试」按钮并触发 retryJobPlatform;
 * - unknown 平台展示「请人工核对」且无重试按钮(禁止自动重试);
 * - succeeded 平台展示「已成功」;
 * - 取消按钮触发 cancelJob。
 * 使用真实 zustand store 注入状态,避免额外依赖。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "./helpers/render.js";
import { useStore } from "../src/state/store.js";
import { TaskPanel } from "../src/components/TaskPanel.js";
import { makeJob } from "./helpers/render.js";

function setJobs(jobs: ReturnType<typeof makeJob>[], activeJobId: string | null = null) {
  useStore.setState({
    jobs: jobs as never,
    activeJobId,
    retryJobPlatform: vi.fn(async () => undefined),
    cancelJob: vi.fn(async () => undefined),
    loadJobs: vi.fn(async () => undefined),
  } as never);
}

beforeEach(() => {
  // 每个用例重置为默认 store(避免污染后续用例)。
  useStore.setState({
    jobs: [],
    activeJobId: null,
  } as never);
});

describe("TaskPanel — 发布任务面板组件", () => {
  it("空状态:展示暂无发布任务与提示", () => {
    render(<TaskPanel open onOpenChange={() => undefined} />);
    expect(screen.getByText("暂无发布任务")).toBeTruthy();
    expect(screen.getByText(/点击「真实发布」后/)).toBeTruthy();
  });

  it("closed 时不渲染面板", () => {
    setJobs([makeJob()]);
    render(<TaskPanel open={false} onOpenChange={() => undefined} />);
    expect(screen.queryByText(/发布任务/)).toBeNull();
  });

  it("有任务时展示阶段标签与平台行", () => {
    const job = makeJob({ stage: "succeeded", platformJobs: [makeJob().platformJobs[0]!] });
    setJobs([job]);
    render(<TaskPanel open onOpenChange={() => undefined} />);
    expect(screen.getByText(/发布任务/)).toBeTruthy();
    expect(screen.getByText("已成功")).toBeTruthy();
    expect(screen.getByText("wechat")).toBeTruthy();
  });

  it("failed 平台展示重试按钮并调用 retryJobPlatform", async () => {
    const retry = vi.fn(async () => undefined);
    useStore.setState({
      jobs: [
        makeJob({
          stage: "failed",
          platformJobs: [
            makeJob().platformJobs[0]!,
            { ...makeJob().platformJobs[0]!, platformId: "zhihu", stage: "failed" as const },
          ],
        }),
      ],
      activeJobId: null,
      retryJobPlatform: retry as never,
    } as never);
    render(<TaskPanel open onOpenChange={() => undefined} />);
    const retryBtns = screen.getAllByRole("button", { name: /重试/ });
    expect(retryBtns.length).toBeGreaterThan(0);
    retryBtns[0]!.click();
    await vi.waitFor(() => expect(retry).toHaveBeenCalled());
  });

  it("unknown 平台展示请人工核对且无重试按钮", () => {
    const job = makeJob({
      stage: "unknown",
      platformJobs: [{ ...makeJob().platformJobs[0]!, stage: "unknown" as const }],
    });
    setJobs([job]);
    render(<TaskPanel open onOpenChange={() => undefined} />);
    expect(screen.getByText(/状态未知,请人工核对/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
  });

  it("取消按钮调用 cancelJob", async () => {
    const cancel = vi.fn(async () => undefined);
    useStore.setState({
      jobs: [
        makeJob({
          stage: "queued",
          platformJobs: [{ ...makeJob().platformJobs[0]!, stage: "submitting" as const }],
        }),
      ],
      activeJobId: null,
      cancelJob: cancel as never,
    } as never);
    render(<TaskPanel open onOpenChange={() => undefined} />);
    const cancelBtn = screen.getByRole("button", { name: "取消任务" });
    cancelBtn.click();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("active 任务展示加载指示", () => {
    setJobs([makeJob({ stage: "queued" })], "job-1");
    render(<TaskPanel open onOpenChange={() => undefined} />);
    // active 任务会渲染 spinner(Loader2 有 class spinner)。
    const spinner = document.querySelector(".spinner");
    expect(spinner).toBeTruthy();
  });
});
