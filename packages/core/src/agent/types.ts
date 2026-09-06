/**
 * AI 自动完成 Agent —— 契约类型。
 *
 * 让大模型"自动完成相关事宜"的端到端编排层:
 * 分析文章 → 自动修复 → 多平台标题/摘要增强(+ LLM 逐段风格改写)→ 校验复核 → 产出报告。
 * 全程每步失败独立回退、LLM 不可用时纯规则兜底,绝不阻断发布链路。
 */
import type { ContentSuggestion } from "../assistant/suggestions.js";
import type { VariantOption } from "../assistant/suggestions.js";
import type { LlmAdapter } from "../llm/types.js";
import type { RewrittenParagraph } from "./paragraph-rewrite.js";

/** 平台标题/摘要候选容器。 */
export interface PlatformVariantSet {
  readonly titles: readonly VariantOption[];
  readonly summaries: readonly VariantOption[];
}

/** Agent 编排中单个步骤的产物。 */
export type AgentStepKind =
  | "analyze" // 结构分析(段落/标题/图片/字数/排版分)
  | "fix" // 自动修复建议
  | "enhance" // LLM 标题/摘要增强
  | "verify" // 复检
  | "report"; // 汇总报告

export interface AgentFixStep {
  readonly kind: "fix";
  readonly applied: readonly AppliedFix[];
  /** 有可自动修复但被跳过(超出最大轮次/内容未变化)的条数。 */
  readonly skippedCount: number;
}

export interface AppliedFix {
  readonly id: string;
  readonly description: string;
  /** 修复前原文(供撤销)。 */
  readonly before: string;
  /** 修复后文本。 */
  readonly after: string;
}

export interface AgentEnhanceStep {
  readonly kind: "enhance";
  readonly usedLlm: boolean;
  /** 平台 id -> 生成的标题/摘要候选。 */
  readonly variants: Readonly<Record<string, PlatformVariantSet>>;
  /** 各平台应用的标题/摘要(可为空:默认不自动覆盖,仅产出候选)。 */
  readonly appliedOverrides: Readonly<Record<string, { title?: string; summary?: string }>>;
  /** LLM 逐段风格改写结果(按平台分组;无 LLM / 无可改写段时为空)。 */
  readonly paragraphRewrites: Readonly<Record<string, readonly RewrittenParagraph[]>>;
}

export interface AgentVerifyStep {
  readonly kind: "verify";
  /** 复检后的各平台错误数(0 = 全通过)。 */
  readonly errorCount: number;
  /** 复检后仍存在的错误消息(去重)。 */
  readonly remainingErrors: readonly string[];
  /** 是否全部通过校验。 */
  readonly allPassed: boolean;
}

export interface AgentReportStep {
  readonly kind: "report";
  readonly message: string;
}

export type AgentStep = AgentFixStep | AgentEnhanceStep | AgentVerifyStep | AgentReportStep;

/** 单条建议的处理结果(供 Agent 决定是否应用)。 */
export interface AgentSuggestionAction {
  readonly suggestion: ContentSuggestion;
  /** 是否应用修复。 */
  readonly applied: boolean;
  /** 应用后若内容未变化则视为跳过。 */
  readonly note?: string;
}

/** Agent 输出:完整编排报告,供 UI 分步展示。 */
export interface AutoAgentResult {
  readonly ok: boolean;
  /** 总耗时 ms。 */
  readonly elapsedMs: number;
  /** 是否使用了 LLM(否则纯规则兜底)。 */
  readonly usedLlm: boolean;
  /** 各步骤明细(顺序执行)。 */
  readonly steps: readonly AgentStep[];
  /** 分析摘要。 */
  readonly analysis: {
    readonly charCount: number;
    readonly paragraphCount: number;
    readonly headingCount: number;
    readonly imageCount: number;
    /** 平均排版分(所选平台)。 */
    readonly avgQuality: number;
  };
  /** 修复后的 Markdown(应用了可自动修复建议)。 */
  readonly markdown: string;
  /** 应用了哪些修复(供撤销)。 */
  readonly appliedFixes: readonly AppliedFix[];
  /** 各平台 LLM 增强候选(用户可再选择应用)。 */
  readonly variants: Readonly<Record<string, PlatformVariantSet>>;
  /** LLM 逐段风格改写结果(按平台分组;仅在开启增强且 LLM 可用时产生)。 */
  readonly paragraphRewrites: Readonly<Record<string, readonly RewrittenParagraph[]>>;
  /** 错误信息(ok=false 时)。 */
  readonly error?: string;
}

export interface AutoAgentOptions {
  /** 所选平台(按平台排版分/校验)。 */
  readonly platformIds: readonly string[];
  /** LLM 适配器(不可用则纯规则兜底)。 */
  readonly llm?: LlmAdapter;
  /** 是否自动应用可修复建议(默认 true)。 */
  readonly autoFix?: boolean;
  /** 自动修复最大轮次(每轮应用 fix 后重新派生建议,默认 3)。 */
  readonly maxFixRounds?: number;
  /** 是否生成 LLM 标题/摘要候选(默认 true)。 */
  readonly enhance?: boolean;
  /** 是否自动应用 LLM 生成的标题/摘要到平台覆盖层(默认 false,只产出候选)。 */
  readonly autoApplyOverrides?: boolean;
  /** 是否让 LLM 对正文散文段落做逐段风格改写(默认 true;仅在 LLM 可用且 enhance=true 时生效)。 */
  readonly rewriteParagraphs?: boolean;
  /** 每篇最多改写的段落数(默认 3)。 */
  readonly maxRewriteParagraphs?: number;
  /** AI-INSIGHT-02:任务级采样温度(透传给段落改写等 LLM 调用)。 */
  readonly temperature?: number;
  /** AI-INSIGHT-02:任务级单次最大 token。 */
  readonly maxTokens?: number;
  /** AI-INSIGHT-02:任务级系统提示词。 */
  readonly systemPrompt?: string;
  /** 注入时钟(测试)。 */
  readonly now?: () => number;
}

/** 单篇文档的分析快照。 */
export interface DocumentAnalysis {
  readonly charCount: number;
  readonly paragraphCount: number;
  readonly headingCount: number;
  readonly imageCount: number;
}
