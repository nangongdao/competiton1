/**
 * 发布流程分步耗时观测(路线图 §6.2「解决当前 runner 抖动」)。
 *
 * 目标:记录每个步骤耗时,定位启动、选择器还是事件等待问题;
 * 只有证据表明正常耗时确实超过阈值时才调整 timeout,而不是盲目放大。
 */
export const PUBLISH_STEPS = [
  "open-session",
  "goto-editor",
  "prepare",
  "confirm",
  "submit",
  "verify",
  "artifacts",
] as const;

export type PublishStep = (typeof PUBLISH_STEPS)[number];

export interface StepSample {
  /** 步骤标识(机器可读)。 */
  readonly step: PublishStep;
  /** 人类可读说明。 */
  readonly label: string;
  /** 该步骤耗时(ms)。 */
  readonly elapsedMs: number;
  /** 步骤是否异常(超阈值/抛出)。 */
  readonly exceeded?: boolean;
}

export interface StepTimingSummary {
  /** 全部步骤总耗时(ms)。 */
  readonly totalMs: number;
  /** 分步耗时样本(按完成顺序)。 */
  readonly samples: readonly StepSample[];
  /** 超过预算的步骤(可用于驱动 timeout 调整)。 */
  readonly slowSteps: readonly StepSample[];
}

/**
 * 分步计时器:begin(step,label) 返回结束函数,结束函数返回耗时并记录样本。
 * 支持在结束时传入是否超过预算(exceeded)。
 */
export class StepTimer {
  private readonly samples: StepSample[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** 开始记录一步,返回结束函数。 */
  begin(step: PublishStep, label: string, budgetMs?: number): () => StepSample {
    const start = this.now();
    return () => {
      const elapsedMs = this.now() - start;
      const exceeded = budgetMs !== undefined && elapsedMs > budgetMs;
      const sample: StepSample = { step, label, elapsedMs, ...(exceeded ? { exceeded: true } : {}) };
      this.samples.push(sample);
      return sample;
    };
  }

  /** 当前已记录样本。 */
  get snapshot(): readonly StepSample[] {
    return [...this.samples];
  }

  /** 汇总:总耗时 + 分步样本 + 慢步骤(超过预算)。 */
  summarize(budgets?: Partial<Record<PublishStep, number>>): StepTimingSummary {
    const totalMs = this.samples.reduce((sum, s) => sum + s.elapsedMs, 0);
    const slowSteps = this.samples.filter((s) => {
      if (!budgets) return s.exceeded === true;
      const budget = budgets[s.step];
      return budget !== undefined && s.elapsedMs > budget;
    });
    return { totalMs, samples: this.snapshot, slowSteps };
  }
}

/** 判定某步是否超预算(未提供预算时按 exceeded 标记)。 */
export function isStepSlow(sample: StepSample, budgets?: Partial<Record<PublishStep, number>>): boolean {
  if (!budgets) return sample.exceeded === true;
  const budget = budgets[sample.step];
  return budget !== undefined && sample.elapsedMs > budget;
}

/** 将分步耗时渲染为可读文本(用于回执 message / 日志)。 */
export function formatStepTiming(summary: StepTimingSummary): string {
  const lines = summary.samples.map(
    (s) => `  ${s.step}: ${s.elapsedMs}ms${s.exceeded ? " (超过预算)" : ""}`,
  );
  return [`步骤耗时 ${summary.totalMs}ms`, ...lines].join("\n");
}
