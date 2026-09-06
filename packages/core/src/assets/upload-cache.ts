/**
 * 内容哈希上传缓存(PERF-04)。
 *
 * 目标:同一内容的图片(重复插入/多平台复用)只上传一次,上传结果按"内容哈希"复用。
 *
 * 设计约束(路线图 Phase 3):
 * - dataURL 不作为长生命周期 Map key:dataURL 体积大(可能数百 KB),且每次解析
 *   都产生新字符串;改用 computeContentHash(bytes) 的 16 位十六进制摘要作 key;
 * - LRU + TTL:最近使用优先保留;条目超过 maxBytes 时淘汰最久未用;
 * - 容量统计:totalBytes 可观测,供性能预算/缓存统计测试断言;
 * - 不可变:存入的 URL/mediaId 不因后续替换而变化(同一内容哈希命中即复用)。
 */
import { computeContentHash } from "./content-hash.js";

/** 缓存条目。 */
export interface UploadCacheEntry {
  readonly hash: string;
  readonly url?: string;
  readonly mediaId?: string;
  readonly bytes: number;
  readonly cachedAt: number;
  /** 最近访问(用于 LRU 淘汰)。 */
  lastUsed: number;
}

/** 内容哈希上传缓存选项。 */
export interface UploadCacheOptions {
  /** 容量上限(字节),默认 100MB。 */
  readonly maxBytes?: number;
  /** 条目 TTL(ms),默认 24h。 */
  readonly ttlMs?: number;
}

/** 默认容量上限(路线图:可配置,默认 <=100MB)。 */
export const UPLOAD_CACHE_DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
/** 默认 TTL:24 小时(避免陈旧 URL 长期占用)。 */
export const UPLOAD_CACHE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 内容哈希上传缓存 —— LRU + TTL + 容量上限。
 *
 * @example
 * ```ts
 * const cache = new ContentHashUploadCache();
 * // 上传前查询;未命中则 upload 并 put。
 * const hit = cache.get(hash);
 * if (!hit) { const r = await upload(...); cache.put(hash, r.url, r.mediaId, bytes); }
 * ```
 */
export class ContentHashUploadCache {
  private readonly entries = new Map<string, UploadCacheEntry>();
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;

  constructor(options: UploadCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? UPLOAD_CACHE_DEFAULT_MAX_BYTES;
    this.ttlMs = options.ttlMs ?? UPLOAD_CACHE_DEFAULT_TTL_MS;
  }

  /** 缓存条目数。 */
  get size(): number {
    return this.entries.size;
  }

  /** 当前缓存总字节数。 */
  get bytes(): number {
    return this.totalBytes;
  }

  /** 命中/未命中统计(供性能预算断言)。 */
  get stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }

  /** 查询缓存(命中则更新 LRU;过期视为未命中)。 */
  get(hash: string, now = Date.now()): UploadCacheEntry | undefined {
    const entry = this.entries.get(hash);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    // TTL 过期:移除并视为未命中。
    if (now - entry.cachedAt > this.ttlMs) {
      this.remove(hash);
      this.misses++;
      return undefined;
    }
    entry.lastUsed = now;
    this.hits++;
    return entry;
  }

  /** 写入缓存(容量超限时淘汰最久未用条目)。 */
  put(hash: string, url: string | undefined, mediaId: string | undefined, bytes: number, now = Date.now()): UploadCacheEntry {
    // 空结果不缓存。
    if (!url && !mediaId) {
      return { hash, url, mediaId, bytes, cachedAt: now, lastUsed: now };
    }
    const existing = this.entries.get(hash);
    if (existing) {
      // 已有条目:更新 lastUsed,不重复占内存。
      existing.lastUsed = now;
      return existing;
    }
    // 容量保护:新条目本身超上限则不入缓存(避免逐条淘汰抖动)。
    if (bytes > this.maxBytes) {
      return { hash, url, mediaId, bytes, cachedAt: now, lastUsed: now };
    }
    const entry: UploadCacheEntry = { hash, url, mediaId, bytes, cachedAt: now, lastUsed: now };
    this.entries.set(hash, entry);
    this.totalBytes += bytes;
    this.evictIfNeeded();
    return entry;
  }

  /** 显式移除条目。 */
  remove(hash: string): void {
    const entry = this.entries.get(hash);
    if (!entry) return;
    this.entries.delete(hash);
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
  }

  /** 清空。 */
  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /** 容量超限时按 LRU 淘汰(从最久未用开始),直到 totalBytes <= maxBytes。 */
  private evictIfNeeded(): void {
    if (this.totalBytes <= this.maxBytes) return;
    // 按 lastUsed 升序(最久未用在前)淘汰。
    const sorted = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of sorted) {
      if (this.totalBytes <= this.maxBytes) break;
      this.remove(entry.hash);
    }
  }
}

/** 便捷:对图片字节计算缓存键(SHA-256 前缀,非 dataURL 本身)。 */
export async function uploadCacheKey(bytes: Uint8Array): Promise<string> {
  return computeContentHash(bytes);
}
