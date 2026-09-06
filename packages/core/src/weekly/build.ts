/**
 * v4 Phase 2 · WEEKLY-01 内容智能周报 —— 生成核心(纯函数)。
 *
 * 在 `buildPerformanceReport`(v3)之上,补上周报自动化需要的三件事:
 * 1. **周窗口裁剪**:默认近 7 天(可配 windowDays / 起始偏移);
 * 2. **LLM 周报总结段**:`buildWeeklySummary` 生成 prompt / 宽松解析;
 *    总结只做「提炼 + 下周建议」,数字事实以回收数据为准,失败回退规则总结;
 * 3. **规则总结兜底**:`ruleWeeklySummary` 从 `analyzePerformance` 派生确定性总结。
 *
 * 纯函数、零 DOM;被 WEEKLY-02 调度 / WEEKLY-04 UI 复用。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance } from "../analytics/insights.js";
import { filterRecordsByWindow, buildPerformanceReport, REPORT_TEMPLATE_LABELS, type ReportTemplate } from "../report/report.js";
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import type { BuildWeeklyReportOptions } from "./types.js";

/** 周报总结中单条建议/观察(供 UI 与报告展示)。 */
export interface WeeklySummaryItem {
  readonly text: string;
  readonly source: "llm" | "rule";
}

/** 周报总结结果。 */
export interface WeeklySummaryResult {
  readonly items: readonly WeeklySummaryItem[];
  /** 是否使用了 LLM。 */
  readonly usedLlm: boolean;
}

/** 由效果洞察派生的规则总结(确定性、离线可用)。 */
export function ruleWeeklySummary(records: readonly PerformanceRecord[]): WeeklySummaryItem[] {
  if (records.length === 0) {
    return [
      { text: "本窗口内暂无效果记录,建议先录入数据或开启官方指标同步。", source: "rule" },
      { text: "下周可先固定发布节奏,观察数据后再收敛平台组合与时段。", source: "rule" },
    ];
  }
  const insights = analyzePerformance(records);
  const out: WeeklySummaryItem[] = [];
  const best = insights.ranking[0];
  if (best) {
    out.push({
      text: `最佳平台 ${best.platformId}(平均阅读 ${Math.round(best.avgViews)}),可把高价值内容优先投放到该平台。`,
      source: "rule",
    });
  }
  const bestPost = insights.insights.find((i) => i.kind === "best-platform");
  if (bestPost) out.push({ text: bestPost.title, source: "rule" });
  const hour = insights.insights.find((i) => i.kind === "best-time");
  if (hour) out.push({ text: hour.title, source: "rule" });
  for (const rec of insights.recommendations.slice(0, 3)) {
    out.push({ text: rec, source: "rule" });
  }
  if (out.length === 0) out.push({ text: "本窗口数据有限,建议持续回收效果数据以获得更准确的总结。", source: "rule" });
  return out;
}

/** 构造 LLM 周报总结请求。 */
export function weeklySummaryRequest(records: readonly PerformanceRecord[]): LlmRequest {
  const ctx = analyzePerformance(records);
  const best = ctx.ranking[0];
  const bestPost = ctx.insights.find((i) => i.kind === "best-platform");
  const hour = ctx.insights.find((i) => i.kind === "best-time");
  const contextLines = [
    `记录数:${records.length}`,
    best ? `最佳平台:${best.platformId}(平均阅读 ${Math.round(best.avgViews)})` : "暂无平台排名",
    bestPost ? `最佳洞察:${bestPost.title}` : "暂无最佳洞察",
    hour ? `最佳时段:${hour.title}` : "暂无时段洞察",
    ...ctx.recommendations.slice(0, 3),
  ].join("\n");
  const prompt =
    `你是一名新媒体运营复盘顾问。基于下面的周效果数据,给出 3-5 条周报总结(中文,每条一句话,` +
    `不超过 40 字),涵盖:本周整体表现、值得坚持的做法、下周改进建议。` +
    `只输出 JSON 数组,如 ["总结1","总结2",...],不要输出 JSON 之外的任何文字。\n\n周效果数据:\n${contextLines}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    systemPrompt: "你是新媒体运营复盘顾问,只输出 JSON 字符串数组,不加解释。",
    temperature: 0.5,
    maxTokens: 600,
  };
}

/** 宽松解析 LLM 周报总结(JSON 字符串数组;失败回退空数组)。 */
export function parseWeeklySummary(raw: string): readonly string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => x.length > 0);
  } catch {
    return [];
  }
}

/**
 * 生成周报总结:LLM 可用则 LLM 生成,失败/不可用回退规则总结。
 *
 * @param llm 可选 LLM 适配器。
 * @param records 效果记录(空时直接规则兜底)。
 */
export async function generateWeeklySummary(
  llm: LlmAdapter | undefined,
  records: readonly PerformanceRecord[],
): Promise<WeeklySummaryResult> {
  if (records.length === 0 || !llm?.available) {
    return { items: ruleWeeklySummary(records), usedLlm: false };
  }
  try {
    const raw = await llm.run(weeklySummaryRequest(records));
    const parsed = parseWeeklySummary(raw);
    if (parsed.length === 0) throw new Error("LLM 周报总结为空");
    return {
      items: parsed.map((text) => ({ text, source: "llm" })),
      usedLlm: true,
    };
  } catch {
    return { items: ruleWeeklySummary(records), usedLlm: false };
  }
}

/**
 * 构建周报 Markdown(纯函数)。
 *
 * 结构:
 * - 头部:标题 + 周窗口说明;
 * - 周报总结(LLM/规则,来源标注);
 * - 分平台汇总 + 最佳表现(复用 buildPerformanceReport 的核心能力,在其之上插入总结段)。
 */
export function buildWeeklyReport(options: BuildWeeklyReportOptions): string {
  const now = options.now ?? (() => new Date().toISOString());
  const template = options.template ?? "weekly";
  const windowDays = options.windowDays ?? 7;
  const title = options.title ?? "内容周报";

  // 周窗口裁剪:近 windowDays 天(默认 7)。
  const window = filterRecordsByWindow(options.records, windowDays, now);
  const base = buildPerformanceReport({
    records: window,
    template,
    title,
    now,
  });

  // 若无窗口内数据,直接在基础空态上加一行窗口说明即可。
  if (window.length === 0) {
    const note = `> 数据范围:近 ${windowDays} 天。`;
    return base.replace("> 生成时间", `${note}\n> 生成时间`);
  }

  // 插入周报总结段(LLM/规则)。
  const summary = options.llmSummary;
  const summarySection =
    summary !== undefined && summary.trim().length > 0
      ? `## 周报总结(LLM)\n\n${summary.trim()}\n\n`
      : "";
  const rule = ruleWeeklySummary(window);
  const ruleSection =
    rule.length > 0
      ? `## 本周要点(规则)\n\n${rule.map((r) => `- ${r.text}`).join("\n")}\n\n`
      : "";

  // 在「## 智能分析」之前插入总结段。
  return base.replace("## 智能分析", `${summarySection}${ruleSection}## 智能分析`);
}

/** 周报模板的人类可读标签(便于 UI 下拉)。 */
export const WEEKLY_TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  overview: "综合复盘",
  weekly: "周报(近 7 天)",
  monthly: "月报(近 30 天)",
  platform: "平台专项",
};

export { REPORT_TEMPLATE_LABELS };
