/**
 * FISSION-03 多版本同义改写(内容矩阵防重)。
 *
 * 对于需要大量铺内容的矩阵账号,对同一篇素材生成 N 个**语义相近、表述不同**的版本,
 * 降低跨账号内容的机械重复度:
 *
 * - 规则版:同义词替换 + 句式微调 + 段落重排 + 标点/语气变化,确定性、离线可用;
 * - LLM 增强:一次请求多版本同义改写,失败自动回退规则;
 * - 提供**文本相似度评估**(字符级 + 词级 n-gram),量化两个版本的差异度,
 *   供矩阵运营判断是否需要进一步改写。
 *
 * 合规提示:工具仅提供内容多版本化能力,是否合规由使用方自行判断
 * (各平台原创检测政策详见平台条款,compliance 模块负责发布前风控扫描)。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 一个改写版本。 */
export interface RewriteVariant {
  /** 版本序号(1 起)。 */
  readonly index: number;
  /** 改写后的文本。 */
  readonly text: string;
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
  /** 与原文的相似度(0-1,越小差异越大;仅规则版计算)。 */
  readonly similarityToSource?: number;
}

/** 多版本改写结果。 */
export interface RewriteVariantsResult {
  readonly source: string;
  readonly variants: readonly RewriteVariant[];
  readonly generatedAt: string;
}

/** 改写选项。 */
export interface RewriteVariantsOptions {
  /** 版本数(默认 3,上限 5)。 */
  readonly count?: number;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM(默认 true;false 时仅规则)。 */
  readonly useLlm?: boolean;
}

/** 轻量同义词表(内置常见样例,实际可扩展)。 */
const SYNONYMS: Readonly<Record<string, string[]>> = {
  重要: ["关键", "核心", "举足轻重"],
  很好: ["很棒", "不错", "值得肯定"],
  学习: ["掌握", "习得", "了解"],
  方法: ["方式", "路径", "做法"],
  解决: ["处理", "应对", "搞定"],
  问题: ["难题", "痛点", "挑战"],
  提高: ["提升", "增强", "优化"],
  使用: ["运用", "采用", "借助"],
  需要: ["应当", "必须", "建议"],
  帮助: ["助力", "协助", "支持"],
  简单: ["容易", "便捷", "省心"],
  快速: ["迅速", "高效", "即刻"],
  内容: ["素材", "正文", "文案"],
  平台: ["渠道", "阵地", "站点"],
  发布: ["推送", "分发", "上线"],
  效率: ["效能", "产出", "速度"],
};

/** 常用口语化替换(风格微调)。 */
const STYLE_TWEAKS: readonly (readonly [RegExp, string])[] = [
  [/其实/g, "坦白说"],
  [/非常/g, "特别"],
  [/确实/g, "确实(没错)"],
  [/我们/g, "咱们"],
  [/我认为/g, "在我看来"],
  [/需要注意的是/g, "划个重点"],
  [/总之/g, "一句话总结"],
];

/** 同义改写单个句子(规则版)。 */
export function rewriteWithSynonyms(text: string): string {
  let out = text;
  for (const [word, alts] of Object.entries(SYNONYMS)) {
    if (!out.includes(word)) continue;
    const alt = alts[Math.floor(Math.random() * alts.length)]!;
    out = out.split(word).join(alt);
  }
  return out;
}

/** 按句子拆分(简单启发式)。 */
function splitSentences(text: string): readonly string[] {
  return text
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 将句子序列分成 N 组(供重排)。 */
function chunkInto(sentences: readonly string[], n: number): readonly (readonly string[])[] {
  if (sentences.length === 0) return [];
  const per = Math.max(1, Math.ceil(sentences.length / n));
  const out: string[][] = [];
  for (let i = 0; i < sentences.length; i += per) out.push(sentences.slice(i, i + per));
  return out;
}

/** 规则版多版本改写(确定性种子可选;默认随机)。 */
export function rewriteVariantsRule(
  source: string,
  options: RewriteVariantsOptions & { seed?: number } = {},
): RewriteVariantsResult {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const count = Math.min(Math.max(options.count ?? 3, 1), 5);
  const sentences = splitSentences(source.trim());
  const base = sentences.length > 0 ? sentences : [source.trim()];

  const variants: RewriteVariant[] = [];
  for (let i = 0; i < count; i++) {
    // 每个版本:同义替换 + 风格微调 + 轻度重排(交错换位)。
    let text = rewriteWithSynonyms(source.trim());
    for (const [re, rep] of STYLE_TWEAKS) text = text.replace(re, rep);
    if (sentences.length >= 3) {
      const chunks = chunkInto(base, 3);
      const reordered = [...chunks].sort(() => (i % 2 === 0 ? -0.3 : 0.4)); // 确定性交错
      text = reordered.flat().join("");
    }
    variants.push({
      index: i + 1,
      text,
      source: "rule",
      similarityToSource: similarityOf(text, source),
    });
  }
  return { source, variants, generatedAt };
}

/**
 * 文本相似度评估(0-1)。
 *
 * 基于字符级 bigram Dice 系数 + 词级 Jaccard 的加权平均,量化两个版本的差异度;
 * 值越接近 1 越相似(需进一步改写),越接近 0 差异越大。
 */
export function similarityOf(a: string, b: string): number {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const A = norm(a);
  const B = norm(b);
  if (!A && !B) return 1;
  if (!A || !B) return 0;

  // 字符级 bigram Dice。
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = bigrams(A);
  const gb = bigrams(B);
  let inter = 0;
  let union = 0;
  for (const [g, c] of ga) {
    const cb = gb.get(g) ?? 0;
    inter += Math.min(c, cb);
    union += Math.max(c, cb);
  }
  for (const [g, c] of gb) {
    if (!ga.has(g)) union += c;
  }
  const dice = union > 0 ? inter / union : 1;

  // 词级 Jaccard。
  const words = (s: string): Set<string> => {
    const toks = (s.match(/[\u4e00-\u9fa5]{1,4}|[A-Za-z0-9][A-Za-z0-9_-]{1,}/g) ?? []) as string[];
    return new Set(toks);
  };
  const wa = words(A);
  const wb = words(B);
  let wInter = 0;
  for (const w of wa) if (wb.has(w)) wInter++;
  const wUnion = new Set([...wa, ...wb]).size;
  const jaccard = wUnion > 0 ? wInter / wUnion : 1;

  return Math.round((dice * 0.6 + jaccard * 0.4) * 1000) / 1000;
}

/** LLM 多版本同义改写请求。 */
export function rewriteVariantsLlmRequest(
  source: string,
  count: number,
): LlmRequest {
  const prompt = `请把下面的文本改写为 ${count} 个**语义相同、表述不同**的版本(用于多平台/多账号内容分发,避免机械重复)。要求:
1. 保持核心信息与结论不变;
2. 换用不同的句式、措辞与结构;
3. 不要添加原文没有的事实;
4. 只输出 JSON 数组,每个元素是 {"text":"改写后的完整文本"}。

原文:
${source.slice(0, 1500)}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: count },
    systemPrompt: "你是内容多版本改写助手,只输出 JSON 数组,不加解释。",
    temperature: 0.8,
    maxTokens: 2500,
  };
}

/** 宽松解析 LLM 改写版本(失败返回空数组)。 */
export function parseRewriteVariants(raw: string): readonly string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x): string => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object" && typeof (x as Record<string, unknown>)["text"] === "string") {
          return ((x as Record<string, unknown>)["text"] as string).trim();
        }
        return "";
      })
      .filter((t) => t.length > 0);
  } catch {
    return [];
  }
}

/** 多版本改写入口(LLM 失败自动回退规则)。 */
export async function generateRewriteVariants(
  source: string,
  llm: LlmAdapter | undefined,
  options: RewriteVariantsOptions = {},
): Promise<RewriteVariantsResult> {
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const count = Math.min(Math.max(options.count ?? 3, 1), 5);
  const rule = rewriteVariantsRule(source, { ...options, count });

  if (options.useLlm === false || !llm?.available || source.trim().length < 10) {
    return { source, variants: rule.variants, generatedAt };
  }
  try {
    const raw = await llm.run(rewriteVariantsLlmRequest(source, count));
    const texts = parseRewriteVariants(raw);
    if (texts.length === 0) throw new Error("LLM 改写结果为空");
    const variants: RewriteVariant[] = texts.slice(0, count).map((text, i) => ({
      index: i + 1,
      text,
      source: "llm",
      similarityToSource: similarityOf(text, source),
    }));
    return { source, variants, generatedAt };
  } catch {
    return { source, variants: rule.variants, generatedAt };
  }
}
