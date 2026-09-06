/**
 * 平台产物对比 —— 把"源 Markdown 纯文本"与"平台序列化产物"做行级对比,
 * 让创作者一眼看出该平台做了什么降级/截断/替换(表格转图、公式转图、外链转脚注、超限截断等)。
 *
 * 设计约束(与项目一致):
 * - 纯 TS 零 DOM;行级 diff 复用字符级 LCS 思路(按行切分后做 LCS);
 * - 只做"源 → 产物"单向说明,不反向推断平台内部规则;
 * - 产物 HTML 先抽纯文本再对比,避免标签噪音干扰。
 */
import { diffText } from "../versions/types.js";

/** 行级对比操作单元。 */
export type LineDiffOp =
  | { readonly type: "equal"; readonly line: string }
  | { readonly type: "insert"; readonly line: string }
  | { readonly type: "delete"; readonly line: string };

/** 平台产物对比结果。 */
export interface ArtifactComparison {
  readonly platformId: string;
  /** 源纯文本行。 */
  readonly sourceLines: readonly string[];
  /** 产物纯文本行。 */
  readonly artifactLines: readonly string[];
  /** 行级 diff(源 → 产物)。 */
  readonly ops: readonly LineDiffOp[];
  /** 新增行数 / 删除行数。 */
  readonly added: number;
  readonly removed: number;
  /** 是否完全一致。 */
  readonly identical: boolean;
  /** 对显著差异的说明(人类可读)。 */
  readonly notes: readonly string[];
}

/** 把 HTML 抽成纯文本(标签 → 空,实体解码基础)。 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 把 Markdown 抽成纯文本(基础:去标题符/列表符/行内标记)。 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "图片:$1")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .trim();
}

/** 行级 LCS diff(按行切分)。 */
export function diffLines(a: string, b: string): readonly LineDiffOp[] {
  const A = a.split(/\n/);
  const B = b.split(/\n/);
  if (a === b) {
    return A.map((line) => ({ type: "equal" as const, line }));
  }
  const n = A.length;
  const m = B.length;
  if (n === 0) return B.map((line) => ({ type: "insert" as const, line }));
  if (m === 0) return A.map((line) => ({ type: "delete" as const, line }));

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = A[i] === B[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: LineDiffOp["type"], line: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      ops[ops.length - 1] = { type, line: last.line + "\n" + line };
    } else {
      ops.push({ type, line });
    }
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("equal", A[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push("delete", A[i]!);
      i++;
    } else {
      push("insert", B[j]!);
      j++;
    }
  }
  while (i < n) {
    push("delete", A[i]!);
    i++;
  }
  while (j < m) {
    push("insert", B[j]!);
    j++;
  }
  return ops;
}

/** 提取平台产物纯文本(按 MIME 分流)。 */
export function artifactPlainText(mime: string, content: string): string {
  if (mime === "text/html") return htmlToPlainText(content);
  return markdownToPlainText(content);
}

/** 对比源 Markdown 与平台产物。 */
export function compareArtifact(
  platformId: string,
  sourceMarkdown: string,
  mime: string,
  content: string,
): ArtifactComparison {
  const sourceText = markdownToPlainText(sourceMarkdown);
  const artifactText = artifactPlainText(mime, content);
  const sourceLines = sourceText.split(/\n/).filter((l) => l.trim().length > 0);
  const artifactLines = artifactText.split(/\n/).filter((l) => l.trim().length > 0);
  const ops = diffLines(sourceText, artifactText);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "insert") added++;
    else if (op.type === "delete") removed++;
  }
  const identical = added === 0 && removed === 0;
  const notes: string[] = [];
  if (identical) {
    notes.push("产物与源文一致,未发生降级。");
  } else {
    if (removed > 0 && added === 0) notes.push(`内容被截断/精简(删除 ${removed} 行),常见于平台字数限制。`);
    if (added > 0 && removed === 0) notes.push(`产物补充了平台所需内容(新增 ${added} 行),如封面占位/话题标签。`);
    if (added > 0 && removed > 0) {
      notes.push(`内容发生了改写/重排(删 ${removed} 行、增 ${added} 行),常见于外链转脚注、表格/公式转图片。`);
    }
    if (/图片:/.test(artifactText) && /!\[/.test(sourceMarkdown)) {
      notes.push("检测到图片引用,公众号等平台会重托管到图床。");
    }
  }
  return { platformId, sourceLines, artifactLines, ops, added, removed, identical, notes };
}

/** 复用字符级 diff(供 UI 做行内高亮;已从 versions 导出)。 */
export { diffText };
