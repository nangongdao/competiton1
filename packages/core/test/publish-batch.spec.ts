/**
 * ROADMAP_V5 Phase 2 · 发布批次与批量复盘 —— 核心服务测试。
 *
 * 覆盖:
 * - create:一次排队多篇草稿(每篇独立平台/时间/账号引用),生成批次;
 * - dueItems / runDue:到点逐篇触发,单篇失败不阻断其余,全部终态自动生成复盘;
 * - 未注入执行器 → 如实记录失败,不假装成功;
 * - triggerItem / retryFailed:手动立即执行 / 一键重试失败条目;
 * - cancel / remove / prune:取消 / 删除 / 清理(优先保留排队/运行中);
 * - collectMetrics:按 receipts 的 remoteId 批量回收效果(去重,同一平台+remoteId 跳过);
 * - buildBatchRetro:成功率 / 平台表现 / 建议(纯函数)。
 */
import { describe, expect, it } from "vitest";
import {
  PublishBatchService,
  MemoryPublishBatchStore,
  buildBatchRetro,
  aggregateBatchStatus,
  assertPublishBatch,
  PUBLISH_BATCH_MAX,
  type PublishBatch,
  type PublishBatchItem,
  type PublishBatchItemExecutor,
} from "../src/publish-batch/index.js";
import type { PerformanceStore, PerformanceRecord } from "../src/analytics/types.js";

const NOW = () => "2026-08-10T00:00:00.000Z";

function makeBatch(overrides: Partial<PublishBatch> = {}): PublishBatch {
  return {
    id: "batch-1",
    name: "晨间三篇",
    items: [
      {
        itemId: "b1-d1",
        draftId: "d1",
        draftTitle: "草稿一",
        platformIds: ["wechat", "zhihu"],
        accountRefs: [{ platformId: "wechat", serverProfileId: "p" }],
        realPublish: true,
        scheduledAt: "2026-08-10T01:00:00.000Z",
        status: "queued",
        createdAt: NOW(),
        updatedAt: NOW(),
      },
    ],
    status: "queued",
    scheduledAt: "2026-08-10T00:00:00.000Z",
    accountRefs: [],
    realPublish: true,
    createdAt: NOW(),
    updatedAt: NOW(),
    ...overrides,
  };
}

function makeItem(overrides: Partial<PublishBatchItem> = {}): PublishBatchItem {
  return {
    itemId: "b1-d1",
    draftId: "d1",
    draftTitle: "草稿一",
    platformIds: ["wechat", "zhihu"],
    accountRefs: [],
    realPublish: true,
    scheduledAt: "2026-08-10T01:00:00.000Z",
    status: "queued",
    createdAt: NOW(),
    updatedAt: NOW(),
    ...overrides,
  };
}

function makeExecutor(result: { ok?: boolean; jobId?: string; error?: string } = {}): PublishBatchItemExecutor {
  return {
    async run(item) {
      return {
        ok: result.ok ?? true,
        jobId: result.jobId ?? `job-${item.itemId}`,
        message: `已创建发布任务 job-${item.itemId}`,
        error: result.error,
        receipts: item.platformIds.map((pid) => ({
          platformId: pid,
          status: "published",
          remoteId: `remote-${pid}-${item.draftId}`,
          remoteUrl: `https://${pid}.example/${item.draftId}`,
          at: NOW(),
        })),
      };
    },
  };
}

function makePerfStore(seed: readonly PerformanceRecord[] = []): PerformanceStore {
  const records = [...seed];
  return {
    schemaVersion: 1,
    async list() {
      return records;
    },
    async listByPlatform(platformId) {
      return records.filter((r) => r.platformId === platformId);
    },
    async get(id) {
      return records.find((r) => r.id === id);
    },
    async put(record) {
      const idx = records.findIndex((r) => r.id === record.id);
      if (idx >= 0) records[idx] = record;
      else records.push(record);
    },
    async remove(id) {
      const idx = records.findIndex((r) => r.id === id);
      if (idx >= 0) records.splice(idx, 1);
    },
  };
}

describe("PublishBatchService · 发布批次", () => {
  it("create 一次排队多篇草稿(默认继承批次时间/账号/真实发布)", async () => {
    const service = new PublishBatchService({ now: NOW, executor: makeExecutor() });
    const batch = await service.create({
      name: "晨间三篇",
      scheduledAt: "2026-08-10T01:00:00.000Z",
      accountRefs: [{ platformId: "wechat", serverProfileId: "p" }],
      realPublish: true,
      items: [
        { draftId: "d1", draftTitle: "草稿一", platformIds: ["wechat"] },
        { draftId: "d2", draftTitle: "草稿二", platformIds: ["zhihu"], scheduledAt: "2026-08-10T02:00:00.000Z" },
      ],
    });
    expect(batch.items.length).toBe(2);
    expect(batch.status).toBe("queued");
    expect(batch.items[0]?.scheduledAt).toBeUndefined(); // 继承批次时间
    expect(batch.items[1]?.scheduledAt).toBe("2026-08-10T02:00:00.000Z");
    expect(batch.items[0]?.accountRefs).toEqual([{ platformId: "wechat", serverProfileId: "p" }]);
    expect(batch.items[0]?.realPublish).toBe(true);
  });

  it("create 无草稿抛错;超过条数上限抛错", async () => {
    const service = new PublishBatchService({ now: NOW });
    await expect(service.create({ items: [] })).rejects.toThrow("至少需要一篇草稿");
    await expect(
      service.create({
        items: Array.from({ length: PUBLISH_BATCH_MAX + 1 }, (_, i) => ({ draftId: `d${i}` })),
      }),
    ).rejects.toThrow("单批最多");
  });

  it("runDue 到点逐篇触发,单篇失败不阻断其余", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(
      makeBatch({
        items: [
          makeItem({ itemId: "i1", draftId: "d1", draftTitle: "一", status: "queued" }),
          makeItem({ itemId: "i2", draftId: "d2", draftTitle: "二", status: "queued" }),
          makeItem({ itemId: "i3", draftId: "d3", draftTitle: "三", status: "queued" }),
        ],
      }),
    );
    let runs = 0;
    const executor: PublishBatchItemExecutor = {
      async run(item) {
        runs++;
        if (item.itemId === "i2") return { ok: false, error: "平台返回 401" };
        return { ok: true, jobId: `job-${item.itemId}` };
      },
    };
    const service = new PublishBatchService({ store, now: NOW, executor });
    const results = await service.runDue(new Date("2026-08-10T01:30:00.000Z"));
    expect(runs).toBe(3);
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(results.filter((r) => !r.ok).length).toBe(1);
    const batch = await store.get("batch-1");
    expect(batch?.items.find((i) => i.itemId === "i1")?.status).toBe("succeeded");
    expect(batch?.items.find((i) => i.itemId === "i2")?.status).toBe("failed");
    expect(batch?.items.find((i) => i.itemId === "i3")?.status).toBe("succeeded");
    // 全部终态 → 自动生成复盘汇总。
    expect(batch?.retro).toBeDefined();
    expect(batch?.retro?.successRate).toBeCloseTo(2 / 3);
    expect(batch?.status).toBe("failed");
  });

  it("未注入执行器 → 如实记录失败,不假装成功", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(makeBatch());
    const service = new PublishBatchService({ store, now: NOW, executor: null });
    const results = await service.runDue(new Date("2026-08-10T01:30:00.000Z"));
    expect(results[0]?.skipped).toBe(true);
    const batch = await store.get("batch-1");
    expect(batch?.items[0]?.status).toBe("failed");
  });

  it("triggerItem 手动立即执行;retryFailed 一键重试失败条目", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(
      makeBatch({
        items: [
          makeItem({ itemId: "i1", status: "failed", error: "上次失败" }),
          makeItem({ itemId: "i2", status: "succeeded" }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    const result = await service.triggerItem("batch-1", "i1");
    expect(result.ok).toBe(true);
    let batch = await store.get("batch-1");
    expect(batch?.items.find((i) => i.itemId === "i1")?.status).toBe("succeeded");

    // retryFailed:已无失败条目。
    const retried = await service.retryFailed("batch-1");
    expect(retried.length).toBe(0);

    // 再制造一个失败条目后一键重试。
    await store.put(
      makeBatch({
        id: "batch-2",
        items: [makeItem({ itemId: "j1", status: "failed", error: "x" })],
      }),
    );
    const service2 = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    const r2 = await service2.retryFailed("batch-2");
    expect(r2.length).toBe(1);
    expect(r2[0]?.ok).toBe(true);
    batch = await store.get("batch-2");
    expect(batch?.items[0]?.status).toBe("succeeded");
  });

  it("cancel 取消批次(仅 queued/running);remove 删除任意批次", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(makeBatch());
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    const cancelled = await service.cancel("batch-1", "临时取消");
    expect(cancelled.status).toBe("cancelled");
    await service.remove("batch-1");
    expect(await store.get("batch-1")).toBeUndefined();
  });

  it("rescheduleItem 改期批次内某条目(日历拖拽改期)", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(
      makeBatch({
        items: [
          makeItem({ itemId: "i1", draftId: "d1", draftTitle: "一", status: "queued" }),
          makeItem({ itemId: "i2", draftId: "d2", draftTitle: "二", status: "queued" }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    const batch = await service.rescheduleItem("batch-1", "i1", "2026-08-20T18:00:00.000Z");
    const item = batch.items.find((i) => i.itemId === "i1");
    expect(item?.scheduledAt).toBe("2026-08-20T18:00:00.000Z");
    expect(item?.status).toBe("queued");
    // 其余条目不受影响。
    expect(batch.items.find((i) => i.itemId === "i2")?.scheduledAt).toBe("2026-08-10T01:00:00.000Z");
  });

  it("rescheduleItem 拒绝已终态/运行中条目与非法时间", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(
      makeBatch({
        items: [
          makeItem({ itemId: "i1", status: "succeeded" }),
          makeItem({ itemId: "i2", status: "running" }),
          makeItem({ itemId: "i3", status: "queued" }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    await expect(service.rescheduleItem("batch-1", "i1", "2026-08-20T18:00:00.000Z")).rejects.toThrow("不可改期");
    await expect(service.rescheduleItem("batch-1", "i2", "2026-08-20T18:00:00.000Z")).rejects.toThrow("正在执行");
    await expect(service.rescheduleItem("batch-1", "i3", "bad-date")).rejects.toThrow("格式无效");
  });

  it("rescheduleAll 批次整体改期:queued/running 条目统一迁移,终态保留", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(
      makeBatch({
        items: [
          makeItem({ itemId: "i1", draftId: "d1", draftTitle: "一", status: "queued" }),
          makeItem({ itemId: "i2", draftId: "d2", draftTitle: "二", status: "queued", scheduledAt: undefined }),
          makeItem({ itemId: "i3", draftId: "d3", draftTitle: "三", status: "succeeded" }),
          makeItem({ itemId: "i4", draftId: "d4", draftTitle: "四", status: "failed" }),
          makeItem({ itemId: "i5", draftId: "d5", draftTitle: "五", status: "running" }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    const { batch, rescheduled, skipped } = await service.rescheduleAll("batch-1", "2026-08-25T09:30:00.000Z");
    expect(rescheduled).toBe(4); // queued×2 + failed + running
    expect(skipped).toBe(1); // succeeded 保留
    const byId = new Map(batch.items.map((i) => [i.itemId, i]));
    expect(byId.get("i1")?.scheduledAt).toBe("2026-08-25T09:30:00.000Z");
    expect(byId.get("i2")?.scheduledAt).toBe("2026-08-25T09:30:00.000Z");
    expect(byId.get("i4")?.scheduledAt).toBe("2026-08-25T09:30:00.000Z");
    expect(byId.get("i5")?.scheduledAt).toBe("2026-08-25T09:30:00.000Z");
    // 终态条目保持原时间/状态不动。
    expect(byId.get("i3")?.scheduledAt).toBe("2026-08-10T01:00:00.000Z");
    expect(byId.get("i3")?.status).toBe("succeeded");
    // 批次 scheduledAt 也整体迁移。
    expect(batch.scheduledAt).toBe("2026-08-25T09:30:00.000Z");
  });

  it("rescheduleAll 非法时间拒绝", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(makeBatch());
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    await expect(service.rescheduleAll("batch-1", "bad-date")).rejects.toThrow("格式无效");
  });

  it("collectMetrics 按 receipts 的 remoteId 批量回收效果(去重)", async () => {
    const store = new MemoryPublishBatchStore();
    const perfStore = makePerfStore([
      {
        id: "existing",
        platformId: "wechat",
        title: "已存在",
        remoteId: "remote-wechat-d1", // 已存在 → 去重跳过
        publishedAt: NOW(),
        collectedAt: NOW(),
        metrics: { views: 10 },
        source: "manual",
      },
    ]);
    await store.put(
      makeBatch({
        items: [
          makeItem({
            itemId: "i1",
            draftId: "d1",
            draftTitle: "草稿一",
            status: "succeeded",
            receipts: [
              { platformId: "wechat", status: "published", remoteId: "remote-wechat-d1", at: NOW() },
              { platformId: "zhihu", status: "published", remoteId: "remote-zhihu-d1", at: NOW() },
            ],
          }),
          makeItem({ itemId: "i2", draftId: "d2", draftTitle: "草稿二", status: "failed" }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW });
    const result = await service.collectMetrics("batch-1", perfStore);
    expect(result.imported).toBe(1); // zhihu 新录入;wechat 去重
    expect(result.skipped).toBe(1);
    const all = await perfStore.list();
    expect(all.some((r) => r.platformId === "zhihu" && r.remoteId === "remote-zhihu-d1")).toBe(true);
    expect(all.some((r) => r.platformId === "wechat" && r.remoteId === "remote-wechat-d1")).toBe(true);
  });

  it("prune 清理过期终态并裁剪到条数上限(优先保留排队/运行中)", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(
      makeBatch({ id: "old-done", status: "succeeded", updatedAt: "2026-06-01T00:00:00.000Z" }),
    );
    for (let i = 0; i < PUBLISH_BATCH_MAX; i++) {
      await store.put(
        makeBatch({ id: `done-${i}`, status: "succeeded", updatedAt: "2026-08-09T00:00:00.000Z" }),
      );
    }
    const service = new PublishBatchService({ store, now: NOW });
    const removed = await service.prune(new Date("2026-08-10T00:00:00.000Z"));
    expect(removed).toBeGreaterThanOrEqual(1);
    const remaining = await store.list();
    expect(remaining.length).toBeLessThanOrEqual(PUBLISH_BATCH_MAX);
    expect(remaining.some((b) => b.id === "old-done")).toBe(false);
  });

  it("assertPublishBatch 校验 schema", () => {
    expect(assertPublishBatch(makeBatch())).toBe(true);
    expect(assertPublishBatch({ id: "x" })).toBe(false);
    expect(assertPublishBatch({ ...makeBatch(), items: "wechat" })).toBe(false);
  });
  it("collectMetrics 无 remoteId → 如实报告无可回收(不假装成功)", async () => {
    const store = new MemoryPublishBatchStore();
    const perfStore = makePerfStore();
    await store.put(
      makeBatch({
        items: [
          makeItem({ itemId: "i1", status: "succeeded", receipts: [] }),
          makeItem({ itemId: "i2", status: "failed" }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW });
    const result = await service.collectMetrics("batch-1", perfStore);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("collectMetrics 同一平台+remoteId 已存在 → 去重跳过", async () => {
    const store = new MemoryPublishBatchStore();
    const perfStore = makePerfStore([
      {
        id: "existing",
        platformId: "wechat",
        title: "已存在",
        remoteId: "r-wechat",
        publishedAt: NOW(),
        collectedAt: NOW(),
        metrics: {},
        source: "manual",
      },
    ]);
    await store.put(
      makeBatch({
        items: [
          makeItem({
            itemId: "i1",
            status: "succeeded",
            receipts: [{ platformId: "wechat", status: "published", remoteId: "r-wechat", at: NOW() }],
          }),
        ],
      }),
    );
    const service = new PublishBatchService({ store, now: NOW });
    const result = await service.collectMetrics("batch-1", perfStore);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("cancel 已完成批次抛错;dueItems 跳过已取消批次", async () => {
    const store = new MemoryPublishBatchStore();
    await store.put(makeBatch({ status: "succeeded", updatedAt: NOW() }));
    const service = new PublishBatchService({ store, now: NOW, executor: makeExecutor() });
    await expect(service.cancel("batch-1")).rejects.toThrow("已完成批次不可取消");

    await store.put(makeBatch({ id: "batch-2", status: "cancelled", updatedAt: NOW() }));
    const due = await service.dueItems(new Date("2026-08-10T01:30:00.000Z"));
    // 批次1 已终态但条目仍是 queued(测试数据),批次2 已取消 → 仅批次1 到点。
    expect(due.length).toBe(1);
    expect(due[0]!.batch.id).toBe("batch-1");
  });

  it("buildBatchRetro 空批次与全部跳过", () => {
    const empty = buildBatchRetro([]);
    expect(empty.total).toBe(0);
    expect(empty.successRate).toBe(0);
    expect(empty.suggestions.length).toBeGreaterThanOrEqual(1);

    const allSkipped = buildBatchRetro([
      makeItem({ status: "skipped" }),
      makeItem({ itemId: "i2", status: "skipped" }),
    ]);
    expect(allSkipped.skipped).toBe(2);
    expect(allSkipped.suggestions.some((s) => s.includes("跳过"))).toBe(true);
  });

  it("buildBatchRetro 平台全部失败给出排查建议;成功但无 remoteId 提示依赖手工", () => {
    const retro = buildBatchRetro([
      makeItem({ itemId: "i1", draftTitle: "一", platformIds: ["zhihu"], status: "failed", error: "x" }),
      makeItem({ itemId: "i2", draftTitle: "二", platformIds: ["zhihu", "wechat"], status: "failed", error: "y" }),
      makeItem({ itemId: "i3", draftTitle: "三", platformIds: ["zhihu"], status: "succeeded", receipts: [] }),
    ]);
    // wechat 全部失败(1/1)→ 排查建议;zhihu 有成功。
    expect(retro.byPlatform.find((p) => p.platformId === "zhihu")?.ok).toBe(1);
    expect(retro.byPlatform.find((p) => p.platformId === "wechat")?.ok).toBe(0);
    expect(retro.suggestions.some((s) => s.includes("wechat 全部失败"))).toBe(true);
    expect(retro.suggestions.some((s) => s.includes("远端 ID"))).toBe(true);
  });
});

describe("buildBatchRetro · 批次复盘", () => {
  it("全部成功 → 成功率 1,建议保持当前组合", () => {
    const retro = buildBatchRetro([
      makeItem({ status: "succeeded" }),
      makeItem({ itemId: "i2", draftId: "d2", draftTitle: "二", status: "succeeded" }),
    ]);
    expect(retro.successRate).toBe(1);
    expect(retro.succeeded).toBe(2);
    expect(retro.suggestions.some((s) => s.includes("全部"))).toBe(true);
  });

  it("存在失败 → 成功率 <1,建议排查对应平台", () => {
    const retro = buildBatchRetro([
      makeItem({ itemId: "i1", draftTitle: "一", platformIds: ["wechat"], status: "succeeded" }),
      makeItem({ itemId: "i2", draftTitle: "二", platformIds: ["wechat"], status: "failed", error: "401" }),
    ]);
    expect(retro.successRate).toBeCloseTo(0.5);
    expect(retro.byPlatform.find((p) => p.platformId === "wechat")?.ok).toBe(1);
    expect(retro.byPlatform.find((p) => p.platformId === "wechat")?.total).toBe(2);
    expect(retro.suggestions.some((s) => s.includes("401"))).toBe(true);
  });

  it("统计可回收 remoteId 数(供效果回收链路)", () => {
    const retro = buildBatchRetro([
      makeItem({
        status: "succeeded",
        receipts: [
          { platformId: "wechat", status: "published", remoteId: "r1", at: NOW() },
          { platformId: "zhihu", status: "published", remoteId: "r2", at: NOW() },
        ],
      }),
      makeItem({ itemId: "i2", status: "succeeded", receipts: [] }),
    ]);
    expect(retro.collectibleRemoteIds).toBe(2);
  });
});

describe("aggregateBatchStatus · 批次状态聚合", () => {
  it("全部成功 → succeeded;含失败但部分未完成 → queued;全部终态 → failed/running", () => {
    expect(aggregateBatchStatus([makeItem({ status: "succeeded" }), makeItem({ itemId: "i2", status: "succeeded" })])).toBe("succeeded");
    expect(aggregateBatchStatus([makeItem({ status: "succeeded" }), makeItem({ itemId: "i2", status: "failed" })])).toBe("failed");
    expect(aggregateBatchStatus([makeItem({ status: "succeeded" }), makeItem({ itemId: "i2", status: "queued" })])).toBe("queued");
    expect(aggregateBatchStatus([makeItem({ status: "running" }), makeItem({ itemId: "i2", status: "queued" })])).toBe("running");
    expect(aggregateBatchStatus([])).toBe("queued");
  });
});
