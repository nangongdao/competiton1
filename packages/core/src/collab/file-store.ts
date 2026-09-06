/**
 * v4 Phase 3 · COLLAB-01 共享库文件存储 —— 版本化 JSON 落盘 + 并发冲突保留双版本。
 *
 * 与 JOB-02 FileJobStore 同基线:
 * - 版本化 JSON + 原子写(tmp + rename,崩溃不产生半写文件);
 * - 损坏检测:JSON 解析失败 / 记录不符 schema → 明确报错,不静默清空;
 * - 保留策略:每类共享内容上限(SHARED_ITEMS_PER_KIND_MAX),超出裁剪最旧;
 * - 目录可配置,进程重启后从磁盘完整重建共享库;
 * - **版本化冲突合并**:同 id 并发覆盖时经 `mergeSharedItem` 保留双版本
 *   (新版本以 `id#v{n}` 后缀写入,旧版本保留在原 id 下)。
 *
 * 用途:
 * - server 侧把局域网共享库落盘(data/shared-items.json);
 * - 桌面端 Tauri bridge 复用同一实现读写本地共享库(见 packages/app 的 Tauri 桥),
 *   保证「共享库由 server 持有」之外桌面端也有本地可离线访问的副本。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SharedItem, SharedContentKind, SharedItemPutResult, SharedStore } from "./types.js";
import { SHARED_SCHEMA_VERSION, SHARED_ITEMS_PER_KIND_MAX } from "./types.js";
import { assertSharedItem, mergeSharedItem } from "./store.js";

/** 落盘文件的结构(版本化)。 */
interface SharedStoreFile {
  readonly schemaVersion: number;
  readonly items: readonly SharedItem[];
}

export class SharedStoreFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedStoreFileError";
  }
}

/** 共享库的 JSON 文件存储实现(Node fs,server / 桌面端 bridge 复用)。 */
export class FileSharedStore implements SharedStore {
  readonly schemaVersion = SHARED_SCHEMA_VERSION;
  private readonly file: string;
  private cache: SharedItem[] | null = null;

  constructor(dataDir: string) {
    this.file = resolve(dataDir, "shared-items.json");
  }

  get filePath(): string {
    return this.file;
  }

  private async loadLocked(): Promise<void> {
    if (this.cache) return;
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = [];
        return;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SharedStoreFileError("共享库文件损坏(JSON 解析失败)");
    }
    if (typeof parsed !== "object" || parsed === null) throw new SharedStoreFileError("共享库文件结构损坏");
    const file = parsed as Partial<SharedStoreFile>;
    if (!Array.isArray(file.items)) throw new SharedStoreFileError("共享库文件缺少 items 数组");
    if (!file.items.every(assertSharedItem)) throw new SharedStoreFileError("共享库包含损坏条目(不符 schema)");
    this.cache = [...file.items];
  }

  private async persist(): Promise<void> {
    const file: SharedStoreFile = { schemaVersion: SHARED_SCHEMA_VERSION, items: this.cache ?? [] };
    const tmp = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  async list(): Promise<readonly SharedItem[]> {
    await this.loadLocked();
    return [...(this.cache ?? [])].sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  }

  async listByKind(kind: SharedContentKind): Promise<readonly SharedItem[]> {
    return (await this.list()).filter((i) => i.meta.kind === kind);
  }

  async get(kind: SharedContentKind, id: string): Promise<SharedItem | undefined> {
    await this.loadLocked();
    return (this.cache ?? []).find((i) => i.meta.kind === kind && i.meta.id === id);
  }

  async put(item: SharedItem): Promise<SharedItemPutResult> {
    await this.loadLocked();
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
    await this.loadLocked();
    this.cache = (this.cache ?? []).filter((i) => !(i.meta.kind === kind && i.meta.id === id));
    await this.persist();
  }
}
