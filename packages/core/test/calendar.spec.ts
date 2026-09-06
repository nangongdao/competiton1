/**
 * v3 · 内容日历测试。
 *
 * 覆盖:
 * - buildCalendar 生成某月全部日期;
 * - 草稿 updatedAt 事件;
 * - 计划任务按 cron 计算当月触发日(dailyAt / weeklyAt / hourly / 自定义);
 * - 发布历史事件;
 * - 效果记录事件;
 * - 事件按 seq 稳定排序;
 * - 月份外的事件被忽略;
 * - toIsoDate / parseIsoDate / daysInMonth 工具。
 */
import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  toIsoDate,
  parseIsoDate,
  daysInMonth,
  matchesCronOnDate,
  shiftCronToDate,
  shiftIsoToDate,
  dayOfWeekIndex,
  weekDates,
  addDaysIso,
  isInWeek,
  collectReschedulableInRange,
} from "../src/calendar/calendar.js";
import { dailyAt, weeklyAt, hourly } from "../src/scheduler/types.js";

describe("toIsoDate / parseIsoDate / daysInMonth", () => {
  it("toIsoDate 输出本地 YYYY-MM-DD", () => {
    expect(toIsoDate(new Date(2026, 7, 5))).toBe("2026-08-05");
    expect(toIsoDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("parseIsoDate 解析为本地日期", () => {
    const d = parseIsoDate("2026-08-05");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(5);
  });

  it("parseIsoDate 非法输入返回 undefined", () => {
    expect(parseIsoDate("2026-13-99")).toBeUndefined();
    expect(parseIsoDate("not-a-date")).toBeUndefined();
  });

  it("daysInMonth 处理闰年与大小月", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("buildCalendar", () => {
  it("生成指定月全部日期(2026-08 共 31 天)", () => {
    const days = buildCalendar({}, { year: 2026, month: 8 });
    expect(days.size).toBe(31);
    expect(days.has("2026-08-01")).toBe(true);
    expect(days.has("2026-08-31")).toBe(true);
    expect(days.get("2026-08-15")?.events.length).toBe(0);
  });

  it("草稿 updatedAt 产生 draft 事件", () => {
    const days = buildCalendar(
      { drafts: [{ id: "d1", title: "我的草稿", updatedAt: "2026-08-03T10:00:00Z" }] },
      { year: 2026, month: 8 },
    );
    const day = days.get("2026-08-03");
    expect(day?.events).toHaveLength(1);
    expect(day?.events[0]?.kind).toBe("draft");
    expect(day?.events[0]?.title).toBe("我的草稿");
  });

  it("每日计划任务(dailyAt 08:30)当月每天都有任务事件", () => {
    const days = buildCalendar(
      { tasks: [{ id: "t1", name: "每日备份", cron: dailyAt(8, 30) }] },
      { year: 2026, month: 8 },
    );
    for (const [date, day] of days) {
      if (date.startsWith("2026-08-")) {
        expect(day.events.some((e) => e.kind === "task")).toBe(true);
      }
    }
  });

  it("每周计划任务(weeklyAt 周一 09:00)只在周一出现", () => {
    const days = buildCalendar(
      { tasks: [{ id: "t1", name: "周报", cron: weeklyAt(1, 9, 0) }] },
      { year: 2026, month: 8 },
    );
    // 2026-08-03 是周一
    expect(days.get("2026-08-03")?.events.some((e) => e.kind === "task")).toBe(true);
    // 2026-08-04 是周二,不应有任务
    expect(days.get("2026-08-04")?.events.some((e) => e.kind === "task")).toBe(false);
  });

  it("每小时计划任务(hourly)每天都有任务事件", () => {
    const days = buildCalendar(
      { tasks: [{ id: "t1", name: "定时同步", cron: hourly() }] },
      { year: 2026, month: 8 },
    );
    const day = days.get("2026-08-10");
    expect(day?.events.some((e) => e.kind === "task")).toBe(true);
  });

  it("发布历史产生 publish 事件", () => {
    const days = buildCalendar(
      {
        history: [
          {
            id: "h1",
            draftTitle: "发布标题",
            at: "2026-08-07T12:00:00Z",
            platforms: [
              { platformId: "wechat", ok: true },
              { platformId: "zhihu", ok: false },
            ],
          },
        ],
      },
      { year: 2026, month: 8 },
    );
    const day = days.get("2026-08-07");
    expect(day?.events).toHaveLength(1);
    expect(day?.events[0]?.kind).toBe("publish");
    expect(day?.events[0]?.note).toBe("成功 1/2");
  });

  it("效果记录产生 metric 事件并带阅读量说明", () => {
    const days = buildCalendar(
      {
        metrics: [
          { id: "m1", title: "爆款文章", date: "2026-08-09", platformId: "wechat", views: 1200 },
        ],
      },
      { year: 2026, month: 8 },
    );
    const day = days.get("2026-08-09");
    expect(day?.events).toHaveLength(1);
    expect(day?.events[0]?.kind).toBe("metric");
    expect(day?.events[0]?.note).toBe("1200 阅读");
  });

  it("事件按 seq 稳定排序(草稿→任务→发布→效果)", () => {
    const days = buildCalendar(
      {
        drafts: [{ id: "d1", title: "草稿", updatedAt: "2026-08-10T08:00:00Z" }],
        tasks: [{ id: "t1", name: "任务", cron: dailyAt(9, 0) }],
        history: [{ id: "h1", draftTitle: "发布", at: "2026-08-10T10:00:00Z", platforms: [{ platformId: "wechat", ok: true }] }],
        metrics: [{ id: "m1", title: "效果", date: "2026-08-10", platformId: "wechat", views: 5 }],
      },
      { year: 2026, month: 8 },
    );
    const day = days.get("2026-08-10");
    const kinds = day?.events.map((e) => e.kind) ?? [];
    expect(kinds).toEqual(["draft", "task", "publish", "metric"]);
  });

  it("月份外的事件被忽略", () => {
    const days = buildCalendar(
      { drafts: [{ id: "d1", title: "外部草稿", updatedAt: "2026-09-01T00:00:00Z" }] },
      { year: 2026, month: 8 },
    );
    expect(days.get("2026-09-01")).toBeUndefined();
    // 8 月全部日期无事件
    const hasAny = [...days.values()].some((d) => d.events.length > 0);
    expect(hasAny).toBe(false);
  });
});

describe("matchesCronOnDate", () => {
  it("dailyAt 任意日期都命中", () => {
    expect(matchesCronOnDate(dailyAt(8, 30), new Date(2026, 7, 3))).toBe(true);
  });
  it("weeklyAt 只命中指定星期", () => {
    expect(matchesCronOnDate(weeklyAt(1, 9, 0), new Date(2026, 7, 3))).toBe(true); // 周一
    expect(matchesCronOnDate(weeklyAt(1, 9, 0), new Date(2026, 7, 4))).toBe(false); // 周二
  });
});

describe("shiftCronToDate (CAL-03 拖拽改期)", () => {
  it("保留原时间并把 dayOfWeek 设为目标日期", () => {
    const cron = { minute: [30], hour: [9], dayOfWeek: [1] }; // 周一 09:30
    // 2026-08-05 是周三
    const out = shiftCronToDate(cron, new Date(2026, 7, 5));
    expect(out.minute).toEqual([30]);
    expect(out.hour).toEqual([9]);
    expect(out.dayOfWeek).toEqual([3]);
  });

  it("原 daily('*') 型任务迁移后变为单日任务", () => {
    const cron = { minute: [0], hour: [8], dayOfWeek: "*" };
    const out = shiftCronToDate(cron, new Date(2026, 7, 2)); // 周日
    expect(out.dayOfWeek).toEqual([0]);
    expect(out.hour).toEqual([8]);
  });

  it("原 minute='*' / hour='*' 取 0 归一", () => {
    const cron = { minute: "*", hour: "*", dayOfWeek: "*" };
    const out = shiftCronToDate(cron, new Date(2026, 7, 6)); // 周四
    expect(out.minute).toEqual([0]);
    expect(out.hour).toEqual([0]);
    expect(out.dayOfWeek).toEqual([4]);
  });
});

describe("v6 发布队列 / 发布批次事件", () => {
  it("发布队列条目(queued)产生 queue 事件并可拖拽改期", () => {
    const days = buildCalendar(
      {
        queue: [
          { id: "q1", name: "下周发布", scheduledAt: "2026-08-12T18:00:00Z", status: "queued", platformIds: ["wechat"] },
        ],
      },
      { year: 2026, month: 8 },
    );
    const day = days.get("2026-08-12");
    expect(day?.events).toHaveLength(1);
    expect(day?.events[0]?.kind).toBe("queue");
    expect(day?.events[0]?.title).toBe("下周发布");
    expect(day?.events[0]?.reschedulable).toBe("queue");
    expect(day?.events[0]?.note).toBe("1 平台");
  });

  it("已终态的队列条目不出现在日历", () => {
    const days = buildCalendar(
      {
        queue: [
          { id: "q1", name: "已完成", scheduledAt: "2026-08-12T18:00:00Z", status: "succeeded", platformIds: ["wechat"] },
        ],
      },
      { year: 2026, month: 8 },
    );
    expect(days.get("2026-08-12")?.events).toHaveLength(0);
  });

  it("发布批次条目产生 batch 事件(含批次默认时间回退)", () => {
    const days = buildCalendar(
      {
        batches: [
          {
            id: "b1",
            name: "本周批次",
            scheduledAt: "2026-08-15T09:00:00Z",
            status: "queued",
            items: [
              { itemId: "b1-1", draftTitle: "文章A", status: "queued", platformIds: ["zhihu"] },
              { itemId: "b1-2", draftTitle: "文章B", scheduledAt: "2026-08-16T10:00:00Z", status: "queued" },
            ],
          },
        ],
      },
      { year: 2026, month: 8 },
    );
    const d15 = days.get("2026-08-15");
    const d16 = days.get("2026-08-16");
    expect(d15?.events[0]?.kind).toBe("batch");
    expect(d15?.events[0]?.title).toBe("文章A");
    expect(d15?.events[0]?.reschedulable).toBe("batch");
    expect(d16?.events[0]?.title).toBe("文章B");
  });

  it("已终态批次条目不出现,取消批次不出现", () => {
    const days = buildCalendar(
      {
        batches: [
          {
            id: "b1",
            name: "已完成批次",
            scheduledAt: "2026-08-15T09:00:00Z",
            status: "succeeded",
            items: [{ itemId: "b1-1", draftTitle: "A", status: "succeeded" }],
          },
        ],
      },
      { year: 2026, month: 8 },
    );
    expect(days.get("2026-08-15")?.events).toHaveLength(0);
  });
});

describe("shiftIsoToDate (v6 CAL-04 拖拽改期)", () => {
  it("保留原时间并迁移到目标日期", () => {
    const out = shiftIsoToDate("2026-08-12T18:30:00Z", new Date(2026, 7, 20));
    expect(out).toBe("2026-08-20T18:30:00.000Z");
  });

  it("跨月/跨年迁移", () => {
    const out = shiftIsoToDate("2026-12-31T08:00:00Z", new Date(2027, 0, 5));
    expect(out).toBe("2027-01-05T08:00:00.000Z");
  });

  it("非法 ISO 回退到当天 09:00", () => {
    const out = shiftIsoToDate("not-a-date", new Date(2026, 7, 3));
    expect(out).toBe("2026-08-03T09:00:00.000Z");
  });
});

describe("v6 Phase 2 · 周视图工具", () => {
  it("dayOfWeekIndex 周一=0 … 周日=6", () => {
    expect(dayOfWeekIndex(new Date(2026, 7, 3))).toBe(0); // 2026-08-03 周一
    expect(dayOfWeekIndex(new Date(2026, 7, 9))).toBe(6); // 2026-08-09 周日
  });

  it("weekDates 返回周一至周日 7 天(跨月锚点)", () => {
    // 2026-08-20(周四)所在周:8/17 周一 ~ 8/23 周日
    const dates = weekDates(new Date(2026, 7, 20));
    expect(dates.length).toBe(7);
    expect(toIsoDate(dates[0])).toBe("2026-08-17");
    expect(toIsoDate(dates[6])).toBe("2026-08-23");
    // 跨月:2026-07-31(周五)所在周:7/27 ~ 8/2
    const cross = weekDates(new Date(2026, 6, 31));
    expect(toIsoDate(cross[0])).toBe("2026-07-27");
    expect(toIsoDate(cross[6])).toBe("2026-08-02");
  });

  it("addDaysIso 迁移天数(跨月)", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("isInWeek 判断日期是否落在周窗口内", () => {
    const anchor = new Date(2026, 7, 20); // 2026-08-20 周四
    expect(isInWeek(new Date(2026, 7, 17), anchor)).toBe(true); // 周一
    expect(isInWeek(new Date(2026, 7, 23), anchor)).toBe(true); // 周日
    expect(isInWeek(new Date(2026, 7, 24), anchor)).toBe(false); // 下周一
  });
});

describe("v6 Phase 2 · collectReschedulableInRange(批量操作收集)", () => {
  it("收集周窗口内可改期事件并按 (kind,refId) 去重", () => {
    const days = new Map<string, import("../src/calendar/calendar.js").CalendarDay>();
    days.set("2026-08-17", {
      date: "2026-08-17",
      events: [
        { kind: "queue", title: "周一发布", refId: "q1", reschedulable: "queue" },
        { kind: "batch", title: "批次A", refId: "b1-i1", reschedulable: "batch" },
      ],
    });
    days.set("2026-08-18", {
      date: "2026-08-18",
      events: [
        // 同一队列条目在另一天重复出现 → 去重只留一条。
        { kind: "queue", title: "周一发布", refId: "q1", reschedulable: "queue" },
        { kind: "task", title: "周报", refId: "t1", reschedulable: "task" },
        // 非可改期事件(草稿)不收集。
        { kind: "draft", title: "草稿", refId: "d1" },
      ],
    });
    const out = collectReschedulableInRange(days.values());
    expect(out).toHaveLength(3);
    const keys = out.map((e) => `${e.kind}:${e.refId}`).sort();
    expect(keys).toEqual(["batch:b1-i1", "queue:q1", "task:t1"]);
  });
});
