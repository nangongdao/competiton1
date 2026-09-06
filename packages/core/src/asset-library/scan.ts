/**
 * ROADMAP_V5 Phase 3 · 内容资产库 —— 索引构建 / 检索 / 清理(纯函数)。
 *
 * 职责:
 * - `extractImageReferences`:从草稿 Markdown 抽取图片引用(dataURL / http(s) 外链);
 * - `buildAssetRecord`:把抽取结果/平台产物/快照归一化为 `AssetRecord`(去重幂等);
 * - `buildAssetLibraryIndex`:从草稿 + 发布历史 + 版本快照 + 队列/批次增量构建索引
 *   (同 (draftId, kind, reference) 幂等合并,返回新增/更新统计);
 * - `searchAssetLibrary`:本地确定性检索(标题/平台/引用/类型加权评分);
 * - `pruneAssetLibrary`:按保留策略裁剪(条数上限 + 终态来源 TTL)。
 *
 * 设计原则(延续 ROADMAP_V5 §5):
 * - 纯 TS、零 DOM;`searchAssetLibrary` / `extractImageReferences` 可单测;
 * - 索引不含密钥;dataURL 只存**短哈希 + 字节数**,不落完整 dataURL;
 * - `buildAssetLibraryIndex` 接受一个 `putMany` 存储写入口,由接线方(store 单例)提供。
 */
import type {
  AssetRecord,
  AssetSourceRef,
  AssetHit,
  NewAssetRecord,
  SearchAssetOptions,
} from "./types.js";
import type { PublishQueueEntry } from "../publish-queue/types.js";
import type { PublishBatch } from "../publish-batch/types.js";
import { ASSET_LIBRARY_MAX, ASSET_LIBRARY_RETENTION_DAYS } from "./types.js";

/** 已存在的资产集合(用于幂等合并)。 */
export interface AssetIndexContext {
  list(): Promise<readonly AssetRecord[]>;
  putMany(records: readonly AssetRecord[]): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 从 Markdown 抽取的图片引用。 */
export interface ExtractedImage {
  /** dataURL(完整) 或 http(s) URL。 */
  readonly reference: string;
  /** dataURL 资产的 MIME(外链为空)。 */
  readonly mime?: string;
  /** dataURL 解码后的字节数。 */
  readonly bytes?: number;
}

/** dataURL 正则(与 ir 解析一致)。 */
const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

/** 计算图片内容短哈希(用于 dataURL 引用,避免完整 dataURL 落盘)。 */
export function dataUrlShortHash(dataUrl: string): string {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return "";
  const b64 = m[2] ?? "";
  // FNV-1a 风格的确定性 8 位十六进制(纯同步、跨环境稳定)。
  let h = 0x811c9dc5;
  for (let i = 0; i < b64.length; i++) {
    h ^= b64.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `data:${m[1]};hash:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * 从 Markdown 抽取全部图片引用。
 * - 过滤 markdown 图片语法 `![alt](url)`;
 * - dataURL 归一化为「短哈希引用」(`data:<mime>;hash:<8hex>`)并记录字节数;
 * - 外链保留完整 http(s) URL(供复制/下载);
 * - 忽略空 / 非图片引用(如相对路径链接)。
 */
export function extractImageReferences(markdown: string): readonly ExtractedImage[] {
  const out: ExtractedImage[] = [];
  const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(markdown)) !== null) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    const dm = DATA_URL_RE.exec(raw);
    if (dm) {
      const b64 = dm[2] ?? "";
      out.push({
        reference: dataUrlShortHash(raw),
        mime: dm[1],
        bytes: Math.floor((b64.length * 3) / 4),
      });
    } else if (/^https?:\/\//i.test(raw)) {
      out.push({ reference: raw });
    }
    // 其余(相对路径等)忽略 —— 不是可索引的远端资源。
  }
  return out;
}

/** 构建一条资产记录(幂等:同 draftId + kind + reference 视为同一条)。 */
export function buildAssetRecord(input: NewAssetRecord): AssetRecord {
  const now = new Date().toISOString();
  const refKind = input.refKind ?? (input.reference.startsWith("http") ? "url" : input.reference.startsWith("data:") ? "hash" : "text");
  return {
    id: input.id ?? assetRecordId(input),
    kind: input.kind,
    title: input.title.trim() || "未命名资产",
    ...(input.platformId ? { platformId: input.platformId } : {}),
    reference: input.reference,
    refKind,
    ...(input.draftId ? { draftId: input.draftId } : {}),
    source: input.source,
    ...(input.bytes !== undefined ? { bytes: input.bytes } : {}),
    ...(input.mime ? { mime: input.mime } : {}),
    ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.metrics ? { metrics: input.metrics } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** 幂等 id:封面按 (draftId+kind) 稳定(引用变化即更新);其余按来源+引用摘要。 */
export function assetRecordId(input: NewAssetRecord): string {
  const base = input.draftId ?? sourceKey(input.source);
  if (input.kind === "cover") {
    // 封面是「一篇草稿的封面」,引用变化(标题改)应原地更新,不产生新记录。
    return `asset-${simpleHash(`${base}|cover|${input.platformId ?? "*"}`)}`;
  }
  const ref = input.reference.startsWith("data:")
    ? input.reference
    : input.reference.length > 64
      ? `${input.reference.slice(0, 32)}…${input.reference.slice(-16)}`
      : input.reference;
  return `asset-${simpleHash(`${base}|${input.kind}|${ref}|${input.platformId ?? "*"}`)}`;
}

function sourceKey(source: AssetSourceRef): string {
  switch (source.from) {
    case "draft":
      return source.draftId;
    case "job":
      return source.jobId;
    case "batch":
      return `${source.batchId}${source.itemId ? `:${source.itemId}` : ""}`;
    case "queue":
      return source.queueId;
    case "manual":
      return "manual";
  }
}

/** 确定性字符串哈希(FNV-1a 32 位 → 8 位十六进制)。 */
export function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 标题抽取:取 Markdown 首个一级标题。 */
export function titleOfMarkdown(markdown: string): string {
  const m = /^#\s+(.+)$/m.exec(markdown.trim());
  return m?.[1]?.trim() ?? "未命名草稿";
}

/**
 * 从草稿构建索引(封面 + 图床引用)。
 *
 * - 封面:以「草稿标题 + 平台 *」记一条 `cover` 记录(引用为标题文本,refKind=text);
 * - 图床:每张图一条 `rehost` 记录(引用 = 外链 URL 或 dataURL 短哈希)。
 */
export function indexAssetFromDraft(
  draftId: string,
  title: string,
  markdown: string,
  platformId?: string,
): readonly NewAssetRecord[] {
  const out: NewAssetRecord[] = [];
  const finalTitle = title.trim() || titleOfMarkdown(markdown);
  out.push({
    kind: "cover",
    title: finalTitle,
    reference: finalTitle,
    refKind: "text",
    draftId,
    source: { from: "draft", draftId },
  });
  for (const img of extractImageReferences(markdown)) {
    out.push({
      kind: "rehost",
      title: finalTitle,
      platformId: platformId ?? "*",
      reference: img.reference,
      refKind: img.reference.startsWith("http") ? "url" : "hash",
      draftId,
      source: { from: "draft", draftId },
      bytes: img.bytes,
      mime: img.mime,
    });
  }
  return out;
}

/** 从发布队列条目构建索引(排队即登记,便于追溯待发布资产)。 */
export function indexAssetFromQueueEntry(entry: PublishQueueEntry): readonly NewAssetRecord[] {
  const refs: NewAssetRecord[] = [];
  const platforms = entry.platformIds.length > 0 ? entry.platformIds : ["*"];
  for (const pid of platforms) {
    refs.push({
      kind: "artifact",
      title: entry.name,
      platformId: pid,
      reference: `queue:${entry.id}`,
      refKind: "text",
      draftId: entry.draftId,
      source: { from: "queue", queueId: entry.id },
      taskId: entry.jobId,
    });
  }
  return refs;
}

/** 从发布批次条目构建索引(每篇一个 artifact 记录)。 */
export function indexAssetFromBatch(batch: PublishBatch): readonly NewAssetRecord[] {
  const refs: NewAssetRecord[] = [];
  for (const item of batch.items) {
    const platforms = item.platformIds.length > 0 ? item.platformIds : ["*"];
    for (const pid of platforms) {
      const receipt = item.receipts?.find((r) => r.platformId === pid);
      refs.push({
        kind: "artifact",
        title: item.draftTitle || batch.name,
        platformId: pid,
        reference: receipt?.remoteUrl ?? `batch:${batch.id}:${item.itemId}`,
        refKind: receipt?.remoteUrl ? "url" : "text",
        draftId: item.draftId,
        source: { from: "batch", batchId: batch.id, itemId: item.itemId },
        taskId: item.jobId,
      });
    }
  }
  return refs;
}

/**
 * 从已有索引 + 新增数据增量构建(幂等合并)。
 *
 * @param context 现有索引(提供 list / putMany)
 * @param drafts 草稿列表
 * @param queueEntries 发布队列条目
 * @param batches 发布批次
 * @returns 新增/更新/忽略统计
 */
export async function buildAssetLibraryIndex(
  context: AssetIndexContext,
  drafts: readonly { id: string; title: string; markdown: string }[],
  queueEntries: readonly PublishQueueEntry[] = [],
  batches: readonly PublishBatch[] = [],
): Promise<{ total: number; added: number; updated: number; ignored: number }> {
  const existing = await context.list();
  const byKey = new Map(existing.map((r) => [r.id, r]));
  const newRecords: AssetRecord[] = [];
  const removedIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let ignored = 0;

  const push = (input: NewAssetRecord) => {
    if (!assertAssetRecordInput(input)) {
      ignored++;
      return;
    }
    const rec = buildAssetRecord(input);
    const cur = byKey.get(rec.id);
    if (cur) {
      // 引用变化视为更新(如重托管 URL 变更)。
      if (cur.reference !== rec.reference || cur.updatedAt !== rec.updatedAt) {
        byKey.set(rec.id, rec);
        newRecords.push(rec);
        updated++;
      }
    } else {
      byKey.set(rec.id, rec);
      newRecords.push(rec);
      added++;
    }
  };

  for (const d of drafts) {
    const draftNew: AssetRecord[] = [];
    for (const r of indexAssetFromDraft(d.id, d.title, d.markdown)) {
      const rec = buildAssetRecord(r);
      draftNew.push(rec);
      push(r);
    }
    // 该草稿已生成的有效 id 集合(用于清除陈旧记录,如标题变化后的旧封面)。
    const draftValid = new Set(draftNew.map((r) => r.id));
    for (const rec of existing) {
      if (rec.draftId === d.id && rec.source.from === "draft" && !draftValid.has(rec.id)) {
        if (byKey.has(rec.id)) byKey.delete(rec.id);
        removedIds.add(rec.id);
      }
    }
  }
  for (const q of queueEntries) {
    for (const r of indexAssetFromQueueEntry(q)) push(r);
  }
  for (const b of batches) {
    for (const r of indexAssetFromBatch(b)) push(r);
  }

  if (newRecords.length > 0) {
    await context.putMany(newRecords);
  }
  for (const id of removedIds) {
    await context.remove(id);
  }
  return { total: byKey.size, added, updated, ignored };
}

function assertAssetRecordInput(input: NewAssetRecord): boolean {
  return typeof input.title === "string" && typeof input.reference === "string" && input.reference.length > 0;
}

/** 检索词切分(与 draft-index 对齐:中文 1-4 字 + 英数 token)。 */
export function tokenizeAssetQuery(query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (q.match(/[\u4e00-\u9fa5]{1,4}|[a-z0-9][a-z0-9_-]{1,}/g) ?? []) as string[];
}

/** 平台中文别名(供检索命中)。 */
const PLATFORM_ALIASES: Readonly<Record<string, string>> = {
  wechat: "微信公众号",
  zhihu: "知乎",
  bilibili: "哔哩哔哩 b站",
  xiaohongshu: "小红书",
  juejin: "掘金",
  cnblogs: "博客园",
  csdn: "csdn",
};

/**
 * 本地确定性检索(标题/平台/引用/类型加权评分,离线可用)。
 */
export function searchAssetLibrary(
  records: readonly AssetRecord[],
  query: string,
  options: SearchAssetOptions = {},
): readonly AssetHit[] {
  const limit = options.limit ?? 20;
  const minScore = options.minScore ?? 0.1;
  const filtered = options.kind ? records.filter((r) => r.kind === options.kind) : records;
  const tokens = tokenizeAssetQuery(query);
  if (tokens.length === 0 || filtered.length === 0) return [];

  const scored: Array<{ record: AssetRecord; score: number }> = [];
  for (const r of filtered) {
    const titleLower = r.title.toLowerCase();
    const refLower = r.reference.toLowerCase();
    const platformLower = (r.platformId ?? "*").toLowerCase();
    const platformAlias = r.platformId ? (PLATFORM_ALIASES[r.platformId] ?? "").toLowerCase() : "";
    let score = 0;
    for (const tok of tokens) {
      let hit = 0;
      if (titleLower.includes(tok)) hit += 3;
      if (platformLower.includes(tok) || (platformAlias && platformAlias.includes(tok))) hit += 2;
      if (refLower.includes(tok)) hit += 1.5;
      if (r.kind === "cover" && refLower.includes(tok)) hit += 2;
      if (hit > 0) score += hit;
    }
    if (score > 0) {
      const norm = score / (tokens.length * 3);
      scored.push({ record: r, score: Math.min(1, norm) });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((s) => s.score >= minScore)
    .map((s) => ({ record: s.record, score: Math.round(s.score * 100) / 100 }));
}

/** 按保留策略裁剪:条数上限 + 终态来源(job/batch/queue 已完结)TTL。 */
export async function pruneAssetLibrary(
  context: AssetIndexContext,
  now: Date = new Date(),
  max = ASSET_LIBRARY_MAX,
): Promise<number> {
  const all = await context.list();
  let removed = 0;
  // 第一步:清理超过保留期的终态来源记录(job/batch/queue),草稿来源保留。
  const cutoff = now.getTime() - ASSET_LIBRARY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const r of all) {
    const from = r.source.from;
    if (from === "job" || from === "batch" || from === "queue") {
      if (Date.parse(r.updatedAt) < cutoff) {
        await context.remove(r.id);
        removed++;
      }
    }
  }
  // 第二步:超过条数上限时,优先从最旧的终态来源记录裁剪到上限。
  const remaining = await context.list();
  if (remaining.length > max) {
    const overflow = remaining.length - max;
    const droppable = remaining
      .filter((r) => {
        const from = r.source.from;
        return from === "job" || from === "batch" || from === "queue";
      })
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (let i = 0; i < Math.min(overflow, droppable.length); i++) {
      await context.remove(droppable[i]!.id);
      removed++;
    }
  }
  return removed;
}
