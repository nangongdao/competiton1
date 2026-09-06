/**
 * v4 Phase 3 · COLLAB-01/03 桌面端本地共享库 —— 经 Tauri 桥读写文件。
 *
 * 背景:共享库默认由 server 持有(局域网共享);桌面端接入后,通过
 * `TauriBridge.readLocalSharedStore / writeLocalSharedStore` 读写
 * `<app_data_dir>/shared-items.json`(Rust 原子写),在本地保有一份
 * 与 server 同格式、同版本化合并规则的共享库副本。
 *
 * 版本化(COLLAB-01):同 id 并发覆盖时经 core `mergeSharedItem` 保留双版本
 * (新版本以 `id#v{n}` 后缀写入,旧版本保留在原 id 下)。
 */
import type {
  SharedItem,
  SharedContentKind,
  SharedItemPutResult,
  SharedStore,
} from "@mpp/core";
import {
  SHARED_SCHEMA_VERSION,
  SHARED_ITEMS_PER_KIND_MAX,
  mergeSharedItem,
  assertSharedItem,
} from "@mpp/core";
import type { TauriBridge } from "./tauri-bridge.js";

/** 落盘文件结构(与 core FileSharedStore 完全一致,便于跨端互换)。 */
interface SharedStoreFile {
  readonly schemaVersion: number;
  readonly items: readonly SharedItem[];
}

/** 桌面端本地共享库:文件由 Rust 桥读写,内存缓存 + 版本化合并。 */
export class DesktopFileSharedStore implements SharedStore {
  readonly schemaVersion = SHARED_SCHEMA_VERSION;
  private readonly bridge: TauriBridge;
  private cache: SharedItem[] | null = null;
  private loading: Promise<void> | null = null;

  constructor(bridge: TauriBridge) {
    this.bridge = bridge;
  }

  private async load(): Promise<void> {
    if (this.cache) return;
    if (!this.loading) {
      this.loading = this.doLoad().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    const raw = await this.bridge.readLocalSharedStore();
    if (!raw.trim()) {
      this.cache = [];
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 损坏文件不静默清空:清空缓存但仍保留原始文件,由用户后续处理。
      this.cache = [];
      return;
    }
    const file = parsed as Partial<SharedStoreFile>;
    const items = Array.isArray(file.items)
      ? file.items.filter((i): i is SharedItem => assertSharedItem(i))
      : [];
    this.cache = items;
  }

  private async persist(): Promise<void> {
    const file: SharedStoreFile = { schemaVersion: SHARED_SCHEMA_VERSION, items: this.cache ?? [] };
    await this.bridge.writeLocalSharedStore(JSON.stringify(file, null, 2));
  }

  async list(): Promise<readonly SharedItem[]> {
    await this.load();
    return [...(this.cache ?? [])].sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  }
  async listByKind(kind: SharedContentKind): Promise<readonly SharedItem[]> {
    return (await this.list()).filter((i) => i.meta.kind === kind);
  }
  async get(kind: SharedContentKind, id: string): Promise<SharedItem | undefined> {
    await this.load();
    return (this.cache ?? []).find((i) => i.meta.kind === kind && i.meta.id === id);
  }
  async put(item: SharedItem): Promise<SharedItemPutResult> {
    await this.load();
    const arr = this.cache ?? [];
    const existing = arr.find((i) => i.meta.kind === item.meta.kind && i.meta.id === item.meta.id);
    const result = mergeSharedItem(existing, item);
    const target = result.item;
    if (result.mode === "unchanged") return result;
    const idx = arr.findIndex((i) => i.meta.kind === target.meta.kind && i.meta.id === target.meta.id);
    if (idx >= 0) {
      arr[idx] = target;
    } else {
      const sameKind = arr.filter((i) => i.meta.kind === target.meta.kind);
      if (sameKind.length >= SHARED_ITEMS_PER_KIND_MAX) {
        const oldest = sameKind.sort((a, b) => a.meta.updatedAt.localeCompare(b.meta.updatedAt))[0]!;
        const idxOld = arr.findIndex((i) => i.meta.kind === oldest.meta.kind && i.meta.id === oldest.meta.id);
        if (idxOld >= 0) arr.splice(idxOld, 1);
      }
      arr.push(target);
    }
    await this.persist();
    return result;
  }
  async remove(kind: SharedContentKind, id: string): Promise<void> {
    await this.load();
    this.cache = (this.cache ?? []).filter((i) => !(i.meta.kind === kind && i.meta.id === id));
    await this.persist();
  }
}
