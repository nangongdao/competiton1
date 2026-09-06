/**
 * ROADMAP_V5 Phase 1 · 发布队列 store 行为测试。
 *
 * 覆盖:
 * - loadPublishQueue:从存储加载发布队列;
 * - enqueuePublish:把草稿排入队列(默认锁定当前账号引用、真实发布);
 * - runDuePublishQueue:到点条目转为发布任务(走 createPublishJobFromDraft);
 * - triggerPublishQueue / reschedulePublishQueue / cancelPublishQueue / removePublishQueue;
 * - 发布队列与发布任务联动:排队到点后 jobs 列表出现对应任务。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
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
  async writeClipboard(_p: ClipboardPayload): Promise<boolean> { return true; }
  async assistedHandoff(_r: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }
  async publishWechat(_r: WechatPublishRequest): Promise<WechatPublishResult> {
    return { ok: true, message: "published", remoteId: "MEDIA_1" };
  }
  async publishAutomation(_r: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: true, status: "submitted", message: "ok" };
  }
  async uploadAsset(_r: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "n/a" };
  }
  async getSetting(key: string): Promise<string | undefined> { return this.store.get(key); }
  async setSetting(key: string, value: string): Promise<void> { this.store.set(key, value); }
}

let bridge: MemoryBridge;

beforeEach(() => {
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({
    markdown: "",
    publishQueue: [],
    publishQueueReady: false,
    jobs: [],
    activeJobId: null,
    jobAbort: null,
    drafts: [],
    currentDraftId: null,
    selectedPlatforms: ["wechat", "zhihu"],
    wechatPublishMode: "mock",
    automationModes: { wechat: "mock", zhihu: "mock" },
    accounts: [],
    activeAccountId: null,
    accountForPlatform: {},
    llm: { baseUrl: "", apiKey: "", model: "" },
    llmConfigs: [],
    activeLlmConfigId: null,
  });
});

describe("ROADMAP_V5 发布队列 store", () => {
  it("enqueuePublish 把草稿排入队列(锁定当前账号引用)", async () => {
    // 先保存一篇草稿。
    useStore.setState({
      markdown: "# 测试文章\n\n正文内容",
      currentDraftId: null,
      authorName: "作者",
      tags: [],
    });
    await useStore.getState().saveDraft();
    const draftId = useStore.getState().currentDraftId;
    expect(draftId).toBeTruthy();

    const res = await useStore.getState().enqueuePublish({
      name: "周五发布",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      platformIds: ["wechat", "zhihu"],
    });
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    const entries = useStore.getState().publishQueue;
    expect(entries.length).toBe(1);
    expect(entries[0]!.name).toBe("周五发布");
    expect(entries[0]!.draftId).toBe(draftId);
    expect(entries[0]!.status).toBe("queued");
    expect(entries[0]!.realPublish).toBe(true);
  });

  it("enqueuePublish 校验必填(无草稿/无平台/时间无效)", async () => {
    const noDraft = await useStore.getState().enqueuePublish({
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      platformIds: ["wechat"],
    });
    expect(noDraft.ok).toBe(false);

    useStore.setState({ markdown: "# 测试", currentDraftId: "d1", drafts: [{ id: "d1", title: "测试", markdown: "# 测试", authorName: "", tags: [], updatedAt: new Date().toISOString() }] });
    const badTime = await useStore.getState().enqueuePublish({
      scheduledAt: "invalid-date",
      platformIds: ["wechat"],
    });
    expect(badTime.ok).toBe(false);
  });

  it("triggerPublishQueue 立即执行到点条目 → 生成发布任务", async () => {
    useStore.setState({
      markdown: "# 测试文章\n\n正文内容",
      currentDraftId: null,
      authorName: "作者",
      tags: [],
    });
    await useStore.getState().saveDraft();

    const res = await useStore.getState().enqueuePublish({
      name: "立即执行",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      platformIds: ["wechat"],
    });
    const id = res.id!;
    const trig = await useStore.getState().triggerPublishQueue(id);
    expect(trig.ok).toBe(true);
    const entries = useStore.getState().publishQueue;
    expect(entries.find((e) => e.id === id)?.status).toBe("succeeded");
    // 发布任务已生成。
    expect(useStore.getState().jobs.length).toBeGreaterThan(0);
  });

  it("reschedulePublishQueue / cancelPublishQueue / removePublishQueue 生命周期", async () => {
    useStore.setState({ markdown: "# 测试", currentDraftId: "d1", drafts: [{ id: "d1", title: "测试", markdown: "# 测试", authorName: "", tags: [], updatedAt: new Date().toISOString() }] });
    const res = await useStore.getState().enqueuePublish({
      name: "改期测试",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      platformIds: ["wechat"],
    });
    const id = res.id!;

    const later = new Date(Date.now() + 7200_000).toISOString();
    const rs = await useStore.getState().reschedulePublishQueue(id, later);
    expect(rs.ok).toBe(true);
    expect(useStore.getState().publishQueue.find((e) => e.id === id)?.scheduledAt).toBe(later);

    const cancel = await useStore.getState().cancelPublishQueue(id);
    expect(cancel.ok).toBe(true);
    expect(useStore.getState().publishQueue.find((e) => e.id === id)?.status).toBe("cancelled");

    await useStore.getState().removePublishQueue(id);
    expect(useStore.getState().publishQueue.find((e) => e.id === id)).toBeUndefined();
  });

  it("runDuePublishQueue 到点条目自动转为发布任务", async () => {
    useStore.setState({
      markdown: "# 定时发布\n\n正文",
      currentDraftId: null,
      authorName: "作者",
      tags: [],
    });
    await useStore.getState().saveDraft();

    // 排入一个已到点的时间(过去 1 分钟)。
    const res = await useStore.getState().enqueuePublish({
      name: "已到点",
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      platformIds: ["wechat"],
    });
    expect(res.ok).toBe(true);
    // 心跳执行到点条目。
    await useStore.getState().runDuePublishQueue();
    const entries = useStore.getState().publishQueue;
    expect(entries.find((e) => e.id === res.id)?.status).toBe("succeeded");
    expect(useStore.getState().jobs.length).toBeGreaterThan(0);
  });

  it("enqueuePublishBatch 批量 AI 结果一键排队(ROADMAP_V5 Phase 4)", async () => {
    // 准备两篇已保存草稿。
    useStore.setState({
      markdown: "# 第一篇\n\n正文",
      currentDraftId: null,
      authorName: "作者",
      tags: [],
    });
    await useStore.getState().saveDraft();
    const d1 = useStore.getState().currentDraftId!;

    useStore.setState({
      markdown: "# 第二篇\n\n正文2",
      currentDraftId: null,
    });
    await useStore.getState().saveDraft();
    const d2 = useStore.getState().currentDraftId!;

    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await useStore.getState().enqueuePublishBatch({
      items: [
        { draftId: d1, name: "AI 文章一", platformIds: ["wechat"], scheduledAt: at },
        { draftId: d2, name: "AI 文章二", platformIds: ["wechat", "zhihu"], scheduledAt: at },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.enqueued).toBe(2);
    const entries = useStore.getState().publishQueue;
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.status === "queued")).toBe(true);
    expect(entries.some((e) => e.name === "AI 文章一")).toBe(true);
    // 锁定账号引用(默认无账号时为 [{platformId}] 形式的空引用)。
    expect(entries.find((e) => e.draftId === d1)?.platformIds).toEqual(["wechat"]);
  });

  it("enqueuePublishBatch 无效时间/无内容校验", async () => {
    const bad = await useStore.getState().enqueuePublishBatch({
      items: [{ draftId: "d1", scheduledAt: "invalid" }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.enqueued).toBe(0);

    // 无草稿且当前编辑为空。
    useStore.setState({ markdown: "", currentDraftId: null });
    const empty = await useStore.getState().enqueuePublishBatch({
      items: [{ scheduledAt: new Date(Date.now() + 3600_000).toISOString() }],
    });
    expect(empty.ok).toBe(false);
  });
});

describe("v10 REFRESH-QUEUE-01 老化内容批量翻新入队", () => {
  it("refreshAndEnqueue 生成翻新草稿并排入发布队列", async () => {
    // 准备一篇旧草稿 + 效果记录(60 天前阅读低迷 → 翻新建议)。
    const oldDraft = {
      id: "old-draft",
      title: "旧文章",
      markdown: "# 旧文章\n\n旧正文内容",
      authorName: "作者",
      tags: [] as readonly string[],
      updatedAt: new Date().toISOString(),
    };
    useStore.setState({
      drafts: [oldDraft],
      performanceRecords: [
        {
          id: "r1",
          platformId: "wechat",
          title: "旧文章",
          publishedAt: "2026-06-01T10:00:00Z",
          collectedAt: "2026-06-01T10:00:00Z",
          metrics: { views: 10 },
          source: "manual",
        },
        {
          id: "r2",
          platformId: "wechat",
          title: "热文",
          publishedAt: "2026-08-05T10:00:00Z",
          collectedAt: "2026-08-05T10:00:00Z",
          metrics: { views: 500 },
          source: "manual",
        },
      ],
      selectedPlatforms: ["wechat"],
    });
    // 构造老化条目(与 detectAgingContent 输出同构)。
    const { detectAgingContent, refreshableAgingItems } = await import("@mpp/core");
    const aging = detectAgingContent(useStore.getState().performanceRecords, {
      now: () => "2026-08-07T00:00:00Z",
    });
    const refreshItems = refreshableAgingItems(aging.items);
    expect(refreshItems.length).toBeGreaterThan(0);

    const res = await useStore.getState().refreshAndEnqueue({
      agingItems: refreshItems,
      platformIds: ["wechat"],
    });
    expect(res.ok).toBe(true);
    expect(res.planned).toBeGreaterThan(0);
    expect(res.enqueued).toBeGreaterThan(0);
    // 新翻新草稿已保存。
    const allDrafts = useStore.getState().drafts;
    expect(allDrafts.length).toBeGreaterThan(1);
    const refreshed = allDrafts.find((d) => d.id !== "old-draft");
    expect(refreshed?.title).toContain("旧文章");
    // 队列中出现翻新草稿条目。
    const queue = useStore.getState().publishQueue;
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]!.draftId).toBe(refreshed?.id);
  });

  it("refreshAndEnqueue 无老化条目 → 如实失败", async () => {
    useStore.setState({ performanceRecords: [], selectedPlatforms: ["wechat"] });
    const res = await useStore.getState().refreshAndEnqueue({
      agingItems: [],
      platformIds: ["wechat"],
    });
    expect(res.ok).toBe(false);
    expect(res.enqueued).toBe(0);
  });
});
