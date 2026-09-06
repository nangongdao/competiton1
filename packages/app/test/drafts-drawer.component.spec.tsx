/**
 * TEST-03 —— 草稿/历史抽屉组件测试(DATA-01 导入导出 + 交互回归)。
 *
 * 验证:
 * - 空草稿提示;
 * - 草稿列表展示标题与时间,点击加载草稿、删除按钮触发删除;
 * - 发布历史展示平台状态标签;
 * - 导出数据按钮触发 onExport 并展示结果消息;
 * - 导入文件走 onImport 并展示成功/失败消息;
 * - 新建草稿按钮触发 onNew。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { DraftsDrawer } from "../src/components/DraftsDrawer.js";
import type { Draft, HistoryEntry } from "../src/storage/draft-store.js";

const DRAFT: Draft = {
  id: "d1",
  title: "我的第一篇草稿",
  markdown: "# 标题\n\n正文",
  authorName: "作者",
  tags: ["效率"],
  updatedAt: new Date().toISOString(),
};

const HISTORY: HistoryEntry = {
  id: "h1",
  draftTitle: "发布过的内容",
  at: new Date().toISOString(),
  platforms: [
    { platformId: "wechat", ok: true, message: "已发布" },
    { platformId: "zhihu", ok: false, message: "失败" },
  ],
};

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  drafts: [DRAFT],
  currentDraftId: "d1",
  history: [HISTORY],
  onNew: vi.fn(),
  onLoad: vi.fn(),
  onDelete: vi.fn(),
  onExport: vi.fn(async () => ({ ok: true })),
  onImport: vi.fn(async () => ({ ok: true, counts: { drafts: 1, history: 0 } })),
};

describe("DraftsDrawer — 草稿与历史抽屉", () => {
  it("展示草稿列表标题与时间", () => {
    render(<DraftsDrawer {...BASE_PROPS} />);
    expect(screen.getByText("我的第一篇草稿")).toBeTruthy();
    expect(screen.getByText("草稿（1）")).toBeTruthy();
  });

  it("空草稿展示空状态提示", () => {
    render(<DraftsDrawer {...BASE_PROPS} drafts={[]} history={[]} />);
    expect(screen.getByText("编辑内容会自动存为草稿，刷新不丢失。")).toBeTruthy();
    expect(screen.queryByText("我的第一篇草稿")).toBeNull();
  });

  it("点击草稿标题触发 onLoad", () => {
    const onLoad = vi.fn();
    render(<DraftsDrawer {...BASE_PROPS} onLoad={onLoad} />);
    // 草稿打开按钮 title=标题,用精确匹配避免误中删除按钮(aria-label 含标题)。
    const openBtn = screen.getByTitle("我的第一篇草稿");
    openBtn.click();
    expect(onLoad).toHaveBeenCalledWith("d1");
  });

  it("点击删除按钮触发 onDelete", () => {
    const onDelete = vi.fn();
    render(<DraftsDrawer {...BASE_PROPS} onDelete={onDelete} />);
    const delBtn = screen.getByRole("button", { name: /删除草稿 我的第一篇草稿/ });
    delBtn.click();
    expect(onDelete).toHaveBeenCalledWith("d1");
  });

  it("展示发布历史与平台状态", () => {
    render(<DraftsDrawer {...BASE_PROPS} />);
    expect(screen.getByText("发布过的内容")).toBeTruthy();
    expect(screen.getByText("发布历史（1）")).toBeTruthy();
    expect(screen.getByText("wechat")).toBeTruthy();
    expect(screen.getByText("zhihu")).toBeTruthy();
  });

  it("新建草稿按钮触发 onNew", () => {
    const onNew = vi.fn();
    render(<DraftsDrawer {...BASE_PROPS} onNew={onNew} />);
    const newBtn = screen.getByRole("button", { name: /新建草稿/ });
    newBtn.click();
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("导出数据:点击导出按钮触发 onExport 并展示成功消息", async () => {
    const onExport = vi.fn(async () => ({ ok: true }));
    render(<DraftsDrawer {...BASE_PROPS} onExport={onExport} />);
    const exportBtn = screen.getByRole("button", { name: /导出数据/ });
    exportBtn.click();
    await vi.waitFor(() => expect(onExport).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.getByText("已导出数据文件")).toBeTruthy());
  });

  it("导出失败展示错误消息", async () => {
    const onExport = vi.fn(async () => ({ ok: false, error: "磁盘写入失败" }));
    render(<DraftsDrawer {...BASE_PROPS} onExport={onExport} />);
    const exportBtn = screen.getByRole("button", { name: /导出数据/ });
    exportBtn.click();
    await vi.waitFor(() => expect(screen.getByText("磁盘写入失败")).toBeTruthy());
  });

  it("导入 JSON 文件触发 onImport 并展示成功消息", async () => {
    const onImport = vi.fn(async () => ({ ok: true, counts: { drafts: 2, history: 3 } }));
    render(<DraftsDrawer {...BASE_PROPS} onImport={onImport} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    // jsdom 无法真正读取文件,直接触发 change 并模拟 file.text()。
    const file = new File(["{}"], "data.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => '{"drafts":[]}' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.getByText("导入成功:新增 2 条草稿、3 条历史")).toBeTruthy());
  });
});
