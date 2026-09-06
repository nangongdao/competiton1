/**
 * LLM 逐段风格改写 —— Agent「增强」步骤的正文级改写(仅 LLM 可用时生效)。
 *
 * 与标题/摘要增强(enhancePayload / generateVariants)互补:
 * - 标题/摘要:字段级,生成候选供选择,不自动覆盖;
 * - 正文:逐段风格改写,保持结构(标题/列表/引用/代码/表格/图片等字节级不动),
 *   只对"纯文本散文段落"做表达层润色,默认保守(每篇最多改写 3 段、单段 ≥60 字)。
 *
 * 健壮性:
 * - 单段 LLM 失败独立回退,不影响其它段;
 * - 输出被检测为"变成块级结构"或"含图片 markdown"时拒绝应用,保持原文;
 * - 无 LLM 时直接返回原文(与 NoopLlm 行为一致)。
 *
 * 纯 TS、零 DOM,可被 Agent / 批量 / 计划任务复用。
 */
import type { LlmAdapter } from "../llm/types.js";
import { mapWithConcurrency } from "../assets/rehost-engine.js";

/** 一段可被改写的散文段落(定位到原 markdown 的行区间,保证结构字节级不动)。 */
export interface ProseParagraph {
  /** 文档内散文段序号(0 基,按出现顺序)。 */
  readonly index: number;
  /** 起始行(0 基,含)。 */
  readonly startLine: number;
  /** 结束行(0 基,不含)。 */
  readonly endLine: number;
  /** 段落纯文本(可为多行)。 */
  readonly text: string;
}

/** 一段改写结果。 */
export interface RewrittenParagraph {
  readonly index: number;
  /** 改写前原文。 */
  readonly before: string;
  /** 改写后文本。 */
  readonly after: string;
}

export interface ParagraphRewriteResult {
  /** 改写后的整篇 markdown(未改写段落保持字节级一致)。 */
  readonly markdown: string;
  /** 实际改写成功的段落。 */
  readonly rewritten: readonly RewrittenParagraph[];
}

export interface ParagraphRewriteOptions {
  /** 风格改写目标平台(用于 prompt 调性)。 */
  readonly platformId: string;
  readonly llm: LlmAdapter;
  /** 每篇最多改写段落数(默认 3)。 */
  readonly maxParagraphs?: number;
  /** 段落至少多少字才值得改写(默认 60,字素计数)。 */
  readonly minChars?: number;
  /** 单段送入 LLM 的最大字符数(超出截断,默认 800)。 */
  readonly maxCharsPerParagraph?: number;
  /** AI-INSIGHT-02:任务级采样温度。 */
  readonly temperature?: number;
  /** AI-INSIGHT-02:任务级单次最大 token。 */
  readonly maxTokens?: number;
  /** AI-INSIGHT-02:任务级系统提示词。 */
  readonly systemPrompt?: string;
}

/** 判断一行是否属于块级/非散文结构(标题/列表/引用/表格/代码围栏/图片块/公式/HTML/分隔线)。 */
function isNonProseLine(t: string): boolean {
  if (/^(#{1,6})\s/.test(t)) return true; // 标题
  if (/^>\s?/.test(t)) return true; // 引用
  if (/^[-*+]\s+/.test(t)) return true; // 无序列表
  if (/^\d+[.)]\s+/.test(t)) return true; // 有序列表
  if (/^!\[[^\]]*\]\(/.test(t)) return true; // 图片块
  if (/^\$\$/.test(t)) return true; // 数学块
  if (/^<[a-zA-Z!]/.test(t)) return true; // HTML 块
  if (/^\s*\|/.test(t)) return true; // 表格行
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(t)) return true; // 分隔线
  return false;
}

/**
 * 找出所有"纯文本散文段落"(连续的、不含块级标记的非空行)。
 * 返回的每个段落携带行区间,便于不改动结构地回写。
 */
export function findProseParagraphs(markdown: string): readonly ProseParagraph[] {
  const lines = markdown.split("\n");
  const out: ProseParagraph[] = [];
  let i = 0;
  let inFence = false;
  let index = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (inFence) {
      i++;
      continue;
    }
    const t = line.trim();
    if (t === "") {
      i++;
      continue;
    }
    if (isNonProseLine(t)) {
      // 块级结构:整块跳过(直到空行或代码围栏)。
      i++;
      while (i < lines.length && lines[i]!.trim() !== "" && !/^\s*```/.test(lines[i]!)) i++;
      continue;
    }
    // 尝试收集一段散文。
    const start = i;
    const buf: string[] = [];
    let mixed = false;
    while (i < lines.length && lines[i]!.trim() !== "") {
      const lt = lines[i]!.trim();
      if (isNonProseLine(lt) || /^\s*```/.test(lines[i]!)) {
        mixed = true;
        break;
      }
      buf.push(lines[i]!);
      i++;
    }
    if (mixed) {
      // 该行区间混入块级结构:整体跳过(保守,不改写混合内容)。
      while (i < lines.length && lines[i]!.trim() !== "" && !/^\s*```/.test(lines[i]!)) i++;
      continue;
    }
    const text = buf.join("\n").trim();
    if (text.length > 0) {
      out.push({ index: index++, startLine: start, endLine: i, text });
    }
  }
  return out;
}

/** 校验改写输出仍是"散文"(未引入块级结构),否则拒绝应用。 */
function looksLikeProse(text: string): boolean {
  const lines = text.split("\n");
  return lines.every((l) => !isNonProseLine(l.trim()) && !/^\s*```/.test(l));
}

/**
 * 用 LLM 对正文散文段落逐段做风格改写。
 *
 * 仅改写"长度达标且不含内联图片"的纯散文段;每段单独请求 LLM(有界并发 2),
 * 单段失败回退原文;改写从下往上回写,保证行区间稳定。
 */
export async function rewriteParagraphsWithLlm(
  markdown: string,
  options: ParagraphRewriteOptions,
): Promise<ParagraphRewriteResult> {
  const { llm, platformId } = options;
  if (!llm.available) return { markdown, rewritten: [] };
  const minChars = Math.max(10, options.minChars ?? 60);
  const maxParagraphs = Math.max(1, options.maxParagraphs ?? 3);
  const maxCharsPerParagraph = options.maxCharsPerParagraph ?? 800;

  const paragraphs = findProseParagraphs(markdown).filter(
    (p) => [...p.text].length >= minChars && !/!\[[^\]]*\]\(/.test(p.text),
  );
  if (paragraphs.length === 0) return { markdown, rewritten: [] };

  // 优先改写最长的段落(更有改写价值),最多 maxParagraphs 段,按文档顺序回写。
  const chosen = paragraphs
    .slice()
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, maxParagraphs)
    .sort((a, b) => a.startLine - b.startLine);

  const outputs = await mapWithConcurrency(chosen, 2, async (p) => {
    const input =
      [...p.text].length > maxCharsPerParagraph ? [...p.text].slice(0, maxCharsPerParagraph).join("") : p.text;
    try {
      const out = await llm.run({
        task: "paragraph-rewrite",
        platformId,
        input,
        constraints: { minChars: 20, maxChars: maxCharsPerParagraph },
        // AI-INSIGHT-02:任务级参数透传。
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      });
      const cleaned = out.trim();
      if (!cleaned || cleaned === p.text || !looksLikeProse(cleaned)) {
        return { p, after: "" };
      }
      return { p, after: cleaned };
    } catch {
      return { p, after: "" };
    }
  });

  const rewritten: RewrittenParagraph[] = outputs
    .filter((o) => o.after.length > 0 && o.after !== o.p.text)
    .map((o) => ({ index: o.p.index, before: o.p.text, after: o.after }));
  if (rewritten.length === 0) return { markdown, rewritten: [] };

  const byIndex = new Map(paragraphs.map((p) => [p.index, p] as const));
  const lines = markdown.split("\n");
  const applied = rewritten
    .map((r) => {
      const para = byIndex.get(r.index);
      return para ? { r, start: para.startLine, end: para.endLine } : undefined;
    })
    .filter((x): x is { r: RewrittenParagraph; start: number; end: number } => !!x)
    .sort((a, b) => b.start - a.start);

  for (const { r, start, end } of applied) {
    lines.splice(start, end - start, ...r.after.split("\n"));
  }
  return { markdown: lines.join("\n"), rewritten };
}
