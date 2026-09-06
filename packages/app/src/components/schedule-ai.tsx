/**
 * AI 排期建议共享模块 —— ROADMAP_V5 Phase 4 / 本轮增强。
 *
 * 把「AI 自动排期建议」从发布队列面板提炼为**可复用**能力:
 * - `deriveTitleFromMarkdown` / `stripMarkdown` / `isoToLocal` 等文本与时间工具;
 * - `ScheduleSuggestionsBlock` 展示组件(生成按钮 + 摘要 + 建议卡片 + 采纳按钮),
 *   供发布队列 / 发布批次 / 计划任务三个面板复用(保持一致的 Lucide 图标与样式)。
 *
 * 语义:每条建议 = 建议发布时间(ISO) + 平台组合 + 理由 + 来源(LLM/规则)。
 * 面板各自决定采纳后如何落地(队列/批次填 datetime-local,计划任务填 cron 时/分)。
 */
import type { ReactNode } from "react";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import type { QueueScheduleSuggestion } from "@mpp/core";
import { platformColor } from "./platform-meta.js";

/** 从 Markdown 首行 # 标题或首行提取草稿标题。 */
export function deriveTitleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 30) : "";
}

/** 剥离 Markdown 标记得到纯文本(供排期 prompt 使用,截断 400 字)。 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/** 把 ISO 转为本地 datetime-local 可用的值(YYYY-MM-DDTHH:mm)。 */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 从 ISO 解析本地小时与分钟(供计划任务 cron 采纳)。 */
export function isoToLocalHourMinute(iso: string): { hour: number; minute: number } {
  const d = new Date(iso);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

export interface ScheduleSuggestionsBlockProps {
  /** 区块顶部提示文案。 */
  hint: string;
  /** 生成按钮文案(默认 "AI 自动排期")。 */
  buttonLabel?: string;
  loading: boolean;
  /** 是否可点击生成(无草稿/无内容时禁用)。 */
  canRun: boolean;
  summary: string;
  suggestions: readonly QueueScheduleSuggestion[];
  onRun: () => void;
  onApply: (s: QueueScheduleSuggestion) => void;
  /** 采纳后的额外说明(面板自定义,如 "已填入 cron 时间")。 */
  extra?: ReactNode;
}

/**
 * AI 排期建议展示区块(生成按钮 + 摘要 + 建议卡片 + 采纳按钮)。
 * 供发布队列 / 发布批次 / 计划任务复用,样式与 PublishQueueDrawer 一致。
 */
export function ScheduleSuggestionsBlock({
  hint,
  buttonLabel = "AI 自动排期",
  loading,
  canRun,
  summary,
  suggestions,
  onRun,
  onApply,
  extra,
}: ScheduleSuggestionsBlockProps) {
  return (
    <div className="scheduler-form" style={{ marginTop: 12 }}>
      <div className="assistant-toolbar">
        <span className="assistant-toolbar-hint">{hint}</span>
        <button type="button" className="btn btn-sm" onClick={onRun} disabled={loading || !canRun}>
          {loading ? <Loader2 size={14} className="spinner" aria-hidden /> : <Sparkles size={14} aria-hidden />}
          {loading ? "生成中…" : buttonLabel}
        </button>
      </div>
      {summary && <div className="assistant-fact-summary">{summary}</div>}
      {extra}
      {suggestions.length > 0 && (
        <div className="schedule-suggestions">
          {suggestions.map((s, i) => {
            const color = s.platformIds[0] ? platformColor(s.platformIds[0]) : undefined;
            return (
              <div key={i} className="schedule-suggestion">
                <div className="schedule-suggestion-head">
                  <Wand2 size={13} aria-hidden style={{ color }} />
                  <span className="schedule-suggestion-name">{s.name}</span>
                  <span className="schedule-suggestion-time">{new Date(s.suggestedAt).toLocaleString()}</span>
                  <span className="schedule-suggestion-src">{s.source === "llm" ? "LLM" : "规则"}</span>
                </div>
                <div className="schedule-suggestion-reason">{s.reason}</div>
                <div className="schedule-suggestion-platforms">
                  {s.platformIds.length === 0 ? "保持当前选择" : s.platformIds.join(" / ")}
                </div>
                <div className="assistant-toolbar">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onApply(s)}>
                    <Check size={13} aria-hidden /> 采纳此建议
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
