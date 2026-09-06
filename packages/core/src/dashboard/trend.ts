/**
 * DASH-01 —— 效果趋势图数据派生。
 *
 * 输入:效果回收记录(手工录入 / CSV 导入 / 官方 API 同步)。
 * 输出:按日聚合的阅读/互动趋势序列,供 SVG 折线图渲染。
 *
 * 设计约束(与项目一致):
 * - 纯 TS 零 DOM;不依赖真实网络;
 * - 指标缺失不猜数(空指标按 0 聚合,但空数据给出友好空态);
 * - 本地计算,不上传任何数据。
 */
import type { PerformanceRecord } from "../analytics/types.js";

/** 趋势序列中的单个数据点。 */
export interface TrendPoint {
  /** 日期(YYYY-MM-DD)。 */
  readonly day: string;
  readonly views: number;
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
  /** 当日记录条数。 */
  readonly count: number;
}

/** 整体趋势结果。 */
export interface TrendSeries {
  /** 数据点(升序,按日)。 */
  readonly points: readonly TrendPoint[];
  /** 窗口内总阅读。 */
  readonly totalViews: number;
  /** 窗口内总互动(赞+评论+分享)。 */
  readonly totalEngagement: number;
  /** 峰值日。 */
  readonly peakDay: string | null;
  /** 峰值阅读。 */
  readonly peakViews: number;
}

/** 构建按日趋势序列(升序,最多 maxPoints 个点)。 */
export function buildTrendSeries(
  records: readonly PerformanceRecord[],
  maxPoints = 30,
): TrendSeries {
  const byDay = new Map<
    string,
    { views: number; likes: number; comments: number; shares: number; count: number }
  >();
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
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxPoints)
    .map(([day, m]) => ({ day, ...m }));

  let totalViews = 0;
  let totalEngagement = 0;
  let peakDay: string | null = null;
  let peakViews = 0;
  for (const p of points) {
    totalViews += p.views;
    totalEngagement += p.likes + p.comments + p.shares;
    if (p.views > peakViews) {
      peakViews = p.views;
      peakDay = p.day;
    }
  }
  return { points, totalViews, totalEngagement, peakDay, peakViews };
}
