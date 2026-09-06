/**
 * v11 INBOX-03 真实平台消息同步 —— 纯函数 + 演示适配器测试。
 */
import { describe, expect, it } from "vitest";
import {
  createInboxMessage,
  togglePinned,
  MemoryInboxStore,
} from "../src/inbox/types.js";
import { sortInboxByTime } from "../src/inbox/aggregate.js";
import {
  normalizeRemoteItem,
  syncInboxFromPlatform,
  summarizeSyncResults,
  getInboxSyncAdapter,
  type InboxSyncAdapter,
  type InboxSyncRequest,
  type RemoteInboxItem,
} from "../src/inbox/sync.js";
import { registerDemoInboxSyncAdapters } from "../src/inbox/demo-adapter.js";

/** 可配置的测试适配器。 */
function makeAdapter(platformId: string, batches: readonly (readonly RemoteInboxItem[])[]) {
  let index = 0;
  const adapter: InboxSyncAdapter = {
    platformId,
    async fetch(req: InboxSyncRequest) {
      if (index >= batches.length) return { ok: true, items: [], cursor: req.cursor };
      const items = batches[index]!;
      index++;
      return { ok: true, items, cursor: `cursor-${index}` };
    },
  };
  return adapter;
}

const NOW = () => "2026-08-08T00:00:00.000Z";

describe("inbox/sync — INBOX-03 真实平台消息同步", () => {
  it("归一化远端消息(规则引擎打标评论营销)", () => {
    const input: RemoteInboxItem = {
      remoteId: "c1",
      kind: "comment",
      author: "用户A",
      text: "这个多少钱?",
    };
    const out = normalizeRemoteItem(input, "wechat", undefined, NOW);
    expect(out.platformId).toBe("wechat");
    expect(out.remoteId).toBe("c1");
    expect(out.direction).toBe("inbound");
    // 规则引擎自动识别高意向 + 自动回复建议。
    expect(out.intent).toBe("price-inquiry");
    expect(out.crmTags).toContain("high-intent");
    expect(out.autoReply).toBeTruthy();
  });

  it("归一化负向评论 → sensitivity 打标", () => {
    const input: RemoteInboxItem = {
      remoteId: "c2",
      kind: "comment",
      author: "用户B",
      text: "这个产品太垃圾了,差评!",
    };
    const out = normalizeRemoteItem(input, "zhihu", undefined, NOW);
    expect(out.sensitivity).toBe("negative");
    expect(out.crmTags).toContain("needs-followup");
  });

  it("增量拉取 + 幂等去重合并", async () => {
    const store = new MemoryInboxStore();
    const adapter = makeAdapter("wechat", [
      [
        { remoteId: "w1", kind: "comment", author: "A", text: "第一条" },
        { remoteId: "w2", kind: "direct-message", author: "B", text: "私信" },
      ],
      [
        { remoteId: "w1", kind: "comment", author: "A", text: "第一条(重复)" },
        { remoteId: "w3", kind: "comment", author: "C", text: "第三条" },
      ],
    ]);

    const r1 = await syncInboxFromPlatform(store, adapter, { platformId: "wechat" }, NOW);
    expect(r1.ok).toBe(true);
    expect(r1.fetched).toBe(2);
    expect(r1.added).toBe(2);
    expect(r1.skipped).toBe(0);
    expect(r1.cursor).toBe("cursor-1");
    expect((await store.list()).length).toBe(2);

    const r2 = await syncInboxFromPlatform(store, adapter, { platformId: "wechat", cursor: r1.cursor }, NOW);
    expect(r2.ok).toBe(true);
    expect(r2.fetched).toBe(2);
    expect(r2.added).toBe(1); // w3 新增,w1 重复跳过
    expect(r2.skipped).toBe(1);
    expect((await store.list()).length).toBe(3);
  });

  it("适配器失败如实上报", async () => {
    const store = new MemoryInboxStore();
    const adapter: InboxSyncAdapter = {
      platformId: "wechat",
      async fetch() {
        return { ok: false, items: [], error: "网络错误" };
      },
    };
    const r = await syncInboxFromPlatform(store, adapter, { platformId: "wechat" }, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("网络错误");
    expect((await store.list()).length).toBe(0);
  });

  it("汇总多个平台结果", () => {
    const summary = summarizeSyncResults([
      { ok: true, platformId: "wechat", fetched: 5, added: 3, skipped: 2, at: NOW() },
      { ok: false, platformId: "zhihu", fetched: 0, added: 0, skipped: 0, at: NOW(), error: "超时" },
    ]);
    expect(summary.added).toBe(3);
    expect(summary.skipped).toBe(2);
    expect(summary.ok).toBe(false);
    expect(summary.errors).toContain("zhihu: 超时");
  });

  it("演示适配器注册 + 增量闭环", async () => {
    registerDemoInboxSyncAdapters();
    const adapter = getInboxSyncAdapter("xiaohongshu");
    expect(adapter).toBeDefined();
    const store = new MemoryInboxStore();
    const r1 = await syncInboxFromPlatform(store, adapter!, { platformId: "xiaohongshu" }, NOW);
    expect(r1.ok).toBe(true);
    expect(r1.added).toBeGreaterThan(0);
    expect(r1.cursor).toBeTruthy();
    // 再次同步不重复新增(演示适配器增量游标推进)。
    const r2 = await syncInboxFromPlatform(store, adapter!, { platformId: "xiaohongshu", cursor: r1.cursor }, NOW);
    expect(r2.added).toBeGreaterThan(0);
    expect(r2.skipped).toBe(0);
  });
});

describe("inbox/types — INBOX-01 置顶", () => {
  it("togglePinned 切换置顶状态", () => {
    const m = createInboxMessage(
      { platformId: "wechat", remoteId: "x", author: "A", text: "hi" },
      NOW,
    );
    expect(m.pinned).toBeUndefined();
    const pinned = togglePinned(m);
    expect(pinned.pinned).toBe(true);
    expect(togglePinned(pinned).pinned).toBe(false);
  });

  it("置顶消息在排序中优先", () => {
    const m1 = createInboxMessage({ platformId: "wechat", remoteId: "a", author: "A", text: "1" }, () => "2026-08-01T00:00:00Z");
    const m2 = createInboxMessage({ platformId: "wechat", remoteId: "b", author: "B", text: "2", pinned: true }, () => "2026-08-02T00:00:00Z");
    const sorted = sortInboxByTime([m1, m2]);
    expect(sorted[0]!.remoteId).toBe("b"); // 置顶优先于更新的时间
  });
});
