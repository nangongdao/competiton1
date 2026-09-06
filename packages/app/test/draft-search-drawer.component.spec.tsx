/**
 * Phase D AI-INSIGHT-03 —— AI 草稿检索抽屉组件测试。
 *
 * 覆盖:
 * - 空态:未索引时提示补建索引;
 * - 补建索引按钮调用 setDraftIndexes 并展示索引列表;
 * - 输入查询词后本地检索命中并展示相关度。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { DraftSearchDrawer } from "../src/components/DraftSearchDrawer.js";
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

const DRAFTS = [
  {
    id: "d1",
    title: "效率工具",
    markdown: "# 效率工具\n\n用时间块方法提升效率,把一天切成九十分钟专注块。\n",
    authorName: "效率君",
    tags: ["效率"],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "d2",
    title: "旅游攻略",
    markdown: "# 旅游攻略\n\n周末去哪里玩,推荐三天两夜路线。\n",
    authorName: "小明",
    tags: ["生活"],
    updatedAt: new Date().toISOString(),
  },
];

describe("DraftSearchDrawer AI 草稿检索", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      drafts: DRAFTS,
      draftIndexes: [],
      llm: { baseUrl: "", apiKey: "", model: "" },
      setDraftIndexes: vi.fn((indexes) => {
        useStore.setState({ draftIndexes: [...indexes] });
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("空态提示补建索引", () => {
    render(<DraftSearchDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("AI 草稿检索")).toBeTruthy();
    expect(screen.getByText(/还没有索引/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /补建索引/ })).toBeTruthy();
  });

  it("点击补建索引后生成并展示索引列表", async () => {
    render(<DraftSearchDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /补建索引/ }));
    await waitFor(
      () => {
        expect(useStore.getState().draftIndexes.length).toBe(2);
      },
      { timeout: 5000 },
    );
    expect(screen.getByText("效率工具")).toBeTruthy();
    expect(screen.getByText("旅游攻略")).toBeTruthy();
  });

  it("输入查询词后本地检索命中相关草稿", async () => {
    render(<DraftSearchDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /补建索引/ }));
    await waitFor(
      () => {
        expect(useStore.getState().draftIndexes.length).toBe(2);
      },
      { timeout: 5000 },
    );
    const input = screen.getByLabelText("搜索草稿");
    fireEvent.change(input, { target: { value: "效率 时间" } });
    await waitFor(() => {
      expect(screen.getByText(/条/)).toBeTruthy();
    });
    // 只有效率那篇被命中。
    expect(screen.getAllByText("效率工具").length).toBeGreaterThan(0);
    expect(screen.queryByText("旅游攻略")).toBeNull();
  });
});
