import { describe, expect, it } from "vitest";
import {
  assertJobSchema,
  isResumable,
  isTerminalJob,
  JOB_RETENTION_MAX,
  JOB_SCHEMA_VERSION,
  MemoryJobStore,
  withUpdatedAt,
} from "../src/jobs/store.js";
import type { PublishJob } from "../src/jobs/types.js";

function makeJob(overrides: Partial<PublishJob> = {}): PublishJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    contentDigest: "abc123",
    stage: "queued",
    platformJobs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("JOB-02 任务存储", () => {
  it("MemoryJobStore 支持增删查列", async () => {
    const store = new MemoryJobStore();
    const job = makeJob();
    await store.put(job);
    expect(await store.get("job-1")).toEqual(job);
    expect(await store.list()).toHaveLength(1);
    await store.remove("job-1");
    expect(await store.get("job-1")).toBeUndefined();
  });

  it("withUpdatedAt 更新 updatedAt", () => {
    const job = makeJob();
    const next = withUpdatedAt(job, () => "2026-08-05T10:00:00Z");
    expect(next.updatedAt).toBe("2026-08-05T10:00:00Z");
    expect(next.createdAt).toBe(job.createdAt);
  });

  it("isTerminalJob / isResumable", () => {
    expect(isTerminalJob(makeJob({ stage: "succeeded" }))).toBe(true);
    expect(isTerminalJob(makeJob({ stage: "failed" }))).toBe(true);
    expect(isTerminalJob(makeJob({ stage: "unknown" }))).toBe(true);
    expect(isTerminalJob(makeJob({ stage: "cancelled" }))).toBe(true);
    expect(isTerminalJob(makeJob({ stage: "uploading" }))).toBe(false);

    expect(isResumable(makeJob({ stage: "submitting" }))).toBe(true);
    expect(isResumable(makeJob({ stage: "succeeded" }))).toBe(false);
  });

  it("prune 清理过期与超量终态任务,保留活跃任务", async () => {
    const store = new MemoryJobStore();
    const now = Date.now();
    const old = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 天前
    const recent = new Date(now - 60_000).toISOString();

    await store.put(makeJob({ id: "expired", stage: "succeeded", updatedAt: old }));
    await store.put(makeJob({ id: "recent-done", stage: "failed", updatedAt: recent }));
    await store.put(makeJob({ id: "active", stage: "uploading", updatedAt: old }));

    const removed = await store.prune(now);
    expect(removed).toBe(1);
    expect(await store.get("expired")).toBeUndefined();
    expect(await store.get("recent-done")).toBeDefined();
    expect(await store.get("active")).toBeDefined();
  });

  it("prune 超过保留上限时清理最旧的终态", async () => {
    const store = new MemoryJobStore();
    const now = Date.now();
    for (let i = 0; i < JOB_RETENTION_MAX + 10; i++) {
      await store.put(
        makeJob({
          id: `job-${i}`,
          stage: "succeeded",
          updatedAt: new Date(now - i * 1000).toISOString(), // 最近 110 秒内,未过期
        }),
      );
    }
    const removed = await store.prune(now);
    const remaining = await store.list();
    expect(removed).toBe(10);
    expect(remaining).toHaveLength(JOB_RETENTION_MAX);
  });

  it("schema 版本与校验", () => {
    expect(JOB_SCHEMA_VERSION).toBe(1);
    expect(assertJobSchema(makeJob())).toBe(true);
    expect(assertJobSchema({ id: "x" })).toBe(false);
    expect(assertJobSchema(null)).toBe(false);
  });
});
