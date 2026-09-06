/**
 * 发布队列/批次 × 效果预测 · 内容矩阵联动（v10 深化）。
 *
 * 把 v9 效果预测（`forecastPerformance`）、v10 内容矩阵（`buildContentMatrix`）与
 * 发布后运营待跟进清单（`buildPostPublishLoop`）下沉为**排队场景可复用的纯函数**：
 *
 * 1. `forecastForQueue` —— 为「待排队内容」生成**预测展示载荷**（各平台预期阅读区间 +
 *    置信度 + 推荐平台 + 最佳时段 + 决策建议），供发布队列/批次表单的「预期效果」区块展示；
 * 2. `matrixQueuePlatformSuggestions` —— 基于内容矩阵（跨平台历史表现 + 健康度）派生
 *    **批量目标平台建议**（补空窗 / 强化最佳 / 均衡组合），供发布队列批量目标平台预选；
 * 3. `buildFollowUpReminderDigest` —— 把待跟进清单转成**提醒摘要**（按严重度排序 +
 *    待跟进计数 + 行动建议），供「待跟进清单接入通知/提醒」复用 NOTIFY 能力。
 *
 * 设计原则（与项目一致）：
 * - 纯 TS 零 DOM；全部基于既有效果记录派生，不新增埋点；
 * - 缺数据安全回退；建议不越界（推荐平台只取传入集合交集）；
 * - 脱敏：不含 remoteUrl / remoteId / token 等敏感字段。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { forecastPerformance, type ForecastResult, type PlatformForecast } from "../forecast/forecast.js";
import { buildPublishDecision, type PublishDecision } from "../forecast/decision.js";
import { buildContentMatrix, type ContentMatrix } from "../dashboard/matrix.js";
import { buildPostPublishLoop, type FollowUpItem, type PostPublishLoop } from "../dashboard/matrix.js";
import { rankPlatforms } from "../analytics/insights.js";

/** 预测展示载荷（发布队列/批次表单「预期效果」区块）。 */
export interface QueueForecastView {
  readonly generatedAt: string;
  /** 各平台预测（按预期中位降序）。 */
  readonly platforms: readonly PlatformForecast[];
  /** 推荐平台组合（与传入平台取交集）。 */
  readonly recommendedPlatforms: readonly string[];
  /** 最佳发布时段（小时，可空）。 */
  readonly bestHour: number | null;
  /** 发布决策建议。 */
  readonly decision: PublishDecision;
  /** 是否基于足够数据（缺数据 safeFallback）。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

export interface ForecastForQueueOptions {
  /** 效果记录（空 = 安全回退）。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 当前内容标题（供预测主题匹配，可选）。 */
  readonly title?: string;
  /** 当前内容正文纯文本（供长度特征，可选）。 */
  readonly contentText?: string;
  /** 用户已选/目标平台（推荐只在此集合内取）。 */
  readonly platformIds?: readonly string[];
  /** 是否通过发布前校验（决策用）。 */
  readonly allPassed?: boolean;
  /** 注入时钟（测试用）。 */
  readonly now?: () => string;
}

/**
 * FORECAST-QUEUE-01 UI 辅助：为发布队列/批次表单生成「预期效果」展示载荷。
 *
 * - 预测：复用 `forecastPerformance`（区间 + 置信度 + 推荐平台 + 最佳时段）；
 * - 决策：复用 `buildPublishDecision`（立即发 / 改期发 / 先优化 / 不发）；
 * - 平台交集：推荐平台只保留传入已选集合内的平台（不越界）；
 * - 缺数据：决策给出保守「立即发 + 说明数据不足」，摘要明确提示。
 */
export function forecastForQueue(options: ForecastForQueueOptions = {}): QueueForecastView {
  const records = options.performanceRecords ?? [];
  const now = options.now ?? (() => new Date().toISOString());
  const selected = (options.platformIds ?? []).filter((x) => typeof x === "string" && x.length > 0);

  const forecast: ForecastResult = forecastPerformance(records, {
    title: options.title,
    contentText: options.contentText,
    topN: 3,
    now,
  });

  // 推荐平台与已选平台取交集。
  const recommendedPlatforms = forecast.recommendedPlatforms.filter((p) => selected.length === 0 || selected.includes(p));
  const decision = buildPublishDecision({
    forecast,
    allPassed: options.allPassed ?? true,
  });

  const summary = forecast.safeFallback
    ? "暂无效果数据，无法预测发布效果。发布后请到「效果回收」录入数据以积累预测样本。"
    : `预测完成：推荐平台 ${recommendedPlatforms.join(" / ") || "无"} · 最佳时段 ${
        forecast.bestHour != null ? `${forecast.bestHour}:00` : "暂无数据"
      } · ${decision.reason}`;

  return {
    generatedAt: forecast.generatedAt,
    platforms: forecast.platforms,
    recommendedPlatforms,
    bestHour: forecast.bestHour,
    decision,
    safeFallback: forecast.safeFallback,
    summary,
  };
}

/** 批量目标平台建议来源。 */
export type MatrixSuggestionSource = "matrix" | "fallback";

/** 单条批量目标平台建议。 */
export interface MatrixPlatformSuggestion {
  /** 建议的平台组合。 */
  readonly platformIds: readonly string[];
  /** 建议理由。 */
  readonly reason: string;
  /** 来源：matrix（有数据）/ fallback（无数据通用建议）。 */
  readonly source: MatrixSuggestionSource;
  /** 建议名称（人读）。 */
  readonly name: string;
}

/**
 * MATRIX-QUEUE 联动：基于内容矩阵派生「批量目标平台建议」。
 *
 * - 数据充足：优先**补空窗**（矩阵健康度 gaps 时把未覆盖平台补入）→ 强化最佳平台 →
 *   均衡组合（保留各平台历史中位最高的前 N 个）；
 * - 数据不足：回退通用建议（全部已选平台 / 前 N 个平台）。
 * - 只返回传入平台集合内的平台（不越界）。
 */
export function matrixQueuePlatformSuggestions(
  records: readonly PerformanceRecord[],
  options: { readonly platformIds?: readonly string[]; readonly topN?: number } = {},
): readonly MatrixPlatformSuggestion[] {
  const selected = (options.platformIds ?? []).filter((x) => typeof x === "string" && x.length > 0);
  const topN = options.topN ?? 3;
  const inSelected = (list: readonly string[]): string[] => list.filter((p) => selected.length === 0 || selected.includes(p));

  if (records.length === 0) {
    return [
      {
        platformIds: [...selected],
        name: "全平台覆盖发布",
        reason: "还没有历史效果数据，建议先全平台覆盖发布并回收效果，再根据矩阵表现调整。",
        source: "fallback",
      },
    ];
  }

  const matrix: ContentMatrix = buildContentMatrix(records);
  const out: MatrixPlatformSuggestion[] = [];

  // 1) 补空窗：矩阵健康度 gaps（仅 1 平台）时，把已选但未覆盖的平台补入。
  if (matrix.health === "gaps" && matrix.platformCoverage.length === 1) {
    const covered = new Set(matrix.platformCoverage.map((p) => p.platformId));
    const gaps = selected.filter((p) => !covered.has(p));
    if (gaps.length > 0) {
      out.push({
        platformIds: [...matrix.platformCoverage.map((p) => p.platformId), ...gaps],
        name: "补齐平台空窗",
        reason: `当前仅覆盖 ${matrix.platformCoverage[0]?.platformId ?? "单一平台"}，建议补齐 ${gaps.join(" / ")} 拓展矩阵。`,
        source: "matrix",
      });
    }
  }

  // 2) 强化最佳平台：排名最前的平台组合（综合得分高 → 预期表现好）。
  const ranked = rankPlatforms(records);
  const best = ranked.filter((r) => inSelected([r.platformId]).length > 0);
  if (best.length > 0) {
    out.push({
      platformIds: best.slice(0, topN).map((r) => r.platformId),
      name: "强化历史最佳平台",
      reason: `历史综合表现最好的平台：${best
        .slice(0, topN)
        .map((r) => `${r.platformId}(${Math.round(r.avgViews)} 均阅)`)
        .join(" / ")}`,
      source: "matrix",
    });
  }

  // 3) 均衡组合：按预期中位保留前 N 个平台（与 AI 排期建议口径一致）。
  const forecast = forecastPerformance(records, { topN });
  const recommended = inSelected(forecast.recommendedPlatforms);
  if (recommended.length > 0) {
    out.push({
      platformIds: recommended,
      name: "均衡发布组合",
      reason: `按历史效果预期中位推荐：${recommended.join(" / ")}`,
      source: "matrix",
    });
  }

  // 兜底：无任何数据派生建议时给全平台。
  if (out.length === 0) {
    out.push({
      platformIds: [...selected],
      name: "保持当前选择",
      reason: "暂无足够数据派生平台建议，保持当前平台选择发布。",
      source: "fallback",
    });
  }
  return out;
}

/** 待跟进提醒级别。 */
export type FollowUpSeverity = "high" | "medium" | "low";

/** 单条待跟进提醒。 */
export interface FollowUpReminderItem {
  readonly kind: FollowUpItem["kind"];
  readonly title: string;
  readonly platformId: string;
  readonly views: number;
  readonly engagement: number;
  readonly note: string;
  /** 提醒级别（严重度派生）。 */
  readonly severity: FollowUpSeverity;
}

/** 待跟进提醒摘要（供通知/提醒复用）。 */
export interface FollowUpReminderDigest {
  readonly generatedAt: string;
  /** 待跟进提醒条目（按严重度排序）。 */
  readonly items: readonly FollowUpReminderItem[];
  /** 各级别计数。 */
  readonly counts: { readonly high: number; readonly medium: number; readonly low: number };
  /** 是否建议发送提醒（有待跟进项）。 */
  readonly shouldNotify: boolean;
  /** 通知标题。 */
  readonly notifyTitle: string;
  /** 通知正文。 */
  readonly notifyBody: string;
  /** 人类可读摘要。 */
  readonly summary: string;
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
}

/** 严重度派生：数据缺口 = high；高互动待回复 = medium；低互动待复盘 = low。 */
function severityOf(kind: FollowUpItem["kind"]): FollowUpSeverity {
  switch (kind) {
    case "data-gap":
      return "high";
    case "high-engagement":
      return "medium";
    case "low-engagement":
      return "low";
  }
}

/**
 * FOLLOWUP-NOTIFY 辅助：把待跟进清单转成**提醒摘要**（供通知/提醒复用）。
 *
 * - 复用 `buildPostPublishLoop` 派生待跟进清单；
 * - 按严重度排序（high → medium → low）；
 * - `shouldNotify` 有待跟进项即 true；通知标题/正文已拼好；
 * - 缺数据 safeFallback（无待跟进项不提醒）。
 */
export function buildFollowUpReminderDigest(
  records: readonly PerformanceRecord[],
  options: { readonly maxItems?: number; readonly now?: () => string } = {},
): FollowUpReminderDigest {
  const now = options.now ?? (() => new Date().toISOString());
  const maxItems = options.maxItems ?? 20;
  const loop: PostPublishLoop = buildPostPublishLoop(records);

  const items: FollowUpReminderItem[] = loop.followUps.map((f) => ({
    kind: f.kind,
    title: f.title,
    platformId: f.platformId,
    views: f.views,
    engagement: f.engagement,
    note: f.note,
    severity: severityOf(f.kind),
  }));
  // 严重度排序：high → medium → low。
  const order: Record<FollowUpSeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...items].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, maxItems);

  const counts = {
    high: sorted.filter((i) => i.severity === "high").length,
    medium: sorted.filter((i) => i.severity === "medium").length,
    low: sorted.filter((i) => i.severity === "low").length,
  };
  const total = sorted.length;
  const shouldNotify = total > 0;

  const label = (kind: FollowUpItem["kind"]) =>
    kind === "data-gap" ? "数据缺口" : kind === "high-engagement" ? "待回复" : "待复盘";

  const summary = shouldNotify
    ? `有 ${total} 条待跟进（${counts.high} 条数据缺口 / ${counts.medium} 条高互动待回复 / ${counts.low} 条低互动待复盘）`
    : "暂无待跟进项，所有内容互动正常";

  const notifyTitle = shouldNotify ? `内容待跟进：${total} 条` : "无待跟进内容";
  const notifyBody = shouldNotify
    ? sorted
        .slice(0, 5)
        .map((i) => `[${label(i.kind)}] ${i.title}（${i.platformId}）`)
        .join("；") + (total > 5 ? ` 等 ${total} 条` : "")
    : "所有内容互动正常";

  return {
    generatedAt: now(),
    items: sorted,
    counts,
    shouldNotify,
    notifyTitle,
    notifyBody,
    summary,
    safeFallback: loop.safeFallback || total === 0,
  };
}
