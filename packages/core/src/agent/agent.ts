/**
 * AI 自动完成 Agent —— 端到端编排。
 *
 * 让大模型自动完成"从分析到可发布"的重复劳动:
 *   1. analyze:  解析文档 → 结构分析(字数/段落/标题/图片) + 各平台排版评分;
 *   2. fix:      派生可自动修复建议,按最大轮次逐轮应用(每轮后重新派生);
 *   3. enhance:  为各平台生成标题/摘要候选(LLM 优先,规则兜底);
 *   4. verify:   复检修复后文档的校验/评分;
 *   5. report:   汇总报告。
 *
 * 健壮性原则:
 *   - 每步 try/catch 独立回退,任何一步失败不阻断整体;
 *   - LLM 不可用 → 纯规则兜底(分析/修复/规则候选仍完整);
 *   - autoFix 有最大轮次与"内容未变化即停"保护,防止死循环;
 *   - 全程纯函数/纯 TS,零 DOM,可被 app / 计划任务 / 批处理复用。
 */
import type { Document } from "../ir/types.js";
import { markdownToIR } from "../parse/md-to-ir.js";
import { getAdapter } from "../adapters/registry.js";
import { validate } from "../validate/validator.js";
import { scoreTypography } from "../quality/typography.js";
import { deriveTypographySuggestions, deriveValidationSuggestions } from "../assistant/suggestions.js";
import type { ContentSuggestion } from "../assistant/suggestions.js";
import { generateVariants } from "../assistant/variants.js";
import { graphemeCount } from "../transforms/grapheme-count.js";
import { isHeading, isImage, isParagraph, blockToPlainText } from "../ir/guards.js";
import { rewriteParagraphsWithLlm } from "./paragraph-rewrite.js";
import type { AgentStep, AppliedFix, AutoAgentOptions, AutoAgentResult, DocumentAnalysis } from "./types.js";

/** 解析文档(容错:失败返回 null)。 */
function parseDocument(markdown: string): Document | null {
  try {
    return markdownToIR(markdown).document;
  } catch {
    return null;
  }
}

/** 结构分析。 */
function analyzeDocument(doc: Document): DocumentAnalysis {
  let charCount = 0;
  let paragraphCount = 0;
  let headingCount = 0;
  let imageCount = 0;
  for (const b of doc.blocks) {
    if (isHeading(b)) {
      headingCount++;
      charCount += graphemeCount(blockToPlainText(b));
    } else if (isParagraph(b)) {
      paragraphCount++;
      charCount += graphemeCount(blockToPlainText(b));
    } else if (isImage(b)) {
      imageCount++;
    }
  }
  charCount += graphemeCount(doc.meta.title ?? "");
  return { charCount, paragraphCount, headingCount, imageCount };
}

/** 派生全部可修复建议(按定位 + code 去重,避免多平台重复)。
 * 注意:建议基于 preprocess 后的文档派生(排版/校验均对 processed 计算),
 * 因此传入 processed 文档而非原始 doc,确保定位与建议来源对齐。 */
function deriveFixable(doc: Document, platformIds: readonly string[]): readonly ContentSuggestion[] {
  const seen = new Set<string>();
  const out: ContentSuggestion[] = [];
  for (const pid of platformIds) {
    const adapter = getAdapter(pid);
    if (!adapter) continue;
    let items: readonly ContentSuggestion[] = [];
    try {
      const processed = adapter.preprocess(doc, undefined);
      const quality = scoreTypography(processed, pid);
      items = deriveTypographySuggestions(processed, pid, quality.suggestions);
      const payload = adapter.serialize(processed, undefined);
      const report = validate(pid, processed, payload, adapter.capabilities, doc);
      items = [...items, ...deriveValidationSuggestions(report.issues, pid, doc)];
    } catch {
      continue;
    }
    for (const s of items) {
      if (!s.fix) continue;
      const key = `${s.code}:${s.locate?.blockIndex ?? "global"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/** 平均排版分(所选平台)。 */
function avgQuality(doc: Document, platformIds: readonly string[]): number {
  let sum = 0;
  let n = 0;
  for (const pid of platformIds) {
    const adapter = getAdapter(pid);
    if (!adapter) continue;
    try {
      const processed = adapter.preprocess(doc, undefined);
      sum += scoreTypography(processed, pid).overall;
      n++;
    } catch {
      /* 跳过失败平台 */
    }
  }
  return n > 0 ? Math.round(sum / n) : 0;
}

/** 正文纯文本(前若干字,供 prompt / 候选)。 */
function docText(doc: Document): string {
  const paras = doc.blocks.filter(isParagraph).map((b) => blockToPlainText(b));
  return paras.join(" ").trim() || doc.meta.title || "";
}

/**
 * 运行 AI 自动完成 Agent。
 *
 * @param markdown 源 Markdown
 * @param options 选项(平台/LLM/自动修复轮次等)
 */
export async function runAutoAgent(markdown: string, options: AutoAgentOptions): Promise<AutoAgentResult> {
  const started = options.now?.() ?? Date.now();
  const platformIds = [...(options.platformIds ?? [])];
  const llm = options.llm;
  const usedLlm = !!llm?.available;
  const autoFix = options.autoFix ?? true;
  const maxFixRounds = Math.max(1, options.maxFixRounds ?? 3);

  const steps: AgentStep[] = [];
  let current = markdown;
  const appliedFixes: AppliedFix[] = [];
  const analysis: AutoAgentResult["analysis"] = { charCount: 0, paragraphCount: 0, headingCount: 0, imageCount: 0, avgQuality: 0 };
  // 构建期可变容器(最终通过只读接口返回)。
  const analysisMutable: {
    charCount: number;
    paragraphCount: number;
    headingCount: number;
    imageCount: number;
    avgQuality: number;
  } = analysis as { charCount: number; paragraphCount: number; headingCount: number; imageCount: number; avgQuality: number };

  // ---- 1. analyze ----
  let doc = parseDocument(current);
  if (doc) {
    const a = analyzeDocument(doc);
    analysisMutable.charCount = a.charCount;
    analysisMutable.paragraphCount = a.paragraphCount;
    analysisMutable.headingCount = a.headingCount;
    analysisMutable.imageCount = a.imageCount;
    analysisMutable.avgQuality = avgQuality(doc, platformIds);
  }

  // ---- 2. fix(轮次内自动应用) ----
  if (autoFix && doc) {
    let skippedTotal = 0;
    for (let round = 0; round < maxFixRounds; round++) {
      const fixable = deriveFixable(doc, platformIds);
      if (fixable.length === 0) break;
      let changed = false;
      let skipped = 0;
      for (const s of fixable) {
        if (!s.fix) continue;
        try {
          const before = current;
          const after = s.fix.apply(before);
          if (after === before) {
            skipped++;
            continue;
          }
          appliedFixes.push({ id: s.id, description: s.fix.description, before, after });
          current = after;
          changed = true;
        } catch {
          skipped++;
        }
      }
      skippedTotal += skipped;
      if (!changed) break;
      const reparsed = parseDocument(current);
      if (!reparsed) break;
      doc = reparsed;
    }
    steps.push({ kind: "fix", applied: appliedFixes.slice(), skippedCount: skippedTotal });
  } else {
    steps.push({ kind: "fix", applied: [], skippedCount: 0 });
  }

  // 修复后重新解析(若修复改变了内容)。
  if (appliedFixes.length > 0) {
    const reparsed = parseDocument(current);
    if (reparsed) doc = reparsed;
  }

  // ---- 3. enhance(标题/摘要候选 + LLM 逐段风格改写) ----
  const variants: Record<string, { titles: import("../assistant/suggestions.js").VariantOption[]; summaries: import("../assistant/suggestions.js").VariantOption[] }> = {};
  const appliedOverrides: Record<string, { title?: string; summary?: string }> = {};
  const paragraphRewrites: Record<string, readonly import("./paragraph-rewrite.js").RewrittenParagraph[]> = {};
  const enhanceEnabled = options.enhance ?? true;
  const rewriteParagraphs = options.rewriteParagraphs ?? true;
  const maxRewriteParagraphs = Math.max(1, options.maxRewriteParagraphs ?? 3);
  if (enhanceEnabled && doc) {
    const title = doc.meta.title ?? "";
    const contentText = docText(doc);
    await Promise.all(
      platformIds.map(async (pid) => {
        const adapter = getAdapter(pid);
        if (!adapter) return;
        try {
          const cap = adapter.capabilities;
          const result = await generateVariants(
            {
              platformId: pid,
              title,
              contentText,
              titleMax: cap.limits.titleMax ?? 30,
              summaryMax: cap.limits.summaryMax ?? 120,
            },
            llm,
            3,
          );
          variants[pid] = { titles: [...result.titles], summaries: [...result.summaries] };
          if (options.autoApplyOverrides) {
            const chosenTitle = result.titles.find((v) => v.withinLimit)?.text;
            const chosenSummary = result.summaries.find((v) => v.withinLimit)?.text;
            if (chosenTitle || chosenSummary) {
              appliedOverrides[pid] = {
                ...(chosenTitle ? { title: chosenTitle } : {}),
                ...(chosenSummary ? { summary: chosenSummary } : {}),
              };
            }
          }
        } catch {
          /* 单平台增强失败不影响其它平台 */
        }
      }),
    );
    // LLM 逐段风格改写(仅在 LLM 可用时;正文段落逐段润色,结构不变)。
    if (usedLlm && rewriteParagraphs && llm) {
      await Promise.all(
        platformIds.map(async (pid) => {
          const adapter = getAdapter(pid);
          if (!adapter) return;
          try {
            const result = await rewriteParagraphsWithLlm(current, {
              platformId: pid,
              llm,
              maxParagraphs: maxRewriteParagraphs,
              // AI-INSIGHT-02:任务级参数透传。
              ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
              ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
              ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
            });
            if (result.rewritten.length > 0) {
              paragraphRewrites[pid] = result.rewritten;
              if (result.markdown !== current) current = result.markdown;
            }
          } catch {
            /* 单平台段落改写失败不影响其它平台 */
          }
        }),
      );
    }
  }
  steps.push({
    kind: "enhance",
    usedLlm,
    variants: { ...variants },
    appliedOverrides: { ...appliedOverrides },
    paragraphRewrites: { ...paragraphRewrites },
  });

  // ---- 4. verify(复检修复后文档) ----
  let errorCount = 0;
  const remainingErrors: string[] = [];
  let allPassed = false;
  // 段落风格改写可能改变了正文:复检前重新解析,保证校验基于最新内容。
  if (Object.keys(paragraphRewrites).length > 0) {
    const reparsed = parseDocument(current);
    if (reparsed) doc = reparsed;
  }
  if (doc) {
    for (const pid of platformIds) {
      const adapter = getAdapter(pid);
      if (!adapter) continue;
      try {
        const processed = adapter.preprocess(doc, undefined);
        const payload = adapter.serialize(processed, undefined);
        const report = validate(pid, processed, payload, adapter.capabilities, doc);
        if (report.hasError) {
          errorCount++;
          const errIssue = report.issues.find((i) => i.severity === "error");
          remainingErrors.push(errIssue ? `${pid}: ${errIssue.message}` : `${pid}: 存在校验错误`);
        }
      } catch {
        errorCount++;
        remainingErrors.push(`${pid}: 复检异常`);
      }
    }
    allPassed = errorCount === 0;
  }
  steps.push({ kind: "verify", errorCount, remainingErrors: [...remainingErrors], allPassed });

  // ---- 5. report ----
  const fixSummary =
    appliedFixes.length > 0
      ? `自动修复 ${appliedFixes.length} 处(${appliedFixes.map((f) => f.description).join("; ")})`
      : "无需自动修复或全部跳过";
  const verifySummary = allPassed ? "全部平台通过校验" : `${errorCount} 个平台存在校验错误`;
  const paragraphSummary = (() => {
    const total = Object.values(paragraphRewrites).reduce((n, list) => n + list.length, 0);
    return total > 0 ? `;LLM 逐段风格改写 ${total} 段` : "";
  })();
  const message = `分析完成(${analysis.charCount} 字 / ${analysis.paragraphCount} 段 / ${analysis.headingCount} 个标题 / ${analysis.imageCount} 张图,平均排版分 ${analysis.avgQuality});${fixSummary};${
    usedLlm ? "已生成 LLM 标题/摘要候选" + paragraphSummary : "LLM 不可用,已用规则候选兜底"
  };${verifySummary}`;
  steps.push({ kind: "report", message });

  const elapsedMs = (options.now?.() ?? Date.now()) - started;
  return {
    ok: true,
    elapsedMs,
    usedLlm,
    steps,
    analysis,
    markdown: current,
    appliedFixes: appliedFixes.slice(),
    variants: { ...variants },
    paragraphRewrites: { ...paragraphRewrites },
  };
}
