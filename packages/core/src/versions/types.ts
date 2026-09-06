/**
 * 文章版本历史 —— 快照契约。
 *
 * 每次保存草稿时记录一个轻量快照(全文 + 元数据),支持:
 * - 时间线查看(按时间倒序);
 * - 任意两个版本差异对比(字符级 LCS diff);
 * - 一键回滚到历史版本。
 *
 * 设计约束(与项目一致):
 * - 纯 TS 零 DOM;diff 算法为确定性纯函数,可单测;
 * - 快照只存文本,不存二进制(图片 dataURL 不纳入版本对比,避免体积爆炸);
 * - 保留策略:每篇草稿最多保留 N 个版本(默认 20),按时间裁剪最旧。
 */
export const VERSION_SCHEMA_VERSION = 1;
/** 每篇草稿默认保留的版本数。 */
export const VERSION_KEEP_MAX = 20;

/** 一个文章版本快照。 */
export interface ArticleSnapshot {
  readonly id: string;
  /** 所属草稿 id。 */
  readonly draftId: string;
  readonly markdown: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  /** 快照说明(如"自动保存" / "手动保存" / "回滚自 xxx")。 */
  readonly label: string;
  readonly createdAt: string;
}

/** 版本时间线条目(摘要,不含全文)。 */
export interface VersionMeta {
  readonly id: string;
  readonly draftId: string;
  readonly label: string;
  readonly createdAt: string;
  /** 全文长度(字符数,用于展示)。 */
  readonly charCount: number;
}

/** 版本存储接口(双实现:IndexedDB / chrome.storage)。 */
export interface VersionStore {
  list(draftId: string): Promise<readonly VersionMeta[]>;
  get(id: string): Promise<ArticleSnapshot | undefined>;
  /** 记录一个快照(自动裁剪超出 VERSION_KEEP_MAX 的最旧版本)。 */
  put(snapshot: ArticleSnapshot): Promise<void>;
  remove(id: string): Promise<void>;
  /** 清空某篇草稿的全部版本(删除草稿时调用)。 */
  removeAll(draftId: string): Promise<void>;
}

/** LCS diff 操作单元。 */
export type DiffOp =
  | { readonly type: "equal"; readonly text: string }
  | { readonly type: "insert"; readonly text: string }
  | { readonly type: "delete"; readonly text: string };

/** 版本对比结果(带统计)。 */
export interface VersionDiff {
  readonly aId: string;
  readonly bId: string;
  /** 从 a 到 b 的字符级 diff。 */
  readonly ops: readonly DiffOp[];
  /** 新增字符数。 */
  readonly added: number;
  /** 删除字符数。 */
  readonly removed: number;
  /** 是否无差异。 */
  readonly identical: boolean;
}

/** 创建快照(不带裁剪)。 */
export function createSnapshot(
  input: Omit<ArticleSnapshot, "id" | "createdAt">,
  now: () => string = () => new Date().toISOString(),
): ArticleSnapshot {
  return {
    ...input,
    id: input.draftId.length > 0 ? `snap-${input.draftId.slice(0, 8)}-${Date.now().toString(36)}` : `snap-${Date.now().toString(36)}`,
    tags: [...input.tags],
    createdAt: now(),
  };
}

/**
 * 字符级 LCS diff(把字符串按 code point 切分为数组,返回编辑脚本)。
 * 纯函数、确定性;O(n*m) 时间复杂度,适用于短文(<10k 字符)版本对比。
 */
export function diffText(a: string, b: string): readonly DiffOp[] {
  if (a === b) return [{ type: "equal", text: a }];
  const A = [...a];
  const B = [...b];
  const n = A.length;
  const m = B.length;
  if (n === 0) return B.length > 0 ? [{ type: "insert", text: b }] : [];
  if (m === 0) return [{ type: "delete", text: a }];

  // DP 表:lcs[i][j] = A[0..i) 与 B[0..j) 的 LCS 长度。
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = A[i] === B[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffOp["type"], text: string) => {
    if (!text) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      ops[ops.length - 1] = { type, text: last.text + text };
    } else {
      ops.push({ type, text });
    }
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("equal", A[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push("delete", A[i]!);
      i++;
    } else {
      push("insert", B[j]!);
      j++;
    }
  }
  while (i < n) {
    push("delete", A[i]!);
    i++;
  }
  while (j < m) {
    push("insert", B[j]!);
    j++;
  }
  return ops;
}

/** 对比两个版本(从 a 到 b)。 */
export function diffVersions(a: ArticleSnapshot, b: ArticleSnapshot): VersionDiff {
  const ops = diffText(a.markdown, b.markdown);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "insert") added += [...op.text].length;
    else if (op.type === "delete") removed += [...op.text].length;
  }
  return {
    aId: a.id,
    bId: b.id,
    ops,
    added,
    removed,
    identical: added === 0 && removed === 0,
  };
}

/** 内存版本库(默认实现,供测试/无持久化环境)。 */
export class MemoryVersionStore implements VersionStore {
  private readonly items = new Map<string, ArticleSnapshot>();

  async list(draftId: string): Promise<readonly VersionMeta[]> {
    return [...this.items.values()]
      .filter((s) => s.draftId === draftId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, draftId: s.draftId, label: s.label, createdAt: s.createdAt, charCount: [...s.markdown].length }));
  }
  async get(id: string): Promise<ArticleSnapshot | undefined> {
    return this.items.get(id);
  }
  async put(snapshot: ArticleSnapshot): Promise<void> {
    this.items.set(snapshot.id, snapshot);
    await this.prune(snapshot.draftId);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async removeAll(draftId: string): Promise<void> {
    for (const [id, s] of this.items) {
      if (s.draftId === draftId) this.items.delete(id);
    }
  }

  /** 按草稿裁剪:仅保留最近 VERSION_KEEP_MAX 个(按 createdAt 倒序)。 */
  private async prune(draftId: string): Promise<void> {
    const metas = (await this.list(draftId)).map((m) => m.id);
    const keep = new Set(metas.slice(0, VERSION_KEEP_MAX));
    for (const [id, s] of this.items) {
      if (s.draftId === draftId && !keep.has(id)) this.items.delete(id);
    }
  }
}
