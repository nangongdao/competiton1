/**
 * v9 Phase 3 · REPORT-AI-01 AI 报告解读。
 *
 * LLM 把复盘报告 / 周报 / 月报解读为「亮点 / 问题 / 下一步行动」三段式摘要,
 * 规则兜底,纯本地脱敏。
 *
 * 设计原则:
 * - 输出结构化(亮点 / 问题 / 行动),供 UI 分栏展示;
 * - LLM 只做「摘要解读」,不覆盖用户判断;失败回退规则;
 * - 数据脱敏:输入只接受已脱敏的报告 Markdown(不含 token/key/remoteUrl);
 * - 纯 TS 零 DOM。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** AI 解读结果。 */
export interface ReportAiInsight {
  /** 亮点(正面表现)。 */
  readonly highlights: readonly string[];
  /** 问题(需关注)。 */
  readonly issues: readonly string[];
  /** 下一步行动建议。 */
  readonly actions: readonly string[];
  /** 是否使用了 LLM(否则规则)。 */
  readonly usedLlm: boolean;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 规则解读(确定性,基于报告文本启发式)。 */
export function ruleReportInsight(reportMarkdown: string): ReportAiInsight {
  const highlights: string[] = [];
  const issues: string[] = [];
  const actions: string[] = [];

  const lines = reportMarkdown.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // 亮点:包含增长/最佳/达成/提升等正向词。
    if (/增长|最佳|达成|提升|成功|最高|领先|超出/.test(t) && t.length > 4) {
      highlights.push(t.replace(/^[#*\-\s>]+/, "").slice(0, 80));
    }
    // 问题:包含下滑/不足/失败/低/缺/风险等负向词。
    if (/下滑|不足|失败|偏低|缺乏|风险|下降|未达|警告|error/i.test(t) && t.length > 4) {
      issues.push(t.replace(/^[#*\-\s>]+/, "").slice(0, 80));
    }
    // 行动:包含建议/下一步/优先/应/可 等。
    if (/建议|下一步|优先|应当|可以考虑|立即|行动/.test(t) && t.length > 4) {
      actions.push(t.replace(/^[#*\-\s>]+/, "").slice(0, 80));
    }
  }

  // 去重与上限。
  const uniq = (arr: string[], n: number) => [...new Set(arr)].slice(0, n);
  const h = uniq(highlights, 5);
  const i = uniq(issues, 5);
  const a = uniq(actions, 5);

  return {
    highlights: h,
    issues: i,
    actions: a,
    usedLlm: false,
    summary:
      h.length + i.length + a.length > 0
        ? `规则解读完成:${h.length} 条亮点,${i.length} 条问题,${a.length} 条行动建议。`
        : "规则解读未识别到明确条目(报告可能为空或为纯数据表)。",
  };
}

/** AI 解读请求(prompt 构造)。 */
export function reportInsightRequest(reportMarkdown: string): LlmRequest {
  return {
    task: "rewrite",
    platformId: "wechat",
    input:
      "你是内容运营复盘助手。请把运营报告解读为三段式 JSON:" +
      '"highlights"(亮点数组)、"issues"(问题数组)、"actions"(下一步行动数组)。' +
      "只输出 JSON,不要其它文字。\n\n以下是运营报告:\n\n" +
      `${reportMarkdown.slice(0, 4000)}\n\n请输出解读 JSON。`,
    systemPrompt: "你是内容运营复盘助手,只输出结构化 JSON,不加解释。",
    temperature: 0.3,
    maxTokens: 800,
  };
}

/** 解析 LLM 返回的解读(宽松容错)。 */
export function parseReportInsightJson(raw: string): Partial<ReportAiInsight> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const asStrArray = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.length > 0) : []);
    return {
      highlights: asStrArray(parsed["highlights"]),
      issues: asStrArray(parsed["issues"]),
      actions: asStrArray(parsed["actions"]),
    };
  } catch {
    return null;
  }
}

/**
 * REPORT-AI-01 AI 报告解读入口。
 *
 * LLM 可用时生成三段式解读;失败 / 不可用回退规则解读。
 */
export async function summarizeReportWithLlm(
  reportMarkdown: string,
  llm?: LlmAdapter,
): Promise<ReportAiInsight> {
  const rule = ruleReportInsight(reportMarkdown);

  if (!llm?.available) {
    return rule;
  }

  try {
    const raw = await llm.run(reportInsightRequest(reportMarkdown));
    const parsed = parseReportInsightJson(raw);
    if (!parsed || (parsed.highlights?.length ?? 0) + (parsed.issues?.length ?? 0) + (parsed.actions?.length ?? 0) === 0) {
      throw new Error("LLM 解读为空");
    }
    const highlights = parsed.highlights ?? [];
    const issues = parsed.issues ?? [];
    const actions = parsed.actions ?? [];
    return {
      highlights,
      issues,
      actions,
      usedLlm: true,
      summary: `AI 解读完成:${highlights.length} 条亮点,${issues.length} 条问题,${actions.length} 条行动建议。`,
    };
  } catch {
    return rule;
  }
}
