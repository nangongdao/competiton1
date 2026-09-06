import { describe, expect, it } from "vitest";
import {
  aggregateJobStage,
  canTransitionJob,
  canTransitionPlatform,
  coarseStageOf,
  isSafeToRetry,
  isTerminalStage,
  transitionJob,
} from "../src/jobs/state-machine.js";

describe("JOB-01 状态迁移守卫", () => {
  it("queued → adapting → validating 是合法迁移", () => {
    expect(canTransitionJob("queued", "adapting")).toBe(true);
    expect(canTransitionJob("adapting", "validating")).toBe(true);
    expect(canTransitionJob("validating", "uploading")).toBe(true);
  });

  it("终态不可再迁移", () => {
    for (const terminal of ["succeeded", "cancelled"] as const) {
      expect(canTransitionJob(terminal, "adapting")).toBe(false);
      expect(canTransitionJob(terminal, "submitting")).toBe(false);
      expect(canTransitionPlatform(terminal, "verifying")).toBe(false);
    }
    // failed/unknown 是"可人工干预"的终态:可重试到可恢复阶段,但不能直接跳到成功。
    expect(canTransitionJob("failed", "succeeded")).toBe(false);
    expect(canTransitionJob("unknown", "succeeded")).toBe(false);
    expect(canTransitionJob("unknown", "failed")).toBe(false);
    expect(canTransitionJob("failed", "unknown")).toBe(false);
  });

  it("非法跳转被拒绝并记录原因", () => {
    const r = transitionJob("succeeded", "submitting");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("非法任务状态迁移");
  });

  it("cancelled 是终态,不产生额外迁移", () => {
    expect(isTerminalStage("cancelled")).toBe(true);
    expect(canTransitionJob("submitting", "cancelled")).toBe(true);
    expect(canTransitionJob("cancelled", "queued")).toBe(false);
  });

  it("失败后可重试到可恢复阶段,unknown 禁止自动重试", () => {
    expect(isSafeToRetry("failed")).toBe(true);
    expect(isSafeToRetry("unknown")).toBe(false);
    expect(canTransitionJob("failed", "uploading")).toBe(true);
    expect(canTransitionJob("unknown", "uploading")).toBe(true); // unknown 只能人工核对后重试
    expect(canTransitionJob("unknown", "succeeded")).toBe(false);
  });

  it("needs-user-action 可回到活跃阶段继续", () => {
    expect(canTransitionJob("needs-user-action", "submitting")).toBe(true);
    expect(canTransitionJob("needs-user-action", "cancelled")).toBe(true);
  });
});

describe("JOB-01 阶段聚合", () => {
  it("全部成功 → succeeded", () => {
    expect(aggregateJobStage(["succeeded", "succeeded"])).toBe("succeeded");
  });

  it("任一 cancelled 优先", () => {
    expect(aggregateJobStage(["succeeded", "cancelled"])).toBe("cancelled");
  });

  it("任一 unknown 优先于 failed", () => {
    expect(aggregateJobStage(["failed", "unknown"])).toBe("unknown");
  });

  it("任一 needs-user-action 高于 failed", () => {
    expect(aggregateJobStage(["failed", "needs-user-action"])).toBe("needs-user-action");
  });

  it("进行中取最靠后的非终态阶段", () => {
    expect(aggregateJobStage(["adapting", "submitting"])).toBe("submitting");
    expect(aggregateJobStage(["queued", "verifying"])).toBe("verifying");
  });

  it("coarseStageOf 正确映射", () => {
    expect(coarseStageOf("queued")).toBe("adapting");
    expect(coarseStageOf("uploading")).toBe("uploading");
    expect(coarseStageOf("succeeded")).toBe("succeeded");
    expect(coarseStageOf("unknown")).toBe("unknown");
  });
});
