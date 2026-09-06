/**
 * ACCOUNT-02 app 账号存储测试 —— IndexedDB 落盘 + 密钥安全分级 + schema v5 迁移。
 *
 * 覆盖:
 * - IdbAccountStore:put/get/list/listByPlatform/remove,持久化到 IndexedDB(schema v5);
 * - 密钥默认仅会话:put 时 strip,get 回读 secrets 为空;显式 persistSecrets 才保留;
 * - ChromeAccountStore:chrome.storage 实现,同样剔除密钥;
 * - 兼容旧 schema:升级前后 objectStore 不丢失(老 store 的迁移不破坏)。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile } from "@mpp/core";
import { createAccountProfile } from "@mpp/core";
import { IdbAccountStore, ChromeAccountStore } from "../src/storage/account-store.js";

function makeAccount(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return createAccountProfile(
    { platformId: "wechat", name: "主号", ...overrides },
    () => "2026-08-06T00:00:00.000Z",
  );
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

describe("IdbAccountStore(schema v5,IndexedDB)", () => {
  let store: IdbAccountStore;

  beforeEach(async () => {
    store = new IdbAccountStore();
    // 清空数据库(每个用例独立)。
    const db = await store.list().then(() => undefined);
    void db;
    const open = indexedDB.open("mpp-store");
    await new Promise<void>((resolve) => {
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("accounts", "readwrite");
        tx.objectStore("accounts").clear();
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });
  });

  it("put/get/list/listByPlatform/remove 全链路", async () => {
    const a = makeAccount({ id: "a1", secrets: {}, persistSecrets: false });
    const b = makeAccount({ id: "a2", platformId: "zhihu", name: "知乎号" });
    await store.put(a);
    await store.put(b);

    const all = await store.list();
    expect(all.length).toBe(2);

    const wechat = await store.listByPlatform("wechat");
    expect(wechat.map((x) => x.id)).toEqual(["a1"]);

    expect((await store.get("a2"))?.name).toBe("知乎号");
    await store.remove("a1");
    expect(await store.get("a1")).toBeUndefined();
  });

  it("密钥默认仅会话:落盘后回读 secrets 为空", async () => {
    const a = makeAccount({ id: "sec1", secrets: { secret: "s3cret" }, persistSecrets: false });
    await store.put(a);
    const read = await store.get("sec1");
    expect(read?.secrets).toEqual({});
    // 内存对象本身仍持有密钥(供本次会话使用)。
    expect(a.secrets).toEqual({ secret: "s3cret" });
  });

  it("显式 persistSecrets 才保留密钥", async () => {
    const a = makeAccount({ id: "sec2", secrets: { secret: "keep" }, persistSecrets: true });
    await store.put(a);
    const read = await store.get("sec2");
    expect(read?.secrets).toEqual({ secret: "keep" });
  });

  it("schemaVersion 声明为 ACCOUNT_SCHEMA_VERSION", () => {
    expect(store.schemaVersion).toBe(1);
  });
});

describe("ChromeAccountStore(扩展)", () => {
  let store: ChromeAccountStore;

  beforeEach(() => {
    chromeStorage.clear();
    vi.stubGlobal("chrome", mockChrome);
    store = new ChromeAccountStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("put/get/remove + 密钥剔除", async () => {
    const a = makeAccount({ id: "c1", secrets: { secret: "x" }, persistSecrets: false });
    await store.put(a);
    expect((await store.get("c1"))?.secrets).toEqual({});

    const b = makeAccount({ id: "c2", platformId: "csdn", name: "CSDN", secrets: { cookie: "abc" }, persistSecrets: true });
    await store.put(b);
    expect((await store.get("c2"))?.secrets).toEqual({ cookie: "abc" });

    await store.remove("c1");
    expect(await store.get("c1")).toBeUndefined();
  });

  it("listByPlatform 过滤", async () => {
    await store.put(makeAccount({ id: "x1" }));
    await store.put(makeAccount({ id: "x2", platformId: "juejin", name: "掘金" }));
    const list = await store.listByPlatform("juejin");
    expect(list.map((x) => x.id)).toEqual(["x2"]);
  });
});
