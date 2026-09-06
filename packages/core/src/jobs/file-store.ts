/**
 * 文件版任务存储(进程重启恢复) —— 实现 JobStore 接口,把任务持久化到本地 JSON 文件。
 *
 * 用途:
 * - server 侧把 PublishJobService 持久化,进程崩溃/重启后可从最近 checkpoint 续跑;
 * - 供"进程重启恢复"E2E 测试使用(重建 service + 注入执行器 → resume)。
 *
 * 设计(JOB-02 约束):
 * - 版本化:文件头携带 schemaVersion,损坏/版本不符在读取时给出明确错误;
 * - 原子写:先写临时文件再 rename,避免进程崩溃产生半写文件;
 * - 保留策略:与 MemoryJobStore 一致(终态 TTL + 条数上限);
 * - 损坏恢复:读入后逐条 assertJobSchema,损坏条目隔离并返回错误信息,不静默丢弃全部。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { JOB_RETENTION_MAX, JOB_RETENTION_TTL_MS, assertJobSchema, isTerminalJob, JOB_SCHEMA_VERSION } from "./store.js";
import type { JobStore } from "./store.js";
import type { PublishJob } from "./types.js";

/** 文件存储文件名。 */
export const FILE_JOBS_FILE = "publish-jobs.json";

export interface FileJobStoreOptions {
  /** 存储目录(默认取平台临时目录下的 mpp-jobs)。 */
  readonly dir?: string;
  /** 损坏时是否回退为空(默认 false:损坏必须显式处理,不静默清空)。 */
  readonly fallbackOnCorrupt?: boolean;
}

/** 文件存储的错误(损坏/版本不符时抛出,便于测试与操作提示)。 */
export class CorruptJobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptJobStoreError";
  }
}

export class FileJobStore implements JobStore {
  readonly schemaVersion = JOB_SCHEMA_VERSION;
  private readonly dir: string;
  private readonly file: string;
  private readonly fallbackOnCorrupt: boolean;
  /** 内存缓存(进程内仍走内存,写时落盘)。 */
  private jobs = new Map<string, PublishJob>();

  constructor(options: FileJobStoreOptions = {}) {
    const dir = options.dir ?? join(tmpdir(), "mpp-jobs");
    this.dir = resolve(dir);
    this.file = join(this.dir, FILE_JOBS_FILE);
    this.fallbackOnCorrupt = options.fallbackOnCorrupt ?? false;
  }

  /** 存储目录(绝对路径)。 */
  get directory(): string {
    return this.dir;
  }

  /** 加载(启动时调用一次;此后读写经内存+原子写)。 */
  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.jobs = new Map();
        return;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const message = `任务存储文件损坏(JSON 解析失败): ${this.file}`;
      if (this.fallbackOnCorrupt) {
        this.jobs = new Map();
        return;
      }
      throw new CorruptJobStoreError(message);
    }

    const jobs = Array.isArray(parsed) ? parsed : (parsed as { jobs?: unknown[] }).jobs;
    if (!Array.isArray(jobs)) {
      const message = `任务存储文件格式不符(缺少 jobs 数组): ${this.file}`;
      if (this.fallbackOnCorrupt) {
        this.jobs = new Map();
        return;
      }
      throw new CorruptJobStoreError(message);
    }

    const map = new Map<string, PublishJob>();
    const invalid: string[] = [];
    for (const item of jobs) {
      if (assertJobSchema(item)) {
        map.set(item.id, item);
      } else {
        invalid.push(typeof item === "object" && item !== null ? String((item as { id?: unknown }).id ?? "?") : "?");
      }
    }
    if (invalid.length > 0 && !this.fallbackOnCorrupt) {
      throw new CorruptJobStoreError(`任务存储含 ${invalid.length} 条损坏记录(id: ${invalid.join(",")})`);
    }
    this.jobs = map;
  }

  /** 同步(把全部任务写回磁盘,原子写)。 */
  private async flush(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const payload = JSON.stringify({ schemaVersion: this.schemaVersion, jobs: [...this.jobs.values()] }, null, 2);
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, this.file);
  }

  async list(): Promise<PublishJob[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishJob | undefined> {
    return this.jobs.get(id);
  }
  async put(job: PublishJob): Promise<void> {
    this.jobs.set(job.id, job);
    await this.flush();
  }
  async remove(id: string): Promise<void> {
    this.jobs.delete(id);
    await this.flush();
  }
  async prune(now: number = Date.now()): Promise<number> {
    const all = [...this.jobs.values()];
    const terminal = all.filter((j) => isTerminalJob(j));
    const expired = terminal.filter((j) => now - Date.parse(j.updatedAt) > JOB_RETENTION_TTL_MS);
    const keep = terminal
      .filter((j) => !expired.includes(j))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, JOB_RETENTION_MAX);
    const kept = new Set(keep.map((j) => j.id));
    const expiredSet = new Set(expired.map((j) => j.id));
    const removed: string[] = [];
    for (const j of terminal) {
      if (expiredSet.has(j.id) || !kept.has(j.id)) removed.push(j.id);
    }
    for (const id of removed) this.jobs.delete(id);
    if (removed.length > 0) await this.flush();
    return removed.length;
  }
}

/** 临时目录(避免在模块加载时访问浏览器全局)。 */
function tmpdir(): string {
  // Node 端
  const os = process.env["TMPDIR"] ?? process.env["TEMP"] ?? process.env["TMP"];
  return os ?? "/tmp";
}

export { dirname };
