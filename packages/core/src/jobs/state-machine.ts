/**
 * 发布任务状态迁移守卫(JOB-01) —— 非法状态跳转被拒绝并记录。
 *
 * 规则:
 * - 终态(succeeded / failed / unknown / cancelled)不可再迁移;
 * - 除 cancelled 外的终态只能从"活跃/等待"阶段进入;
 * - 重试 = 回到其前置可恢复阶段(不把失败当作新终态链);
 * - 每种迁移都返回结构化结果,便于记录原因。
 */
import type { JobStage, PlatformJobStage } from "./types.js";

/** 允许迁移:from → 合法目标阶段集合(重试=重置到可恢复阶段,由编排层调用)。 */
const JOB_TRANSITIONS: Readonly<Record<JobStage, readonly JobStage[]>> = {
  queued: ["adapting"],
  adapting: ["validating", "failed", "unknown", "cancelled", "needs-user-action"],
  validating: ["uploading", "staging", "failed", "unknown", "cancelled", "needs-user-action"],
  uploading: ["staging", "failed", "unknown", "cancelled", "needs-user-action"],
  staging: ["awaiting-confirmation", "submitting", "failed", "unknown", "cancelled", "needs-user-action"],
  "awaiting-confirmation": ["submitting", "cancelled", "needs-user-action", "failed", "unknown"],
  submitting: ["verifying", "failed", "unknown", "cancelled", "needs-user-action"],
  verifying: ["succeeded", "failed", "unknown", "needs-user-action", "cancelled"],
  succeeded: [],
  "needs-user-action": ["adapting", "uploading", "staging", "submitting", "verifying", "cancelled"],
  failed: ["queued", "adapting", "uploading", "staging", "cancelled"],
  unknown: ["queued", "adapting", "uploading", "staging", "needs-user-action", "cancelled"],
  cancelled: [],
};

const PLATFORM_TRANSITIONS: Readonly<Record<PlatformJobStage, readonly PlatformJobStage[]>> = JOB_TRANSITIONS;

export interface TransitionResult {
  readonly ok: boolean;
  readonly from: JobStage | PlatformJobStage;
  readonly to: JobStage | PlatformJobStage;
  readonly reason?: string;
}

/** 判断整体任务阶段迁移是否合法。 */
export function canTransitionJob(from: JobStage, to: JobStage): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 判断平台任务阶段迁移是否合法(与整体任务同构)。 */
export function canTransitionPlatform(from: PlatformJobStage, to: PlatformJobStage): boolean {
  return PLATFORM_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 执行任务阶段迁移,非法跳转返回失败原因(供记录)。 */
export function transitionJob(from: JobStage, to: JobStage): TransitionResult {
  if (from === to) return { ok: true, from, to };
  if (!canTransitionJob(from, to)) {
    return { ok: false, from, to, reason: `非法任务状态迁移: ${from} -> ${to}` };
  }
  return { ok: true, from, to };
}

/** 执行平台任务阶段迁移,非法跳转返回失败原因。 */
export function transitionPlatform(from: PlatformJobStage, to: PlatformJobStage): TransitionResult {
  if (from === to) return { ok: true, from, to };
  if (!canTransitionPlatform(from, to)) {
    return { ok: false, from, to, reason: `非法平台状态迁移: ${from} -> ${to}` };
  }
  return { ok: true, from, to };
}

/** 是否为终态。 */
export function isTerminalStage(stage: JobStage | PlatformJobStage): boolean {
  return stage === "succeeded" || stage === "failed" || stage === "unknown" || stage === "cancelled";
}

/** 是否为可安全自动重试的阶段(failed 且幂等阶段可重试;unknown 禁止)。 */
export function isSafeToRetry(stage: JobStage | PlatformJobStage): boolean {
  return stage === "failed";
}

/** 把平台任务阶段映射到整体任务阶段(整体取最粗粒度进度)。 */
export function coarseStageOf(stage: PlatformJobStage): JobStage {
  switch (stage) {
    case "queued":
    case "adapting":
      return "adapting";
    case "validating":
      return "validating";
    case "uploading":
      return "uploading";
    case "staging":
      return "staging";
    case "awaiting-confirmation":
      return "awaiting-confirmation";
    case "submitting":
      return "submitting";
    case "verifying":
      return "verifying";
    case "succeeded":
      return "succeeded";
    case "needs-user-action":
      return "needs-user-action";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    case "cancelled":
      return "cancelled";
  }
}

/**
 * 汇总一组平台任务得到整体任务阶段:
 * - 任一 cancelled → cancelled(用户显式取消优先);
 * - 任一 unknown → unknown(状态不明必须显式核对);
 * - 任一 needs-user-action → needs-user-action;
 * - 任一 failed → failed;
 * - 全部 succeeded → succeeded;
 * - 否则取"进行中最靠后的非终态阶段"(适配中 > 校验中 > … > 提交中 > 核验中)。
 */
export function aggregateJobStage(platformStages: readonly PlatformJobStage[]): JobStage {
  if (platformStages.length === 0) return "queued";
  if (platformStages.every((s) => s === "succeeded")) return "succeeded";
  if (platformStages.some((s) => s === "cancelled")) return "cancelled";
  if (platformStages.some((s) => s === "unknown")) return "unknown";
  if (platformStages.some((s) => s === "needs-user-action")) return "needs-user-action";
  if (platformStages.some((s) => s === "failed")) return "failed";

  const order: readonly PlatformJobStage[] = [
    "queued",
    "adapting",
    "validating",
    "uploading",
    "staging",
    "awaiting-confirmation",
    "submitting",
    "verifying",
  ];
  let highest: PlatformJobStage = "queued";
  for (const s of platformStages) {
    if (order.indexOf(s) > order.indexOf(highest)) highest = s;
  }
  return coarseStageOf(highest);
}
