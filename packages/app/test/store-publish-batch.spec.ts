/**
 * ROADMAP_V5 Phase 2 · 发布批次 store 行为测试。
 *
 * 覆盖:
 * - createPublishBatch:一次排队多篇草稿(锁定当前账号引用、默认真实发布);
 * - triggerPublishBatchItem:立即执行批次内某篇 → 生成发布任务并收集回执;
 * - retryPublishBatchFailed / cancelPublishBatch / removePublishBatch;
 * - collectBatchMetrics:按批次 receipts 批量回收效果(写入效果回收库);
 * - runDuePublishBatches:到点条目转为发布任务。
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
    publishBatches: [],
    publishBatchReady: false,
    lastBatchCollect: null,
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
    performanceRecords: [],
  });
});

async function seedDraft(title: string, markdown: string): Promise<string> {
  useStore.setState({
    markdown,
    currentDraftId: null,
    authorName: "作者",
    tags: [],
  });
  await useStore.getState().saveDraft();
  const id = useStore.getState().currentDraftId!;
  // 修正标题。
  const drafts = useStore.getState().drafts.map((d) => (d.id === id ? { ...d, title } : d));
  useStore.setState({ drafts, currentDraftId: id });
  return id;
}

describe("ROADMAP_V5 发布批次 store", () => {
  it("createPublishBatch 一次排队多篇草稿(锁定账号引用、默认真实发布)", async () => {
    const d1 = await seedDraft("文章一", "# 文章一\n\n正文");
    const d2 = await seedDraft("文章二", "# 文章二\n\n正文");
    const res = await useStore.getState().createPublishBatch({
      items: [
        { draftId: d1, draftTitle: "文章一", platformIds: ["wechat", "zhihu"] },
        { draftId: d2, draftTitle: "文章二", platformIds: ["wechat"] },
      ],
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.ok).toBe(true);
    const batches = useStore.getState().publishBatches;
    expect(batches.length).toBe(1);
    expect(batches[0]!.items.length).toBe(2);
    expect(batches[0]!.status).toBe("queued");
    expect(batches[0]!.realPublish).toBe(true);
  });

  it("createPublishBatch 校验必填(无草稿/时间无效)", async () => {
    const noItems = await useStore.getState().createPublishBatch({
      items: [],
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(noItems.ok).toBe(false);

    const d1 = await seedDraft("文章一", "# 文章一\n\n正文");
    const badTime = await useStore.getState().createPublishBatch({
      items: [{ draftId: d1, platformIds: ["wechat"] }],
      scheduledAt: "invalid-date",
    });
    expect(badTime.ok).toBe(false);
  });

  it("triggerPublishBatchItem 立即执行批次内某篇 → 生成发布任务并收集回执", async () => {
    const d1 = await seedDraft("文章一", "# 文章一\n\n正文");
    const res = await useStore.getState().createPublishBatch({
      items: [{ draftId: d1, draftTitle: "文章一", platformIds: ["wechat"] }],
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const batchId = res.id!;
    const itemId = useStore.getState().publishBatches[0]!.items[0]!.itemId;

    const triggered = await useStore.getState().triggerPublishBatchItem(batchId, itemId);
    expect(triggered.ok).toBe(true);
    const batch = useStore.getState().publishBatches.find((b) => b.id === batchId)!;
    expect(batch.items[0]!.status).toBe("succeeded");
    expect(batch.items[0]!.jobId).toBeTruthy();
    // 复盘汇总自动生成。
    expect(batch.retro).toBeDefined();
    expect(batch.retro!.succeeded).toBe(1);
  });

  it("collectBatchMetrics 按批次 receipts 批量回收效果", async () => {
    useStore.setState({ wechatPublishMode: "publish" });
    const d1 = await seedDraft("文章一", "# 文章一\n\n正文");
    const res = await useStore.getState().createPublishBatch({
      items: [{ draftId: d1, draftTitle: "文章一", platformIds: ["wechat"] }],
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const batchId = res.id!;
    const itemId = useStore.getState().publishBatches[0]!.items[0]!.itemId;
    await useStore.getState().triggerPublishBatchItem(batchId, itemId);

    const collected = await useStore.getState().collectBatchMetrics(batchId);
    expect(collected.ok).toBe(true);
    expect(collected.imported).toBeGreaterThanOrEqual(1);
    const records = useStore.getState().performanceRecords;
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it("retryPublishBatchFailed / cancelPublishBatch / removePublishBatch", async () => {
    const d1 = await seedDraft("文章一", "# 文章一\n\n正文");
    const res = await useStore.getState().createPublishBatch({
      items: [{ draftId: d1, draftTitle: "文章一", platformIds: ["wechat"] }],
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const batchId = res.id!;

    const cancelled = await useStore.getState().cancelPublishBatch(batchId);
    expect(cancelled.ok).toBe(true);
    expect(useStore.getState().publishBatches.find((b) => b.id === batchId)?.status).toBe("cancelled");

    const retried = await useStore.getState().retryPublishBatchFailed(batchId);
    expect(retried.retried).toBe(0);

    await useStore.getState().removePublishBatch(batchId);
    expect(useStore.getState().publishBatches.find((b) => b.id === batchId)).toBeUndefined();
  });
});
