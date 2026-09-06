/**
 * ROADMAP_V5 Phase 3 · 内容资产库 —— 内存存储(默认实现 / 测试用)。
 */
import type { AssetLibraryKind, AssetLibraryStore, AssetRecord } from "./types.js";
import { ASSET_LIBRARY_SCHEMA_VERSION } from "./types.js";

/** 内存实现(默认/测试用)。 */
export class MemoryAssetLibraryStore implements AssetLibraryStore {
  readonly schemaVersion = ASSET_LIBRARY_SCHEMA_VERSION;
  private readonly records = new Map<string, AssetRecord>();

  async list(): Promise<readonly AssetRecord[]> {
    return [...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listByKind(kind: AssetLibraryKind): Promise<readonly AssetRecord[]> {
    return (await this.list()).filter((r) => r.kind === kind);
  }
  async get(id: string): Promise<AssetRecord | undefined> {
    return this.records.get(id);
  }
  async put(record: AssetRecord): Promise<void> {
    this.records.set(record.id, record);
  }
  async putMany(records: readonly AssetRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, r);
  }
  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
  async removeAllByDraft(draftId: string): Promise<void> {
    for (const [id, r] of this.records) {
      if (r.draftId === draftId) this.records.delete(id);
    }
  }
}
