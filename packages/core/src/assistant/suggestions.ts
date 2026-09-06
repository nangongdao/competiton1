/**
 * AI-01 内容助手 —— 结构化质量建议与一键修复。
 *
 * 把"排版建议 + 校验提示"从纯文本升级为结构化、可定位、可一键修复的动作:
 * - `locate`:建议定位到具体段落/标题(原文范围 + Markdown 内定位 anchor);
 * - `apply`:把建议转成可执行的文本变换(替换/插入),UI 可一键应用;
 * - `undo`:记录原文,支持撤销。
 *
 * 与 validate/typography 的关系:建议由既有规则(校验/评分)派生,这里只做
 * "结构化 + 修复动作"的组装,不重复实现校验逻辑。设计上保持纯函数、零 DOM。
 */
import type { Block, Document, HeadingBlock, Inline, PlatformOverride } from "../ir/types.js";
import { isHeading, isParagraph, blockToPlainText, inlinesToPlainText } from "../ir/guards.js";
import { graphemeCount } from "../transforms/grapheme-count.js";

/** 建议定位:可追溯到正文的具体块/段落(0 基序号)与原文摘录。 */
export interface SuggestionLocate {
  /** 块在 Document.blocks 中的下标(便于 UI 高亮/定位)。 */
  readonly blockIndex: number;
  /** 块类型(heading/paragraph/list/quote)。 */
  readonly blockType: Block["type"];
  /** 原文摘录(前 40 字)。 */
  readonly excerpt: string;
  /** 若为标题块,给出标题级别。 */
  readonly headingLevel?: number;
  /** 若为段落块,给出段落字数。 */
  readonly charCount?: number;
}

/** 修复动作:把建议转成可执行的文本变换。 */
export interface SuggestionFix {
  /** 修复类型(拆段/加标题/截断/改写等)。 */
  readonly kind: "split-paragraph" | "insert-heading" | "truncate" | "add-image-hint" | "adjust-heading" | "rewrite";
  /** 对整篇 Markdown 应用的变换描述(供 UI 展示)。 */
  readonly description: string;
  /** 变换函数:输入整篇 markdown,输出修复后的 markdown(纯文本变换)。 */
  readonly apply: (markdown: string) => string;
  /** 修复前的原文片段(供撤销比对)。 */
  readonly before?: string;
  /** 修复后的片段。 */
  readonly after?: string;
}

/** 结构化建议条目。 */
export interface ContentSuggestion {
  readonly id: string;
  readonly platformId: string;
  /** 建议来源规则(code)。 */
  readonly code: string;
  /** 严重度。 */
  readonly severity: "error" | "warning" | "info";
  /** 一句话建议(人类可读)。 */
  readonly message: string;
  /** 定位信息(可缺失:全局性建议无具体段落)。 */
  readonly locate?: SuggestionLocate;
  /** 可选的修复动作(部分建议可一键修复)。 */
  readonly fix?: SuggestionFix;
}

/** 从建议集合生成结果。 */
export interface SuggestionResult {
  readonly suggestions: readonly ContentSuggestion[];
  /** 可自动修复的建议数(UI 用于显示"一键修复 N 项")。 */
  readonly fixableCount: number;
}

// ---------------------------------------------------------------------------
// 排版建议 → 结构化建议
// ---------------------------------------------------------------------------

/**
 * 把排版评分(TypographyScore)的建议字符串派生为结构化建议。
 * 由于既有建议字符串不含位置,这里对原文做二次轻量扫描以定位段落/标题,
 * 并生成对应修复动作。保持纯函数、确定性。
 */
export function deriveTypographySuggestions(
  doc: Document,
  platformId: string,
  /** 由 scoreTypography 产出的建议字符串列表。 */
  rawSuggestions: readonly string[],
): readonly ContentSuggestion[] {
  const out: ContentSuggestion[] = [];
  const blocks = doc.blocks;
  const paragraphs = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => isParagraph(b));

  // 段落节奏建议:定位最长/偏长段落,生成"拆段"修复。
  const rhythm = rawSuggestions.find((s) => s.includes("拆成 2-3 段"));
  if (rhythm) {
    const longParas = paragraphs
      .filter(({ b }) => graphemeCount(blockToPlainText(b)) > 90)
      .sort((a, z) => graphemeCount(blockToPlainText(z.b)) - graphemeCount(blockToPlainText(a.b)))
      .slice(0, 1);
    if (longParas[0]) {
      const { b, i } = longParas[0];
      const excerpt = blockToPlainText(b).slice(0, 40);
      const charCount = graphemeCount(blockToPlainText(b));
      const fixable = charCount > 120;
      out.push({
        id: `rhythm-${platformId}-${i}`,
        platformId,
        code: "paragraph-rhythm",
        severity: "warning",
        message: rhythm,
        locate: { blockIndex: i, blockType: "paragraph", excerpt, charCount },
        ...(fixable
          ? {
              fix: {
                kind: "split-paragraph",
                description: `把第 ${i + 1} 段(${charCount} 字)拆成 2-3 个短段落`,
                before: blockToPlainText(b).slice(0, 40),
                apply: (md) => splitParagraphByBlock(md, b, i),
              },
            }
          : {}),
      });
    }
  }

  // 配图建议:全局性,定位到正文第一个段落。
  const image = rawSuggestions.find((s) => s.includes("补充配图"));
  if (image) {
    const firstPara = paragraphs[0];
    out.push({
      id: `image-${platformId}`,
      platformId,
      code: "image-balance",
      severity: "info",
      message: image,
      locate: firstPara
        ? {
            blockIndex: firstPara.i,
            blockType: "paragraph",
            excerpt: blockToPlainText(firstPara.b).slice(0, 40),
            charCount: graphemeCount(blockToPlainText(firstPara.b)),
          }
        : undefined,
    });
  }

  // 标题结构建议:定位到第一个 H2/H3 或建议插入标题的位置。
  const heading = rawSuggestions.find((s) => s.includes("小标题") || s.includes("标题层级"));
  if (heading) {
    const firstHeading = findHeading(blocks);
    const firstPara = paragraphs[0];
    out.push({
      id: `heading-${platformId}`,
      platformId,
      code: "heading-structure",
      severity: "info",
      message: heading,
      locate: firstHeading
        ? {
            blockIndex: firstHeading.i,
            blockType: "heading",
            excerpt: blockToPlainText(firstHeading.b).slice(0, 40),
            headingLevel: firstHeading.b.level,
          }
        : firstPara
          ? { blockIndex: firstPara.i, blockType: "paragraph", excerpt: blockToPlainText(firstPara.b).slice(0, 40) }
          : undefined,
      ...(heading.includes("没有小标题")
        ? {
            fix: {
              kind: "insert-heading",
              description: "在正文长段前插入 H2 小标题(以首句摘录为标题)",
              apply: (md) => insertHeadingBeforeLongParagraph(md, blocks),
            },
          }
        : {}),
    });
  }

  // 可读性建议。
  const readability = rawSuggestions.find((s) => s.includes("超长文本块"));
  if (readability) {
    const maxPara = paragraphs
      .map(({ b, i }) => ({ b, i, n: graphemeCount(blockToPlainText(b)) }))
      .sort((a, z) => z.n - a.n)[0];
    if (maxPara && maxPara.n > 200) {
      out.push({
        id: `readability-${platformId}-${maxPara.i}`,
        platformId,
        code: "readability",
        severity: "info",
        message: readability,
        locate: { blockIndex: maxPara.i, blockType: "paragraph", excerpt: blockToPlainText(maxPara.b).slice(0, 40), charCount: maxPara.n },
        fix: {
          kind: "split-paragraph",
          description: `把 ${maxPara.n} 字的超长文本块拆成多段`,
          before: blockToPlainText(maxPara.b).slice(0, 40),
          apply: (md) => splitParagraphByBlock(md, maxPara.b, maxPara.i),
        },
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 校验建议 → 结构化建议
// ---------------------------------------------------------------------------

/**
 * 把校验报告(ValidationReport)的 issue 派生为结构化建议。
 * 已知字段可定位(title/body/cover/tags/images);其余按全局处理。
 */
export function deriveValidationSuggestions(
  issues: ReadonlyArray<{
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
    field?: string;
  }>,
  platformId: string,
  doc: Document,
): readonly ContentSuggestion[] {
  return issues.map((issue, idx) => {
    const locate = deriveLocateFromField(issue.field, doc);
    const fix = deriveFixFromCode(issue, doc);
    return {
      id: `validate-${platformId}-${idx}`,
      platformId,
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      ...(locate ? { locate } : {}),
      ...(fix ? { fix } : {}),
    };
  });
}

/** 找到第一个标题块(带块下标)。 */
function findHeading(blocks: readonly Block[]): { b: HeadingBlock; i: number } | undefined {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (isHeading(b)) return { b, i };
  }
  return undefined;
}

function deriveLocateFromField(field: string | undefined, doc: Document): SuggestionLocate | undefined {
  if (field === "title") {
    const firstHeading = findHeading(doc.blocks);
    if (firstHeading) {
      return {
        blockIndex: firstHeading.i,
        blockType: "heading",
        excerpt: blockToPlainText(firstHeading.b).slice(0, 40),
        headingLevel: firstHeading.b.level,
      };
    }
    // H1 已被 lift 为 meta.title,回退到 meta 标题(无块定位,但仍有摘录)。
    if (doc.meta.title) {
      return {
        blockIndex: -1,
        blockType: "heading",
        excerpt: doc.meta.title.slice(0, 40),
        headingLevel: 1,
      };
    }
    return undefined;
  }
  if (field === "body") {
    const firstPara = doc.blocks.map((b, i) => ({ b, i })).find(({ b }) => isParagraph(b));
    return firstPara
      ? { blockIndex: firstPara.i, blockType: "paragraph", excerpt: blockToPlainText(firstPara.b).slice(0, 40) }
      : undefined;
  }
  return undefined;
}

function deriveFixFromCode(
  issue: { code: string; message: string },
  doc: Document,
): ContentSuggestion["fix"] | undefined {
  switch (issue.code) {
    case "body-too-long": {
      return {
        kind: "truncate",
        description: "正文超过平台字数上限,建议精简(此处不自动删正文,仅提示)",
        apply: (md) => md,
      };
    }
    case "title-too-long": {
      // H1 通常被 lift 为 meta.title(不在 blocks 中),这里基于 meta 标题截断。
      const titleText = doc.meta.title;
      if (!titleText) return undefined;
      return {
        kind: "truncate",
        description: "标题超过上限,建议精简",
        before: titleText.slice(0, 30),
        apply: (md) => truncateFirstHeading(md, 30),
      };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// 文本变换工具(纯字符串,供修复动作复用)
// ---------------------------------------------------------------------------

/** 按块序号拆分超长段落:在句子边界("。" / "!" / "?" 后)插入空行。 */
export function splitParagraphByBlock(md: string, _block: Block, blockIndex: number): string {
  // 通过 "块序号 → 段落在 markdown 中的近似位置" 的轻量方案:
  // 直接把全文最长的连续段落按句号拆段。为保持确定性,这里扫描整篇 md,
  // 找到最长的"非空行"(作为疑似目标段),按中英句号拆行。
  const lines = md.split("\n");
  let targetIdx = -1;
  let maxLen = 0;
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.length > maxLen) {
      maxLen = t.length;
      targetIdx = i;
    }
  });
  void _block;
  void blockIndex;
  if (targetIdx < 0) return md;
  const target = lines[targetIdx]!;
  const parts = target.split(/(?<=[。！？!?])\s*/).filter(Boolean);
  if (parts.length < 2) return md;
  const head = lines.slice(0, targetIdx);
  const tail = lines.slice(targetIdx + 1);
  return [...head, ...parts, ...tail].join("\n");
}

/** 在首个超长段落前插入 H2 小标题(取该段首句 ≤20 字)。 */
export function insertHeadingBeforeLongParagraph(md: string, blocks: readonly Block[]): string {
  const longPara = blocks
    .map((b, i) => ({ b, i }))
    .find(({ b }) => isParagraph(b) && graphemeCount(blockToPlainText(b)) > 120);
  if (!longPara) return md;
  const text = blockToPlainText(longPara.b);
  const firstSentence = text.split(/[。！？!?]/)[0]?.slice(0, 20) ?? "小节";
  const lines = md.split("\n");
  const targetLine = lines.findIndex((l) => l.trim().length > 90);
  if (targetLine < 0) return md;
  lines.splice(targetLine, 0, `\n## ${firstSentence}\n`);
  return lines.join("\n");
}

/** 截断首个 H1 标题到指定字数。 */
export function truncateFirstHeading(md: string, max: number): string {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      lines[i] = `${m[1]} ${m[2]!.slice(0, max)}`;
      break;
    }
  }
  return lines.join("\n");
}

/** 计算可修复建议数。 */
export function countFixable(suggestions: readonly ContentSuggestion[]): number {
  return suggestions.filter((s) => s.fix).length;
}

// ---------------------------------------------------------------------------
// 标题/摘要多方案对比(AI-02)
// ---------------------------------------------------------------------------

/** 单方案(标题/摘要)候选。 */
export interface VariantOption {
  readonly id: string;
  /** 方案文本(标题或摘要)。 */
  readonly text: string;
  /** 来源:llm / rule / original。 */
  readonly source: "llm" | "rule" | "original";
  /** 生成它的 LLM 模型名(可选)。 */
  readonly model?: string;
  /** 提示词版本/模板版本。 */
  readonly promptVersion?: string;
  /** 字素长度(≤上限的标记)。 */
  readonly charCount: number;
  /** 是否在平台上限内。 */
  readonly withinLimit: boolean;
  /** 是否被用户选中应用。 */
  readonly selected?: boolean;
}

/** 生成标题/摘要候选方案的规则回退(无 LLM 时也有 2-3 个确定性方案)。 */
export interface VariantGenerateInput {
  readonly platformId: string;
  readonly title: string;
  readonly summary?: string;
  readonly contentText: string;
  readonly titleMax?: number;
  readonly summaryMax?: number;
}

/**
 * 规则派生标题/摘要候选(确定性、离线可用):
 * - 原标题;
 * - 数字/亮点提取式(取正文首个数字句);
 * - 疑问句/悬念式(若原文有问句则复用,否则拼接"为什么…?");
 * 纯规则,不依赖 LLM。
 */
export function ruleVariants(input: VariantGenerateInput): readonly VariantOption[] {
  const { title, summary, contentText, titleMax = 30, summaryMax = 120 } = input;
  const out: VariantOption[] = [];

  // 原标题。
  out.push({
    id: "original-title",
    text: title,
    source: "original",
    charCount: [...title].length,
    withinLimit: [...title].length <= titleMax,
  });

  // 亮点式:找正文中第一个带数字的句子。
  const numericSentence = contentText.split(/[。！？!?]/).find((s) => /\d/.test(s))?.trim();
  if (numericSentence && numericSentence.length <= titleMax) {
    out.push({
      id: "rule-numeric",
      text: numericSentence,
      source: "rule",
      charCount: [...numericSentence].length,
      withinLimit: [...numericSentence].length <= titleMax,
    });
  }

  // 悬念式。
  const hook = contentText.split(/[。！？!?]/)[0]?.trim() ?? "";
  if (hook && hook.length > 0) {
    const t = hook.length > titleMax - 3 ? `${hook.slice(0, titleMax - 3)}…` : hook;
    out.push({
      id: "rule-hook",
      text: `${t}，为什么？`,
      source: "rule",
      charCount: [...`${t}，为什么？`].length,
      withinLimit: [...`${t}，为什么？`].length <= titleMax,
    });
  }

  // 摘要候选(若原文有摘要则列出,否则用首段摘要)。
  const derivedSummary = summary && summary.length > 0 ? summary : `${contentText.slice(0, summaryMax)}…`;
  out.push({
    id: "rule-summary",
    text: derivedSummary,
    source: "rule",
    charCount: [...derivedSummary].length,
    withinLimit: [...derivedSummary].length <= summaryMax,
  });

  return out;
}

// ---------------------------------------------------------------------------
// 事实/引用检查(AI-03)
// ---------------------------------------------------------------------------

/** 事实检查条目:只标记缺证据内容,不伪造引用。 */
export interface FactCheckItem {
  readonly id: string;
  /** 原文句子。 */
  readonly sentence: string;
  /** 定位到段落块下标。 */
  readonly blockIndex: number;
  /** 句内是否含可核验线索(数字/日期/专名/链接)。 */
  readonly hasVerifiableClue: boolean;
  /** 是否已有引用/来源标注。 */
  readonly hasCitation: boolean;
  /** 检查结论。 */
  readonly verdict: "unverified-claim" | "has-citation" | "no-clue";
  /** 给用户的可执行提示。 */
  readonly message: string;
}

/**
 * 事实/引用检查:扫描正文,对"无来源支撑的断言"给出标记。
 * 原则(AI-03):只标记缺证据内容,不伪造引用;证据与生成文本分层。
 * 启发式:
 * - 含明确数字/日期/百分比/专名的句子若无引用链接或"来源/参考"字样 → unverified-claim;
 * - 含外链或"引用/据/来源"字样 → has-citation;
 * - 纯观点/无具体线索 → no-clue(不标为已核验)。
 */
export function factCheckDocument(doc: Document): readonly FactCheckItem[] {
  const out: FactCheckItem[] = [];
  doc.blocks.forEach((block, blockIndex) => {
    if (!isParagraph(block)) return;
    const text = inlinesToPlainText(block.inlines);
    // 按句号拆句(中文/英文/问号叹号)。
    const sentences = text.split(/(?<=[。！？!?．])\s*/).map((s) => s.trim()).filter(Boolean);
    sentences.forEach((sentence, j) => {
      if (sentence.length < 8) return; // 过短,忽略
      const hasVerifiableClue = /[0-9０-９]|%|年|月|日|https?:\/\/|研究|数据|统计|报道|调查/.test(sentence);
      const hasCitation = /https?:\/\/|\[.*\]\(|来源|引用|参考文献|据(?:统计|报道|研究|调查)[^。]{0,8}|数据显示|调查显示|详见/.test(sentence);
      let verdict: FactCheckItem["verdict"];
      let message: string;
      if (hasCitation) {
        verdict = "has-citation";
        message = "该句包含引用/来源标注";
      } else if (hasVerifiableClue) {
        verdict = "unverified-claim";
        message = "含具体数字/日期等可核验信息,但缺少来源标注——建议补充引用,不要显示为已核验";
      } else {
        verdict = "no-clue";
        message = "观点陈述,无具体可核验线索";
      }
      out.push({
        id: `fact-${blockIndex}-${j}`,
        sentence: sentence.slice(0, 60),
        blockIndex,
        hasVerifiableClue,
        hasCitation,
        verdict,
        message,
      });
    });
  });
  return out;
}

/** 统计事实检查结果。 */
export function summarizeFactCheck(items: readonly FactCheckItem[]): {
  readonly total: number;
  readonly unverified: number;
  readonly withCitation: number;
} {
  return {
    total: items.length,
    unverified: items.filter((i) => i.verdict === "unverified-claim").length,
    withCitation: items.filter((i) => i.verdict === "has-citation").length,
  };
}

/** 把建议转为平台覆盖层(title/summary 选择应用到对应平台)。 */
export function applyVariantToOverride(
  override: PlatformOverride | undefined,
  kind: "title" | "summary",
  text: string,
): PlatformOverride {
  return {
    ...(override ?? {}),
    ...(kind === "title" ? { title: text } : { summary: text }),
  };
}

/** 内联转纯文本(供 AI-02 提取正文)。 */
export function inlineToText(inline: Inline): string {
  if (inline.type === "text" || inline.type === "code" || inline.type === "emoji") return inline.value;
  if (inline.type === "strong" || inline.type === "em") return inline.children.map(inlineToText).join("");
  if (inline.type === "link") return inline.children.map(inlineToText).join("");
  if (inline.type === "inlineMath") return inline.tex;
  if (inline.type === "lineBreak") return " ";
  return "";
}

/** 块纯文本(供 AI-02)。 */
export function blockText(block: Block): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.inlines.map(inlineToText).join("");
    case "list":
      return block.items.map((item) => item.map(blockText).join(" ")).join("\n");
    case "quote":
      return block.blocks.map(blockText).join("\n");
    case "codeBlock":
      return block.text;
    case "image":
      return block.caption ?? block.alt ?? "";
    default:
      return "";
  }
}
