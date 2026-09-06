/**
 * 版本历史 store 行为测试 —— 无 IndexedDB(jsdom)环境下优雅降级 + 回滚路径。
 *
 * 验证:
 * - saveVersionSnapshot / loadVersions / diffVersion / restoreVersion
 *   在存储不可用时不抛未捕获异常(返回可读错误或空态);
 * - setWordGoal / setTypewriterMode 持久化到 bridge setting 并更新状态。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
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

describe("版本历史 store 行为", () => {
  let bridge: StubBridge;

  beforeEach(() => {
    bridge = new StubBridge();
    useStore.getState().setBridge(bridge);
    // 重置版本相关状态。
    useStore.setState({
      currentDraftId: "d1",
      versions: [],
      selectedVersionId: null,
      markdown: "# 标题\n\n正文",
    });
  });

  it("loadVersions 在存储不可用时返回空列表而不抛错", async () => {
    // jsdom 无 indexedDB,getVersionStore 创建时抛错,loadVersions 捕获后置空。
    await expect(useStore.getState().loadVersions()).resolves.toBeUndefined();
    expect(useStore.getState().versions).toEqual([]);
  });

  it("saveVersionSnapshot 在存储不可用时静默降级(不抛错)", async () => {
    await expect(useStore.getState().saveVersionSnapshot("手动")).resolves.toBeUndefined();
  });

  it("diffVersion 在存储不可用时返回 null", async () => {
    const diff = await useStore.getState().diffVersion("a", "b");
    expect(diff).toBeNull();
  });

  it("restoreVersion 在存储不可用时返回 ok:false", async () => {
    const r = await useStore.getState().restoreVersion("missing");
    expect(r.ok).toBe(false);
  });

  it("setWordGoal 更新状态并持久化到 bridge", async () => {
    useStore.getState().setWordGoal(800);
    expect(useStore.getState().wordGoal).toBe(800);
    expect(bridge.settings.get("mpp.wordGoal")).toBe("800");
    // 负数被钳制为 0。
    useStore.getState().setWordGoal(-5);
    expect(useStore.getState().wordGoal).toBe(0);
  });

  it("setTypewriterMode 更新状态并持久化到 bridge", async () => {
    useStore.getState().setTypewriterMode(true);
    expect(useStore.getState().typewriterMode).toBe(true);
    expect(bridge.settings.get("mpp.typewriterMode")).toBe("1");
    useStore.getState().setTypewriterMode(false);
    expect(useStore.getState().typewriterMode).toBe(false);
    expect(bridge.settings.get("mpp.typewriterMode")).toBe("0");
  });
});
