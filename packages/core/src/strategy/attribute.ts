/**
 * v11 Phase 2 · ATTRIBUTE-01 效果归因分析。
 *
 * 从效果记录与内容特征派生**差异归因**(平台 / 时段 / 标题风格 / 标签维度),
 * 输出可解释的「高表现原因」与「低表现原因」,供策略建议引用。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;归因只做「相关特征」不做因果断言;
 * - 维度可配置;带样本量与数据缺口标注;
 * - 缺数据安全回退(不误报);
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { deriveRuleTags } from "../tagging/tagging.js";

/** 归因维度。 */
export type AttributeDimension = "platform" | "hour" | "title-style" | "tag";

/** 单维度贡献。 */
export interface DimensionFactor {
  readonly dimension: AttributeDimension;
  /** 维度名(人类可读)。 */
  readonly label: string;
  /** 高表现特征(如平台名 / 时段 / 标题风格 / 标签)。 */
  readonly highFeature: string;
  /** 高表现样本量。 */
  readonly highCount: number;
  /** 高表现平均阅读。 */
  readonly highAvgViews: number;
  /** 低表现特征。 */
  readonly lowFeature: string;
  /** 低表现样本量。 */
  readonly lowCount: number;
  /** 低表现平均阅读。 */
  readonly lowAvgViews: number;
  /** 差异倍数(高/低;低为 0 时为 null)。 */
  readonly ratio: number | null;
  /** 一句话归因。 */
  readonly note: string;
}

/** 归因结果。 */
export interface AttributeResult {
  readonly generatedAt: string;
  /** 各维度贡献(按差异倍数降序)。 */
  readonly factors: readonly DimensionFactor[];
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 归因选项。 */
export interface AttributeOptions {
  /** 启用维度(默认全开)。 */
  readonly dimensions?: readonly AttributeDimension[];
  /** 高/低表现分组阈值:按阅读量中位数分割(默认 0.5)。 */
  readonly splitRatio?: number;
  /** 时段分桶(小时,默认 [0,6,12,18] 即 0-5 / 6-11 / 12-17 / 18-23)。 */
  readonly hourBuckets?: readonly number[];
  /** 标题风格分类(长度区间)。 */
  readonly titleStyleBuckets?: readonly { name: string; min: number; max: number }[];
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 默认标题风格分类(按字素簇长度)。 */
const DEFAULT_TITLE_STYLES: readonly { name: string; min: number; max: number }[] = [
  { name: "短标题(≤10 字)", min: 0, max: 10 },
  { name: "中标题(11-20 字)", min: 11, max: 20 },
  { name: "长标题(>20 字)", min: 21, max: Infinity },
];

/** 互动数(赞+评论+分享)。 */
function engagementOf(r: PerformanceRecord): number {
  return (r.metrics.likes ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0);
}

/** 计算一组记录的平均阅读与互动率。 */
function statsOf(list: readonly PerformanceRecord[]): { avgViews: number; avgEngagement: number } {
  if (list.length === 0) return { avgViews: 0, avgEngagement: 0 };
  const views = list.reduce((s, r) => s + (r.metrics.views ?? 0), 0);
  const eng = list.reduce((s, r) => s + engagementOf(r), 0);
  return { avgViews: views / list.length, avgEngagement: eng / list.length };
}

/** 时段桶名。 */
function hourBucketName(hour: number, buckets: readonly number[]): string {
  let name = `${buckets[0]}-${buckets[1] - 1}:00`;
  for (let i = 0; i < buckets.length; i++) {
    const start = buckets[i]!;
    const end = i + 1 < buckets.length ? buckets[i + 1]! - 1 : 23;
    if (hour >= start && hour <= end) {
      name = `${start}-${end}:00`;
      break;
    }
  }
  return name;
}

/** 标题风格名。 */
function titleStyleName(title: string, buckets: readonly { name: string; min: number; max: number }[]): string {
  const len = [...title].length;
  for (const b of buckets) {
    if (len >= b.min && len <= b.max) return b.name;
  }
  return "其他";
}

/** 按特征分组统计平均阅读,返回最佳与最差特征。 */
function bestWorstByFeature(
  records: readonly PerformanceRecord[],
  featureOf: (r: PerformanceRecord) => string,
): { best: string; worst: string; bestStats: { avgViews: number; count: number }; worstStats: { avgViews: number; count: number } } | null {
  const byFeature = new Map<string, PerformanceRecord[]>();
  for (const r of records) {
    const f = featureOf(r);
    if (!f) continue;
    const arr = byFeature.get(f) ?? [];
    arr.push(r);
    byFeature.set(f, arr);
  }
  if (byFeature.size < 2) return null;

  let best = "";
  let worst = "";
  let bestAvg = -1;
  let worstAvg = Infinity;
  for (const [feature, list] of byFeature) {
    const { avgViews } = statsOf(list);
    if (avgViews > bestAvg) {
      bestAvg = avgViews;
      best = feature;
    }
    if (avgViews < worstAvg) {
      worstAvg = avgViews;
      worst = feature;
    }
  }
  if (!best || !worst || best === worst) return null;
  const bestStats = { avgViews: bestAvg, count: byFeature.get(best)!.length };
  const worstStats = { avgViews: worstAvg, count: byFeature.get(worst)!.length };
  return { best, worst, bestStats, worstStats };
}

/**
 * ATTRIBUTE-01 效果归因分析。
 *
 * 对每个启用维度,把记录按特征分组,找出平均阅读最高/最低的特征,
 * 输出差异倍数与可读归因。缺数据(记录过少 / 维度无法分组)安全回退。
 */
export function attributePerformance(
  records: readonly PerformanceRecord[],
  options: AttributeOptions = {},
): AttributeResult {
  const now = options.now ?? (() => new Date().toISOString());
  const dimensions = options.dimensions ?? ["platform", "hour", "title-style", "tag"];
  const hourBuckets = options.hourBuckets ?? [0, 6, 12, 18];
  const titleStyles = options.titleStyleBuckets ?? DEFAULT_TITLE_STYLES;

  if (records.length < 2) {
    return {
      generatedAt: now(),
      factors: [],
      safeFallback: true,
      summary: "效果数据不足,无法进行归因分析。请先录入或导入更多效果记录。",
    };
  }

  const factors: DimensionFactor[] = [];

  // 平台维度。
  if (dimensions.includes("platform")) {
    const bw = bestWorstByFeature(records, (r) => r.platformId);
    if (bw) {
      const ratio = bw.worstStats.avgViews > 0 ? bw.bestStats.avgViews / bw.worstStats.avgViews : null;
      factors.push({
        dimension: "platform",
        label: "平台",
        highFeature: bw.best,
        highCount: bw.bestStats.count,
        highAvgViews: Math.round(bw.bestStats.avgViews),
        lowFeature: bw.worst,
        lowCount: bw.worstStats.count,
        lowAvgViews: Math.round(bw.worstStats.avgViews),
        ratio,
        note: `${bw.best} 平均阅读(${Math.round(bw.bestStats.avgViews)})${ratio !== null ? `是 ${bw.worst} 的 ${ratio.toFixed(1)} 倍` : "高于 " + bw.worst}。`,
      });
    }
  }

  // 时段维度。
  if (dimensions.includes("hour")) {
    const bw = bestWorstByFeature(records, (r) => {
      const ts = Date.parse(r.publishedAt ?? r.collectedAt);
      if (!Number.isFinite(ts)) return "";
      return hourBucketName(new Date(ts).getUTCHours(), hourBuckets);
    });
    if (bw) {
      const ratio = bw.worstStats.avgViews > 0 ? bw.bestStats.avgViews / bw.worstStats.avgViews : null;
      factors.push({
        dimension: "hour",
        label: "发布时段",
        highFeature: bw.best,
        highCount: bw.bestStats.count,
        highAvgViews: Math.round(bw.bestStats.avgViews),
        lowFeature: bw.worst,
        lowCount: bw.worstStats.count,
        lowAvgViews: Math.round(bw.worstStats.avgViews),
        ratio,
        note: `${bw.best} 发布平均阅读(${Math.round(bw.bestStats.avgViews)})${ratio !== null ? `是 ${bw.worst} 的 ${ratio.toFixed(1)} 倍` : "高于 " + bw.worst}。`,
      });
    }
  }

  // 标题风格维度。
  if (dimensions.includes("title-style")) {
    const bw = bestWorstByFeature(records, (r) => titleStyleName(r.title, titleStyles));
    if (bw) {
      const ratio = bw.worstStats.avgViews > 0 ? bw.bestStats.avgViews / bw.worstStats.avgViews : null;
      factors.push({
        dimension: "title-style",
        label: "标题风格",
        highFeature: bw.best,
        highCount: bw.bestStats.count,
        highAvgViews: Math.round(bw.bestStats.avgViews),
        lowFeature: bw.worst,
        lowCount: bw.worstStats.count,
        lowAvgViews: Math.round(bw.worstStats.avgViews),
        ratio,
        note: `${bw.best} 平均阅读(${Math.round(bw.bestStats.avgViews)})${ratio !== null ? `是 ${bw.worst} 的 ${ratio.toFixed(1)} 倍` : "高于 " + bw.worst}。`,
      });
    }
  }

  // 标签维度。
  if (dimensions.includes("tag")) {
    const bw = bestWorstByFeature(records, (r) => {
      const tags = deriveRuleTags({ title: r.title });
      return tags[0] ?? "";
    });
    if (bw) {
      const ratio = bw.worstStats.avgViews > 0 ? bw.bestStats.avgViews / bw.worstStats.avgViews : null;
      factors.push({
        dimension: "tag",
        label: "内容主题",
        highFeature: bw.best,
        highCount: bw.bestStats.count,
        highAvgViews: Math.round(bw.bestStats.avgViews),
        lowFeature: bw.worst,
        lowCount: bw.worstStats.count,
        lowAvgViews: Math.round(bw.worstStats.avgViews),
        ratio,
        note: `主题「${bw.best}」平均阅读(${Math.round(bw.bestStats.avgViews)})${ratio !== null ? `是「${bw.worst}」的 ${ratio.toFixed(1)} 倍` : "高于「" + bw.worst + "」"}。`,
      });
    }
  }

  factors.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

  if (factors.length === 0) {
    return {
      generatedAt: now(),
      factors: [],
      safeFallback: true,
      summary: "效果数据维度不足,无法进行归因分析。",
    };
  }

  const top = factors[0]!;
  return {
    generatedAt: now(),
    factors,
    safeFallback: false,
    summary: `效果归因:最大差异来自「${top.label}」—— ${top.highFeature} 平均阅读 ${top.highAvgViews} vs ${top.lowFeature} ${top.lowAvgViews}${top.ratio !== null ? `(${top.ratio.toFixed(1)}x)` : ""}。`,
  };
}
