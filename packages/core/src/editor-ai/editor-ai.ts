/**
 * v3 · AI 选区操作 —— 在编辑器中对选中的 Markdown 文本做智能操作。
 *
 * 能力(任务类型):
 * - rewrite      风格改写(保持原意与结构,优化表达);
 * - expand       扩写(在原文基础上补充细节/论证,不删减原意);
 * - continue     续写(从选区结尾自然延续一段);
 * - summarize    摘要(压缩为要点,适合做摘要/推荐语);
 * - translate    翻译(默认中→英;可选英→中);
 * - polish       润色(修正错别字/语病,统一语气,最小改动)。
 *
 * 设计原则(与项目一致):
 * - 纯 TS 零 DOM,可单测;
 * - LLM 不可用/失败时回退原文并给出 `usedLlm:false` 标记,绝不伪造结果;
 * - 输出校验:改写/润色/摘要要求"纯文本段落"(拒绝代码块/列表/引用等块级结构),
 *   避免 LLM 破坏 Markdown 选区结构;
 * - 任务级参数(temperature / maxTokens / systemPrompt)透传,供 AI 连接中心逐任务配置。
 */
import type { LlmAdapter, LlmRequest, LlmTask } from "../llm/types.js";

/** AI 选区操作类型。 */
export type SelectionAiOp =
  | "rewrite"
  | "expand"
  | "continue"
  | "summarize"
  | "translate-zh-en"
  | "translate-en-zh"
  | "polish";

/** 选区 AI 操作请求参数。 */
export interface SelectionAiRequest {
  /** 选中的 Markdown 原文(通常为纯文本段落或短语)。 */
  readonly selected: string;
  /** 操作类型。 */
  readonly op: SelectionAiOp;
  /** 目标平台(可选,用于风格上下文,如小红书口语化)。 */
  readonly platformId?: string;
  /** 任务级温度(覆盖适配器默认)。 */
  readonly temperature?: number;
  /** 任务级最大 token。 */
  readonly maxTokens?: number;
  /** 任务级系统提示词。 */
  readonly systemPrompt?: string;
}

/** 选区 AI 操作结果。 */
export interface SelectionAiResult {
  /** 操作后的文本(失败/不可用时等于原文)。 */
  readonly text: string;
  /** 是否成功使用 LLM(否则为原文回退)。 */
  readonly usedLlm: boolean;
  /** 失败原因(成功时为空)。 */
  readonly error?: string;
  /** 操作类型。 */
  readonly op: SelectionAiOp;
  /** 目标平台(透传)。 */
  readonly platformId?: string;
}

/** 操作的人类可读名称(供 UI 展示)。 */
export const SELECTION_AI_OP_LABELS: Record<SelectionAiOp, string> = {
  rewrite: "风格改写",
  expand: "扩写",
  continue: "续写",
  summarize: "摘要",
  "translate-zh-en": "中译英",
  "translate-en-zh": "英译中",
  polish: "润色",
};

/** 把选区操作映射到 LLM 任务类型。 */
export function selectionOpToLlmTask(op: SelectionAiOp): LlmTask {
  switch (op) {
    case "rewrite":
      return "rewrite";
    case "expand":
    case "continue":
      return "rewrite";
    case "summarize":
      return "summary";
    case "translate-zh-en":
    case "translate-en-zh":
      return "rewrite";
    case "polish":
      return "rewrite";
  }
}

/** 构造选区 AI 的 LLM 请求。 */
export function selectionAiRequest(req: SelectionAiRequest): LlmRequest {
  const { selected, op, platformId = "generic" } = req;
  const input = selected.trim();
  switch (op) {
    case "rewrite":
      return {
        task: "rewrite",
        platformId,
        input,
        constraints: { maxChars: Math.max(4000, input.length * 3) },
        temperature: req.temperature ?? 0.7,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是新媒体内容编辑。对用户选中的文本做风格改写:保持原意与全部事实、数字、专名不变,优化表达与节奏,输出纯文本段落,不要输出标题、列表、引用或 Markdown 标记。",
      };
    case "expand":
      return {
        task: "rewrite",
        platformId,
        input,
        constraints: { maxChars: Math.max(6000, input.length * 4) },
        temperature: req.temperature ?? 0.8,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是内容写作助手。在用户选中文本的基础上扩写:保留原文全部内容与结构,补充具体细节、例证、论据或上下文,让内容更丰满。只输出扩写后的纯文本,不要输出标题、列表、引用或 Markdown 标记。",
      };
    case "continue":
      return {
        task: "rewrite",
        platformId,
        input,
        constraints: { maxChars: Math.max(4000, input.length * 3) },
        temperature: req.temperature ?? 0.9,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是内容写作助手。从用户文本的结尾处自然续写一段,保持语气、视角与主题一致,让文章继续展开。只输出续写的段落(不要重复原文),不要输出标题、列表、引用或 Markdown 标记。",
      };
    case "summarize":
      return {
        task: "summary",
        platformId,
        input,
        constraints: { maxChars: Math.max(120, Math.round(input.length * 0.3)) },
        temperature: req.temperature ?? 0.4,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是内容摘要助手。把用户选中的文本压缩成简明要点,保留核心信息与结论,语气自然。只输出摘要文本,不要输出标题、列表或 Markdown 标记。",
      };
    case "translate-zh-en":
      return {
        task: "rewrite",
        platformId,
        input,
        constraints: { maxChars: Math.max(6000, input.length * 3) },
        temperature: req.temperature ?? 0.3,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是专业翻译。把用户选中的中文翻译成地道、自然的英文,保持原意与技术术语准确。只输出译文,不要输出解释或 Markdown 标记。",
      };
    case "translate-en-zh":
      return {
        task: "rewrite",
        platformId,
        input,
        constraints: { maxChars: Math.max(6000, input.length * 3) },
        temperature: req.temperature ?? 0.3,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是专业翻译。把用户选中的英文翻译成地道、自然的中文,保持原意与技术术语准确。只输出译文,不要输出解释或 Markdown 标记。",
      };
    case "polish":
      return {
        task: "rewrite",
        platformId,
        input,
        constraints: { maxChars: Math.max(4000, input.length * 2) },
        temperature: req.temperature ?? 0.3,
        maxTokens: req.maxTokens,
        systemPrompt:
          req.systemPrompt ??
          "你是文字校对编辑。对用户选中的文本做最小改动润色:修正错别字、语病与标点,统一语气,不改变原意与结构。只输出润色后的纯文本,不要输出标题、列表、引用或 Markdown 标记。",
      };
  }
}

/** 检测输出是否包含块级 Markdown 结构(拒绝应用)。 */
export function isBlockishOutput(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // 代码块 / 标题 / 列表 / 引用 / 表格
  if (/^```/m.test(t)) return true;
  if (/^#{1,6}\s+/m.test(t)) return true;
  if (/^\s*([-*+]|\d+\.)\s+/m.test(t)) return true;
  if (/^\s*>\s?/m.test(t)) return true;
  if (/^\s*\|.*\|\s*$/m.test(t)) return true;
  return false;
}

/**
 * 对选区文本执行一次 AI 操作。
 *
 * 行为契约:
 * - `llm` 不可用(undefined / !available)→ 返回原文回退,`usedLlm:false`;
 * - LLM 调用失败 → 返回原文回退并附 `error`;
 * - 输出为空 / 块级结构 / 与原文一致 → 返回原文回退(防御性,防止破坏选区);
 * - 成功 → 返回 LLM 输出(trim 后),`usedLlm:true`。
 */
export async function runSelectionAi(
  req: SelectionAiRequest,
  llm?: LlmAdapter,
): Promise<SelectionAiResult> {
  const selected = req.selected.trim();
  if (!selected) return { text: "", usedLlm: false, op: req.op, error: "选区为空" };

  if (!llm || !llm.available) {
    return { text: selected, usedLlm: false, op: req.op, platformId: req.platformId, error: "未配置 LLM" };
  }

  try {
    const out = await llm.run(selectionAiRequest(req));
    const cleaned = out.trim();
    if (!cleaned || isBlockishOutput(cleaned)) {
      return {
        text: selected,
        usedLlm: false,
        op: req.op,
        platformId: req.platformId,
        error: "LLM 输出为空或包含块级结构,已保留原文",
      };
    }
    if (cleaned === selected) {
      return { text: selected, usedLlm: false, op: req.op, platformId: req.platformId, error: "LLM 输出与原文一致" };
    }
    return { text: cleaned, usedLlm: true, op: req.op, platformId: req.platformId };
  } catch (err) {
    return {
      text: selected,
      usedLlm: false,
      op: req.op,
      platformId: req.platformId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * EDIT-AI-04 —— 把同一次选区操作应用到多个平台(每个平台一份风格化改写)。
 *
 * 背景:同一段文字在不同平台的语气/长度偏好不同(如小红书偏口语、公众号偏正式、
 * B站偏活泼)。此前选区操作只能对单一平台改写。本函数支持:
 * - 对一组平台分别改写(每平台独立 LLM 请求,有界并发,互不阻塞);
 * - 输出必须仍为纯文本段落(拒绝块级结构),失败平台回退原文并标注;
 * - 返回每平台结果与统一差异说明(平台间结果一致时提示"无平台风格差异")。
 *
 * 设计原则:
 * - 纯函数可单测;LLM 不可用 → 全部回退原文;
 * - 有界并发(BOUNDED=2),避免瞬时打满 LLM 配额;
 * - 绝不伪造结果:失败平台 `usedLlm:false` 且带 error。
 */
export interface PlatformSelectionAiResult {
  /** 目标平台 id。 */
  readonly platformId: string;
  /** 操作结果(失败时等于原文)。 */
  readonly result: SelectionAiResult;
}

export interface MultiPlatformSelectionAiResult {
  /** 操作类型。 */
  readonly op: SelectionAiOp;
  /** 每平台结果(顺序与请求 platforms 一致)。 */
  readonly items: readonly PlatformSelectionAiResult[];
  /** 是否所有平台都成功使用 LLM。 */
  readonly allUsedLlm: boolean;
  /** 平台间是否存在风格差异(结果文本两两不同)。 */
  readonly hasDifference: boolean;
  /** 人类可读差异说明(供 UI 提示)。 */
  readonly differenceHint: string;
}

/** 有界并发执行:把 items 按 max 并发执行,保持输入顺序。 */
export async function mapBounded<T, R>(
  items: readonly T[],
  max: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 平台间的语气/长度风格差异简要说明。 */
export function platformStyleHint(a: string, b: string): string {
  if (a === b) return "两平台改写结果一致,无风格差异。";
  const diff = Math.abs(a.length - b.length);
  if (diff >= 40) return "两平台长度差异明显,可能存在口语化/正式度差异。";
  if (diff >= 8) return "两平台结果长度略有差异,可对比后手动微调。";
  return "两平台改写措辞不同但长度接近,建议对比后择优。";
}

/**
 * 执行一次选区操作并应用到多个平台。
 *
 * 对每个平台并发(有界)调用 `runSelectionAi`,返回每平台结果与差异说明。
 * 全部平台 LLM 不可用或失败时,`allUsedLlm=false` 且每项回退原文。
 */
export async function runSelectionAiForPlatforms(
  req: Omit<SelectionAiRequest, "platformId"> & { readonly platforms: readonly string[] },
  llm?: LlmAdapter,
): Promise<MultiPlatformSelectionAiResult> {
  const { platforms } = req;
  const results = await mapBounded(platforms, 2, (platformId) =>
    runSelectionAi({ ...req, platformId }, llm).then((result) => ({ platformId, result })),
  );
  const texts = results.map((r) => r.result.text);
  const distinct = new Set(texts);
  const allUsedLlm = results.every((r) => r.result.usedLlm);
  const hasDifference = distinct.size > 1;
  let differenceHint: string;
  if (results.length <= 1) {
    differenceHint = "仅一个平台,无需对比。";
  } else if (!hasDifference) {
    differenceHint = "所有平台改写结果一致,无风格差异。";
  } else {
    const [first, second] = texts;
    differenceHint = platformStyleHint(first ?? "", second ?? "");
  }
  return { op: req.op, items: results, allUsedLlm, hasDifference, differenceHint };
}
