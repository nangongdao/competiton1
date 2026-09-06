/**
 * 计划任务持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 ScheduledTaskStore 接口一致,支持版本化 + 保留最近运行记录。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { ScheduledTaskStore, ScheduledTask } from "@mpp/core";
import { SCHEDULE_SCHEMA_VERSION } from "@mpp/core";

export type { ScheduledTaskStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const SCHEDULES = "scheduled-tasks";

/** IndexedDB 实现(web/desktop)。 */
export class IdbScheduledTaskStore implements ScheduledTaskStore {
  readonly schemaVersion = SCHEDULE_SCHEMA_VERSION;
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
          if (!db.objectStoreNames.contains(SCHEDULES)) db.createObjectStore(SCHEDULES, { keyPath: "id" });
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

  async list(): Promise<readonly ScheduledTask[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(SCHEDULES)) as ScheduledTask[];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<ScheduledTask | undefined> {
    return (await this.dbPromise).get(SCHEDULES, id) as Promise<ScheduledTask | undefined>;
  }
  async put(task: ScheduledTask): Promise<void> {
    await (await this.dbPromise).put(SCHEDULES, task);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(SCHEDULES, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeScheduledTaskStore implements ScheduledTaskStore {
  readonly schemaVersion = SCHEDULE_SCHEMA_VERSION;

  private async read(): Promise<ScheduledTask[]> {
    const obj = await chrome.storage.local.get(SCHEDULES);
    return (obj[SCHEDULES] as ScheduledTask[] | undefined) ?? [];
  }
  private async write(value: ScheduledTask[]): Promise<void> {
    await chrome.storage.local.set({ [SCHEDULES]: value });
  }

  async list(): Promise<readonly ScheduledTask[]> {
    const all = await this.read();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<ScheduledTask | undefined> {
    return (await this.read()).find((t) => t.id === id);
  }
  async put(task: ScheduledTask): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((t) => t.id === task.id);
    if (idx >= 0) all[idx] = task;
    else all.push(task);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    const all = (await this.read()).filter((t) => t.id !== id);
    await this.write(all);
  }
}

/** 按环境选择计划任务存储。 */
export function createScheduledTaskStore(env: "web" | "extension" | "desktop"): ScheduledTaskStore {
  return env === "extension" ? new ChromeScheduledTaskStore() : new IdbScheduledTaskStore();
}
