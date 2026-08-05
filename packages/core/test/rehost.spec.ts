import { describe, it, expect } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import { syncToPlatforms } from "../src/sync/sync-engine.js";
import { rehostDocumentAssets } from "../src/assets/rehost-engine.js";
import { getAdapter } from "../src/adapters/registry.js";
import type { RehostContext } from "../src/adapters/types.js";
import type { Asset, Document } from "../src/ir/types.js";

const fixedNow = () => "2026-01-01T00:00:00.000Z";
const WITH_IMG = "# 标题\n\n正文。\n\n![配图](https://orig.example.com/a.png)";

describe("rehostDocumentAssets — 资产重托管回填", () => {
  it("把上传结果回填到 asset.rehosted[platformId]", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("wechat")!;
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => ({ url: "https://mp.weixin.qq.com/rehosted.png", mediaId: "MEDIA_1" }),
    };
    const out = await rehostDocumentAssets(adapter, doc, ctx);
    const img = out.assets.find((a) => a.kind === "image");
    expect(img?.rehosted["wechat"]?.url).toBe("https://mp.weixin.qq.com/rehosted.png");
    expect(img?.rehosted["wechat"]?.mediaId).toBe("MEDIA_1");
  });

  it("幂等:已重托管的资产跳过 upload", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("wechat")!;
    let calls = 0;
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => {
        calls++;
        return { url: "https://mp/x.png" };
      },
    };
    const once = await rehostDocumentAssets(adapter, doc, ctx);
    const twice = await rehostDocumentAssets(adapter, once, ctx);
    expect(calls).toBe(1); // 第二次跳过
    expect(twice.assets.find((a) => a.kind === "image")?.rehosted["wechat"]?.url).toBe("https://mp/x.png");
  });

  it("单图上传失败不阻断,保留原始引用", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("wechat")!;
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => {
        throw new Error("网络错误");
      },
    };
    const out = await rehostDocumentAssets(adapter, doc, ctx);
    const img = out.assets.find((a) => a.kind === "image");
    expect(img?.rehosted["wechat"]).toBeUndefined();
    expect(img?.source.url).toBe("https://orig.example.com/a.png");
  });

  it("重托管失败时经 onFailure 上报明细(不阻断整篇)", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("wechat")!;
    const failures: Array<{ assetId: string; sourceUrl: string; platformId: string; reason: string }> = [];
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => {
        throw new Error("图床超时");
      },
    };
    const out = await rehostDocumentAssets(adapter, doc, ctx, undefined, (f) => failures.push(f));
    // 文档仍被返回(不因单图失败中断),且失败明细被收集。
    expect(out.assets.find((a) => a.kind === "image")?.source.url).toBe("https://orig.example.com/a.png");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.platformId).toBe("wechat");
    expect(failures[0]!.reason).toBe("图床超时");
    expect(failures[0]!.sourceUrl).toBe("https://orig.example.com/a.png");
  });

  it("图床返回空结果时也上报失败明细", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("wechat")!;
    const failures: string[] = [];
    const ctx: RehostContext = { platformId: "wechat", upload: async () => ({}) };
    await rehostDocumentAssets(adapter, doc, ctx, undefined, (f) => failures.push(f.reason));
    expect(failures).toEqual(["图床返回空结果"]);
  });

  it("无图文档原样返回", async () => {
    const doc = markdownToIR("# 标题\n\n纯文字").document;
    const adapter = getAdapter("wechat")!;
    const ctx: RehostContext = { platformId: "wechat", upload: async () => ({ url: "x" }) };
    const out = await rehostDocumentAssets(adapter, doc, ctx);
    expect(out).toBe(doc);
  });

  it("跳过变换生成的占位资产(表格图/公式图)", async () => {
    // B站会把表格转为 generated 占位图;这类不应被重托管。
    const doc = markdownToIR("# 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![真图](https://e.com/real.png)").document;
    const adapter = getAdapter("bilibili")!;
    const processed = adapter.preprocess(doc);
    const uploadedSources: string[] = [];
    const ctx: RehostContext = {
      platformId: "bilibili",
      upload: async (asset) => {
        uploadedSources.push(asset.source.url ?? asset.source.dataUrl ?? "");
        return { url: "https://i0.hdslb.com/x.png" };
      },
    };
    await rehostDocumentAssets(adapter, processed, ctx);
    // 只应上传真实图,不含 table:/equation 占位。
    expect(uploadedSources.some((s) => s.includes("real.png"))).toBe(true);
    expect(uploadedSources.some((s) => s.startsWith("table:"))).toBe(false);
    expect(uploadedSources.some((s) => s.includes("equation"))).toBe(false);
  });
});

describe("syncToPlatforms — 重托管接线", () => {
  it("注入 rehost 后产物 img 指向重托管 URL", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => ({ url: "https://mp.weixin.qq.com/cdn/rehosted.png" }),
    };
    const results = await syncToPlatforms(doc, ["wechat"], {
      stageOnly: true,
      now: fixedNow,
      rehost: { wechat: ctx },
    });
    expect(results[0]!.artifact?.payload.content).toContain("https://mp.weixin.qq.com/cdn/rehosted.png");
  });

  it("不注入 rehost 时保留原始 URL(向后兼容)", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const results = await syncToPlatforms(doc, ["wechat"], { stageOnly: true, now: fixedNow });
    expect(results[0]!.artifact?.payload.content).toContain("https://orig.example.com/a.png");
  });
});

describe("BaseAdapter.rehostAsset — 默认实现", () => {
  it("调用 ctx.upload 并返回 {assetId,url,mediaId}", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("zhihu")!;
    const asset = doc.assets.find((a) => a.kind === "image")!;
    const ctx: RehostContext = {
      platformId: "zhihu",
      upload: async () => ({ url: "https://pic.zhimg.com/x.png", mediaId: "ZH_1" }),
    };
    const result = await adapter.rehostAsset(asset, ctx);
    expect(result.assetId).toBe(asset.id);
    expect(result.url).toBe("https://pic.zhimg.com/x.png");
    expect(result.mediaId).toBe("ZH_1");
  });

  it("upload 返回空对象时 url/mediaId 为 undefined", async () => {
    const doc = markdownToIR(WITH_IMG).document;
    const adapter = getAdapter("zhihu")!;
    const asset = doc.assets.find((a) => a.kind === "image")!;
    const ctx: RehostContext = { platformId: "zhihu", upload: async () => ({}) };
    const result = await adapter.rehostAsset(asset, ctx);
    expect(result.assetId).toBe(asset.id);
    expect(result.url).toBeUndefined();
    expect(result.mediaId).toBeUndefined();
  });
});

describe("rehostDocumentAssets — 并发上传(UPGRADE §1)", () => {
  /** 构造 N 张不同源图片的文档。 */
  function docWithImages(count: number): Document {
    let md = "# 标题\n\n正文。\n";
    for (let i = 0; i < count; i++) md += `\n![图${i}](https://img.example.com/${i}.png)`;
    return markdownToIR(md).document;
  }

  /** 构造慢速 upload,并记录最大并发在途数。 */
  function slowCtx(platformId: string, delayMs: number, tracker: { active: number; max: number }): RehostContext {
    return {
      platformId,
      upload: async () => {
        tracker.active++;
        tracker.max = Math.max(tracker.max, tracker.active);
        await new Promise((r) => setTimeout(r, delayMs));
        tracker.active--;
        return { url: `https://cdn/${platformId}/${tracker.max}.png` };
      },
    };
  }

  it("按 ctx.concurrency 限制并发,全部结果正确回填", async () => {
    const doc = docWithImages(6);
    const tracker = { active: 0, max: 0 };
    const ctx = slowCtx("zhihu", 50, tracker);
    ctx.concurrency = 2;

    const out = await rehostDocumentAssets(getAdapter("zhihu")!, doc, ctx);
    expect(tracker.max).toBe(2); // 从未超过并发上限
    const urls = out.assets.filter((a) => a.kind === "image").map((a) => a.rehosted["zhihu"]?.url);
    expect(urls.filter(Boolean)).toHaveLength(6); // 全部成功回填
  });

  it("公众号默认并发 3(限流最严),由限流策略驱动", async () => {
    const doc = docWithImages(5);
    const tracker = { active: 0, max: 0 };
    const out = await rehostDocumentAssets(getAdapter("wechat")!, doc, slowCtx("wechat", 40, tracker));
    expect(tracker.max).toBe(3); // PLATFORM_RATE_POLICY.wechat.assetConcurrency
    expect(out.assets.filter((a) => a.kind === "image" && a.rehosted["wechat"])).toHaveLength(5);
  });

  it("并发 1 = 串行(退化为逐张)", async () => {
    const doc = docWithImages(4);
    const tracker = { active: 0, max: 0 };
    const ctx = slowCtx("zhihu", 30, tracker);
    ctx.concurrency = 1;
    await rehostDocumentAssets(getAdapter("zhihu")!, doc, ctx);
    expect(tracker.max).toBe(1);
  });
});

describe("rehostDocumentAssets — 同源去重(UPGRADE §2)", () => {
  /** 构造两个 assetId 不同但 source 完全相同的图片资产(绕过 AssetTable 解析期去重)。 */
  function docWithDupSource(): Document {
    const assets: Asset[] = [
      { id: "a1", kind: "image", source: { url: "https://same.example.com/logo.png" }, rehosted: {} },
      { id: "a2", kind: "image", source: { url: "https://same.example.com/logo.png" }, rehosted: {} },
    ];
    return { meta: { title: "t", tags: [], lang: "zh" }, blocks: [], assets, overrides: {} };
  }

  it("同源图片只上传一次,结果共享给所有同源资产", async () => {
    const doc = docWithDupSource();
    let calls = 0;
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => {
        calls++;
        return { url: "https://mmbiz.qpic.cn/logo.png" };
      },
    };
    const out = await rehostDocumentAssets(getAdapter("wechat")!, doc, ctx);
    expect(calls).toBe(1); // 同源只传一次
    expect(out.assets.find((a) => a.id === "a1")?.rehosted["wechat"]?.url).toBe("https://mmbiz.qpic.cn/logo.png");
    expect(out.assets.find((a) => a.id === "a2")?.rehosted["wechat"]?.url).toBe("https://mmbiz.qpic.cn/logo.png");
  });

  it("同源上传失败时,所有同源资产都上报失败明细", async () => {
    const doc = docWithDupSource();
    const failures: string[] = [];
    const ctx: RehostContext = {
      platformId: "wechat",
      upload: async () => {
        throw new Error("图床超时");
      },
    };
    await rehostDocumentAssets(getAdapter("wechat")!, doc, ctx, undefined, (f) => failures.push(f.reason));
    expect(failures).toHaveLength(2); // 两个资产共享同一 source,各自上报
    expect(failures.every((r) => r === "图床超时")).toBe(true);
  });
});
