/**
 * 发布队列/批次 × 效果预测共享组件（v10 深化 · FORECAST-QUEUE-01 UI）。
 *
 * 把「预期效果」展示区块从发布队列/批次表单中提炼为**可复用**能力：
 * - `runQueueForecast`：基于当前草稿 + 效果记录 + 已选平台生成预测展示载荷（复用
 *   core `forecastForQueue`，含各平台预期区间 / 置信度 / 推荐平台 / 决策建议）；
 * - `QueueForecastBlock`：展示组件 —— 生成按钮 + 摘要 + 各平台预测列表 + 决策卡片 +
 *   一键「采纳推荐平台」把推荐平台填入表单。
 *
 * 语义：预测只是「参考」，缺数据明确提示不假装有数据；采纳推荐平台不越界（只取已选交集）。
 */
import { useCallback, type ReactNode } from "react";
import { Check, Loader2, TrendingUp } from "lucide-react";
import type { QueueForecastView } from "@mpp/core";
import { forecastForQueue, platformDisplayName } from "@mpp/core";
import type { PerformanceRecord } from "@mpp/core";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";

/** 预测结果类型映射（供调用方读取）。 */
export type { QueueForecastView } from "@mpp/core";

export interface RunQueueForecastOptions {
  readonly title?: string;
  readonly contentText?: string;
  readonly performanceRecords: readonly PerformanceRecord[];
  readonly platformIds: readonly string[];
  /** 是否通过发布前校验（决策用，默认 true）。 */
  readonly allPassed?: boolean;
}

/** 生成预测载荷（供发布队列/批次表单共用）。 */
export function runQueueForecast(opts: RunQueueForecastOptions): QueueForecastView {
  return forecastForQueue({
    title: opts.title,
    contentText: opts.contentText,
    performanceRecords: opts.performanceRecords,
    platformIds: opts.platformIds,
    allPassed: opts.allPassed ?? true,
  });
}

export interface QueueForecastBlockProps {
  /** 区块提示文案。 */
  hint: string;
  /** 是否可生成（无草稿/无内容时禁用）。 */
  canRun: boolean;
  loading: boolean;
  /** 预测结果（null = 未生成）。 */
  result: QueueForecastView | null;
  /** 是否启用「采纳推荐平台」按钮（默认 true）。 */
  allowApplyPlatforms?: boolean;
  onRun: () => void;
  /** 采纳推荐平台（把推荐平台填入表单平台选择）。 */
  onApplyPlatforms?: (platformIds: readonly string[]) => void;
  /** 采纳后的额外提示。 */
  extra?: ReactNode;
}

/** 决策标签（与 DashboardDrawer 语义对齐）。 */
function decisionLabel(kind: QueueForecastView["decision"]["kind"]): string {
  switch (kind) {
    case "publish-now":
      return "立即发布";
    case "reschedule":
      return "改期发布";
    case "optimize-first":
      return "先优化再发";
    case "skip":
      return "暂不发布";
  }
}

/**
 * 预期效果展示区块：生成按钮 + 摘要 + 各平台预测 + 决策卡片 + 采纳推荐平台。
 * 供发布队列 / 发布批次表单复用，保持一致的 Lucide 图标与 Awwwards 玻璃拟态样式。
 */
export function QueueForecastBlock({
  hint,
  canRun,
  loading,
  result,
  allowApplyPlatforms = true,
  onRun,
  onApplyPlatforms,
  extra,
}: QueueForecastBlockProps) {
  const applyRecommended = useCallback(() => {
    if (!result || result.recommendedPlatforms.length === 0) {
      toast("暂无推荐平台，保持当前选择", "info");
      return;
    }
    onApplyPlatforms?.(result.recommendedPlatforms);
    toast(`已采纳推荐平台：${result.recommendedPlatforms.map((p) => platformDisplayName(p)).join(" / ")}`, "success");
  }, [result, onApplyPlatforms]);

  return (
    <div className="scheduler-form" style={{ marginTop: 12 }}>
      <div className="assistant-toolbar">
        <span className="assistant-toolbar-hint">{hint}</span>
        <button type="button" className="btn btn-sm" onClick={onRun} disabled={loading || !canRun}>
          {loading ? <Loader2 size={14} className="spinner" aria-hidden /> : <TrendingUp size={14} aria-hidden />}
          {loading ? "预测中…" : "效果预测"}
        </button>
      </div>
      {result && <div className="assistant-fact-summary">{result.summary}</div>}
      {extra}
      {result && !result.safeFallback && (
        <>
          <div className="dash-forecast-list" style={{ marginTop: 8 }}>
            {result.platforms.map((p) => {
              const color = platformColor(p.platformId);
              return (
                <div key={p.platformId} className="dash-forecast-row">
                  <span className="dash-forecast-name" style={{ color }}>
                    {platformDisplayName(p.platformId)}
                  </span>
                  <span className="dash-forecast-range">
                    {p.range.lower}~{p.range.upper} 阅读
                  </span>
                  <span className="dash-forecast-meta">
                    {p.sampleCount} 样本 · 置信 {Math.round(p.confidence * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
          <div className={`dash-decision dash-decision-${result.decision.kind}`} style={{ marginTop: 8 }}>
            <strong>{decisionLabel(result.decision.kind)}</strong>
            <span>{result.decision.reason}</span>
          </div>
          {allowApplyPlatforms && result.recommendedPlatforms.length > 0 && (
            <div className="assistant-toolbar" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={applyRecommended}>
                <Check size={13} aria-hidden /> 采纳推荐平台
              </button>
              <span className="assistant-toolbar-hint">
                推荐平台：{result.recommendedPlatforms.map((p) => platformDisplayName(p)).join(" / ")}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 便于使用方导入的图标（避免重复引入）。 */
export const ForecastIcons = { TrendingUp };
