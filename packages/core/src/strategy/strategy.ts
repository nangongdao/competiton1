/**
 * v11 Phase 3 · STRATEGY-01 内容策略主线 + GOAL-STRATEGY-01 策略对齐目标。
 *
 * - `buildContentStrategy`(STRATEGY-01):整合 平台 / 时段 / 优化 / 老化 / 矩阵 / 归因
 *   洞察为「现状 → 归因 → 下一步行动」策略主线,LLM 增强 + 规则兜底;
 * - `projectGoalAchievement`(GOAL-STRATEGY-01):结合目标进度 + 效果预测 + 发布节奏,
 *   输出「达成预测 / 缺口 / 达成策略」。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;策略带来源(llm/rule)与数据量标注;动作可溯源;
 * - LLM 只做整合与措辞,结构/数字以规则派生为准;失败回退规则;
 * - 只做建议不自动发布;数据脱敏(不含 remoteUrl / token);
 * - 缺数据安全回退。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance, rankPlatforms } from "../analytics/insights.js";
import { bestTimeFromRecords } from "../dashboard/optimize.js";
import { buildContentMatrix } from "../dashboard/matrix.js";
import { detectAgingContent } from "../lifecycle/aging.js";
import { goalProgress } from "../dashboard/goals.js";
import { forecastPerformance } from "../forecast/forecast.js";
import { attributePerformance } from "./attribute.js";
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 策略步骤类型。 */
export type StrategyActionKind = "increase-post" | "reschedule" | "refresh" | "expand-platform" | "optimize-content";

/** 策略步骤。 */
export interface StrategyStep {
  readonly kind: StrategyActionKind;
  /** 步骤标题。 */
  readonly title: string;
  /** 步骤说明。 */
  readonly detail: string;
  /** 目标平台(可空)。 */
  readonly platformId?: string;
  /** 建议时段(小时,可空)。 */
  readonly hour?: number;
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
  /** 可溯源依据(一句话,引用既有洞察)。 */
  readonly basis: string;
  /** 是否可一键采纳到发布队列(带 platformId/hour 的步骤可采纳)。 */
  readonly adoptable: boolean;
}

/** 策略主线。 */
export interface ContentStrategy {
  readonly generatedAt: string;
  /** 现状摘要(数据驱动的客观描述)。 */
  readonly situation: string;
  /** 归因摘要(来自归因分析)。 */
  readonly attribution: string;
  /** 下一步行动(按优先级排序)。 */
  readonly steps: readonly StrategyStep[];
  /** 是否使用了 LLM。 */
  readonly usedLlm: boolean;
  /** 规则兜底(供用户比较)。 */
  readonly ruleSteps: readonly StrategyStep[];
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 策略构建选项。 */
export interface StrategyOptions {
  /** 效果记录。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 老化检测选项(透传)。 */
  readonly agingOptions?: Parameters<typeof detectAgingContent>[1];
  /** 目标进度选项(月目标)。 */
  readonly goalOptions?: { readonly monthlyViewsGoal?: number; readonly monthlyPostsGoal?: number };
  /** 当前内容标题(供 LLM 上下文,可选)。 */
  readonly title?: string;
  /** 是否启用 LLM(默认 true)。 */
  readonly useLlm?: boolean;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 目标达成预测。 */
export interface GoalAchievementProjection {
  /** 达成预测(0-1,1 表示预测可达成)。 */
  readonly projection: number;
  /** 预测达成状态。 */
  readonly status: "on-track" | "at-risk" | "off-track" | "no-goal";
  /** 预测缺口(还差多少阅读量)。 */
  readonly gap: number;
  /** 建议加发篇数(基于当前平均单篇阅读)。 */
  readonly postsNeeded: number;
  /** 优先平台。 */
  readonly bestPlatform: string | null;
  /** 建议时段。 */
  readonly bestHour: number | null;
  /** 是否基于足够数据。 */
  readonly safeFallback: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/**
 * GOAL-STRATEGY-01 策略对齐目标。
 *
 * 基于「当前目标进度」推断月内剩余节奏:剩余天数 × 当前日均阅读 → 预计期末阅读。
 * 结合效果预测(平均单篇阅读 + 最佳平台 + 最佳时段)给出「还差多少 / 加发几篇 / 发哪里」。
 */
export function projectGoalAchievement(
  records: readonly PerformanceRecord[],
  options: {
    readonly monthlyViewsGoal?: number;
    readonly now?: () => string;
  } = {},
): GoalAchievementProjection {
  const now = options.now ?? (() => new Date().toISOString());
  const today = now().slice(0, 10);

  const items = goalProgress(records, {
    month: today.slice(0, 7),
    monthlyViewsGoal: options.monthlyViewsGoal ?? 0,
  });
  const goalItem = items.find((i) => i.label === "月阅读量");
  const goal = goalItem?.goal ?? 0;
  const actual = goalItem?.actual ?? 0;

  if (goal <= 0) {
    return {
      projection: 0,
      status: "no-goal",
      gap: 0,
      postsNeeded: 0,
      bestPlatform: null,
      bestHour: null,
      safeFallback: true,
      summary: "尚未设定月阅读目标。请在「目标进度」设定目标后,这里会自动给出达成预测与加发建议。",
    };
  }

  // 月剩余天数(含今天)。
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOfMonth = Number(today.slice(8, 10));
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth + 1);

  // 日均阅读(基于本月已回收阅读)。
  const monthRecords = records.filter((r) => r.collectedAt.slice(0, 7) === today.slice(0, 7));
  const dailyAvg =
    monthRecords.length > 0
      ? monthRecords.reduce((s, r) => s + (r.metrics.views ?? 0), 0) / Math.max(1, dayOfMonth)
      : 0;

  const projected = actual + dailyAvg * remainingDays;
  const projection = goal > 0 ? Math.min(1, projected / goal) : 0;
  const gap = goal - projected;

  // 最佳平台 / 最佳时段 / 平均单篇阅读。
  const ranking = rankPlatforms(records);
  const bestPlatform = ranking[0]?.platformId ?? null;
  const bestHour = bestTimeFromRecords(records)?.hour ?? null;
  const forecast = forecastPerformance(records);
  const avgPerPost =
    forecast.platforms.length > 0
      ? forecast.platforms.reduce((s, p) => s + p.avgViews, 0) / forecast.platforms.length
      : 0;

  const postsNeeded = gap > 0 && avgPerPost > 0 ? Math.ceil(gap / avgPerPost) : 0;

  let status: GoalAchievementProjection["status"];
  if (projection >= 1) status = "on-track";
  else if (projection >= 0.7) status = "at-risk";
  else status = "off-track";

  const statusText = status === "on-track" ? "按当前节奏可达成" : status === "at-risk" ? "存在风险,建议加发" : "按当前节奏难以达成,需加大投入";

  return {
    projection,
    status,
    gap: Math.max(0, gap),
    postsNeeded,
    bestPlatform,
    bestHour,
    safeFallback: projection <= 0 && gap <= 0,
    summary: `目标达成预测:${statusText}(预计 ${Math.round(projected)} / 目标 ${goal})。还差约 ${Math.max(0, gap)} 阅读${postsNeeded > 0 ? `,建议加发约 ${postsNeeded} 篇${bestPlatform ? `,优先 ${bestPlatform}` : ""}${bestHour !== null ? `,时段 ${bestHour}:00 前后` : ""}` : ""}。`,
  };
}

/** 规则策略步骤(确定性兜底)。 */
export function ruleStrategySteps(
  records: readonly PerformanceRecord[],
  options: StrategyOptions = {},
): readonly StrategyStep[] {
  const steps: StrategyStep[] = [];
  if (records.length === 0) return steps;

  const insights = analyzePerformance(records);
  const attribution = attributePerformance(records);
  const matrix = buildContentMatrix(records);
  const aging = detectAgingContent(records, options.agingOptions);

  // 1) 最佳平台 → 加发。
  const bestRank = insights.ranking[0];
  if (bestRank && bestRank.avgViews > 0) {
    steps.push({
      kind: "increase-post",
      title: `加发 ${bestRank.platformId}`,
      detail: `该平台平均阅读 ${Math.round(bestRank.avgViews)},综合表现最佳。`,
      platformId: bestRank.platformId,
      source: "rule",
      basis: "平台排名(平均阅读 × 互动率)",
      adoptable: true,
    });
  }

  // 2) 最佳时段 → 改期/择时。
  const bestHour = insights.insights.find((i) => i.kind === "best-time");
  if (bestHour) {
    const hourMatch = bestHour.title.match(/(\d{1,2}):00/);
    const hour = hourMatch ? Number(hourMatch[1]) : undefined;
    steps.push({
      kind: "reschedule",
      title: `优先在 ${hour ?? "最佳"} 时段发布`,
      detail: bestHour.detail,
      hour,
      source: "rule",
      basis: "最佳发布时段(历史小时聚合)",
      adoptable: true,
    });
  }

  // 3) 老化内容 → 翻新。
  const refreshItems = aging.items.filter((i) => i.action === "refresh").slice(0, 1);
  if (refreshItems.length > 0) {
    const item = refreshItems[0]!;
    steps.push({
      kind: "refresh",
      title: `翻新「${item.title}」`,
      detail: item.suggestion,
      source: "rule",
      basis: "老化检测(超期 / 阅读低迷)",
      adoptable: false,
    });
  }

  // 4) 矩阵空窗/偏科 → 拓展平台。
  if (matrix.health !== "balanced") {
    steps.push({
      kind: "expand-platform",
      title: matrix.health === "gaps" ? "拓展发布平台" : "平衡平台分布",
      detail: matrix.healthNote,
      source: "rule",
      basis: "内容矩阵健康度",
      adoptable: true,
    });
  }

  // 5) 归因最大差异 → 优化内容。
  const topFactor = attribution.factors[0];
  if (topFactor && topFactor.ratio !== null && topFactor.ratio >= 1.5) {
    steps.push({
      kind: "optimize-content",
      title: `向高表现特征靠拢:${topFactor.highFeature}`,
      detail: topFactor.note,
      source: "rule",
      basis: "效果归因(最大差异维度)",
      adoptable: false,
    });
  }

  return steps;
}

/** 脱敏上下文(供 LLM)。 */
export function buildV11StrategyContext(
  records: readonly PerformanceRecord[],
  options: StrategyOptions = {},
): string {
  if (records.length === 0) return "暂无效果数据。";
  const insights = analyzePerformance(records);
  const attribution = attributePerformance(records);
  const matrix = buildContentMatrix(records);
  const aging = detectAgingContent(records, options.agingOptions);
  const goal = projectGoalAchievement(records, { monthlyViewsGoal: options.goalOptions?.monthlyViewsGoal });

  const lines: string[] = [];
  lines.push(`最佳平台:${insights.ranking[0]?.platformId ?? "无"}(平均阅读 ${Math.round(insights.ranking[0]?.avgViews ?? 0)})`);
  const bestHour = insights.insights.find((i) => i.kind === "best-time");
  lines.push(`最佳时段:${bestHour?.title ?? "无"}`);
  lines.push(`矩阵健康度:${matrix.healthNote}`);
  if (aging.items.length > 0) lines.push(`老化翻新建议:${aging.items[0]!.suggestion}`);
  if (attribution.factors.length > 0) lines.push(`最大归因差异:${attribution.factors[0]!.note}`);
  lines.push(`目标达成:${goal.summary}`);
  if (options.title) lines.push(`当前内容标题:${options.title}`);
  return lines.join("\n");
}

/** LLM 策略生成请求(prompt 构造)。 */
export function v11StrategyRequest(
  context: string,
  options: { readonly title?: string } = {},
): LlmRequest {
  return {
    task: "strategy",
    platformId: "wechat",
    input: `数据上下文:\n${context}\n${options.title ? `当前内容:${options.title}\n` : ""}\n请给出下一步内容策略建议(3-5 条)。`,
    systemPrompt:
      "你是多平台内容运营策略顾问。基于给定的数据上下文,输出 3-5 条可执行的下一步策略建议。" +
      "要求:每条建议必须可直接执行(加发/改期/翻新/拓展平台/优化内容);必须引用数据依据;" +
      "不要编造数据;只做建议不自动发布。用简洁中文输出。",
    temperature: 0.5,
    maxTokens: 800,
  };
}

/**
 * STRATEGY-01 内容策略主线。
 *
 * - 规则层: `ruleStrategySteps` 确定性生成;
 * - LLM 层: 若启用且可用,把规则步骤与数据上下文交给 LLM 整合措辞;
 *   失败/不可用回退规则;
 * - 输出带 situation / attribution / steps / usedLlm / ruleSteps。
 */
export async function buildContentStrategy(
  records: readonly PerformanceRecord[],
  llm: LlmAdapter | undefined,
  options: StrategyOptions = {},
): Promise<ContentStrategy> {
  const now = options.now ?? (() => new Date().toISOString());
  const useLlm = options.useLlm ?? true;
  const ruleSteps = ruleStrategySteps(records, options);

  if (records.length === 0) {
    return {
      generatedAt: now(),
      situation: "暂无效果数据,无法生成内容策略。",
      attribution: "请先在「效果回收」录入或导入发布效果。",
      steps: [],
      usedLlm: false,
      ruleSteps,
      safeFallback: true,
      summary: "暂无效果数据,无法生成内容策略。",
    };
  }

  const attribution = attributePerformance(records);
  const insights = analyzePerformance(records);
  const bestPlatform = insights.ranking[0]?.platformId;
  const bestHour = insights.insights.find((i) => i.kind === "best-time");
  const hourMatch = bestHour?.title.match(/(\d{1,2}):00/);
  const situation = `当前覆盖 ${records.length} 条效果记录${bestPlatform ? `,最佳平台 ${bestPlatform}` : ""}${hourMatch ? `,最佳时段 ${hourMatch[1]}:00 前后` : ""}。`;
  const attributionText =
    attribution.factors.length > 0 ? attribution.summary : "效果数据维度不足,暂无明显归因差异。";

  let steps = ruleSteps;
  let usedLlm = false;

  if (useLlm && llm) {
    try {
      const context = buildV11StrategyContext(records, options);
      const text = await llm.run(v11StrategyRequest(context, { title: options.title }));
      const trimmed = text.trim();
      if (trimmed) {
        // LLM 输出整合为步骤(结构化解析宽松,失败回退规则)。
        const parsed = parseLlmSteps(trimmed, options);
        if (parsed.length > 0) {
          steps = parsed;
          usedLlm = true;
        }
      }
    } catch {
      // 失败回退规则。
    }
  }

  return {
    generatedAt: now(),
    situation,
    attribution: attributionText,
    steps,
    usedLlm,
    ruleSteps,
    safeFallback: steps.length === 0,
    summary: `内容策略:${steps.length > 0 ? `${steps[0]!.title} 等 ${steps.length} 条行动建议` : "暂无可执行建议"}${usedLlm ? "(LLM 增强)" : ""}。`,
  };
}

/** 宽松解析 LLM 输出的步骤列表(失败返回空数组)。 */
function parseLlmSteps(
  text: string,
  options: StrategyOptions,
): StrategyStep[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const steps: StrategyStep[] = [];
  const now = options.now ?? (() => new Date().toISOString());

  for (const line of lines) {
    // 去掉编号/符号前缀。
    const clean = line.replace(/^[\s\d#*•.、-]+/, "").replace(/^[【[]/, "").replace(/^(.{0,8})[】]/, "$1");
    if (!clean) continue;
    // 平台检测。
    const platformMatch = clean.match(/(公众号|知乎|B站|小红书|掘金|博客园|CSDN)/);
    // 时段检测。
    const hourMatch = clean.match(/(\d{1,2})\s*[:：]\s*(\d{2})?\s*前后?/);
    // 动作类型。
    let kind: StrategyActionKind = "optimize-content";
    if (/(加发|多发|增加发布|加大发布)/.test(clean)) kind = "increase-post";
    else if (/(改期|时段|时间|择时)/.test(clean)) kind = "reschedule";
    else if (/(翻新|老化|重发)/.test(clean)) kind = "refresh";
    else if (/(拓展|扩平台|新平台|空窗|偏科)/.test(clean)) kind = "expand-platform";

    steps.push({
      kind,
      title: clean.slice(0, 24),
      detail: clean,
      platformId: platformMatch ? platformMatch[1] : undefined,
      hour: hourMatch ? Number(hourMatch[1]) : undefined,
      source: "llm",
      basis: "LLM 整合(数据上下文)",
      adoptable: !!(platformMatch || hourMatch),
    });
    if (steps.length >= 5) break;
  }
  void now;
  return steps;
}

// ---------------------------------------------------------------------------
// v11 深化 · STRATEGY-ADOPT-01 策略动作一键采纳到发布队列
// ---------------------------------------------------------------------------

/** 策略动作采纳到发布队列的排队输入(供发布队列/批次表单直接填入)。 */
export interface StrategyQueueAdoption {
  /** 目标平台(策略步骤 platformId;采纳时优先,空则交由调用方保持当前选择)。 */
  readonly platformIds: readonly string[];
  /** 建议时段(小时;空则交由调用方保持当前选择)。 */
  readonly hour: number | null;
  /** 是否可直接排队(带平台/时段任意一个即可)。 */
  readonly ok: boolean;
  /** 人类可读摘要(采纳提示用)。 */
  readonly summary: string;
}

/**
 * STRATEGY-ADOPT-01 把一条策略步骤转成「可直接填入发布队列/批次表单」的排队输入。
 *
 * - 带 `platformId` → 平台组合取该平台(不越界);
 * - 带 `hour` → 建议时段;两者都无 → `ok=false`(不可直接排队);
 * - 摘要脱敏,不含 remoteUrl / token。
 */
export function strategyStepToQueueAdoption(
  step: StrategyStep,
  options: { readonly hour?: number | null } = {},
): StrategyQueueAdoption {
  const platformIds = step.platformId ? [step.platformId] : [];
  const hour = step.hour ?? options.hour ?? null;
  const ok = platformIds.length > 0 || hour !== null;
  const summary = ok
    ? `采纳策略动作「${step.title}」${platformIds.length > 0 ? ` · 平台 ${platformIds.join("/")}` : ""}${hour !== null ? ` · ${hour}:00 前后` : ""}`
    : `策略动作「${step.title}」暂无可直接填写的平台/时段,请在发布队列中自行选择`;
  return { platformIds, hour, ok, summary };
}

/**
 * STRATEGY-ADOPT-01 把策略建议时段(小时)转成「下次该小时」的 ISO 时间(供发布队列表单直接填入)。
 *
 * - 复用 `nextAtForHour` 语义:候选落在 earliestAt 之后最近一次该小时;
 * - earliestAt 缺省取当前时间;纯函数、可测试。
 */
export function strategyHourToScheduledAt(
  hour: number,
  options: { readonly earliestAt?: string; readonly now?: () => string } = {},
): string {
  const now = options.now ?? (() => new Date().toISOString());
  const anchor = Number.isFinite(Date.parse(options.earliestAt ?? ""))
    ? options.earliestAt!
    : now();
  const candidate = new Date(anchor);
  candidate.setUTCHours(Math.max(0, Math.min(23, Math.round(hour))), 0, 0, 0);
  if (candidate.getTime() <= new Date(anchor).getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

// ---------------------------------------------------------------------------
// v11 深化 · GOAL-NOTIFY-01 目标达成预测接入提醒(at-risk 时心跳提醒 + 建议动作直达)
// ---------------------------------------------------------------------------

/** 目标达成提醒摘要(供通知/提醒复用,语义对齐 buildFollowUpReminderDigest)。 */
export interface GoalReminderDigest {
  readonly generatedAt: string;
  /** 达成预测状态。 */
  readonly status: "on-track" | "at-risk" | "off-track" | "no-goal";
  /** 达成预测(0-1)。 */
  readonly projection: number;
  /** 缺口(还差多少阅读)。 */
  readonly gap: number;
  /** 建议加发篇数。 */
  readonly postsNeeded: number;
  /** 优先平台。 */
  readonly bestPlatform: string | null;
  /** 建议时段。 */
  readonly bestHour: number | null;
  /** 是否建议发送提醒(at-risk / off-track 才提醒)。 */
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

/**
 * GOAL-NOTIFY-01 把目标达成预测转成**提醒摘要**(供心跳提醒/通知复用)。
 *
 * - 复用 `projectGoalAchievement`:on-track / no-goal 不提醒;
 * - at-risk / off-track 时 `shouldNotify=true`,通知正文带「需加发 N 篇 · 优先平台 · 建议时段」;
 * - 通知点击 action 建议用 `strategy`(直达内容策略/目标达成预测卡);
 * - 缺数据 / 未设目标安全回退(不提醒)。
 */
export function buildGoalReminderDigest(
  records: readonly PerformanceRecord[],
  options: { readonly monthlyViewsGoal?: number; readonly now?: () => string } = {},
): GoalReminderDigest {
  const now = options.now ?? (() => new Date().toISOString());
  const projection = projectGoalAchievement(records, {
    monthlyViewsGoal: options.monthlyViewsGoal,
    now,
  });
  const shouldNotify = projection.status === "at-risk" || projection.status === "off-track";
  const statusText =
    projection.status === "on-track"
      ? "按当前节奏可达成"
      : projection.status === "at-risk"
        ? "存在风险,建议加发"
        : projection.status === "off-track"
          ? "按当前节奏难以达成,需加大投入"
          : "尚未设定月阅读目标";
  const actionText = projection.postsNeeded > 0
    ? `建议加发约 ${projection.postsNeeded} 篇${projection.bestPlatform ? `,优先 ${projection.bestPlatform}` : ""}${projection.bestHour !== null ? `,时段 ${projection.bestHour}:00 前后` : ""}`
    : "当前节奏尚可,建议保持发布频率并持续回收效果";
  const summary = shouldNotify
    ? `目标达成提醒:${statusText}(达成预测 ${Math.round(projection.projection * 100)}%,还差约 ${projection.gap} 阅读)。${actionText}。`
    : `目标达成:${statusText}。${actionText}。`;
  return {
    generatedAt: now(),
    status: projection.status,
    projection: projection.projection,
    gap: projection.gap,
    postsNeeded: projection.postsNeeded,
    bestPlatform: projection.bestPlatform,
    bestHour: projection.bestHour,
    shouldNotify,
    notifyTitle: shouldNotify ? "目标达成预警:需加发内容" : "目标达成状态",
    notifyBody: summary,
    summary,
    safeFallback: projection.status === "no-goal" || projection.safeFallback,
  };
}



