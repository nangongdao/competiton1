/**
 * v3 · 内容日历 —— 把草稿 / 计划任务 / 发布历史 / 效果数据聚合到月历视图。
 *
 * 数据来源(均为本地已有数据):
 * - 草稿(Draft):updatedAt → 日历上标记"有草稿更新";
 * - 计划任务(ScheduledTask):cron 表达式 → 计算出当月各触发日(枚举到点日);
 * - 发布历史(HistoryEntry):at → 标记当日发布了哪些平台;
 * - 效果记录(PerformanceRecord):date → 标记当日效果数据。
 * - 发布队列(PublishQueueEntry):scheduledAt → 标记"稍后发布"事件(v6);
 * - 发布批次(PublishBatchItem):scheduledAt → 标记"批次发布"事件(v6)。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;日历格子渲染由 UI 负责,core 只提供"某月每日的事件聚合";
 * - cron 子集枚举:支持 每周/每日/每小时/自定义 的月度触发日计算;
 * - 输出按日期分组的轻量事件,供 UI 直接渲染。
 */
import type { CronExpression } from "../scheduler/types.js";
import { matchesCron } from "../scheduler/types.js";

/** 日历事件类型。 */
export type CalendarEventKind = "draft" | "task" | "publish" | "metric" | "queue" | "batch";

/** 日历事件可拖拽改期的来源。 */
export type CalendarReschedulable = "queue" | "batch" | "task";

/** 单个日历事件(轻量,不含敏感信息)。 */
export interface CalendarEvent {
  readonly kind: CalendarEventKind;
  /** 事件标题(如草稿标题 / 任务名 / 发布标题)。 */
  readonly title: string;
  /** 关联 id(草稿 id / 任务 id / 历史 id / 记录 id)。 */
  readonly refId: string;
  /** 关联平台(可为空)。 */
  readonly platformId?: string;
  /** 当日序号(0-6,可选,用于排序展示)。 */
  readonly seq?: number;
  /** 补充说明(如发布结果 / 指标数值)。 */
  readonly note?: string;
  /** v6:事件来源是否可拖拽改期(queue/batch/task)。 */
  readonly reschedulable?: CalendarReschedulable;
}

/** 某一天的日历条目。 */
export interface CalendarDay {
  /** ISO 日期(YYYY-MM-DD)。 */
  readonly date: string;
  readonly events: readonly CalendarEvent[];
}

/** 构建中的可变 day(内部使用)。 */
interface MutableDay {
  readonly date: string;
  events: CalendarEvent[];
}

export interface CalendarInput {
  /** 草稿列表(取 updatedAt)。 */
  readonly drafts?: readonly { id: string; title: string; updatedAt: string }[];
  /** 计划任务列表(取 cron 计算当月触发日)。 */
  readonly tasks?: readonly { id: string; name: string; cron: CronExpression }[];
  /** 发布历史(取 at)。 */
  readonly history?: readonly { id: string; draftTitle: string; at: string; platforms: readonly { platformId: string; ok: boolean }[] }[];
  /** 效果记录(取 date)。 */
  readonly metrics?: readonly { id: string; title: string; date: string; platformId: string; views?: number }[];
  /** v6:发布队列条目(取 scheduledAt,只纳入 queued/running 待发布)。 */
  readonly queue?: readonly { id: string; name: string; scheduledAt: string; status: string; platformIds?: readonly string[] }[];
  /** v6:发布批次条目(取 scheduledAt,只纳入 queued/running 待发布)。 */
  readonly batches?: readonly {
    readonly id: string;
    readonly name: string;
    readonly scheduledAt?: string;
    readonly status: string;
    readonly items?: readonly {
      readonly itemId: string;
      readonly draftTitle: string;
      readonly scheduledAt?: string;
      readonly status: string;
      readonly platformIds?: readonly string[];
    }[];
  }[];
}

export interface BuildCalendarOptions {
  /** 目标年月(默认当月)。 */
  readonly year?: number;
  readonly month?: number; // 1-12
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 把 Date 转成本地 ISO 日期(YYYY-MM-DD)。 */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 解析 ISO 日期字符串(YYYY-MM-DD)为本地 Date(不丢时区);非法/越界返回 undefined。 */
export function parseIsoDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  return new Date(year, month - 1, day);
}

/** 计算某月的天数。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 判断某日是否满足 cron 表达式(按当日 00:00 计算触发日)。 */
export function matchesCronOnDate(cron: CronExpression, date: Date): boolean {
  // 当日 00:00 是否命中 cron:只关心日期级(周几)匹配,分钟/小时视为命中。
  const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const cronAt: CronExpression = {
    minute: cron.minute === "*" ? "*" : [0],
    hour: cron.hour === "*" ? "*" : [0],
    dayOfWeek: cron.dayOfWeek,
  };
  return matchesCron(cronAt, at);
}

/**
 * 计算某日的 ISO 日期(YYYY-MM-DD)对应的星期偏移(周一=0 … 周日=6)。
 */
export function dayOfWeekIndex(d: Date): number {
  return (d.getDay() + 6) % 7; // 周一=0
}

/**
 * 返回包含指定日期的「周」(周一 00:00 起)的 7 个日期(本地时区,仅日期部分)。
 * 用于周视图渲染:与月视图同一套 buildCalendar 聚合,按周窗口过滤。
 */
export function weekDates(date: Date): Date[] {
  const anchor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = dayOfWeekIndex(anchor);
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - mondayOffset);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  }
  return out;
}

/** 把 ISO 日期(YYYY-MM-DD)迁移指定天数,返回新 ISO(仅日期部分)。 */
export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** 判断一个日期是否落在给定的周窗口(周一起)内。 */
export function isInWeek(date: Date, anchor: Date): boolean {
  const week = weekDates(anchor);
  const first = week[0];
  const last = week[6];
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return d.getTime() >= first.getTime() && d.getTime() <= last.getTime();
}

/**
 * 构建某月每日的日历事件聚合。
 * 返回一个 Map:date(YYYY-MM-DD) → CalendarDay。
 */
export function buildCalendar(input: CalendarInput, options: BuildCalendarOptions = {}): Map<string, CalendarDay> {
  const now = options.now ? new Date(options.now()) : new Date();
  const year = options.year ?? now.getFullYear();
  const month = options.month ?? now.getMonth() + 1;
  const totalDays = daysInMonth(year, month);

  const days = new Map<string, MutableDay>();
  for (let d = 1; d <= totalDays; d++) {
    const date = toIsoDate(new Date(year, month - 1, d));
    days.set(date, { date, events: [] });
  }

  const push = (dateIso: string, ev: CalendarEvent) => {
    const day = days.get(dateIso);
    if (!day) return; // 不在本月内则忽略
    day.events.push(ev);
  };

  // 1) 草稿更新
  for (const d of input.drafts ?? []) {
    const dateIso = d.updatedAt.slice(0, 10);
    if (days.has(dateIso)) push(dateIso, { kind: "draft", title: d.title || "未命名草稿", refId: d.id, seq: 0 });
  }

  // 2) 计划任务触发日(枚举当月每一天,命中 cron 则标记)
  for (const t of input.tasks ?? []) {
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(year, month - 1, d);
      if (matchesCronOnDate(t.cron, date)) {
        const dateIso = toIsoDate(date);
        push(dateIso, { kind: "task", title: t.name || "计划任务", refId: t.id, seq: 1, reschedulable: "task" });
      }
    }
  }

  // 3) 发布历史
  for (const h of input.history ?? []) {
    const dateIso = h.at.slice(0, 10);
    if (!days.has(dateIso)) continue;
    const okCount = h.platforms.filter((p) => p.ok).length;
    const note = okCount === h.platforms.length ? `发布 ${h.platforms.length} 平台` : `成功 ${okCount}/${h.platforms.length}`;
    push(dateIso, { kind: "publish", title: h.draftTitle || "发布", refId: h.id, note, seq: 2 });
  }

  // 4) 效果记录
  for (const m of input.metrics ?? []) {
    const dateIso = m.date.slice(0, 10);
    if (!days.has(dateIso)) continue;
    const note = m.views !== undefined ? `${m.views} 阅读` : undefined;
    push(dateIso, {
      kind: "metric",
      title: m.title || "效果数据",
      refId: m.id,
      platformId: m.platformId,
      note,
      seq: 3,
    });
  }

  // 5) v6:发布队列(待发布条目,queued/running 才展示,可拖拽改期)
  for (const q of input.queue ?? []) {
    if (q.status !== "queued" && q.status !== "running") continue;
    const dateIso = q.scheduledAt.slice(0, 10);
    if (!days.has(dateIso)) continue;
    const note = q.platformIds && q.platformIds.length > 0 ? `${q.platformIds.length} 平台` : "待发布";
    push(dateIso, {
      kind: "queue",
      title: q.name || "发布队列",
      refId: q.id,
      platformId: q.platformIds?.[0],
      note,
      seq: 1,
      reschedulable: "queue",
    });
  }

  // 6) v6:发布批次条目(待发布条目,queued/running 才展示,可拖拽改期)
  for (const b of input.batches ?? []) {
    for (const item of b.items ?? []) {
      if (item.status !== "queued" && item.status !== "running") continue;
      const scheduledAt = item.scheduledAt ?? b.scheduledAt;
      if (!scheduledAt) continue;
      const dateIso = scheduledAt.slice(0, 10);
      if (!days.has(dateIso)) continue;
      const note = item.platformIds && item.platformIds.length > 0 ? `${item.platformIds.length} 平台` : "批次待发布";
      push(dateIso, {
        kind: "batch",
        title: item.draftTitle || b.name || "发布批次",
        refId: item.itemId,
        platformId: item.platformIds?.[0],
        note,
        seq: 1,
        reschedulable: "batch",
      });
    }
  }

  // 按 seq 稳定排序
  const out = new Map<string, CalendarDay>();
  for (const day of days.values()) {
    out.set(day.date, { date: day.date, events: [...day.events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)) });
  }
  return out;
}

/**
 * v6 CAL-04 —— 把 ISO 时间迁移到指定日期(发布队列/批次条目拖拽改期)。
 *
 * 语义:
 * - 保留原小时与分钟(拖拽只改"哪天",不改时间);
 * - 若原 ISO 缺省(不含时间),则用当天 09:00 作为默认时间;
 * - 返回新 ISO(UTC)。
 */
export function shiftIsoToDate(iso: string, date: Date): string {
  const original = new Date(iso);
  const hour = Number.isFinite(original.getTime()) ? original.getUTCHours() : 9;
  const minute = Number.isFinite(original.getTime()) ? original.getUTCMinutes() : 0;
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0));
  return target.toISOString();
}

/**
 * CAL-03 —— 把 cron 表达式迁移到指定日期(日历拖拽改期)。
 *
 * 语义:
 * - 保留原小时与分钟(拖拽只改"哪天",不改时间);
 * - 目标日期决定 dayOfWeek(周几),小时/分钟继承原任务;
 * - 若原任务是"每天/每小时"型(dayOfWeek='*'),迁移后仍为对应日期的单次任务:
 *   dayOfWeek 设为目标日期的星期,minute/hour 保留原值(如原为 '*' 则取 0)。
 */
export function shiftCronToDate(cron: CronExpression, date: Date): CronExpression {
  const minute = cron.minute === "*" ? [0] : [...cron.minute];
  const hour = cron.hour === "*" ? [0] : [...cron.hour];
  const dayOfWeek = [date.getDay()];
  return { minute, hour, dayOfWeek };
}

/**
 * v6 Phase 2 · 批量操作 —— 收集一段日期(周/月视图)内所有可拖拽改期事件。
 *
 * 用于「日历周/月视图批量操作」:把当前视图(周窗口或月窗口)内所有
 * queue / batch / task 待发布事件集中列出,供用户勾选后统一改期。
 * 按 (kind,refId) 去重(同一事件在多天重复出现时只保留一条)。
 */
export function collectReschedulableInRange(days: Iterable<CalendarDay>): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    for (const ev of day.events) {
      if (!ev.reschedulable) continue;
      const key = `${ev.kind}:${ev.refId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ev);
    }
  }
  return out;
}
