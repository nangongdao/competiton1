/**
 * FISSION-01 一键裂变(One-Click Multiplication) —— AI 内容生成与改写。
 *
 * 解决「一条内容只发一次、铺量成本高」的痛点:
 * - 全网热点追踪与选题生成:输入候选热点 + 账号定位,派生可落地的选题与大纲;
 * - 长内容一键拆解:一篇公众号长文 → 小红书种草文案(带 emoji)/ 微博快讯(带 #话题#)
 *   / 抖音短视频口播脚本;
 * - 短内容长文扩写:一句话 / 一个链接 → 深度博客或公众号文章;
 * - 洗稿与去重(内容矩阵防重):对同一素材做多版本同义改写,降低跨账号内容重复度。
 *
 * 设计原则:
 * - 规则版确定性、离线可用(零密钥闭环);LLM 可用时叠加增强,失败自动回退规则;
 * - 拆解/扩写/改写全部为纯函数,可单测;
 * - 不突破任何平台原创检测机制的承诺:工具只提供内容多版本化的能力,
 *   是否合规使用由用户自行判断(合规与风控由 compliance 模块把关)。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 裂变目标平台/体裁。 */
export type FissionTarget =
  | "xiaohongshu"
  | "weibo"
  | "douyin"
  | "wechat"
  | "blog";

/** 长内容拆解产物。 */
export interface FissionPiece {
  readonly target: FissionTarget;
  /** 目标平台展示名。 */
  readonly label: string;
  /** 内容正文。 */
  readonly text: string;
  /** 建议话题/标签(已按平台格式化,如 "#话题")。 */
  readonly tags: readonly string[];
  /** 建议配图数量(小红书/抖音等)。 */
  readonly suggestedImages?: number;
  /** 是否使用了 LLM。 */
  readonly usedLlm: boolean;
}

/** 一键裂变结果。 */
export interface FissionResult {
  readonly sourceTitle: string;
  readonly pieces: readonly FissionPiece[];
  /** 生成时间。 */
  readonly generatedAt: string;
}

/** 拆解选项。 */
export interface FissionOptions {
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM(默认 true;false 时仅规则)。 */
  readonly useLlm?: boolean;
}

/** 从长文提取纯文本(去 Markdown 标记)。 */
export function plainTextOf(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#|~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 提取第一条小标题/要点(用于摘要)。 */
function firstHeading(markdown: string): string | undefined {
  const m = markdown.match(/^##\s+(.+)$/m);
  return m?.[1]?.trim();
}

/** 提取全部小标题(用于拆要点)。 */
function extractHeadings(markdown: string): readonly string[] {
  return [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 6);
}

/** 常用 emoji 池(规则拆解使用)。 */
const EMOJI_POOL = ["✨", "🔥", "💡", "🎯", "📌", "💫", "⭐", "🚀"];

/** 小红书种草文案(规则版):标题 + emoji 点缀 + 话题标签。 */
export function ruleXiaohongshuDraft(
  title: string,
  markdown: string,
  opts: { maxChars?: number } = {},
): { text: string; tags: readonly string[] } {
  const max = opts.maxChars ?? 1000;
  const body = plainTextOf(markdown);
  const heading = firstHeading(markdown) ?? body.slice(0, 60);
  const e1 = EMOJI_POOL[0]!;
  const e2 = EMOJI_POOL[1]!;
  const core = body.length > 200 ? `${body.slice(0, 180)}…` : body;
  const tags = deriveHashTags(title, body, 4);
  let text = `${title}${e1}\n\n${core}\n\n要点:${heading}\n${e2}`;
  text = text.slice(0, max);
  return { text, tags };
}

/** 微博快讯(规则版):#话题# + 一句话导语 + 正文摘要。 */
export function ruleWeiboFlash(
  title: string,
  markdown: string,
  opts: { maxChars?: number } = {},
): { text: string; tags: readonly string[] } {
  const max = opts.maxChars ?? 140;
  const body = plainTextOf(markdown);
  const tags = deriveHashTags(title, body, 2);
  const tagText = tags.length > 0 ? ` ${tags.map((t) => `#${t}#`).join(" ")}` : "";
  let text = `${title}。${body.slice(0, 60)}${tagText}`;
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return { text, tags: tags.map((t) => `#${t}#`) };
}

/** 抖音短视频口播脚本(规则版):钩子开场 + 3 个要点 + 行动号召。 */
export function ruleDouyinScript(
  title: string,
  markdown: string,
  opts: { maxChars?: number } = {},
): { text: string; tags: readonly string[] } {
  const max = opts.maxChars ?? 400;
  const body = plainTextOf(markdown);
  const points = extractHeadings(markdown);
  const bullets =
    points.length > 0
      ? points.map((p, i) => `${i + 1}. ${p}`).join("\n")
      : `1. ${body.slice(0, 40)}\n2. ${body.slice(40, 80)}\n3. ${body.slice(80, 120)}`;
  const tags = deriveHashTags(title, body, 3);
  let text = `【开场钩子】今天聊一个很多人忽略的点:${title}\n\n【核心要点】\n${bullets}\n\n【结尾】觉得有用就点赞收藏,评论区聊聊你的看法!${tags.map((t) => `#${t}`).join(" ")}`;
  text = text.slice(0, max);
  return { text, tags: tags.map((t) => `#${t}`) };
}

/** 提取话题标签(规则版):标题词 + 高频词,去停用词)。 */
export function deriveHashTags(title: string, body: string, max = 4): readonly string[] {
  const stop = new Set([
    "一个", "这个", "那个", "我们", "你们", "他们", "可以", "就是", "还是", "因为", "所以",
    "但是", "如果", "然后", "已经", "没有", "什么", "怎么", "如何", "进行", "以及", "对于",
    "关于", "通过", "使用", "需要", "自己", "这些", "那些", "这样", "那样", "方法", "内容",
    "文章", "下面", "以上", "以下", "这里", "那里", "今天", "一个", "分享",
  ]);
  const freq = new Map<string, number>();
  const text = `${title} ${title} ${body}`;
  const tokens = (text.match(/[\u4e00-\u9fa5]{2,4}|[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []) as string[];
  for (const tok of tokens) {
    if (stop.has(tok)) continue;
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

/** 长内容一键拆解入口。 */
export function fissionLongContent(
  title: string,
  markdown: string,
  llm: LlmAdapter | undefined,
  options: FissionOptions = {},
): FissionResult {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const xhs = ruleXiaohongshuDraft(title, markdown);
  const wb = ruleWeiboFlash(title, markdown);
  const dy = ruleDouyinScript(title, markdown);
  const useLlm = options.useLlm ?? true;

  // 规则版始终可用;LLM 可用时异步增强(由 caller 选择同步规则版或 await 增强版)。
  const pieces: FissionPiece[] = [
    {
      target: "xiaohongshu",
      label: "小红书种草文案",
      text: xhs.text,
      tags: xhs.tags,
      suggestedImages: 3,
      usedLlm: false,
    },
    {
      target: "weibo",
      label: "微博快讯",
      text: wb.text,
      tags: wb.tags,
      usedLlm: false,
    },
    {
      target: "douyin",
      label: "抖音口播脚本",
      text: dy.text,
      tags: dy.tags,
      suggestedImages: 1,
      usedLlm: false,
    },
  ];

  if (!useLlm || !llm?.available) {
    return { sourceTitle: title, pieces, generatedAt };
  }
  // LLM 增强是异步流程,规则版先返回(见 fissionWithLlm)。
  return { sourceTitle: title, pieces, generatedAt };
}

/** LLM 一键裂变请求(一次请求出三平台,供增强路径)。 */
export function fissionLlmRequest(title: string, markdown: string): LlmRequest {
  const body = plainTextOf(markdown).slice(0, 1200);
  const prompt = `你是一名资深新媒体运营。把下面这篇长文拆解为三个平台的发布文案,只输出 JSON 对象,格式:
{"xiaohongshu":{"text":"小红书种草文案(闺蜜语气,带emoji,≤1000字)","tags":["话题1","话题2"]},"weibo":{"text":"微博快讯(≤140字,带#话题#)","tags":["#话题#"]},"douyin":{"text":"抖音口播脚本(钩子开场+3要点+行动号召,≤400字)","tags":["#话题"]}}
不要输出 JSON 之外的任何文字。

文章标题:${title.trim() || "(未命名)"}
文章正文:
${body}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: 3 },
    systemPrompt: "你是新媒体内容裂变助手,只输出结构化 JSON,不加解释。",
    temperature: 0.6,
    maxTokens: 1200,
  };
}

/** 宽松解析 LLM 裂变结果(失败返回 null,调用方回退规则)。 */
export function parseFissionJson(raw: string): {
  xiaohongshu?: { text: string; tags?: string[] };
  weibo?: { text: string; tags?: string[] };
  douyin?: { text: string; tags?: string[] };
} | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const pick = (key: string): { text: string; tags?: string[] } | undefined => {
      const v = obj[key];
      if (!v || typeof v !== "object") return undefined;
      const o = v as Record<string, unknown>;
      const text = typeof o["text"] === "string" ? o["text"].trim() : "";
      if (!text) return undefined;
      const tags = Array.isArray(o["tags"])
        ? (o["tags"] as unknown[]).map((t) => String(t).trim()).filter((t) => t.length > 0).slice(0, 6)
        : undefined;
      return tags && tags.length > 0 ? { text, tags } : { text };
    };
    const xiaohongshu = pick("xiaohongshu");
    const weibo = pick("weibo");
    const douyin = pick("douyin");
    if (!xiaohongshu && !weibo && !douyin) return null;
    return { ...(xiaohongshu ? { xiaohongshu } : {}), ...(weibo ? { weibo } : {}), ...(douyin ? { douyin } : {}) };
  } catch {
    return null;
  }
}

/** LLM 增强版一键裂变(LLM 失败自动逐平台回退规则)。 */
export async function fissionLongContentWithLlm(
  title: string,
  markdown: string,
  llm: LlmAdapter | undefined,
  options: FissionOptions = {},
): Promise<FissionResult> {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const rule = fissionLongContent(title, markdown, undefined, { now: options.now, useLlm: false });
  const rulePieces = new Map(rule.pieces.map((p) => [p.target, p]));
  const useLlm = options.useLlm ?? true;

  if (!useLlm || !llm?.available) {
    return { sourceTitle: title, pieces: rule.pieces, generatedAt };
  }
  try {
    const raw = await llm.run(fissionLlmRequest(title, markdown));
    const parsed = parseFissionJson(raw);
    if (!parsed) throw new Error("LLM 裂变结果为空");
    const pieces: FissionPiece[] = [];
    const specs: Array<[FissionTarget, { text: string; tags?: string[] } | undefined]> = [
      ["xiaohongshu", parsed.xiaohongshu],
      ["weibo", parsed.weibo],
      ["douyin", parsed.douyin],
    ];
    for (const [target, v] of specs) {
      const base = rulePieces.get(target)!;
      if (v && v.text) {
        pieces.push({ ...base, text: v.text.slice(0, 1000), tags: v.tags ?? base.tags, usedLlm: true });
      } else {
        pieces.push(base);
      }
    }
    return { sourceTitle: title, pieces, generatedAt };
  } catch {
    return { sourceTitle: title, pieces: rule.pieces, generatedAt };
  }
}
