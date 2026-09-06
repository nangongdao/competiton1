/**
 * AI-QUEUE-01 —— AI 自动排期建议。
 *
 * 在 ROADMAP_V5 Phase 4「AI 发布工作台」中,为「把草稿排入发布队列」这一步提供
 * **数据驱动的发布时间 + 平台组合建议**:
 *
 * - 数据侧:复用 `analyzePerformance` 的历史效果洞察(最佳发布时段 / 最佳平台 /
 *   增长率 / 最佳单篇)整理成可脱敏上下文(绝不携带 token/key/remoteUrl);
 * - 生成侧:走统一 LLM 适配器(任务级参数 + 多模型回退 + 重试),输出结构化的
 *   「建议发布时间(ISO) + 建议平台组合 + 理由」;LLM 不可用/失败回退规则建议;
 * - 平台侧:只返回已选/已注册平台(建议不可落到未选平台);
 * - 原则:LLM 只是排期建议引擎,任何失败都回退到规则,绝不阻断排队链路。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance } from "../analytics/insights.js";
import { bestTimeFromRecords } from "../dashboard/optimize.js";
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { buildStrategyContext } from "./publish-strategy.js";

/** 单条排期建议。 */
export interface QueueScheduleSuggestion {
  /** 建议发布时间(ISO)。 */
  readonly suggestedAt: string;
  /** 建议平台组合(与传入平台取交集;为空表示保持用户选择)。 */
  readonly platformIds: readonly string[];
  /** 建议名称(备注)。 */
  readonly name: string;
  /** 一句话理由。 */
  readonly reason: string;
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
}

/** 排期建议结果。 */
export interface QueueScheduleResult {
  readonly generatedAt: string;
  /** 是否使用了 LLM(否则为规则兜底)。 */
  readonly usedLlm: boolean;
  /** 建议列表(通常 1-2 条,UI 可让用户一键采纳)。 */
  readonly suggestions: readonly QueueScheduleSuggestion[];
  /** 供 UI 展示的人类可读摘要。 */
  readonly summary: string;
  /** 规则兜底(便于用户比较)。 */
  readonly fallback: readonly QueueScheduleSuggestion[];
}

export interface QueueScheduleOptions {
  /** 当前文章标题(供 LLM 参考,默认空)。 */
  readonly title?: string;
  /** 当前文章正文纯文本(截断后进入 prompt)。 */
  readonly contentText?: string;
  /** 效果记录(为空时只有规则兜底/通用建议)。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 用户已选/目标平台(建议只在此集合内取)。 */
  readonly platformIds?: readonly string[];
  /** 期望的最早发布时间(ISO;默认当前时间)。 */
  readonly earliestAt?: string;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM 生成(默认 true)。 */
  readonly useLlm?: boolean;
}

/** 一天内可用的发布窗口(默认 7:00 / 12:00 / 18:00 / 21:00)。 */
export const DEFAULT_SCHEDULE_WINDOWS = [7, 12, 18, 21];

/** 把 "HH:00" 建议格式化为 ISO(落在 earliestAt 之后的最近一天)。 */
export function nextAtForHour(
  hour: number,
  earliestAt: string,
  now: () => string = () => new Date().toISOString(),
): string {
  const anchor = Number.isFinite(Date.parse(earliestAt)) ? new Date(earliestAt) : new Date(now());
  const candidate = new Date(anchor);
  candidate.setUTCHours(hour, 0, 0, 0);
  // 若候选已过,推到下一天同一小时。
  if (candidate.getTime() <= anchor.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

/** 由效果洞察 + 平台集合派生的规则排期建议(确定性、离线可用)。 */
export function ruleScheduleSuggestions(
  records: readonly PerformanceRecord[],
  opts: QueueScheduleOptions,
): readonly QueueScheduleSuggestion[] {
  const platforms = (opts.platformIds ?? []).filter((x) => typeof x === "string" && x.length > 0);
  const earliest = opts.earliestAt ?? opts.now?.() ?? new Date().toISOString();
  const insights = analyzePerformance(records);
  const bestHour = insights.insights.find((i) => i.kind === "best-time");
  const bestPlatform = insights.ranking[0];
  // v10 OPT-QUEUE-01:优先复用 bestTimeFromRecords 学习到的时段分布(而非仅固定窗口)。
  const learned = bestTimeFromRecords(records);
  const learnedHour = learned.hasData ? learned.hour : null;
  const out: QueueScheduleSuggestion[] = [];

  const make = (
    hour: number,
    pick: readonly string[],
    name: string,
    reason: string,
  ): QueueScheduleSuggestion => ({
    suggestedAt: nextAtForHour(hour, earliest, opts.now),
    platformIds: pick.length > 0 ? pick : [...platforms],
    name,
    reason,
    source: "rule",
  });

  if (records.length === 0) {
    out.push(
      make(
        DEFAULT_SCHEDULE_WINDOWS[2]!,
        platforms,
        "晚间黄金档发布",
        "还没有历史效果数据,先按通用晚间黄金档(18:00 前后)发布并观察反馈",
      ),
    );
    out.push(
      make(
        DEFAULT_SCHEDULE_WINDOWS[0]!,
        platforms,
        "早晨通勤档发布",
        "备选:早间 7:00 前后发布,覆盖通勤阅读场景",
      ),
    );
  } else {
    // OPT-QUEUE-01:有学习时段时优先使用;否则回退到 bestHour / 固定窗口。
    if (learnedHour !== null) {
      out.push(
        make(
          learnedHour,
          platforms,
          `按学习最佳时段 ${learnedHour}:00 发布`,
          `历史效果学习到 ${learnedHour}:00 前后阅读量最高(共 ${learned.count} 条样本)`,
        ),
      );
    } else if (bestHour) {
      const hour = Number.parseInt(bestHour.title.match(/(\d+):00/)?.[1] ?? "18", 10);
      if (Number.isFinite(hour)) {
        out.push(
          make(
            hour,
            platforms,
            `按最佳时段 ${hour}:00 发布`,
            `历史数据显示 ${hour}:00 前后阅读量最高`,
          ),
        );
      }
    }
    if (bestPlatform) {
      const focused = platforms.includes(bestPlatform.platformId)
        ? [bestPlatform.platformId]
        : platforms;
      out.push(
        make(
          DEFAULT_SCHEDULE_WINDOWS[2]!,
          focused,
          bestPlatform.platformId
            ? `聚焦 ${bestPlatform.platformId} 发布`
            : "聚焦高表现平台发布",
          `该平台综合表现领先(平均阅读 ${Math.round(bestPlatform.avgViews)} × 互动率 ${(bestPlatform.engagementRate * 100).toFixed(1)}%)`,
        ),
      );
    }
    if (out.length < 2) {
      out.push(
        make(
          DEFAULT_SCHEDULE_WINDOWS[2]!,
          platforms,
          "晚间黄金档发布",
          "历史数据不足以推断最优时段,先用通用黄金档发布",
        ),
      );
    }
  }

  return out.slice(0, 2);
}

/** 构造 LLM 排期请求。 */
export function scheduleRequest(records: readonly PerformanceRecord[], opts: QueueScheduleOptions): LlmRequest {
  const ctx = buildStrategyContext(records);
  const platforms = (opts.platformIds ?? []).join(" / ") || "全部已注册平台";
  const contextLines = [
    ...(ctx.insights.length > 0 ? ctx.insights : ["暂无历史效果数据"]),
    `当前文章标题:${opts.title?.trim() || "(未填写)"}`,
    `目标平台(只能从中选择):${platforms}`,
    `可发布的最早时间:${opts.earliestAt ?? "现在"}`,
  ].join("\n");
  const prompt = `你是一名资深新媒体运营。基于下面的历史效果洞察与当前文章,为「定时发布队列」给出两条发布时间与平台组合建议:
1. 建议发布时间(timing,给出具体 UTC 小时数字 0-23)与目标平台(必须从给定集合中选择);
2. 建议的平台组合(platformIds,数组,只包含给定集合内的平台 id);
3. 一句话理由(reason)。

只输出 JSON 数组,每个元素形如 {"hour":18,"platformIds":["wechat","zhihu"],"name":"晚间黄金档","reason":"一句话理由"}。不要输出 JSON 之外的任何文字。

历史效果与当前内容:
${contextLines}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: 2 },
    systemPrompt: "你是资深新媒体运营排期顾问,只输出结构化 JSON 数组,不加解释。",
    temperature: 0.6,
    maxTokens: 600,
  };
}

/** 解析出的中间形态(含小时,未落地为 ISO)。 */
export interface ParsedScheduleItem {
  readonly hour: number;
  readonly platformIds: readonly string[];
  readonly name: string;
  readonly reason: string;
}

/** 宽松解析 LLM 返回的排期建议(JSON 数组;失败回退空数组)。 */
export function parseScheduleSuggestions(raw: string): readonly ParsedScheduleItem[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const hour = Number(o["hour"]);
        const name = typeof o["name"] === "string" ? o["name"].trim() : "";
        const reason = typeof o["reason"] === "string" ? o["reason"].trim() : "";
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
        if (!name) return null;
        const platformIds = Array.isArray(o["platformIds"])
          ? o["platformIds"].filter((p): p is string => typeof p === "string" && p.length > 0)
          : [];
        return { hour, platformIds, name, reason: reason || "LLM 生成建议" };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * 生成发布队列排期建议。
 *
 * @param llm 可选的 LLM 适配器(不可用/失败时规则兜底)。
 * @param options 标题/正文/效果记录/平台集合/最早时间。
 */
export async function generateQueueSchedule(
  llm: LlmAdapter | undefined,
  options: QueueScheduleOptions = {},
): Promise<QueueScheduleResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const records = options.performanceRecords ?? [];
  const fallback = ruleScheduleSuggestions(records, options);
  const useLlm = options.useLlm ?? true;

  if (!useLlm || !llm?.available) {
    return {
      generatedAt,
      usedLlm: false,
      suggestions: fallback,
      summary: "未配置 LLM 或 LLM 不可用,已使用效果数据派生的规则排期建议",
      fallback,
    };
  }

  try {
    const raw = await llm.run(scheduleRequest(records, options));
    const parsed = parseScheduleSuggestions(raw);
    if (parsed.length === 0) throw new Error("LLM 返回的排期建议为空");
    // 把 LLM 建议落地为 ISO + 平台交集(不允许落到未选平台)。
    const earliest = options.earliestAt ?? now();
    const allowed = new Set(options.platformIds ?? []);
    const suggestions: QueueScheduleSuggestion[] = parsed.map((s) => ({
      suggestedAt: nextAtForHour(s.hour, earliest, now),
      platformIds: s.platformIds.filter((p) => allowed.size === 0 || allowed.has(p)),
      name: s.name,
      reason: s.reason,
      source: "llm",
    }));
    return {
      generatedAt,
      usedLlm: true,
      suggestions,
      summary: `已生成 ${suggestions.length} 条 LLM 排期建议(发布时间 + 平台组合)`,
      fallback,
    };
  } catch {
    return {
      generatedAt,
      usedLlm: false,
      suggestions: fallback,
      summary: "LLM 排期生成失败,已回退到效果数据派生的规则建议",
      fallback,
    };
  }
}

// ---------------------------------------------------------------------------
// AI-QUEUE-02 —— 批量 AI 结果一键排队
// ---------------------------------------------------------------------------

/** 批量排队选项。 */
export interface BatchEnqueueScheduleOptions {
  /** 每篇的目标平台(为空则取该篇的批次/队列平台)。 */
  readonly platformIds?: readonly string[];
  /** 期望发布时间(ISO;为空则由建议推导)。 */
  readonly scheduledAt?: string;
  /** 效果记录(可选,供排期建议)。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 是否真实发布(默认 true)。 */
  readonly realPublish?: boolean;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/**
 * 把批量 AI 自动完成结果转为一组「发布队列条目」输入。
 *
 * - 每篇 AI 结果(标题 + 是否内容有变化)都可排入队列;
 * - 时间:显式传入则统一使用;否则用规则排期建议(或默认晚间黄金档)推导;
 * - 平台:统一平台集合(为空则用规则建议的平台组合,保底全部);
 * - 名称:取 AI 结果标题或来源草稿标题。
 *
 * 纯函数/可测:不触碰存储,由调用方(`enqueuePublish`)落库。
 */
export interface BatchQueueEntryItem {
  /** 草稿 id;"current" 表示当前编辑内容(store 会先保存再排队)。 */
  readonly id: string;
  readonly title: string;
  /** 内容是否发生变化(只排队有改写的篇目)。 */
  readonly changed: boolean;
}

export interface QueueEntrySpec {
  /** 草稿 id;省略表示当前编辑(store 先保存)。 */
  readonly draftId?: string;
  readonly name: string;
  readonly platformIds: readonly string[];
  readonly scheduledAt: string;
  readonly realPublish: boolean;
}

export function buildQueueEntriesFromBatch(
  items: readonly BatchQueueEntryItem[],
  options: BatchEnqueueScheduleOptions = {},
): readonly QueueEntrySpec[] {
  const now = options.now ?? (() => new Date().toISOString());
  const records = options.performanceRecords ?? [];
  // 规则建议生成各篇时间(相同上下文下确定性一致)。
  const suggested = ruleScheduleSuggestions(records, {
    platformIds: options.platformIds,
    earliestAt: options.scheduledAt ?? now(),
    now,
  });
  const defaultPlatforms = options.platformIds?.length ? [...options.platformIds] : [];
  const at = options.scheduledAt ?? suggested[0]?.suggestedAt ?? now();

  return items
    .filter((it) => it.changed)
    .map((it) => ({
      ...(it.id === "current" ? {} : { draftId: it.id }),
      name: it.title || "AI 批量排队",
      platformIds: defaultPlatforms.length > 0 ? defaultPlatforms : [...(suggested[0]?.platformIds ?? [])],
      scheduledAt: at,
      realPublish: options.realPublish ?? true,
    }));
}
