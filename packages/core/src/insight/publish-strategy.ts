/**
 * AI-INSIGHT-01 —— AI 发布策略建议。
 *
 * 在 DATA-02/03 效果回收数据(analyzePerformance)与当前内容之上,LLM 生成
 * 「下一篇文章的选题 / 平台组合 / 发布时段」建议:
 *
 * - 数据侧:把效果洞察(最佳平台 / 增长率 / 最佳时段 / 表现最好单篇)与草稿内容
 *   摘要整理成结构化、可脱敏的上下文(绝不携带 token/key/remoteUrl 等敏感字段);
 * - 生成侧:走统一的 LLM 适配器(支持任务级参数 + 多模型回退 + 重试),输出
 *   JSON 数组(选题 / 平台组合 / 发布时段 / 理由),缺字段时规则兜底;
 * - 原则:LLM 只是建议引擎,任何失败都回退到 `analyzePerformance` 派生的规则
 *   建议,绝不阻断发布链路;数据仅本地,不上传。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance } from "../analytics/insights.js";
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 发布策略建议中单条建议。 */
export interface StrategySuggestion {
  /** 类型:选题 / 平台组合 / 发布时段。 */
  readonly kind: "topic" | "platform-mix" | "timing";
  /** 建议文本。 */
  readonly text: string;
  /** 一句话理由。 */
  readonly reason: string;
  /** 关联平台 id(可为空)。 */
  readonly platformId?: string;
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
}

/** 发布策略建议结果。 */
export interface PublishStrategyResult {
  readonly generatedAt: string;
  /** 是否使用了 LLM(否则为规则兜底)。 */
  readonly usedLlm: boolean;
  /** 建议列表(选题 / 平台组合 / 发布时段)。 */
  readonly suggestions: readonly StrategySuggestion[];
  /** 供 UI 展示的人类可读摘要。 */
  readonly summary: string;
  /** LLM 不可用/失败时的规则兜底建议(便于用户比较)。 */
  readonly fallback: readonly StrategySuggestion[];
}

export interface PublishStrategyOptions {
  /** 当前文章标题与内容(供 LLM 参考,默认空字符串)。 */
  readonly title?: string;
  /** 当前文章正文纯文本(截断后进入 prompt,默认空)。 */
  readonly contentText?: string;
  /** 效果记录(为空时只有规则兜底/通用建议)。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM 生成(默认 true;false 时仅规则)。 */
  readonly useLlm?: boolean;
}

/** 从效果记录得到结构化上下文摘要(可脱敏)。 */
export function buildStrategyContext(records: readonly PerformanceRecord[]): {
  bestPlatform?: string;
  bestHour?: number;
  totalRecords: number;
  insights: readonly string[];
} {
  const insights = analyzePerformance(records);
  const best = insights.ranking[0];
  const hour = insights.insights.find((i) => i.kind === "best-time");
  const bestPlatform = best ? best.platformId : undefined;
  const bestHour = hour ? Number.parseInt(hour.title.match(/(\d+):00/)?.[1] ?? "", 10) : undefined;
  const lines: string[] = [];
  if (bestPlatform) lines.push(`最佳平台:${bestPlatform}(平均阅读 ${Math.round(best.avgViews)})`);
  if (bestHour !== undefined) lines.push(`最佳发布时段:${bestHour}:00 前后`);
  for (const rec of insights.recommendations.slice(0, 3)) lines.push(`建议:${rec}`);
  return { bestPlatform, bestHour, totalRecords: records.length, insights: lines };
}

/** 由效果洞察派生的规则建议(确定性、离线可用)。 */
export function ruleStrategySuggestions(
  records: readonly PerformanceRecord[],
  title = "",
): readonly StrategySuggestion[] {
  const ctx = buildStrategyContext(records);
  const out: StrategySuggestion[] = [];
  if (records.length === 0) {
    out.push({
      kind: "topic",
      text: "基于当前内容延续同一主题,做「实操方法 + 案例」型内容",
      reason: "还没有效果数据,先用可复用的实操选题打开局面",
      source: "rule",
    });
    out.push({
      kind: "platform-mix",
      text: "公众号 + 知乎 + 小红书 三平台组合首发",
      reason: "无历史数据时,优先覆盖高转化组合并观察差异",
      source: "rule",
    });
    out.push({
      kind: "timing",
      text: "观察一周数据后固定 2-3 个发布窗口",
      reason: "用数据逐步收敛最佳时段",
      source: "rule",
    });
  } else {
    if (ctx.bestPlatform) {
      out.push({
        kind: "platform-mix",
        text: `把高价值内容优先发布到 ${ctx.bestPlatform}`,
        reason: `该平台当前互动表现最好(${ctx.totalRecords} 条记录中综合得分领先)`,
        platformId: ctx.bestPlatform,
        source: "rule",
      });
    }
    if (ctx.bestHour !== undefined) {
      out.push({
        kind: "timing",
        text: `优先在 ${ctx.bestHour}:00 前后发布`,
        reason: "历史数据显示该时段阅读量最高",
        source: "rule",
      });
    }
    const bestPost = [...records].sort(
      (a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0),
    )[0];
    if (bestPost && (bestPost.metrics.views ?? 0) > 0) {
      out.push({
        kind: "topic",
        text: `参考《${bestPost.title}》的成功要素,做同主题的进阶篇`,
        reason: `它在 ${bestPost.platformId} 获得 ${bestPost.metrics.views} 阅读,是当前最佳样本`,
        platformId: bestPost.platformId,
        source: "rule",
      });
    }
  }
  // 标题选题始终优先(延续当前选题,降低冷启动成本)。
  if (title.trim()) {
    out.unshift({
      kind: "topic",
      text: `围绕「${title.trim().slice(0, 20)}」做系列化输出`,
      reason: "延续当前选题,降低冷启动成本",
      source: "rule",
    });
  }
  // 确保选题/平台/时段三类建议齐全且总数为 3:
  // 1. 用通用默认补足缺失 kind;
  // 2. 若超过 3 条,优先保留缺失 kind,再按出现顺序裁剪。
  const defaults: StrategySuggestion[] = [
    { kind: "topic", text: "拆解一个高频痛点,给出可执行的 3 步解法", reason: "痛点 + 步骤类内容转化稳定", source: "rule" },
    { kind: "platform-mix", text: "主平台精发 + 次平台分发(如公众号精发、知乎/小红书分发)", reason: "把一篇内容的价值最大化", source: "rule" },
    { kind: "timing", text: "观察一周数据后固定 2-3 个发布窗口", reason: "用数据逐步收敛最佳时段", source: "rule" },
  ];
  const kinds = new Set(out.map((s) => s.kind));
  for (const d of defaults) {
    if (kinds.has(d.kind)) continue;
    out.push(d);
    kinds.add(d.kind);
  }
  // 同 kind 去重(保留先出现的,即最具体的那条)。
  const seen = new Set<string>();
  const deduped = out.filter((s) => {
    if (seen.has(s.kind)) return false;
    seen.add(s.kind);
    return true;
  });
  return deduped.slice(0, 3);
}

/** 构造 LLM 发布策略请求。 */
export function strategyRequest(
  records: readonly PerformanceRecord[],
  opts: PublishStrategyOptions,
): LlmRequest {
  const ctx = buildStrategyContext(records);
  const contextLines = [
    ...(ctx.insights.length > 0 ? ctx.insights : ["暂无历史效果数据"]),
    `当前文章标题:${opts.title?.trim() || "(未填写)"}`,
    `当前文章正文摘要:${opts.contentText?.trim().slice(0, 300) || "(空)"}`,
  ].join("\n");
  const prompt = `你是一名资深新媒体运营。基于下面的历史效果洞察与当前文章,给出三条发布策略建议,依次为:
1. 下一篇文章的选题方向(topic);
2. 平台组合建议(platform-mix,从 公众号/知乎/B站/小红书/掘金/CSDN/博客园 中选择);
3. 最佳发布时段(timing,给出具体小时或时段)。

只输出 JSON 数组,每个元素形如 {"kind":"topic|platform-mix|timing","text":"建议内容","reason":"一句话理由","platformId":"可选"}。不要输出 JSON 之外的任何文字。

历史效果与当前内容:
${contextLines}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: 3 },
    systemPrompt: "你是资深新媒体运营策略顾问,只输出结构化 JSON 数组,不加解释。",
    temperature: 0.6,
    maxTokens: 800,
  };
}

/** 宽松解析 LLM 返回的策略建议(JSON 数组;失败回退空数组)。 */
export function parseStrategySuggestions(raw: string): readonly StrategySuggestion[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x): StrategySuggestion | null => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const kind = o["kind"];
        const text = typeof o["text"] === "string" ? o["text"].trim() : "";
        const reason = typeof o["reason"] === "string" ? o["reason"].trim() : "";
        if (kind !== "topic" && kind !== "platform-mix" && kind !== "timing") return null;
        if (!text) return null;
        return {
          kind,
          text,
          reason: reason || "LLM 生成建议",
          ...(typeof o["platformId"] === "string" && o["platformId"] ? { platformId: o["platformId"] } : {}),
          source: "llm",
        } as StrategySuggestion;
      })
      .filter((x): x is StrategySuggestion => x !== null);
  } catch {
    return [];
  }
}

/**
 * 生成发布策略建议。
 *
 * @param llm 可选的 LLM 适配器(不可用/失败时规则兜底)。
 * @param options 标题/正文/效果记录/时钟。
 */
export async function generatePublishStrategy(
  llm: LlmAdapter | undefined,
  options: PublishStrategyOptions = {},
): Promise<PublishStrategyResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const records = options.performanceRecords ?? [];
  const fallback = ruleStrategySuggestions(records, options.title ?? "");
  const useLlm = options.useLlm ?? true;

  if (!useLlm || !llm?.available) {
    return {
      generatedAt,
      usedLlm: false,
      suggestions: fallback,
      summary: "未配置 LLM 或 LLM 不可用,已使用效果数据派生的规则建议",
      fallback,
    };
  }

  try {
    const raw = await llm.run(strategyRequest(records, options));
    const parsed = parseStrategySuggestions(raw);
    if (parsed.length === 0) throw new Error("LLM 返回的建议为空");
    return {
      generatedAt,
      usedLlm: true,
      suggestions: parsed,
      summary: `已生成 ${parsed.length} 条 LLM 发布策略建议(选题/平台组合/发布时段)`,
      fallback,
    };
  } catch {
    return {
      generatedAt,
      usedLlm: false,
      suggestions: fallback,
      summary: "LLM 策略生成失败,已回退到效果数据派生的规则建议",
      fallback,
    };
  }
}
