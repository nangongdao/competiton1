/**
 * v11 Phase 1 · REFRESH-TRACK-01 翻新效果追踪。
 *
 * 基于「翻新草稿溯源」把翻新重发的效果记录与其**原版效果**配对对照，
 * 输出「提升 / 持平 / 下降」判定 + 分平台对照 + 累计提升估算。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;配对键可配置(默认归一化标题),匹配不上显式标注「未配对」不猜测;
 * - 判定阈值可配置;缺数据安全回退(不误报);
 * - 不依赖 LLM,纯确定性规则;
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { PerformanceRecord } from "../analytics/types.js";

/** 翻新效果判定。 */
export type RefreshOutcome = "improved" | "flat" | "declined" | "unpaired";

/** 单条翻新对照。 */
export interface RefreshComparison {
  /** 翻新后版本标题。 */
  readonly refreshedTitle: string;
  /** 翻新后平台。 */
  readonly platformId: string;
  /** 翻新后效果记录。 */
  readonly refreshed: PerformanceRecord;
  /** 匹配到的原版记录(未配对时为 undefined)。 */
  readonly original?: PerformanceRecord;
  /** 原版标题(未配对时取翻新标题去除后缀)。 */
  readonly originalTitle: string;
  /** 判定:提升 / 持平 / 下降 / 未配对。 */
  readonly outcome: RefreshOutcome;
  /** 阅读变化(翻新 - 原版;原版缺失时为空)。 */
  readonly viewDelta: number | null;
  /** 阅读变化率(原版>0 时;否则 null)。 */
  readonly viewDeltaRate: number | null;
  /** 互动变化(赞+评论+分享;原版缺失时为空)。 */
  readonly engagementDelta: number | null;
}

/** 翻新效果追踪结果。 */
export interface RefreshTrackResult {
  readonly generatedAt: string;
  /** 逐条对照。 */
  readonly comparisons: readonly RefreshComparison[];
  /** 已配对条数。 */
  readonly paired: number;
  /** 未配对条数。 */
  readonly unpaired: number;
  /** 提升条数。 */
  readonly improved: number;
  /** 持平条数。 */
  readonly flat: number;
  /** 下降条数。 */
  readonly declined: number;
  /** 累计阅读提升(已配对翻新 - 原版求和;负为下降)。 */
  readonly totalViewDelta: number;
  /** 平均阅读变化率(已配对,可空)。 */
  readonly avgViewDeltaRate: number | null;
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 翻新效果追踪选项。 */
export interface RefreshTrackOptions {
  /** 判定「提升」的阅读增长率阈值(默认 0.2)。 */
  readonly improvedRatio?: number;
  /** 判定「下降」的阅读增长率阈值(默认 -0.2)。 */
  readonly declinedRatio?: number;
  /** 翻新标题后缀模式(用于从翻新标题剥离出原版标题,默认 /\(翻新\s*\d{4}-\d{2}-\d{2}\)\s*$/)。 */
  readonly refreshSuffixPattern?: RegExp;
  /** 翻新闭环标记列表(翻新入队时自动打标;优先按此配对,再回退标题后缀匹配)。 */
  readonly refreshMarks?: readonly { readonly originalTitle: string; readonly refreshedTitle: string }[];
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 从翻新标题剥离后缀得到原版标题。 */
export function originalTitleFromRefreshed(
  refreshedTitle: string,
  pattern: RegExp = /\(翻新\s*\d{4}-\d{2}-\d{2}\)\s*$/,
): string {
  return refreshedTitle.replace(pattern, "").replace(/\s+$/, "");
}

/** 归一化标题(用于配对)。 */
function normalizeForMatch(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：""''（）《》【】,.!?;:()"'\-—]/g, "");
}

/** 互动数(赞+评论+分享)。 */
function engagementOf(r: PerformanceRecord): number {
  return (r.metrics.likes ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0);
}

/** 默认翻新标题后缀模式。 */
const DEFAULT_SUFFIX = /\(翻新\s*\d{4}-\d{2}-\d{2}\)\s*$/;

/**
 * REFRESH-TRACK-01 翻新效果追踪。
 *
 * 输入:全部效果记录。找出「翻新版本」(标题带翻新后缀)的记录，
 * 与其原版(标题归一化后匹配)配对:
 * - 优先匹配「同平台 + 归一化标题一致」的原版;
 * - 找不到同平台时回退「跨平台标题一致」的原版;
 * - 都找不到 → 未配对(unpaired)。
 *
 * 判定:
 * - 阅读变化率 ≥ improvedRatio → improved;
 * - 阅读变化率 ≤ declinedRatio → declined;
 * - 有原版且变化率在区间内 → flat;
 * - 无原版 → unpaired。
 *
 * 缺数据(无任何记录 / 无翻新版本)时安全回退。
 */
export function trackRefreshPerformance(
  records: readonly PerformanceRecord[],
  options: RefreshTrackOptions = {},
): RefreshTrackResult {
  const now = options.now ?? (() => new Date().toISOString());
  const improvedRatio = options.improvedRatio ?? 0.2;
  const declinedRatio = options.declinedRatio ?? -0.2;
  const suffix = options.refreshSuffixPattern ?? DEFAULT_SUFFIX;

  if (records.length === 0) {
    return {
      generatedAt: now(),
      comparisons: [],
      paired: 0,
      unpaired: 0,
      improved: 0,
      flat: 0,
      declined: 0,
      totalViewDelta: 0,
      avgViewDeltaRate: null,
      safeFallback: true,
      summary: "暂无效果数据,无法追踪翻新效果。请先在「效果回收」录入或导入数据。",
    };
  }

  // 分组:翻新版本 vs 原版候选。
  // v11 深化:显式标记(翻新入队自动打标)的翻新标题即使不带日期后缀也视为翻新版本。
  const markSet = new Set(
    (options.refreshMarks ?? []).map((m) => normalizeForMatch(m.refreshedTitle)),
  );
  const refreshedList: PerformanceRecord[] = [];
  const originals: PerformanceRecord[] = [];
  for (const r of records) {
    if (suffix.test(r.title) || markSet.has(normalizeForMatch(r.title))) {
      refreshedList.push(r);
    } else {
      originals.push(r);
    }
  }

  if (refreshedList.length === 0) {
    return {
      generatedAt: now(),
      comparisons: [],
      paired: 0,
      unpaired: 0,
      improved: 0,
      flat: 0,
      declined: 0,
      totalViewDelta: 0,
      avgViewDeltaRate: null,
      safeFallback: true,
      summary: "未发现带翻新后缀的效果记录。翻新重发后再次回收效果,这里会自动生成对照。",
    };
  }

  const comparisons: RefreshComparison[] = [];
  let paired = 0;
  let improved = 0;
  let flat = 0;
  let declined = 0;
  let totalViewDelta = 0;
  let rateSum = 0;
  let rateCount = 0;

  for (const ref of refreshedList) {
    // v11 深化:优先按显式标记取原版标题(翻新后标题被编辑也不受影响)。
    const mark = (options.refreshMarks ?? []).find(
      (m) =>
        normalizeForMatch(m.refreshedTitle) === normalizeForMatch(ref.title) ||
        normalizeForMatch(m.originalTitle) === normalizeForMatch(ref.title),
    );
    const originalTitle = mark ? mark.originalTitle : originalTitleFromRefreshed(ref.title, suffix);
    const refNorm = normalizeForMatch(originalTitle);

    // 0) 优先按「翻新入队时自动打标」的显式标记配对。
    let original = undefined as PerformanceRecord | undefined;
    if (mark) {
      const markNorm = normalizeForMatch(mark.originalTitle);
      original = originals.find(
        (o) => o.platformId === ref.platformId && normalizeForMatch(o.title) === markNorm,
      ) ?? originals.find((o) => normalizeForMatch(o.title) === markNorm);
    }

    // 1) 同平台 + 标题一致(无显式标记时回退标题后缀匹配)。
    if (!original) {
      original = originals.find(
        (o) => o.platformId === ref.platformId && normalizeForMatch(o.title) === refNorm,
      );
    }
    // 2) 跨平台标题一致。
    if (!original) {
      original = originals.find((o) => normalizeForMatch(o.title) === refNorm);
    }

    const refViews = ref.metrics.views ?? 0;
    const origViews = original?.metrics.views;
    const viewDelta = original ? refViews - (origViews ?? 0) : null;
    const viewDeltaRate =
      original && origViews !== undefined && origViews > 0 ? (refViews - origViews) / origViews : null;
    const engagementDelta =
      original ? engagementOf(ref) - engagementOf(original) : null;

    let outcome: RefreshOutcome;
    if (!original) {
      outcome = "unpaired";
    } else if (viewDeltaRate === null) {
      // 原版无阅读数据:无法判定,视为 flat(基于有原版但无基准)。
      outcome = "flat";
    } else if (viewDeltaRate >= improvedRatio) {
      outcome = "improved";
    } else if (viewDeltaRate <= declinedRatio) {
      outcome = "declined";
    } else {
      outcome = "flat";
    }

    if (original) {
      paired++;
      if (viewDelta !== null) totalViewDelta += viewDelta;
      if (viewDeltaRate !== null) {
        rateSum += viewDeltaRate;
        rateCount++;
      }
      if (outcome === "improved") improved++;
      else if (outcome === "declined") declined++;
      else flat++;
    }

    comparisons.push({
      refreshedTitle: ref.title,
      platformId: ref.platformId,
      refreshed: ref,
      original,
      originalTitle,
      outcome,
      viewDelta,
      viewDeltaRate,
      engagementDelta,
    });
  }

  const unpaired = refreshedList.length - paired;
  const avgViewDeltaRate = rateCount > 0 ? rateSum / rateCount : null;

  return {
    generatedAt: now(),
    comparisons,
    paired,
    unpaired,
    improved,
    flat,
    declined,
    totalViewDelta,
    avgViewDeltaRate,
    safeFallback: paired === 0,
    summary: `翻新效果追踪:${paired} 条已配对(提升 ${improved} / 持平 ${flat} / 下降 ${declined}),未配对 ${unpaired} 条,累计阅读${totalViewDelta >= 0 ? "提升" : "下降"} ${Math.abs(totalViewDelta)}。`,
  };
}
