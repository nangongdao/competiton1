/**
 * 内容矩阵 → 发布队列批量目标平台建议共享组件（v10 深化 · MATRIX-QUEUE 联动）。
 *
 * 把「内容矩阵接入发布队列批量目标平台建议」提炼为**可复用**能力：
 * - `runMatrixPlatformSuggestions`：基于效果记录 + 已选平台派生批量目标平台建议
 *   （复用 core `matrixQueuePlatformSuggestions`，补空窗 / 强化最佳 / 均衡组合）；
 * - `MatrixPlatformSuggestionsBlock`：展示组件 —— 生成按钮 + 建议卡片 + 一键采纳
 *   （把建议平台组合填入表单平台选择）。
 *
 * 语义：建议只是「参考」，缺数据回退通用建议；采纳不越界（只取已选平台交集）。
 */
import { useCallback } from "react";
import { Check, LayoutGrid, Loader2 } from "lucide-react";
import type { MatrixPlatformSuggestion } from "@mpp/core";
import { matrixQueuePlatformSuggestions, platformDisplayName } from "@mpp/core";
import type { PerformanceRecord } from "@mpp/core";
import { toast } from "./toast.js";

/** 平台建议类型映射（供调用方读取）。 */
export type { MatrixPlatformSuggestion } from "@mpp/core";

export interface MatrixSuggestionsBlockProps {
  /** 区块提示文案。 */
  hint: string;
  /** 是否可生成（无草稿/无内容时禁用）。 */
  canRun: boolean;
  loading: boolean;
  /** 建议列表（空 = 未生成）。 */
  suggestions: readonly MatrixPlatformSuggestion[];
  onRun: () => void;
  /** 采纳一条建议（把建议平台组合填入表单平台选择）。 */
  onApply: (s: MatrixPlatformSuggestion) => void;
}

/** 生成批量目标平台建议（供发布队列/批次表单共用）。 */
export function runMatrixSuggestions(
  performanceRecords: readonly PerformanceRecord[],
  platformIds: readonly string[],
  topN = 3,
): readonly MatrixPlatformSuggestion[] {
  return matrixQueuePlatformSuggestions(performanceRecords, { platformIds, topN });
}

/**
 * 内容矩阵 → 批量目标平台建议展示区块。
 * 供发布队列 / 发布批次表单复用，保持一致的 Lucide 图标与 Awwwards 玻璃拟态样式。
 */
export function MatrixPlatformSuggestionsBlock({
  hint,
  canRun,
  loading,
  suggestions,
  onRun,
  onApply,
}: MatrixSuggestionsBlockProps) {
  const apply = useCallback(
    (s: MatrixPlatformSuggestion) => {
      if (s.platformIds.length === 0) {
        toast("该建议未包含平台组合，保持当前选择", "info");
        return;
      }
      onApply(s);
      toast(`已采纳平台组合：${s.platformIds.map((p) => platformDisplayName(p)).join(" / ")}`, "success");
    },
    [onApply],
  );

  return (
    <div className="scheduler-form" style={{ marginTop: 12 }}>
      <div className="assistant-toolbar">
        <span className="assistant-toolbar-hint">{hint}</span>
        <button type="button" className="btn btn-sm" onClick={onRun} disabled={loading || !canRun}>
          {loading ? <Loader2 size={14} className="spinner" aria-hidden /> : <LayoutGrid size={14} aria-hidden />}
          {loading ? "分析中…" : "平台建议"}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="schedule-suggestions" style={{ marginTop: 8 }}>
          {suggestions.map((s, i) => (
            <div key={i} className="schedule-suggestion">
              <div className="schedule-suggestion-head">
                <LayoutGrid size={13} aria-hidden style={{ color: "var(--accent)" }} />
                <span className="schedule-suggestion-name">{s.name}</span>
                <span className="schedule-suggestion-src">{s.source === "matrix" ? "矩阵" : "通用"}</span>
              </div>
              <div className="schedule-suggestion-reason">{s.reason}</div>
              <div className="schedule-suggestion-platforms">
                {s.platformIds.length === 0 ? "保持当前选择" : s.platformIds.map((p) => platformDisplayName(p)).join(" / ")}
              </div>
              <div className="assistant-toolbar">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => apply(s)}>
                  <Check size={13} aria-hidden /> 采纳此建议
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
