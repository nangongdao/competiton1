/**
 * v4 Phase 3 · COLLAB-01/03 共享库持久化(app 侧)—— 双实现(web/desktop=IndexedDB / 扩展=chrome.storage)。
 *
 * 背景:共享库默认由 server 持有(局域网共享)。桌面端/扩展接入后,
 * 本机也可读写一份**本地共享库副本**(web 与桌面走 IndexedDB,扩展走 chrome.storage.local),
 * 与 server `/share/*` 走同一 SharedStore 接口 + 版本化冲突合并。
 *
 * 版本化(COLLAB-01):同 id 并发覆盖时经 core `mergeSharedItem` 保留双版本
 * (新版本以 `id#v{n}` 后缀写入,旧版本保留在原 id 下),不丢任何一方的编辑。
 *
 * IndexedDB schema 版本升级到 7(新增 shared-items 存储)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { SharedItem, SharedContentKind, SharedItemPutResult, SharedStore } from "@mpp/core";
import { SHARED_SCHEMA_VERSION, SHARED_ITEMS_PER_KIND_MAX, mergeSharedItem, assertSharedItem } from "@mpp/core";

export type { SharedStore } from "@mpp/core";

const DB_NAME = "mpp-store";
const SHARED = "shared-items";

/** 本地共享库的 IndexedDB 实现(web/desktop)。 */
export class IdbSharedStore implements SharedStore {
  readonly schemaVersion = SHARED_SCHEMA_VERSION;
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
          if (!db.objectStoreNames.contains(SHARED)) {
            // SharedItem 顶层无 id(keyPath 在 meta.id),用 out-of-line 复合主键 `${kind}::${id}`。
            db.createObjectStore(SHARED);
          }
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

  async list(): Promise<readonly SharedItem[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(SHARED)) as SharedItem[];
    return all.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  }
  async listByKind(kind: SharedContentKind): Promise<readonly SharedItem[]> {
    return (await this.list()).filter((i) => i.meta.kind === kind);
  }
  async get(kind: SharedContentKind, id: string): Promise<SharedItem | undefined> {
    return (await this.dbPromise).get(SHARED, this.key(kind, id)) as Promise<SharedItem | undefined>;
  }
  async put(item: SharedItem): Promise<SharedItemPutResult> {
    const db = await this.dbPromise;
    const existing = await db.get(SHARED, this.key(item.meta.kind, item.meta.id));
    const result = mergeSharedItem(existing, item);
    if (result.mode === "unchanged") return result;
    const target = result.item;
    const existingTarget = await db.get(SHARED, this.key(target.meta.kind, target.meta.id));
    if (existingTarget) {
      await db.put(SHARED, target, this.key(target.meta.kind, target.meta.id));
    } else {
      // 每类上限裁剪(保留最新,防止无限增长)。
      const sameKind = (await db.getAll(SHARED)).filter((i) => i.meta.kind === target.meta.kind);
      if (sameKind.length >= SHARED_ITEMS_PER_KIND_MAX) {
        const oldest = sameKind.sort((a, b) => a.meta.updatedAt.localeCompare(b.meta.updatedAt))[0]!;
        await db.delete(SHARED, this.key(oldest.meta.kind, oldest.meta.id));
      }
      await db.put(SHARED, target, this.key(target.meta.kind, target.meta.id));
    }
    return result;
  }
  async remove(kind: SharedContentKind, id: string): Promise<void> {
    await (await this.dbPromise).delete(SHARED, this.key(kind, id));
  }

  /** 复合主键(kind:id 拼接,避免不同 kind 同 id 冲突)。 */
  private key(kind: SharedContentKind, id: string): string {
    return `${kind}::${id}`;
  }
}

/** 本地共享库的 chrome.storage.local 实现(扩展)。 */
export class ChromeSharedStore implements SharedStore {
  readonly schemaVersion = SHARED_SCHEMA_VERSION;

  private async read(): Promise<SharedItem[]> {
    const obj = await chrome.storage.local.get(SHARED);
    const raw = obj[SHARED] as unknown[] | undefined;
    return Array.isArray(raw) ? raw.filter((i): i is SharedItem => assertSharedItem(i)) : [];
  }
  private async write(value: SharedItem[]): Promise<void> {
    await chrome.storage.local.set({ [SHARED]: value });
  }

  async list(): Promise<readonly SharedItem[]> {
    return (await this.read()).sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  }
  async listByKind(kind: SharedContentKind): Promise<readonly SharedItem[]> {
    return (await this.list()).filter((i) => i.meta.kind === kind);
  }
  async get(kind: SharedContentKind, id: string): Promise<SharedItem | undefined> {
    return (await this.list()).find((i) => i.meta.kind === kind && i.meta.id === id);
  }
  async put(item: SharedItem): Promise<SharedItemPutResult> {
    const all = await this.read();
    const existing = all.find((i) => i.meta.kind === item.meta.kind && i.meta.id === item.meta.id);
    const result = mergeSharedItem(existing, item);
    if (result.mode === "unchanged") return result;
    const target = result.item;
    const idx = all.findIndex((i) => i.meta.kind === target.meta.kind && i.meta.id === target.meta.id);
    if (idx >= 0) {
      all[idx] = target;
    } else {
      const sameKind = all.filter((i) => i.meta.kind === target.meta.kind);
      if (sameKind.length >= SHARED_ITEMS_PER_KIND_MAX) {
        const oldest = sameKind.sort((a, b) => a.meta.updatedAt.localeCompare(b.meta.updatedAt))[0]!;
        const idxOld = all.findIndex((i) => i.meta.kind === oldest.meta.kind && i.meta.id === oldest.meta.id);
        if (idxOld >= 0) all.splice(idxOld, 1);
      }
      all.push(target);
    }
    await this.write(all);
    return result;
  }
  async remove(kind: SharedContentKind, id: string): Promise<void> {
    await this.write((await this.read()).filter((i) => !(i.meta.kind === kind && i.meta.id === id)));
  }
}

/** 按环境选择本地共享库存储。桌面端(Tauri WebView)与 Web 一样走 IndexedDB。 */
export function createSharedStore(env: "web" | "extension" | "desktop"): SharedStore {
  return env === "extension" ? new ChromeSharedStore() : new IdbSharedStore();
}
