/**
 * v10 FOLLOWUP-NOTIFY · 待跟进提醒 store 行为测试。
 *
 * 覆盖:
 * - setFollowUpReminderEnabled:开关持久化 + 开启时立即检查;
 * - runFollowUpReminder:有待跟进项发通知 / 无跟进项不提醒 / 同日不重复 / force 可重发;
 * - 通知 action 透传("performance")。
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

function record(id: string, platformId: string, title: string, metrics: Record<string, number> = {}) {
  return {
    id,
    platformId,
    title,
    remoteId: undefined,
    remoteUrl: undefined,
    publishedAt: "2026-08-01T10:00:00.000Z",
    collectedAt: "2026-08-01T10:00:00.000Z",
    metrics,
    source: "manual" as const,
  };
}

beforeEach(() => {
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({
    followUpReminderEnabled: false,
    followUpLastRemindedAt: null,
    followUpReminderDigest: null,
    performanceRecords: [],
    markdown: "",
    publishQueue: [],
    publishBatches: [],
    drafts: [],
    currentDraftId: null,
    selectedPlatforms: ["wechat"],
    llm: { baseUrl: "", apiKey: "", model: "" },
    llmConfigs: [],
    activeLlmConfigId: null,
  });
});

describe("v10 FOLLOWUP-NOTIFY 待跟进提醒 store", () => {
  it("setFollowUpReminderEnabled 持久化开关 + 开启时立即检查", async () => {
    // 无待跟进 → 开启后 digest 计算、不通知。
    useStore.getState().setFollowUpReminderEnabled(true);
    expect(useStore.getState().followUpReminderEnabled).toBe(true);
    expect(bridge.store.get("mpp.followUpReminderEnabled")).toBe("1");
    // 等异步 digest 完成。
    await vi.waitFor(() => {
      expect(useStore.getState().followUpReminderDigest).not.toBeNull();
    });
    expect(useStore.getState().followUpReminderDigest?.shouldNotify).toBe(false);
    expect(bridge.notifications.length).toBe(0);
  });

  it("runFollowUpReminder:有待跟进项时发通知(action=performance)", async () => {
    // 数据缺口条目(high) → 应提醒。
    useStore.setState({
      performanceRecords: [record("a", "wechat", "缺数据文章")],
    });
    const res = await useStore.getState().runFollowUpReminder(true);
    expect(res.ok).toBe(true);
    expect(res.notified).toBe(true);
    expect(useStore.getState().followUpLastRemindedAt).toBeTruthy();
    expect(bridge.notifications.length).toBe(1);
    expect(bridge.notifications[0]!.action).toBe("performance");
    expect(bridge.notifications[0]!.title).toContain("待跟进");
    expect(bridge.notifications[0]!.body).toContain("缺数据文章");
  });

  it("runFollowUpReminder:无待跟进项不提醒", async () => {
    // 有阅读有互动 → 不算待跟进。
    useStore.setState({
      performanceRecords: [record("a", "wechat", "正常文章", { views: 100, likes: 5, comments: 1 })],
    });
    const res = await useStore.getState().runFollowUpReminder(true);
    expect(res.ok).toBe(true);
    expect(res.notified).toBe(false);
    expect(bridge.notifications.length).toBe(0);
  });

  it("同日不重复提醒(force 除外)", async () => {
    useStore.setState({
      performanceRecords: [record("a", "wechat", "缺数据文章")],
      followUpLastRemindedAt: new Date().toISOString(),
    });
    // 非 force:同日不重复。
    const res1 = await useStore.getState().runFollowUpReminder(false);
    expect(res1.notified).toBe(false);
    expect(bridge.notifications.length).toBe(0);
    // force:可重发。
    const res2 = await useStore.getState().runFollowUpReminder(true);
    expect(res2.notified).toBe(true);
    expect(bridge.notifications.length).toBe(1);
  });

  it("开启开关后心跳检查(直接调 runFollowUpReminder 等价于心跳路径)", async () => {
    useStore.setState({
      performanceRecords: [record("a", "zhihu", "缺口内容")],
      followUpReminderEnabled: true,
    });
    // 心跳路径:followUpReminderEnabled 为 true 时调用。
    if (useStore.getState().followUpReminderEnabled) {
      await useStore.getState().runFollowUpReminder(false);
    }
    expect(bridge.notifications.length).toBe(1);
    expect(bridge.notifications[0]!.action).toBe("performance");
  });
});
