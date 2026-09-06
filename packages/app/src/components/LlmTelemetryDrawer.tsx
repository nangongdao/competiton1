/**
 * LLM 调用观测抽屉(Roadmap v2 · AI-ROBUST-03)。
 *
 * 展示最近 LLM 调用记录(任务/模型/耗时/成功与否/token 估算/是否回退),
 * 以及汇总统计(成功率 / 平均耗时 / p95 / 累计 token / 按任务类型)。
 *
 * 安全:观测记录已脱敏——不含 apiKey、不含完整输入输出内容,
 * 基址只保留 host;记录仅存内存,不落盘。
 */
import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Activity,
  CheckCircle2,
  XCircle,
  Timer,
  Hash,
  Database,
  Trash2,
  RefreshCw,
  Gauge,
  Layers,
} from "lucide-react";
import { useStore } from "../state/store.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TASK_LABELS: Record<string, string> = {
  title: "标题生成",
  summary: "摘要生成",
  colloquialize: "口语化",
  rewrite: "润色",
  "paragraph-rewrite": "段落改写",
};

const ERROR_LABELS: Record<string, string> = {
  timeout: "超时",
  http: "HTTP",
  network: "网络",
  other: "其它",
};

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtRate(r: number): string {
  return `${Math.round(r * 100)}%`;
}

/** LLM 调用观测抽屉(懒加载组件)。 */
export function LlmTelemetryDrawer({ open, onOpenChange }: Props) {
  const llmCalls = useStore((s) => s.llmCalls);
  const summary = useStore((s) => s.llmTelemetrySummary);
  const refreshLlmTelemetry = useStore((s) => s.refreshLlmTelemetry);
  const clearLlmCalls = useStore((s) => s.clearLlmCalls);

  // 打开时刷新一次快照;之后由 App 全局心跳持续同步。
  useEffect(() => {
    if (open) refreshLlmTelemetry();
  }, [open, refreshLlmTelemetry]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Activity size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8 }} />
              LLM 调用观测
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            {/* 汇总卡片 */}
            <div className="llm-tele-summary">
              <div className="llm-tele-card">
                <div className="llm-tele-card-label">
                  <Hash size={13} aria-hidden />
                  总调用
                </div>
                <div className="llm-tele-card-value">{summary.totalCalls}</div>
              </div>
              <div className="llm-tele-card">
                <div className="llm-tele-card-label">
                  <Gauge size={13} aria-hidden />
                  成功率
                </div>
                <div className="llm-tele-card-value" style={{ color: summary.successRate >= 0.9 ? "var(--success)" : "var(--danger)" }}>
                  {fmtRate(summary.successRate)}
                </div>
              </div>
              <div className="llm-tele-card">
                <div className="llm-tele-card-label">
                  <Timer size={13} aria-hidden />
                  平均耗时
                </div>
                <div className="llm-tele-card-value">{summary.totalCalls ? fmtMs(summary.avgDurationMs) : "—"}</div>
              </div>
              <div className="llm-tele-card">
                <div className="llm-tele-card-label">
                  <Timer size={13} aria-hidden />
                  p95
                </div>
                <div className="llm-tele-card-value">{summary.totalCalls ? fmtMs(summary.p95DurationMs) : "—"}</div>
              </div>
              <div className="llm-tele-card">
                <div className="llm-tele-card-label">
                  <Database size={13} aria-hidden />
                  token 估算
                </div>
                <div className="llm-tele-card-value">
                  {summary.totalInputTokens + summary.totalOutputTokens}
                  <small style={{ fontSize: "0.72em", opacity: 0.7 }}> in/out</small>
                </div>
              </div>
            </div>

            {/* 操作 */}
            <div className="field-row" style={{ marginTop: 2 }}>
              <button type="button" className="btn btn-ghost" onClick={refreshLlmTelemetry}>
                <RefreshCw size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                刷新
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  clearLlmCalls();
                }}
                disabled={summary.totalCalls === 0}
              >
                <Trash2 size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                清空记录
              </button>
            </div>
            <small className="field-hint">
              观测记录仅存内存、已脱敏(不含 API Key 与完整内容),关闭本面板不影响继续记录。
            </small>

            {/* 按任务类型统计 */}
            {Object.keys(summary.byTask).length > 0 ? (
              <div style={{ borderTop: "1px solid var(--border)", margin: 0 }} />
            ) : null}
            {Object.keys(summary.byTask).length > 0 ? (
              <>
                <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                  <Layers size={14} aria-hidden />
                  按任务类型
                </h3>
                <div className="llm-tele-tasks">
                  {Object.entries(summary.byTask).map(([task, stat]) => (
                    <div key={task} className="llm-tele-task">
                      <span className="llm-tele-task-name">{TASK_LABELS[task] ?? task}</span>
                      <span className="llm-tele-task-stat">
                        {stat.calls} 次 · 成功 {stat.ok} · 均 {fmtMs(stat.avgDurationMs)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {/* 最近调用列表 */}
            <div style={{ borderTop: "1px solid var(--border)", margin: 0 }} />
            <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
              <Activity size={14} aria-hidden />
              最近调用({llmCalls.length})
            </h3>
            {llmCalls.length === 0 ? (
              <small className="field-hint">还没有 LLM 调用。在 AI 连接中心配置并运行任意 AI 功能后,这里会实时展示。</small>
            ) : (
              <div className="llm-tele-list">
                {llmCalls.map((c) => (
                  <div key={c.seq} className={`llm-tele-item${c.ok ? "" : " failed"}`}>
                    <div className="llm-tele-item-top">
                      <span className="llm-tele-item-task">{TASK_LABELS[c.task] ?? c.task}</span>
                      <span className="llm-tele-item-model">
                        {c.model}@{c.host}
                      </span>
                      {c.usedFallback ? <span className="llm-tele-item-badge">回退</span> : null}
                      <span className="llm-tele-item-status">
                        {c.ok ? (
                          <CheckCircle2 size={13} aria-hidden style={{ color: "var(--success)" }} />
                        ) : (
                          <XCircle size={13} aria-hidden style={{ color: "var(--danger)" }} />
                        )}
                        {c.ok ? "成功" : `${ERROR_LABELS[c.errorKind ?? "other"] ?? "失败"}${c.status ? ` ${c.status}` : ""}`}
                      </span>
                    </div>
                    <div className="llm-tele-item-bottom">
                      <span>{fmtMs(c.durationMs)}</span>
                      <span>
                        in {c.inputTokens} / out {c.outputTokens} tok
                      </span>
                      {c.errorMessage ? <span className="llm-tele-item-error" title={c.errorMessage}>{c.errorMessage}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
