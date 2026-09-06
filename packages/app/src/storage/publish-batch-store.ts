/**
 * 发布批次持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 PublishBatchStore 接口一致,支持版本化(ROADMAP_V5 Phase 2)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { PublishBatchStore, PublishBatch } from "@mpp/core";
import { PUBLISH_BATCH_SCHEMA_VERSION } from "@mpp/core";

export type { PublishBatchStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const BATCHES = "publish-batches";

/** IndexedDB 实现(web/desktop)。 */
export class IdbPublishBatchStore implements PublishBatchStore {
  readonly schemaVersion = PUBLISH_BATCH_SCHEMA_VERSION;
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
          if (!db.objectStoreNames.contains("weekly-reports")) db.createObjectStore("weekly-reports", { keyPath: "id" });
        }
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains("weekly-reports")) db.createObjectStore("weekly-reports", { keyPath: "id" });
        }
        if (oldVersion < 7) {
          if (!db.objectStoreNames.contains("shared-items")) db.createObjectStore("shared-items");
        }
        if (oldVersion < 8) {
          if (!db.objectStoreNames.contains("publish-queue")) db.createObjectStore("publish-queue", { keyPath: "id" });
        }
        if (oldVersion < 9) {
          // ROADMAP_V5 Phase 2:发布批次(一次排队多篇)。
          if (!db.objectStoreNames.contains(BATCHES)) db.createObjectStore(BATCHES, { keyPath: "id" });
        }
      },
    });
  }

  async list(): Promise<readonly PublishBatch[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(BATCHES)) as PublishBatch[];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishBatch | undefined> {
    return (await this.dbPromise).get(BATCHES, id) as Promise<PublishBatch | undefined>;
  }
  async put(batch: PublishBatch): Promise<void> {
    await (await this.dbPromise).put(BATCHES, batch);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(BATCHES, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromePublishBatchStore implements PublishBatchStore {
  readonly schemaVersion = PUBLISH_BATCH_SCHEMA_VERSION;

  private async read(): Promise<PublishBatch[]> {
    const obj = await chrome.storage.local.get(BATCHES);
    return (obj[BATCHES] as PublishBatch[] | undefined) ?? [];
  }
  private async write(value: PublishBatch[]): Promise<void> {
    await chrome.storage.local.set({ [BATCHES]: value });
  }

  async list(): Promise<readonly PublishBatch[]> {
    const all = await this.read();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishBatch | undefined> {
    return (await this.read()).find((b) => b.id === id);
  }
  async put(batch: PublishBatch): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((b) => b.id === batch.id);
    if (idx >= 0) all[idx] = batch;
    else all.push(batch);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    const all = (await this.read()).filter((b) => b.id !== id);
    await this.write(all);
  }
}

/** 按环境选择发布批次存储。 */
export function createPublishBatchStore(env: "web" | "extension" | "desktop"): PublishBatchStore {
  return env === "extension" ? new ChromePublishBatchStore() : new IdbPublishBatchStore();
}
