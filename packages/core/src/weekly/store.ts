/**
 * v4 Phase 2 · WEEKLY-01 内容智能周报 —— 存储(版本化)。
 *
 * 与 JOB-02 / FLOW-03 同构:存储层只做「读写 + 版本化 + 保留清理」,不掺业务。
 * 实现:
 * - `MemoryWeeklyStore`:测试/单进程默认;
 * - 应用侧 IndexedDB / chrome.storage 实现同接口(app/src/storage/weekly-store.ts)。
 */
import type { WeeklyReportJob, WeeklyReportRun, WeeklyReportStore } from "./types.js";

/** 周报任务存储 schema 版本(升级需写迁移)。 */
export const WEEKLY_SCHEMA_VERSION = 1;
/** 每个任务保留最近执行记录条数。 */
export const WEEKLY_RUNS_MAX = 20;
/** 周报任务总数上限(防止本地存储无限增长)。 */
export const WEEKLY_JOBS_MAX = 50;

/** 校验周报任务是否满足 schema(损坏/旧版本检测)。 */
export function assertWeeklySchema(job: unknown): job is WeeklyReportJob {
  if (typeof job !== "object" || job === null) return false;
  const j = job as Record<string, unknown>;
  return (
    typeof j.id === "string" &&
    typeof j.name === "string" &&
    typeof j.status === "string" &&
    typeof j.createdAt === "string" &&
    typeof j.updatedAt === "string" &&
    typeof j.template === "string"
  );
}

/** 内存实现(默认/测试用)。 */
export class MemoryWeeklyStore implements WeeklyReportStore {
  readonly schemaVersion = WEEKLY_SCHEMA_VERSION;
  private readonly jobs = new Map<string, WeeklyReportJob>();

  async list(): Promise<readonly WeeklyReportJob[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<WeeklyReportJob | undefined> {
    return this.jobs.get(id);
  }
  async put(job: WeeklyReportJob): Promise<void> {
    this.jobs.set(job.id, job);
  }
  async remove(id: string): Promise<void> {
    this.jobs.delete(id);
  }
}

/** 将执行记录追加到任务并裁剪到 WEEKLY_RUNS_MAX 条(最近在前)。 */
export function appendWeeklyRun(job: WeeklyReportJob, run: WeeklyReportRun): WeeklyReportJob {
  const runs = [run, ...job.runs].slice(0, WEEKLY_RUNS_MAX);
  return { ...job, runs, updatedAt: new Date().toISOString() };
}
