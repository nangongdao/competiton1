/**
 * 内容资产库持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 AssetLibraryStore 接口一致,支持版本化(ROADMAP_V5 Phase 3)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { AssetLibraryKind, AssetLibraryStore, AssetRecord } from "@mpp/core";
import { ASSET_LIBRARY_SCHEMA_VERSION } from "@mpp/core";

export type { AssetLibraryStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const ASSETS = "asset-library";

/** IndexedDB 实现(web/desktop)。 */
export class IdbAssetLibraryStore implements AssetLibraryStore {
  readonly schemaVersion = ASSET_LIBRARY_SCHEMA_VERSION;
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 10, {
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
          if (!db.objectStoreNames.contains("publish-batches")) db.createObjectStore("publish-batches", { keyPath: "id" });
        }
        if (oldVersion < 10) {
          // ROADMAP_V5 Phase 3:内容资产库(封面/图床/平台产物/草稿快照)。
          if (!db.objectStoreNames.contains(ASSETS)) {
            const store = db.createObjectStore(ASSETS, { keyPath: "id" });
            store.createIndex("by-kind", "kind");
            store.createIndex("by-draft", "draftId");
          }
        }
      },
    });
  }

  async list(): Promise<readonly AssetRecord[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(ASSETS)) as AssetRecord[];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listByKind(kind: AssetLibraryKind): Promise<readonly AssetRecord[]> {
    const db = await this.dbPromise;
    const all = (await db.getAllFromIndex(ASSETS, "by-kind", kind)) as AssetRecord[];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string): Promise<AssetRecord | undefined> {
    return (await this.dbPromise).get(ASSETS, id) as Promise<AssetRecord | undefined>;
  }
  async put(record: AssetRecord): Promise<void> {
    await (await this.dbPromise).put(ASSETS, record);
  }
  async putMany(records: readonly AssetRecord[]): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(ASSETS, "readwrite");
    for (const r of records) void tx.store.put(r);
    await tx.done;
  }
  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(ASSETS, id);
  }
  async removeAllByDraft(draftId: string): Promise<void> {
    const db = await this.dbPromise;
    const all = (await db.getAllFromIndex(ASSETS, "by-draft", draftId)) as AssetRecord[];
    const tx = db.transaction(ASSETS, "readwrite");
    for (const r of all) void tx.store.delete(r.id);
    await tx.done;
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeAssetLibraryStore implements AssetLibraryStore {
  readonly schemaVersion = ASSET_LIBRARY_SCHEMA_VERSION;

  private async read(): Promise<AssetRecord[]> {
    const obj = await chrome.storage.local.get(ASSETS);
    return (obj[ASSETS] as AssetRecord[] | undefined) ?? [];
  }
  private async write(value: AssetRecord[]): Promise<void> {
    await chrome.storage.local.set({ [ASSETS]: value });
  }

  async list(): Promise<readonly AssetRecord[]> {
    const all = await this.read();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listByKind(kind: AssetLibraryKind): Promise<readonly AssetRecord[]> {
    return (await this.list()).filter((r) => r.kind === kind);
  }
  async get(id: string): Promise<AssetRecord | undefined> {
    return (await this.read()).find((r) => r.id === id);
  }
  async put(record: AssetRecord): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((r) => r.id === record.id);
    if (idx >= 0) all[idx] = record;
    else all.push(record);
    await this.write(all);
  }
  async putMany(records: readonly AssetRecord[]): Promise<void> {
    const all = await this.read();
    const map = new Map(all.map((r) => [r.id, r]));
    for (const r of records) map.set(r.id, r);
    await this.write([...map.values()]);
  }
  async remove(id: string): Promise<void> {
    const all = (await this.read()).filter((r) => r.id !== id);
    await this.write(all);
  }
  async removeAllByDraft(draftId: string): Promise<void> {
    const all = (await this.read()).filter((r) => r.draftId !== draftId);
    await this.write(all);
  }
}

/** 按环境选择资产库存储。 */
export function createAssetLibraryStore(env: "web" | "extension" | "desktop"): AssetLibraryStore {
  return env === "extension" ? new ChromeAssetLibraryStore() : new IdbAssetLibraryStore();
}
