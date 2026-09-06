/**
 * 账号配置持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 *
 * ACCOUNT-02 密钥安全分级:
 * - 密钥默认仅会话保存(与 SEC-04 对齐):持久化/导出时经 `stripAccountSecrets` 剔除;
 * - 显式开启 `persistSecrets` 才把账号密钥写入本地存储;
 * - 共享/导出永远不携带密钥。
 *
 * IndexedDB schema 版本升级到 5(新增 accounts 存储)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { AccountProfile, AccountStore } from "@mpp/core";
import { ACCOUNT_SCHEMA_VERSION, stripAccountSecrets } from "@mpp/core";

export type { AccountProfile, AccountStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const ACCOUNTS = "accounts";

/** IndexedDB 实现(web/desktop)。 */
export class IdbAccountStore implements AccountStore {
  readonly schemaVersion = ACCOUNT_SCHEMA_VERSION;
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
          const store = db.createObjectStore("versions", { keyPath: "id" });
          store.createIndex("by-draft", "draftId");
        }
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains(ACCOUNTS)) db.createObjectStore(ACCOUNTS, { keyPath: "id" });
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

  async list(): Promise<readonly AccountProfile[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(ACCOUNTS)) as AccountProfile[];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listByPlatform(platformId: string): Promise<readonly AccountProfile[]> {
    return (await this.list()).filter((a) => a.platformId === platformId);
  }
  async get(id: string): Promise<AccountProfile | undefined> {
    return (await this.dbPromise).get(ACCOUNTS, id) as Promise<AccountProfile | undefined>;
  }
  async put(profile: AccountProfile): Promise<void> {
    // 落盘前剔除密钥(除非显式持久化)。
    await (await this.dbPromise).put(ACCOUNTS, stripAccountSecrets(profile));
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(ACCOUNTS, id);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeAccountStore implements AccountStore {
  readonly schemaVersion = ACCOUNT_SCHEMA_VERSION;

  private async read(): Promise<AccountProfile[]> {
    const obj = await chrome.storage.local.get(ACCOUNTS);
    return (obj[ACCOUNTS] as AccountProfile[] | undefined) ?? [];
  }
  private async write(value: AccountProfile[]): Promise<void> {
    await chrome.storage.local.set({ [ACCOUNTS]: value });
  }

  async list(): Promise<readonly AccountProfile[]> {
    const all = await this.read();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listByPlatform(platformId: string): Promise<readonly AccountProfile[]> {
    return (await this.list()).filter((a) => a.platformId === platformId);
  }
  async get(id: string): Promise<AccountProfile | undefined> {
    return (await this.read()).find((a) => a.id === id);
  }
  async put(profile: AccountProfile): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((a) => a.id === profile.id);
    const safe = stripAccountSecrets(profile);
    if (idx >= 0) all[idx] = safe;
    else all.push(safe);
    await this.write(all);
  }
  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((a) => a.id !== id));
  }
}

/** 按环境选择账号存储。桌面端(Tauri WebView)与 Web 一样走 IndexedDB。 */
export function createAccountStore(env: "web" | "extension" | "desktop"): AccountStore {
  return env === "extension" ? new ChromeAccountStore() : new IdbAccountStore();
}
