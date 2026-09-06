/**
 * 发布任务模型(JOB-01) —— 一次用户操作产生一个 `PublishJob`,每个平台拥有独立 `PlatformJob`。
 *
 * 设计要点(路线图 §4.2):
 * - 任务记录内容摘要、幂等键、阶段、尝试次数、已上传资产、回执和可脱敏诊断引用。
 * - 失败重试从最后可安全恢复的阶段继续;已成功平台和已上传资产不能重复执行。
 * - `published` 必须有平台成功提示、远端 ID/URL 或可验证页面状态;仅点击按钮只能标记 `submitted`。
 * - `unknown` 表示请求可能已生效但没有可信回执,禁止自动重试,必须先由用户核对。
 */
import type { SerializedPayload } from "../adapters/types.js";

/** 任务阶段(与路线图 §4.2 一致)。 */
export const jobStages = [
  "queued",
  "adapting",
  "validating",
  "uploading",
  "staging",
  "awaiting-confirmation",
  "submitting",
  "verifying",
  "succeeded",
  "needs-user-action",
  "failed",
  "unknown",
  "cancelled",
] as const;
export type JobStage = (typeof jobStages)[number];

/** 平台任务阶段(单平台粒度,是 PublishJob 阶段的细化;PublishJob 取整体阶段)。 */
export const platformJobStages = [
  "queued",
  "adapting",
  "validating",
  "uploading",
  "staging",
  "awaiting-confirmation",
  "submitting",
  "verifying",
  "succeeded",
  "needs-user-action",
  "failed",
  "unknown",
  "cancelled",
] as const;
export type PlatformJobStage = (typeof platformJobStages)[number];

/** 一次执行尝试的记录。 */
export interface JobAttempt {
  readonly seq: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly stage?: JobStage;
  /** 尝试结果(成功/失败/未知)。 */
  readonly outcome?: "succeeded" | "failed" | "unknown" | "cancelled";
  readonly error?: string;
  /** 脱敏诊断引用(runner runsDir 等),不含正文以外敏感字段。 */
  readonly diagnosticsPath?: string;
}

/** 平台侧回执(与 runner/公众号回执归一化的最小结构)。 */
export interface JobReceipt {
  readonly platformId: string;
  readonly status:
    | "staged"
    | "submitted"
    | "drafted"
    | "published"
    | "failed"
    | "unknown"
    | "needs-user-action";
  readonly message: string;
  readonly remoteId?: string;
  readonly remoteUrl?: string;
  readonly at: string;
}

/** 单平台发布任务。 */
export interface PlatformJob {
  readonly platformId: string;
  readonly stage: PlatformJobStage;
  /** 尝试次数(重试会递增)。 */
  readonly attemptCount: number;
  readonly attempts: readonly JobAttempt[];
  /** 已上传资产(重试时不得重复上传)。 */
  readonly uploadedAssets: readonly UploadedAssetRef[];
  readonly receipt?: JobReceipt;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 诊断工件目录(runner)。 */
  readonly diagnosticsPath?: string;
  /**
   * 平台产物/发布请求(随任务持久化,供进程重启后从 checkpoint 恢复)。
   *
   * 由 `PublishJobService.run()` 在 prepare 阶段写入;submit/verify 从任务读取,
   * 而非仅依赖执行器闭包 —— 这样 FileJobStore 落盘后,重启可完整重建发布上下文。
   */
  readonly payload?: SerializedPayload;
}

/** 已成功上传的资产引用(用于 checkpoint 恢复)。 */
export interface UploadedAssetRef {
  readonly assetId: string;
  readonly url?: string;
  readonly mediaId?: string;
}

/** 整体发布任务。 */
export interface PublishJob {
  readonly id: string;
  /** 内容摘要(SHA-256 前缀,用于 full-auto 二次确认绑定与幂等)。 */
  readonly contentDigest: string;
  /** 幂等键(客户端提供的 key 不被信任,服务端/任务层自行派生)。 */
  readonly idempotencyKey?: string;
  readonly stage: JobStage;
  readonly platformJobs: readonly PlatformJob[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 任务级错误。 */
  readonly error?: string;
  /** 是否为可恢复运行(runner 等),恢复时从最近 checkpoint 继续。 */
  readonly resumeFrom?: JobStage;
}

/** 创建任务的输入(内容由任务层计算摘要)。 */
export interface NewPublishJob {
  readonly id?: string;
  readonly contentDigest: string;
  readonly idempotencyKey?: string;
  readonly platforms: readonly string[];
  readonly now?: () => string;
}

/** 任务被取消的标记。 */
export interface JobCancellation {
  readonly jobId: string;
  readonly reason?: string;
  readonly at: string;
}
