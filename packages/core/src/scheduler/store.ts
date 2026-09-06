/**
 * FLOW-03 本机计划任务存储 —— 版本化、保留最近运行记录。
 *
 * 与 JOB-02 的 JobStore 同构:存储层只做"读写 + 版本化 + 保留清理",不掺调度逻辑。
 * 实现:
 * - `MemoryScheduledTaskStore`:测试/单进程内默认;
 * - 应用侧 IndexedDB / chrome.storage 可实现同样的接口(app/src/storage/schedule-store.ts)。
 */
import type { ScheduledTask, ScheduledTaskStore } from "./types.js";

/** 计划任务存储 schema 版本(升级需写迁移)。 */
export const SCHEDULE_SCHEMA_VERSION = 1;
/** 每个任务保留最近运行记录条数。 */
export const SCHEDULE_RUNS_MAX = 20;
/** 任务总数上限(防止本地存储无限增长)。 */
export const SCHEDULE_TASKS_MAX = 50;

/** 校验任务是否满足 schema(用于损坏/旧版本检测)。 */
export function assertScheduleSchema(task: unknown): task is ScheduledTask {
  if (typeof task !== "object" || task === null) return false;
  const t = task as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.draftId === "string" &&
    typeof t.status === "string" &&
    typeof t.createdAt === "string" &&
    typeof t.updatedAt === "string" &&
    typeof t.cron === "object" &&
    t.cron !== null
  );
}

/** 内存实现(默认/测试用)。 */
export class MemoryScheduledTaskStore implements ScheduledTaskStore {
  readonly schemaVersion = SCHEDULE_SCHEMA_VERSION;
  private readonly tasks = new Map<string, ScheduledTask>();

  async list(): Promise<readonly ScheduledTask[]> {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<ScheduledTask | undefined> {
    return this.tasks.get(id);
  }
  async put(task: ScheduledTask): Promise<void> {
    this.tasks.set(task.id, task);
  }
  async remove(id: string): Promise<void> {
    this.tasks.delete(id);
  }
}

/** 将执行记录追加到任务并裁剪到 SCHEDULE_RUNS_MAX 条(最近在前)。 */
export function appendRun(task: ScheduledTask, run: ScheduledTask["runs"][number]): ScheduledTask {
  const runs = [run, ...task.runs].slice(0, SCHEDULE_RUNS_MAX);
  return { ...task, runs, updatedAt: new Date().toISOString() };
}
