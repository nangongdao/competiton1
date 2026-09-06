/**
 * v9 Phase 1 · LC-01 内容老化检测与翻新建议。
 *
 * 基于发布历史与效果数据检测「老化内容」(发布超阈值天数 / 阅读低迷 /
 * 平台表现不均),输出可执行的翻新 / 复用 / 下线建议,并给出再发布窗口。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;数据来源复用 `analytics/insights.ts` 与 `PerformanceRecord`;
 * - 阈值可配置;缺数据安全回退(不误报);
 * - 建议只做「建议」,不自动发布;生成翻新草稿为独立新草稿(见 refresh.ts);
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance } from "../analytics/insights.js";

/** 老化建议动作类型。 */
export type AgingActionKind = "refresh" | "reuse" | "retire";

/** 老化严重度。 */
export type AgingSeverity = "high" | "medium" | "low";

/** 老化内容条目。 */
export interface AgingContent {
  /** 关联内容标题。 */
  readonly title: string;
  /** 关联草稿 id(可为空:仅从效果记录检测)。 */
  readonly draftId?: string;
  /** 关联历史 id(可为空)。 */
  readonly historyId?: string;
  /** 关联平台(可为空:跨平台聚合)。 */
  readonly platformId?: string;
  /** 发布时间(ISO)。 */
  readonly publishedAt: string;
  /** 距今天数。 */
  readonly ageDays: number;
  /** 总阅读量(该内容跨平台聚合)。 */
  readonly totalViews: number;
  /** 平均阅读(有平台时该平台平均;否则跨平台)。 */
  readonly avgViews: number;
  /** 老化严重度。 */
  readonly severity: AgingSeverity;
  /** 老化原因。 */
  readonly reasons: readonly string[];
  /** 建议动作。 */
  readonly action: AgingActionKind;
  /** 建议说明。 */
  readonly suggestion: string;
  /** 再发布窗口(距今第几天到第几天,如 [30, 90] 表示 30-90 天后再发)。 */
  readonly reuseWindow: readonly [number, number] | null;
}

/** 老化检测选项。 */
export interface AgingDetectOptions {
  /** 老化阈值:发布超过该天数视为"旧"(默认 30)。 */
  readonly oldAfterDays?: number;
  /** 低迷阈值:阅读量低于同平台平均的该比例视为"低迷"(默认 0.5)。 */
  readonly lowViewRatio?: number;
  /** 是否跨平台聚合(默认 true)。 */
  readonly aggregateAcrossPlatforms?: boolean;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 老化检测结果。 */
export interface AgingDetectResult {
  readonly generatedAt: string;
  /** 老化内容列表(按严重度降序)。 */
  readonly items: readonly AgingContent[];
  /** 有老化内容的条数。 */
  readonly count: number;
  /** 是否基于足够数据(缺数据时 safeFallback=true)。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 解析 ISO 日期为 YYYY-MM-DD。 */
/** 计算两个 ISO 日期的天数差。 */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * LC-01 内容老化检测。
 *
 * 输入效果记录(可跨平台),按标题分组聚合(同标题多平台视为同一内容),
 * 检测:
 * - 发布超过 `oldAfterDays` 天;
 * - 阅读低于同平台平均的 `lowViewRatio`(平台表现低迷);
 * - 平台表现不均(某平台阅读远低于其它平台 → 该平台可翻新重发)。
 *
 * 缺数据(无记录 / 无阅读数据)时安全回退:返回空列表 + safeFallback。
 */
export function detectAgingContent(
  records: readonly PerformanceRecord[],
  options: AgingDetectOptions = {},
): AgingDetectResult {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const oldAfterDays = options.oldAfterDays ?? 30;
  const lowViewRatio = options.lowViewRatio ?? 0.5;
  const aggregate = options.aggregateAcrossPlatforms ?? true;

  if (records.length === 0) {
    return {
      generatedAt,
      items: [],
      count: 0,
      safeFallback: true,
      summary: "暂无效果数据,无法检测老化内容。请先在「效果回收」录入或导入数据。",
    };
  }

  // 计算各平台平均阅读(供低迷判断)。
  const platformViews = new Map<string, number[]>();
  for (const r of records) {
    const v = r.metrics.views;
    if (typeof v === "number" && Number.isFinite(v)) {
      const list = platformViews.get(r.platformId) ?? [];
      list.push(v);
      platformViews.set(r.platformId, list);
    }
  }
  const platformAvg = new Map<string, number>();
  for (const [pid, list] of platformViews) {
    platformAvg.set(pid, list.reduce((a, b) => a + b, 0) / list.length);
  }

  // 按标题分组(跨平台聚合时);否则按 平台+标题 分组。
  const groups = new Map<string, { records: PerformanceRecord[]; title: string; platformId?: string }>();
  for (const r of records) {
    const key = aggregate ? r.title : `${r.platformId}::${r.title}`;
    const cur = groups.get(key) ?? { records: [], title: r.title, platformId: aggregate ? undefined : r.platformId };
    cur.records.push(r);
    groups.set(key, cur);
  }

  const items: AgingContent[] = [];
  for (const group of groups.values()) {
    const recs = group.records;
    // 最新发布记录(判断发布时间)。
    const sorted = [...recs].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const latest = sorted[0]!;
    const ageDays = daysBetween(latest.publishedAt, generatedAt);
    const totalViews = recs.reduce((sum, r) => sum + (r.metrics.views ?? 0), 0);
    const avgViews = recs.length > 0 ? totalViews / recs.length : 0;

    const reasons: string[] = [];
    let severity: AgingSeverity = "low";
    let action: AgingActionKind = "reuse";
    let reuseWindow: readonly [number, number] | null = null;

    if (ageDays >= oldAfterDays) {
      reasons.push(`已发布 ${ageDays} 天(超过 ${oldAfterDays} 天阈值)`);
    }

    // 平台表现低迷:有该平台平均且该内容平均低于 avg * ratio。
    if (group.platformId) {
      const avg = platformAvg.get(group.platformId);
      if (avg !== undefined && avg > 0 && avgViews < avg * lowViewRatio) {
        reasons.push(`该平台平均阅读 ${Math.round(avg)},本篇仅 ${Math.round(avgViews)}(低于 ${Math.round(lowViewRatio * 100)}% 阈值)`);
      }
    } else {
      // 跨平台:若存在某平台阅读远低于其它平台 → 该平台可翻新重发。
      const perPlatform = new Map<string, number>();
      for (const r of recs) {
        const v = r.metrics.views ?? 0;
        perPlatform.set(r.platformId, (perPlatform.get(r.platformId) ?? 0) + v);
      }
      const values = [...perPlatform.values()];
      const maxV = Math.max(...values);
      if (maxV > 0) {
        for (const [pid, v] of perPlatform) {
          if (v < maxV * lowViewRatio && values.length > 1) {
            reasons.push(`平台 ${pid} 阅读 ${v} 远低于最佳平台 ${maxV}`);
          }
        }
      }
    }

    // 判断是否表现低迷:有参考平均且低于阈值。
    let underperforming = false;
    if (group.platformId) {
      const avg = platformAvg.get(group.platformId);
      underperforming = avg !== undefined && avg > 0 && avgViews < avg * lowViewRatio;
    } else {
      // 跨平台聚合:以全平台平均为参考。
      const allAvgs = [...platformAvg.values()];
      const overall = allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : 0;
      underperforming = overall > 0 && avgViews < overall * lowViewRatio;
    }

    // 判定严重度与动作。
    if (ageDays >= oldAfterDays && underperforming) {
      // 已旧且低迷 → 高优先建议翻新。
      severity = "high";
      action = "refresh";
      reuseWindow = [Math.max(0, oldAfterDays - 7), oldAfterDays + 30];
    } else if (ageDays >= oldAfterDays) {
      // 已旧但表现尚可 → 中优先建议翻新(保持活跃)。
      severity = "medium";
      action = "refresh";
      reuseWindow = [Math.max(0, oldAfterDays - 7), oldAfterDays + 30];
    } else if (underperforming) {
      // 新但低迷 → 中优先建议翻新。
      severity = "medium";
      action = "refresh";
      reuseWindow = null;
    } else if (reasons.length === 0) {
      // 无老化迹象,跳过。
      continue;
    } else {
      // 只有平台不均等轻量原因 → 低优先建议复用。
      severity = "low";
      action = "reuse";
      reuseWindow = [Math.max(0, oldAfterDays - 7), oldAfterDays + 30];
    }

    if (reasons.length === 0) continue;

    const suggestion =
      action === "refresh"
        ? `建议翻新重发:更新标题/摘要与时效信息,${reuseWindow ? `${reuseWindow[0]}-${reuseWindow[1]} 天后` : ""}择机再发布。`
        : action === "reuse"
          ? "建议复用:将该内容的优质片段(金句/结构/数据)复用到新文章。"
          : "建议下线:该内容长期无表现,可考虑下线或归档。";

    items.push({
      title: group.title,
      draftId: latest.historyId ? undefined : undefined,
      historyId: latest.historyId,
      platformId: group.platformId,
      publishedAt: latest.publishedAt,
      ageDays,
      totalViews,
      avgViews: Math.round(avgViews),
      severity,
      reasons: [...new Set(reasons)],
      action,
      suggestion,
      reuseWindow,
    });
  }

  // 严重度排序。
  const order: Record<AgingSeverity, number> = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    generatedAt,
    items,
    count: items.length,
    safeFallback: items.length === 0,
    summary:
      items.length > 0
        ? `检测到 ${items.length} 条老化内容(${items.filter((i) => i.action === "refresh").length} 条建议翻新)。`
        : "未检测到老化内容。",
  };
}

/** 老化动作的人类可读标签。 */
export const AGING_ACTION_LABELS: Record<AgingActionKind, string> = {
  refresh: "翻新",
  reuse: "复用",
  retire: "下线",
};

/** 老化严重度的人类可读标签。 */
export const AGING_SEVERITY_LABELS: Record<AgingSeverity, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/**
 * 辅助:计算某内容再发布窗口建议(复用 LC-01 的 reuseWindow 语义)。
 * 基于最佳发布时段学习,给出「建议再发布时段(小时)」。
 */
export function suggestedRepublishHour(records: readonly PerformanceRecord[]): { hour: number | null; note: string } {
  const insights = analyzePerformance(records);
  const bestHour = insights.insights.find((i) => i.kind === "best-time");
  if (!bestHour) return { hour: null, note: "数据不足,无法学习最佳再发布时段。" };
  // bestPostingHour 的结果在 insights 中不直接暴露小时,这里从 recommendations 中提取。
  const rec = insights.recommendations.find((r) => r.includes("时段") || r.includes("小时"));
  if (rec) return { hour: null, note: rec };
  return { hour: null, note: "已给出最佳发布时段建议,请参考驾驶舱「最佳发布时间」。" };
}
