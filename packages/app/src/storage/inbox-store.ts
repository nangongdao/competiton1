/**
 * 统一收件箱持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 InboxStore 接口一致(v11 INBOX-01/02)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { InboxMessage, InboxStore } from "@mpp/core";
import { INBOX_SCHEMA_VERSION } from "@mpp/core";

export type { InboxStore, InboxMessage } from "@mpp/core";

const DB_NAME = "mpp-store";
const INBOX = "inbox-messages";

/** IndexedDB 实现(web/desktop)。 */
export class IdbInboxStore implements InboxStore {
  readonly schemaVersion = INBOX_SCHEMA_VERSION;
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 11, {
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
          if (!db.objectStoreNames.contains("publish-batches")) db.createObjectStore("publish-batches", { keyPath: "id" });
        }
        if (oldVersion < 10) {
          if (!db.objectStoreNames.contains("asset-library")) {
            const store = db.createObjectStore("asset-library", { keyPath: "id" });
            store.createIndex("by-kind", "kind");
            store.createIndex("by-draft", "draftId");
          }
        }
        if (oldVersion < 11) {
          // v11 INBOX-01:统一收件箱(评论/私信/@提及/通知聚合)。
          if (!db.objectStoreNames.contains(INBOX)) {
            const store = db.createObjectStore(INBOX, { keyPath: "id" });
            store.createIndex("by-platform", "platformId");
            store.createIndex("by-status", "status");
          }
        }
      },
    });
  }

  async list(): Promise<readonly InboxMessage[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(INBOX)) as InboxMessage[];
    return all.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }
  async listByPlatform(platformId: string): Promise<readonly InboxMessage[]> {
    const db = await this.dbPromise;
    const all = (await db.getAllFromIndex(INBOX, "by-platform", platformId)) as InboxMessage[];
    return all.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }
  async get(id: string): Promise<InboxMessage | undefined> {
    return (await this.dbPromise).get(INBOX, id) as Promise<InboxMessage | undefined>;
  }
  async put(message: InboxMessage): Promise<void> {
    await (await this.dbPromise).put(INBOX, message);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(INBOX, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeInboxStore implements InboxStore {
  readonly schemaVersion = INBOX_SCHEMA_VERSION;

  private async read(): Promise<InboxMessage[]> {
    const obj = await chrome.storage.local.get(INBOX);
    return (obj[INBOX] as InboxMessage[] | undefined) ?? [];
  }
  private async write(value: InboxMessage[]): Promise<void> {
    await chrome.storage.local.set({ [INBOX]: value });
  }

  async list(): Promise<readonly InboxMessage[]> {
    const all = await this.read();
    return all.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }
  async listByPlatform(platformId: string): Promise<readonly InboxMessage[]> {
    return (await this.list()).filter((m) => m.platformId === platformId);
  }
  async get(id: string): Promise<InboxMessage | undefined> {
    return (await this.read()).find((m) => m.id === id);
  }
  async put(message: InboxMessage): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((m) => m.id === message.id);
    if (idx >= 0) all[idx] = message;
    else all.push(message);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((m) => m.id !== id));
  }
}

/** 按环境选择收件箱存储。桌面端(Tauri WebView)与 Web 一样走 IndexedDB。 */
export function createInboxStore(env: "web" | "extension" | "desktop"): InboxStore {
  return env === "extension" ? new ChromeInboxStore() : new IdbInboxStore();
}
