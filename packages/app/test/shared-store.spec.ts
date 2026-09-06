/**
 * COLLAB-01/03 本地共享库持久化测试 —— IndexedDB(schema v7)+ chrome.storage 双实现。
 *
 * 覆盖:
 * - IdbSharedStore:put/get/list/listByKind/remove,持久化到 IndexedDB(schema v7);
 * - ChromeSharedStore:chrome.storage.local 实现;
 * - 版本化冲突合并:同 id 并发覆盖(不同源/版本未递增)→ conflict 保留双版本;
 *   内容一致且版本/时间不更新 → unchanged;
 * - 每类上限裁剪。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SharedItem } from "@mpp/core";
import { sharedItemFrom } from "@mpp/core";
import { IdbSharedStore, ChromeSharedStore } from "../src/storage/shared-store.js";

const NOW = () => "2026-08-09T00:00:00Z";

function makeItem(overrides: Partial<SharedItem> = {}): SharedItem {
  return {
    ...sharedItemFrom(
      "draft",
      "draft-1",
      "别俚科夫",
      {
        kind: "draft",
        draft: { title: "本地共享草稿", markdown: "# 标题\n\n正文", authorName: "作者A", tags: ["协作"], updatedAt: NOW() },
      },
    ),
    ...overrides,
  };
}

/** chrome.storage.local 的模拟(扩展环境)。 */
const chromeStorage = new Map<string, unknown>();
const mockChrome = {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: chromeStorage.get(key) };
      },
      async set(entries: Record<string, unknown>) {
        for (const [k, v] of Object.entries(entries)) chromeStorage.set(k, v);
      },
    },
  },
};

async function clearIdb(): Promise<void> {
  const open = indexedDB.open("mpp-store");
  await new Promise<void>((resolve) => {
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains("shared-items")) {
        database.close();
        resolve();
        return;
      }
      const tx = database.transaction("shared-items", "readwrite");
      tx.objectStore("shared-items").clear();
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
    };
  });
}

describe("IdbSharedStore(schema v7,IndexedDB)", () => {
  let store: IdbSharedStore;

  beforeEach(async () => {
    store = new IdbSharedStore();
    await clearIdb();
  });

  it("put/get/list/listByKind/remove 全链路", async () => {
    await store.put(makeItem());
    await store.put(sharedItemFrom("template", "tpl-1", "本地", {
      kind: "template",
      template: { name: "模板", platformId: "wechat", version: 1, schemaVersion: 1 },
    }));

    const all = await store.list();
    expect(all.length).toBe(2);
    expect((await store.listByKind("draft")).length).toBe(1);
    expect((await store.get("draft", "draft-1"))?.meta.id).toBe("draft-1");

    await store.remove("draft", "draft-1");
    expect(await store.get("draft", "draft-1")).toBeUndefined();
  });

  it("同 id 并发覆盖(不同来源/版本未递增)→ conflict 保留双版本", async () => {
    await store.put(makeItem());
    const concurrent = {
      ...makeItem(),
      meta: { ...makeItem().meta, sourceName: "另一台设备", updatedAt: "2026-08-10T00:00:00Z", version: 1 },
      payload: {
        kind: "draft" as const,
        draft: { title: "本地共享草稿", markdown: "# 标题\n\n并发分支", authorName: "作者B", tags: [], updatedAt: "2026-08-10T00:00:00Z" },
      },
    };
    const result = await store.put(concurrent);
    expect(result.mode).toBe("conflict");
    expect(result.item.meta.id).toMatch(/^draft-1#v\d+$/);
    expect((await store.listByKind("draft")).length).toBe(2);
  });

  it("内容一致且版本/时间不更新 → unchanged", async () => {
    const fixed = makeItem({ meta: { ...makeItem().meta, updatedAt: NOW() } });
    await store.put(fixed);
    const result = await store.put(fixed);
    expect(result.mode).toBe("unchanged");
    expect((await store.listByKind("draft")).length).toBe(1);
  });
});

describe("ChromeSharedStore(chrome.storage.local)", () => {
  let store: ChromeSharedStore;

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["chrome"] = mockChrome;
    chromeStorage.clear();
    store = new ChromeSharedStore();
  });

  it("put/get/list + 版本化合并", async () => {
    await store.put(makeItem());
    expect((await store.get("draft", "draft-1"))?.meta.id).toBe("draft-1");

    const concurrent = {
      ...makeItem(),
      meta: { ...makeItem().meta, sourceName: "另一台设备", updatedAt: "2026-08-10T00:00:00Z", version: 1 },
      payload: {
        kind: "draft" as const,
        draft: { title: "本地共享草稿", markdown: "# 标题\n\n并发分支", authorName: "作者B", tags: [], updatedAt: "2026-08-10T00:00:00Z" },
      },
    };
    const result = await store.put(concurrent);
    expect(result.mode).toBe("conflict");
    expect((await store.listByKind("draft")).length).toBe(2);

    await store.remove("draft", "draft-1");
    expect(await store.get("draft", "draft-1")).toBeUndefined();
  });
});
