/**
 * 发布队列持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 PublishQueueStore 接口一致,支持版本化。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { PublishQueueStore, PublishQueueEntry } from "@mpp/core";
import { PUBLISH_QUEUE_SCHEMA_VERSION, sortQueueEntries } from "@mpp/core";

export type { PublishQueueStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const QUEUE = "publish-queue";

/** IndexedDB 实现(web/desktop)。 */
export class IdbPublishQueueStore implements PublishQueueStore {
  readonly schemaVersion = PUBLISH_QUEUE_SCHEMA_VERSION;
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
          // ROADMAP_V5 Phase 1:发布队列(稍后发布)。
          if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "id" });
        }
        if (oldVersion < 9) {
          // ROADMAP_V5 Phase 2:发布批次(一次排队多篇)。
          if (!db.objectStoreNames.contains("publish-batches")) db.createObjectStore("publish-batches", { keyPath: "id" });
        }
      },
    });
  }

  async list(): Promise<readonly PublishQueueEntry[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(QUEUE)) as PublishQueueEntry[];
    return sortQueueEntries(all);
  }
  async get(id: string): Promise<PublishQueueEntry | undefined> {
    return (await this.dbPromise).get(QUEUE, id) as Promise<PublishQueueEntry | undefined>;
  }
  async put(entry: PublishQueueEntry): Promise<void> {
    await (await this.dbPromise).put(QUEUE, entry);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(QUEUE, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromePublishQueueStore implements PublishQueueStore {
  readonly schemaVersion = PUBLISH_QUEUE_SCHEMA_VERSION;

  private async read(): Promise<PublishQueueEntry[]> {
    const obj = await chrome.storage.local.get(QUEUE);
    return (obj[QUEUE] as PublishQueueEntry[] | undefined) ?? [];
  }
  private async write(value: PublishQueueEntry[]): Promise<void> {
    await chrome.storage.local.set({ [QUEUE]: value });
  }

  async list(): Promise<readonly PublishQueueEntry[]> {
    const all = await this.read();
    return sortQueueEntries(all);
  }
  async get(id: string): Promise<PublishQueueEntry | undefined> {
    return (await this.read()).find((e) => e.id === id);
  }
  async put(entry: PublishQueueEntry): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((e) => e.id === entry.id);
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    const all = (await this.read()).filter((e) => e.id !== id);
    await this.write(all);
  }
}

/** 按环境选择发布队列存储。 */
export function createPublishQueueStore(env: "web" | "extension" | "desktop"): PublishQueueStore {
  return env === "extension" ? new ChromePublishQueueStore() : new IdbPublishQueueStore();
}
