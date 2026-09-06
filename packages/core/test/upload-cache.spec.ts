/**
 * 内容哈希上传缓存测试(PERF-04)。
 *
 * 核心断言:
 * - 相同内容哈希命中复用(不重复上传);
 * - dataURL 不作为 key(用内容哈希);
 * - LRU:容量超限时淘汰最久未用;
 * - TTL:过期条目视为未命中;
 * - 统计可观测(hits/misses/bytes)。
 */
import { describe, it, expect } from "vitest";
import { ContentHashUploadCache, uploadCacheKey, UPLOAD_CACHE_DEFAULT_MAX_BYTES } from "../src/assets/upload-cache.js";

describe("ContentHashUploadCache — 内容哈希上传缓存", () => {
  it("put 后 get 命中,返回同一 URL/mediaId", () => {
    const cache = new ContentHashUploadCache();
    cache.put("hash-1", "https://cdn/x.png", "MEDIA_1", 1000);
    const hit = cache.get("hash-1");
    expect(hit?.url).toBe("https://cdn/x.png");
    expect(hit?.mediaId).toBe("MEDIA_1");
    expect(cache.stats.hits).toBe(1);
    expect(cache.stats.misses).toBe(0);
  });

  it("未命中返回 undefined 并计数 miss", () => {
    const cache = new ContentHashUploadCache();
    expect(cache.get("nope")).toBeUndefined();
    expect(cache.stats.misses).toBe(1);
  });

  it("空结果不缓存(下次仍 miss)", () => {
    const cache = new ContentHashUploadCache();
    cache.put("hash", undefined, undefined, 100);
    expect(cache.get("hash")).toBeUndefined();
  });

  it("容量超限时淘汰最久未用条目(LRU)", () => {
    const cache = new ContentHashUploadCache({ maxBytes: 250 });
    cache.put("a", "u1", undefined, 100, 1000);
    cache.put("b", "u2", undefined, 100, 2000);
    // 访问 a,使 b 成为最久未用。
    cache.get("a", 3000);
    // 再放 c(100):总量 300 > 250,必须淘汰最久未用的 b。
    cache.put("c", "u3", undefined, 100, 4000);
    expect(cache.bytes).toBeLessThanOrEqual(250);
    // b 被淘汰,a 仍在(最近访问),c 保留。
    expect(cache.get("b", 5000)).toBeUndefined();
    expect(cache.get("a", 5000)?.url).toBe("u1");
    expect(cache.get("c", 5000)?.url).toBe("u3");
  });

  it("TTL 过期后视为未命中", () => {
    const cache = new ContentHashUploadCache({ ttlMs: 1000 });
    cache.put("hash", "u", undefined, 100, 1000);
    expect(cache.get("hash", 1500)?.url).toBe("u"); // 未过期
    expect(cache.get("hash", 3000)).toBeUndefined(); // 已过期
    expect(cache.stats.misses).toBe(1);
  });

  it("超大条目不缓存(避免逐条淘汰抖动)", () => {
    const cache = new ContentHashUploadCache({ maxBytes: 100 });
    cache.put("big", "u", undefined, 10 * 1024 * 1024);
    expect(cache.size).toBe(0);
    expect(cache.get("big")).toBeUndefined();
  });

  it("默认容量上限为 100MB", () => {
    expect(UPLOAD_CACHE_DEFAULT_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  it("uploadCacheKey 对同一字节稳定(内容寻址,非 dataURL)", async () => {
    const bytes = new TextEncoder().encode("same-image-bytes");
    const k1 = await uploadCacheKey(bytes);
    const k2 = await uploadCacheKey(new TextEncoder().encode("same-image-bytes"));
    expect(k1).toBe(k2);
    // key 是哈希(短),不是原始字节。
    expect(k1.length).toBeLessThan(32);
  });
});
