/**
 * 发布执行增强 —— 纯函数测试(v8 Phase 2 EXEC-01/02)。
 */
import { describe, expect, it } from "vitest";
import type { PublishJob, PlatformJob } from "../src/jobs/types.js";
import { aggregateFailures, summarizePublishResults } from "../src/dashboard/exec.js";

function platformJob(partial: Partial<PlatformJob> & { platformId: string }): PlatformJob {
  return {
    stage: "succeeded",
    attemptCount: 1,
    attempts: [],
    uploadedAssets: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

function job(partial: Partial<PublishJob> & { id: string; platformJobs?: PlatformJob[] }): PublishJob {
  return {
    contentDigest: "abc",
    stage: "succeeded",
    platformJobs: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("aggregateFailures — 失败聚合", () => {
  it("无失败返回空", () => {
    const jobs = [
      job({ id: "j1", platformJobs: [platformJob({ platformId: "wechat", stage: "succeeded" })] }),
    ];
    const r = aggregateFailures(jobs);
    expect(r.hasData).toBe(false);
    expect(r.aggregates).toEqual([]);
    expect(r.retryableJobs).toEqual([]);
  });

  it("按平台+原因分类聚合", () => {
    const jobs = [
      job({
        id: "j1",
        platformJobs: [
          platformJob({ platformId: "wechat", stage: "failed", error: "标题超长" }),
          platformJob({ platformId: "wechat", stage: "failed", error: "标题超长" }),
          platformJob({ platformId: "zhihu", stage: "unknown" }),
        ],
      }),
    ];
    const r = aggregateFailures(jobs);
    expect(r.hasData).toBe(true);
    const wechat = r.aggregates.find((a) => a.platformId === "wechat" && a.kind === "failed")!;
    expect(wechat.count).toBe(2);
    expect(wechat.retryable).toBe(true);
    const zhihu = r.aggregates.find((a) => a.platformId === "zhihu" && a.kind === "unknown")!;
    expect(zhihu.count).toBe(1);
    expect(zhihu.retryable).toBe(false);
  });

  it("unknown 与 cancelled 不进入可重试清单", () => {
    const jobs = [
      job({
        id: "j1",
        platformJobs: [
          platformJob({ platformId: "wechat", stage: "unknown" }),
          platformJob({ platformId: "zhihu", stage: "cancelled" }),
        ],
      }),
    ];
    const r = aggregateFailures(jobs);
    expect(r.retryableJobs).toEqual([]);
  });

  it("failed 进入可重试清单并带 jobId", () => {
    const jobs = [
      job({
        id: "j1",
        platformJobs: [platformJob({ platformId: "wechat", stage: "failed" })],
      }),
    ];
    const r = aggregateFailures(jobs);
    expect(r.retryableJobs).toEqual([{ jobId: "j1", platformId: "wechat" }]);
  });

  it("needs-user-action 计入待人工处理", () => {
    const jobs = [
      job({
        id: "j1",
        platformJobs: [platformJob({ platformId: "wechat", stage: "needs-user-action" })],
      }),
    ];
    const r = aggregateFailures(jobs);
    const agg = r.aggregates[0];
    expect(agg.kind).toBe("needs-user-action");
    expect(agg.count).toBe(1);
    expect(r.retryableJobs).toHaveLength(1);
  });
});

describe("summarizePublishResults — 发布结果摘要", () => {
  it("空任务返回空摘要", () => {
    const s = summarizePublishResults([]);
    expect(s.hasData).toBe(false);
    expect(s.total).toBe(0);
    expect(s.successRate).toBeNull();
  });

  it("统计成功/失败/取消/未知/进行中", () => {
    const jobs = [
      job({ id: "j1", stage: "succeeded" }),
      job({ id: "j2", stage: "succeeded" }),
      job({ id: "j3", stage: "failed" }),
      job({ id: "j4", stage: "cancelled" }),
      job({ id: "j5", stage: "unknown" }),
      job({ id: "j6", stage: "uploading" }),
    ];
    const s = summarizePublishResults(jobs);
    expect(s.total).toBe(6);
    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.successRate).toBeCloseTo(2 / 4); // 成功/(成功+失败+取消)
  });

  it("成功率在无终态时为 null", () => {
    const jobs = [job({ id: "j1", stage: "uploading" })];
    const s = summarizePublishResults(jobs);
    expect(s.successRate).toBeNull();
  });
});
