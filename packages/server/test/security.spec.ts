/**
 * server 安全集成测试 —— capability token 鉴权、JSON Schema、统一错误 envelope。
 */
import { describe, expect, it } from "vitest";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { WechatPublisher, type ImageFetcher } from "../src/wechat/rehost.js";

/** 测试配置:鉴权启用 + 固定 token。 */
function authedConfig(): ServerConfig {
  return { ...loadConfig({}), token: "test-token", authEnabled: true };
}

/** 测试配置:鉴权关闭(仅用于非鉴权用例)。 */
function openConfig(): ServerConfig {
  return { ...loadConfig({}), token: "test-token", authEnabled: false };
}

describe("server capability token 鉴权(SEC-01)", () => {
  it("未携带 token 的副作用路由返回 401", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({ method: "GET", url: "/wechat/publish" });
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.json())).toContain("缺少访问令牌");
    await app.close();
  });

  it("错误 token 返回 403", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "GET",
      url: "/wechat/publish",
      headers: { "x-mpp-token": "wrong" },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).toContain("访问令牌无效");
    await app.close();
  });

  it("合法 token 可访问路由(未配置凭据时返回明确提示)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers: { "x-mpp-token": "test-token", "content-type": "application/json" },
      payload: { title: "标题", content: "<p>正文</p>" },
    });
    // 凭据未配置 → 明确提示(而非 401),说明已通过鉴权。
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    await app.close();
  });

  it("健康检查无需 token", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "mpp-server" });
    await app.close();
  });
});

describe("server 路由 JSON Schema(SEC-03)", () => {
  it("畸形公众号发布请求被稳定拒绝(400)", async () => {
    const cfg = { ...authedConfig(), wechat: { appId: "a", secret: "s", configured: true } };
    const app = await buildServerApp({ config: cfg });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers: { "x-mpp-token": "test-token", "content-type": "application/json" },
      payload: { content: "<p>缺标题</p>" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("超大 body 被限流层拒绝", async () => {
    const cfg = { ...authedConfig(), wechat: { appId: "a", secret: "s", configured: true } };
    const app = await buildServerApp({ config: cfg });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers: { "x-mpp-token": "test-token", "content-type": "application/json" },
      payload: { title: "标题", content: "x".repeat(2_100_000) },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
});

describe("server 发布器注入与单例(REL-01)", () => {
  it("注入的发布器被路由调用(验证单例注入接线)", async () => {
    let calls = 0;
    const fetcher: ImageFetcher = async (url) => ({
      bytes: new Uint8Array([1]),
      mime: "image/png",
      finalUrl: url,
    });
    const publisher = new WechatPublisher("appid", "secret", { imageFetcher: fetcher });
    // 替换 publish 方法,统计调用次数。
    const original = publisher.publish.bind(publisher);
    (publisher as unknown as { publish: () => Promise<{ ok: boolean; message: string }> }).publish = () => {
      calls++;
      return Promise.resolve({ ok: true, message: "spy" });
    };

    const cfg = { ...openConfig(), wechat: { appId: "a", secret: "s", configured: true } };
    const app = await buildServerApp({ config: cfg, wechatPublisher: publisher });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers: { "content-type": "application/json" },
      payload: { title: "标题", content: "<p>正文</p>", coverImageUrl: "https://example.com/c.png" },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(1);
    void original;
    await app.close();
  });
});
