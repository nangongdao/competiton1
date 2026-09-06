/**
 * 发布效果智能分析 —— 在 DATA-02/03 回收的数据之上做趋势、增长、跨平台对比与推荐。
 *
 * 输入:`PerformanceRecord[]`(手工录入 / CSV 导入 / 官方 API 同步)。
 * 输出:
 * - `trends`:每平台按日的阅读趋势(近 N 天窗口);
 * - `growth`:每平台近期 vs 上一周期增长率;
 * - `ranking`:跨平台综合表现排序(按互动率/平均阅读);
 * - `recommendations`:可执行的行动建议(重点平台、最佳发布时段、内容模式);
 * - `insights`:人类可读的洞察条目(带严重度,供 UI 展示)。
 *
 * 设计约束(与项目一致):
 * - 纯 TS 零 DOM;不依赖真实网络;
 * - 指标缺失不猜数(空指标不计入相应统计);
 * - 本地计算,不上传任何数据。
 */
import type { PerformanceRecord } from "./types.js";

/** 单平台按日汇总的一条。 */
export interface DailyMetricPoint {
  /** 日期(YYYY-MM-DD)。 */
  readonly day: string;
  readonly views: number;
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
  /** 当日记录条数。 */
  readonly count: number;
}

/** 单平台趋势。 */
export interface PlatformTrend {
  readonly platformId: string;
  /** 按日阅读量序列(升序)。 */
  readonly dailyViews: readonly DailyMetricPoint[];
  /** 窗口内总阅读。 */
  readonly totalViews: number;
  /** 窗口内总互动(赞+评论+分享)。 */
  readonly totalEngagement: number;
}

/** 增长率(近期 vs 上一周期;分母为 0 时返回 null)。 */
export interface GrowthRate {
  readonly platformId: string;
  /** 近期窗口阅读数。 */
  readonly recentViews: number;
  /** 上一周期阅读数。 */
  readonly previousViews: number;
  /** 增长率(如 0.25 = +25%);缺数据时为 null。 */
  readonly rate: number | null;
}

/** 平台综合表现(跨平台对比)。 */
export interface PlatformRanking {
  readonly platformId: string;
  readonly count: number;
  readonly totalViews: number;
  readonly avgViews: number;
  /** 互动率 = (赞+评论+分享) / 阅读(阅读为 0 时为 0)。 */
  readonly engagementRate: number;
  /** 综合得分(平均阅读 × 互动率,用于排序)。 */
  readonly score: number;
}

/** 洞察条目。 */
export interface InsightItem {
  readonly kind:
    | "best-platform"
    | "growth"
    | "decline"
    | "best-time"
    | "content-pattern"
    | "data-gap"
    | "no-data";
  readonly severity: "info" | "positive" | "warning";
  readonly title: string;
  readonly detail: string;
}

/** 分析结果汇总。 */
export interface PerformanceInsights {
  readonly generatedAt: string;
  readonly trends: readonly PlatformTrend[];
  readonly growth: readonly GrowthRate[];
  readonly ranking: readonly PlatformRanking[];
  readonly recommendations: readonly string[];
  readonly insights: readonly InsightItem[];
}

export interface AnalyzeOptions {
  /** 近期窗口天数(默认 7)。 */
  readonly recentDays?: number;
  /** 趋势序列长度上限(默认 30)。 */
  readonly maxTrendPoints?: number;
  readonly now?: () => string;
}

/** 按日聚合阅读量(升序,最多 maxPoints 个点)。 */
export function buildDailyTrend(
  records: readonly PerformanceRecord[],
  maxPoints = 30,
): readonly DailyMetricPoint[] {
  const byDay = new Map<string, { views: number; likes: number; comments: number; shares: number; count: number }>();
  for (const r of records) {
    const day = r.collectedAt.slice(0, 10);
    const cur = byDay.get(day) ?? { views: 0, likes: 0, comments: 0, shares: 0, count: 0 };
    cur.views += r.metrics.views ?? 0;
    cur.likes += r.metrics.likes ?? 0;
    cur.comments += r.metrics.comments ?? 0;
    cur.shares += r.metrics.shares ?? 0;
    cur.count += 1;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxPoints)
    .map(([day, m]) => ({ day, ...m }));
}

/** 计算近期 vs 上一周期的阅读增长率。 */
export function computeGrowth(
  records: readonly PerformanceRecord[],
  recentDays = 7,
  now: () => string = () => new Date().toISOString(),
): readonly GrowthRate[] {
  const nowMs = Date.parse(now());
  const recentStart = nowMs - recentDays * 24 * 60 * 60 * 1000;
  const prevStart = nowMs - 2 * recentDays * 24 * 60 * 60 * 1000;

  const byPlatform = new Map<string, { recent: number; previous: number }>();
  for (const r of records) {
    const ts = Date.parse(r.collectedAt);
    if (!Number.isFinite(ts)) continue;
    const entry = byPlatform.get(r.platformId) ?? { recent: 0, previous: 0 };
    if (ts >= recentStart) entry.recent += r.metrics.views ?? 0;
    else if (ts >= prevStart) entry.previous += r.metrics.views ?? 0;
    byPlatform.set(r.platformId, entry);
  }

  return [...byPlatform.entries()]
    .map(([platformId, v]) => ({
      platformId,
      recentViews: v.recent,
      previousViews: v.previous,
      rate: v.previous > 0 ? (v.recent - v.previous) / v.previous : null,
    }))
    .sort((a, b) => b.recentViews - a.recentViews);
}

/** 跨平台综合表现排序。 */
export function rankPlatforms(records: readonly PerformanceRecord[]): readonly PlatformRanking[] {
  const byPlatform = new Map<string, PerformanceRecord[]>();
  for (const r of records) {
    const arr = byPlatform.get(r.platformId) ?? [];
    arr.push(r);
    byPlatform.set(r.platformId, arr);
  }

  return [...byPlatform.entries()]
    .map(([platformId, list]) => {
      const totalViews = list.reduce((s, r) => s + (r.metrics.views ?? 0), 0);
      const totalEngagement = list.reduce(
        (s, r) => s + (r.metrics.likes ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0),
        0,
      );
      const avgViews = list.length > 0 ? totalViews / list.length : 0;
      const engagementRate = totalViews > 0 ? totalEngagement / totalViews : 0;
      return {
        platformId,
        count: list.length,
        totalViews,
        avgViews,
        engagementRate,
        // 综合得分:平均阅读 × 互动率(缺阅读数据时得分低)。
        score: avgViews * (1 + engagementRate),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** 最佳发布时段分析:按小时聚合阅读(取整点到整点)。 */
export interface BestHourBucket {
  readonly hour: number;
  readonly views: number;
  readonly count: number;
}

export function bestPostingHour(records: readonly PerformanceRecord[]): BestHourBucket | null {
  const byHour = new Map<number, { views: number; count: number }>();
  for (const r of records) {
    const ts = Date.parse(r.publishedAt ?? r.collectedAt);
    if (!Number.isFinite(ts)) continue;
    // 统一用 UTC 小时(记录为 ISO UTC),避免受运行环境时区影响。
    const hour = new Date(ts).getUTCHours();
    const cur = byHour.get(hour) ?? { views: 0, count: 0 };
    cur.views += r.metrics.views ?? 0;
    cur.count += 1;
    byHour.set(hour, cur);
  }
  if (byHour.size === 0) return null;
  let best: BestHourBucket | null = null;
  for (const [hour, v] of byHour) {
    if (!best || v.views > best.views) best = { hour, views: v.views, count: v.count };
  }
  return best;
}

/** 表现最好的一篇(按阅读量)。 */
export function bestPerformingPost(records: readonly PerformanceRecord[]): PerformanceRecord | null {
  let best: PerformanceRecord | null = null;
  for (const r of records) {
    const views = r.metrics.views ?? 0;
    if (!best || views > (best.metrics.views ?? 0)) best = r;
  }
  return best;
}

/** 综合智能分析入口。 */
export function analyzePerformance(
  records: readonly PerformanceRecord[],
  options: AnalyzeOptions = {},
): PerformanceInsights {
  const now = options.now ?? (() => new Date().toISOString());
  const recentDays = options.recentDays ?? 7;
  const maxTrendPoints = options.maxTrendPoints ?? 30;
  const generatedAt = now();

  if (records.length === 0) {
    return {
      generatedAt,
      trends: [],
      growth: [],
      ranking: [],
      recommendations: ["还没有效果数据。请先录入/导入效果记录,或从官方 API 同步指标后再分析。"],
      insights: [
        {
          kind: "no-data",
          severity: "info",
          title: "暂无效果数据",
          detail: "回收至少一条效果记录后,这里会自动生成趋势、增长与平台对比洞察。",
        },
      ],
    };
  }

  // 按平台分组。
  const byPlatform = new Map<string, PerformanceRecord[]>();
  for (const r of records) {
    const arr = byPlatform.get(r.platformId) ?? [];
    arr.push(r);
    byPlatform.set(r.platformId, arr);
  }

  const trends: PlatformTrend[] = [];
  for (const [platformId, list] of byPlatform) {
    const dailyViews = buildDailyTrend(list, maxTrendPoints);
    trends.push({
      platformId,
      dailyViews,
      totalViews: dailyViews.reduce((s, d) => s + d.views, 0),
      totalEngagement: dailyViews.reduce((s, d) => s + d.likes + d.comments + d.shares, 0),
    });
  }
  trends.sort((a, b) => b.totalViews - a.totalViews);

  const growth = computeGrowth(records, recentDays, now);
  const ranking = rankPlatforms(records);
  const bestHour = bestPostingHour(records);
  const bestPost = bestPerformingPost(records);

  const insights: InsightItem[] = [];
  const recommendations: string[] = [];

  // 最佳平台洞察。
  if (ranking.length > 0) {
    const best = ranking[0]!;
    insights.push({
      kind: "best-platform",
      severity: "positive",
      title: `最佳平台:${best.platformId}`,
      detail: `综合得分 ${best.score.toFixed(1)}(平均阅读 ${Math.round(best.avgViews)} × 互动率 ${(best.engagementRate * 100).toFixed(1)}%),共 ${best.count} 篇。`,
    });
    recommendations.push(`优先在 ${best.platformId} 发布高价值内容:该平台当前互动表现最好。`);
  }

  // 增长/下滑洞察。
  for (const g of growth) {
    if (g.rate === null) continue;
    if (g.rate > 0.2) {
      insights.push({
        kind: "growth",
        severity: "positive",
        title: `${g.platformId} 阅读量上升`,
        detail: `近 ${recentDays} 天阅读 ${g.recentViews}(较上一周期 +${(g.rate * 100).toFixed(0)}%)。`,
      });
      recommendations.push(`加大 ${g.platformId} 的发布频率:近期增长 ${(g.rate * 100).toFixed(0)}%。`);
    } else if (g.rate < -0.2) {
      insights.push({
        kind: "decline",
        severity: "warning",
        title: `${g.platformId} 阅读量下滑`,
        detail: `近 ${recentDays} 天阅读 ${g.recentViews}(较上一周期 ${(g.rate * 100).toFixed(0)}%)。`,
      });
      recommendations.push(`复盘 ${g.platformId} 近期内容:阅读下滑 ${(g.rate * 100).toFixed(0)}%,建议调整选题或发布时间。`);
    }
  }

  // 最佳时段洞察。
  if (bestHour) {
    insights.push({
      kind: "best-time",
      severity: "info",
      title: `最佳发布时段:${bestHour.hour}:00 前后`,
      detail: `历史 ${bestHour.count} 条记录在该时段获得最多阅读(${bestHour.views})。`,
    });
    recommendations.push(`优先在 ${bestHour.hour}:00 前后发布,历史数据表现最好。`);
  }

  // 内容模式洞察(最佳单篇标题)。
  if (bestPost && (bestPost.metrics.views ?? 0) > 0) {
    insights.push({
      kind: "content-pattern",
      severity: "info",
      title: `最受欢迎内容:《${bestPost.title}》`,
      detail: `在 ${bestPost.platformId} 获得 ${bestPost.metrics.views} 阅读,可作为选题参考。`,
    });
  }

  // 数据缺口提醒。
  const noRemoteId = records.filter((r) => !r.remoteId);
  if (noRemoteId.length > 0 && noRemoteId.length === records.length) {
    insights.push({
      kind: "data-gap",
      severity: "warning",
      title: "缺少远端 ID",
      detail: "全部记录都没有 remoteId,无法从官方 API 增量同步最新指标。建议为发布任务补充远端文章 ID。",
    });
    recommendations.push("为发布记录补充 remoteId,即可启用官方 API 自动同步最新指标。");
  }

  return { generatedAt, trends, growth, ranking, recommendations, insights };
}
