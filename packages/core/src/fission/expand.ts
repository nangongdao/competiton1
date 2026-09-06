/**
 * FISSION-02 短内容长文扩写 + 热点选题生成(One-Click Multiplication 进阶)。
 *
 * - 一句话 / 一个链接 → 深度博客或公众号文章骨架(标题 / 摘要 / 大纲 / 引言 / 要点);
 * - 全网热点追踪与选题生成:输入候选热点 + 账号定位,派生可落地的选题与大纲。
 *
 * 设计原则:
 * - 规则版确定性、离线可用;LLM 可用时叠加增强,失败自动回退规则;
 * - 产物为「结构化骨架 + Markdown 大纲」,后续可直接进编辑器继续创作;
 * - 纯函数可单测。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { plainTextOf } from "./fission.js";

/** 扩写结果。 */
export interface ExpandedArticle {
  /** 建议标题。 */
  readonly title: string;
  /** 一句话摘要。 */
  readonly summary: string;
  /** Markdown 大纲(## 小节)。 */
  readonly outline: string;
  /** 引言段。 */
  readonly intro: string;
  /** 是否使用了 LLM。 */
  readonly usedLlm: boolean;
  /** 生成时间。 */
  readonly generatedAt: string;
}

/** 扩写选项。 */
export interface ExpandOptions {
  /** 期望体裁:公众号深度文 / 技术博客。 */
  readonly genre?: "wechat" | "blog";
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM(默认 true)。 */
  readonly useLlm?: boolean;
}

/** 从一句话提取关键词(规则):提取连续中文/英文词,切分为 2-4 字窗口。 */
function extractSeedWords(seed: string): readonly string[] {
  const stop = new Set(["一个", "这个", "那个", "我们", "你们", "他们", "可以", "就是", "还是", "因为", "所以", "但是", "如果", "然后", "已经", "没有", "什么", "怎么", "如何", "进行", "以及", "对于", "关于", "通过", "使用", "需要", "自己", "这些", "那些", "这样", "那样", "方法", "内容", "文章", "下面", "以上", "以下", "这里", "那里", "正在", "改变", "创作", "的方式", "方式"]);
  const clean = plainTextOf(seed);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (w: string) => {
    if (stop.has(w) || seen.has(w) || w.length < 2) return;
    seen.add(w);
    out.push(w);
  };
  // 连续中文串切成 2-4 字窗口(每次步进 2,保留语义)。
  for (const run of clean.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (run.length <= 4) {
      push(run);
    } else {
      for (let i = 0; i + 2 <= run.length && out.length < 4; i += 2) {
        push(run.slice(i, i + 4));
      }
    }
    if (out.length >= 4) break;
  }
  // 英文/数字词。
  for (const w of clean.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []) {
    push(w);
    if (out.length >= 4) break;
  }
  return out.slice(0, 3);
}

/** 规则版扩写(骨架 + 大纲,确定性、离线可用)。 */
export function expandShortContent(
  seed: string,
  options: ExpandOptions = {},
): ExpandedArticle {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const genre = options.genre ?? "wechat";
  const clean = plainTextOf(seed).slice(0, 120);
  const words = extractSeedWords(clean);
  const topic = words.length > 0 ? words.join("、") : "这个话题";
  const title =
    genre === "wechat"
      ? `${clean.slice(0, 24)}:一次讲透${topic}的关键方法论`
      : `深入理解${topic}:原理、实践与踩坑指南`;
  const summary = `围绕「${clean.slice(0, 40)}」展开,系统梳理${topic}的背景、核心方法与可落地实践,帮助你从 0 到 1 建立完整认知。`;
  const outline = [
    `## 为什么${topic}值得关注`,
    `## ${topic}的核心概念与原理`,
    `## ${topic}的实操步骤(附案例)`,
    `## 常见误区与避坑建议`,
    `## 总结与下一步行动`,
  ].join("\n");
  const intro = `在开始之前,我们先明确一个问题:为什么「${clean.slice(0, 30)}」会反复被提起?\n\n因为它在日常工作中越来越高频地出现,却很少有人把它讲清楚。本文将从背景、原理、实操三个层面,一次性把${topic}讲透。`;
  return { title, summary, outline, intro, usedLlm: false, generatedAt };
}

/** LLM 扩写请求。 */
export function expandLlmRequest(seed: string, options: ExpandOptions): LlmRequest {
  const genre = options.genre ?? "wechat";
  const prompt = `请把下面这句简短输入扩写成一篇深度${genre === "blog" ? "技术博客" : "公众号文章"}的结构化骨架。只输出 JSON 对象,格式:
{"title":"建议标题(≤30字)","summary":"一句话摘要(≤60字)","outline":"Markdown 大纲(5-7个 ## 小节,每节一句话说明内容)","intro":"引言段(150-250字)"}
不要输出 JSON 之外的任何文字。

简短输入:${seed.trim().slice(0, 200)}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: 1, maxChars: 60 },
    systemPrompt: "你是深度内容创作助手,只输出结构化 JSON,不加解释。",
    temperature: 0.6,
    maxTokens: 1200,
  };
}

/** 宽松解析 LLM 扩写结果(失败返回 null)。 */
export function parseExpandJson(raw: string): {
  title?: string;
  summary?: string;
  outline?: string;
  intro?: string;
} | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const title = typeof obj["title"] === "string" ? obj["title"].trim() : "";
    const summary = typeof obj["summary"] === "string" ? obj["summary"].trim() : "";
    const outline = typeof obj["outline"] === "string" ? obj["outline"].trim() : "";
    const intro = typeof obj["intro"] === "string" ? obj["intro"].trim() : "";
    if (!title && !outline) return null;
    return {
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      ...(outline ? { outline } : {}),
      ...(intro ? { intro } : {}),
    };
  } catch {
    return null;
  }
}

/** LLM 增强版扩写(失败自动回退规则)。 */
export async function expandShortContentWithLlm(
  seed: string,
  llm: LlmAdapter | undefined,
  options: ExpandOptions = {},
): Promise<ExpandedArticle> {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const rule = expandShortContent(seed, options);
  const useLlm = options.useLlm ?? true;
  if (!useLlm || !llm?.available) return rule;
  try {
    const raw = await llm.run(expandLlmRequest(seed, options));
    const parsed = parseExpandJson(raw);
    if (!parsed) throw new Error("扩写结果为空");
    return {
      title: parsed.title ?? rule.title,
      summary: parsed.summary ?? rule.summary,
      outline: parsed.outline ?? rule.outline,
      intro: parsed.intro ?? rule.intro,
      usedLlm: true,
      generatedAt,
    };
  } catch {
    return rule;
  }
}

/** 热点选题建议。 */
export interface TopicSuggestion {
  /** 热点原文(标题)。 */
  readonly hot: string;
  /** 关联平台(可选)。 */
  readonly platformId?: string;
  /** 建议选题标题。 */
  readonly title: string;
  /** 一句话理由(结合账号定位)。 */
  readonly reason: string;
  /** 内容大纲(3-5 条要点)。 */
  readonly outline: readonly string[];
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
}

/** 账号定位。 */
export interface AccountPositioning {
  /** 领域(如「效率工具」「职场成长」)。 */
  readonly niche?: string;
  /** 目标读者画像(可选)。 */
  readonly audience?: string;
  /** 内容风格(可选)。 */
  readonly style?: string;
}

/** 从热点 + 账号定位派生选题(规则版)。 */
export function deriveTopicSuggestions(
  hots: readonly string[],
  positioning: AccountPositioning = {},
  max = 3,
): readonly TopicSuggestion[] {
  const niche = positioning.niche?.trim() || "该领域";
  const audience = positioning.audience?.trim() || "目标读者";
  const out: TopicSuggestion[] = [];
  for (const hot of hots.slice(0, max)) {
    const clean = hot.trim().slice(0, 40);
    out.push({
      hot: clean,
      title: `从「${clean}」看${niche}:3 个值得关注的信号`,
      reason: `热点「${clean}」与账号定位(${niche})相关度高,蹭热点 + 专业解读容易出圈`,
      outline: [`热点「${clean}」到底发生了什么`, `${niche}视角下的关键解读`, `给${audience}的 3 个行动建议`, "总结与延伸阅读"],
      source: "rule",
    });
  }
  return out;
}

/** 热点选题 LLM 请求。 */
export function topicSuggestionsLlmRequest(
  hots: readonly string[],
  positioning: AccountPositioning,
): LlmRequest {
  const prompt = `你是一名资深新媒体选题策划。结合下面的账号定位与候选热点,给出 ${Math.min(hots.length, 3)} 条选题建议。只输出 JSON 数组,每个元素形如:
{"title":"建议选题标题","reason":"一句话理由(结合账号定位)","outline":["要点1","要点2","要点3"]}
不要输出 JSON 之外的任何文字。

账号定位:领域=${positioning.niche || "未指定"}、目标读者=${positioning.audience || "未指定"}、风格=${positioning.style || "未指定"}
候选热点:
${hots.slice(0, 6).map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: Math.min(hots.length, 3) },
    systemPrompt: "你是新媒体选题策划,只输出结构化 JSON 数组,不加解释。",
    temperature: 0.7,
    maxTokens: 1000,
  };
}

/** 宽松解析 LLM 选题结果(失败返回空数组)。 */
export function parseTopicSuggestions(raw: string): readonly Omit<TopicSuggestion, "hot" | "source">[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x): Omit<TopicSuggestion, "hot" | "source"> | null => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const title = typeof o["title"] === "string" ? o["title"].trim() : "";
        const reason = typeof o["reason"] === "string" ? o["reason"].trim() : "";
        const outline = Array.isArray(o["outline"])
          ? (o["outline"] as unknown[]).map((t) => String(t).trim()).filter((t) => t.length > 0).slice(0, 6)
          : [];
        if (!title) return null;
        return { title, reason: reason || "LLM 选题建议", outline };
      })
      .filter((x): x is Omit<TopicSuggestion, "hot" | "source"> => x !== null);
  } catch {
    return [];
  }
}

/** 结合热点的选题生成入口(LLM 失败自动回退规则)。 */
export async function generateTopicSuggestions(
  hots: readonly string[],
  positioning: AccountPositioning = {},
  llm: LlmAdapter | undefined,
  options: { max?: number; useLlm?: boolean } = {},
): Promise<readonly TopicSuggestion[]> {
  const max = options.max ?? 3;
  const rule = deriveTopicSuggestions(hots, positioning, max);
  if (options.useLlm === false || !llm?.available || hots.length === 0) return rule;
  try {
    const raw = await llm.run(topicSuggestionsLlmRequest(hots, positioning));
    const parsed = parseTopicSuggestions(raw);
    if (parsed.length === 0) throw new Error("选题为空");
    return parsed.slice(0, max).map((p, i) => ({
      ...p,
      hot: hots[i] ?? hots[0] ?? "热点",
      source: "llm",
    }));
  } catch {
    return rule;
  }
}
