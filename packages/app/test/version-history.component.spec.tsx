/**
 * 版本历史抽屉组件测试 —— 快照时间线 / 对比 / 回滚交互。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { VersionHistoryDrawer } from "../src/components/VersionHistoryDrawer.js";
import { useStore } from "../src/state/store.js";

const VERSIONS = [
  {
    id: "v2",
    draftId: "d1",
    label: "自动保存",
    createdAt: "2026-08-06T02:00:00.000Z",
    charCount: 120,
  },
  {
    id: "v1",
    draftId: "d1",
    label: "手动保存",
    createdAt: "2026-08-06T01:00:00.000Z",
    charCount: 80,
  },
];

function mockActions() {
  const actions = {
    loadVersions: vi.fn(async () => {
      useStore.setState({ versions: VERSIONS, currentDraftId: "d1" });
    }),
    saveVersionSnapshot: vi.fn(async () => undefined),
    diffVersion: vi.fn(async (_a: string, _b: string) => ({
      aId: _a,
      bId: _b,
      added: 40,
      removed: 0,
      identical: false,
      ops: [
        { type: "equal" as const, text: "# 标题\n\n" },
        { type: "insert" as const, text: "新增段落内容。" },
      ],
    })),
    restoreVersion: vi.fn(async () => ({ ok: true })),
  };
  // 直接替换 store 上的 action 方法(zustand 的 set 支持覆盖方法)。
  useStore.setState(actions as unknown as Partial<typeof useStore.getState>);
  return actions;
}

describe("VersionHistoryDrawer — 版本历史抽屉", () => {
  it("空态:无当前草稿时提示", () => {
    useStore.setState({ currentDraftId: null, versions: [] });
    render(<VersionHistoryDrawer open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/还没有已保存的草稿/)).toBeTruthy();
  });

  it("展示版本时间线", () => {
    useStore.setState({ currentDraftId: "d1", versions: VERSIONS });
    mockActions();
    render(<VersionHistoryDrawer open onOpenChange={vi.fn()} />);
    expect(screen.getByText("自动保存")).toBeTruthy();
    expect(screen.getByText("手动保存")).toBeTruthy();
    expect(screen.getByText("版本时间线（2）")).toBeTruthy();
    expect(screen.getByText("最新")).toBeTruthy();
  });

  it("点击对比按钮触发 diff 并展示差异视图", async () => {
    useStore.setState({ currentDraftId: "d1", versions: VERSIONS });
    const actions = mockActions();
    render(<VersionHistoryDrawer open onOpenChange={vi.fn()} />);
    // 直接点击「运行版本对比」(默认选第一/第二版本)。
    const runBtn = screen.getByRole("button", { name: "运行版本对比" });
    fireEvent.click(runBtn);
    await waitFor(() => expect(actions.diffVersion).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/\+40/)).toBeTruthy());
    expect(screen.getByText("新增段落内容。")).toBeTruthy();
  });

  it("点击回滚触发 restoreVersion", async () => {
    useStore.setState({ currentDraftId: "d1", versions: VERSIONS });
    const actions = mockActions();
    render(<VersionHistoryDrawer open onOpenChange={vi.fn()} />);
    const restoreBtns = screen.getAllByText("回滚");
    fireEvent.click(restoreBtns[0]!);
    await waitFor(() => expect(actions.restoreVersion).toHaveBeenCalled());
  });
});
