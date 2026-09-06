/**
 * 账号矩阵分组持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 AccountGroupStore 接口一致(v11 BRAND-01)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { AccountGroup, AccountGroupStore } from "@mpp/core";
import { GROUP_SCHEMA_VERSION, sortGroups } from "@mpp/core";

export type { AccountGroup, AccountGroupStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const GROUPS = "account-groups";

/** IndexedDB 实现(web/desktop)。 */
export class IdbAccountGroupStore implements AccountGroupStore {
  readonly schemaVersion = GROUP_SCHEMA_VERSION;
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 12, {
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
          if (!db.objectStoreNames.contains("inbox-messages")) {
            const store = db.createObjectStore("inbox-messages", { keyPath: "id" });
            store.createIndex("by-platform", "platformId");
            store.createIndex("by-status", "status");
          }
        }
        if (oldVersion < 12) {
          // v11 BRAND-01:账号矩阵分组(按品牌/业务线)。
          if (!db.objectStoreNames.contains(GROUPS)) db.createObjectStore(GROUPS, { keyPath: "id" });
        }
      },
    });
  }

  async list(): Promise<readonly AccountGroup[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(GROUPS)) as AccountGroup[];
    return sortGroups(all);
  }
  async get(id: string): Promise<AccountGroup | undefined> {
    return (await this.dbPromise).get(GROUPS, id) as Promise<AccountGroup | undefined>;
  }
  async put(group: AccountGroup): Promise<void> {
    await (await this.dbPromise).put(GROUPS, group);
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(GROUPS, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeAccountGroupStore implements AccountGroupStore {
  readonly schemaVersion = GROUP_SCHEMA_VERSION;

  private async read(): Promise<AccountGroup[]> {
    const obj = await chrome.storage.local.get(GROUPS);
    return (obj[GROUPS] as AccountGroup[] | undefined) ?? [];
  }
  private async write(value: AccountGroup[]): Promise<void> {
    await chrome.storage.local.set({ [GROUPS]: value });
  }

  async list(): Promise<readonly AccountGroup[]> {
    const all = await this.read();
    return sortGroups(all);
  }
  async get(id: string): Promise<AccountGroup | undefined> {
    return (await this.read()).find((g) => g.id === id);
  }
  async put(group: AccountGroup): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((g) => g.id === group.id);
    if (idx >= 0) all[idx] = group;
    else all.push(group);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((g) => g.id !== id));
  }
}

/** 按环境选择账号分组存储。 */
export function createAccountGroupStore(env: "web" | "extension" | "desktop"): AccountGroupStore {
  return env === "extension" ? new ChromeAccountGroupStore() : new IdbAccountGroupStore();
}
