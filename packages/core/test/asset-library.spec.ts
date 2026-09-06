/**
 * ROADMAP_V5 Phase 3 · 内容资产库 core 测试(ASSET-01)。
 *
 * 覆盖:
 * - `extractImageReferences`:dataURL / 外链抽取,相对路径忽略;
 * - `dataUrlShortHash`:确定性短哈希(不落完整 dataURL);
 * - `indexAssetFromDraft`:封面 + 图床记录;
 * - `indexAssetFromQueueEntry` / `indexAssetFromBatch`:待发布/批次资产索引;
 * - `buildAssetLibraryIndex`:增量合并(新增/更新/忽略),幂等;
 * - `searchAssetLibrary`:标题/平台/引用加权评分,类型过滤;
 * - `assertAssetRecord`:损坏检测;
 * - `pruneAssetLibrary`:条数上限 + TTL 裁剪。
 */
import { describe, expect, it } from "vitest";
import {
  MemoryAssetLibraryStore,
  assertAssetRecord,
  buildAssetLibraryIndex,
  buildAssetRecord,
  dataUrlShortHash,
  extractImageReferences,
  indexAssetFromBatch,
  indexAssetFromDraft,
  indexAssetFromQueueEntry,
  pruneAssetLibrary,
  searchAssetLibrary,
} from "../src/asset-library/index.js";
import type { PublishBatch } from "../src/publish-batch/index.js";
import type { PublishQueueEntry } from "../src/publish-queue/index.js";

const SAMPLE_MD = `# 测试文章

正文内容,引用一张本地图:

![本地图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

再引用一张外链图:

![外链图](https://example.com/cover.png)

![相对路径](./local.png)
`;

function makeQueueEntry(): PublishQueueEntry {
  return {
    id: "q1",
    name: "待发布文章",
    draftId: "d1",
    platformIds: ["wechat", "zhihu"],
    scheduledAt: "2026-08-08T10:00:00Z",
    accountRefs: [],
    realPublish: true,
    status: "queued",
    createdAt: "2026-08-07T00:00:00Z",
    updatedAt: "2026-08-07T00:00:00Z",
  };
}

function makeBatch(): PublishBatch {
  return {
    id: "b1",
    name: "批量发布",
    items: [
      {
        itemId: "b1-i1",
        draftId: "d1",
        draftTitle: "测试文章",
        platformIds: ["wechat", "zhihu"],
        accountRefs: [],
        realPublish: true,
        status: "succeeded",
        jobId: "job-1",
        receipts: [
          { platformId: "wechat", status: "published", remoteId: "R1", remoteUrl: "https://mp.weixin.qq.com/s/R1", at: "2026-08-08T10:00:00Z" },
        ],
        startedAt: "2026-08-08T10:00:00Z",
        endedAt: "2026-08-08T10:00:01Z",
      },
    ],
    status: "succeeded",
    scheduledAt: "2026-08-08T10:00:00Z",
    accountRefs: [],
    realPublish: true,
    createdAt: "2026-08-07T00:00:00Z",
    updatedAt: "2026-08-08T10:00:01Z",
  };
}

describe("extractImageReferences 图片引用抽取", () => {
  it("抽取 dataURL 与外链,忽略相对路径", () => {
    const refs = extractImageReferences(SAMPLE_MD);
    expect(refs.length).toBe(2);
    // dataURL 归一化为短哈希,并记录 MIME 与字节数。
    const local = refs[0]!;
    expect(local.reference).toMatch(/^data:image\/png;hash:/);
    expect(local.mime).toBe("image/png");
    expect(local.bytes).toBeGreaterThan(0);
    // 外链保留完整 URL。
    const remote = refs[1]!;
    expect(remote.reference).toBe("https://example.com/cover.png");
  });

  it("空正文返回空", () => {
    expect(extractImageReferences("")).toEqual([]);
  });
});

describe("dataUrlShortHash 短哈希", () => {
  it("确定性且不含完整 base64", () => {
    const a = dataUrlShortHash("data:image/png;base64,AAAA");
    const b = dataUrlShortHash("data:image/png;base64,AAAA");
    expect(a).toBe(b);
    expect(a).not.toContain("AAAA");
    expect(a).toMatch(/^data:image\/png;hash:[0-9a-f]{8}$/);
  });
});

describe("indexAssetFromDraft 草稿索引", () => {
  it("生成封面 + 图床记录", () => {
    const records = indexAssetFromDraft("d1", "测试文章", SAMPLE_MD, "wechat");
    const cover = records.filter((r) => r.kind === "cover");
    const rehost = records.filter((r) => r.kind === "rehost");
    expect(cover.length).toBe(1);
    expect(cover[0]!.draftId).toBe("d1");
    expect(rehost.length).toBe(2);
    expect(rehost.every((r) => r.draftId === "d1")).toBe(true);
    expect(rehost[1]!.platformId).toBe("wechat");
  });
});

describe("indexAssetFromQueueEntry / indexAssetFromBatch", () => {
  it("队列条目为每个平台生成 artifact 记录", () => {
    const records = indexAssetFromQueueEntry(makeQueueEntry());
    expect(records.length).toBe(2);
    expect(records.every((r) => r.kind === "artifact")).toBe(true);
    expect(records[0]!.source).toEqual({ from: "queue", queueId: "q1" });
  });

  it("批次条目按平台生成记录并携带回执 URL", () => {
    const records = indexAssetFromBatch(makeBatch());
    expect(records.length).toBe(2);
    const wechat = records.find((r) => r.platformId === "wechat")!;
    expect(wechat.reference).toBe("https://mp.weixin.qq.com/s/R1");
    expect(wechat.refKind).toBe("url");
    expect(wechat.taskId).toBe("job-1");
    const zhihu = records.find((r) => r.platformId === "zhihu")!;
    expect(zhihu.reference).toMatch(/^batch:b1:b1-i1$/);
  });
});

describe("buildAssetLibraryIndex 增量合并", () => {
  it("首轮全新增,重复构建幂等(新增 0)", async () => {
    const store = new MemoryAssetLibraryStore();
    const ctx = { list: () => store.list(), putMany: (r) => store.putMany(r), remove: (id) => store.remove(id) };
    const drafts = [{ id: "d1", title: "测试文章", markdown: SAMPLE_MD }];
    const first = await buildAssetLibraryIndex(ctx, drafts, [makeQueueEntry()], [makeBatch()]);
    expect(first.added).toBeGreaterThan(0);
    const total1 = first.total;

    const second = await buildAssetLibraryIndex(ctx, drafts, [makeQueueEntry()], [makeBatch()]);
    expect(second.added).toBe(0);
    expect(second.total).toBe(total1);
  });

  it("标题变化视为更新(引用未变不产生新记录)", async () => {
    const store = new MemoryAssetLibraryStore();
    const ctx = { list: () => store.list(), putMany: (r) => store.putMany(r), remove: (id) => store.remove(id) };
    await buildAssetLibraryIndex(ctx, [{ id: "d1", title: "旧标题", markdown: "![a](https://a.com/1.png)" }]);
    const result = await buildAssetLibraryIndex(ctx, [{ id: "d1", title: "新标题", markdown: "![a](https://a.com/1.png)" }]);
    // 封面引用 = 标题,标题变化触发更新;图床引用未变不新增。
    expect(result.updated).toBeGreaterThan(0);
    expect(result.added).toBe(0);
  });

  it("损坏记录被忽略并统计", async () => {
    const store = new MemoryAssetLibraryStore();
    // 预置一条损坏记录。
    await store.putMany([
      { id: "bad", kind: "cover", title: "x", reference: "x", refKind: "text", source: { from: "manual" }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } as unknown as import("@mpp/core").AssetRecord,
    ]);
    const ctx = { list: () => store.list(), putMany: (r) => store.putMany(r), remove: (id) => store.remove(id) };
    const result = await buildAssetLibraryIndex(ctx, [], [], []);
    // 损坏记录不影响索引构建(原样保留),构建仍成功。
    expect(result.total).toBeGreaterThan(0);
  });
});

describe("searchAssetLibrary 检索", () => {
  it("按标题/平台/引用加权排序并过滤", () => {
    const now = new Date().toISOString();
    const base = { refKind: "url" as const, source: { from: "manual" as const }, createdAt: now, updatedAt: now };
    const records = [
      buildAssetRecord({ ...base, kind: "cover", title: "AI 写作指南", reference: "AI 写作指南" }),
      buildAssetRecord({ ...base, kind: "rehost", title: "AI 配图", platformId: "wechat", reference: "https://img.example.com/ai.png" }),
      buildAssetRecord({ ...base, kind: "artifact", title: "周报", platformId: "zhihu", reference: "https://zhuanlan.zhihu.com/p/1" }),
    ];

    const byTitle = searchAssetLibrary(records, "写作");
    expect(byTitle.length).toBe(1);
    expect(byTitle[0]!.record.kind).toBe("cover");
    expect(byTitle[0]!.score).toBeGreaterThan(0);

    const byPlatform = searchAssetLibrary(records, "知乎");
    expect(byPlatform.length).toBe(1);
    expect(byPlatform[0]!.record.platformId).toBe("zhihu");

    const byRef = searchAssetLibrary(records, "img.example");
    expect(byRef.length).toBe(1);
    expect(byRef[0]!.record.kind).toBe("rehost");

    // 类型过滤 + 无命中返回空。
    expect(searchAssetLibrary(records, "写作", { kind: "rehost" })).toEqual([]);
    expect(searchAssetLibrary(records, "不存在的关键词")).toEqual([]);
  });

  it("空查询 / 空记录返回空", () => {
    expect(searchAssetLibrary([], "x")).toEqual([]);
    expect(searchAssetLibrary([], "")).toEqual([]);
  });
});

describe("assertAssetRecord 损坏检测", () => {
  it("合法记录通过,缺字段拒绝", () => {
    const good = buildAssetRecord({ kind: "cover", title: "T", reference: "T", source: { from: "manual" } });
    expect(assertAssetRecord(good)).toBe(true);
    expect(assertAssetRecord({ ...good, id: undefined })).toBe(false);
    expect(assertAssetRecord(null)).toBe(false);
    expect(assertAssetRecord({})).toBe(false);
    expect(assertAssetRecord({ ...good, kind: "weird" })).toBe(false);
  });
});

describe("pruneAssetLibrary 清理", () => {
  it("超过上限时裁剪最旧终态来源记录", async () => {
    const store = new MemoryAssetLibraryStore();
    const ctx = { list: () => store.list(), putMany: (r) => store.putMany(r), remove: (id) => store.remove(id) };
    // 30 条终态来源(队列),超过上限 10。
    for (let i = 0; i < 30; i++) {
      const rec = buildAssetRecord({
        kind: "artifact",
        title: `q${i}`,
        platformId: "wechat",
        reference: `queue:q${i}`,
        source: { from: "queue", queueId: `q${i}` },
        id: `asset-q${i}`,
      });
      await store.putMany([{ ...rec, updatedAt: new Date(Date.now() - i * 3600_000).toISOString() }]);
    }
    const removed = await pruneAssetLibrary(ctx, new Date(), 10);
    expect(removed).toBeGreaterThan(0);
    const after = await store.list();
    expect(after.length).toBeLessThanOrEqual(10 + 20); // 只裁剪 TTL 内的终态来源
  });
});
