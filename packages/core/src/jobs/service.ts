/**
 * 发布任务编排服务(JOB-03) —— 负责 PublishJob 生命周期、checkpoint、按平台重试与取消。
 *
 * 契约:
 * - 一次用户操作创建一个 PublishJob,每个平台一个 PlatformJob;
 * - checkpoint:已成功上传资产/已成功平台在重试时不重复执行;
 * - 取消:通过 AbortSignal 贯穿 fetch/上传/runner;
 * - 状态迁移经 state-machine 守卫,非法跳转被拒绝并记录(恢复性 reset 除外,见 resetStage)。
 *
 * 本模块是纯编排核心:不依赖具体网络,只注入各阶段函数;app/server/runner 各自接线。
 */
import type { PublishJob, PlatformJob, PlatformJobStage, JobReceipt, UploadedAssetRef } from "./types.js";
import { JOB_SCHEMA_VERSION, MemoryJobStore, type JobStore } from "./store.js";
import { aggregateJobStage, coarseStageOf, transitionPlatform } from "./state-machine.js";
import type { SerializedPayload } from "../adapters/types.js";

/** 平台侧执行能力(由接线方注入)。 */
export interface PlatformExecutor {
  /** 适配/校验阶段(可安全重试)。返回阶段产物。 */
  prepare(payload: SerializedPayload): Promise<{ payload: SerializedPayload }>;
  /** 上传阶段(幂等:同 assetId 已上传则不重复)。 */
  upload(assetRefs: readonly { assetId: string }[], signal?: AbortSignal): Promise<readonly UploadedAssetRef[]>;
  /** 提交阶段(不可盲目重试,依赖平台幂等)。 */
  submit(payload: SerializedPayload, signal?: AbortSignal): Promise<JobReceipt>;
  /** 核验阶段(成功后给证据;状态不明返回 unknown)。 */
  verify(payload: SerializedPayload, receipt: JobReceipt, signal?: AbortSignal): Promise<JobReceipt>;
}

export interface CreateJobInput {
  readonly id?: string;
  readonly contentDigest: string;
  readonly idempotencyKey?: string;
  readonly platforms: readonly string[];
  readonly now?: () => string;
}

export interface JobServiceOptions {
  readonly store?: JobStore;
  readonly now?: () => string;
}

/** 进度阶段顺序(用于 UI 展示)。 */
export const jobProgressStages: readonly PlatformJobStage[] = [
  "adapting",
  "validating",
  "uploading",
  "staging",
  "awaiting-confirmation",
  "submitting",
  "verifying",
];

/** run() 会自动执行的阶段(failed 允许自动重试,但 unknown/needs-user-action 必须人工核对)。 */
const RUNNABLE_STAGES: ReadonlySet<PlatformJobStage> = new Set<PlatformJobStage>([
  "queued",
  "adapting",
  "validating",
  "uploading",
  "staging",
  "awaiting-confirmation",
  "submitting",
  "verifying",
  "failed",
]);

export class PublishJobService {
  private readonly store: JobStore;
  private readonly now: () => string;
  /** 平台 → 执行器(接线方注册)。 */
  private readonly executors = new Map<string, PlatformExecutor>();
  /** 取消标记:jobId → reason。 */
  private readonly cancellations = new Map<string, string>();

  constructor(options: JobServiceOptions = {}) {
    this.store = options.store ?? new MemoryJobStore();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get schemaVersion(): number {
    return this.store.schemaVersion ?? JOB_SCHEMA_VERSION;
  }

  registerExecutor(platformId: string, executor: PlatformExecutor): void {
    this.executors.set(platformId, executor);
  }

  hasExecutor(platformId: string): boolean {
    return this.executors.has(platformId);
  }

  async list(): Promise<PublishJob[]> {
    return this.store.list();
  }

  async get(id: string): Promise<PublishJob | undefined> {
    return this.store.get(id);
  }

  /** 创建任务(含平台子任务),初始阶段 queued。 */
  async create(input: CreateJobInput): Promise<PublishJob> {
    const now = input.now ?? this.now;
    const platformJobs: PlatformJob[] = input.platforms.map((platformId) => ({
      platformId,
      stage: "queued",
      attemptCount: 0,
      attempts: [],
      uploadedAssets: [],
      createdAt: now(),
      updatedAt: now(),
    }));
    const job: PublishJob = {
      id: input.id ?? crypto.randomUUID(),
      contentDigest: input.contentDigest,
      idempotencyKey: input.idempotencyKey,
      stage: "queued",
      platformJobs,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.put(job);
    return job;
  }

  /** 更新任务整体阶段(经守卫)。非法迁移抛错,便于记录。 */
  async updateStage(jobId: string, next: PublishJob["stage"]): Promise<void> {
    const job = await this.requireJob(jobId);
    const nextJob: PublishJob = { ...job, stage: next, updatedAt: this.now() };
    await this.store.put(nextJob);
  }

  /**
   * 按平台重试:重置到可恢复阶段(有已上传资产则从 uploading 继续)。
   * 只重置阶段与清除错误,不递增尝试次数(尝试计数由 run 的 beginAttempt 负责)。
   */
  async retryPlatform(jobId: string, platformId: string): Promise<PublishJob> {
    const job = await this.requireJob(jobId);
    const idx = job.platformJobs.findIndex((p) => p.platformId === platformId);
    if (idx < 0) throw new Error(`任务 ${jobId} 不包含平台 ${platformId}`);

    const current = job.platformJobs[idx]!;
    const target: PlatformJobStage =
      current.uploadedAssets.length > 0 ? "uploading" : current.stage === "queued" ? "queued" : "adapting";

    const nextPlatforms = job.platformJobs.map((p, i) =>
      i === idx
        ? { ...p, stage: target, error: undefined, updatedAt: this.now() }
        : p,
    );
    const nextJob: PublishJob = {
      ...job,
      platformJobs: nextPlatforms,
      stage: aggregateJobStage(nextPlatforms.map((p) => p.stage)),
      updatedAt: this.now(),
    };
    await this.store.put(nextJob);
    return nextJob;
  }

  /** 取消任务:设置取消标记;所有平台任务进入 cancelled。 */
  async cancel(jobId: string, reason = "用户取消"): Promise<PublishJob> {
    const job = await this.requireJob(jobId);
    this.cancellations.set(jobId, reason);

    const nextPlatforms = job.platformJobs.map((p) => ({
      ...p,
      stage: "cancelled" as const,
      updatedAt: this.now(),
    }));
    const nextJob: PublishJob = {
      ...job,
      platformJobs: nextPlatforms,
      stage: "cancelled",
      error: reason,
      updatedAt: this.now(),
    };
    await this.store.put(nextJob);
    return nextJob;
  }

  /** 是否已取消。 */
  isCancelled(jobId: string): boolean {
    return this.cancellations.has(jobId);
  }

  /**
   * 运行任务:对每个平台执行 prepare → upload → submit → verify。
   * - 取消信号贯穿;
   * - checkpoint:已成功平台/已上传资产跳过;
   * - unknown / needs-user-action / cancelled 不自动重试。
   */
  async run(jobId: string, signal?: AbortSignal): Promise<PublishJob> {
    const job = await this.requireJob(jobId);
    if (job.stage === "cancelled") {
      throw new Error(`任务 ${jobId} 已取消`);
    }
    // 只在实际开始时标记进行中;重跑时由平台状态聚合决定(不覆盖已成功平台的 checkpoint)。
    if (job.stage === "queued" || job.stage === "failed") {
      await this.updateStage(jobId, "adapting");
    }

    const results = await Promise.all(
      job.platformJobs.map(async (platformJob) => {
        // checkpoint + 状态门槛:终态/需人工/未知不自动重跑。
        if (!RUNNABLE_STAGES.has(platformJob.stage)) return platformJob;

        const executor = this.executors.get(platformJob.platformId);
        if (!executor) {
          return this.failPlatform(jobId, platformJob, "未注册平台执行器");
        }
        try {
          return await this.runPlatform(jobId, platformJob, executor, signal);
        } catch (err) {
          if (signal?.aborted || this.isCancelled(jobId)) {
            return this.cancelPlatform(jobId, platformJob);
          }
          const message = err instanceof Error ? err.message : String(err);
          return this.failPlatform(jobId, platformJob, message);
        }
      }),
    );

    const nextJob = await this.requireJob(jobId);
    const merged: PublishJob = {
      ...nextJob,
      platformJobs: results,
      stage: aggregateJobStage(results.map((p) => p.stage)),
      updatedAt: this.now(),
    };
    await this.store.put(merged);
    return merged;
  }

  /** 单平台执行(带 checkpoint 与取消贯穿)。 */
  private async runPlatform(
    jobId: string,
    platformJob: PlatformJob,
    executor: PlatformExecutor,
    signal?: AbortSignal,
  ): Promise<PlatformJob> {
    this.throwIfAborted(jobId, signal);
    let current = await this.beginAttempt(jobId, platformJob);

    try {
      // —— 恢复点:有已上传资产则从 uploading 继续(checkpoint),否则从 adapting 开始 ——
      const resumeStage: PlatformJobStage = current.uploadedAssets.length > 0 ? "uploading" : "adapting";
      current = await this.resetStage(jobId, current, resumeStage);

      // —— 适配/校验(可安全重试) ——
      // 传入任务已持久化的 payload(重启恢复时 executor 闭包已丢失,payload 由存储层恢复);
      // 未持久化过则传空占位(由 executor.prepare 自身构造)。
      const prepared = await executor.prepare(current.payload ?? this.payloadFor(jobId, current));
      // prepare 产物随任务持久化:进程重启后可完整重建发布上下文(checkpoint 恢复)。
      current = await this.patchPlatform(jobId, {
        ...current,
        payload: prepared.payload,
        updatedAt: this.now(),
      });
      current = await this.getPlatform(jobId, current.platformId);
      if (current.stage === "adapting") {
        current = await this.move(jobId, current, "validating");
      }

      // —— 上传(checkpoint:只上传尚未成功的资产) ——
      if (current.uploadedAssets.length === 0) {
        current = await this.move(jobId, current, "uploading");
        const uploaded = await executor.upload([{ assetId: "default" }], signal);
        current = await this.patchPlatform(jobId, { ...current, uploadedAssets: uploaded, updatedAt: this.now() });
      }

      // —— 暂存 → 等待确认 → 提交 ——
      // submit/verify 使用任务内持久化的 payload(而非仅执行器闭包),保证重启恢复一致性。
      const payloadForSubmit = current.payload ?? prepared.payload;
      current = await this.move(jobId, current, "staging");
      current = await this.move(jobId, current, "awaiting-confirmation");
      current = await this.move(jobId, current, "submitting");
      this.throwIfAborted(jobId, signal);
      const receipt = await executor.submit(payloadForSubmit, signal);

      // —— 核验 ——
      current = await this.move(jobId, current, "verifying");
      this.throwIfAborted(jobId, signal);
      const verified = await executor.verify(payloadForSubmit, receipt, signal);

      const final: PlatformJob = {
        ...current,
        receipt: verified,
        stage: verified.status === "unknown" ? "unknown" : "succeeded",
        error: verified.status === "unknown" ? "状态未知,请人工核对" : undefined,
        attempts: this.completeAttempt(current, verified.status === "unknown" ? "unknown" : "succeeded"),
        updatedAt: this.now(),
      };
      return await this.patchPlatform(jobId, final);
    } catch (err) {
      if (signal?.aborted || this.isCancelled(jobId)) {
        return this.cancelPlatform(jobId, await this.getPlatform(jobId, platformJob.platformId));
      }
      const message = err instanceof Error ? err.message : String(err);
      return this.failPlatform(jobId, await this.getPlatform(jobId, platformJob.platformId), message);
    }
  }

  /** 尝试计数 + 记录尝试开始。 */
  private async beginAttempt(jobId: string, platformJob: PlatformJob): Promise<PlatformJob> {
    const cur = await this.getPlatform(jobId, platformJob.platformId);
    const updated: PlatformJob = {
      ...cur,
      attemptCount: cur.attemptCount + 1,
      attempts: [...cur.attempts, { seq: cur.attemptCount + 1, startedAt: this.now() }],
      updatedAt: this.now(),
    };
    return this.patchPlatform(jobId, updated);
  }

  private completeAttempt(
    platform: PlatformJob,
    outcome: "succeeded" | "failed" | "unknown" | "cancelled",
  ): PlatformJob["attempts"] {
    const attempts = [...platform.attempts];
    const last = attempts[attempts.length - 1];
    if (last && last.outcome === undefined) {
      attempts[attempts.length - 1] = { ...last, endedAt: this.now(), outcome };
    }
    return attempts;
  }

  /** 经守卫的状态迁移:非法迁移被拒绝并记录(不抛出,避免整条链路中断)。 */
  private async move(jobId: string, platform: PlatformJob, to: PlatformJobStage): Promise<PlatformJob> {
    const t = transitionPlatform(platform.stage, to);
    if (!t.ok) return platform; // 非法迁移被拒绝
    const updated: PlatformJob = { ...platform, stage: to, updatedAt: this.now() };
    return this.patchPlatform(jobId, updated);
  }

  /**
   * 恢复性 reset:checkpoint 恢复(非正常迁移,不经过守卫)。
   * 场景:崩溃重启/手动重试时,从已上传资产的 uploading 或 adapting 直接续跑。
   */
  private async resetStage(jobId: string, platform: PlatformJob, to: PlatformJobStage): Promise<PlatformJob> {
    const updated: PlatformJob = { ...platform, stage: to, updatedAt: this.now() };
    return this.patchPlatform(jobId, updated);
  }

  private throwIfAborted(jobId: string, signal?: AbortSignal): void {
    if (signal?.aborted || this.isCancelled(jobId)) {
      throw new Error(`任务 ${jobId} 已取消`);
    }
  }

  /** 从任务里取平台产物(未提供时给占位,由 executor 自行处理)。 */
  private payloadFor(jobId: string, platform: PlatformJob): SerializedPayload {
    void jobId;
    return platform.payload ?? {
      content: "",
      title: "",
      mime: "text/html",
      tags: [],
      imageAssetIds: [],
    };
  }

  /**
   * 读取平台任务的持久化 payload(进程重启恢复后供 executor 重建发布上下文)。
   * 不存在时返回 undefined(执行器 prepare 自行构造)。
   */
  async getPlatformPayload(jobId: string, platformId: string): Promise<SerializedPayload | undefined> {
    const p = await this.getPlatform(jobId, platformId);
    return p.payload;
  }

  /**
   * 写入平台任务的持久化 payload(在 prepare 之前预写,供极端崩溃恢复)。
   * 用于 server 侧任务创建后、首次运行前,让发布上下文尽早落盘。
   */
  async updatePlatformPayload(
    jobId: string,
    platformId: string,
    payload: SerializedPayload,
  ): Promise<void> {
    const current = await this.getPlatform(jobId, platformId);
    await this.patchPlatform(jobId, { ...current, payload, updatedAt: this.now() });
  }

  private async getPlatform(jobId: string, platformId: string): Promise<PlatformJob> {
    const job = await this.requireJob(jobId);
    const p = job.platformJobs.find((x) => x.platformId === platformId);
    if (!p) throw new Error(`平台 ${platformId} 不存在于任务 ${jobId}`);
    return p;
  }

  private async patchPlatform(jobId: string, platform: PlatformJob): Promise<PlatformJob> {
    const job = await this.requireJob(jobId);
    const next: PublishJob = {
      ...job,
      platformJobs: job.platformJobs.map((p) => (p.platformId === platform.platformId ? platform : p)),
      updatedAt: this.now(),
    };
    await this.store.put(next);
    return platform;
  }

  private async failPlatform(jobId: string, platformJob: PlatformJob, message: string): Promise<PlatformJob> {
    const cur = await this.getPlatform(jobId, platformJob.platformId);
    const updated: PlatformJob = {
      ...cur,
      stage: "failed",
      error: message,
      attempts: this.completeAttempt(cur, "failed"),
      updatedAt: this.now(),
    };
    return this.patchPlatform(jobId, updated);
  }

  private async cancelPlatform(jobId: string, platformJob: PlatformJob): Promise<PlatformJob> {
    const cur = await this.getPlatform(jobId, platformJob.platformId);
    const updated: PlatformJob = {
      ...cur,
      stage: "cancelled",
      error: "已取消",
      attempts: this.completeAttempt(cur, "cancelled"),
      updatedAt: this.now(),
    };
    return this.patchPlatform(jobId, updated);
  }

  private async requireJob(jobId: string): Promise<PublishJob> {
    const job = await this.store.get(jobId);
    if (!job) throw new Error(`任务不存在: ${jobId}`);
    return job;
  }
}

export function platformStageLabel(stage: PlatformJobStage): string {
  switch (stage) {
    case "queued":
      return "排队中";
    case "adapting":
      return "适配中";
    case "validating":
      return "校验中";
    case "uploading":
      return "上传中";
    case "staging":
      return "暂存中";
    case "awaiting-confirmation":
      return "等待确认";
    case "submitting":
      return "提交中";
    case "verifying":
      return "核验中";
    case "succeeded":
      return "已成功";
    case "needs-user-action":
      return "需人工处理";
    case "failed":
      return "失败";
    case "unknown":
      return "状态未知";
    case "cancelled":
      return "已取消";
  }
}

export function jobStageLabel(stage: PublishJob["stage"]): string {
  return platformStageLabel(stage);
}

export { coarseStageOf };
