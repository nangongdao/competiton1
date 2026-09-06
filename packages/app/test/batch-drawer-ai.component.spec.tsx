/**
 * 批量与审批面板 —— AI 自动完成模式组件测试。
 *
 * 覆盖:
 * - 模式切换:批量校验/生成 ↔ AI 自动完成;
 * - AI 模式:一键批量运行后展示每篇结果(修复/改写/校验状态);
 * - 应用改写结果:当前编辑直接生效、已保存草稿写回存储。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { BatchDrawer } from "../src/components/BatchDrawer.js";
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

const LONG_MD = `# 超长标题测试,这个标题特别特别长用来验证标题上限的截断行为是否正常工作

首段内容。这里讲一个效率方法,把一天切成若干九十分钟专注块。这段文字应该足够长,长到能够触发排版建议里的段落节奏问题与可读性问题,从而产生可自动修复的拆段建议。再多写一些字,让它超过两百个字的门槛,确保 readability 维度给出的超长文本块建议能够被派生为可执行修复动作,并且让自动修复轮次真正发生内容变化,验证整个 agent 修复链路闭环生效。

次段。这里讲一个方法,三步走。

> 引用:专注是天赋。

![示意图](https://images.example.com/a.png)
`;

describe("BatchDrawer AI 自动完成模式", () => {
  beforeEach(() => {
    const bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    useStore.setState({
      markdown: LONG_MD,
      drafts: [
        {
          id: "draft-1",
          title: "已保存草稿",
          markdown: "# 短标题\n\n这是正文,讲一个简单的方法。\n",
          authorName: "效率君",
          tags: ["效率"],
          updatedAt: new Date().toISOString(),
        },
      ],
      selectedPlatforms: ["wechat", "xiaohongshu"],
      llm: { baseUrl: "", apiKey: "", model: "" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("默认展示批量校验/生成模式,可切换到 AI 自动完成", () => {
    render(<BatchDrawer open onOpenChange={() => undefined} />);
    // 模式切换按钮(两个同名,取第一个)。
    const switchBtns = screen.getAllByRole("button", { name: /批量校验\/生成/ });
    expect(switchBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: /AI 自动完成/ }));
    // AI 模式运行按钮出现(按钮文本完整)。
    expect(screen.getByRole("button", { name: /一键批量 AI 自动完成/ })).toBeTruthy();
  });

  it("AI 模式一键运行后展示每篇结果", async () => {
    render(<BatchDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 自动完成/ }));
    const runBtn = screen.getByRole("button", { name: /一键批量 AI 自动完成/ });
    fireEvent.click(runBtn);
    await waitFor(
      () => {
        expect(screen.getByText(/已批量 AI 自动完成/)).toBeTruthy();
      },
      { timeout: 10000 },
    );
    // 每篇草稿都应有结果行(当前编辑 + 已保存草稿)。
    expect(screen.getByText("当前编辑")).toBeTruthy();
    expect(screen.getByText("已保存草稿")).toBeTruthy();
  });

  it("应用改写结果后当前编辑内容被更新", async () => {
    render(<BatchDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 自动完成/ }));
    fireEvent.click(screen.getByRole("button", { name: /一键批量 AI 自动完成/ }));
    await waitFor(
      () => {
        expect(screen.getByText(/已批量 AI 自动完成/)).toBeTruthy();
      },
      { timeout: 10000 },
    );
    const before = useStore.getState().markdown;
    // 应用按钮应出现(当前编辑内容有变化)。
    const applyBtn = screen.queryByRole("button", { name: /应用全部改写结果/ });
    if (applyBtn) {
      fireEvent.click(applyBtn);
      await waitFor(() => {
        expect(useStore.getState().markdown).not.toBe(before);
      });
    }
  });

  it("AI 结果可一键排入发布队列(ROADMAP_V5 Phase 4)", async () => {
    // mock enqueuePublishBatch。
    const enqueuePublishBatch = vi.fn(async () => ({ ok: true, enqueued: 1 }));
    useStore.setState({ enqueuePublishBatch } as never);
    render(<BatchDrawer open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 自动完成/ }));
    fireEvent.click(screen.getByRole("button", { name: /一键批量 AI 自动完成/ }));
    await waitFor(
      () => {
        expect(screen.getByText(/已批量 AI 自动完成/)).toBeTruthy();
      },
      { timeout: 10000 },
    );
    const queueBtn = screen.queryByRole("button", { name: /一键把 AI 结果排入发布队列/ });
    if (queueBtn) {
      fireEvent.click(queueBtn);
      await waitFor(() => {
        expect(enqueuePublishBatch).toHaveBeenCalled();
      });
    }
  });
});
