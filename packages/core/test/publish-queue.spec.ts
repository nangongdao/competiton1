/**
 * ROADMAP_V5 Phase 1 · 发布队列与定时发布 —— 核心服务测试。
 *
 * 覆盖:
 * - enqueue:创建条目(状态 queued、平台列表、账号引用);
 * - dueEntries:只返回到点且未触发过的条目;
 * - runDue:到点执行(成功 → succeeded + jobId;失败 → failed + error);
 * - 未注入执行器 → 如实记录 skipped/failed,不假装成功;
 * - trigger:立即执行(忽略 scheduledAt);
 * - reschedule / cancel / remove:改期 / 取消 / 删除;
 * - prune:过期终态清理 + 条数上限裁剪(优先保留排队/运行中)。
 */
import { describe, expect, it } from "vitest";
import {
  PublishQueueService,
  MemoryPublishQueueStore,
  assertPublishQueueEntry,
  PUBLISH_QUEUE_MAX,
  type PublishQueueEntry,
  type PublishQueueExecutor,
} from "../src/publish-queue/index.js";

const NOW = () => "2026-08-10T00:00:00.000Z";

function makeEntry(overrides: Partial<PublishQueueEntry> = {}): PublishQueueEntry {
  return {
    id: "q-1",
    name: "周五晚间发布",
    draftId: "draft-1",
    platformIds: ["wechat", "zhihu"],
    scheduledAt: "2026-08-10T01:00:00.000Z",
    accountRefs: [
      { platformId: "wechat", serverProfileId: "profile-a" },
      { platformId: "zhihu", profileDir: "zhihu-main" },
    ],
    realPublish: true,
    status: "queued",
    createdAt: NOW(),
    updatedAt: NOW(),
    ...overrides,
  };
}

function makeExecutor(result: { ok?: boolean; jobId?: string; message?: string; error?: string } = {}): PublishQueueExecutor {
  return {
    async run(entry) {
      return {
        ok: result.ok ?? true,
        jobId: result.jobId ?? `job-${entry.id}`,
        message: result.message ?? `已创建发布任务 job-${entry.id}`,
        error: result.error,
      };
    },
  };
}

describe("PublishQueueService · 发布队列", () => {
  it("enqueue 创建排队条目(默认真实发布、锁定账号引用)", async () => {
    const service = new PublishQueueService({ now: NOW, executor: makeExecutor() });
    const entry = await service.enqueue({
      name: "测试发布",
      draftId: "draft-1",
      platformIds: ["wechat", "zhihu"],
      scheduledAt: "2026-08-10T01:00:00.000Z",
      accountRefs: [{ platformId: "wechat", serverProfileId: "p" }],
      realPublish: true,
    });
    expect(entry.status).toBe("queued");
    expect(entry.realPublish).toBe(true);
    expect(entry.platformIds).toEqual(["wechat", "zhihu"]);
    expect(entry.accountRefs).toEqual([{ platformId: "wechat", serverProfileId: "p" }]);
  });

  it("dueEntries 只返回已到点且未触发过的条目", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", scheduledAt: "2026-08-09T00:00:00.000Z" }));
    await store.put(makeEntry({ id: "q-2", scheduledAt: "2026-08-11T00:00:00.000Z" })); // 未到点
    const service = new PublishQueueService({ store, now: NOW, executor: makeExecutor() });
    const due = await service.dueEntries(new Date("2026-08-10T00:00:00.000Z"));
    expect(due.map((e) => e.id)).toEqual(["q-1"]);
  });

  it("runDue 到点执行成功 → succeeded + jobId", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", scheduledAt: "2026-08-09T00:00:00.000Z" }));
    const service = new PublishQueueService({ store, now: NOW, executor: makeExecutor() });
    const results = await service.runDue(new Date("2026-08-10T00:00:00.000Z"));
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.jobId).toBe("job-q-1");
    const updated = await store.get("q-1");
    expect(updated?.status).toBe("succeeded");
    expect(updated?.jobId).toBe("job-q-1");
  });

  it("runDue 执行失败 → failed + error(不假装成功)", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", scheduledAt: "2026-08-09T00:00:00.000Z" }));
    const service = new PublishQueueService({
      store,
      now: NOW,
      executor: makeExecutor({ ok: false, error: "平台返回 401" }),
    });
    const results = await service.runDue(new Date("2026-08-10T00:00:00.000Z"));
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toBe("平台返回 401");
    const updated = await store.get("q-1");
    expect(updated?.status).toBe("failed");
  });

  it("未注入执行器 → 如实记录失败,不假装成功", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", scheduledAt: "2026-08-09T00:00:00.000Z" }));
    const service = new PublishQueueService({ store, now: NOW, executor: null });
    const results = await service.runDue(new Date("2026-08-10T00:00:00.000Z"));
    expect(results[0]?.skipped).toBe(true);
    expect((await store.get("q-1"))?.status).toBe("failed");
  });

  it("trigger 立即执行(忽略 scheduledAt),失败条目可重新排队", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", status: "failed", error: "上次失败" }));
    const service = new PublishQueueService({ store, now: NOW, executor: makeExecutor() });
    const result = await service.trigger("q-1");
    expect(result.ok).toBe(true);
    const updated = await store.get("q-1");
    expect(updated?.status).toBe("succeeded");
  });

  it("reschedule 改期并回到 queued", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1" }));
    const service = new PublishQueueService({ store, now: NOW, executor: makeExecutor() });
    const updated = await service.reschedule("q-1", "2026-08-12T00:00:00.000Z");
    expect(updated.scheduledAt).toBe("2026-08-12T00:00:00.000Z");
    expect(updated.status).toBe("queued");
  });

  it("cancel 取消待执行条目;remove 删除任意条目", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1" }));
    const service = new PublishQueueService({ store, now: NOW, executor: makeExecutor() });
    const cancelled = await service.cancel("q-1", "改期到下周");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.error).toBe("改期到下周");
    await service.remove("q-1");
    expect(await store.get("q-1")).toBeUndefined();
  });

  it("prune 清理过期终态并裁剪到条数上限(优先保留排队/运行中)", async () => {
    const store = new MemoryPublishQueueStore();
    const oldTerminal = makeEntry({
      id: "old-done",
      status: "succeeded",
      updatedAt: "2026-06-01T00:00:00.000Z", // 超过 30 天保留期
    });
    await store.put(oldTerminal);
    // 塞满条数上限的旧终态。
    for (let i = 0; i < PUBLISH_QUEUE_MAX; i++) {
      await store.put(
        makeEntry({
          id: `done-${i}`,
          status: "succeeded",
          updatedAt: "2026-08-09T00:00:00.000Z",
        }),
      );
    }
    const service = new PublishQueueService({ store, now: NOW, executor: makeExecutor() });
    const removed = await service.prune(new Date("2026-08-10T00:00:00.000Z"));
    expect(removed).toBeGreaterThanOrEqual(1); // 至少清掉过期条目
    const remaining = await store.list();
    expect(remaining.length).toBeLessThanOrEqual(PUBLISH_QUEUE_MAX);
    expect(remaining.some((e) => e.id === "old-done")).toBe(false);
  });

  it("assertPublishQueueEntry 校验 schema(损坏/旧版本检测)", () => {
    expect(assertPublishQueueEntry(makeEntry())).toBe(true);
    expect(assertPublishQueueEntry({ ...makeEntry(), platformIds: "wechat" })).toBe(false);
    expect(assertPublishQueueEntry({ id: "x" })).toBe(false);
  });

  it("账号级路由:到点执行把锁定账号引用传给执行器", async () => {
    let receivedRefs: unknown = null;
    const executor: PublishQueueExecutor = {
      async run(entry) {
        receivedRefs = entry.accountRefs;
        return { ok: true };
      },
    };
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", scheduledAt: "2026-08-09T00:00:00.000Z" }));
    const service = new PublishQueueService({ store, now: NOW, executor });
    await service.runDue(new Date("2026-08-10T00:00:00.000Z"));
    expect(receivedRefs).toEqual([
      { platformId: "wechat", serverProfileId: "profile-a" },
      { platformId: "zhihu", profileDir: "zhihu-main" },
    ]);
  });

  it("去重窗口:同一条目到点后窗口内不重复触发", async () => {
    const store = new MemoryPublishQueueStore();
    await store.put(makeEntry({ id: "q-1", scheduledAt: "2026-08-09T00:00:00.000Z" }));
    let runs = 0;
    const executor: PublishQueueExecutor = {
      async run() {
        runs++;
        return { ok: true };
      },
    };
    const service = new PublishQueueService({ store, now: NOW, executor, dedupeWindowMs: 120_000 });
    await service.runDue(new Date("2026-08-10T00:00:00.000Z"));
    // 条目已 succeeded,不应再触发。
    await service.runDue(new Date("2026-08-10T00:00:01.000Z"));
    expect(runs).toBe(1);
  });
});
