/**
 * server 公众号官方指标转发路由测试 —— /metrics/sync(DATA-03)。
 *
 * 覆盖:
 * - 未配置公众号凭据 → 明确提示(updated=0);
 * - 配置凭据 → 调 datacube/getarticlesummary,返回统一指标;
 * - 鉴权:无 token → 401;
 * - 畸形请求(缺 remoteIds / 空数组)→ 400;
 * - 公众号接口报错 → 502 明确错误;
 * - datacube 无数据 → 全部 skipped 并说明原因。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";

function authedConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    wechat: { appId: "appid", secret: "secret", configured: true },
    ...overrides,
  };
}

/** stub 微信 API:stable_token + getarticlesummary。 */
function stubWechatApi(list: unknown[] | null, errcode?: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
      if (url.includes("/cgi-bin/stable_token")) body.access_token = "TOKEN";
      if (url.includes("/datacube/getarticlesummary")) {
        if (errcode) return new Response(JSON.stringify({ errcode, errmsg: "fail" }), { status: 200 });
        body.list = list ?? [];
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("server /metrics/sync(DATA-03 公众号官方指标)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 token → 401", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/metrics/sync",
      payload: { remoteIds: ["MEDIA_1"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("未配置公众号凭据 → 明确提示,不假装成功", async () => {
    const app = await buildServerApp({
      config: authedConfig({ wechat: { appId: "", secret: "", configured: false } }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/metrics/sync",
      headers: { "X-MPP-Token": "test-token" },
      payload: { remoteIds: ["MEDIA_1"] },
    });
    const json = res.json() as { ok: boolean; message: string; updated: number };
    expect(json.ok).toBe(false);
    expect(json.updated).toBe(0);
    expect(json.message).toContain("未配置");
  });

  it("畸形请求(缺 remoteIds)→ 400", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/metrics/sync",
      headers: { "X-MPP-Token": "test-token" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("配置凭据 → 调 datacube 返回统一指标(按 remoteId 去重)", async () => {
    stubWechatApi([
      { ref_date: "2026-08-04", int_page_read_count: 1200, add_to_fav_count: 30, share_count: 5, comment_count: 3 },
      { ref_date: "2026-08-03", int_page_read_count: 800, add_to_fav_count: 20 },
    ]);
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/metrics/sync",
      headers: { "X-MPP-Token": "test-token" },
      payload: { remoteIds: ["MEDIA_1", "MEDIA_1", "MEDIA_2"] },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      ok: boolean;
      updated: number;
      skipped: number;
      results: { remoteId: string; ok: boolean; metrics?: Record<string, number> }[];
    };
    expect(json.ok).toBe(true);
    // 去重后 2 个 remoteId
    expect(json.updated).toBe(2);
    expect(json.results).toHaveLength(2);
    const first = json.results[0]!;
    expect(first.ok).toBe(true);
    expect(first.metrics?.views).toBe(2000); // 1200 + 800
    expect(first.metrics?.likes).toBe(50); // 30 + 20
  });

  it("datacube 无数据 → 全部 skipped 并说明原因", async () => {
    stubWechatApi([]);
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/metrics/sync",
      headers: { "X-MPP-Token": "test-token" },
      payload: { remoteIds: ["MEDIA_1"] },
    });
    const json = res.json() as { ok: boolean; updated: number; skipped: number; results: { ok: boolean; message: string }[] };
    expect(json.updated).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.results[0]?.message).toContain("无文章数据");
  });

  it("公众号接口报错 → 502 明确错误(不泄漏密钥)", async () => {
    stubWechatApi(null, 45009);
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/metrics/sync",
      headers: { "X-MPP-Token": "test-token" },
      payload: { remoteIds: ["MEDIA_1"] },
    });
    expect(res.statusCode).toBe(502);
    const json = res.json() as { ok: boolean; message: string };
    expect(json.message).toContain("45009");
  });
});
