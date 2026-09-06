/**
 * AI-02 多方案生成 —— LLM 批量产出标题/摘要候选。
 *
 * 在既有单次增强(enhancePayload)基础上,增加"一次请求多候选"能力:
 * - `generateVariants`:为标题/摘要各请求 N 个候选(JSON 数组),失败/不可用
 *   回退到 ruleVariants(确定性方案),保证 UI 总有可选项;
 * - 每个候选携带来源/模型/提示版本,满足"展示来源,不自动覆盖"的要求。
 *
 * 与 enhancePayload 的关系:增强是"改写后直接应用",多方案是"生成候选供用户选",
 * 两者共享 LlmAdapter 与 prompt 模板体系。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import type { VariantOption } from "./suggestions.js";
import { ruleVariants, type VariantGenerateInput } from "./suggestions.js";

export const VARIANT_PROMPT_VERSION = "v1";

/** 解析 LLM 返回的候选列表(宽松容错:JSON 数组或每行一条)。 */
export function parseVariantList(raw: string): string[] {
  const trimmed = raw.trim();
  // 尝试 JSON 数组。
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((x) => (typeof x === "string" ? x.trim() : (x as { text?: unknown })?.text))
        .filter((x): x is string => typeof x === "string" && x.length > 0);
    }
  } catch {
    /* 非 JSON,走行解析 */
  }
  // 每行一条(允许编号 / 引号)。
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*\d.)\s"']+/, "").replace(/["']$/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 5);
}

export interface VariantGenerateResult {
  /** 标题候选(含原文与规则方案)。 */
  readonly titles: readonly VariantOption[];
  /** 摘要候选。 */
  readonly summaries: readonly VariantOption[];
  /** 是否命中 LLM 生成(否则纯规则)。 */
  readonly usedLlm: boolean;
}

/**
 * 为标题/摘要生成 N 个候选。
 *
 * @param input 平台 + 原文 + 上限
 * @param llm 可选的 LLM(不可用则纯规则)
 * @param count 每个字段的候选数(默认 3)
 */
export async function generateVariants(
  input: VariantGenerateInput,
  llm?: LlmAdapter,
  count = 3,
): Promise<VariantGenerateResult> {
  const rule = ruleVariants(input);
  // 标题候选:排除摘要候选用例(id 为 rule-summary)。
  const baseTitles = rule.filter((v) => v.id !== "rule-summary").slice(0, count);
  // 摘要候选:只取 rule-summary。
  const baseSummaries = rule.filter((v) => v.id === "rule-summary").slice(0, 1);

  if (!llm?.available) {
    return {
      titles: baseTitles,
      summaries: baseSummaries,
      usedLlm: false,
    };
  }

  try {
    const [titleRaw, summaryRaw] = await Promise.all([
      llm.run(variantRequest("title", input)),
      llm.run(variantRequest("summary", input)),
    ]);
    const titleCandidates = parseVariantList(titleRaw)
      .map((t, idx) => toVariantOption(`llm-title-${idx}`, t, "llm", llm.id, input.titleMax))
      .filter((v) => v.withinLimit);
    const summaryCandidates = parseVariantList(summaryRaw)
      .map((t, idx) => toVariantOption(`llm-summary-${idx}`, t, "llm", llm.id, input.summaryMax))
      .filter((v) => v.withinLimit);

    // 把 LLM 候选与原文/规则候选合并,保证"原标题"始终可见、且总数为 count。
    const titles = mergeCandidates(baseTitles, titleCandidates, count);
    const summaries = mergeCandidates(baseSummaries, summaryCandidates, 1);
    return { titles, summaries, usedLlm: true };
  } catch {
    // LLM 失败回退纯规则(发布链路不被 LLM 拖垮)。
    return { titles: baseTitles, summaries: baseSummaries, usedLlm: false };
  }
}

/** 构造多方案 LLM 请求(JSON 数组格式)。 */
export function variantRequest(kind: "title" | "summary", input: VariantGenerateInput): LlmRequest {
  const max = kind === "title" ? input.titleMax ?? 30 : input.summaryMax ?? 120;
  const content = input.contentText.slice(0, 800);
  const prompt =
    kind === "title"
      ? `为以下内容生成 ${3} 个不同的标题,要求:每个 ≤${max} 字、角度各异(一个直白干货、一个悬念、一个数字亮点)。只输出 JSON 数组,如 ["标题1","标题2","标题3"]。\n\n内容:\n${content}`
      : `为以下内容生成 ${2} 条不同的摘要/推荐语,每条 ≤${max} 字、语气自然。只输出 JSON 数组。\n\n内容:\n${content}`;
  return {
    task: kind === "title" ? "title" : "summary",
    platformId: input.platformId,
    input: prompt,
    constraints: { maxChars: max, variantCount: kind === "title" ? 3 : 2 },
  };
}

/** 把候选文本转为 VariantOption。 */
function toVariantOption(
  id: string,
  text: string,
  source: VariantOption["source"],
  model: string | undefined,
  maxChars: number | undefined,
): VariantOption {
  const len = [...text].length;
  return {
    id,
    text,
    source,
    model,
    promptVersion: VARIANT_PROMPT_VERSION,
    charCount: len,
    withinLimit: maxChars ? len <= maxChars : true,
  };
}

/** 合并规则候选与 LLM 候选:LLM 优先展示(占 max-1 位),原文/规则兜底,总数封顶。 */
function mergeCandidates(
  base: readonly VariantOption[],
  llm: readonly VariantOption[],
  max: number,
): readonly VariantOption[] {
  const seen = new Set<string>();
  const out: VariantOption[] = [];
  // LLM 候选优先(占 max-1 位),保证多样性。
  for (const v of llm) {
    const key = v.text.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max - 1) break;
  }
  // 原文/规则候选补足(原文始终可见)。
  for (const v of base) {
    const key = v.text.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
