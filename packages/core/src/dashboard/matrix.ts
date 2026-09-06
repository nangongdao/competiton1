/**
 * v10 Phase 1/3 · 内容矩阵与发布后运营闭环数据派生。
 *
 * - `aggregateByTag`(TAG-FILTER-01):按标签聚合效果记录 —— 篇数/总阅读/平均互动;
 * - `buildContentMatrix`(MATRIX-01):跨平台内容覆盖 + 按标签聚合表现 + 矩阵健康度;
 * - `buildPostPublishLoop`(LOOP-01):把效果记录按内容聚合出评论/互动趋势 + 「待跟进」清单。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;全部基于既有 `PerformanceRecord` 派生,不新增埋点;
 * - 缺数据安全回退;标签与 v9 `tagging/tagging.ts` 去重/归一语义一致;
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { PerformanceRecord } from "../analytics/types.js";

/** 单个标签的聚合表现。 */
export interface TagAggregate {
  readonly tag: string;
  /** 篇数(含该标签的效果记录数)。 */
  readonly count: number;
  /** 总阅读。 */
  readonly views: number;
  /** 平均互动(赞+评论+分享)。 */
  readonly avgEngagement: number;
  /** 平均阅读。 */
  readonly avgViews: number;
}

/** 按标签聚合结果。 */
export interface TagAggregateResult {
  readonly tags: readonly TagAggregate[];
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
}

/**
 * TAG-FILTER-01 按标签聚合效果记录。
 *
 * 每条效果记录先经 `tagsOf(record)` 派生标签(优先使用传入的 tag 映射,
 * 否则按标题/平台派生),再按标签聚合篇数/阅读/互动。
 */
export function aggregateByTag(
  records: readonly PerformanceRecord[],
  options: { readonly tagOf?: (r: PerformanceRecord) => readonly string[] } = {},
): TagAggregateResult {
  if (records.length === 0) return { tags: [], safeFallback: true };

  const tagOf = options.tagOf ?? defaultTagOf;
  const map = new Map<string, { count: number; views: number; engagement: number }>();
  for (const r of records) {
    const tags = tagOf(r);
    for (const t of tags) {
      if (!t) continue;
      const cur = map.get(t) ?? { count: 0, views: 0, engagement: 0 };
      cur.count += 1;
      cur.views += r.metrics.views ?? 0;
      cur.engagement += (r.metrics.likes ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0);
      map.set(t, cur);
    }
  }

  const tags = [...map.entries()]
    .map(([tag, v]) => ({
      tag,
      count: v.count,
      views: v.views,
      avgEngagement: v.count > 0 ? Math.round(v.engagement / v.count) : 0,
      avgViews: v.count > 0 ? Math.round(v.views / v.count) : 0,
    }))
    .sort((a, b) => b.views - a.views || b.count - a.count);

  return { tags, safeFallback: tags.length === 0 };
}

/** 默认标签派生:优先标题关键词,平台名兜底。 */
function defaultTagOf(r: PerformanceRecord): string[] {
  const fromTitle = r.title
    .split(/[\s，。！？、；：""''（）《》【】,.!?;:()"'\-—\n]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 12);
  const tags = new Set<string>(fromTitle);
  if (tags.size === 0) tags.add(r.platformId);
  return [...tags].slice(0, 6);
}

/** 矩阵健康度。 */
export type MatrixHealth = "balanced" | "skewed" | "gaps";

/** 内容矩阵结果。 */
export interface ContentMatrix {
  /** 各平台覆盖(发布的平台数)。 */
  readonly platformCoverage: readonly { platformId: string; count: number; views: number }[];
  /** 按标签聚合表现。 */
  readonly byTag: readonly TagAggregate[];
  /** 矩阵健康度。 */
  readonly health: MatrixHealth;
  /** 健康度说明。 */
  readonly healthNote: string;
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/**
 * MATRIX-01 内容矩阵数据看板。
 *
 * - 平台覆盖:各平台发布篇数 + 总阅读;
 * - 标签聚合:复用 `aggregateByTag`;
 * - 健康度:单平台占比 >80% → skewed(偏科);有平台 0 篇且有 ≥2 平台 → gaps(空窗);
 *   否则 balanced(均衡)。
 */
export function buildContentMatrix(
  records: readonly PerformanceRecord[],
  options: { readonly tagOf?: (r: PerformanceRecord) => readonly string[] } = {},
): ContentMatrix {
  if (records.length === 0) {
    return {
      platformCoverage: [],
      byTag: [],
      health: "gaps",
      healthNote: "暂无效果数据,无法构建内容矩阵。请先在「效果回收」录入或导入数据。",
      safeFallback: true,
      summary: "暂无效果数据,无法构建内容矩阵。",
    };
  }

  // 平台覆盖。
  const platformMap = new Map<string, { count: number; views: number }>();
  for (const r of records) {
    const cur = platformMap.get(r.platformId) ?? { count: 0, views: 0 };
    cur.count += 1;
    cur.views += r.metrics.views ?? 0;
    platformMap.set(r.platformId, cur);
  }
  const platformCoverage = [...platformMap.entries()]
    .map(([platformId, v]) => ({ platformId, count: v.count, views: v.views }))
    .sort((a, b) => b.views - a.views);

  const byTag = aggregateByTag(records, options).tags;

  // 健康度:仅 1 平台 → gaps(空窗);单平台占比 >80% → skewed(偏科);否则 balanced。
  const total = records.length;
  const maxShare = Math.max(...platformCoverage.map((p) => p.count)) / total;
  let health: MatrixHealth;
  let healthNote: string;
  if (platformCoverage.length < 2) {
    health = "gaps";
    healthNote = `仅覆盖 ${platformCoverage[0]?.platformId ?? "1 个"} 平台,存在空窗,建议拓展更多发布平台。`;
  } else if (maxShare >= 0.8) {
    health = "skewed";
    const dominant = platformCoverage.find((p) => p.count / total >= 0.8);
    healthNote = `发布过于集中在 ${dominant?.platformId ?? "单一平台"}(${Math.round(maxShare * 100)}%),建议拓展其它平台。`;
  } else {
    health = "balanced";
    healthNote = `覆盖 ${platformCoverage.length} 个平台,分布均衡。`;
  }

  return {
    platformCoverage,
    byTag,
    health,
    healthNote,
    safeFallback: false,
    summary: `内容矩阵:覆盖 ${platformCoverage.length} 个平台 / ${total} 篇内容 / ${byTag.length} 个标签维度,健康度「${health === "balanced" ? "均衡" : health === "skewed" ? "偏科" : "空窗"}」。`,
  };
}

/** 发布后运营：待跟进类型。 */
export type FollowUpKind = "low-engagement" | "high-engagement" | "data-gap";

/** 待跟进条目。 */
export interface FollowUpItem {
  readonly kind: FollowUpKind;
  readonly title: string;
  readonly platformId: string;
  readonly publishedAt: string;
  readonly views: number;
  readonly engagement: number;
  /** 一句话说明。 */
  readonly note: string;
}

/** 发布后运营视图。 */
export interface PostPublishLoop {
  /** 评论/互动趋势(按日聚合)。 */
  readonly engagementTrend: readonly { date: string; engagement: number; views: number }[];
  /** 待跟进清单。 */
  readonly followUps: readonly FollowUpItem[];
  /** 数据缺口提示。 */
  readonly dataGapNote: string | null;
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 互动数(赞+评论+分享)。 */
function engagementOf(r: PerformanceRecord): number {
  return (r.metrics.likes ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0);
}

/**
 * LOOP-01 发布后运营视图。
 *
 * - 趋势:按 `collectedAt` 日期聚合阅读/互动;
 * - 待跟进:高互动(互动 ≥ 平均 2 倍)提醒回复;低互动(阅读>0 且互动=0)提醒复盘;
 *   数据缺口(metrics 全空)引导录入;
 * - 全部基于效果记录派生,不新增埋点。
 */
export function buildPostPublishLoop(
  records: readonly PerformanceRecord[],
  options: { readonly highEngagementRatio?: number } = {},
): PostPublishLoop {
  const highRatio = options.highEngagementRatio ?? 2;

  if (records.length === 0) {
    return {
      engagementTrend: [],
      followUps: [],
      dataGapNote: "暂无效果数据,请先在「效果回收」录入或导入发布效果。",
      safeFallback: true,
      summary: "暂无效果数据,无法生成发布后运营视图。",
    };
  }

  // 按日期聚合趋势。
  const trendMap = new Map<string, { engagement: number; views: number }>();
  for (const r of records) {
    const date = r.collectedAt.slice(0, 10);
    const cur = trendMap.get(date) ?? { engagement: 0, views: 0 };
    cur.engagement += engagementOf(r);
    cur.views += r.metrics.views ?? 0;
    trendMap.set(date, cur);
  }
  const engagementTrend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, engagement: v.engagement, views: v.views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 平均互动(作高互动阈值)。
  const totalEngagement = records.reduce((s, r) => s + engagementOf(r), 0);
  const avgEngagement = totalEngagement / records.length;

  const followUps: FollowUpItem[] = [];
  for (const r of records) {
    const eng = engagementOf(r);
    const views = r.metrics.views ?? 0;
    const hasAnyMetric =
      r.metrics.views !== undefined ||
      r.metrics.likes !== undefined ||
      r.metrics.comments !== undefined ||
      r.metrics.shares !== undefined ||
      r.metrics.favorites !== undefined ||
      r.metrics.followerDelta !== undefined;

    if (!hasAnyMetric) {
      followUps.push({
        kind: "data-gap",
        title: r.title,
        platformId: r.platformId,
        publishedAt: r.publishedAt,
        views: 0,
        engagement: 0,
        note: "该内容暂无效果数据,建议去「效果回收」录入或导入。",
      });
      continue;
    }

    if (avgEngagement > 0 && eng >= avgEngagement * highRatio) {
      followUps.push({
        kind: "high-engagement",
        title: r.title,
        platformId: r.platformId,
        publishedAt: r.publishedAt,
        views,
        engagement: eng,
        note: `互动突出(互动 ${eng},高于平均 ${Math.round(avgEngagement)}),建议及时回复互动。`,
      });
      continue;
    }

    if (views > 0 && eng === 0) {
      followUps.push({
        kind: "low-engagement",
        title: r.title,
        platformId: r.platformId,
        publishedAt: r.publishedAt,
        views,
        engagement: 0,
        note: `有 ${views} 阅读但 0 互动,建议复盘标题/引导或翻新重发。`,
      });
    }
  }

  // 数据缺口提示。
  const gapCount = followUps.filter((f) => f.kind === "data-gap").length;
  const dataGapNote = gapCount > 0 ? `${gapCount} 条内容缺少效果数据,建议去「效果回收」补录。` : null;

  return {
    engagementTrend,
    followUps: followUps.slice(0, 20),
    dataGapNote,
    safeFallback: false,
    summary: `发布后运营:${records.length} 条效果记录,${followUps.length} 条待跟进(${gapCount} 条数据缺口)。`,
  };
}
