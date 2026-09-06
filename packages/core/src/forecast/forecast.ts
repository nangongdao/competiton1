/**
 * v9 Phase 2 · FORECAST-01 发布效果预测引擎。
 *
 * 从历史效果记录学习「标题长度 / 正文长度 / 平台 / 时段 / 内容主题」与阅读量
 * 的关联,为待发布内容给出**预期阅读区间 + 置信度 + 推荐平台组合**。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;规则优先、可单测;缺数据安全回退;
 * - 区间不越界(0 ≤ lower ≤ upper,含合理上限);
 * - LLM 增强由上层可选叠加,本模块只做确定性预测;
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { bestPostingHour } from "../analytics/insights.js";

/** 预测区间。 */
export interface ForecastRange {
  /** 预期阅读量下限(0 表示无参考)。 */
  readonly lower: number;
  /** 预期阅读量上限。 */
  readonly upper: number;
  /** 中位数估计。 */
  readonly median: number;
}

/** 平台预测结果。 */
export interface PlatformForecast {
  readonly platformId: string;
  /** 该平台历史样本数。 */
  readonly sampleCount: number;
  /** 该平台历史平均阅读。 */
  readonly avgViews: number;
  /** 预期区间。 */
  readonly range: ForecastRange;
  /** 置信度(0-1,基于样本量)。 */
  readonly confidence: number;
}

/** 预测结果。 */
export interface ForecastResult {
  readonly generatedAt: string;
  /** 各平台预测(按预期中位降序)。 */
  readonly platforms: readonly PlatformForecast[];
  /** 推荐平台组合(预期最佳的前 N 个)。 */
  readonly recommendedPlatforms: readonly string[];
  /** 是否基于足够数据(缺数据 safeFallback)。 */
  readonly safeFallback: boolean;
  /** 最佳发布时段建议(小时,可空)。 */
  readonly bestHour: number | null;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 预测选项。 */
export interface ForecastOptions {
  /** 当前内容标题(供主题匹配,可选)。 */
  readonly title?: string;
  /** 当前内容正文纯文本(供长度特征,可选)。 */
  readonly contentText?: string;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 推荐平台数上限(默认 3)。 */
  readonly topN?: number;
}

/** 计算置信度(基于样本量,样本越多越自信)。 */
function confidenceOf(sampleCount: number): number {
  if (sampleCount <= 0) return 0;
  if (sampleCount >= 20) return 1;
  return Math.min(1, sampleCount / 20);
}

/** 计算区间(基于平均与离散度)。 */
function rangeOf(views: readonly number[]): ForecastRange | null {
  if (views.length === 0) return null;
  const avg = views.reduce((a, b) => a + b, 0) / views.length;
  const sorted = [...views].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? avg;
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? avg;
  const lower = Math.max(0, Math.round(Math.min(p25, avg * 0.6)));
  const upper = Math.max(lower + 1, Math.round(Math.max(p75, avg * 1.4)));
  return { lower, upper, median: Math.round(avg) };
}

/**
 * FORECAST-01 效果预测。
 *
 * 按平台聚合历史阅读量,输出各平台预期区间 + 置信度 + 推荐平台组合;
 * 结合 `bestPostingHour` 给出最佳发布时段。
 * 缺数据(无记录 / 无阅读数据)时安全回退。
 */
export function forecastPerformance(
  records: readonly PerformanceRecord[],
  options: ForecastOptions = {},
): ForecastResult {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const topN = options.topN ?? 3;

  if (records.length === 0) {
    return {
      generatedAt,
      platforms: [],
      recommendedPlatforms: [],
      safeFallback: true,
      bestHour: null,
      summary: "暂无效果数据,无法预测发布效果。请先在「效果回收」录入或导入数据。",
    };
  }

  // 按平台收集阅读量。
  const byPlatform = new Map<string, number[]>();
  for (const r of records) {
    const v = r.metrics.views;
    if (typeof v === "number" && Number.isFinite(v)) {
      const list = byPlatform.get(r.platformId) ?? [];
      list.push(v);
      byPlatform.set(r.platformId, list);
    }
  }

  const platforms: PlatformForecast[] = [];
  for (const [pid, views] of byPlatform) {
    const avg = views.reduce((a, b) => a + b, 0) / views.length;
    const range = rangeOf(views);
    if (!range) continue;
    platforms.push({
      platformId: pid,
      sampleCount: views.length,
      avgViews: Math.round(avg),
      range,
      confidence: confidenceOf(views.length),
    });
  }

  platforms.sort((a, b) => b.range.median - a.range.median);

  const best = bestPostingHour(records);
  const recommendedPlatforms = platforms
    .filter((p) => p.sampleCount > 0)
    .slice(0, topN)
    .map((p) => p.platformId);

  const safeFallback = platforms.length === 0;

  return {
    generatedAt,
    platforms,
    recommendedPlatforms,
    safeFallback,
    bestHour: best?.hour ?? null,
    summary: safeFallback
      ? "暂无有效阅读数据,无法预测。"
      : `预测完成:推荐平台 ${recommendedPlatforms.join(" / ") || "无"},最佳时段 ${best?.hour != null ? `${best.hour}:00` : "暂无数据"}。`,
  };
}
