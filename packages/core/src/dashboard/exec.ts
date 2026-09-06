/**
 * EXEC-01 / EXEC-02 —— 发布执行增强数据派生。
 *
 * - `aggregateFailures`:把发布任务(含各平台子任务)的失败/未知/待人工处理按平台与原因聚合,
 *   供「发布健康」区块展示,并提供可一键重试项清单;
 * - `summarizePublishResults`:把任务集合汇总为 成功/失败/跳过/进行中/未知 统计与成功率,
 *   供「发布概览」区块展示。
 *
 * 设计约束:
 * - 纯 TS 零 DOM;
 * - 只读派生,不修改任务状态;一键重试由 store `retryJobPlatform` 执行;
 * - 成功率计算安全(总数为 0 时为 null)。
 */
import type { PublishJob, PlatformJob } from "../jobs/types.js";
import { isTerminalStage, isSafeToRetry, coarseStageOf } from "../jobs/state-machine.js";

/** 单条失败聚合。 */
export interface FailureAggregate {
  readonly platformId: string;
  /** 聚合键(平台 + 原因分类)。 */
  readonly key: string;
  /** 原因分类:失败 / 未知 / 待人工处理 / 已取消。 */
  readonly kind: "failed" | "unknown" | "needs-user-action" | "cancelled";
  /** 聚合原因(取首条错误或分类描述)。 */
  readonly reason: string;
  /** 聚合任务数。 */
  readonly count: number;
  /** 是否可一键重试(unknown 禁止自动重试)。 */
  readonly retryable: boolean;
}

/** 失败聚合结果。 */
export interface FailureAggregateResult {
  readonly aggregates: readonly FailureAggregate[];
  readonly hasData: boolean;
  /** 可一键重试的任务条目(供 UI 直接调用 retry)。 */
  readonly retryableJobs: readonly { jobId: string; platformId: string }[];
}

/** 发布结果摘要。 */
export interface PublishSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly skipped: number;
  readonly inProgress: number;
  readonly unknown: number;
  /** 成功率(终态中 succeeded 占比;无终态时为 null)。 */
  readonly successRate: number | null;
  readonly hasData: boolean;
}

function kindOf(stage: PlatformJob["stage"]): FailureAggregate["kind"] {
  switch (stage) {
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    case "needs-user-action":
      return "needs-user-action";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

/** 收集单个任务的可聚合平台子任务。 */
function platformJobsOf(job: PublishJob): readonly PlatformJob[] {
  return job.platformJobs ?? [];
}

/** 聚合失败任务(按平台 + 原因分类)。 */
export function aggregateFailures(jobs: readonly PublishJob[]): FailureAggregateResult {
  interface Acc {
    platformId: string;
    key: string;
    kind: FailureAggregate["kind"];
    count: number;
    retryable: boolean;
    _reason: string;
  }
  const byKey = new Map<string, Acc>();
  const retryableJobs: { jobId: string; platformId: string }[] = [];

  for (const job of jobs) {
    for (const pj of platformJobsOf(job)) {
      const bad =
        pj.stage === "failed" ||
        pj.stage === "unknown" ||
        pj.stage === "needs-user-action" ||
        pj.stage === "cancelled";
      if (!bad) continue;
      const kind = kindOf(pj.stage);
      const key = `${pj.platformId}:${kind}`;
      const reason = pj.error || coarseStageOf(pj.stage);
      const cur = byKey.get(key) ?? {
        platformId: pj.platformId,
        key,
        kind,
        count: 0,
        retryable: false,
        _reason: reason,
      };
      cur.count += 1;
      cur._reason = cur._reason || reason;
      // unknown 禁止自动重试;其余 bad 态(除 cancelled)可重试。
      const retryable = pj.stage !== "unknown" && pj.stage !== "cancelled";
      cur.retryable = cur.retryable || retryable;
      byKey.set(key, cur);
      if (retryable) retryableJobs.push({ jobId: job.id, platformId: pj.platformId });
    }
  }

  const aggregates = [...byKey.values()]
    .map((a) => ({ platformId: a.platformId, key: a.key, kind: a.kind, reason: a._reason, count: a.count, retryable: a.retryable }))
    .sort((a, b) => b.count - a.count);

  return { aggregates, hasData: aggregates.length > 0, retryableJobs };
}

/** 汇总发布结果。 */
export function summarizePublishResults(jobs: readonly PublishJob[]): PublishSummary {
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  let inProgress = 0;
  let unknown = 0;

  for (const job of jobs) {
    const coarse = coarseStageOf(job.stage);
    switch (coarse) {
      case "succeeded":
        succeeded += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "cancelled":
        cancelled += 1;
        break;
      case "unknown":
        unknown += 1;
        break;
      default:
        inProgress += 1;
    }
  }

  const total = jobs.length;
  const settled = succeeded + failed + cancelled;
  const successRate = settled > 0 ? succeeded / settled : null;

  return {
    total,
    succeeded,
    failed,
    cancelled,
    skipped: 0,
    inProgress,
    unknown,
    successRate,
    hasData: total > 0,
  };
}

// 引用 isTerminalStage / isSafeToRetry 以保持契约联动(供调用方按需扩展)。
export { isTerminalStage, isSafeToRetry };
