/**
 * v3 · 内容日历 —— 月历/周历视图聚合 草稿更新 / 计划任务 / 发布历史 / 效果记录。
 * v6 · 新增聚合 发布队列 / 发布批次条目,并支持三类事件拖拽改期。
 * v6 Phase 2 · 新增 周/月视图切换 + 视图内批量改期操作。
 *
 * 数据来源(store 本地数据):
 * - drafts → updatedAt;
 * - scheduledTasks → cron 计算当月触发日;
 * - history → 发布日;
 * - performanceRecords → 效果数据日;
 * - publishQueue → scheduledAt(待发布条目);
 * - publishBatches → 批内条目 scheduledAt(待发布条目)。
 *
 * 交互(CAL-03 / v6 CAL-04 / v6 Phase 2):
 * - 月 / 周视图切换;上月 / 下月(周视图为上一周 / 下一周) / 回到当月;
 * - 点击某天 → 展示当天事件详情列表;
 * - 点击事件 → 打开对应详情(草稿/任务/效果/发布历史/发布队列/发布批次);
 * - 计划任务 / 发布队列 / 发布批次条目可拖拽改期(HTML5 drag & drop 到目标日,保留原时间);
 * - 周/月视图内「批量操作」:勾选当前视图内可改期事件 → 统一改期到目标日期(保留各自原时间)。
 * - 每种事件带 Lucide 图标与品牌色;懒加载拆包。
 */
import { useMemo, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  FileText,
  Clock,
  Rocket,
  BarChart3,
  Inbox,
  Move,
  ExternalLink,
  SendToBack,
  Layers,
  CheckSquare,
  Square,
  ListChecks,
} from "lucide-react";
import {
  buildCalendar,
  shiftCronToDate,
  shiftIsoToDate,
  parseIsoDate,
  toIsoDate,
  weekDates,
  dayOfWeekIndex,
  collectReschedulableInRange,
  type CalendarDay,
  type CalendarEvent,
  type CalendarReschedulable,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** CAL-03:点击事件时跳转到对应详情(打开抽屉/加载草稿)。 */
  onNavigate?: (kind: CalendarEvent["kind"], refId: string) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const KIND_META: Record<CalendarEvent["kind"], { icon: typeof FileText; label: string }> = {
  draft: { icon: FileText, label: "草稿更新" },
  task: { icon: Clock, label: "计划任务" },
  publish: { icon: Rocket, label: "发布" },
  metric: { icon: BarChart3, label: "效果数据" },
  queue: { icon: SendToBack, label: "发布队列" },
  batch: { icon: Layers, label: "发布批次" },
};

const KIND_LABEL: Record<CalendarReschedulable, string> = {
  task: "计划任务",
  queue: "发布队列",
  batch: "发布批次",
};

type ViewMode = "month" | "week";

/** 把本地 Date 格式化为 YYYY-MM-DD。 */
function isoOf(d: Date): string {
  return toIsoDate(d);
}

export function ContentCalendar({ open, onOpenChange, onNavigate }: Props) {
  const drafts = useStore((s) => s.drafts);
  const scheduledTasks = useStore((s) => s.scheduledTasks);
  const history = useStore((s) => s.history);
  const performanceRecords = useStore((s) => s.performanceRecords);
  const publishQueue = useStore((s) => s.publishQueue);
  const publishBatches = useStore((s) => s.publishBatches);
  const updateScheduledTask = useStore((s) => s.updateScheduledTask);
  const reschedulePublishQueue = useStore((s) => s.reschedulePublishQueue);
  const reschedulePublishBatchItem = useStore((s) => s.reschedulePublishBatchItem);

  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  /** 周视图锚点(该周内的任意一天,ISO YYYY-MM-DD)。 */
  const [weekAnchor, setWeekAnchor] = useState<string>(isoOf(today));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dragRef, setDragRef] = useState<{ kind: "queue" | "batch" | "task"; refId: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // v6 Phase 2:批量操作 —— 勾选事件 + 目标日期。
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget] = useState<string>(isoOf(today));
  const [batchApplying, setBatchApplying] = useState(false);

  const calendarInput = useMemo(
    () => ({
      drafts,
      tasks: scheduledTasks.map((t) => ({ id: t.id, name: t.name, cron: t.cron })),
      history,
      metrics: performanceRecords.map((r) => ({
        id: r.id,
        title: r.title,
        date: r.publishedAt.slice(0, 10),
        platformId: r.platformId,
        views: r.metrics.views,
      })),
      queue: publishQueue.map((e) => ({
        id: e.id,
        name: e.name,
        scheduledAt: e.scheduledAt,
        status: e.status,
        platformIds: e.platformIds,
      })),
      batches: publishBatches.map((b) => ({
        id: b.id,
        name: b.name,
        scheduledAt: b.scheduledAt,
        status: b.status,
        items: b.items.map((it) => ({
          itemId: it.itemId,
          draftTitle: it.draftTitle,
          scheduledAt: it.scheduledAt,
          status: it.status,
          platformIds: it.platformIds,
        })),
      })),
    }),
    [drafts, scheduledTasks, history, performanceRecords, publishQueue, publishBatches],
  );

  // 月视图:当月聚合。
  const monthDays = useMemo(() => {
    return buildCalendar(calendarInput, { year: viewYear, month: viewMonth });
  }, [calendarInput, viewYear, viewMonth]);

  // 周视图:覆盖周窗口(可能跨月)的所有日期聚合。
  const weekDays = useMemo(() => {
    const anchor = parseIsoDate(weekAnchor) ?? new Date();
    const dates = weekDates(anchor);
    const months = new Set<number>();
    for (const d of dates) months.add(d.getFullYear() * 12 + d.getMonth());
    const merged = new Map<string, CalendarDay>();
    for (const key of months) {
      const y = Math.floor(key / 12);
      const m = (key % 12) + 1;
      const sub = buildCalendar(calendarInput, { year: y, month: m });
      for (const [k, v] of sub) merged.set(k, v);
    }
    return merged;
  }, [calendarInput, weekAnchor]);

  // 当前视图可见日期(用于批量操作收集)。
  const viewDays: CalendarDay[] = useMemo(() => {
    if (viewMode === "month") return [...monthDays.values()];
    const anchor = parseIsoDate(weekAnchor) ?? new Date();
    const out: CalendarDay[] = [];
    for (const d of weekDates(anchor)) {
      const key = isoOf(d);
      const day = weekDays.get(key);
      if (day) out.push(day);
      else out.push({ date: key, events: [] });
    }
    return out;
  }, [viewMode, monthDays, weekDays, weekAnchor]);

  // 当前视图可批量改期事件(去重)。
  const reschedulableEvents = useMemo(() => collectReschedulableInRange(viewDays), [viewDays]);

  // 计算月历格子:首日偏移 + 天数。
  const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDays = new Date(viewYear, viewMonth, 0).getDate();
  const monthCells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) monthCells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    const iso = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    monthCells.push(iso);
  }

  const selectDate = useCallback((iso: string) => {
    setSelectedDate((cur) => (cur === iso ? null : iso));
    // 同时把周视图锚点定位到该日期(切换周视图时以选中日为中心)。
    setWeekAnchor(iso);
  }, []);

  const goPrev = () => {
    if (viewMode === "month") {
      if (viewMonth === 1) {
        setViewYear(viewYear - 1);
        setViewMonth(12);
      } else {
        setViewMonth(viewMonth - 1);
      }
    } else {
      const anchor = parseIsoDate(weekAnchor) ?? new Date();
      setWeekAnchor(isoOf(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 7)));
    }
    setSelectedDate(null);
  };
  const goNext = () => {
    if (viewMode === "month") {
      if (viewMonth === 12) {
        setViewYear(viewYear + 1);
        setViewMonth(1);
      } else {
        setViewMonth(viewMonth + 1);
      }
    } else {
      const anchor = parseIsoDate(weekAnchor) ?? new Date();
      setWeekAnchor(isoOf(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7)));
    }
    setSelectedDate(null);
  };
  const goToday = () => {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth() + 1);
    setWeekAnchor(isoOf(t));
    setSelectedDate(null);
    setBatchSelected(new Set());
  };

  // CAL-03 / v6 CAL-04:拖拽改期 —— 计划任务(cron)/ 发布队列 / 发布批次条目迁移到目标日期。
  const handleDrop = useCallback(
    (targetIso: string) => {
      setDragOver(null);
      if (!dragRef) return;
      const target = parseIsoDate(targetIso);
      if (!target) {
        setDragRef(null);
        return;
      }
      if (dragRef.kind === "task") {
        const task = scheduledTasks.find((t) => t.id === dragRef.refId);
        if (task) {
          void updateScheduledTask(dragRef.refId, { cron: shiftCronToDate(task.cron, target) });
        }
      } else if (dragRef.kind === "queue") {
        const entry = publishQueue.find((e) => e.id === dragRef.refId);
        if (entry) {
          void reschedulePublishQueue(dragRef.refId, shiftIsoToDate(entry.scheduledAt, target));
        }
      } else if (dragRef.kind === "batch") {
        // 批次条目:需要反查所属批次 id。
        const found = publishBatches.find((b) => b.items.some((it) => it.itemId === dragRef.refId));
        const item = found?.items.find((it) => it.itemId === dragRef.refId);
        if (found && item) {
          const scheduledAt = item.scheduledAt ?? found.scheduledAt;
          if (scheduledAt) {
            void reschedulePublishBatchItem(found.id, dragRef.refId, shiftIsoToDate(scheduledAt, target));
          }
        }
      }
      setDragRef(null);
      setSelectedDate(targetIso);
    },
    [dragRef, scheduledTasks, publishQueue, publishBatches, updateScheduledTask, reschedulePublishQueue, reschedulePublishBatchItem],
  );

  const handleEventClick = useCallback(
    (kind: CalendarEvent["kind"], refId: string) => {
      if (onNavigate) {
        onNavigate(kind, refId);
        return;
      }
      // 无回调时:计划任务/发布队列/发布批次选中对应事件(拖拽起点);其余保持选中当天。
      if (kind === "task") {
        setDragRef({ kind: "task", refId });
      } else if (kind === "queue") {
        setDragRef({ kind: "queue", refId });
      } else if (kind === "batch") {
        setDragRef({ kind: "batch", refId });
      }
    },
    [onNavigate],
  );

  // v6 Phase 2:批量改期 —— 把选中事件统一迁移到目标日期(保留各自原时间)。
  const applyBatchReschedule = useCallback(async () => {
    if (batchSelected.size === 0) {
      toast("请先勾选要改期的事件", "info");
      return;
    }
    const target = parseIsoDate(batchTarget);
    if (!target) {
      toast("目标日期格式无效", "error");
      return;
    }
    setBatchApplying(true);
    try {
      let applied = 0;
      let skipped = 0;
      const selectedSet = batchSelected;
      for (const ev of reschedulableEvents) {
        const key = `${ev.kind}:${ev.refId}`;
        if (!selectedSet.has(key)) continue;
        if (ev.kind === "task") {
          const task = scheduledTasks.find((t) => t.id === ev.refId);
          if (task) {
            await updateScheduledTask(ev.refId, { cron: shiftCronToDate(task.cron, target) });
            applied++;
          } else skipped++;
        } else if (ev.kind === "queue") {
          const entry = publishQueue.find((e) => e.id === ev.refId);
          if (entry) {
            await reschedulePublishQueue(ev.refId, shiftIsoToDate(entry.scheduledAt, target));
            applied++;
          } else skipped++;
        } else if (ev.kind === "batch") {
          const found = publishBatches.find((b) => b.items.some((it) => it.itemId === ev.refId));
          const item = found?.items.find((it) => it.itemId === ev.refId);
          if (found && item) {
            const scheduledAt = item.scheduledAt ?? found.scheduledAt;
            if (scheduledAt) {
              await reschedulePublishBatchItem(found.id, ev.refId, shiftIsoToDate(scheduledAt, target));
              applied++;
            } else skipped++;
          } else skipped++;
        }
      }
      if (applied > 0) {
        toast(`已批量改期 ${applied} 个事件到 ${batchTarget}`, "success");
        setBatchSelected(new Set());
      }
      if (skipped > 0) toast(`${skipped} 个事件跳过(来源已不可用)`, "info");
    } finally {
      setBatchApplying(false);
    }
  }, [
    batchSelected,
    batchTarget,
    reschedulableEvents,
    scheduledTasks,
    publishQueue,
    publishBatches,
    updateScheduledTask,
    reschedulePublishQueue,
    reschedulePublishBatchItem,
  ]);

  const toggleBatchSelect = useCallback((key: string) => {
    setBatchSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setBatchSelected(new Set(reschedulableEvents.map((e) => `${e.kind}:${e.refId}`)));
  }, [reschedulableEvents]);

  const clearSelection = useCallback(() => setBatchSelected(new Set()), []);

  const selectedDay = selectedDate
    ? (viewMode === "month" ? monthDays : weekDays).get(selectedDate)
    : undefined;
  const isToday = (iso: string) => iso === isoOf(today);

  const renderDayEvents = (iso: string) => {
    const day = (viewMode === "month" ? monthDays : weekDays).get(iso);
    const events = day?.events ?? [];
    const kinds = [...new Set(events.map((e) => e.kind))];
    return { events, kinds };
  };

  const monthView = (
    <div className="calendar-grid" role="grid" aria-label={`${viewYear}年${viewMonth}月日历`}>
      {WEEKDAYS.map((w) => (
        <div key={w} className="calendar-weekday" role="columnheader">
          {w}
        </div>
      ))}
      {monthCells.map((iso, i) => {
        if (iso === null) return <div key={`empty-${i}`} className="calendar-cell empty" aria-hidden />;
        const { events, kinds } = renderDayEvents(iso);
        const cls = [
          "calendar-cell",
          isToday(iso) ? "today" : "",
          selectedDate === iso ? "selected" : "",
          dragOver === iso ? "drag-over" : "",
        ].filter(Boolean).join(" ");
        return (
          <button
            key={iso}
            type="button"
            className={cls}
            role="gridcell"
            aria-label={`${iso}${events.length ? ` ${events.length} 个事件` : ""}`}
            onClick={() => selectDate(iso)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(iso);
            }}
            onDragLeave={() => setDragOver((v) => (v === iso ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(iso);
            }}
          >
            <span className="calendar-day-num">{Number(iso.slice(8))}</span>
            <span className="calendar-dots" aria-hidden>
              {kinds.includes("draft") && <span className="dot dot-draft" />}
              {kinds.includes("task") && <span className="dot dot-task" />}
              {kinds.includes("queue") && <span className="dot dot-queue" />}
              {kinds.includes("batch") && <span className="dot dot-batch" />}
              {kinds.includes("publish") && <span className="dot dot-publish" />}
              {kinds.includes("metric") && <span className="dot dot-metric" />}
            </span>
          </button>
        );
      })}
    </div>
  );

  const weekView = (() => {
    const anchor = parseIsoDate(weekAnchor) ?? new Date();
    const dates = weekDates(anchor);
    return (
      <div className="calendar-week-grid" role="grid" aria-label={`${isoOf(dates[0])} 所在周日历`}>
        {dates.map((d) => {
          const iso = isoOf(d);
          const { events } = renderDayEvents(iso);
          const cls = [
            "calendar-week-cell",
            isToday(iso) ? "today" : "",
            selectedDate === iso ? "selected" : "",
            dragOver === iso ? "drag-over" : "",
          ].filter(Boolean).join(" ");
          return (
            <div
              key={iso}
              className={cls}
              role="gridcell"
              aria-label={`${iso}${events.length ? ` ${events.length} 个事件` : ""}`}
              onClick={() => selectDate(iso)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(iso);
              }}
              onDragLeave={() => setDragOver((v) => (v === iso ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(iso);
              }}
            >
              <div className="calendar-week-cell-head">
                <span className="calendar-week-cell-name">周{WEEKDAYS[dayOfWeekIndex(d)]}</span>
                <span className="calendar-day-num">{d.getDate()}</span>
              </div>
              <div className="calendar-week-cell-events">
                {events.length === 0 && <span className="calendar-week-empty">—</span>}
                {events.map((ev, i) => {
                  const meta = KIND_META[ev.kind];
                  const Icon = meta.icon;
                  const draggableKind = ev.reschedulable ?? null;
                  return (
                    <div
                      key={`${ev.refId}-${i}`}
                      className={[
                        "calendar-week-event",
                        draggableKind ? "calendar-event-task" : "",
                      ].filter(Boolean).join(" ")}
                      draggable={draggableKind !== null}
                      onDragStart={(e) => {
                        if (draggableKind) {
                          if (e.dataTransfer) {
                            e.dataTransfer.setData("text/plain", ev.refId);
                            e.dataTransfer.effectAllowed = "move";
                          }
                          setDragRef({ kind: draggableKind, refId: ev.refId });
                        }
                      }}
                      onDragEnd={() => setDragRef(null)}
                    >
                      <Icon size={12} className="calendar-event-icon" aria-hidden />
                      <span className="calendar-week-event-title">{ev.title}</span>
                      {onNavigate && (
                        <button
                          type="button"
                          className="calendar-week-event-open"
                          aria-label={`打开${meta.label}详情`}
                          title="打开详情"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEventClick(ev.kind, ev.refId);
                          }}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  })();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide content-calendar" aria-label="内容日历">
          <div className="drawer-header">
            <div className="drawer-title">
              <CalendarDays size={18} aria-hidden />
              内容日历
            </div>
            <div className="drawer-header-actions">
              <div className="calendar-view-toggle" role="group" aria-label="视图切换">
                <button
                  type="button"
                  className={viewMode === "month" ? "btn btn-sm btn-active" : "btn btn-sm btn-ghost"}
                  aria-pressed={viewMode === "month"}
                  onClick={() => {
                    setViewMode("month");
                    setSelectedDate(null);
                    setBatchSelected(new Set());
                  }}
                >
                  月
                </button>
                <button
                  type="button"
                  className={viewMode === "week" ? "btn btn-sm btn-active" : "btn btn-sm btn-ghost"}
                  aria-pressed={viewMode === "week"}
                  onClick={() => {
                    setViewMode("week");
                    setSelectedDate(null);
                    setBatchSelected(new Set());
                  }}
                >
                  周
                </button>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭内容日历">
                  <X size={16} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="calendar-toolbar">
            <button type="button" className="btn-icon" aria-label={viewMode === "month" ? "上个月" : "上一周"} onClick={goPrev}>
              <ChevronLeft size={15} aria-hidden />
            </button>
            <span className="calendar-month">
              {viewMode === "month"
                ? `${viewYear} 年 ${viewMonth} 月`
                : `${isoOf(weekDates(parseIsoDate(weekAnchor) ?? new Date())[0])} ~ ${isoOf(weekDates(parseIsoDate(weekAnchor) ?? new Date())[6])}`}
            </span>
            <button type="button" className="btn-icon" aria-label={viewMode === "month" ? "下个月" : "下一周"} onClick={goNext}>
              <ChevronRight size={15} aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={goToday}>
              今天
            </button>
          </div>

          {viewMode === "month" ? monthView : weekView}

          <div className="calendar-legend" aria-label="图例">
            <span className="legend-item"><span className="dot dot-draft" />草稿</span>
            <span className="legend-item"><span className="dot dot-task" />计划任务</span>
            <span className="legend-item"><span className="dot dot-queue" />发布队列</span>
            <span className="legend-item"><span className="dot dot-batch" />发布批次</span>
            <span className="legend-item"><span className="dot dot-publish" />发布</span>
            <span className="legend-item"><span className="dot dot-metric" />效果</span>
            {onNavigate && (
              <span className="legend-item legend-hint"><ExternalLink size={11} aria-hidden />点击事件跳转详情</span>
            )}
          </div>

          {/* v6 Phase 2:周/月视图批量操作 */}
          <div className="calendar-batch-ops">
            <div className="calendar-batch-head">
              <ListChecks size={14} aria-hidden />
              {viewMode === "month" ? `本月可改期事件（${reschedulableEvents.length}）` : `本周可改期事件（${reschedulableEvents.length}）`}
              {reschedulableEvents.length > 0 && (
                <span className="calendar-batch-actions">
                  <button type="button" className="btn-link-sm" onClick={selectAllVisible}>
                    全选
                  </button>
                  <button type="button" className="btn-link-sm" onClick={clearSelection}>
                    清空
                  </button>
                </span>
              )}
            </div>
            {reschedulableEvents.length === 0 ? (
              <div className="calendar-batch-empty">
                <Inbox size={14} aria-hidden />
                当前视图没有可改期的待发布事件(发布队列 / 发布批次 / 计划任务)
              </div>
            ) : (
              <>
                <div className="calendar-batch-list">
                  {reschedulableEvents.map((ev) => {
                    const key = `${ev.kind}:${ev.refId}`;
                    const checked = batchSelected.has(key);
                    const Icon = ev.reschedulable ? KIND_META[ev.kind].icon : FileText;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={checked ? "calendar-batch-item checked" : "calendar-batch-item"}
                        onClick={() => toggleBatchSelect(key)}
                        aria-pressed={checked}
                      >
                        {checked ? <CheckSquare size={13} aria-hidden /> : <Square size={13} aria-hidden />}
                        <Icon size={13} aria-hidden />
                        <span className="calendar-batch-item-title">{ev.title}</span>
                        <span className="calendar-batch-item-kind">{KIND_LABEL[ev.reschedulable ?? "task"]}</span>
                        {ev.platformId && (
                          <span
                            className="calendar-event-platform"
                            style={{ ["--chip-color" as string]: platformColor(ev.platformId) }}
                          >
                            {ev.platformId}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="calendar-batch-apply">
                  <input
                    type="date"
                    className="input"
                    value={batchTarget}
                    onChange={(e) => setBatchTarget(e.target.value)}
                    aria-label="批量改期目标日期"
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => void applyBatchReschedule()}
                    disabled={batchApplying || batchSelected.size === 0}
                  >
                    <Move size={12} aria-hidden />
                    批量改期到该日（{batchSelected.size}）
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="calendar-day-detail" aria-live="polite">
            {dragRef && (
              <div className="calendar-drag-hint">
                <Move size={13} aria-hidden />
                已选择{dragRef.kind === "task" ? "计划任务" : dragRef.kind === "queue" ? "发布队列条目" : "发布批次条目"},拖拽到目标日期改期(保留原时间)
              </div>
            )}
            {selectedDay && selectedDay.events.length === 0 && (
              <div className="calendar-day-empty">
                <Inbox size={16} aria-hidden />
                {selectedDay.date} 没有事件
              </div>
            )}
            {selectedDay && selectedDay.events.length > 0 && (
              <div className="calendar-event-list">
                <div className="calendar-event-date">{selectedDay.date}</div>
                {selectedDay.events.map((ev, i) => {
                  const meta = KIND_META[ev.kind];
                  const Icon = meta.icon;
                  const draggableKind = ev.reschedulable ?? null;
                  const isDragging = draggableKind !== null && dragRef?.kind === draggableKind && dragRef.refId === ev.refId;
                  return (
                    <div
                      key={`${ev.refId}-${i}`}
                      className={[
                        "calendar-event",
                        draggableKind ? "calendar-event-task" : "",
                        isDragging ? "dragging" : "",
                      ].filter(Boolean).join(" ")}
                      draggable={draggableKind !== null}
                      onDragStart={(e) => {
                        if (draggableKind) {
                          // jsdom 无 DataTransfer,guarded。
                          if (e.dataTransfer) {
                            e.dataTransfer.setData("text/plain", ev.refId);
                            e.dataTransfer.effectAllowed = "move";
                          }
                          setDragRef({ kind: draggableKind, refId: ev.refId });
                        }
                      }}
                      onDragEnd={() => setDragRef(null)}
                    >
                      <Icon size={14} className="calendar-event-icon" aria-hidden />
                      <div className="calendar-event-body">
                        <div className="calendar-event-title">
                          {ev.title}
                          {ev.platformId && (
                            <span
                              className="calendar-event-platform"
                              style={{ ["--chip-color" as string]: platformColor(ev.platformId) }}
                            >
                              {ev.platformId}
                            </span>
                          )}
                        </div>
                        <div className="calendar-event-note">
                          {meta.label}
                          {ev.note ? ` · ${ev.note}` : ""}
                        </div>
                      </div>
                      {onNavigate && (
                        <button
                          type="button"
                          className="calendar-event-open"
                          aria-label={`打开${meta.label}详情`}
                          title="打开详情"
                          onClick={() => handleEventClick(ev.kind, ev.refId)}
                        >
                          <ExternalLink size={12} aria-hidden />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
