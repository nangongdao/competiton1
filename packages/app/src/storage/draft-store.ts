/**
 * 草稿与发布历史持久化 —— 统一 DraftStore 接口 + 双实现。
 *
 * web:IndexedDB(草稿含图片 dataURL,体积大,localStorage 5MB 不够)。
 * 扩展:chrome.storage.local(配额更大,且与扩展生命周期一致)。
 * 按运行环境选择实现,UI 只依赖 DraftStore 接口。
 */
import { openDB, type IDBPDatabase } from "idb";

export interface Draft {
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  /** 最后更新时间(ISO)。 */
  readonly updatedAt: string;
}

export interface HistoryEntry {
  readonly id: string;
  readonly draftTitle: string;
  readonly at: string;
  /** 各平台发布状态摘要。 */
  readonly platforms: ReadonlyArray<{ platformId: string; ok: boolean; message: string }>;
}

export interface DraftStore {
  listDrafts(): Promise<Draft[]>;
  getDraft(id: string): Promise<Draft | undefined>;
  saveDraft(draft: Draft): Promise<void>;
  removeDraft(id: string): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  addHistory(entry: HistoryEntry): Promise<void>;
}

const DB_NAME = "mpp-store";
const DRAFTS = "drafts";
const HISTORY = "history";

/** IndexedDB 实现(web)。 */
export class IdbDraftStore implements DraftStore {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 9, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "id" });
          if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: "id" });
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

  async listDrafts(): Promise<Draft[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(DRAFTS)) as Draft[];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getDraft(id: string): Promise<Draft | undefined> {
    return (await this.dbPromise).get(DRAFTS, id) as Promise<Draft | undefined>;
  }
  async saveDraft(draft: Draft): Promise<void> {
    await (await this.dbPromise).put(DRAFTS, draft);
  }
  async removeDraft(id: string): Promise<void> {
    await (await this.dbPromise).delete(DRAFTS, id);
  }
  async listHistory(): Promise<HistoryEntry[]> {
    const db = await this.dbPromise;
    const all = (await db.getAll(HISTORY)) as HistoryEntry[];
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  }
  async addHistory(entry: HistoryEntry): Promise<void> {
    await (await this.dbPromise).put(HISTORY, entry);
  }
}

/** chrome.storage.local 实现(扩展)。 */
export class ChromeDraftStore implements DraftStore {
  private async read<T>(key: string): Promise<T[]> {
    const obj = await chrome.storage.local.get(key);
    return (obj[key] as T[] | undefined) ?? [];
  }
  private async write<T>(key: string, value: T[]): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async listDrafts(): Promise<Draft[]> {
    const all = await this.read<Draft>(DRAFTS);
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getDraft(id: string): Promise<Draft | undefined> {
    return (await this.read<Draft>(DRAFTS)).find((d) => d.id === id);
  }
  async saveDraft(draft: Draft): Promise<void> {
    const all = await this.read<Draft>(DRAFTS);
    const idx = all.findIndex((d) => d.id === draft.id);
    if (idx >= 0) all[idx] = draft;
    else all.push(draft);
    await this.write(DRAFTS, all);
  }
  async removeDraft(id: string): Promise<void> {
    const all = (await this.read<Draft>(DRAFTS)).filter((d) => d.id !== id);
    await this.write(DRAFTS, all);
  }
  async listHistory(): Promise<HistoryEntry[]> {
    const all = await this.read<HistoryEntry>(HISTORY);
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  }
  async addHistory(entry: HistoryEntry): Promise<void> {
    const all = await this.read<HistoryEntry>(HISTORY);
    all.push(entry);
    await this.write(HISTORY, all.slice(-50));
  }
}

/** 按环境选择存储实现。 */
export function createDraftStore(env: "web" | "extension" | "desktop"): DraftStore {
  return env === "extension" ? new ChromeDraftStore() : new IdbDraftStore();
}
