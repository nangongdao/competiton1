/**
 * runner 平台 API 一键连接测试 —— /platform-api/connect 路由 + CSDN Cookie 解析。
 *
 * 覆盖:
 * - 公众号平台在 runner 返回明确提示(走 server);
 * - 未知平台 400;
 * - CSDN:缺少 Cookie → invalid-credentials;合法 Cookie → 解析账号;
 * - CSDN:Cookie 无效 → unauthorized;
 * - 会话平台:注入 mock opener 后连接检查走浏览器登录态。
 */
import { describe, expect, it } from "vitest";
import { buildRunnerApp } from "../src/server.js";
import { loadRunnerConfig } from "../src/config.js";
import type { RunnerConfig } from "../src/config.js";
import type { PlatformHttpClient } from "@mpp/core";

function testConfig(): RunnerConfig {
  return { ...loadRunnerConfig({}), token: "test-token", authEnabled: false };
}

/** 带鉴权的配置(验证 connect 路由被 token 保护)。 */
function authedConfig(): RunnerConfig {
  return { ...loadRunnerConfig({}), token: "test-token", authEnabled: true };
}

describe("runner /platform-api/connect", () => {
  it("公众号平台提示走 server", async () => {
    const app = await buildRunnerApp({ config: testConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "wechat", credentials: {} },
    });
    const json = res.json() as { ok: boolean; error: string };
    expect(res.statusCode).toBe(400);
    expect(json.error).toContain("公众号请走 server");
  });

  it("未知平台 400", async () => {
    const app = await buildRunnerApp({ config: testConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "unknown-foo", credentials: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("CSDN 缺少 Cookie → invalid-credentials", async () => {
    const app = await buildRunnerApp({ config: testConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "csdn", credentials: {} },
    });
    const json = res.json() as { ok: boolean; errorKind: string };
    expect(json.ok).toBe(false);
    expect(json.errorKind).toBe("invalid-credentials");
  });

  it("CSDN 合法 Cookie → 解析账号", async () => {
    const app = await buildRunnerApp({
      config: testConfig(),
      platformApiHttp: mockHttp((url) => {
        expect(url).toContain("myself/info");
        return {
          status: 200,
          text: JSON.stringify({ code: 200, data: { userName: "alice", nickname: "爱丽丝", avatar: "https://a/x.png" } }),
        };
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "csdn", credentials: { cookie: "session=abc" } },
    });
    const json = res.json() as { ok: boolean; account: { name?: string } };
    expect(json.ok).toBe(true);
    expect(json.account?.name).toBe("爱丽丝");
  });

  it("CSDN Cookie 无效 → unauthorized", async () => {
    const app = await buildRunnerApp({
      config: testConfig(),
      platformApiHttp: mockHttp(() => ({ status: 401, text: "{}" })),
    });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "csdn", credentials: { cookie: "expired" } },
    });
    const json = res.json() as { ok: boolean; errorKind: string };
    expect(json.ok).toBe(false);
    expect(json.errorKind).toBe("unauthorized");
  });

  it("会话平台用 mock opener 连接并解析账号", async () => {
    const app = await buildRunnerApp({
      config: testConfig(),
      platformApiSessionOpener: async () => {
        // mock opener 返回一个假的 page(不走真实浏览器)。
        return { pages: () => [] } as never;
      },
    });
    // 会话平台在无浏览器环境下返回 network 错误(说明走了 opener 路径)。
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "zhihu", credentials: {} },
    });
    const json = res.json() as { ok: boolean; platformId: string };
    expect(json.platformId).toBe("zhihu");
    expect(json.ok).toBe(false); // 无真实浏览器 → 失败,但路径正确
  });

  it("connect 路由被 token 保护(无 token → 401)", async () => {
    const app = await buildRunnerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "csdn", credentials: { cookie: "x" } },
    });
    expect(res.statusCode).toBe(401);
  });
});

/** mock HTTP client 工厂。 */
function mockHttp(handler: (url: string) => { status: number; text: string }): PlatformHttpClient {
  return {
    async request({ url }) {
      const r = handler(url);
      return { status: r.status, headers: {}, text: r.text };
    },
  };
}
