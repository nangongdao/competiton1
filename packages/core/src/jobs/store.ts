/**
 * 发布任务存储(JOB-02) —— 版本化、可恢复、带保留策略。
 *
 * 存储层只做"读写 + 版本化 + 保留清理",不掺业务编排(在 service.ts)。
 * 实现:
 * - `MemoryJobStore`:测试/单进程内默认;
 * - 应用侧 IndexedDB / chrome.storage(见 app/src/storage/job-store.ts);
 * - server 侧文件存储(原子写,见 server 包)可实现同样的接口。
 */
import type { PublishJob } from "./types.js";

/** 任务存储 schema 版本(升级需写迁移)。 */
export const JOB_SCHEMA_VERSION = 1;

/** 保留策略:终态任务最多保留条数。 */
export const JOB_RETENTION_MAX = 100;
/** 保留策略:终态任务保留时长(ms),默认 30 天。 */
export const JOB_RETENTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 是否终态(存储层用于保留清理)。 */
export function isTerminalJob(job: PublishJob): boolean {
  const stage = job.stage;
  return (
    stage === "succeeded" ||
    stage === "failed" ||
    stage === "unknown" ||
    stage === "cancelled"
  );
}

export interface JobStore {
  readonly schemaVersion: number;
  list(): Promise<PublishJob[]>;
  get(id: string): Promise<PublishJob | undefined>;
  put(job: PublishJob): Promise<void>;
  remove(id: string): Promise<void>;
  /** 删除超过保留策略的旧终态任务,返回清理条数。 */
  prune(now?: number): Promise<number>;
}

/** 内存实现(默认/测试用)。 */
export class MemoryJobStore implements JobStore {
  readonly schemaVersion = JOB_SCHEMA_VERSION;
  private readonly jobs = new Map<string, PublishJob>();

  async list(): Promise<PublishJob[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishJob | undefined> {
    return this.jobs.get(id);
  }
  async put(job: PublishJob): Promise<void> {
    this.jobs.set(job.id, job);
  }
  async remove(id: string): Promise<void> {
    this.jobs.delete(id);
  }
  async prune(now: number = Date.now()): Promise<number> {
    const all = [...this.jobs.values()];
    const terminal = all.filter((j) => isTerminalJob(j));

    const expired = terminal.filter((j) => now - Date.parse(j.updatedAt) > JOB_RETENTION_TTL_MS);
    // 保留最新 JOB_RETENTION_MAX 条终态(即使未过期也清理,防止无限增长)。
    const keep = terminal
      .filter((j) => !expired.includes(j))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, JOB_RETENTION_MAX);

    const kept = new Set(keep.map((j) => j.id));
    const expiredSet = new Set(expired.map((j) => j.id));
    const removed = new Set<string>();
    for (const j of terminal) {
      if (expiredSet.has(j.id) || !kept.has(j.id)) removed.add(j.id);
    }
    for (const j of all) {
      if (removed.has(j.id)) this.jobs.delete(j.id);
    }
    return removed.size;
  }
}

/** 新建/更新任务并记录 updatedAt(存储层便捷封装)。 */
export function withUpdatedAt(job: PublishJob, now: () => string = () => new Date().toISOString()): PublishJob {
  return { ...job, updatedAt: now() };
}

/** 从已有任务恢复(只保留非终态;终态任务不可恢复)。 */
export function isResumable(job: PublishJob): boolean {
  return !isTerminalJob(job);
}

/** 校验任务是否满足 schema 版本(用于损坏/旧版本检测)。 */
export function assertJobSchema(job: unknown): job is PublishJob {
  if (typeof job !== "object" || job === null) return false;
  const j = job as Record<string, unknown>;
  return (
    typeof j.id === "string" &&
    typeof j.contentDigest === "string" &&
    typeof j.stage === "string" &&
    Array.isArray(j.platformJobs) &&
    typeof j.createdAt === "string" &&
    typeof j.updatedAt === "string"
  );
}
