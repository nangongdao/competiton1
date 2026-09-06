/**
 * DASH-04 —— 目标进度数据派生。
 *
 * 输入:效果回收记录 + 用户设定的目标(月阅读量 / 月发布数)。
 * 输出:目标 vs 实际进度(0~1 安全处理,目标 ≤0 时进度为 0 且标记未设定)。
 *
 * 设计约束:
 * - 纯 TS 零 DOM;
 * - 目标 0/负值安全处理,不产生 NaN/Infinity;
 * - 支持按自然月窗口统计。
 */
import type { PerformanceRecord } from "../analytics/types.js";

/** 目标进度条目。 */
export interface GoalProgressItem {
  /** 目标名(如"月阅读量")。 */
  readonly label: string;
  /** 目标值。 */
  readonly goal: number;
  /** 实际值。 */
  readonly actual: number;
  /** 进度(0~1,目标未设定/≤0 时为 0)。 */
  readonly progress: number;
  /** 是否已设定目标。 */
  readonly hasGoal: boolean;
  /** 是否已达成(进度 ≥1)。 */
  readonly achieved: boolean;
  /** 剩余量(达成或未设定时为 0)。 */
  readonly remaining: number;
}

export interface GoalProgressOptions {
  /** 目标月(YYYY-MM,默认当前月)。 */
  readonly month?: string;
  /** 月阅读量目标(0 = 未设定)。 */
  readonly monthlyViewsGoal?: number;
  /** 月发布数目标(0 = 未设定)。 */
  readonly monthlyPostsGoal?: number;
  readonly now?: () => string;
}

/** 取自然月前缀(YYYY-MM)。 */
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** 计算目标进度。 */
export function goalProgress(
  records: readonly PerformanceRecord[],
  options: GoalProgressOptions = {},
): readonly GoalProgressItem[] {
  const nowIso = options.now?.() ?? new Date().toISOString();
  const month = options.month ?? monthOf(nowIso);

  let views = 0;
  let posts = 0;
  for (const r of records) {
    const m = monthOf(r.collectedAt);
    if (m !== month) continue;
    views += r.metrics.views ?? 0;
    posts += 1;
  }

  const mk = (label: string, goal: number, actual: number): GoalProgressItem => {
    const hasGoal = goal > 0;
    const progress = hasGoal ? Math.min(1, actual / goal) : 0;
    const remaining = hasGoal && actual < goal ? goal - actual : 0;
    return {
      label,
      goal,
      actual,
      progress,
      hasGoal,
      achieved: hasGoal && actual >= goal,
      remaining,
    };
  };

  return [
    mk("月阅读量", options.monthlyViewsGoal ?? 0, views),
    mk("月发布数", options.monthlyPostsGoal ?? 0, posts),
  ];
}
