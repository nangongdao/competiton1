/**
 * 排版质量评分(UPGRADE §5.2)—— 从"能发布"到"发得好"。
 *
 * 为平台产物打 0-100 分并给出可执行建议。不同平台的最佳实践不同:
 * 公众号偏好短段落 + 频繁配图,知乎容忍长段落,小红书要求高图文比。
 * 四维评分:段落节奏 / 图文平衡 / 标题结构 / 可读性,加权得总分。
 * UI 据此展示"公众号排版分 82/100,建议拆分第 3 段" —— 工具到助手的进阶。
 */
import type { Document } from "../ir/types.js";
import { blockToPlainText, isHeading, isImage, isParagraph } from "../ir/guards.js";
import { graphemeCount } from "../transforms/grapheme-count.js";

export interface TypographyScore {
  /** 段落长度分布是否适合移动端阅读(过长段落扣分)。 */
  readonly paragraphRhythm: number;
  /** 图文比例是否均衡(相对平台偏好)。 */
  readonly imageBalance: number;
  /** 标题层级是否规范(跳级扣分)。 */
  readonly headingStructure: number;
  /** 是否有过长的无分隔文本块。 */
  readonly readability: number;
  /** 加权总分。 */
  readonly overall: number;
  /** 可执行建议(人工可读)。 */
  readonly suggestions: readonly string[];
}

export interface TypographyPreference {
  readonly name: string;
  /** 平台理想单段字数(超过 1.5 倍视为过长)。 */
  readonly idealParagraphLength: number;
  /** 平台理想的"每张配图间隔正文字数"(越小=越依赖配图)。 */
  readonly idealCharsPerImage: number;
}

/** 各平台排版偏好基线。 */
export const TYPOGRAPHY_PREFERENCES: Readonly<Record<string, TypographyPreference>> = {
  wechat: { name: "公众号", idealParagraphLength: 60, idealCharsPerImage: 400 },
  zhihu: { name: "知乎", idealParagraphLength: 140, idealCharsPerImage: 900 },
  bilibili: { name: "B站专栏", idealParagraphLength: 100, idealCharsPerImage: 700 },
  xiaohongshu: { name: "小红书", idealParagraphLength: 40, idealCharsPerImage: 150 },
};

/** 未列出的平台回退通用偏好。 */
export const DEFAULT_TYPOGRAPHY_PREFERENCE: TypographyPreference = {
  name: "通用",
  idealParagraphLength: 100,
  idealCharsPerImage: 600,
};

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** 为平台产物打排版质量分(输入已 preprocess 的文档,结构仍保留段落/标题/图片)。 */
export function scoreTypography(doc: Document, platformId: string): TypographyScore {
  const prefs = TYPOGRAPHY_PREFERENCES[platformId] ?? DEFAULT_TYPOGRAPHY_PREFERENCE;

  const paragraphs = doc.blocks.filter(isParagraph).map((b) => blockToPlainText(b));
  const totalChars = graphemeCount(paragraphs.join(""));
  const imageCount = countImages(doc.blocks);

  const paragraphRhythm = scoreParagraphRhythm(paragraphs, prefs.idealParagraphLength);
  const imageBalance = scoreImageBalance(imageCount, totalChars, prefs.idealCharsPerImage);
  const headingStructure = scoreHeadingStructure(doc);
  const readability = scoreReadability(paragraphs, prefs.idealParagraphLength);

  const overall = Math.round(
    paragraphRhythm * 0.35 + imageBalance * 0.2 + headingStructure * 0.25 + readability * 0.2,
  );

  const suggestions = buildSuggestions(
    doc,
    paragraphs,
    imageCount,
    totalChars,
    prefs,
    { paragraphRhythm, imageBalance, headingStructure, readability },
  );

  return { paragraphRhythm, imageBalance, headingStructure, readability, overall, suggestions };
}

/** 段落节奏:过长段落(>1.5×理想)每段扣 15,低至 20。 */
function scoreParagraphRhythm(paragraphs: readonly string[], ideal: number): number {
  if (paragraphs.length === 0) return 100;
  const longCount = paragraphs.filter((p) => graphemeCount(p) > ideal * 1.5).length;
  return clamp(100 - longCount * 15, 20, 100);
}

/** 图文平衡:实际配图数相对"按字数期望的配图数"的达成率。 */
function scoreImageBalance(imageCount: number, totalChars: number, idealCharsPerImage: number): number {
  if (totalChars === 0) return 100;
  const expected = Math.ceil(totalChars / idealCharsPerImage);
  return clamp(Math.round(100 * (imageCount / expected)), 0, 100);
}

/** 标题结构:H2→H4 跳级、中途出现 H1、空标题、无标题的大长文各扣分。 */
function scoreHeadingStructure(doc: Document): number {
  const headings = doc.blocks.filter(isHeading);
  let score = 100;

  let prevLevel: number | null = null;
  let sawH1 = false;
  for (const h of headings) {
    const text = blockToPlainText(h);
    if (!text.trim()) score -= 15;
    if (h.level === 1 && prevLevel !== null) score -= 10; // H1 只应出现在开头
    if (h.level === 1) sawH1 = true;
    if (prevLevel !== null && h.level > prevLevel + 1) score -= 20; // 跳级
    prevLevel = h.level;
  }

  const nonHeading = doc.blocks.filter((b) => b.type !== "heading").length;
  if (headings.length === 0 && nonHeading > 8) score -= 20;
  if (sawH1 && headings.length === 1) score -= 10; // 只有标题没有小标题,结构单薄
  return clamp(score, 20, 100);
}

/** 可读性:最长的无分隔文本块越远超理想,越难读。 */
function scoreReadability(paragraphs: readonly string[], ideal: number): number {
  if (paragraphs.length === 0) return 100;
  const maxLen = Math.max(...paragraphs.map((p) => graphemeCount(p)));
  if (maxLen <= ideal) return 100;
  return clamp(Math.round(100 - ((maxLen / ideal) - 1) * 30), 20, 100);
}

/** 递归统计文档中图片块数量(含列表/引用内的嵌套)。 */
function countImages(blocks: readonly Document["blocks"][number][]): number {
  let n = 0;
  for (const b of blocks) {
    if (isImage(b)) n++;
    else if (b.type === "quote") n += countImages(b.blocks);
    else if (b.type === "list") b.items.forEach((item) => (n += countImages(item)));
  }
  return n;
}

function buildSuggestions(
  doc: Document,
  paragraphs: readonly string[],
  imageCount: number,
  totalChars: number,
  prefs: TypographyPreference,
  dims: { paragraphRhythm: number; imageBalance: number; headingStructure: number; readability: number },
): readonly string[] {
  const out: string[] = [];

  // 段落节奏:指出具体偏长段落的位置。
  if (dims.paragraphRhythm < 80) {
    const offenders = paragraphs
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => graphemeCount(p) > prefs.idealParagraphLength * 1.5)
      .slice(0, 3)
      .map(({ p, i }) => `第 ${i + 1} 段(${graphemeCount(p)} 字)`);
    out.push(
      `${prefs.name}建议段落 ≤${prefs.idealParagraphLength} 字:${offenders.join("、")}偏长,拆成 2-3 段更利移动端阅读`,
    );
  }

  // 图文平衡。
  if (dims.imageBalance < 70 && totalChars > 0) {
    const expected = Math.ceil(totalChars / prefs.idealCharsPerImage);
    out.push(`正文 ${totalChars} 字仅有 ${imageCount} 张图,建议补充配图(约每 ${prefs.idealCharsPerImage} 字一张,当前建议 ${expected} 张)`);
  }

  // 标题结构。
  if (dims.headingStructure < 80) {
    const levels = doc.blocks.filter(isHeading).map((h) => h.level);
    for (let i = 1; i < levels.length; i++) {
      if (levels[i]! > levels[i - 1]! + 1) {
        out.push(`标题层级跳级(H${levels[i - 1]} → H${levels[i]}),建议补中间层级保持结构完整`);
        break;
      }
    }
    if (doc.blocks.filter(isHeading).length === 0) {
      out.push("正文较长且没有小标题,建议用 H2/H3 分节,提升扫读效率");
    }
  }

  // 可读性。
  if (dims.readability < 70) {
    const maxLen = Math.max(...paragraphs.map((p) => graphemeCount(p)));
    out.push(`存在 ${maxLen} 字的超长文本块,建议增加段落分隔(每 ${prefs.idealParagraphLength} 字左右一段)`);
  }

  return out.slice(0, 5);
}
