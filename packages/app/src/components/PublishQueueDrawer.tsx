/**
 * 发布队列抽屉 —— ROADMAP_V5 Phase 1:把草稿排入「稍后发布」队列,到点自动触发真实发布。
 *
 * - 新建:选择草稿 / 目标平台 / 期望发布时间(本地时间) / 是否真实发布;
 * - 列表:状态(排队中/执行中/成功/失败/已取消)、发布时间、关联草稿、账号锁定提示;
 * - 操作:立即执行 / 改期 / 取消 / 删除;
 * - 心跳在 App 层每 60s 检查到点条目(与计划任务心跳并列),面板实时展示。
 *
 * 约束(延续路线图):机器与登录态必须在线;到点走与「立即真实发布」相同的鉴权与可信回执;
 * 账号引用在排队时锁定,排队期间切换账号不影响到点发布。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Clock,
  Play,
  Trash2,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  CalendarClock,
  RefreshCw,
  GripVertical,
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
      return { text: "已完成", cls: "queue-status-succeeded" };
    case "failed":
      return { text: "失败", cls: "queue-status-failed" };
    case "cancelled":
      return { text: "已取消", cls: "queue-status-cancelled" };
    default:
      return { text: status, cls: "" };
  }
}

export function PublishQueueDrawer({ open, onOpenChange }: Props) {
  const publishQueue = useStore((s) => s.publishQueue);
  const drafts = useStore((s) => s.drafts);
  const currentDraftId = useStore((s) => s.currentDraftId);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);
  const markdown = useStore((s) => s.markdown);
  const performanceRecords = useStore((s) => s.performanceRecords);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const loadPublishQueue = useStore((s) => s.loadPublishQueue);
  const enqueuePublish = useStore((s) => s.enqueuePublish);
  const triggerPublishQueue = useStore((s) => s.triggerPublishQueue);
  const reschedulePublishQueue = useStore((s) => s.reschedulePublishQueue);
  const cancelPublishQueue = useStore((s) => s.cancelPublishQueue);
  const removePublishQueue = useStore((s) => s.removePublishQueue);
  const reorderPublishQueue = useStore((s) => s.reorderPublishQueue);

  const [name, setName] = useState("");
  const [draftId, setDraftId] = useState("");
  const [platformIds, setPlatformIds] = useState<string[]>([...ALL_IDS]);
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduledLocal);
  const [realPublish, setRealPublish] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScheduled, setEditScheduled] = useState("");
  // AI-QUEUE-01:AI 自动排期建议。
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
    await loadPublishQueue();
  }, [loadPublishQueue]);

  // 打开时加载并初始化默认草稿/平台。
  useEffect(() => {
    if (open) {
      void refresh();
      setDraftId(currentDraftId ?? "");
      setPlatformIds([...selectedPlatforms]);
      setScheduledLocal(defaultScheduledLocal());
      setError("");
      setScheduleSuggestions([]);
      setScheduleSummary("");
      setForecastView(null);
      setMatrixSuggs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draftOptions = useMemo(() => {
    return drafts.filter((d) => d.markdown.trim());
  }, [drafts]);

  const togglePlatform = useCallback((id: string) => {
    setPlatformIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const create = useCallback(async () => {
    if (!draftId) {
      setError("请选择要发布的草稿");
      return;
    }
    if (platformIds.length === 0) {
      setError("请至少选择一个平台");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const result = await enqueuePublish({
        name: name.trim() || undefined,
        draftId,
        platformIds,
        scheduledAt: toIsoLocal(scheduledLocal),
        realPublish,
      });
      if (result.ok) {
        toast("已排入发布队列", "success");
        setName("");
        setDraftId("");
        await refresh();
      } else {
        setError(result.error ?? "排队失败");
      }
    } finally {
      setCreating(false);
    }
  }, [name, draftId, platformIds, scheduledLocal, realPublish, enqueuePublish, refresh]);

  const trigger = useCallback(
    async (id: string) => {
      const result = await triggerPublishQueue(id);
      if (!result.ok) toast(result.error ?? "执行失败", "error");
      else toast("已立即执行", "success");
      await refresh();
    },
    [triggerPublishQueue, refresh],
  );

  // AI-QUEUE-01:根据历史效果 + 当前内容生成排期建议(发布时间 + 平台组合)。
  const runSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setError("");
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const sourceMarkdown = drafts.find((d) => d.id === draftId)?.markdown ?? markdown;
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
  }, [draftId, markdown, drafts, performanceRecords, platformIds, scheduledLocal, llm, llmConfigs, activeLlmConfigId]);

  // 采纳一条排期建议:把时间与平台组合填入表单。
  const applySuggestion = useCallback((s: QueueScheduleSuggestion) => {
    setScheduledLocal(isoToLocal(s.suggestedAt));
    if (s.platformIds.length > 0) setPlatformIds([...s.platformIds]);
    setName(s.name);
    toast(`已采纳排期建议:${s.name}`, "success");
  }, []);

  // v10 FORECAST-QUEUE-01:为当前待排队内容生成「预期效果」预测展示。
  const runForecast = useCallback(async () => {
    setForecastLoading(true);
    setError("");
    try {
      const sourceMarkdown = drafts.find((d) => d.id === draftId)?.markdown ?? markdown;
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
  }, [draftId, markdown, drafts, performanceRecords, platformIds]);

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

  const startEdit = useCallback(
    (id: string, scheduledAt: string) => {
      setEditingId(id);
      const d = new Date(scheduledAt);
      const pad = (n: number) => String(n).padStart(2, "0");
      setEditScheduled(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      );
    },
    [],
  );

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const result = await reschedulePublishQueue(editingId, toIsoLocal(editScheduled));
    if (result.ok) toast("已改期", "success");
    else toast(result.error ?? "改期失败", "error");
    setEditingId(null);
    await refresh();
  }, [editingId, editScheduled, reschedulePublishQueue, refresh]);

  const cancel = useCallback(
    async (id: string) => {
      await cancelPublishQueue(id);
      await refresh();
    },
    [cancelPublishQueue, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await removePublishQueue(id);
      await refresh();
    },
    [removePublishQueue, refresh],
  );

  // ROADMAP_V5 Phase 1 拖动排序:被拖条目 id + 悬停目标 id(仅对 queued 生效)。
  const [dragQueueId, setDragQueueId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const dropQueue = useCallback(
    (targetId: string) => {
      setDragOverQueueId(null);
      const from = dragQueueId;
      if (!from || from === targetId) {
        setDragQueueId(null);
        return;
      }
      const ids = publishQueue.map((e) => e.id);
      const fromIdx = ids.indexOf(from);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) {
        setDragQueueId(null);
        return;
      }
      const next = [...ids];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      setDragQueueId(null);
      void reorderPublishQueue(next);
    },
    [publishQueue, dragQueueId, reorderPublishQueue],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <CalendarClock size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              发布队列
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
              把草稿排入「稍后发布」队列,到点自动触发真实发布。排队时锁定当前账号,执行走与「立即真实发布」相同的鉴权与可信回执。
            </div>

            {error && <div className="batch-error">{error}</div>}

            {/* 新建表单 */}
            <div className="scheduler-form">
              <div className="drift-section-label">排入队列</div>
              <label className="scheduler-field">
                <span>备注名称(可选)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:周五晚间发布" />
              </label>
              <label className="scheduler-field">
                <span>关联草稿</span>
                <select value={draftId} onChange={(e) => setDraftId(e.target.value)}>
                  <option value="">请选择草稿…</option>
                  {draftOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="scheduler-field">
                <span>期望发布时间</span>
                <input
                  type="datetime-local"
                  value={scheduledLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                  aria-label="期望发布时间"
                />
              </label>
              <label className="scheduler-field">
                <span>发布方式</span>
                <div className="scheduler-cron-row">
                  <select value={realPublish ? "real" : "mock"} onChange={(e) => setRealPublish(e.target.value === "real")}>
                    <option value="real">真实发布(走可信回执)</option>
                    <option value="mock">仅模拟(生成暂存产物)</option>
                  </select>
                </div>
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
                排入发布队列
              </button>
            </div>

            {/* AI-QUEUE-01:AI 自动排期建议(发布时间 + 平台组合),复用共享模块 */}
            <ScheduleSuggestionsBlock
              hint="AI 自动排期:结合历史效果与当前内容建议发布时间与平台组合"
              loading={scheduleLoading}
              canRun={!!draftId || !!markdown.trim()}
              summary={scheduleSummary}
              suggestions={scheduleSuggestions}
              onRun={() => void runSchedule()}
              onApply={applySuggestion}
            />

            {/* v10 FORECAST-QUEUE-01:预期效果预测展示(阅读区间 + 推荐平台 + 决策) */}
            <QueueForecastBlock
              hint="效果预测:基于历史效果预估本内容在各平台的预期阅读区间与推荐平台"
              canRun={!!draftId || !!markdown.trim()}
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

            {/* 队列列表 */}
            <div className="drift-section-label" style={{ marginTop: 16 }}>
              队列条目（{publishQueue.length}）
            </div>
            {publishQueue.length === 0 && (
              <div className="assistant-empty">发布队列为空。选择草稿与发布时间后即可排入。</div>
            )}
            {publishQueue.map((entry) => {
              const st = statusLabel(entry.status);
              const draftTitle = drafts.find((d) => d.id === entry.draftId)?.title ?? "草稿已删除";
              const isDragging = dragQueueId === entry.id;
              const isOver = dragOverQueueId === entry.id && dragQueueId !== entry.id;
              const draggable = entry.status === "queued";
              return (
                <div
                  key={entry.id}
                  className={`scheduler-task queue-item${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
                  draggable={draggable}
                  onDragStart={(e) => {
                    if (!draggable) return;
                    setDragQueueId(entry.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", entry.id);
                  }}
                  onDragEnd={() => {
                    setDragQueueId(null);
                    setDragOverQueueId(null);
                  }}
                  onDragOver={(e) => {
                    if (!draggable) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverQueueId(entry.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverQueueId === entry.id) setDragOverQueueId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropQueue(entry.id);
                  }}
                >
                  <div className="scheduler-task-head">
                    {draggable && (
                      <span className="queue-item-grip" aria-hidden>
                        <GripVertical size={13} />
                      </span>
                    )}
                    <span className="scheduler-task-name">{entry.name}</span>
                    <span className={st.cls}>
                      {entry.status === "succeeded" ? (
                        <CheckCircle2 size={13} aria-hidden />
                      ) : entry.status === "failed" ? (
                        <XCircle size={13} aria-hidden />
                      ) : entry.status === "cancelled" ? (
                        <Ban size={13} aria-hidden />
                      ) : entry.status === "running" ? (
                        <Loader2 size={13} className="spin" aria-hidden />
                      ) : (
                        <Clock size={13} aria-hidden />
                      )}
                      {st.text}
                    </span>
                  </div>
                  <div className="scheduler-task-meta">
                    预计 {new Date(entry.scheduledAt).toLocaleString()} · {draftTitle} · {entry.realPublish ? "真实发布" : "模拟"}
                  </div>
                  <div className="scheduler-task-platforms">
                    {entry.platformIds.length === 0 ? "全部平台" : entry.platformIds.join(" / ")}
                    {entry.accountRefs.length > 0 && " · 账号已锁定"}
                  </div>
                  {entry.resultMessage && (
                    <div className="scheduler-task-run">结果:{entry.resultMessage}</div>
                  )}
                  {entry.error && entry.status === "failed" && (
                    <div className="scheduler-task-run scheduler-task-run-error">错误:{entry.error}</div>
                  )}
                  {entry.jobId && (
                    <div className="scheduler-task-run">任务:{entry.jobId}</div>
                  )}
                  <div className="scheduler-task-actions">
                    {(entry.status === "queued" || entry.status === "failed") && (
                      <button type="button" className="btn btn-sm" onClick={() => void trigger(entry.id)}>
                        <Play size={12} aria-hidden /> 立即执行
                      </button>
                    )}
                    {(entry.status === "queued" || entry.status === "failed") && (
                      <button type="button" className="btn btn-sm" onClick={() => startEdit(entry.id, entry.scheduledAt)}>
                        <Clock size={12} aria-hidden /> 改期
                      </button>
                    )}
                    {entry.status === "queued" && (
                      <button type="button" className="btn btn-sm" onClick={() => void cancel(entry.id)}>
                        <Ban size={12} aria-hidden /> 取消
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => void remove(entry.id)}>
                      <Trash2 size={12} aria-hidden /> 删除
                    </button>
                  </div>
                  {editingId === entry.id && (
                    <div className="scheduler-task-edit">
                      <input
                        type="datetime-local"
                        value={editScheduled}
                        onChange={(e) => setEditScheduled(e.target.value)}
                        aria-label="新发布时间"
                      />
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveEdit()}>
                        保存改期
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
