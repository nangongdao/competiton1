/**
 * v9 Phase 2 · FORECAST-02 发布决策辅助。
 *
 * 结合预测结果 + 目标进度 + 内容质量给出发布建议:
 * 立即发 / 改期发 / 优化后发 / 不发。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;决策逻辑可单测;
 * - 结合既有 `goalProgress` 目标进度语义(阅读/发布数目标);
 * - 缺数据安全回退(给出保守建议:立即发 + 说明数据不足)。
 */
import type { ForecastResult } from "./forecast.js";

/** 发布决策类型。 */
export type PublishDecisionKind = "publish-now" | "reschedule" | "optimize-first" | "skip";

/** 发布决策。 */
export interface PublishDecision {
  readonly kind: PublishDecisionKind;
  /** 一句话决策说明。 */
  readonly reason: string;
  /** 决策详情列表。 */
  readonly details: readonly string[];
  /** 是否建议立即发布。 */
  readonly recommendPublish: boolean;
}

/** 决策输入。 */
export interface DecisionInput {
  /** 效果预测结果(可为空:未预测)。 */
  readonly forecast?: ForecastResult;
  /** 月阅读目标(0 = 未设目标)。 */
  readonly monthlyViewsGoal?: number;
  /** 当前累计阅读(用于目标进度)。 */
  readonly currentMonthlyViews?: number;
  /** 月发布数目标(0 = 未设)。 */
  readonly monthlyPublishGoal?: number;
  /** 当前累计发布数。 */
  readonly currentMonthlyPublishes?: number;
  /** 内容是否通过校验(error=0)。 */
  readonly allPassed?: boolean;
  /** 是否有阻塞问题(校验 error>0)。 */
  readonly hasBlockers?: boolean;
}

/** 目标进度(与 dashboard/goals.ts 语义对齐)。 */
function progressOf(current: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.min(1, current / goal);
}

/**
 * FORECAST-02 发布决策。
 *
 * 规则:
 * - 有阻塞问题 → 优化后发(optimize-first);
 * - 未通过校验 → 优化后发;
 * - 目标阅读进度 < 100% 且预测中位低于目标缺口 → 建议立即发(追赶目标);
 * - 预测中位过低(平台全部样本 < 阈值) → 建议改期发(换最佳时段)或优化后发;
 * - 目标已达成且预测一般 → 建议改期(择机再发)。
 */
export function buildPublishDecision(input: DecisionInput): PublishDecision {
  if (input.hasBlockers || !input.allPassed) {
    return {
      kind: "optimize-first",
      reason: "内容存在校验问题,建议先修复再发布。",
      details: ["请先运行「发布前检查」并修复 error 级问题。"],
      recommendPublish: false,
    };
  }

  const goalProgress = progressOf(input.currentMonthlyViews ?? 0, input.monthlyViewsGoal ?? 0);
  const forecast = input.forecast;

  if (!forecast || forecast.safeFallback || forecast.platforms.length === 0) {
    return {
      kind: "publish-now",
      reason: "暂无效果预测数据,建议按当前计划发布并持续回收效果。",
      details: ["数据不足无法预测,发布后请到「效果回收」录入数据以积累预测样本。"],
      recommendPublish: true,
    };
  }

  const bestMedian = Math.max(...forecast.platforms.map((p) => p.range.median));

  // 目标阅读进度不足 → 追目标,立即发。
  if (goalProgress < 1 && input.monthlyViewsGoal && input.monthlyViewsGoal > 0) {
    const remaining = (input.monthlyViewsGoal ?? 0) - (input.currentMonthlyViews ?? 0);
    if (remaining > 0 && bestMedian > 0) {
      return {
        kind: "publish-now",
        reason: `本月阅读目标进度 ${Math.round(goalProgress * 100)}%,预期最佳平台中位 ${bestMedian} 阅读,建议立即发布追赶目标。`,
        details: [
          `推荐平台:${forecast.recommendedPlatforms.join(" / ") || "无"}`,
          forecast.bestHour != null ? `最佳发布时段:${forecast.bestHour}:00` : "最佳时段暂无数据",
        ],
        recommendPublish: true,
      };
    }
  }

  // 预测中位很低(全部平台 < 5) → 优化或改期。
  if (bestMedian < 5) {
    return {
      kind: "optimize-first",
      reason: "历史同类内容阅读极低,建议先优化标题/摘要或更换发布时段。",
      details: ["参考驾驶舱「内容优化建议」与「最佳发布时间」后再发布。"],
      recommendPublish: false,
    };
  }

  // 目标已达成 → 择机再发。
  if (goalProgress >= 1) {
    return {
      kind: "reschedule",
      reason: "本月阅读目标已达成,建议选择更佳时段或分批发布。",
      details: [forecast.bestHour != null ? `建议在 ${forecast.bestHour}:00 时段发布。` : "暂无最佳时段数据。"],
      recommendPublish: true,
    };
  }

  // 默认:立即发。
  return {
    kind: "publish-now",
    reason: "内容就绪且预测正常,建议立即发布。",
    details: [
      `推荐平台:${forecast.recommendedPlatforms.join(" / ") || "无"}`,
      forecast.bestHour != null ? `最佳发布时段:${forecast.bestHour}:00` : "最佳时段暂无数据",
    ],
    recommendPublish: true,
  };
}
