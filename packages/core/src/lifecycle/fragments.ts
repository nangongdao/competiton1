/**
 * v9 Phase 1 · LC-02 内容片段复用库。
 *
 * 从草稿中按标题 / 段落 / 金句抽取可复用片段,带来源溯源与检索。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;片段只存短摘要与引用位置,不落整篇全文(隐私友好);
 * - `extractContentFragments` 可单测;`searchFragments` 确定性检索;
 * - 片段带 `sourceDraftId` / `blockIndex`,可跳转溯源。
 */
import type { Document } from "../ir/types.js";
import { isHeading, isParagraph, isList, isQuote, blockToPlainText } from "../ir/guards.js";
import { graphemeCount } from "../transforms/grapheme-count.js";
import { markdownToIR } from "../parse/md-to-ir.js";

/** 片段类型。 */
export type FragmentKind = "heading" | "paragraph" | "quote" | "list" | "key-point";

/** 内容片段。 */
export interface ContentFragment {
  /** 全局唯一 id(draftId + blockIndex)。 */
  readonly id: string;
  /** 来源草稿 id。 */
  readonly sourceDraftId: string;
  /** 来源草稿标题。 */
  readonly sourceTitle: string;
  /** 块在 Document.blocks 中的下标(可跳转溯源)。 */
  readonly blockIndex: number;
  /** 片段类型。 */
  readonly kind: FragmentKind;
  /** 片段纯文本(前 200 字,避免整篇落盘)。 */
  readonly text: string;
  /** 片段字数。 */
  readonly charCount: number;
  /** 抽取时的关键词(用于检索)。 */
  readonly keywords: readonly string[];
}

/** 片段抽取选项。 */
export interface FragmentExtractOptions {
  /** 单片段文本上限(默认 200 字)。 */
  readonly maxTextLength?: number;
  /** 是否包含标题片段(默认 true)。 */
  readonly includeHeadings?: boolean;
  /** 是否包含金句引用(默认 true)。 */
  readonly includeQuotes?: boolean;
}

/** 从 IR Document 抽取片段。 */
export function extractFragmentsFromDocument(
  doc: Document,
  sourceDraftId: string,
  options: FragmentExtractOptions = {},
): readonly ContentFragment[] {
  const maxLen = options.maxTextLength ?? 200;
  const includeHeadings = options.includeHeadings ?? true;
  const includeQuotes = options.includeQuotes ?? true;

  const out: ContentFragment[] = [];
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i]!;
    if (!b) continue;

    let kind: FragmentKind | null = null;
    let text = "";

    if (isHeading(b)) {
      if (!includeHeadings) continue;
      kind = "heading";
      text = blockToPlainText(b);
    } else if (isParagraph(b)) {
      kind = "paragraph";
      text = blockToPlainText(b);
    } else if (isQuote(b)) {
      if (!includeQuotes) continue;
      kind = "quote";
      text = blockToPlainText(b);
    } else if (isList(b)) {
      kind = "list";
      text = blockToPlainText(b);
    }

    if (kind === null) continue;
    text = text.trim();
    if (text.length === 0) continue;

    const truncated = text.slice(0, maxLen);
    out.push({
      id: `${sourceDraftId}:${i}`,
      sourceDraftId,
      sourceTitle: doc.meta.title ?? "",
      blockIndex: i,
      kind,
      text: truncated,
      charCount: graphemeCount(text),
      keywords: deriveKeywords(truncated),
    });
  }
  return out;
}

/** 从 Markdown 文本抽取片段(容错:解析失败返回空)。 */
export function extractContentFragments(
  markdown: string,
  sourceDraftId: string,
  sourceTitle: string,
  options: FragmentExtractOptions = {},
): readonly ContentFragment[] {
  try {
    const parsed = markdownToIR(markdown);
    const doc = parsed.document;
    const effectiveTitle = doc.meta.title || sourceTitle;
    return extractFragmentsFromDocument({ ...doc, meta: { ...doc.meta, title: effectiveTitle } }, sourceDraftId, options);
  } catch {
    return [];
  }
}

/** 从文本派生关键词(中文分词简版:取 2-6 字词语 + 高频词)。 */
function deriveKeywords(text: string): string[] {
  const words = text.split(/[\s，。！？、；：""''（）《》【】,.!?;:()"'\-—\n]+/).filter((w) => w.length >= 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

/** 片段检索选项。 */
export interface SearchFragmentsOptions {
  /** 按类型过滤。 */
  readonly kind?: FragmentKind;
  /** 按来源草稿过滤。 */
  readonly sourceDraftId?: string;
}

/** 检索片段(关键词匹配,确定性评分)。 */
export function searchFragments(
  fragments: readonly ContentFragment[],
  query: string,
  options: SearchFragmentsOptions = {},
): readonly ContentFragment[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return fragments
      .filter((f) => (options.kind ? f.kind === options.kind : true))
      .filter((f) => (options.sourceDraftId ? f.sourceDraftId === options.sourceDraftId : true));
  }

  const queryTerms = q.split(/\s+/).filter((t) => t.length > 0);
  const scored = fragments
    .filter((f) => (options.kind ? f.kind === options.kind : true))
    .filter((f) => (options.sourceDraftId ? f.sourceDraftId === options.sourceDraftId : true))
    .map((f) => {
      const textLower = f.text.toLowerCase();
      const kwLower = f.keywords.map((k) => k.toLowerCase());
      let score = 0;
      for (const term of queryTerms) {
        if (textLower.includes(term)) score += 3;
        if (kwLower.some((k) => k.includes(term) || term.includes(k))) score += 2;
        if (f.sourceTitle.toLowerCase().includes(term)) score += 1;
      }
      return { fragment: f, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.fragment);
}
