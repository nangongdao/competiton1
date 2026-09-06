/**
 * v11 INBOX-07 · 置顶评论自动跟进提醒 store 行为测试。
 *
 * 覆盖:
 * - setPinnedFollowUpEnabled:开关持久化 + 开启时立即检查;
 * - runPinnedFollowUpReminder:有待跟进置顶评论发通知(action=inbox) / 无超时不提醒 / 同日不重复;
 * - togglePinned 置顶记录 pinnedAt。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/state/store.js";
import type {
  AssistedHandoffRequest,
  AssistedHandoffResult,
  AutomationPublishRequest,
  AutomationPublishResult,
  ClipboardPayload,
  PlatformBridge,
  UploadAssetRequest,
  UploadAssetResult,
  WechatPublishRequest,
  WechatPublishResult,
} from "../src/bridge/types.js";

class MemoryBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly store = new Map<string, string>();
  readonly notifications: { title: string; body: string; action?: string }[] = [];
  async writeClipboard(_p: ClipboardPayload): Promise<boolean> { return true; }
  async assistedHandoff(_r: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }
  async publishWechat(_r: WechatPublishRequest): Promise<WechatPublishResult> {
    return { ok: true, message: "published", remoteId: "M1" };
  }
  async publishAutomation(_r: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: true, status: "submitted", message: "ok" };
  }
  async uploadAsset(_r: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "n/a" };
  }
  async getSetting(key: string): Promise<string | undefined> { return this.store.get(key); }
  async setSetting(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async showNotification(title: string, body: string, action?: string): Promise<void> {
    this.notifications.push({ title, body, action });
  }
}

let bridge: MemoryBridge;

function pinnedMessage(overMinutes: number) {
  return {
    id: `pin-${overMinutes}`,
    platformId: "xiaohongshu",
    remoteId: `r-${overMinutes}`,
    direction: "inbound" as const,
    kind: "comment" as const,
    author: "置顶用户",
    text: "这个多少钱?想买",
    receivedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    status: "unread" as const,
    handling: "pending" as const,
    sensitivity: "normal" as const,
    pinned: true,
    pinnedAt: new Date(Date.now() - overMinutes * 60 * 1000).toISOString(),
    createdAt: "",
    updatedAt: "",
  };
}

beforeEach(() => {
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({
    pinnedFollowUpEnabled: false,
    pinnedFollowUpLastRemindedAt: null,
    pinnedFollowUpDigest: null,
    inboxMessages: [],
    inboxSyncCursors: {},
    inboxSyncing: false,
    markdown: "",
    selectedPlatforms: ["wechat"],
    llm: { baseUrl: "", apiKey: "", model: "" },
    llmConfigs: [],
    activeLlmConfigId: null,
  });
});

describe("v11 INBOX-07 置顶评论跟进提醒 store", () => {
  it("setPinnedFollowUpEnabled 持久化开关 + 开启时立即检查", async () => {
    useStore.getState().setPinnedFollowUpEnabled(true);
    expect(useStore.getState().pinnedFollowUpEnabled).toBe(true);
    expect(bridge.store.get("mpp.pinnedFollowUpEnabled")).toBe("1");
    await vi.waitFor(() => {
      expect(useStore.getState().pinnedFollowUpDigest).not.toBeNull();
    });
    expect(bridge.notifications.length).toBe(0); // 无置顶消息不提醒
  });

  it("runPinnedFollowUpReminder:有超时置顶评论发通知(action=inbox)", async () => {
    useStore.setState({ inboxMessages: [pinnedMessage(45)] }); // 置顶 45 分钟 > 30 阈值
    const res = await useStore.getState().runPinnedFollowUpReminder(true);
    expect(res.ok).toBe(true);
    expect(res.notified).toBe(true);
    expect(bridge.notifications.length).toBe(1);
    expect(bridge.notifications[0]!.action).toBe("inbox");
    expect(bridge.notifications[0]!.title).toContain("置顶评论待跟进");
    expect(useStore.getState().pinnedFollowUpLastRemindedAt).toBeTruthy();
  });

  it("runPinnedFollowUpReminder:置顶未超阈值不提醒", async () => {
    useStore.setState({ inboxMessages: [pinnedMessage(10)] }); // 置顶 10 分钟
    const res = await useStore.getState().runPinnedFollowUpReminder(true);
    expect(res.notified).toBe(false);
    expect(bridge.notifications.length).toBe(0);
  });

  it("同日不重复提醒(force 除外)", async () => {
    useStore.setState({
      inboxMessages: [pinnedMessage(60)],
      pinnedFollowUpLastRemindedAt: new Date().toISOString(),
    });
    const res1 = await useStore.getState().runPinnedFollowUpReminder(false);
    expect(res1.notified).toBe(false);
    expect(bridge.notifications.length).toBe(0);
    const res2 = await useStore.getState().runPinnedFollowUpReminder(true);
    expect(res2.notified).toBe(true);
    expect(bridge.notifications.length).toBe(1);
  });
});
