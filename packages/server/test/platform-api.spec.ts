/**
 * server 平台 API 连接路由测试 —— /platform-api/connect(公众号官方 API)。
 *
 * 覆盖:
 * - 非 wechat 平台返回明确提示(走 runner);
 * - wechat 未配置凭据 → invalid-credentials;
 * - wechat 配置凭据但网络异常 → 返回网络错误(不泄漏密钥);
 * - 路由被 token 保护(无 token → 401);
 * - /platform-api/status 返回配置摘要。
 */
import { describe, expect, it } from "vitest";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";

function authedConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    wechat: { appId: "wx-test", secret: "secret-test", configured: true },
    ...overrides,
  };
}

describe("server /platform-api/connect", () => {
  it("非 wechat 平台返回提示(走 runner)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      headers: { "X-MPP-Token": "test-token" },
      payload: { platformId: "zhihu", credentials: {} },
    });
    const json = res.json() as { ok: boolean; error: string };
    expect(res.statusCode).toBe(400);
    expect(json.error).toContain("请走 runner");
  });

  it("wechat 未配置凭据 → invalid-credentials", async () => {
    const app = await buildServerApp({
      config: authedConfig({ wechat: { appId: "", secret: "", configured: false } }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      headers: { "X-MPP-Token": "test-token" },
      payload: { platformId: "wechat", credentials: {} },
    });
    const json = res.json() as { ok: boolean; errorKind: string; message: string };
    expect(json.ok).toBe(false);
    expect(json.errorKind).toBe("invalid-credentials");
    expect(json.message).toContain("未配置");
  });

  it("wechat 配置凭据但调用失败 → 明确错误(不泄漏密钥)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      headers: { "X-MPP-Token": "test-token" },
      payload: { platformId: "wechat", credentials: {} },
    });
    const json = res.json() as { ok: boolean; errorKind: string; message: string };
    // 沙箱可能无外网(network)或微信返回 errcode(invalid-credentials/unauthorized/api-error):
    // 只要 ok=false 且不泄漏密钥即符合预期。
    expect(json.ok).toBe(false);
    expect(json.errorKind).toBeTypeOf("string");
    expect(JSON.stringify(res.json())).not.toContain("secret-test");
    expect(json.message).not.toContain("secret-test");
  });

  it("无 token → 401", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/platform-api/connect",
      payload: { platformId: "wechat", credentials: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it("/platform-api/status 返回配置摘要(不含密钥)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "GET",
      url: "/platform-api/status",
      headers: { "X-MPP-Token": "test-token" },
    });
    const json = res.json() as { ok: boolean; wechat: { configured: boolean } };
    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.wechat.configured).toBe(true);
    expect(JSON.stringify(json)).not.toContain("secret-test");
  });

  it("ACCOUNT-03:/platform-api/status 返回多账号引用(不含密钥)", async () => {
    const app = await buildServerApp({
      config: authedConfig({
        wechat: {
          appId: "wx-a",
          secret: "secret-a",
          configured: true,
          profiles: [
            { id: "profile-main", appId: "wx-main", secret: "secret-main", name: "主号" },
            { id: "profile-sub", appId: "wx-sub", secret: "secret-sub", name: "副号" },
          ],
        },
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/platform-api/status",
      headers: { "X-MPP-Token": "test-token" },
    });
    const json = res.json() as { ok: boolean; wechat: { configured: boolean; profiles: Array<{ id: string; name?: string }> } };
    expect(res.statusCode).toBe(200);
    expect(json.wechat.configured).toBe(true);
    expect(json.wechat.profiles.map((p) => p.id)).toContain("profile-main");
    expect(JSON.stringify(json)).not.toContain("secret-main");
    expect(JSON.stringify(json)).not.toContain("secret-sub");
  });
});
