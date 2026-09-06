/**
 * DASH-03 —— 内容排行数据派生。
 *
 * 输入:效果回收记录。
 * 输出:按阅读/互动综合得分排序的 Top N 内容,供排行列表渲染。
 *
 * 设计约束:
 * - 纯 TS 零 DOM;
 * - 同名标题按发布平台/时间区分(不合并);
 * - 缺阅读数据的内容按互动参与排序,全缺则按时间新到旧。
 */
import type { PerformanceRecord } from "../analytics/types.js";

/** 单条内容排行条目。 */
export interface ContentRankItem {
  readonly id: string;
  readonly title: string;
  readonly platformId: string;
  readonly remoteUrl?: string;
  readonly publishedAt: string;
  readonly views: number;
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
  /** 互动数(赞+评论+分享)。 */
  readonly engagement: number;
  /** 综合得分(阅读 + 互动×10,用于排序)。 */
  readonly score: number;
}

/** 内容排行结果。 */
export interface ContentRankResult {
  readonly items: readonly ContentRankItem[];
  readonly hasData: boolean;
}

/** 内容排行(Top N,按综合得分降序)。 */
export function rankContent(
  records: readonly PerformanceRecord[],
  limit = 10,
): ContentRankResult {
  const items = records
    .map((r) => {
      const views = r.metrics.views ?? 0;
      const likes = r.metrics.likes ?? 0;
      const comments = r.metrics.comments ?? 0;
      const shares = r.metrics.shares ?? 0;
      const engagement = likes + comments + shares;
      const score = views + engagement * 10;
      return {
        id: r.id,
        title: r.title,
        platformId: r.platformId,
        remoteUrl: r.remoteUrl,
        publishedAt: r.publishedAt,
        views,
        likes,
        comments,
        shares,
        engagement,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, Math.max(0, limit));

  return { items, hasData: items.length > 0 };
}
