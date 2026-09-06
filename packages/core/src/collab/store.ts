/**
 * v4 Phase 3 · COLLAB-01 共享库内存实现 + 约束工具。
 *
 * `MemorySharedStore`:默认实现(Web/扩展在 app 侧用 IndexedDB/chrome.storage;
 * server 用 JSON 文件落盘)。这里提供纯内存实现供测试与无持久化环境复用。
 */
import type { SharedItem, SharedContentKind, SharedItemPutResult, SharedStore } from "./types.js";
import { SHARED_SCHEMA_VERSION, SHARED_ITEMS_PER_KIND_MAX } from "./types.js";

/**
 * 版本化冲突合并:同 id 并发覆盖时保留双版本。
 *
 * 规则(COLLAB-01 版本化,延续 ROADMAP_V4 §5「共享内容只读版本化」):
 * - 不存在 → created(原样写入);
 * - 内容一致(deep-equal payload + meta 关键字段)→ unchanged(空操作,不生成噪声版本);
 * - 顺序覆盖(新版本基于旧版本演进,updatedAt 更晚且同源)→ updated(替换原 id,版本号取 max+1);
 * - 并发冲突(两个分支各自基于同一旧版本演进,无法判定先后,或不同来源同时写入)→
 *   **保留双版本**:新版本以 `原id#v{新版本号}` 后缀写入,旧版本保留在原 id 下;
 *   列表按 updatedAt 倒序,冲突双方都会出现,用户可自行取舍。
 */
export function mergeSharedItem(existing: SharedItem | undefined, incoming: SharedItem): SharedItemPutResult {
  if (!existing) {
    return { mode: "created", item: incoming };
  }
  const existingBase = existing.meta.version ?? 1;
  const incomingBase = incoming.meta.version ?? 1;
  // 内容一致且版本/时间不更新 → 空操作(避免重复推送产生无意义版本);
  // 若 payload 一致但版本/时间明确更新,仍视为一次版本化更新。
  if (JSON.stringify(existing.payload) === JSON.stringify(incoming.payload)) {
    const notNewer = incomingBase <= existingBase && incoming.meta.updatedAt <= existing.meta.updatedAt;
    if (notNewer) {
      return { mode: "unchanged", item: existing, existing };
    }
  }
  // 顺序覆盖:新版本基于旧版本演进(来源一致且版本递增,或更新时间明确更晚且不落后)。
  const sameSource =
    !!existing.meta.sourceName && existing.meta.sourceName === incoming.meta.sourceName;
  const incomingNewer = incoming.meta.updatedAt >= existing.meta.updatedAt;
  const seqAdvance = incomingBase > existingBase;
  const isSequential = sameSource && (seqAdvance || incomingNewer);
  if (isSequential) {
    return {
      mode: "updated",
      item: { ...incoming, meta: { ...incoming.meta, version: Math.max(incomingBase, existingBase + 1) } },
      existing,
    };
  }
  // 并发冲突:保留双版本。新版本以 `id#v{n}` 后缀写入,版本号在双方最大基础上 +1。
  const nextVersion = Math.max(incomingBase, existingBase) + 1;
  const conflicted: SharedItem = {
    ...incoming,
    meta: {
      ...incoming.meta,
      id: `${incoming.meta.id}#v${nextVersion}`,
      version: nextVersion,
      sourceName: incoming.meta.sourceName || existing.meta.sourceName || "未知来源",
      title: existing.meta.title === incoming.meta.title ? incoming.meta.title : `${incoming.meta.title}(冲突版本 v${nextVersion})`,
      updatedAt: new Date().toISOString(),
    },
  };
  return { mode: "conflict", item: conflicted, existing };
}

/** 内存共享库(测试 / 无持久化环境默认)。 */
export class MemorySharedStore implements SharedStore {
  readonly schemaVersion = SHARED_SCHEMA_VERSION;
  private items: SharedItem[] = [];

  async list(): Promise<readonly SharedItem[]> {
    return [...this.items].sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  }
  async listByKind(kind: SharedContentKind): Promise<readonly SharedItem[]> {
    return (await this.list()).filter((i) => i.meta.kind === kind);
  }
  async get(kind: SharedContentKind, id: string): Promise<SharedItem | undefined> {
    return this.items.find((i) => i.meta.kind === kind && i.meta.id === id);
  }
  async put(item: SharedItem): Promise<SharedItemPutResult> {
    const existing = this.getSync(item.meta.kind, item.meta.id);
    const result = mergeSharedItem(existing, item);
    const target = result.item;
    if (result.mode === "unchanged") return result;
    const idx = this.items.findIndex((i) => i.meta.kind === target.meta.kind && i.meta.id === target.meta.id);
    if (idx >= 0) {
      this.items[idx] = target;
    } else {
      // 每类上限裁剪(保留最新,防止无限增长)。
      const sameKind = this.items.filter((i) => i.meta.kind === target.meta.kind);
      if (sameKind.length >= SHARED_ITEMS_PER_KIND_MAX) {
        const oldest = sameKind.sort((a, b) => a.meta.updatedAt.localeCompare(b.meta.updatedAt))[0]!;
        this.items = this.items.filter((i) => !(i.meta.kind === oldest.meta.kind && i.meta.id === oldest.meta.id));
      }
      this.items.push(target);
    }
    return result;
  }

  private getSync(kind: SharedContentKind, id: string): SharedItem | undefined {
    return this.items.find((i) => i.meta.kind === kind && i.meta.id === id);
  }
  async remove(kind: SharedContentKind, id: string): Promise<void> {
    this.items = this.items.filter((i) => !(i.meta.kind === kind && i.meta.id === id));
  }
}

/** 校验共享条目 schema(损坏/旧版本检测)。 */
export function assertSharedItem(value: unknown): value is SharedItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const meta = v.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object") return false;
  return (
    typeof meta.kind === "string" &&
    typeof meta.id === "string" &&
    typeof meta.title === "string" &&
    typeof meta.updatedAt === "string" &&
    typeof v.payload === "object" &&
    v.payload !== null
  );
}

/** 单条共享内容的版本号 +1(本地覆盖时用)。 */
export function bumpSharedVersion(item: SharedItem): SharedItem {
  return {
    ...item,
    meta: { ...item.meta, version: item.meta.version + 1, updatedAt: new Date().toISOString() },
  };
}
