/**
 * LOCALIZE-01 AI 跨平台「本土化」适配。
 *
 * 同一篇内容在不同平台有不同的文风与表达习惯,本模块自动调整语气与风格:
 * - 小红书版:闺蜜语气,多 emoji,强调「绝绝子」「按头安利」式表达;
 * - 知乎版:专业客观,逻辑严密,引用来源;
 * - 领英版:职场商务,强调行业洞察与个人成长;
 * - 微信公众号 / 微博 / 抖音 等平台也提供风格适配。
 *
 * 设计原则:
 * - 规则版确定性、离线可用(emoji 点缀 + 语气词 + 句式模板);
 * - LLM 可用时叠加增强,失败自动回退规则;
 * - 输出带平台风格说明,便于用户理解改了什么。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { plainTextOf } from "../fission/fission.js";

/** 目标平台风格。 */
export type LocalizeTarget =
  | "xiaohongshu"
  | "zhihu"
  | "linkedin"
  | "wechat"
  | "weibo"
  | "douyin";

/** 平台风格配置。 */
export interface LocalizeProfile {
  readonly id: LocalizeTarget;
  /** 平台展示名。 */
  readonly label: string;
  /** 语气描述。 */
  readonly tone: string;
  /** 长度上限。 */
  readonly maxChars: number;
  /** emoji 池(规则版点缀)。 */
  readonly emojis: readonly string[];
  /** 语气词(规则版注入)。 */
  readonly fillers: readonly string[];
}

/** 平台风格配置表。 */
export const LOCALIZE_PROFILES: Readonly<Record<LocalizeTarget, LocalizeProfile>> = {
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    tone: "闺蜜语气,多 emoji,强调「绝绝子」「按头安利」",
    maxChars: 1000,
    emojis: ["✨", "🔥", "💖", "🎀", "💫"],
    fillers: ["家人们", "真的绝了", "按头安利", "谁懂啊", "冲就完了"],
  },
  zhihu: {
    id: "zhihu",
    label: "知乎",
    tone: "专业客观,逻辑严密,引用来源",
    maxChars: 3000,
    emojis: [],
    fillers: ["首先", "其次", "综上所述", "值得注意的是"],
  },
  linkedin: {
    id: "linkedin",
    label: "领英",
    tone: "职场商务,强调行业洞察与个人成长",
    maxChars: 1500,
    emojis: ["📈", "💼", "🤝", "🚀"],
    fillers: ["在我看来", "从行业趋势看", "值得关注的是", "与各位同行探讨"],
  },
  wechat: {
    id: "wechat",
    label: "微信公众号",
    tone: "专业亲和,结构清晰,适度口语化",
    maxChars: 10000,
    emojis: ["💡", "📌", "✅"],
    fillers: ["需要说明的是", "换个角度看"],
  },
  weibo: {
    id: "weibo",
    label: "微博",
    tone: "短平快,观点鲜明,带话题",
    maxChars: 140,
    emojis: ["🔥", "💥", "⚡"],
    fillers: ["划重点", "转发周知"],
  },
  douyin: {
    id: "douyin",
    label: "抖音",
    tone: "口语化,节奏快,有钩子",
    maxChars: 400,
    emojis: ["🎬", "📣", "👇", "💥"],
    fillers: ["听我说", "重点来了", "收藏不亏"],
  },
};

/** 本地化结果。 */
export interface LocalizedContent {
  readonly target: LocalizeTarget;
  /** 平台展示名。 */
  readonly label: string;
  /** 本地化后的正文。 */
  readonly text: string;
  /** 建议话题/标签(已按平台格式化)。 */
  readonly tags: readonly string[];
  /** 风格说明(改了什么)。 */
  readonly styleNotes: readonly string[];
  /** 是否使用了 LLM。 */
  readonly usedLlm: boolean;
}

/** 本地化选项。 */
export interface LocalizeOptions {
  /** 是否保留 Markdown 结构(默认 false:纯文本适配)。 */
  readonly keepMarkdown?: boolean;
  /** 注入时钟(测试用,预留)。 */
  readonly now?: () => string;
  /** 是否启用 LLM(默认 true)。 */
  readonly useLlm?: boolean;
}

/** 从正文提取话题(规则版)。 */
function deriveTags(title: string, text: string, max = 4): readonly string[] {
  const stop = new Set([
    "一个", "这个", "那个", "我们", "你们", "他们", "可以", "就是", "还是", "因为", "所以",
    "但是", "如果", "然后", "已经", "没有", "什么", "怎么", "如何", "进行", "以及", "对于",
    "关于", "通过", "使用", "需要", "自己", "这些", "那些", "这样", "那样", "方法", "内容",
    "文章", "下面", "以上", "以下", "这里", "那里", "今天", "分享",
  ]);
  const freq = new Map<string, number>();
  const tokens = (`${title} ${title} ${text}`.match(/[\u4e00-\u9fa5]{2,4}|[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []) as string[];
  for (const tok of tokens) {
    if (stop.has(tok)) continue;
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
}

/** 在段落/句子间点缀 emoji 与语气词(规则版)。 */
function injectStyle(text: string, profile: LocalizeProfile): string {
  let out = text;
  // 句子结尾点缀 emoji(小红书/抖音/微博;知乎/领英不点缀)。
  if (profile.emojis.length > 0) {
    const sentences = out.split(/(?<=[。！？!?])/);
    out = sentences
      .map((s, i) => {
        const t = s.trim();
        if (!t) return s;
        if (/[。！？!?]$/.test(t) && i % 2 === 0) {
          const e = profile.emojis[i % profile.emojis.length]!;
          return `${t}${e}`;
        }
        return s;
      })
      .join("");
  }
  // 开头注入语气词。
  if (profile.fillers.length > 0 && out.length > 20) {
    const f = profile.fillers[0]!;
    if (!out.startsWith(f)) out = `${f},${out}`;
  }
  return out;
}

/** 规则版平台本地化(确定性、离线可用)。 */
export function localizeContentRule(
  title: string,
  markdown: string,
  target: LocalizeTarget,
  _options: LocalizeOptions = {},
): LocalizedContent {
  const profile = LOCALIZE_PROFILES[target];
  const text = plainTextOf(markdown);
  const tags = deriveTags(title, text);
  let body: string;

  switch (target) {
    case "xiaohongshu": {
      const core = text.length > 180 ? `${text.slice(0, 160)}…` : text;
      body = injectStyle(`${title}✨\n\n${core}`, profile);
      break;
    }
    case "zhihu": {
      body = `先说结论:${text.slice(0, 120)}\n\n${injectStyle(text, profile)}`;
      break;
    }
    case "linkedin": {
      body = `【行业观察】${title}\n\n${injectStyle(text, profile)}`;
      break;
    }
    case "weibo": {
      const tagText = tags.slice(0, 2).map((t) => `#${t}#`).join(" ");
      body = `${injectStyle(`${title}。${text.slice(0, 60)}`, profile)} ${tagText}`.trim();
      break;
    }
    case "douyin": {
      body = injectStyle(`【${title}】\n${text.slice(0, 200)}`, profile);
      break;
    }
    default: {
      body = injectStyle(text, profile);
    }
  }

  const maxChars = profile.maxChars;
  body = body.slice(0, maxChars);

  const styleNotes: readonly string[] = [
    `已按「${profile.label}」平台风格适配:${profile.tone}`,
    ...(target === "xiaohongshu" ? ["已添加 emoji 点缀与闺蜜语气词", "已派生话题标签"] : []),
    ...(target === "zhihu" ? ["已补充「先说结论」式专业开头", "保留客观论证结构"] : []),
    ...(target === "linkedin" ? ["已补充职场商务开场与行业视角", "强调个人成长价值"] : []),
  ];

  return {
    target,
    label: profile.label,
    text: body,
    tags: target === "weibo" || target === "xiaohongshu" ? tags.map((t) => `#${t}#`) : tags,
    styleNotes,
    usedLlm: false,
  };
}

/** LLM 平台本地化请求。 */
export function localizeLlmRequest(
  title: string,
  markdown: string,
  target: LocalizeTarget,
): LlmRequest {
  const profile = LOCALIZE_PROFILES[target];
  const text = plainTextOf(markdown).slice(0, 1200);
  const prompt = `你是资深新媒体运营。请把下面的内容改写为「${profile.label}」平台风格的版本。
平台要求:${profile.tone}。长度不超过 ${profile.maxChars} 字。
输出 JSON 对象,格式:
{"text":"改写后的正文","tags":["#话题1","#话题2"(可选,按平台惯例)]}
只输出 JSON,不要输出其它文字。

原标题:${title.trim() || "(未命名)"}
原文:
${text}`;
  return {
    task: "rewrite",
    platformId: target,
    input: prompt,
    constraints: { maxChars: profile.maxChars, variantCount: 1 },
    systemPrompt: `你是${profile.label}平台内容风格适配助手,只输出结构化 JSON,不加解释。`,
    temperature: 0.7,
    maxTokens: 1200,
  };
}

/** 宽松解析 LLM 本地化结果(失败返回 null)。 */
export function parseLocalizeJson(raw: string): { text?: string; tags?: string[] } | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const text = typeof obj["text"] === "string" ? obj["text"].trim() : "";
    if (!text) return null;
    const tags = Array.isArray(obj["tags"])
      ? (obj["tags"] as unknown[]).map((t) => String(t).trim()).filter((t) => t.length > 0).slice(0, 6)
      : undefined;
    return tags && tags.length > 0 ? { text, tags } : { text };
  } catch {
    return null;
  }
}

/** LLM 增强版本地化(失败自动回退规则)。 */
export async function localizeContent(
  title: string,
  markdown: string,
  target: LocalizeTarget,
  llm: LlmAdapter | undefined,
  options: LocalizeOptions = {},
): Promise<LocalizedContent> {
  const rule = localizeContentRule(title, markdown, target, options);
  if (options.useLlm === false || !llm?.available) return rule;
  try {
    const raw = await llm.run(localizeLlmRequest(title, markdown, target));
    const parsed = parseLocalizeJson(raw);
    if (!parsed?.text) throw new Error("LLM 本地化结果为空");
    const profile = LOCALIZE_PROFILES[target];
    return {
      target,
      label: profile.label,
      text: parsed.text.slice(0, profile.maxChars),
      tags: parsed.tags ?? rule.tags,
      styleNotes: [`已按「${profile.label}」平台风格 LLM 改写:${profile.tone}`, ...rule.styleNotes],
      usedLlm: true,
    };
  } catch {
    return rule;
  }
}
