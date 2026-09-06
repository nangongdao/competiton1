/**
 * FLOW-03 本机计划任务服务 —— 调度与执行。
 *
 * 职责:
 * - `create/update/pause/resume/remove`:任务生命周期管理(状态机守卫);
 * - `dueTasks(now)`:找出到点应执行的任务(按 cron 与上次执行时间判断,防重复触发);
 * - `runDue`:执行所有到期任务,记录执行结果;
 * - 明确的在线约束:机器与登录态必须在线(执行由注入的 runner 完成,失败不假装成功)。
 *
 * 纯 TS、零 DOM;app/桌面端注入 ScheduledTaskRunner(读取草稿 → 批量校验/生成或创建 PublishJob)。
 */
import type { ScheduledTask, ScheduledTaskRunner, ScheduledTaskStatus, ScheduledAction, WeeklyReportActionConfig } from "./types.js";
import { matchesCron } from "./types.js";
import { MemoryScheduledTaskStore, SCHEDULE_TASKS_MAX, appendRun } from "./store.js";
import type { ScheduledTaskStore } from "./types.js";
import { isValidCron } from "./types.js";

export interface ScheduledTaskServiceOptions {
  readonly store?: ScheduledTaskStore;
  readonly now?: () => string;
  /** 防重复触发窗口(ms):同一任务在窗口内不重复执行。默认 60s。 */
  readonly dedupeWindowMs?: number;
}

export interface CreateScheduledTaskInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly cron: ScheduledTask["cron"];
  readonly action: ScheduledAction;
  readonly platformIds: readonly string[];
  readonly draftId: string;
  /** 周报动作配置(可选)。 */
  readonly weeklyReport?: WeeklyReportActionConfig;
}

/** 执行结果汇总。 */
export interface RunSummary {
  readonly taskId: string;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly error?: string;
}

export class ScheduledTaskService {
  private readonly store: ScheduledTaskStore;
  private readonly now: () => string;
  private readonly dedupeWindowMs: number;
  private readonly runner: ScheduledTaskRunner | null;
  /** 上次触发时间索引:taskId → ISO(防同一分钟重复触发)。 */
  private readonly lastTriggered = new Map<string, string>();

  constructor(options: ScheduledTaskServiceOptions & { runner?: ScheduledTaskRunner | null } = {}) {
    this.store = options.store ?? new MemoryScheduledTaskStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.dedupeWindowMs = options.dedupeWindowMs ?? 60_000;
    this.runner = options.runner ?? null;
  }

  get schemaVersion(): number {
    return this.store.schemaVersion ?? 1;
  }

  async list(): Promise<readonly ScheduledTask[]> {
    return this.store.list();
  }

  async get(id: string): Promise<ScheduledTask | undefined> {
    return this.store.get(id);
  }

  /** 创建计划任务(状态 enabled)。 */
  async create(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    if (!input.name.trim()) throw new Error("计划任务名称不能为空");
    if (!isValidCron(input.cron)) throw new Error("计划表达式无效");
    const existing = await this.store.list();
    if (existing.length >= SCHEDULE_TASKS_MAX) {
      throw new Error(`计划任务数量已达上限(${SCHEDULE_TASKS_MAX})`);
    }
    const ts = this.now();
    const task: ScheduledTask = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description,
      cron: input.cron,
      action: input.action,
      weeklyReport: input.weeklyReport,
      platformIds: [...input.platformIds],
      draftId: input.draftId,
      status: "enabled",
      runs: [],
      createdAt: ts,
      updatedAt: ts,
    };
    await this.store.put(task);
    return task;
  }

  /** 更新任务的可变字段(名称/描述/表达式/动作/平台/草稿)。 */
  async update(
    id: string,
    patch: Partial<Pick<ScheduledTask, "name" | "description" | "cron" | "action" | "platformIds" | "draftId" | "weeklyReport">>,
  ): Promise<ScheduledTask> {
    const task = await this.requireTask(id);
    if (task.status === "removed") throw new Error("任务已删除");
    if (patch.cron !== undefined && !isValidCron(patch.cron)) throw new Error("计划表达式无效");
    const next: ScheduledTask = {
      ...task,
      ...patch,
      platformIds: patch.platformIds ? [...patch.platformIds] : task.platformIds,
      updatedAt: this.now(),
    };
    await this.store.put(next);
    return next;
  }

  /** 暂停(enabled → paused)。 */
  async pause(id: string): Promise<ScheduledTask> {
    return this.setStatus(id, "paused");
  }

  /** 恢复(paused → enabled)。 */
  async resume(id: string): Promise<ScheduledTask> {
    return this.setStatus(id, "enabled");
  }

  /** 删除(标记 removed,保留记录可追溯)。 */
  async remove(id: string): Promise<void> {
    const task = await this.requireTask(id);
    const next: ScheduledTask = { ...task, status: "removed", updatedAt: this.now() };
    await this.store.put(next);
  }

  /**
   * 找出到点应执行的任务(enabled 且匹配 cron 且不在去重窗口内)。
   * 供调度器 tick 调用;返回的任务由调用方决定执行(runDue 或自行执行)。
   */
  async dueTasks(now: Date = new Date()): Promise<readonly ScheduledTask[]> {
    const all = await this.store.list();
    const due: ScheduledTask[] = [];
    for (const task of all) {
      if (task.status !== "enabled") continue;
      if (!matchesCron(task.cron, now)) continue;
      const last = this.lastTriggered.get(task.id);
      if (last && now.getTime() - Date.parse(last) < this.dedupeWindowMs) continue;
      // 距离上次执行记录不足 1 分钟也跳过(防止存储里旧记录造成的重复)。
      const lastRun = task.runs[0];
      if (lastRun && now.getTime() - Date.parse(lastRun.scheduledAt) < this.dedupeWindowMs) continue;
      due.push(task);
    }
    return due;
  }

  /** 执行所有到期任务。返回逐任务结果。 */
  async runDue(now: Date = new Date()): Promise<readonly RunSummary[]> {
    const due = await this.dueTasks(now);
    const summaries: RunSummary[] = [];
    for (const task of due) {
      this.lastTriggered.set(task.id, now.toISOString());
      summaries.push(await this.runTask(task, now));
    }
    return summaries;
  }

  /** 手动触发一次指定任务(忽略 cron 与去重窗口)。 */
  async trigger(id: string): Promise<RunSummary> {
    const task = await this.requireTask(id);
    if (task.status !== "enabled") {
      return { taskId: id, ok: false, skipped: true, error: "任务未启用" };
    }
    this.lastTriggered.set(id, this.now());
    return this.runTask(task, new Date());
  }

  /** 执行单个任务(记录运行历史)。 */
  private async runTask(task: ScheduledTask, at: Date): Promise<RunSummary> {
    if (!this.runner) {
      // 未注入执行器:记录 skipped,不假装成功。
      await this.recordRun(task, {
        seq: task.runs.length + 1,
        scheduledAt: at.toISOString(),
        endedAt: this.now(),
        outcome: "skipped",
        error: "未注入任务执行器",
      });
      return { taskId: task.id, ok: false, skipped: true, error: "未注入任务执行器" };
    }
    const seq = task.runs.length + 1;
    try {
      const result = await this.runner.run(task);
      await this.recordRun(task, {
        seq,
        scheduledAt: at.toISOString(),
        endedAt: this.now(),
        outcome: result.ok ? "succeeded" : "failed",
        error: result.error,
        jobId: result.jobId,
        batchSummary: result.summary,
      });
      return { taskId: task.id, ok: result.ok, skipped: false, error: result.error };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordRun(task, {
        seq,
        scheduledAt: at.toISOString(),
        endedAt: this.now(),
        outcome: "failed",
        error: message,
      });
      return { taskId: task.id, ok: false, skipped: false, error: message };
    }
  }

  private async recordRun(task: ScheduledTask, run: ScheduledTask["runs"][number]): Promise<void> {
    const updated = appendRun(task, run);
    await this.store.put(updated);
  }

  private async setStatus(id: string, status: ScheduledTaskStatus): Promise<ScheduledTask> {
    const task = await this.requireTask(id);
    if (task.status === "removed") throw new Error("任务已删除");
    const next: ScheduledTask = { ...task, status, updatedAt: this.now() };
    await this.store.put(next);
    return next;
  }

  private async requireTask(id: string): Promise<ScheduledTask> {
    const task = await this.store.get(id);
    if (!task) throw new Error(`计划任务不存在: ${id}`);
    return task;
  }
}

/** 判断任务当前是否应执行(供 UI 显示状态)。 */
export function isScheduledTaskActive(task: ScheduledTask): boolean {
  return task.status === "enabled";
}

export { matchesCron, isValidCron };
