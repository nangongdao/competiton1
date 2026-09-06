/**
 * 发布任务持久化(app 侧) —— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 JobStore 接口一致,支持版本化 + 保留清理(JOB-02)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { JobStore, PublishJob } from "@mpp/core";
import { JOB_SCHEMA_VERSION, JOB_RETENTION_MAX, JOB_RETENTION_TTL_MS } from "@mpp/core";

export type { JobStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const JOBS = "publish-jobs";

/** IndexedDB 实现(web)。 */
export class IdbJobStore implements JobStore {
  readonly schemaVersion = JOB_SCHEMA_VERSION;
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 9, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
          if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: "id" });
        }
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains("scheduled-tasks")) db.createObjectStore("scheduled-tasks", { keyPath: "id" });
          if (!db.objectStoreNames.contains("performance-records")) db.createObjectStore("performance-records", { keyPath: "id" });
        }
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains("versions")) {
            const store = db.createObjectStore("versions", { keyPath: "id" });
            store.createIndex("by-draft", "draftId");
          }
        }
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains("accounts")) db.createObjectStore("accounts", { keyPath: "id" });
          if (!db.objectStoreNames.contains("weekly-reports")) db.createObjectStore("weekly-reports", { keyPath: "id" });
        }
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains("weekly-reports")) db.createObjectStore("weekly-reports", { keyPath: "id" });
        }
        if (oldVersion < 7) {
          // COLLAB-01:本地共享库(桌面端/扩展接入,见 shared-store.ts)。
          if (!db.objectStoreNames.contains("shared-items")) db.createObjectStore("shared-items");
        }
        if (oldVersion < 8) {
          // ROADMAP_V5 Phase 1:发布队列(稍后发布,与 scheduled-tasks 并列)。
          if (!db.objectStoreNames.contains("publish-queue")) db.createObjectStore("publish-queue", { keyPath: "id" });
        }
        if (oldVersion < 9) {
          // ROADMAP_V5 Phase 2:发布批次(一次排队多篇)。
          if (!db.objectStoreNames.contains("publish-batches")) db.createObjectStore("publish-batches", { keyPath: "id" });
        }
      },
    });
  }

  async list(): Promise<PublishJob[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(JOBS)) as PublishJob[];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishJob | undefined> {
    return (await this.dbPromise).get(JOBS, id) as Promise<PublishJob | undefined>;
  }
  async put(job: PublishJob): Promise<void> {
    await (await this.dbPromise).put(JOBS, job);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(JOBS, id);
  }
  async prune(now: number = Date.now()): Promise<number> {
    const all = await this.list();
    const terminal = all.filter((j) => {
      const s = j.stage;
      return s === "succeeded" || s === "failed" || s === "unknown" || s === "cancelled";
    });
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
    const db = await this.dbPromise;
    const tx = db.transaction(JOBS, "readwrite");
    for (const id of removed) void tx.store.delete(id);
    await tx.done;
    return removed.length;
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeJobStore implements JobStore {
  readonly schemaVersion = JOB_SCHEMA_VERSION;

  private async read(): Promise<PublishJob[]> {
    const obj = await chrome.storage.local.get(JOBS);
    return (obj[JOBS] as PublishJob[] | undefined) ?? [];
  }
  private async write(value: PublishJob[]): Promise<void> {
    await chrome.storage.local.set({ [JOBS]: value });
  }

  async list(): Promise<PublishJob[]> {
    const all = await this.read();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishJob | undefined> {
    return (await this.read()).find((j) => j.id === id);
  }
  async put(job: PublishJob): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((j) => j.id === job.id);
    if (idx >= 0) all[idx] = job;
    else all.push(job);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    const all = (await this.read()).filter((j) => j.id !== id);
    await this.write(all);
  }
  async prune(now: number = Date.now()): Promise<number> {
    const all = await this.read();
    const terminal = all.filter((j) => {
      const s = j.stage;
      return s === "succeeded" || s === "failed" || s === "unknown" || s === "cancelled";
    });
    const expired = terminal.filter((j) => now - Date.parse(j.updatedAt) > JOB_RETENTION_TTL_MS);
    const keep = terminal
      .filter((j) => !expired.includes(j))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, JOB_RETENTION_MAX);
    const kept = new Set(keep.map((j) => j.id));
    const expiredSet = new Set(expired.map((j) => j.id));
    const removedIds = new Set<string>();
    for (const j of terminal) {
      if (expiredSet.has(j.id) || !kept.has(j.id)) removedIds.add(j.id);
    }
    await this.write(all.filter((j) => !removedIds.has(j.id)));
    return removedIds.size;
  }
}

/** 按环境选择任务存储。桌面端(Tauri WebView)与 Web 一样走 IndexedDB。 */
export function createJobStore(env: "web" | "extension" | "desktop"): JobStore {
  return env === "extension" ? new ChromeJobStore() : new IdbJobStore();
}
