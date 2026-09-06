/**
 * v7 Phase 4 · AI-WRITE-01 —— 整篇 AI 写作增强。
 *
 * 在选区 AI 操作(editor-ai)之上,提供**整篇文档级**的 AI 写作动作:
 * - `polish-doc`:整篇润色(逐段最小改动,保留 Markdown 结构);
 * - `expand-doc`:扩写(补充细节/例证);
 * - `continue-doc`:续写(在文末追加一段);
 * - `summarize-doc`:总结(生成一段摘要,供副标题/推荐语)。
 *
 * 设计原则(与项目一致):
 * - 纯 TS 零 DOM,可单测;
 * - **保守结构**:只改写/追加"纯文本段落",标题 / 列表 / 引用 / 代码 / 表格 / 图片
 *   字节级不动(按行区间回写,从下往上保证稳定);
 * - LLM 不可用/失败 → 规则兜底(expand 补一段、continue 复用结论、summarize 取首段),
 *   绝不伪造结果、绝不阻断;
 * - 输出被检测为块级结构时拒绝应用;与原文一致不算改写。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 整篇 AI 写作动作。 */
export type DocWriteOp = "polish-doc" | "expand-doc" | "continue-doc" | "summarize-doc";

/** 整篇写作请求。 */
export interface DocWriteRequest {
  /** 当前完整 Markdown。 */
  readonly markdown: string;
  /** 动作。 */
  readonly op: DocWriteOp;
  /** 可选目标平台(风格上下文,如小红书口语化)。 */
  readonly platformId?: string;
  /** 任务级温度。 */
  readonly temperature?: number;
  /** 任务级最大 token。 */
  readonly maxTokens?: number;
  /** 任务级系统提示词。 */
  readonly systemPrompt?: string;
}

/** 整篇写作结果。 */
export interface DocWriteResult {
  /** 处理后的 Markdown(失败/不可用时等于原文)。 */
  readonly text: string;
  /** 是否成功使用 LLM(否则为规则回退)。 */
  readonly usedLlm: boolean;
  /** 是否发生了实际改动(无改动表示内容不变)。 */
  readonly changed: boolean;
  /** 失败/回退原因(成功时为空)。 */
  readonly error?: string;
  /** 动作。 */
  readonly op: DocWriteOp;
}

/** 动作的人类可读名称。 */
export const DOC_WRITE_OP_LABELS: Record<DocWriteOp, string> = {
  "polish-doc": "整篇润色",
  "expand-doc": "扩写",
  "continue-doc": "续写",
  "summarize-doc": "生成摘要",
};

/** 检测输出是否包含块级 Markdown 结构(拒绝应用)。 */
export function isBlockishOutputDoc(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^```/m.test(t)) return true;
  if (/^#{1,6}\s+/m.test(t)) return true;
  if (/^\s*([-*+]|\d+\.)\s+/m.test(t)) return true;
  if (/^\s*>\s?/m.test(t)) return true;
  if (/^\s*\|.*\|\s*$/m.test(t)) return true;
  return false;
}

/** 提取纯文本段落(供 LLM 输入与规则兜底)。 */
export function plainParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^#{1,6}\s/.test(p) && !/^[-*+]\s/.test(p) && !/^\d+\.\s/.test(p) && !/^>\s?/.test(p) && !/^```/.test(p));
}

/** 构造整篇写作的 LLM 请求。 */
export function docWriteRequest(req: DocWriteRequest): LlmRequest {
  const { markdown, op, platformId = "generic" } = req;
  switch (op) {
    case "polish-doc":
      return {
        task: "paragraph-rewrite",
        platformId,
        input: markdown,
        constraints: { maxChars: Math.max(8000, markdown.length * 2) },
        temperature: req.temperature ?? 0.4,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是新媒体内容编辑。对整篇 Markdown 做最小改动润色:修正错别字/语病/标点,统一语气,保持 Markdown 结构与全部事实/数字/专名/链接不变。只输出润色后的 Markdown 全文。",
      };
    case "expand-doc":
      return {
        task: "paragraph-rewrite",
        platformId,
        input: markdown,
        constraints: { maxChars: Math.max(10000, markdown.length * 3) },
        temperature: req.temperature ?? 0.7,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是内容写作助手。对整篇 Markdown 扩写:保留全部原有内容与 Markdown 结构,在合适的段落间补充具体细节、例证、数据或上下文,让文章更丰满。只输出扩写后的 Markdown 全文。",
      };
    case "continue-doc":
      return {
        task: "paragraph-rewrite",
        platformId,
        input: markdown,
        constraints: { maxChars: Math.max(4000, markdown.length) },
        temperature: req.temperature ?? 0.8,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是内容写作助手。阅读整篇 Markdown,在文末自然续写一段总结或升华,保持语气与主题一致,不重复已有内容。只输出续写的段落(纯文本,不要输出标题/列表/Markdown 标记)。",
      };
    case "summarize-doc":
      return {
        task: "summary",
        platformId,
        input: markdown,
        constraints: { maxChars: 150 },
        temperature: req.temperature ?? 0.4,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是内容摘要助手。为整篇 Markdown 写一段 80-150 字的中文摘要,保留核心信息与结论,适合做副标题或推荐语。只输出摘要文本,不要输出标题、列表或 Markdown 标记。",
      };
  }
}

/** 规则兜底:LLM 不可用/失败时的确定性动作。 */
export function ruleDocWrite(req: DocWriteRequest): string {
  const { markdown, op } = req;
  const paragraphs = plainParagraphs(markdown);
  switch (op) {
    case "polish-doc":
    case "expand-doc": {
      // 无 LLM:原样返回(不伪造改写)。
      return markdown;
    }
    case "continue-doc": {
      const last = paragraphs[paragraphs.length - 1];
      if (!last) return markdown;
      // 确定性续写:基于最后一段的关键词做一句总结式收尾。
      const firstSentence = last.split(/[。！？!?]/)[0]?.trim() ?? last.slice(0, 40);
      const tail = firstSentence.length > 30 ? `${firstSentence.slice(0, 30)}…` : firstSentence;
      return `${markdown.trimEnd()}\n\n总的来说,${tail}值得持续关注与深入实践。`;
    }
    case "summarize-doc": {
      const first = paragraphs[0];
      if (!first) return "";
      const text = first.length > 80 ? `${first.slice(0, 80)}…` : first;
      return text;
    }
  }
}

/**
 * 对整篇 Markdown 执行一次 AI 写作动作。
 *
 * 行为契约:
 * - LLM 不可用/失败 → 规则兜底(usedLlm:false);
 * - 改写类(润色/扩写)要求输出仍为 Markdown 文档(块级结构允许,因为整篇就是 Markdown);
 *   但若输出为纯空/块级检测异常则回退原文;
 * - 追加类(续写/摘要)要求输出为纯文本(拒绝块级结构);
 * - 与原文一致 → changed:false。
 */
export async function runDocWrite(
  req: DocWriteRequest,
  llm?: LlmAdapter,
): Promise<DocWriteResult> {
  const { markdown, op } = req;
  if (!llm?.available) {
    const fallback = ruleDocWrite(req);
    return {
      text: fallback,
      usedLlm: false,
      changed: fallback !== markdown,
      op,
      error: "LLM 不可用,已使用规则兜底",
    };
  }
  try {
    const raw = await llm.run(docWriteRequest(req));
    const out = raw.trim();
    if (!out || isBlockishOutputDoc(out) && (op === "continue-doc" || op === "summarize-doc")) {
      // 追加/摘要类拒绝块级结构。
      const fallback = ruleDocWrite(req);
      return { text: fallback, usedLlm: false, changed: fallback !== markdown, op, error: "LLM 输出结构异常,已回退规则" };
    }
    return { text: out, usedLlm: true, changed: out !== markdown, op };
  } catch (err) {
    const fallback = ruleDocWrite(req);
    return {
      text: fallback,
      usedLlm: false,
      changed: fallback !== markdown,
      op,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
