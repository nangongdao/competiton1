/**
 * 文章版本历史持久化(app 侧)—— 双实现(web=IndexedDB / 扩展=chrome.storage)。
 * 与 core 的 VersionStore 接口一致,支持版本时间线 / 差异对比 / 一键回滚。
 * IndexedDB schema 版本升级到 4(新增 versions 存储)。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { VersionStore, ArticleSnapshot, VersionMeta } from "@mpp/core";
import { VERSION_SCHEMA_VERSION, VERSION_KEEP_MAX } from "@mpp/core";

export type { VersionStore, ArticleSnapshot, VersionMeta } from "@mpp/core";

const DB_NAME = "mpp-store";
const VERSIONS = "versions";

/** IndexedDB 实现(web/desktop)。 */
export class IdbVersionStore implements VersionStore {
  readonly schemaVersion = VERSION_SCHEMA_VERSION;
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
          // 新增 versions 存储,并为其创建 by-draft 索引。
          const store = db.createObjectStore(VERSIONS, { keyPath: "id" });
          store.createIndex("by-draft", "draftId");
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
  async list(draftId: string): Promise<readonly VersionMeta[]> {
    const db = await this.dbPromise;
    const all = (await db.getAllFromIndex(VERSIONS, "by-draft", draftId)) as ArticleSnapshot[];
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, draftId: s.draftId, label: s.label, createdAt: s.createdAt, charCount: [...s.markdown].length }));
  }

  async get(id: string): Promise<ArticleSnapshot | undefined> {
    return (await this.dbPromise).get(VERSIONS, id) as Promise<ArticleSnapshot | undefined>;
  }

  async put(snapshot: ArticleSnapshot): Promise<void> {
    const db = await this.dbPromise;
    await db.put(VERSIONS, snapshot);
    // 裁剪:仅保留该草稿最近 VERSION_KEEP_MAX 个版本。
    await this.prune(snapshot.draftId);
  }

  private async prune(draftId: string): Promise<void> {
    const db = await this.dbPromise;
    const all = (await db.getAllFromIndex(VERSIONS, "by-draft", draftId)) as ArticleSnapshot[];
    const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sorted.length <= VERSION_KEEP_MAX) return;
    const remove = sorted.slice(VERSION_KEEP_MAX);
    const tx = db.transaction(VERSIONS, "readwrite");
    for (const s of remove) void tx.store.delete(s.id);
    await tx.done;
  }

  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(VERSIONS, id);
  }

  async removeAll(draftId: string): Promise<void> {
    const db = await this.dbPromise;
    const all = (await db.getAllFromIndex(VERSIONS, "by-draft", draftId)) as ArticleSnapshot[];
    const tx = db.transaction(VERSIONS, "readwrite");
    for (const s of all) void tx.store.delete(s.id);
    await tx.done;
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeVersionStore implements VersionStore {
  readonly schemaVersion = VERSION_SCHEMA_VERSION;

  private async read(): Promise<ArticleSnapshot[]> {
    const obj = await chrome.storage.local.get(VERSIONS);
    return (obj[VERSIONS] as ArticleSnapshot[] | undefined) ?? [];
  }
  private async write(value: ArticleSnapshot[]): Promise<void> {
    await chrome.storage.local.set({ [VERSIONS]: value });
  }

  async list(draftId: string): Promise<readonly VersionMeta[]> {
    const all = (await this.read()).filter((s) => s.draftId === draftId);
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, draftId: s.draftId, label: s.label, createdAt: s.createdAt, charCount: [...s.markdown].length }));
  }

  async get(id: string): Promise<ArticleSnapshot | undefined> {
    return (await this.read()).find((s) => s.id === id);
  }

  async put(snapshot: ArticleSnapshot): Promise<void> {
    const all = await this.read();
    const idx = all.findIndex((s) => s.id === snapshot.id);
    if (idx >= 0) all[idx] = snapshot;
    else all.push(snapshot);
    await this.write(this.pruneByDraft(all, snapshot.draftId));
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((s) => s.id !== id));
  }

  async removeAll(draftId: string): Promise<void> {
    await this.write((await this.read()).filter((s) => s.draftId !== draftId));
  }

  private pruneByDraft(all: ArticleSnapshot[], draftId: string): ArticleSnapshot[] {
    const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let kept = 0;
    return sorted.filter((s) => {
      if (s.draftId !== draftId) return true;
      kept++;
      return kept <= VERSION_KEEP_MAX;
    });
  }
}

/** 按环境选择版本存储。桌面端(Tauri WebView)与 Web 一样走 IndexedDB。 */
export function createVersionStore(env: "web" | "extension" | "desktop"): VersionStore {
  return env === "extension" ? new ChromeVersionStore() : new IdbVersionStore();
}
