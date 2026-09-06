/**
 * v4 Phase 3 · COLLAB-02 共享包导出/导入 + 共享库测试。
 *
 * 覆盖:
 * - buildShareBundle / serializeShareBundle:打包 + schema 版本 + 可选摘要;
 * - computeShareDigest:确定性、内容变化摘要变化;
 * - parseShareBundle:合法包 / 非 JSON / 版本不支持 / 损坏条目明确报错;
 * - importShareBundle:合并进共享库(已存在覆盖 / 新增追加 / 较旧跳过)、摘要校验失败拒绝;
 * - MemorySharedStore:增删查 + 每类上限裁剪;
 * - sharedItemFrom / normalizeSharedItem:从草稿/模板/报告构建与规范化。
 */
import { describe, expect, it } from "vitest";
import {
  buildShareBundle,
  serializeShareBundle,
  computeShareDigest,
  parseShareBundle,
  importShareBundle,
  countByKind,
  sharedItemFrom,
  normalizeSharedItem,
  MemorySharedStore,
  bumpSharedVersion,
  SHARE_BUNDLE_SCHEMA_VERSION,
} from "../src/collab/index.js";
import type { SharedItem } from "../src/collab/types.js";

const NOW = () => "2026-08-08T12:00:00Z";

function draftItem(overrides: Partial<SharedItem> = {}): SharedItem {
  const base = sharedItemFrom(
    "draft",
    "draft-1",
    "别俚科夫",
    {
      kind: "draft",
      draft: {
        title: "协作共享草稿",
        markdown: "# 标题\n\n正文",
        authorName: "作者A",
        tags: ["协作"],
        updatedAt: NOW(),
      },
    },
    NOW,
  );
  return { ...base, ...overrides };
}

function templateItem(): SharedItem {
  return sharedItemFrom(
    "template",
    "tpl-1",
    "本地",
    {
      kind: "template",
      template: {
        name: "公众号默认模板",
        platformId: "wechat",
        version: 1,
        schemaVersion: 1,
        override: { title: "默认标题" },
      },
    },
    NOW,
  );
}

function reportItem(): SharedItem {
  return sharedItemFrom(
    "report",
    "rep-1",
    "本地",
    {
      kind: "report",
      report: {
        title: "周报",
        markdown: "# 周报\n\n本周表现…",
        template: "weekly",
        windowDays: 7,
        generatedAt: NOW(),
      },
    },
    NOW,
  );
}

describe("COLLAB-02 共享包导出/导入", () => {
  it("buildShareBundle 打包带 schema 版本 + 来源 + 摘要", async () => {
    const items = [draftItem(), templateItem(), reportItem()];
    const bundle = await buildShareBundle(items, { sourceName: "本地", now: NOW });
    expect(bundle.app).toBe("multi-platform-publisher");
    expect(bundle.kind).toBe("mpp-share-bundle");
    expect(bundle.version).toBe(SHARE_BUNDLE_SCHEMA_VERSION);
    expect(bundle.sourceName).toBe("本地");
    expect(bundle.exportedAt).toBe(NOW());
    expect(bundle.items).toHaveLength(3);
    expect(bundle.digest).toBeTruthy();
    expect(countByKind(items)).toEqual({ draft: 1, template: 1, report: 1 });
  });

  it("serializeShareBundle 输出可解析 JSON", async () => {
    const raw = await serializeShareBundle([draftItem()], { now: NOW });
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe("mpp-share-bundle");
    expect(parsed.items).toHaveLength(1);
  });

  it("computeShareDigest 确定性且内容变化摘要变化", async () => {
    const a = { kind: "mpp-share-bundle" as const, version: 1, items: [draftItem()] };
    const b = { kind: "mpp-share-bundle" as const, version: 1, items: [draftItem({ meta: { ...draftItem().meta, id: "draft-2" } })] };
    const d1 = await computeShareDigest(a);
    const d2 = await computeShareDigest(a);
    const d3 = await computeShareDigest(b);
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);
    expect(d1).toMatch(/^[0-9a-f]{64}$|^fnv-/);
  });

  it("parseShareBundle 合法包解析成功并返回 counts", () => {
    const items = [draftItem(), templateItem()];
    const raw = JSON.stringify({ app: "multi-platform-publisher", kind: "mpp-share-bundle", version: 1, exportedAt: NOW(), sourceName: "本地", items });
    const result = parseShareBundle(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.counts).toEqual({ draft: 1, template: 1, report: 0 });
      expect(result.bundle.items[0]!.meta.id).toBe("draft-1");
    }
  });

  it("parseShareBundle 非 JSON / 版本不支持 / 损坏条目返回明确错误", () => {
    expect(parseShareBundle("not json").ok).toBe(false);
    const wrongVersion = JSON.stringify({ app: "multi-platform-publisher", kind: "mpp-share-bundle", version: 99, items: [] });
    const rv = parseShareBundle(wrongVersion);
    expect(rv.ok).toBe(false);
    if (!rv.ok) expect(rv.error).toContain("版本");
    const broken = JSON.stringify({ app: "multi-platform-publisher", kind: "mpp-share-bundle", version: 1, items: [{ bad: true }] });
    const rb = parseShareBundle(broken);
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.error).toContain("损坏");
  });

  it("importShareBundle 合并进共享库(覆盖 / 追加 / 较旧跳过)", async () => {
    const store = new MemorySharedStore();
    await store.put(draftItem());

    // 较旧版本 → 跳过
    const older = {
      ...draftItem(),
      meta: { ...draftItem().meta, updatedAt: "2026-08-01T00:00:00Z" },
    };
    const res1 = await importShareBundle(store, JSON.stringify({ app: "multi-platform-publisher", kind: "mpp-share-bundle", version: 1, items: [older] }));
    expect(res1.ok).toBe(true);
    if (res1.ok) expect(res1).toEqual({ ok: true, imported: 0, skipped: 1 });

    // 新增 + 覆盖
    const newer = { ...draftItem(), meta: { ...draftItem().meta, updatedAt: "2026-08-09T00:00:00Z", version: 2 } };
    const res2 = await importShareBundle(store, JSON.stringify({ app: "multi-platform-publisher", kind: "mpp-share-bundle", version: 1, items: [newer, templateItem()] }));
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2).toEqual({ ok: true, imported: 2, skipped: 0 });
    const got = await store.get("draft", "draft-1");
    expect(got?.meta.version).toBe(2);
  });

  it("importShareBundle 摘要校验失败拒绝(防篡改)", async () => {
    const store = new MemorySharedStore();
    const items = [draftItem()];
    const bundle = await buildShareBundle(items, { now: NOW });
    bundle.items[0] = { ...bundle.items[0]!, meta: { ...bundle.items[0]!.meta, title: "被篡改的标题" } };
    const raw = JSON.stringify(bundle);
    const res = await importShareBundle(store, raw);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("完整性校验失败");
  });
});

describe("COLLAB-01 共享库", () => {
  it("MemorySharedStore 增删查 + 每类上限裁剪", async () => {
    const store = new MemorySharedStore();
    for (let i = 0; i < 205; i++) {
      await store.put({ ...draftItem(), meta: { ...draftItem().meta, id: `d-${i}`, updatedAt: `2026-08-08T00:${String(i % 60).padStart(2, "0")}:00Z` } });
    }
    const drafts = await store.listByKind("draft");
    expect(drafts.length).toBe(200);
    await store.remove("draft", "d-204");
    expect(await store.get("draft", "d-204")).toBeUndefined();
  });

  it("bumpSharedVersion 版本号 +1 并更新时间", () => {
    const item = draftItem();
    const bumped = bumpSharedVersion(item);
    expect(bumped.meta.version).toBe(2);
    expect(bumped.meta.updatedAt).toBeTruthy();
  });

  it("mergeSharedItem 同 id 顺序覆盖 → updated(版本号递增)", async () => {
    const store = new MemorySharedStore();
    await store.put(draftItem());
    const newer = {
      ...draftItem(),
      meta: { ...draftItem().meta, version: 2, updatedAt: "2026-08-09T00:00:00Z" },
      payload: {
        kind: "draft" as const,
        draft: {
          title: "协作共享草稿",
          markdown: "# 标题\n\n第二版",
          authorName: "作者A",
          tags: ["协作"],
          updatedAt: "2026-08-09T00:00:00Z",
        },
      },
    };
    const result = await store.put(newer);
    expect(result.mode).toBe("updated");
    expect((await store.get("draft", "draft-1"))?.meta.version).toBe(2);
    expect((await store.get("draft", "draft-1"))?.meta.id).toBe("draft-1");
  });

  it("mergeSharedItem 同 id 并发覆盖(不同源/版本未递增)→ conflict 保留双版本", async () => {
    const store = new MemorySharedStore();
    await store.put(draftItem());
    // 不同来源、版本仍为 1 的并发写入 → 判定冲突,保留双版本。
    const concurrent = {
      ...draftItem(),
      meta: { ...draftItem().meta, sourceName: "另一台设备", updatedAt: "2026-08-09T00:00:00Z", version: 1 },
      payload: {
        kind: "draft" as const,
        draft: {
          title: "协作共享草稿",
          markdown: "# 标题\n\n并发分支内容",
          authorName: "作者B",
          tags: ["协作"],
          updatedAt: "2026-08-09T00:00:00Z",
        },
      },
    };
    const result = await store.put(concurrent);
    expect(result.mode).toBe("conflict");
    // 新版本以 `id#v{n}` 后缀写入,旧版本保留在原 id。
    expect(result.item.meta.id).toMatch(/^draft-1#v\d+$/);
    const original = await store.get("draft", "draft-1");
    expect(original?.payload.kind === "draft" && original.payload.draft.markdown).toContain("正文");
    const list = await store.listByKind("draft");
    expect(list.length).toBe(2);
  });

  it("mergeSharedItem 内容一致且版本/时间不更新 → unchanged", async () => {
    const store = new MemorySharedStore();
    await store.put(draftItem());
    const result = await store.put(draftItem());
    expect(result.mode).toBe("unchanged");
    expect((await store.listByKind("draft")).length).toBe(1);
  });
});

describe("COLLAB-02 共享条目构建/规范化", () => {
  it("sharedItemFrom 生成元信息(标题/作者/时间)", () => {
    const item = draftItem();
    expect(item.meta.kind).toBe("draft");
    expect(item.meta.title).toBe("协作共享草稿");
    expect(item.meta.author).toBe("作者A");
  });

  it("normalizeSharedItem 非法条目返回 undefined", () => {
    expect(normalizeSharedItem(null)).toBeUndefined();
    expect(normalizeSharedItem({ meta: { kind: "draft" }, payload: {} })).toBeUndefined();
    expect(normalizeSharedItem({ meta: { kind: "draft", id: "x", title: "t", updatedAt: "t" }, payload: { draft: {} } })).toBeUndefined();
  });

  it("normalizeSharedItem 合法草稿/报告可往返", () => {
    const item = reportItem();
    const raw = JSON.parse(JSON.stringify(item));
    const norm = normalizeSharedItem(raw);
    expect(norm?.meta.kind).toBe("report");
    expect(norm?.payload.kind).toBe("report");
  });
});
