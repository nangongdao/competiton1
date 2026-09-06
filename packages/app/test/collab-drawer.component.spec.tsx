/**
 * v4 Phase 3 · COLLAB-03 协作共享抽屉组件测试。
 *
 * 验证:
 * - 打开时拉取共享内容列表(带 kind 过滤);
 * - 空态提示「暂无共享草稿」;
 * - 列表展示条目(标题/来源/版本/时间);
 * - 「推送当前草稿」调用 push API 并携带当前 markdown;
 * - 「拉取」草稿 → 应用到编辑区并保存;
 * - 删除调用 remove API;
 * - 连接失败展示错误信息;
 * - 远程同步源声明展示。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "./helpers/render.js";
import { CollabDrawer } from "../src/components/CollabDrawer.js";
import { sharedItemFrom } from "@mpp/core";
import { useStore } from "../src/state/store.js";

function makeApi(overrides: Partial<Parameters<typeof CollabDrawer>[0]["api"]> = {}) {
  const list = vi.fn(async () => ({ ok: true, items: [] as Parameters<typeof CollabDrawer>[0]["api"]["list"] extends (...a: never[]) => infer R ? Awaited<R>["items"] : never[] }));
  const get = vi.fn(async () => ({ ok: true, item: undefined }));
  const push = vi.fn(async () => ({ ok: true, message: "已推送" }));
  const remove = vi.fn(async () => ({ ok: true, message: "已删除" }));
  return { list, get, push, remove, ...overrides };
}

function draftSummary() {
  return {
    meta: { kind: "draft" as const, id: "draft-1", sourceName: "别俚科夫", title: "共享协作草稿", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", version: 1 },
    payloadSummary: {},
  };
}

function draftItem() {
  return sharedItemFrom("draft", "draft-1", "别俚科夫", {
    kind: "draft",
    draft: { title: "共享协作草稿", markdown: "# 标题\n\n来自共享", authorName: "作者A", tags: ["协作"], updatedAt: "2026-08-08T00:00:00Z" },
  });
}

function renderPanel(api: ReturnType<typeof makeApi>, props: Partial<Parameters<typeof CollabDrawer>[0]> = {}) {
  return render(
    <CollabDrawer
      open
      onOpenChange={() => undefined}
      serverUrl="http://127.0.0.1:8787"
      serverToken="tok"
      api={api}
      {...props}
    />,
  );
}

describe("CollabDrawer — 协作共享抽屉", () => {
  it("打开时拉取共享列表;空态展示提示", async () => {
    const api = makeApi();
    renderPanel(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(await screen.findByText("暂无共享草稿")).toBeTruthy();
    expect(api.list.mock.calls[0]?.[0]).toMatchObject({ serverUrl: "http://127.0.0.1:8787", token: "tok", kind: "draft" });
  });

  it("展示远程同步源声明", async () => {
    const api = makeApi();
    api.list.mockResolvedValueOnce({ ok: true, sync: "http://sync.example.com", items: [] });
    renderPanel(api);
    expect(await screen.findByText(/已连接远程同步源/)).toBeTruthy();
  });

  it("列表展示条目,「拉取」草稿应用到编辑区并保存", async () => {
    useStore.setState({ markdown: "", authorName: "", tags: [] });
    const api = makeApi();
    api.list.mockResolvedValueOnce({ ok: true, items: [draftSummary()] });
    api.get.mockResolvedValueOnce({ ok: true, item: draftItem() });
    renderPanel(api);

    expect(await screen.findByText("共享协作草稿")).toBeTruthy();
    const pullBtn = await screen.findByRole("button", { name: "拉取" });
    fireEvent.click(pullBtn);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith({ serverUrl: "http://127.0.0.1:8787", token: "tok", kind: "draft", id: "draft-1" }));
    await waitFor(() => {
      expect(useStore.getState().markdown).toContain("来自共享");
    });
  });

  it("「推送当前草稿」调用 push API 并携带 markdown 内容", async () => {
    useStore.setState({ markdown: "# 我的草稿\n\n正文", authorName: "作者B", tags: ["标签"] });
    const api = makeApi();
    renderPanel(api);
    const pushBtn = await screen.findByRole("button", { name: "推送当前草稿" });
    fireEvent.click(pushBtn);
    await waitFor(() => expect(api.push).toHaveBeenCalled());
    const arg = api.push.mock.calls[0]?.[0] as { item?: { payload?: { draft?: { markdown?: string; authorName?: string; tags?: string[] } } } };
    expect(arg.item?.payload).toBeDefined();
    const payload = arg.item?.payload as { draft: { markdown: string; authorName: string; tags: string[] } };
    expect(payload.draft.markdown).toContain("我的草稿");
    expect(payload.draft.authorName).toBe("作者B");
    expect(payload.draft.tags).toEqual(["标签"]);
  });

  it("删除调用 remove API 并刷新", async () => {
    const api = makeApi();
    api.list.mockResolvedValueOnce({ ok: true, items: [draftSummary()] });
    renderPanel(api);
    await screen.findByText("共享协作草稿");
    const delBtn = await screen.findByRole("button", { name: "删除共享内容" });
    fireEvent.click(delBtn);
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ serverUrl: "http://127.0.0.1:8787", token: "tok", kind: "draft", id: "draft-1" }));
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("拉取失败展示错误信息", async () => {
    const api = makeApi();
    api.list.mockResolvedValueOnce({ ok: false, message: "无法连接本地 server" });
    renderPanel(api);
    expect(await screen.findByText("无法连接本地 server")).toBeTruthy();
  });
});
