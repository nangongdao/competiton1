/**
 * OPT-01 / OPT-02 —— 内容优化建议与最佳发布时间学习。
 *
 * v8 Phase 3「内容优化建议」:
 * - **OPT-01 `deriveContentSuggestions`**:结合效果回收数据与当前内容特征
 *   (标题/正文字数/图片数/排版评分),派生出可执行的优化建议(可一键应用,
 *   可撤销),LLM 可用时在规则基础上生成增强建议,失败自动回退规则;
 * - **OPT-02 `bestTimeFromRecords`**:从历史效果记录学习最佳发布时段
 *   (按小时聚合阅读量,兼顾互动),纯函数、缺数据安全回退。
 *
 * 设计约束(与 v8 一致):
 * - 纯 TS 零 DOM;本地计算不上传;
 * - 建议可执行、脱敏(不含 remoteUrl/remoteId/token);
 * - 建议应用为确定性文本变换(标题截断/拆段/补空行/插入小标题),可撤销。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance, bestPostingHour } from "../analytics/insights.js";
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { graphemeCount } from "../transforms/grapheme-count.js";
import { plainTextOfMarkdown } from "../insight/draft-index.js";

/** 内容优化建议的严重度。 */
export type OptimizeSeverity = "error" | "warning" | "info";

/** 优化建议(带可执行修复动作)。 */
export interface ContentOptimizeSuggestion {
  readonly id: string;
  /** 建议分类:title / body / image / heading / timing / strategy / data-gap / llm。 */
  readonly kind:
    | "title"
    | "body"
    | "image"
    | "heading"
    | "timing"
    | "strategy"
    | "data-gap"
    | "llm";
  readonly severity: OptimizeSeverity;
  /** 一句话建议(人类可读)。 */
  readonly message: string;
  /** 可选修复动作(apply 为确定性文本变换,可撤销)。 */
  readonly fix?: {
    readonly kind: "truncate-title" | "split-paragraph" | "insert-heading" | "collapse-blank-lines";
    /** 变换描述(供 UI 展示)。 */
    readonly description: string;
    /** 对整篇 Markdown 应用变换(纯文本变换)。 */
    readonly apply: (markdown: string) => string;
  };
  /** 来源:rule / llm。 */
  readonly source: "rule" | "llm";
}

/** 最佳发布时段(OPT-02)。 */
export interface BestTimeLearning {
  /** 是否有足够数据学习。 */
  readonly hasData: boolean;
  /** 推荐发布时间小时(UTC,0-23);无数据为 null。 */
  readonly hour: number | null;
  /** 该小时的历史阅读量;无数据为 0。 */
  readonly views: number;
  /** 该小时的历史记录条数。 */
  readonly count: number;
  /** 学习到的时段说明。 */
  readonly description: string;
  /** 各小时聚合明细(升序),供 UI 展示分布。 */
  readonly buckets: readonly { hour: number; views: number; count: number }[];
}

/** 内容优化建议结果。 */
export interface ContentOptimizeResult {
  readonly generatedAt: string;
  /** 建议列表(规则 + 可选 LLM 增强,去重)。 */
  readonly suggestions: readonly ContentOptimizeSuggestion[];
  /** 可一键应用的建议数。 */
  readonly fixableCount: number;
  /** 是否使用了 LLM(否则纯规则)。 */
  readonly usedLlm: boolean;
  /** 供 UI 展示的摘要。 */
  readonly summary: string;
  /** 最佳发布时段学习结果(OPT-02)。 */
  readonly bestTime: BestTimeLearning;
}

export interface ContentOptimizeOptions {
  /** 当前文章标题。 */
  readonly title?: string;
  /** 当前文章正文 Markdown。 */
  readonly markdown?: string;
  /** 效果记录(为空时给出数据引导建议)。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM 增强(默认 true)。 */
  readonly useLlm?: boolean;
}

// ---------------------------------------------------------------------------
// OPT-02 最佳发布时间学习
// ---------------------------------------------------------------------------

/** 从历史效果记录学习最佳发布时段(按小时聚合阅读,兼顾互动)。 */
export function bestTimeFromRecords(
  records: readonly PerformanceRecord[],
): BestTimeLearning {
  if (records.length === 0) {
    return {
      hasData: false,
      hour: null,
      views: 0,
      count: 0,
      description: "还没有效果记录,暂无法学习最佳发布时段。请先在「效果回收」录入或导入数据。",
      buckets: [],
    };
  }

  // 复用 insights 的按小时聚合(UTC 小时),保证与发布策略/排期建议口径一致。
  const bestHour = bestPostingHour(records);

  // 同时构建完整分桶(便于 UI 展示分布与学习依据)。
  const byHour = new Map<number, { views: number; count: number }>();
  for (const r of records) {
    const ts = Date.parse(r.publishedAt ?? r.collectedAt);
    if (!Number.isFinite(ts)) continue;
    const hour = new Date(ts).getUTCHours();
    const cur = byHour.get(hour) ?? { views: 0, count: 0 };
    cur.views += r.metrics.views ?? 0;
    cur.count += 1;
    byHour.set(hour, cur);
  }
  if (byHour.size === 0) {
    return {
      hasData: false,
      hour: null,
      views: 0,
      count: 0,
      description: "效果记录缺少可解析的发布时间,暂无法学习最佳发布时段。",
      buckets: [],
    };
  }

  const buckets = [...byHour.entries()]
    .map(([hour, v]) => ({ hour, views: v.views, count: v.count }))
    .sort((a, b) => a.hour - b.hour);
  const peak = [...buckets].sort((a, b) => b.views - a.views)[0]!;

  return {
    hasData: true,
    hour: peak.views > 0 ? peak.hour : (bestHour?.hour ?? null),
    views: peak.views,
    count: peak.count,
    description:
      peak.views > 0
        ? `历史 ${peak.count} 条记录在 ${peak.hour}:00 前后(UTC)获得最多阅读(${peak.views})。`
        : "历史记录暂无阅读数据,建议先回收几篇后再学习。",
    buckets,
  };
}

// ---------------------------------------------------------------------------
// OPT-01 内容优化建议(规则层,确定性)
// ---------------------------------------------------------------------------

/** 规则层内容优化建议:从内容特征 + 效果数据派生。 */
export function ruleContentSuggestions(
  markdown: string,
  title: string,
  records: readonly PerformanceRecord[],
): readonly ContentOptimizeSuggestion[] {
  const out: ContentOptimizeSuggestion[] = [];
  const text = plainTextOfMarkdown(markdown);
  const titleLen = graphemeCount(title.trim());
  const bodyLen = graphemeCount(text);
  const imageCount = (markdown.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length;
  const blankLines = (markdown.match(/\n{3,}/g) ?? []).length;

  // 标题优化:过长 / 缺失。
  if (!title.trim()) {
    out.push({
      id: "opt-title-missing",
      kind: "title",
      severity: "error",
      message: "缺少标题:发布后平台默认以首行/文件名命名,建议补充一个吸引点击的标题。",
      source: "rule",
    });
  } else if (titleLen > 30) {
    out.push({
      id: "opt-title-long",
      kind: "title",
      severity: "warning",
      message: `标题 ${titleLen} 字偏长:多数平台标题最佳区间为 10-30 字,过长会被截断。`,
      fix: {
        kind: "truncate-title",
        description: `把标题截断为前 30 字(当前 ${titleLen} 字)`,
        apply: (md) => {
          const heading = md.match(/^#{1,6}\s+.*$/m);
          if (!heading) return md;
          const idx = heading.index ?? 0;
          const line = heading[0];
          const marker = line.match(/^(#{1,6}\s+)/)?.[1] ?? "";
          const rest = line.slice(marker.length);
          const newRest = graphemeCount(rest) > 30 ? `${[...rest].slice(0, 30).join("")}…` : rest;
          return `${md.slice(0, idx)}${marker}${newRest}${md.slice(idx + line.length)}`;
        },
      },
      source: "rule",
    });
  }

  // 正文优化:过短 / 过长段落 / 多余空行。
  if (bodyLen === 0) {
    out.push({
      id: "opt-body-empty",
      kind: "body",
      severity: "error",
      message: "正文为空:没有可发布的内容,请先撰写正文。",
      source: "rule",
    });
  } else if (bodyLen < 100) {
    out.push({
      id: "opt-body-short",
      kind: "body",
      severity: "warning",
      message: `正文仅 ${bodyLen} 字偏短:除小红书外,各平台对内容深度有要求,建议补充实操细节与案例。`,
      source: "rule",
    });
  } else {
    // 拆段建议:存在超长段落(>150 字)。
    const paras = markdown
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !/^#{1,6}\s/.test(p) && !/^[-*+]\s/.test(p) && !/^```/.test(p));
    const longParas = paras.filter((p) => graphemeCount(p) > 150);
    if (longParas.length > 0) {
      const longest = [...longParas].sort((a, b) => graphemeCount(b) - graphemeCount(a))[0]!;
      const len = graphemeCount(longest);
      out.push({
        id: "opt-body-long-para",
        kind: "body",
        severity: "warning",
        message: `存在 ${len} 字的超长段落:移动端阅读吃力,建议拆成 2-3 个短段(每段 ≤120 字)。`,
        fix: {
          kind: "split-paragraph",
          description: "把最长段落按句号拆成多个短段",
          apply: (md) => splitLongParagraph(md, longest),
        },
        source: "rule",
      });
    }
  }

  // 多余空行压缩。
  if (blankLines > 0) {
    out.push({
      id: "opt-body-blank-lines",
      kind: "body",
      severity: "info",
      message: `正文存在 ${blankLines} 处连续 3 个以上空行:导出/发布时可能产生多余留白。`,
      fix: {
        kind: "collapse-blank-lines",
        description: "把连续 3 个及以上空行压缩为 1 个空行",
        apply: (md) => md.replace(/\n{3,}/g, "\n\n"),
      },
      source: "rule",
    });
  }

  // 配图优化:长文无图(>400 字)。
  if (bodyLen > 400 && imageCount === 0) {
    out.push({
      id: "opt-image-none",
      kind: "image",
      severity: "info",
      message: `正文 ${bodyLen} 字但没有任何配图:公众号/小红书等平台图文比影响完读率,建议穿插配图或信息图。`,
      source: "rule",
    });
  }

  // 小标题建议:长文无标题(>400 字)。
  const headingCount = (markdown.match(/^#{1,6}\s+/gm) ?? []).length;
  if (bodyLen > 400 && headingCount <= 1) {
    out.push({
      id: "opt-heading-structure",
      kind: "heading",
      severity: "warning",
      message: "长文缺少小标题:扫读效率低,建议用 H2/H3 分节(每 300-500 字一个小标题)。",
      source: "rule",
    });
  }

  // 效果数据建议:最佳发布时段 + 最佳平台。
  const insights = analyzePerformance(records);
  if (records.length > 0) {
    const bestTime = bestTimeFromRecords(records);
    if (bestTime.hour !== null) {
      out.push({
        id: "opt-timing-learned",
        kind: "timing",
        severity: "info",
        message: `历史数据显示 ${bestTime.hour}:00 前后(UTC)发布阅读最佳(共 ${bestTime.count} 条记录),建议把发布排期落在该时段。`,
        source: "rule",
      });
    }
    const bestPlatform = insights.ranking[0];
    if (bestPlatform) {
      out.push({
        id: "opt-platform-focus",
        kind: "strategy",
        severity: "info",
        message: `综合表现最好的平台是 ${bestPlatform.platformId}(平均阅读 ${Math.round(bestPlatform.avgViews)} × 互动率 ${(bestPlatform.engagementRate * 100).toFixed(1)}%),建议把高价值内容优先投放到该平台。`,
        source: "rule",
      });
    }
  } else {
    out.push({
      id: "opt-data-gap",
      kind: "data-gap",
      severity: "info",
      message: "还没有效果回收数据:录入或导入几篇效果记录后,这里会给出「最佳发布时间 / 最佳平台」学习建议。",
      source: "rule",
    });
  }

  return out;
}

/** 拆段:按中文句号/英文句点把超长段落拆为多个短段(保序)。 */
function splitLongParagraph(markdown: string, longPara: string): string {
  const sentences = longPara
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    // 无句读可用:按 60 字硬切。
    const chars = [...longPara];
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += 60) chunks.push(chars.slice(i, i + 60).join(""));
    return markdown.replace(longPara, chunks.join("\n\n"));
  }
  // 合并过短片段,尽量每段 40-120 字。
  const merged: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && graphemeCount(cur + s) > 120) {
      merged.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) merged.push(cur.trim());
  return markdown.replace(longPara, merged.join("\n\n"));
}

// ---------------------------------------------------------------------------
// LLM 增强(可选)
// ---------------------------------------------------------------------------

/** 构造 LLM 内容优化请求(返回 JSON 数组建议)。 */
export function contentOptimizeRequest(
  title: string,
  markdown: string,
  records: readonly PerformanceRecord[],
): LlmRequest {
  const insights = analyzePerformance(records);
  const bestTime = bestTimeFromRecords(records);
  const contextLines = [
    `当前标题:${title.trim() || "(未填写)"}`,
    `当前正文摘要:${plainTextOfMarkdown(markdown).slice(0, 400) || "(空)"}`,
    insights.insights.length > 0
      ? `效果洞察:${insights.insights.slice(0, 3).map((i) => i.title).join("; ")}`
      : "效果洞察:暂无",
    bestTime.hour !== null ? `学习到的最佳发布时段:${bestTime.hour}:00(UTC)` : "学习到的最佳发布时段:暂无",
  ].join("\n");
  const prompt = `你是资深新媒体内容优化顾问。基于当前内容与历史效果洞察,给出 3-5 条可执行的优化建议。
每条建议形如 {"kind":"title|body|image|heading|timing|strategy","message":"具体可执行的建议文本"}。
要求:建议具体、可执行、不空洞;不编造事实;涉及时间时用 UTC 小时表达。
只输出 JSON 数组,不要输出其它文字。

当前内容与效果:
${contextLines}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: 5 },
    systemPrompt: "你是内容优化顾问,只输出结构化 JSON 数组,不加解释。",
    temperature: 0.5,
    maxTokens: 800,
  };
}

/** 宽松解析 LLM 返回的优化建议(JSON 数组;失败返回空数组)。 */
export function parseContentOptimizeJson(raw: string): readonly ContentOptimizeSuggestion[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x, idx): ContentOptimizeSuggestion | null => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const kind = o["kind"];
        const message = typeof o["message"] === "string" ? o["message"].trim() : "";
        if (
          kind !== "title" && kind !== "body" && kind !== "image" &&
          kind !== "heading" && kind !== "timing" && kind !== "strategy"
        ) {
          return null;
        }
        if (!message) return null;
        return {
          id: `opt-llm-${idx}`,
          kind,
          severity: "info",
          message,
          source: "llm",
        };
      })
      .filter((x): x is ContentOptimizeSuggestion => x !== null);
  } catch {
    return [];
  }
}

/** 把 LLM 建议与规则建议合并(按 kind+内容去重,保留规则优先,LLM 作为增强补充)。 */
export function mergeOptimizeSuggestions(
  rule: readonly ContentOptimizeSuggestion[],
  llm: readonly ContentOptimizeSuggestion[],
): readonly ContentOptimizeSuggestion[] {
  const seen = new Set<string>();
  const merged: ContentOptimizeSuggestion[] = [];
  for (const s of [...rule, ...llm]) {
    const key = `${s.kind}|${s.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

/**
 * 生成内容优化建议(OPT-01)+ 最佳发布时间学习(OPT-02)。
 *
 * @param llm 可选 LLM(不可用/失败时纯规则)。
 * @param options 标题/正文/效果记录/时钟。
 */
export async function generateContentOptimize(
  llm: LlmAdapter | undefined,
  options: ContentOptimizeOptions = {},
): Promise<ContentOptimizeResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const title = options.title ?? "";
  const markdown = options.markdown ?? "";
  const records = options.performanceRecords ?? [];
  const bestTime = bestTimeFromRecords(records);
  const useLlm = options.useLlm ?? true;

  const rule = ruleContentSuggestions(markdown, title, records);

  if (!useLlm || !llm?.available) {
    return {
      generatedAt,
      suggestions: rule,
      fixableCount: rule.filter((s) => s.fix).length,
      usedLlm: false,
      summary: "已生成内容优化建议(规则模式,未配置 LLM)",
      bestTime,
    };
  }

  try {
    const raw = await llm.run(contentOptimizeRequest(title, markdown, records));
    const llmSuggestions = parseContentOptimizeJson(raw);
    if (llmSuggestions.length === 0) throw new Error("LLM 建议为空");
    const suggestions = mergeOptimizeSuggestions(rule, llmSuggestions);
    return {
      generatedAt,
      suggestions,
      fixableCount: suggestions.filter((s) => s.fix).length,
      usedLlm: true,
      summary: `已生成 ${suggestions.length} 条优化建议(规则 ${rule.length} + LLM 增强 ${llmSuggestions.length})`,
      bestTime,
    };
  } catch {
    return {
      generatedAt,
      suggestions: rule,
      fixableCount: rule.filter((s) => s.fix).length,
      usedLlm: false,
      summary: "LLM 优化建议生成失败,已回退到规则建议",
      bestTime,
    };
  }
}
