/**
 * AI-INSIGHT-03 —— AI 草稿摘要索引与检索。
 *
 * 为每篇草稿生成「摘要 / 关键词 / 主题」索引(LLM 可用时 LLM 生成,否则规则兜底),
 * 并基于索引做轻量**本地 AI 检索**(关键词 + 摘要相关性评分),帮助用户快速定位
 * 旧内容。设计原则:
 *
 * - 纯 TS 零 DOM,索引可持久化(由 app 侧 store 决定落盘方式);
 * - LLM 只负责「自然语言摘要 / 关键词提炼」,检索评分用确定性算法(不依赖 LLM,
 *   离线可用);
 * - 索引不包含 apiKey / token 等敏感字段;数据仅本地。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { graphemeCount } from "../transforms/grapheme-count.js";

/** 一篇草稿的摘要索引。 */
export interface DraftIndex {
  /** 草稿 id。 */
  readonly draftId: string;
  /** 草稿标题。 */
  readonly title: string;
  /** 一句话摘要(规则或 LLM 生成)。 */
  readonly summary: string;
  /** 关键词列表(3-6 个)。 */
  readonly keywords: readonly string[];
  /** 主题标签(可选,如 "效率" / "技术")。 */
  readonly topics?: readonly string[];
  /** 是否由 LLM 生成(否则规则兜底)。 */
  readonly usedLlm: boolean;
  /** 索引创建/更新时间。 */
  readonly indexedAt: string;
}

/** 检索命中。 */
export interface DraftHit {
  readonly draftId: string;
  readonly title: string;
  readonly summary: string;
  /** 相关性评分(0-1,越大越相关)。 */
  readonly score: number;
  /** 命中的关键词。 */
  readonly matchedKeywords: readonly string[];
}

export interface BuildDraftIndexOptions {
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 强制规则模式(跳过 LLM,测试用)。 */
  readonly forceRule?: boolean;
}

export interface SearchDraftIndexesOptions {
  /** 最大返回条数(默认 5)。 */
  readonly limit?: number;
  /** 最低相关分(默认 0.1,低于此分不返回)。 */
  readonly minScore?: number;
}

/** 提取纯文本正文(去 Markdown 标记,用于摘要)。 */
export function plainTextOfMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#|~-]/g, "")
    .replace(/[。！？!?；;\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从标题/正文提取关键词的规则实现(词频 + 标题词)。 */
export function extractKeywords(title: string, content: string, max = 6): readonly string[] {
  const stop = new Set([
    "一个", "这个", "那个", "我们", "你们", "他们", "可以", "就是", "还是", "因为", "所以",
    "但是", "如果", "然后", "已经", "没有", "什么", "怎么", "如何", "进行", "以及", "对于",
    "关于", "通过", "使用", "需要", "自己", "这些", "那些", "这样", "那样", "方法", "内容",
    "文章", "下面", "以上", "以下", "这里", "那里",
  ]);
  const count = new Map<string, number>();
  const tokens = (plainTextOfMarkdown(`${title} ${title} ${content}`).match(/[\u4e00-\u9fa5]{2,4}|[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []) as string[];
  for (const tok of tokens) {
    if (stop.has(tok)) continue;
    count.set(tok, (count.get(tok) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([tok]) => tok);
}

/** 规则的草稿摘要:取首段/标题前若干字。 */
export function ruleDraftSummary(title: string, markdown: string): string {
  const text = plainTextOfMarkdown(markdown);
  if (text.length <= 0) return title.trim() || "未命名草稿";
  const trimmed = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return trimmed || title.trim() || "未命名草稿";
}

/** 构造 LLM 草稿索引请求(摘要 + 关键词 JSON)。 */
export function draftIndexRequest(title: string, markdown: string): LlmRequest {
  const text = plainTextOfMarkdown(markdown).slice(0, 800);
  const prompt = `为以下草稿生成摘要索引。输出 JSON 对象,格式:
{"summary":"一句话摘要(不超过60字)","keywords":["关键词1","关键词2","关键词3"],"topics":["主题标签(可选)"]}
只输出 JSON,不要输出其它文字。

草稿标题:${title.trim() || "(未命名)"}
草稿正文:${text}`;
  return {
    task: "summary",
    platformId: "wechat",
    input: prompt,
    constraints: { maxChars: 60, variantCount: 1 },
    systemPrompt: "你是内容索引助手,只输出结构化 JSON,不加解释。",
    temperature: 0.3,
    maxTokens: 300,
  };
}

/** 宽松解析 LLM 返回的索引 JSON;失败返回 null(调用方回退规则)。 */
export function parseDraftIndexJson(raw: string): {
  summary?: string;
  keywords?: string[];
  topics?: string[];
} | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const summary = typeof obj["summary"] === "string" ? obj["summary"].trim() : undefined;
    const keywords = Array.isArray(obj["keywords"])
      ? (obj["keywords"] as unknown[]).filter((k): k is string => typeof k === "string" && k.length > 0).slice(0, 6)
      : undefined;
    const topics = Array.isArray(obj["topics"])
      ? (obj["topics"] as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0).slice(0, 4)
      : undefined;
    if (!summary && (!keywords || keywords.length === 0)) return null;
    return {
      ...(summary ? { summary } : {}),
      ...(keywords && keywords.length > 0 ? { keywords } : {}),
      ...(topics && topics.length > 0 ? { topics } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 为一篇草稿生成摘要索引。
 *
 * @param draftId 草稿 id
 * @param title 草稿标题
 * @param markdown 草稿正文
 * @param llm 可选 LLM(不可用/失败时规则兜底)
 */
export async function buildDraftIndex(
  draftId: string,
  title: string,
  markdown: string,
  llm: LlmAdapter | undefined,
  options: BuildDraftIndexOptions = {},
): Promise<DraftIndex> {
  const now = options.now ?? (() => new Date().toISOString());
  const indexedAt = now();
  const ruleSummary = ruleDraftSummary(title, markdown);
  const ruleKeywords = extractKeywords(title, markdown);

  if (options.forceRule || !llm?.available) {
    return {
      draftId,
      title: title.trim() || "未命名草稿",
      summary: ruleSummary,
      keywords: ruleKeywords,
      usedLlm: false,
      indexedAt,
    };
  }

  try {
    const raw = await llm.run(draftIndexRequest(title, markdown));
    const parsed = parseDraftIndexJson(raw);
    if (!parsed) throw new Error("索引为空");
    return {
      draftId,
      title: title.trim() || "未命名草稿",
      summary: (parsed.summary ?? ruleSummary).slice(0, 120),
      keywords: parsed.keywords && parsed.keywords.length > 0 ? parsed.keywords : ruleKeywords,
      ...(parsed.topics && parsed.topics.length > 0 ? { topics: parsed.topics } : {}),
      usedLlm: true,
      indexedAt,
    };
  } catch {
    return {
      draftId,
      title: title.trim() || "未命名草稿",
      summary: ruleSummary,
      keywords: ruleKeywords,
      usedLlm: false,
      indexedAt,
    };
  }
}

/** 把检索词切分为 token 集合。 */
export function tokenizeQuery(query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (q.match(/[\u4e00-\u9fa5]{1,4}|[a-z0-9][a-z0-9_-]{1,}/g) ?? []) as string[];
}

/**
 * 在摘要索引上做本地相关性检索。
 *
 * 评分 = 标题命中 + 关键词命中 + 摘要命中(带长度惩罚),与 LLM 无关。
 */
export function searchDraftIndexes(
  indexes: readonly DraftIndex[],
  query: string,
  options: SearchDraftIndexesOptions = {},
): readonly DraftHit[] {
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? 0.1;
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 || indexes.length === 0) return [];

  const scored: Array<{ index: DraftIndex; score: number; matched: string[] }> = [];
  for (const idx of indexes) {
    const titleLower = idx.title.toLowerCase();
    const summaryLower = idx.summary.toLowerCase();
    const kwLower = idx.keywords.map((k) => k.toLowerCase());
    const topicLower = (idx.topics ?? []).map((t) => t.toLowerCase());
    let score = 0;
    const matched: string[] = [];
    for (const tok of tokens) {
      let hit = 0;
      if (titleLower.includes(tok)) hit += 3;
      if (kwLower.some((k) => k.includes(tok) || tok.includes(k))) hit += 2.5;
      if (summaryLower.includes(tok)) hit += 1;
      if (topicLower.some((t) => t.includes(tok) || tok.includes(t))) hit += 2;
      if (hit > 0) {
        matched.push(tok);
        score += hit;
      }
    }
    if (score > 0) {
      // 归一化(用查询 token 数做基准)并施加轻微长度惩罚,避免长文档虚高。
      const norm = score / (tokens.length * 3);
      const lenPenalty = 1 - Math.min(0.15, (graphemeCount(idx.summary) / 500) * 0.15);
      scored.push({ index: idx, score: Math.min(1, norm * lenPenalty), matched });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((s) => s.score >= minScore)
    .map((s) => ({
      draftId: s.index.draftId,
      title: s.index.title,
      summary: s.index.summary,
      score: Math.round(s.score * 100) / 100,
      matchedKeywords: s.matched,
    }));
}
