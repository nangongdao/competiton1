import { describe, expect, it } from "vitest";
import { ScheduledTaskService } from "../src/scheduler/service.js";
import { MemoryScheduledTaskStore } from "../src/scheduler/store.js";
import {
  dailyAt,
  weeklyAt,
  hourly,
  isValidCron,
  matchesCron,
  type ScheduledTask,
  type ScheduledTaskRunner,
} from "../src/scheduler/types.js";

function fakeNow(): string {
  return "2026-08-05T08:00:00.000Z";
}

function runnerOf(calls: string[]): ScheduledTaskRunner {
  return {
    async run(task: ScheduledTask) {
      calls.push(task.id);
      return { ok: true, summary: `executed ${task.id}` };
    },
  };
}

describe("FLOW-03 计划任务", () => {
  it("cron 表达式校验", () => {
    expect(isValidCron({ minute: [0], hour: [9], dayOfWeek: "*" })).toBe(true);
    expect(isValidCron({ minute: "*", hour: "*", dayOfWeek: "*" })).toBe(true);
    expect(isValidCron({ minute: [60], hour: [9], dayOfWeek: "*" })).toBe(false);
    expect(isValidCron({ minute: [0], hour: [24], dayOfWeek: "*" })).toBe(false);
    expect(isValidCron({ minute: [0], hour: [9], dayOfWeek: [7] })).toBe(false);
  });

  it("matchesCron 按本地时区判断", () => {
    const at = new Date(2026, 7, 5, 9, 30, 0); // 2026-08-05 09:30 本地
    expect(matchesCron(dailyAt(9, 30), at)).toBe(true);
    expect(matchesCron(dailyAt(9, 0), at)).toBe(false);
    expect(matchesCron(hourly(), at)).toBe(false); // 30 分不匹配整点
    const atHour = new Date(2026, 7, 5, 10, 0, 0);
    expect(matchesCron(hourly(), atHour)).toBe(true);
    // 星期:2026-08-05 是周三(getDay()=3)
    expect(matchesCron(weeklyAt(3, 9, 30), at)).toBe(true);
    expect(matchesCron(weeklyAt(1, 9, 30), at)).toBe(false);
  });

  it("create 校验输入并落库 enabled", async () => {
    const store = new MemoryScheduledTaskStore();
    const service = new ScheduledTaskService({ store, now: fakeNow });
    const task = await service.create({
      name: "每日早报校验",
      cron: dailyAt(9, 0),
      action: { kind: "validate-generate" },
      platformIds: ["wechat", "zhihu"],
      draftId: "draft-1",
    });
    expect(task.status).toBe("enabled");
    expect(task.runs).toEqual([]);
    expect(isValidCron(task.cron)).toBe(true);
    expect((await service.list()).length).toBe(1);

    await expect(
      service.create({ name: "", cron: dailyAt(9, 0), action: { kind: "validate-generate" }, platformIds: [], draftId: "d" }),
    ).rejects.toThrow("名称不能为空");
    await expect(
      service.create({ name: "x", cron: { minute: [99], hour: [0], dayOfWeek: "*" }, action: { kind: "validate-generate" }, platformIds: [], draftId: "d" }),
    ).rejects.toThrow("计划表达式无效");
  });

  it("dueTasks 只返回 toggled 的 enabled 任务;runDue 去重窗口内不重复", async () => {
    const store = new MemoryScheduledTaskStore();
    const service = new ScheduledTaskService({ store, now: fakeNow, runner: runnerOf([]) });
    const t1 = await service.create({
      name: "每天9点",
      cron: dailyAt(9, 0),
      action: { kind: "validate-generate" },
      platformIds: [],
      draftId: "d1",
    });
    await service.create({
      name: "每天10点",
      cron: dailyAt(10, 0),
      action: { kind: "validate-generate" },
      platformIds: [],
      draftId: "d2",
    });
    // 9 点整:t1 到期,t2 未到期
    const due9 = await service.dueTasks(new Date(2026, 7, 5, 9, 0, 0));
    expect(due9.map((t) => t.id)).toEqual([t1.id]);
    // runDue 执行后,同窗口内再次 runDue 不重复
    const s1 = await service.runDue(new Date(2026, 7, 5, 9, 0, 0));
    expect(s1).toHaveLength(1);
    const s2 = await service.runDue(new Date(2026, 7, 5, 9, 0, 30));
    expect(s2).toEqual([]);
  });

  it("runDue 执行到期任务并记录运行历史", async () => {
    const store = new MemoryScheduledTaskStore();
    const calls: string[] = [];
    const service = new ScheduledTaskService({ store, now: fakeNow, runner: runnerOf(calls) });
    const t1 = await service.create({
      name: "每天9点",
      cron: dailyAt(9, 0),
      action: { kind: "validate-generate" },
      platformIds: [],
      draftId: "d1",
    });
    const summaries = await service.runDue(new Date(2026, 7, 5, 9, 0, 0));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.ok).toBe(true);
    expect(calls).toEqual([t1.id]);

    const task = await service.get(t1.id);
    expect(task?.runs).toHaveLength(1);
    expect(task?.runs[0]?.outcome).toBe("succeeded");
    expect(task?.runs[0]?.batchSummary).toBe(`executed ${t1.id}`);
  });

  it("runDue 无执行器时跳过不假装成功", async () => {
    const store = new MemoryScheduledTaskStore();
    const service = new ScheduledTaskService({ store, now: fakeNow });
    const t1 = await service.create({
      name: "无执行器",
      cron: dailyAt(9, 0),
      action: { kind: "validate-generate" },
      platformIds: [],
      draftId: "d1",
    });
    const summaries = await service.runDue(new Date(2026, 7, 5, 9, 0, 0));
    expect(summaries[0]!.ok).toBe(false);
    expect(summaries[0]!.skipped).toBe(true);
    const task = await service.get(t1.id);
    expect(task?.runs[0]?.outcome).toBe("skipped");
  });

  it("执行失败记录 failed 且不中断后续任务", async () => {
    const store = new MemoryScheduledTaskStore();
    const runner: ScheduledTaskRunner = {
      async run(task) {
        if (task.id === "bad") return { ok: false, error: "模拟失败" };
        return { ok: true, summary: "ok" };
      },
    };
    const service = new ScheduledTaskService({ store, now: fakeNow, runner });
    await service.create({ id: "bad", name: "坏任务", cron: dailyAt(9, 0), action: { kind: "validate-generate" }, platformIds: [], draftId: "d" });
    await service.create({ id: "good", name: "好任务", cron: dailyAt(9, 0), action: { kind: "validate-generate" }, platformIds: [], draftId: "d" });
    const summaries = await service.runDue(new Date(2026, 7, 5, 9, 0, 0));
    const bad = summaries.find((s) => s.taskId === "bad");
    const good = summaries.find((s) => s.taskId === "good");
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toBe("模拟失败");
    expect(good?.ok).toBe(true);
    const badTask = await service.get("bad");
    expect(badTask?.runs[0]?.outcome).toBe("failed");
  });

  it("pause/resume/remove 状态迁移", async () => {
    const store = new MemoryScheduledTaskStore();
    const service = new ScheduledTaskService({ store, now: fakeNow, runner: runnerOf([]) });
    const task = await service.create({
      name: "t",
      cron: dailyAt(9, 0),
      action: { kind: "validate-generate" },
      platformIds: [],
      draftId: "d",
    });
    const paused = await service.pause(task.id);
    expect(paused.status).toBe("paused");
    // 暂停后不再到期
    const due = await service.dueTasks(new Date(2026, 7, 5, 9, 0, 0));
    expect(due).toEqual([]);
    const resumed = await service.resume(task.id);
    expect(resumed.status).toBe("enabled");
    await service.remove(task.id);
    const removed = await service.get(task.id);
    expect(removed?.status).toBe("removed");
  });


  it("inbox-auto-reply 动作可被创建并执行", async () => {
    const store = new MemoryScheduledTaskStore();
    const calls: string[] = [];
    const service = new ScheduledTaskService({ store, now: fakeNow, runner: runnerOf(calls) });
    const t = await service.create({
      name: "每小时自动回复",
      cron: hourly(),
      action: { kind: "inbox-auto-reply" },
      platformIds: ["wechat", "xiaohongshu"],
      draftId: "",
    });
    expect(t.action.kind).toBe("inbox-auto-reply");
    const summaries = await service.runDue(new Date(2026, 7, 5, 9, 0, 0));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.ok).toBe(true);
    const task = await service.get(t.id);
    expect(task?.runs[0]?.outcome).toBe("succeeded");
  });
  it("trigger 手动触发忽略 cron", async () => {
    const store = new MemoryScheduledTaskStore();
    const calls: string[] = [];
    const service = new ScheduledTaskService({ store, now: fakeNow, runner: runnerOf(calls) });
    const task = await service.create({
      name: "t",
      cron: dailyAt(23, 59),
      action: { kind: "validate-generate" },
      platformIds: [],
      draftId: "d",
    });
    const result = await service.trigger(task.id);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([task.id]);
    // 非 enabled 任务手动触发被拒绝
    await service.pause(task.id);
    const r2 = await service.trigger(task.id);
    expect(r2.skipped).toBe(true);
  });
});
