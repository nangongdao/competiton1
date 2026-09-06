/**
 * v4 Phase 2 · 内容智能周报任务持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 WeeklyReportStore 接口一致,支持版本化 + 保留最近运行记录。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { WeeklyReportStore, WeeklyReportJob } from "@mpp/core";
import { WEEKLY_SCHEMA_VERSION } from "@mpp/core";

export type { WeeklyReportStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const WEEKLY = "weekly-reports";

/** IndexedDB 实现(web/desktop)。 */
export class IdbWeeklyStore implements WeeklyReportStore {
  readonly schemaVersion = WEEKLY_SCHEMA_VERSION;
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 9, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
          if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("publish-jobs")) db.createObjectStore("publish-jobs", { keyPath: "id" });
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
          if (!db.objectStoreNames.contains(WEEKLY)) db.createObjectStore(WEEKLY, { keyPath: "id" });
        }
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains(WEEKLY)) db.createObjectStore(WEEKLY, { keyPath: "id" });
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

  async list(): Promise<readonly WeeklyReportJob[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(WEEKLY)) as WeeklyReportJob[];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<WeeklyReportJob | undefined> {
    return (await this.dbPromise).get(WEEKLY, id) as Promise<WeeklyReportJob | undefined>;
  }
  async put(job: WeeklyReportJob): Promise<void> {
    await (await this.dbPromise).put(WEEKLY, job);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(WEEKLY, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeWeeklyStore implements WeeklyReportStore {
  readonly schemaVersion = WEEKLY_SCHEMA_VERSION;

  private async read(): Promise<WeeklyReportJob[]> {
    const obj = await chrome.storage.local.get(WEEKLY);
    return (obj[WEEKLY] as WeeklyReportJob[] | undefined) ?? [];
  }
  private async write(value: WeeklyReportJob[]): Promise<void> {
    await chrome.storage.local.set({ [WEEKLY]: value });
  }

  async list(): Promise<readonly WeeklyReportJob[]> {
    const all = await this.read();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<WeeklyReportJob | undefined> {
    return (await this.read()).find((j) => j.id === id);
  }
  async put(job: WeeklyReportJob): Promise<void> {
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
}

/** 按环境选择周报任务存储。 */
export function createWeeklyStore(env: "web" | "extension" | "desktop"): WeeklyReportStore {
  return env === "extension" ? new ChromeWeeklyStore() : new IdbWeeklyStore();
}
