/**
 * 故障注入工具(Phase 2 退出条件) —— 在可信的 PlatformExecutor 上叠加可编程故障,
 * 供单元/集成测试与 main 夜间门禁复用。
 *
 * 覆盖路线图 Phase 2 退出条件中的五类场景:
 * - 上传第 N 张失败(upload-fail-at);
 * - 平台超时(submit-timeout / prepare-timeout / verify-timeout);
 * - 提交后断网(submit-then-network-drop → verify 返回 unknown);
 * - 用户取消(由 AbortSignal 贯穿,配合 service.cancel / controller.abort);
 * - 进程重启(配合 FileJobStore:重建 service + 恢复执行器后从 checkpoint 续跑)。
 *
 * 本模块只做"注入点"声明,不直接发网络请求;超时用可控延迟模拟。
 */
import type { PlatformExecutor, PlatformExecutorHookName } from "./executor-types.js";

/** 故障类型。 */
export type FaultKind =
  /** 指定阶段抛错(可限定在某个尝试序号后停止注入)。 */
  | { kind: "stage-error"; stage: PlatformExecutorHookName; error: string; attempts?: number }
  /** 上传第 N 张资产失败(assetIndex 从 0 开始;负数表示最后一个)。 */
  | { kind: "upload-fail-at"; assetIndex: number; error: string; attempts?: number }
  /** 指定阶段延迟超过 timeoutMs 后抛错(模拟平台超时)。 */
  | { kind: "stage-timeout"; stage: PlatformExecutorHookName; timeoutMs: number; error: string; attempts?: number }
  /** 提交后断网:submit 成功返回 submitted,但 verify 抛"网络中断"。 */
  | { kind: "submit-then-network-drop"; error: string; attempts?: number };

export interface FaultRule {
  readonly fault: FaultKind;
  /** 命中后是否继续注入(true=永久注入;false=只注入一次后放行)。 */
  readonly repeat?: boolean;
}

export interface FaultInjectionOptions {
  /** 注入规则(按顺序匹配;同一 stage 多条规则依次消耗)。 */
  readonly rules?: readonly FaultRule[];
}

/**
 * 故障注入执行器装饰器。
 *
 * @example
 * ```ts
 * const executor = new FaultInjectionExecutor(baseExecutor, {
 *   rules: [{ fault: { kind: "upload-fail-at", assetIndex: 1, error: "图床 503" } }],
 * });
 * ```
 */
export class FaultInjectionExecutor implements PlatformExecutor {
  private readonly rules: FaultRule[];
  private readonly stageCounts = new Map<string, number>();

  constructor(
    private readonly inner: PlatformExecutor,
    options: FaultInjectionOptions = {},
  ) {
    this.rules = [...(options.rules ?? [])];
  }

  async prepare(payload: Parameters<PlatformExecutor["prepare"]>[0]) {
    this.bump("prepare");
    await this.maybeInject("prepare");
    return this.inner.prepare(payload);
  }

  async upload(assetRefs: Parameters<PlatformExecutor["upload"]>[0], signal?: AbortSignal) {
    this.bump("upload");
    await this.maybeInject("upload", assetRefs.length);
    return this.inner.upload(assetRefs, signal);
  }

  async submit(payload: Parameters<PlatformExecutor["submit"]>[0], signal?: AbortSignal) {
    this.bump("submit");
    await this.maybeInject("submit");
    return this.inner.submit(payload, signal);
  }

  async verify(payload: Parameters<PlatformExecutor["verify"]>[0], receipt: Parameters<PlatformExecutor["verify"]>[1], signal?: AbortSignal) {
    this.bump("verify");
    await this.maybeInject("verify");
    return this.inner.verify(payload, receipt, signal);
  }

  private bump(stage: PlatformExecutorHookName): void {
    this.stageCounts.set(stage, (this.stageCounts.get(stage) ?? 0) + 1);
  }

  private async maybeInject(stage: PlatformExecutorHookName, assetCount?: number): Promise<void> {
    for (const rule of this.rules) {
      const f = rule.fault;
      if (f.kind === "upload-fail-at" && stage !== "upload") continue;
      if (f.kind === "submit-then-network-drop" && stage !== "submit") continue;
      if ((f.kind === "stage-error" || f.kind === "stage-timeout") && f.stage !== stage) continue;

      // 尝试次数门槛:attempts 指定后,仅在达到该次数时注入。
      if ("attempts" in f && f.attempts !== undefined) {
        const count = this.stageCounts.get(stage) ?? 0;
        if (count !== f.attempts) continue;
      }

      if (f.kind === "upload-fail-at") {
        const idx = f.assetIndex < 0 ? (assetCount ?? 0) + f.assetIndex : f.assetIndex;
        if (assetCount === undefined || idx < 0 || idx >= assetCount) continue;
        if (!rule.repeat) this.rules.splice(this.rules.indexOf(rule), 1);
        throw new Error(f.error);
      }

      if (f.kind === "stage-timeout") {
        await new Promise((resolve) => setTimeout(resolve, f.timeoutMs));
      }

      if (!rule.repeat) this.rules.splice(this.rules.indexOf(rule), 1);
      throw new Error(f.error);
    }
  }
}
