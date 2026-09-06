/**
 * 发布效果记录持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 PerformanceStore 接口一致,支持版本化 + 按平台检索。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { PerformanceStore, PerformanceRecord } from "@mpp/core";
import { PERFORMANCE_SCHEMA_VERSION } from "@mpp/core";

export type { PerformanceStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const PERFORMANCE = "performance-records";

/** IndexedDB 实现(web/desktop)。 */
export class IdbPerformanceStore implements PerformanceStore {
  readonly schemaVersion = PERFORMANCE_SCHEMA_VERSION;
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
          if (!db.objectStoreNames.contains(PERFORMANCE)) db.createObjectStore(PERFORMANCE, { keyPath: "id" });
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

  async list(): Promise<readonly PerformanceRecord[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(PERFORMANCE)) as PerformanceRecord[];
    return all.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async listByPlatform(platformId: string): Promise<readonly PerformanceRecord[]> {
    const all = await this.list();
    return all.filter((r) => r.platformId === platformId);
  }
  async get(id: string): Promise<PerformanceRecord | undefined> {
    return (await this.dbPromise).get(PERFORMANCE, id) as Promise<PerformanceRecord | undefined>;
  }
  async put(record: PerformanceRecord): Promise<void> {
    await (await this.dbPromise).put(PERFORMANCE, record);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(PERFORMANCE, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromePerformanceStore implements PerformanceStore {
  readonly schemaVersion = PERFORMANCE_SCHEMA_VERSION;

  private async read(): Promise<PerformanceRecord[]> {
    const obj = await chrome.storage.local.get(PERFORMANCE);
    return (obj[PERFORMANCE] as PerformanceRecord[] | undefined) ?? [];
  }
  private async write(value: PerformanceRecord[]): Promise<void> {
    await chrome.storage.local.set({ [PERFORMANCE]: value });
  }

  async list(): Promise<readonly PerformanceRecord[]> {
    const all = await this.read();
    return all.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async listByPlatform(platformId: string): Promise<readonly PerformanceRecord[]> {
    return (await this.list()).filter((r) => r.platformId === platformId);
  }
  async get(id: string): Promise<PerformanceRecord | undefined> {
    return (await this.read()).find((r) => r.id === id);
  }
  async put(record: PerformanceRecord): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((r) => r.id === record.id);
    if (idx >= 0) all[idx] = record;
    else all.push(record);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    const all = (await this.read()).filter((r) => r.id !== id);
    await this.write(all);
  }
}

/** 按环境选择效果记录存储。 */
export function createPerformanceStore(env: "web" | "extension" | "desktop"): PerformanceStore {
  return env === "extension" ? new ChromePerformanceStore() : new IdbPerformanceStore();
}
