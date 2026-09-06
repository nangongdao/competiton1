/**
 * v9 Phase 3 · TAG-01 统一内容标签。
 *
 * 从标题 / 正文 / 效果 / 资产派生统一标签(规则 + LLM 提炼),支持去重/归一,
 * 供草稿 / 资产 / 历史按标签聚合检索与驾驶舱联动。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;标签派生可单测;LLM 失败回退规则;
 * - 标签去重 / 归一(小写、去空白、上限保护);
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 标签来源。 */
export type TagSource = "rule" | "llm";

/** 派生标签结果。 */
export interface TaggedContent {
  readonly refId: string;
  readonly kind: "draft" | "asset" | "history";
  readonly title: string;
  /** 统一标签(去重、归一)。 */
  readonly tags: readonly string[];
  /** 是否使用了 LLM(否则规则)。 */
  readonly usedLlm: boolean;
  /** 标签生成时间。 */
  readonly taggedAt: string;
}

/** 标签派生选项。 */
export interface DeriveTagsOptions {
  /** 内容标题。 */
  readonly title?: string;
  /** 内容正文纯文本(可选)。 */
  readonly contentText?: string;
  /** 附加标签(如平台 / 已有标签,合并归一)。 */
  readonly extraTags?: readonly string[];
  /** 标签上限(默认 8)。 */
  readonly maxTags?: number;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 是否启用 LLM(默认 true)。 */
  readonly useLlm?: boolean;
}

/** 规则标签派生(确定性,不依赖 LLM)。 */
export function deriveRuleTags(options: DeriveTagsOptions = {}): readonly string[] {
  const tags = new Set<string>();
  const title = (options.title ?? "").trim();
  const content = (options.contentText ?? "").trim();

  // 从标题提取:中英文词。
  for (const w of title.split(/[\s，。！？、；：""''（）《》【】,.!?;:()"'\-—\n]+/)) {
    const t = normalizeTag(w);
    if (t && t.length >= 2 && t.length <= 12) tags.add(t);
  }
  // 从正文提取高频词(简单启发式)。
  const words = content.split(/[\s，。！？、；：""''（）《》【】,.!?;:()"'\-—\n]+/).filter((w) => w.length >= 2 && w.length <= 12);
  const freq = new Map<string, number>();
  for (const w of words) {
    const t = normalizeTag(w);
    if (!t) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  for (const [t] of sorted) {
    if (tags.size >= (options.maxTags ?? 8)) break;
    tags.add(t);
  }
  // 附加标签。
  for (const t of options.extraTags ?? []) {
    const n = normalizeTag(t);
    if (n) tags.add(n);
  }

  return [...tags].slice(0, options.maxTags ?? 8);
}

/** 标签归一化。 */
function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

/** 标签去重归一(供多个来源合并)。 */
export function mergeTags(...lists: readonly (readonly string[])[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const t of list) {
      const n = normalizeTag(t);
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

/** LLM 标签提炼请求(prompt 构造)。 */
export function llmTagRequest(options: DeriveTagsOptions): LlmRequest {
  const title = options.title ?? "";
  const content = (options.contentText ?? "").slice(0, 1500);
  return {
    task: "rewrite",
    platformId: "wechat",
    input: `你是内容标签提炼助手。请从标题与正文中提炼 3-6 个简洁标签,只输出 JSON 数组字符串,不要其它文字。\n标题:${title}\n正文片段:\n${content}\n\n请输出标签 JSON 数组,例如 ["效率","写作"]。`,
    systemPrompt: "你是内容标签提炼助手,只输出 JSON 数组,不加解释。",
    temperature: 0.3,
    maxTokens: 300,
  };
}

/** 解析 LLM 返回的标签(宽松容错)。 */
export function parseLlmTags(raw: string): readonly string[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => normalizeTag(String(x))).filter((t) => t.length > 0);
    }
  } catch {
    /* 非 JSON,按行拆分 */
  }
  return trimmed
    .split(/[\n,，]/)
    .map((l) => normalizeTag(l.replace(/^[-*\d.)\s"']+/, "").replace(/["']$/, "")))
    .filter((t) => t.length > 0);
}

/**
 * TAG-01 统一标签派生入口。
 *
 * LLM 可用时叠加 LLM 提炼,失败自动回退规则;结果合并去重。
 */
export async function deriveContentTags(
  options: DeriveTagsOptions,
  llm?: LlmAdapter,
): Promise<{ tags: readonly string[]; usedLlm: boolean }> {
  const ruleTags = deriveRuleTags(options);
  const useLlm = options.useLlm ?? true;

  if (!useLlm || !llm?.available) {
    return { tags: ruleTags, usedLlm: false };
  }

  try {
    const raw = await llm.run(llmTagRequest(options));
    const llmTags = parseLlmTags(raw);
    if (llmTags.length === 0) throw new Error("LLM 标签为空");
    return { tags: mergeTags(ruleTags, llmTags).slice(0, options.maxTags ?? 8), usedLlm: true };
  } catch {
    return { tags: ruleTags, usedLlm: false };
  }
}
