/**
 * v4 Phase 3 · COLLAB-01/04 共享内容路由测试。
 *
 * 覆盖:
 * - 鉴权:无 token → 401;
 * - 路由:GET /share 列表(按 kind 过滤) / GET /share/:kind/:id 单条 / 404;
 * - 推送:POST /share/:kind/:id 写入并读取(路径与内容不一致 → 400);
 * - 删除:DELETE /share/:kind/:id;
 * - 远程同步声明:配置 SYNC_URL → /share 返回 sync 字段;
 * - FileSharedStore:落盘 + 重启恢复 + 损坏检测。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { FileSharedStore, SharedStoreFileError } from "../src/shared/store.js";
import type { SharedItem } from "@mpp/core";
import { sharedItemFrom, MemorySharedStore } from "@mpp/core";

function authedConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    ...overrides,
  };
}

const headers = { "x-mpp-token": "test-token", "content-type": "application/json" };

function makeItem(overrides: Partial<SharedItem> = {}): SharedItem {
  return {
    ...sharedItemFrom(
      "draft",
      "draft-1",
      "别俚科夫",
      {
        kind: "draft",
        draft: { title: "协作草稿", markdown: "# 标题\n\n正文", authorName: "作者A", tags: ["协作"], updatedAt: new Date().toISOString() },
      },
    ),
    ...overrides,
  };
}

describe("server /share 路由", () => {
  afterEach(async () => {
    const dirs = (globalThis as Record<string, unknown>)["__mpp_tmp_dirs"];
    if (Array.isArray(dirs)) {
      for (const d of dirs) await rm(String(d), { recursive: true, force: true });
      (globalThis as Record<string, unknown>)["__mpp_tmp_dirs"] = [];
    }
  });

  it("无 token → 401(鉴权强制)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({ method: "GET", url: "/share" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /share 列表 + 按 kind 过滤 + 远程同步声明", async () => {
    const store = new MemorySharedStore();
    await store.put(makeItem());
    await store.put(
      sharedItemFrom("template", "tpl-1", "本地", {
        kind: "template",
        template: { name: "模板", platformId: "wechat", version: 1, schemaVersion: 1 },
      }),
    );
    const app = await buildServerApp({ config: authedConfig({ syncUrl: "http://sync.example.com" }), sharedStore: store });
    const res = await app.inject({ method: "GET", url: "/share", headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.sync).toBe("http://sync.example.com");
    expect(body.items.length).toBe(2);

    const resKind = await app.inject({ method: "GET", url: "/share/draft", headers });
    expect(resKind.json().items.length).toBe(1);
    const resTpl = await app.inject({ method: "GET", url: "/share/template", headers });
    expect(resTpl.json().items.length).toBe(1);
    await app.close();
  });

  it("GET /share/:kind/:id 单条 + 404", async () => {
    const store = new MemorySharedStore();
    await store.put(makeItem());
    const app = await buildServerApp({ config: authedConfig(), sharedStore: store });
    const res = await app.inject({ method: "GET", url: "/share/draft/draft-1", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().item.meta.id).toBe("draft-1");
    const res404 = await app.inject({ method: "GET", url: "/share/draft/nope", headers });
    expect(res404.statusCode).toBe(404);
    await app.close();
  });

  it("POST /share/:kind/:id 推送写入并读取;路径与内容不一致 → 400", async () => {
    const store = new MemorySharedStore();
    const app = await buildServerApp({ config: authedConfig(), sharedStore: store });
    const item = makeItem();
    const res = await app.inject({
      method: "POST",
      url: "/share/draft/draft-1",
      headers,
      payload: JSON.stringify(item),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(await store.get("draft", "draft-1")).toBeTruthy();

    const bad = await app.inject({
      method: "POST",
      url: "/share/draft/OTHER",
      headers,
      payload: JSON.stringify(item),
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE /share/:kind/:id 删除", async () => {
    const store = new MemorySharedStore();
    await store.put(makeItem());
    const app = await buildServerApp({ config: authedConfig(), sharedStore: store });
    const res = await app.inject({ method: "DELETE", url: "/share/draft/draft-1", headers: { "x-mpp-token": "test-token" } });
    expect(res.statusCode).toBe(200);
    expect(await store.get("draft", "draft-1")).toBeUndefined();
    await app.close();
  });

  it("POST 并发覆盖(不同来源/版本未递增)→ conflict 保留双版本", async () => {
    const store = new MemorySharedStore();
    const app = await buildServerApp({ config: authedConfig(), sharedStore: store });
    // 第一次推送(v1,来源 A)。
    const v1 = makeItem();
    const r1 = await app.inject({ method: "POST", url: "/share/draft/draft-1", headers, payload: JSON.stringify(v1) });
    expect(r1.json().mode).toBe("created");
    // 并发分支:不同来源、版本仍为 1 → 冲突保留双版本。
    const concurrent = {
      ...makeItem(),
      meta: { ...makeItem().meta, sourceName: "另一台设备", updatedAt: "2026-08-09T00:00:00Z", version: 1 },
      payload: {
        kind: "draft" as const,
        draft: {
          title: "协作草稿",
          markdown: "# 标题\n\n并发分支",
          authorName: "作者B",
          tags: [],
          updatedAt: "2026-08-09T00:00:00Z",
        },
      },
    };
    const r2 = await app.inject({ method: "POST", url: "/share/draft/draft-1", headers, payload: JSON.stringify(concurrent) });
    expect(r2.json().mode).toBe("conflict");
    expect(String(r2.json().id)).toMatch(/^draft-1#v\d+$/);
    const list = await store.listByKind("draft");
    expect(list.length).toBe(2);
    await app.close();
  });

  it("POST 内容一致且版本/时间不更新 → unchanged", async () => {
    const store = new MemorySharedStore();
    // 固定时间戳,保证第二次推送与已存版本时间一致(内容相同 → 空操作)。
    const fixed = makeItem({ meta: { ...makeItem().meta, updatedAt: "2026-08-09T00:00:00Z" } });
    await store.put(fixed);
    const app = await buildServerApp({ config: authedConfig(), sharedStore: store });
    const res = await app.inject({ method: "POST", url: "/share/draft/draft-1", headers, payload: JSON.stringify(fixed) });
    expect(res.json().mode).toBe("unchanged");
    expect((await store.listByKind("draft")).length).toBe(1);
    await app.close();
  });
});

describe("FileSharedStore 落盘与重启恢复", () => {
  async function tmpDataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mpp-share-"));
    const dirs = ((globalThis as Record<string, unknown>)["__mpp_tmp_dirs"] ??= []);
    (dirs as string[]).push(dir);
    return dir;
  }

  it("put 落盘 → 新实例重启恢复", async () => {
    const dir = await tmpDataDir();
    const store1 = new FileSharedStore(dir);
    await store1.put(makeItem());
    const store2 = new FileSharedStore(dir);
    const list = await store2.list();
    expect(list.length).toBe(1);
    expect(list[0]!.meta.id).toBe("draft-1");
    expect(store2.filePath).toContain("shared-items.json");
  });

  it("损坏文件 → SharedStoreFileError(不静默清空)", async () => {
    const dir = await tmpDataDir();
    const file = join(dir, "shared-items.json");
    await writeFile(file, "{{{ not json", "utf8");
    const store = new FileSharedStore(dir);
    await expect(store.list()).rejects.toBeInstanceOf(SharedStoreFileError);
  });
});
