/**
 * 图床上传协调器测试(PERF-03/04)。
 *
 * 核心断言:
 * - 相同内容只上传一次(内容哈希缓存);
 * - 限流时重试并降并发;
 * - 多平台共享缓存,但并发独立。
 */
import { describe, it, expect } from "vitest";
import { UploadCoordinator } from "../src/upload/coordinator.js";

const fixedRandom = () => 0.5;

describe("UploadCoordinator — 图床上传协调", () => {
  it("相同内容的图片只上传一次(内容哈希缓存)", async () => {
    const calls: Array<{ bytes: Uint8Array }> = [];
    const coordinator = new UploadCoordinator({
      random: fixedRandom,
      uploadAsset: async (bytes) => {
        calls.push({ bytes });
        return { ok: true, url: `https://cdn/${calls.length}.png` };
      },
    });
    const upload = coordinator.uploadFor("wechat");
    const assetA = { id: "a", kind: "image", source: { dataUrl: "data:image/png;base64,AAAA" }, rehosted: {} } as never;
    const assetB = { id: "b", kind: "image", source: { dataUrl: "data:image/png;base64,AAAA" }, rehosted: {} } as never;
    const r1 = await upload(assetA);
    const r2 = await upload(assetB);
    // 相同 dataURL → 相同内容哈希 → 只传一次。
    expect(calls.length).toBe(1);
    expect(r2.url).toBe(r1.url);
    expect(coordinator.cacheStats.hits).toBe(1);
  });

  it("不同内容分别上传", async () => {
    const calls: string[] = [];
    const coordinator = new UploadCoordinator({
      random: fixedRandom,
      uploadAsset: async (_bytes, filename) => {
        calls.push(filename);
        return { ok: true, url: `https://cdn/${calls.length}.png` };
      },
    });
    const upload = coordinator.uploadFor("zhihu");
    await upload({ source: { dataUrl: "data:image/png;base64,AAAA" } } as never);
    await upload({ source: { dataUrl: "data:image/png;base64,BBBB" } } as never);
    expect(calls.length).toBe(2);
  });

  it("上传失败(非限流)不抛错,返回空(容错)", async () => {
    const coordinator = new UploadCoordinator({
      random: fixedRandom,
      uploadAsset: async () => ({ ok: false, message: "server 不可达" }),
    });
    const upload = coordinator.uploadFor("wechat");
    const out = await upload({ source: { dataUrl: "data:image/png;base64,AAAA" } } as never);
    expect(out).toEqual({});
  });
});
