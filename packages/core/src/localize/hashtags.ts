/**
 * LOCALIZE-02 AI 智能标签与话题。
 *
 * 根据图片与文字内容,自动生成各平台流量最大的 Hashtag / 话题标签
 * (如 #OOTD / #职场干货)。规则版内置常用话题池 + 内容词派生;LLM 可用时增强。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { deriveHashTags } from "../fission/fission.js";

/** 内置平台常用话题池(按内容领域,规则兜底)。 */
const HASHTAG_POOL: Readonly<Record<string, readonly string[]>> = {
  职场: ["#职场干货", "#职场日常", "#职场新人", "#打工人", "#职场晋升", "#职业规划"],
  效率: ["#效率工具", "#时间管理", "#自我提升", "#高效工作", "#生产力", "#自律"],
  科技: ["#科技前沿", "#人工智能", "#AI", "#程序员", "#产品经理", "#数码"],
  生活: ["#生活记录", "#生活方式", "#治愈系", "#日常分享", "#OOTD", "#好物分享"],
  学习: ["#学习方法", "#知识分享", "#读书笔记", "#成长笔记", "#学习打卡"],
  营销: ["#新媒体运营", "#内容营销", "#品牌营销", "#私域流量", "#增长黑客"],
};

/** 话题建议。 */
export interface HashtagSuggestion {
  /** 标签文本(含 #)。 */
  readonly tag: string;
  /** 热度档位:high / medium / low(规则启发式)。 */
  readonly heat: "high" | "medium" | "low";
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
}

/** 从内容推断领域(规则启发式)。 */
export function inferNiche(title: string, text: string): string {
  const merged = `${title} ${text}`;
  const scores: Array<[string, number]> = [];
  const kw: Record<string, readonly string[]> = {
    职场: ["职场", "工作", "老板", "同事", "面试", "晋升", "简历", "打工"],
    效率: ["效率", "时间管理", "工具", "生产力", "自律", "清单", "计划"],
    科技: ["AI", "人工智能", "编程", "代码", "产品", "科技", "数码", "算法", "软件"],
    生活: ["生活", "日常", "治愈", "美食", "旅行", "穿搭", "OOTD", "家居"],
    学习: ["学习", "读书", "知识", "方法", "笔记", "课程", "考试"],
    营销: ["营销", "运营", "品牌", "内容", "流量", "增长", "带货", "文案"],
  };
  for (const [niche, kws] of Object.entries(kw)) {
    let score = 0;
    for (const k of kws) if (merged.includes(k)) score++;
    scores.push([niche, score]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0] && scores[0][1] > 0 ? scores[0][0] : "生活";
}

/** 规则版话题建议(内容词派生 + 领域话题池)。 */
export function suggestHashtagsRule(
  title: string,
  text: string,
  max = 6,
): readonly HashtagSuggestion[] {
  const out: HashtagSuggestion[] = [];
  const niche = inferNiche(title, text);
  const pool = HASHTAG_POOL[niche] ?? HASHTAG_POOL["生活"]!;
  for (const t of pool.slice(0, 3)) out.push({ tag: t, heat: "high", source: "rule" });
  const derived = deriveHashTags(title, text, 3);
  for (const d of derived) {
    if (out.length >= max) break;
    const tag = `#${d}`;
    if (out.some((o) => o.tag === tag)) continue;
    out.push({ tag, heat: "medium", source: "rule" });
  }
  return out.slice(0, max);
}

/** LLM 话题请求。 */
export function hashtagLlmRequest(title: string, text: string, max: number): LlmRequest {
  const prompt = `你是新媒体话题策划。请根据下面的内容,为各平台推荐 ${max} 个流量最大的 Hashtag(如 #OOTD / #职场干货)。只输出 JSON 数组,每个元素是字符串(以 # 开头)。不要输出 JSON 之外的任何文字。

标题:${title.trim() || "(未命名)"}
内容:${text.slice(0, 800)}`;
  return {
    task: "rewrite",
    platformId: "xiaohongshu",
    input: prompt,
    constraints: { variantCount: max },
    systemPrompt: "你是话题标签策划助手,只输出 JSON 字符串数组,不加解释。",
    temperature: 0.6,
    maxTokens: 500,
  };
}

/** 解析 LLM 话题结果(失败返回空数组)。 */
export function parseHashtagJson(raw: string): readonly string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const t = String(x).trim();
        return t.startsWith("#") ? t : `#${t}`;
      })
      .filter((t) => t.length > 1 && t.length <= 40);
  } catch {
    return [];
  }
}

/** 话题建议入口(LLM 失败自动回退规则)。 */
export async function suggestHashtags(
  title: string,
  text: string,
  llm: LlmAdapter | undefined,
  options: { max?: number; useLlm?: boolean } = {},
): Promise<{ tags: readonly HashtagSuggestion[]; usedLlm: boolean }> {
  const max = options.max ?? 6;
  const rule = suggestHashtagsRule(title, text, max);
  if (options.useLlm === false || !llm?.available) return { tags: rule, usedLlm: false };
  try {
    const raw = await llm.run(hashtagLlmRequest(title, text, max));
    const tags = parseHashtagJson(raw);
    if (tags.length === 0) throw new Error("LLM 话题为空");
    const merged = [
      ...tags.slice(0, Math.min(3, tags.length)).map((t): HashtagSuggestion => ({ tag: t, heat: "high", source: "llm" })),
      ...rule.filter((r) => r.source === "rule" && !tags.includes(r.tag)).slice(0, Math.max(0, max - 3)),
    ];
    return { tags: merged.slice(0, max), usedLlm: true };
  } catch {
    return { tags: rule, usedLlm: false };
  }
}
