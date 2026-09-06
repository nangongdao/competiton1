/**
 * 图床上传协调器(PERF-03/04)—— 内容哈希缓存 + 自适应并发调度 + 429 退避。
 *
 * 在 app 侧把两套原语接线到真实发布的上传链路:
 * - ContentHashUploadCache:同一内容的图片只上传一次(dataURL 不作 key,用内容哈希);
 * - UploadScheduler:每平台独立 AIMD 并发控制 + Retry-After/指数退避 + 抖动;
 * - 单图失败不阻断整篇(返回空结果,由 rehost-engine 上报失败明细)。
 */
import type { Asset } from "@mpp/core";
import {
  ContentHashUploadCache,
  UploadScheduler,
  RateLimitedError,
  uploadCacheKey,
  UPLOAD_CACHE_DEFAULT_MAX_BYTES,
} from "@mpp/core";

/** 上传协调器选项。 */
export interface UploadCoordinatorOptions {
  readonly uploadAsset: (bytes: Uint8Array, filename: string, mime: string) => Promise<{ url?: string; mediaId?: string; ok: boolean; message?: string }>;
  /** 缓存容量上限(默认 100MB)。 */
  readonly maxCacheBytes?: number;
  /** 随机源(测试注入)。 */
  readonly random?: () => number;
}

/** 平台级调度器缓存。 */
const schedulers = new Map<string, UploadScheduler>();

/**
 * 图床上传协调器:为每个平台维护独立调度器,共享内容哈希缓存。
 */
export class UploadCoordinator {
  private readonly cache: ContentHashUploadCache;
  private readonly uploadAsset: UploadCoordinatorOptions["uploadAsset"];
  private readonly random: () => number;

  constructor(options: UploadCoordinatorOptions) {
    this.cache = new ContentHashUploadCache({ maxBytes: options.maxCacheBytes ?? UPLOAD_CACHE_DEFAULT_MAX_BYTES });
    this.uploadAsset = options.uploadAsset;
    this.random = options.random ?? Math.random;
  }

  get cacheStats() {
    return this.cache.stats;
  }

  /** 为平台构造 RehostContext.upload(带缓存 + 自适应并发)。 */
  uploadFor(platformId: string): (asset: Asset) => Promise<{ url?: string; mediaId?: string }> {
    let scheduler = schedulers.get(platformId);
    if (!scheduler) {
      scheduler = new UploadScheduler({ platformId, random: this.random });
      schedulers.set(platformId, scheduler);
    }
    const wrapped = scheduler.wrap(async (asset) => {
      const src = asset.source.dataUrl ?? asset.source.url ?? "";
      if (!src) return {};
      const decoded = await fetchAssetBytes(src);
      if (!decoded) return {};
      // 内容哈希缓存键(SHA-256 前缀,不是 dataURL 本身)。
      const hash = await uploadCacheKey(decoded.bytes);
      const hit = this.cache.get(hash);
      if (hit && (hit.url || hit.mediaId)) {
        return { url: hit.url, mediaId: hit.mediaId };
      }
      const result = await this.uploadAsset(decoded.bytes, `${asset.id}.${extFromMime(decoded.mime)}`, decoded.mime);
      if (result.ok && (result.url || result.mediaId)) {
        this.cache.put(hash, result.url, result.mediaId, decoded.bytes.byteLength);
        return { url: result.url, mediaId: result.mediaId };
      }
      // 上传失败:429 降并发重试由 scheduler 处理;其它失败返回空(容错)。
      if (result.message?.toLowerCase().includes("429") || result.message?.toLowerCase().includes("rate limit")) {
        throw new RateLimitedError(result.message ?? "限流");
      }
      return {};
    });
    return wrapped;
  }

  /** 动态并发数(供 RehostContext.concurrency 使用)。 */
  concurrencyFor(platformId: string): number {
    return schedulers.get(platformId)?.concurrency ?? 6;
  }
}

/** 取资产字节:dataURL 直接解码;http(s) URL 则 fetch。 */
async function fetchAssetBytes(src: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    if (src.startsWith("data:")) {
      const res = await fetch(src);
      const blob = await res.blob();
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/png" };
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/png" };
  } catch {
    return null;
  }
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "png";
}
