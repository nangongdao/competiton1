/**
 * ServerJobsPanel 组件测试 —— 服务器持久化任务面板。
 *
 * 验证:
 * - 打开时拉取 GET /jobs 列表;
 * - 空态提示「暂无服务器任务」;
 * - 非终态任务展示「恢复」「取消」;
 * - failed 平台展示「重试」;
 * - 终态任务不展示恢复/取消(已成功无需操作);
 * - 拉取失败展示错误并允许重试刷新。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "./helpers/render.js";
import { ServerJobsPanel } from "../src/components/ServerJobsPanel.js";
import type { ServerJobSummary } from "../src/bridge/types.js";

function summary(overrides: Partial<ServerJobSummary> = {}): ServerJobSummary {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    stage: "queued",
    contentDigest: "digest-abc",
    platforms: [{ platformId: "wechat", stage: "queued", attemptCount: 1 }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeApi(overrides: Partial<Parameters<typeof ServerJobsPanel>[0]["api"]> = {}) {
  const list = vi.fn(async () => ({ ok: true, jobs: [] as ServerJobSummary[] }));
  const resume = vi.fn(async () => ({ ok: true, job: summary({ stage: "verifying" }) }));
  const cancel = vi.fn(async () => ({ ok: true, job: summary({ stage: "cancelled" }) }));
  const retry = vi.fn(async () => ({ ok: true, job: summary({ stage: "adapting" }) }));
  return { list, resume, cancel, retry, ...overrides };
}

function renderPanel(api: ReturnType<typeof makeApi>, props: Partial<Parameters<typeof ServerJobsPanel>[0]> = {}) {
  return render(
    <ServerJobsPanel
      open
      onOpenChange={() => undefined}
      serverUrl="http://127.0.0.1:8787"
      serverToken="tok"
      api={api}
      {...props}
    />,
  );
}

describe("ServerJobsPanel — 服务器任务面板", () => {
  it("打开时拉取任务列表;空态展示提示", async () => {
    const api = makeApi();
    renderPanel(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(await screen.findByText("暂无服务器任务")).toBeTruthy();
    expect(api.list.mock.calls[0]?.[0]).toMatchObject({ serverUrl: "http://127.0.0.1:8787", token: "tok" });
  });

  it("非终态任务展示「恢复」与「取消」,点击后调用对应 API 并刷新", async () => {
    const api = makeApi();
    api.list.mockResolvedValueOnce({ ok: true, jobs: [summary({ id: "j1", stage: "uploading" })] });
    renderPanel(api);

    await screen.findByText("上传中");
    const resumeBtn = await screen.findByRole("button", { name: "恢复任务" });
    expect(resumeBtn).toBeTruthy();
    // 非终态也有取消按钮(无文字 label,但 aria-label=取消任务)。
    expect(await screen.findByRole("button", { name: "取消任务" })).toBeTruthy();

    fireEvent.click(resumeBtn);
    await waitFor(() => expect(api.resume).toHaveBeenCalledWith({ serverUrl: "http://127.0.0.1:8787", token: "tok", jobId: "j1" }));
    // 操作后刷新列表。
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("failed 平台展示「重试」并调用 retry(带 platformId)", async () => {
    const api = makeApi();
    api.list.mockResolvedValueOnce({
      ok: true,
      jobs: [summary({ id: "j2", stage: "failed", platforms: [{ platformId: "wechat", stage: "failed", attemptCount: 2, error: "图床 503" }] })],
    });
    renderPanel(api);

    await screen.findByText("图床 503");
    const retryBtn = await screen.findByRole("button", { name: "重试" });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(api.retry).toHaveBeenCalledWith({ serverUrl: "http://127.0.0.1:8787", token: "tok", jobId: "j2", platformId: "wechat" }),
    );
  });

  it("终态任务不展示恢复/取消", async () => {
    const api = makeApi();
    api.list.mockResolvedValueOnce({
      ok: true,
      jobs: [summary({ id: "j3", stage: "succeeded", platforms: [{ platformId: "wechat", stage: "succeeded", attemptCount: 1 }] })],
    });
    renderPanel(api);

    const matches = await screen.findAllByText("已成功");
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "恢复任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消任务" })).toBeNull();
  });

  it("拉取失败展示错误信息", async () => {
    const api = makeApi({ list: vi.fn(async () => ({ ok: false, error: "无法连接本地 server" })) });
    renderPanel(api);
    expect(await screen.findByText("无法连接本地 server")).toBeTruthy();
  });
});
