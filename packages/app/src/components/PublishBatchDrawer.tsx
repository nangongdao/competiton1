/**
 * 发布批次抽屉 —— ROADMAP_V5 Phase 2:一次排队多篇草稿、到点逐篇发布、批量效果回收与批次复盘。
 *
 * - 新建:选择多篇草稿(勾选) / 目标平台 / 期望发布时间 / 是否真实发布;
 * - 批次列表:整体状态、成功率、条目明细(每篇独立状态/时间/任务/回执);
 * - 操作:立即执行某篇 / 一键重试失败篇 / 取消批次 / 删除;
 * - 批量效果回收:按批次内 receipts 的 remoteId 汇总写入效果回收库(去重);
 * - 批次复盘:全部条目终态后自动生成成功率/平台表现/建议。
 *
 * 约束(延续路线图):机器与登录态必须在线;到点走与「立即真实发布」相同的鉴权与可信回执;
 * 账号引用在排队时锁定,排队期间切换账号不影响到点发布。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Layers,
  Play,
  Trash2,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  RefreshCw,
  BarChart3,
  RotateCcw,
  Clock,
} from "lucide-react";
import { listAdapters, generateQueueSchedule, type QueueScheduleSuggestion } from "@mpp/core";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import {
  deriveTitleFromMarkdown,
  stripMarkdown,
  isoToLocal,
  ScheduleSuggestionsBlock,
} from "./schedule-ai.js";
import { QueueForecastBlock, runQueueForecast, type QueueForecastView } from "./queue-forecast.js";
import {
  MatrixPlatformSuggestionsBlock,
  runMatrixSuggestions,
  type MatrixPlatformSuggestion,
} from "./matrix-platform-suggestions.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ADAPTERS = listAdapters();
const ALL_IDS = ADAPTERS.map((a) => a.id);

/** 把本地时间输入(YYYY-MM-DDTHH:mm)转为 ISO。 */
function toIsoLocal(datetimeLocal: string): string {
  return new Date(datetimeLocal).toISOString();
}

/** 当前时间 + 1 小时,格式化为 datetime-local 可用的值。 */
function defaultScheduledLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabel(status: string): { text: string; cls: string } {
  switch (status) {
    case "queued":
      return { text: "排队中", cls: "queue-status-queued" };
    case "running":
      return { text: "执行中", cls: "queue-status-running" };
    case "succeeded":
      return { text: "成功", cls: "queue-status-succeeded" };
    case "failed":
      return { text: "失败", cls: "queue-status-failed" };
    case "skipped":
      return { text: "已跳过", cls: "queue-status-cancelled" };
    case "cancelled":
      return { text: "已取消", cls: "queue-status-cancelled" };
    default:
      return { text: status, cls: "" };
  }
}

function statusIcon(status: string, size = 13) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 size={size} aria-hidden />;
    case "failed":
      return <XCircle size={size} aria-hidden />;
    case "running":
      return <Loader2 size={size} className="spin" aria-hidden />;
    case "skipped":
    case "cancelled":
      return <Ban size={size} aria-hidden />;
    default:
      return <Clock size={size} aria-hidden />;
  }
}

export function PublishBatchDrawer({ open, onOpenChange }: Props) {
  const publishBatches = useStore((s) => s.publishBatches);
  const drafts = useStore((s) => s.drafts);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);
  const markdown = useStore((s) => s.markdown);
  const performanceRecords = useStore((s) => s.performanceRecords);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const loadPublishBatches = useStore((s) => s.loadPublishBatches);
  const createPublishBatch = useStore((s) => s.createPublishBatch);
  const triggerPublishBatchItem = useStore((s) => s.triggerPublishBatchItem);
  const retryPublishBatchFailed = useStore((s) => s.retryPublishBatchFailed);
  const cancelPublishBatch = useStore((s) => s.cancelPublishBatch);
  const removePublishBatch = useStore((s) => s.removePublishBatch);
  const collectBatchMetrics = useStore((s) => s.collectBatchMetrics);
  const reschedulePublishBatchItem = useStore((s) => s.reschedulePublishBatchItem);
  const reschedulePublishBatchAll = useStore((s) => s.reschedulePublishBatchAll);
  const lastBatchCollect = useStore((s) => s.lastBatchCollect);

  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [platformIds, setPlatformIds] = useState<string[]>([...ALL_IDS]);
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduledLocal);
  const [realPublish, setRealPublish] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [collectingId, setCollectingId] = useState<string | null>(null);
  // v6 CAL-04:单条改期(与内容日历拖拽改期一致)。
  const [rescheduleTarget, setRescheduleTarget] = useState<{ batchId: string; itemId: string; draftTitle: string } | null>(null);
  const [rescheduleLocal, setRescheduleLocal] = useState(defaultScheduledLocal);
  const [rescheduling, setRescheduling] = useState(false);
  // v6 Phase 2:批次整体改期(全部可改期条目统一迁移到新时间)。
  const [rescheduleAllTarget, setRescheduleAllTarget] = useState<{ batchId: string; batchName: string } | null>(null);
  const [rescheduleAllLocal, setRescheduleAllLocal] = useState(defaultScheduledLocal);
  const [reschedulingAll, setReschedulingAll] = useState(false);
  // AI 排期建议(发布批次):建议批次发布时间 + 平台组合。
  const [scheduleSuggestions, setScheduleSuggestions] = useState<readonly QueueScheduleSuggestion[]>([]);
  const [scheduleSummary, setScheduleSummary] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  // v10 FORECAST-QUEUE-01:预期效果预测展示。
  const [forecastView, setForecastView] = useState<QueueForecastView | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  // v10 MATRIX-QUEUE:内容矩阵 → 批量目标平台建议。
  const [matrixSuggs, setMatrixSuggs] = useState<readonly MatrixPlatformSuggestion[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);

  const refresh = useCallback(async () => {
    await loadPublishBatches();
  }, [loadPublishBatches]);

  // v6 CAL-04:提交单条改期。
  const doRescheduleItem = useCallback(async () => {
    if (!rescheduleTarget) return;
    if (!rescheduleLocal || Number.isNaN(Date.parse(rescheduleLocal))) {
      setError("发布时间格式无效");
      return;
    }
    setRescheduling(true);
    setError("");
    try {
      const result = await reschedulePublishBatchItem(
        rescheduleTarget.batchId,
        rescheduleTarget.itemId,
        toIsoLocal(rescheduleLocal),
      );
      if (!result.ok) {
        setError(result.error ?? "改期失败");
      } else {
        setRescheduleTarget(null);
      }
    } finally {
      setRescheduling(false);
    }
  }, [rescheduleTarget, rescheduleLocal, reschedulePublishBatchItem]);

  // v6 Phase 2:提交批次整体改期(全部可改期条目统一迁移到新时间)。
  const doRescheduleAll = useCallback(async () => {
    if (!rescheduleAllTarget) return;
    if (!rescheduleAllLocal || Number.isNaN(Date.parse(rescheduleAllLocal))) {
      setError("发布时间格式无效");
      return;
    }
    setReschedulingAll(true);
    setError("");
    try {
      const result = await reschedulePublishBatchAll(
        rescheduleAllTarget.batchId,
        toIsoLocal(rescheduleAllLocal),
      );
      if (!result.ok) {
        setError(result.error ?? "整体改期失败");
      } else {
        setRescheduleAllTarget(null);
        await refresh();
      }
    } finally {
      setReschedulingAll(false);
    }
  }, [rescheduleAllTarget, rescheduleAllLocal, reschedulePublishBatchAll, refresh]);

  useEffect(() => {
    if (open) {
      void refresh();
      setDraftIds([]);
      setPlatformIds([...selectedPlatforms]);
      setScheduledLocal(defaultScheduledLocal());
      setError("");
      setForecastView(null);
      setMatrixSuggs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draftOptions = useMemo(() => {
    return drafts.filter((d) => d.markdown.trim());
  }, [drafts]);

  const toggleDraft = useCallback((id: string) => {
    setDraftIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const togglePlatform = useCallback((id: string) => {
    setPlatformIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  // AI 排期建议:结合历史效果 + 当前内容(勾选草稿首篇或当前编辑)生成建议时间/平台组合。
  const runSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setError("");
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const first = draftIds[0];
      const sourceMarkdown = (first ? drafts.find((d) => d.id === first)?.markdown : undefined) ?? markdown;
      const result = await generateQueueSchedule(llmAdapter, {
        title: deriveTitleFromMarkdown(sourceMarkdown),
        contentText: stripMarkdown(sourceMarkdown),
        performanceRecords,
        platformIds: platformIds.length > 0 ? platformIds : ALL_IDS,
        earliestAt: toIsoLocal(scheduledLocal),
      });
      setScheduleSuggestions(result.suggestions);
      setScheduleSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScheduleLoading(false);
    }
  }, [draftIds, drafts, markdown, performanceRecords, platformIds, scheduledLocal, llm, llmConfigs, activeLlmConfigId]);

  // 采纳一条排期建议:把建议时间与平台组合填入批次表单(所有勾选草稿统一按此时间排队)。
  const applySuggestion = useCallback((s: QueueScheduleSuggestion) => {
    setScheduledLocal(isoToLocal(s.suggestedAt));
    if (s.platformIds.length > 0) setPlatformIds([...s.platformIds]);
    toast(`已采纳排期建议:${s.name}`, "success");
  }, []);

  // v10 FORECAST-QUEUE-01:为批次待排队内容生成「预期效果」预测展示(用首篇草稿/当前内容)。
  const runForecast = useCallback(async () => {
    setForecastLoading(true);
    setError("");
    try {
      const first = draftIds[0];
      const sourceMarkdown = (first ? drafts.find((d) => d.id === first)?.markdown : undefined) ?? markdown;
      setForecastView(
        runQueueForecast({
          title: deriveTitleFromMarkdown(sourceMarkdown),
          contentText: stripMarkdown(sourceMarkdown),
          performanceRecords,
          platformIds: platformIds.length > 0 ? platformIds : ALL_IDS,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setForecastLoading(false);
    }
  }, [draftIds, drafts, markdown, performanceRecords, platformIds]);

  // 采纳推荐平台:把预测推荐平台填入表单平台选择。
  const applyForecastPlatforms = useCallback((recommended: readonly string[]) => {
    setPlatformIds([...recommended]);
  }, []);

  // v10 MATRIX-QUEUE:基于内容矩阵派生批量目标平台建议。
  const runMatrix = useCallback(async () => {
    setMatrixLoading(true);
    setError("");
    try {
      setMatrixSuggs(
        runMatrixSuggestions(performanceRecords, platformIds.length > 0 ? platformIds : ALL_IDS, 3),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMatrixLoading(false);
    }
  }, [performanceRecords, platformIds]);

  // 采纳一条平台建议:把建议平台组合填入表单。
  const applyMatrixSuggestion = useCallback((s: MatrixPlatformSuggestion) => {
    if (s.platformIds.length > 0) setPlatformIds([...s.platformIds]);
  }, []);

  const create = useCallback(async () => {
    if (draftIds.length === 0) {
      setError("请至少勾选一篇草稿");
      return;
    }
    if (platformIds.length === 0) {
      setError("请至少选择一个平台");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const result = await createPublishBatch({
        name: undefined,
        items: draftIds.map((draftId) => {
          const draft = drafts.find((d) => d.id === draftId);
          return {
            draftId,
            draftTitle: draft?.title,
            platformIds: [...platformIds],
          };
        }),
        scheduledAt: toIsoLocal(scheduledLocal),
        realPublish,
      });
      if (result.ok) {
        toast(`已创建发布批次,共 ${draftIds.length} 篇`, "success");
        setDraftIds([]);
        await refresh();
      } else {
        setError(result.error ?? "创建批次失败");
      }
    } finally {
      setCreating(false);
    }
  }, [draftIds, drafts, platformIds, scheduledLocal, realPublish, createPublishBatch, refresh]);

  const triggerItem = useCallback(
    async (batchId: string, itemId: string) => {
      const result = await triggerPublishBatchItem(batchId, itemId);
      if (!result.ok) toast(result.error ?? "执行失败", "error");
      else toast("已立即执行该篇", "success");
      await refresh();
    },
    [triggerPublishBatchItem, refresh],
  );

  const retryFailed = useCallback(
    async (batchId: string) => {
      const result = await retryPublishBatchFailed(batchId);
      if (!result.ok) toast(result.error ?? "重试失败", "error");
      else if (result.retried > 0) toast(`已重试 ${result.retried} 篇失败条目`, "success");
      else toast("没有可重试的失败条目", "info");
      await refresh();
    },
    [retryPublishBatchFailed, refresh],
  );

  const collect = useCallback(
    async (batchId: string) => {
      setCollectingId(batchId);
      try {
        const result = await collectBatchMetrics(batchId);
        if (result.ok) toast(`已回收效果 ${result.imported} 条(跳过 ${result.skipped} 条重复)`, "success");
        else toast(result.error ?? "效果回收失败", "error");
      } finally {
        setCollectingId(null);
      }
    },
    [collectBatchMetrics],
  );

  const cancel = useCallback(
    async (batchId: string) => {
      await cancelPublishBatch(batchId);
      await refresh();
    },
    [cancelPublishBatch, refresh],
  );

  const remove = useCallback(
    async (batchId: string) => {
      await removePublishBatch(batchId);
      await refresh();
    },
    [removePublishBatch, refresh],
  );

  const formatRate = (rate: number) => `${Math.round(rate * 100)}%`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Layers size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              发布批次
            </Dialog.Title>
            <div className="drawer-header-actions">
              <button type="button" className="btn-icon" aria-label="刷新" onClick={() => void refresh()}>
                <RefreshCw size={16} aria-hidden />
              </button>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭">
                  <X size={18} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="drawer-body">
            <div className="assistant-fact-summary">
              一次排队多篇草稿,到点逐篇自动发布(复用可信回执)。单篇失败不阻断其余;全部完成后自动生成批次复盘,可按批次批量回收效果。
            </div>

            {error && <div className="batch-error">{error}</div>}
            {lastBatchCollect && !lastBatchCollect.error && (
              <div className="batch-success">
                最近一次批量回收:导入 {lastBatchCollect.imported} 条,去重跳过 {lastBatchCollect.skipped} 条。
              </div>
            )}
            {lastBatchCollect?.error && <div className="batch-error">{lastBatchCollect.error}</div>}

            {/* 新建表单 */}
            <div className="scheduler-form">
              <div className="drift-section-label">创建发布批次</div>
              <div className="scheduler-field">
                <span>选择草稿(可多选)</span>
                <div className="scheduler-platforms">
                  {draftOptions.length === 0 && <span className="assistant-empty-sm">暂无可用草稿,请先保存草稿。</span>}
                  {draftOptions.map((d) => {
                    const active = draftIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={active ? "chip chip-active" : "chip"}
                        style={{ ["--chip-color" as string]: "var(--accent)" }}
                        onClick={() => toggleDraft(d.id)}
                        aria-pressed={active}
                      >
                        {d.title}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="scheduler-field">
                <span>期望发布时间(未单独指定时,全部草稿按此时刻排队)</span>
                <input
                  type="datetime-local"
                  value={scheduledLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                  aria-label="期望发布时间"
                />
              </label>
              <label className="scheduler-field">
                <span>发布方式</span>
                <select value={realPublish ? "real" : "mock"} onChange={(e) => setRealPublish(e.target.value === "real")}>
                  <option value="real">真实发布(走可信回执)</option>
                  <option value="mock">仅模拟(生成暂存产物)</option>
                </select>
              </label>
              <div className="scheduler-field">
                <span>目标平台</span>
                <div className="scheduler-platforms">
                  {ADAPTERS.map((a) => {
                    const color = platformColor(a.id);
                    const active = platformIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={active ? "chip chip-active" : "chip"}
                        style={{ ["--chip-color" as string]: color }}
                        onClick={() => togglePlatform(a.id)}
                        aria-pressed={active}
                      >
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={creating}>
                {creating ? <Loader2 size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                创建发布批次（{draftIds.length} 篇）
              </button>
            </div>

            {/* AI 排期建议:结合历史效果与当前内容,建议批次发布时间与平台组合 */}
            <ScheduleSuggestionsBlock
              hint="AI 排期建议:结合历史效果与当前内容,建议批次发布时间与平台组合"
              loading={scheduleLoading}
              canRun={draftIds.length > 0 || !!markdown.trim()}
              summary={scheduleSummary}
              suggestions={scheduleSuggestions}
              onRun={() => void runSchedule()}
              onApply={applySuggestion}
            />

            {/* v10 FORECAST-QUEUE-01:预期效果预测展示(阅读区间 + 推荐平台 + 决策) */}
            <QueueForecastBlock
              hint="效果预测:基于历史效果预估本批次内容的预期阅读区间与推荐平台(以首篇草稿为准)"
              canRun={draftIds.length > 0 || !!markdown.trim()}
              loading={forecastLoading}
              result={forecastView}
              onRun={() => void runForecast()}
              onApplyPlatforms={applyForecastPlatforms}
            />

            {/* v10 MATRIX-QUEUE:内容矩阵 → 批量目标平台建议 */}
            <MatrixPlatformSuggestionsBlock
              hint="平台建议:基于内容矩阵历史表现推荐批量目标平台组合"
              canRun={performanceRecords.length > 0}
              loading={matrixLoading}
              suggestions={matrixSuggs}
              onRun={() => void runMatrix()}
              onApply={applyMatrixSuggestion}
            />

            {/* 批次列表 */}
            <div className="drift-section-label" style={{ marginTop: 16 }}>
              批次列表（{publishBatches.length}）
            </div>
            {publishBatches.length === 0 && (
              <div className="assistant-empty">暂无发布批次。勾选多篇草稿并设定时间即可创建。</div>
            )}
            {publishBatches.map((batch) => {
              const st = statusLabel(batch.status);
              const failedCount = batch.items.filter((i) => i.status === "failed").length;
              const succeededCount = batch.items.filter((i) => i.status === "succeeded").length;
              return (
                <div key={batch.id} className="scheduler-task">
                  <div className="scheduler-task-head">
                    <span className="scheduler-task-name">{batch.name}</span>
                    <span className={st.cls}>
                      {statusIcon(batch.status)}
                      {st.text}
                    </span>
                  </div>
                  <div className="scheduler-task-meta">
                    创建于 {new Date(batch.createdAt).toLocaleString()} · 计划 {new Date(batch.scheduledAt).toLocaleString()} · 成功 {succeededCount}/{batch.items.length}
                    {batch.retro && (
                      <span style={{ marginLeft: 8 }}>
                        成功率 {formatRate(batch.retro.successRate)}
                      </span>
                    )}
                  </div>
                  {batch.retro && (
                    <div className="scheduler-task-run">
                      复盘:成功 {batch.retro.succeeded} · 失败 {batch.retro.failed} · 跳过 {batch.retro.skipped} · 可回收 remoteId {batch.retro.collectibleRemoteIds}
                      <div>
                        {batch.retro.suggestions.map((s, i) => (
                          <div key={i} className="drift-msg">
                            {s}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="scheduler-task-platforms">
                    条目明细:
                  </div>
                  {batch.items.map((item) => {
                    const is = statusLabel(item.status);
                    const draftTitle = drafts.find((d) => d.id === item.draftId)?.title ?? item.draftTitle;
                    return (
                      <div key={item.itemId} className="scheduler-task-run">
                        <div className="scheduler-task-head">
                          <span className="scheduler-task-name" style={{ fontSize: 12 }}>
                            {draftTitle}
                          </span>
                          <span className={is.cls}>
                            {statusIcon(item.status, 12)}
                            {is.text}
                          </span>
                        </div>
                        <div className="scheduler-task-platforms">
                          {item.platformIds.length === 0 ? "全部平台" : item.platformIds.join(" / ")}
                          {item.scheduledAt && ` · 计划 ${new Date(item.scheduledAt).toLocaleString()}`}
                        </div>
                        {item.resultMessage && <div>结果:{item.resultMessage}</div>}
                        {item.error && item.status === "failed" && (
                          <div className="scheduler-task-run-error">错误:{item.error}</div>
                        )}
                        {item.jobId && <div>任务:{item.jobId}</div>}
                        {item.receipts && item.receipts.length > 0 && (
                          <div>
                            回执:{item.receipts.map((r) => `${r.platformId}${r.remoteId ? `#${r.remoteId}` : ""}`).join(", ")}
                          </div>
                        )}
                        {(item.status === "queued" || item.status === "failed") && (
                          <div className="scheduler-task-actions">
                            <button type="button" className="btn btn-sm" onClick={() => void triggerItem(batch.id, item.itemId)}>
                              <Play size={12} aria-hidden /> 立即执行
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                const base = item.scheduledAt ?? batch.scheduledAt;
                                setRescheduleLocal(base ? isoToLocal(base) : defaultScheduledLocal());
                                setRescheduleTarget({ batchId: batch.id, itemId: item.itemId, draftTitle: draftTitle });
                              }}
                            >
                              <Clock size={12} aria-hidden /> 改期
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="scheduler-task-actions">
                    {(batch.status === "queued" || batch.status === "running") && (
                      <button type="button" className="btn btn-sm" onClick={() => void cancel(batch.id)}>
                        <Ban size={12} aria-hidden /> 取消批次
                      </button>
                    )}
                    {(batch.status === "queued" || batch.status === "running") && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setRescheduleAllLocal(defaultScheduledLocal());
                          setRescheduleAllTarget({ batchId: batch.id, batchName: batch.name });
                        }}
                      >
                        <Clock size={12} aria-hidden /> 整体改期
                      </button>
                    )}
                    {failedCount > 0 && (
                      <button type="button" className="btn btn-sm" onClick={() => void retryFailed(batch.id)}>
                        <RotateCcw size={12} aria-hidden /> 重试失败（{failedCount}）
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void collect(batch.id)}
                      disabled={collectingId === batch.id}
                    >
                      {collectingId === batch.id ? <Loader2 size={12} className="spin" aria-hidden /> : <BarChart3 size={12} aria-hidden />}
                      批量回收效果
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void remove(batch.id)}>
                      <Trash2 size={12} aria-hidden /> 删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {rescheduleTarget && (
            <div className="drawer-footer-bar">
              <div className="drawer-footer-title">改期批次条目「{rescheduleTarget.draftTitle}」</div>
              <input
                type="datetime-local"
                className="input"
                value={rescheduleLocal}
                onChange={(e) => setRescheduleLocal(e.target.value)}
                aria-label="改期时间"
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void doRescheduleItem()}
                disabled={rescheduling}
              >
                {rescheduling ? <Loader2 size={12} className="spin" aria-hidden /> : <Clock size={12} aria-hidden />}
                确认改期
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setRescheduleTarget(null)}
                disabled={rescheduling}
              >
                取消
              </button>
            </div>
          )}

          {rescheduleAllTarget && (
            <div className="drawer-footer-bar">
              <div className="drawer-footer-title">整体改期批次「{rescheduleAllTarget.batchName}」</div>
              <input
                type="datetime-local"
                className="input"
                value={rescheduleAllLocal}
                onChange={(e) => setRescheduleAllLocal(e.target.value)}
                aria-label="整体改期时间"
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void doRescheduleAll()}
                disabled={reschedulingAll}
              >
                {reschedulingAll ? <Loader2 size={12} className="spin" aria-hidden /> : <Clock size={12} aria-hidden />}
                确认整体改期
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setRescheduleAllTarget(null)}
                disabled={reschedulingAll}
              >
                取消
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
