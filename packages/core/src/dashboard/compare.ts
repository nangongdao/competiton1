/**
 * DASH-02 —— 平台对比数据派生。
 *
 * 输入:效果回收记录。
 * 输出:各平台平均阅读 / 互动率 / 综合得分,供条形对比图渲染。
 *
 * 设计约束:
 * - 纯 TS 零 DOM;
 * - 指标缺失不猜数(某指标全缺失则该项为 0,不参与平均);
 * - 无数据平台不出现。
 */
import type { PerformanceRecord } from "../analytics/types.js";

/** 单平台对比条目。 */
export interface PlatformCompareItem {
  readonly platformId: string;
  /** 记录条数。 */
  readonly count: number;
  readonly totalViews: number;
  readonly avgViews: number;
  /** 互动率 = (赞+评论+分享)/阅读(阅读为 0 时为 0)。 */
  readonly engagementRate: number;
  /** 综合得分(平均阅读 × (1+互动率),用于排序)。 */
  readonly score: number;
}

/** 平台对比结果。 */
export interface PlatformCompareResult {
  readonly items: readonly PlatformCompareItem[];
  /** 是否有数据。 */
  readonly hasData: boolean;
  /** 平均阅读最高的平台(无数据为 null)。 */
  readonly bestByViews: string | null;
  /** 互动率最高的平台(无数据为 null)。 */
  readonly bestByEngagement: string | null;
}

/** 平台展示名(集中映射,避免 UI 散落)。 */
export function platformDisplayName(platformId: string): string {
  const names: Record<string, string> = {
    wechat: "公众号",
    zhihu: "知乎",
    bilibili: "B站",
    xiaohongshu: "小红书",
    juejin: "掘金",
    csdn: "CSDN",
    cnblogs: "博客园",
  };
  return names[platformId] ?? platformId;
}

/** 跨平台对比(按平均阅读/互动率派生)。 */
export function comparePlatforms(
  records: readonly PerformanceRecord[],
): PlatformCompareResult {
  const byPlatform = new Map<
    string,
    { views: number; likes: number; comments: number; shares: number; count: number }
  >();
  for (const r of records) {
    const cur = byPlatform.get(r.platformId) ?? {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      count: 0,
    };
    cur.views += r.metrics.views ?? 0;
    cur.likes += r.metrics.likes ?? 0;
    cur.comments += r.metrics.comments ?? 0;
    cur.shares += r.metrics.shares ?? 0;
    cur.count += 1;
    byPlatform.set(r.platformId, cur);
  }

  const items = [...byPlatform.entries()]
    .map(([platformId, m]) => {
      const avgViews = m.count > 0 ? m.views / m.count : 0;
      const engagementRate = avgViews > 0 ? (m.likes + m.comments + m.shares) / m.views : 0;
      const score = avgViews * (1 + engagementRate);
      return {
        platformId,
        count: m.count,
        totalViews: m.views,
        avgViews,
        engagementRate,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const hasData = items.length > 0;
  let bestByViews: string | null = null;
  let bestByEngagement: string | null = null;
  if (hasData) {
    bestByViews = [...items].sort((a, b) => b.avgViews - a.avgViews)[0]?.platformId ?? null;
    bestByEngagement =
      [...items].sort((a, b) => b.engagementRate - a.engagementRate)[0]?.platformId ?? null;
  }
  return { items, hasData, bestByViews, bestByEngagement };
}
