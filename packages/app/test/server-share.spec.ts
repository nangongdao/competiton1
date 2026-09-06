/**
 * v4 Phase 3 · COLLAB-01/03 共享内容 REST 客户端单元测试。
 *
 * 验证:
 * - fetchSharedItems:GET /share(带 kind 过滤)拼接 URL + X-MPP-Token + 解析;
 * - fetchSharedItem:GET /share/:kind/:id;
 * - pushSharedItem:POST /share/:kind/:id 携带 token + JSON body;
 * - deleteSharedItem:DELETE /share/:kind/:id;
 * - 非 2xx / 网络异常返回统一错误提示(不泄露细节)。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSharedItems,
  fetchSharedItem,
  pushSharedItem,
  deleteSharedItem,
} from "../src/bridge/server-share.js";
import { sharedItemFrom } from "@mpp/core";

const BASE = "http://127.0.0.1:8787";
const TOKEN = "tok-123";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})),
  );
}

function makeItem() {
  return sharedItemFrom("draft", "draft-1", "别俚科夫", {
    kind: "draft",
    draft: { title: "共享草稿", markdown: "# 标题", authorName: "作者A", tags: [], updatedAt: new Date().toISOString() },
  });
}

describe("fetchSharedItems", () => {
  it("GET /share 携带 token,解析列表与 sync 声明", async () => {
    let capturedUrl = "";
    let capturedToken = "";
    stubFetch((url, init) => {
      capturedUrl = url;
      capturedToken = (init.headers as Record<string, string>)["X-MPP-Token"] ?? "";
      return new Response(
        JSON.stringify({ ok: true, sync: "http://sync.example.com", items: [{ meta: { kind: "draft", id: "d1", title: "t", sourceName: "x", updatedAt: "t", version: 1 } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const res = await fetchSharedItems(BASE, TOKEN);
    expect(capturedUrl).toBe(`${BASE}/share`);
    expect(capturedToken).toBe(TOKEN);
    expect(res.ok).toBe(true);
    expect(res.sync).toBe("http://sync.example.com");
    expect(res.items).toHaveLength(1);
  });

  it("带 kind 过滤拼接 /share/:kind", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    await fetchSharedItems(BASE, TOKEN, "template");
    expect(capturedUrl).toBe(`${BASE}/share/template`);
  });

  it("非 2xx 返回 ok=false 与错误信息", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: false, message: "未授权" }), { status: 401 }));
    const res = await fetchSharedItems(BASE, TOKEN);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未授权");
  });

  it("网络异常返回统一错误提示", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const res = await fetchSharedItems(BASE, TOKEN);
    expect(res.ok).toBe(false);
    expect(String(res.message)).toContain("无法连接本地 server");
  });
});

describe("fetchSharedItem / pushSharedItem / deleteSharedItem", () => {
  it("GET /share/:kind/:id 单条", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ ok: true, item: makeItem() }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const res = await fetchSharedItem(BASE, TOKEN, "draft", "draft-1");
    expect(capturedUrl).toBe(`${BASE}/share/draft/draft-1`);
    expect(res.ok).toBe(true);
    expect(res.item?.meta.id).toBe("draft-1");
  });

  it("POST /share/:kind/:id 推送,携带 token 与 JSON body", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedToken = "";
    let capturedBody = "";
    stubFetch((url, init) => {
      capturedUrl = url;
      capturedMethod = init.method ?? "";
      capturedToken = (init.headers as Record<string, string>)["X-MPP-Token"] ?? "";
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ ok: true, message: "已写入" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const res = await pushSharedItem(BASE, TOKEN, makeItem());
    expect(capturedUrl).toBe(`${BASE}/share/draft/draft-1`);
    expect(capturedMethod).toBe("POST");
    expect(capturedToken).toBe(TOKEN);
    expect(JSON.parse(capturedBody).meta.id).toBe("draft-1");
    expect(res.ok).toBe(true);
  });

  it("DELETE /share/:kind/:id 删除", async () => {
    let capturedMethod = "";
    stubFetch((url, init) => {
      capturedMethod = init.method ?? "";
      void url;
      return new Response(JSON.stringify({ ok: true, message: "已删除" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const res = await deleteSharedItem(BASE, TOKEN, "report", "r1");
    expect(capturedMethod).toBe("DELETE");
    expect(res.ok).toBe(true);
  });
});
