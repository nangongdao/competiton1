/**
 * TEST-01 —— server 路由层集成测试(端到端通过 buildServerApp + inject)。
 *
 * 与 unit 测试的差异:这里验证的是“应用接线”本身 ——
 * - 单例 Publisher 跨请求复用 → 两次相同 HTTP 请求只触发一次平台副作用(REL-01/REL-02);
 * - /upload 与 /wechat/publish 的鉴权 + 配额 + schema 在同一 app 实例上生效(SEC-01/03/05);
 * - 统一错误 envelope 稳定(不泄露堆栈/凭据)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { WechatPublisher, type ImageFetcher } from "../src/wechat/rehost.js";

/** 测试用图片抓取器:任何 URL 都返回一张假 PNG(绕过真实 DNS/MIME 校验)。 */
function mockFetcher(): ImageFetcher {
  return async (url) => ({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/png",
    finalUrl: url,
  });
}

/** 构造带 mock 图床抓取器的测试发布器(单例,幂等缓存跨请求生效)。 */
function testPublisher(): WechatPublisher {
  return new WechatPublisher("appid", "secret", { imageFetcher: mockFetcher() });
}

/** 已配置公众号凭据的测试配置。 */
function authedConfig(): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    wechat: { appId: "appid", secret: "secret", configured: true },
    localStore: { maxTotalBytes: 1024 * 1024, maxFileBytes: 1024, retentionMs: 0, cleanupEnabled: false },
  };
}

/** 构造一个 multipart 请求体。 */
function multipartBody(filename: string, mime: string, content: string) {
  const boundary = "----testboundary456";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** stub 微信 API:记录 draft/add 调用次数。 */
function stubWechatApi(opts: { onDraftAdd?: () => void } = {}) {
  let draftAddCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
      if (url.includes("/cgi-bin/stable_token")) body.access_token = "TOKEN";
      if (url.includes("/draft/add")) {
        draftAddCalls++;
        opts.onDraftAdd?.();
        body.media_id = "MEDIA_1";
      }
      if (url.includes("/material/add_material")) body.media_id = "THUMB_1";
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { draftAddCalls: () => draftAddCalls };
}

describe("TEST-01 路由集成:单例发布器跨请求幂等(REL-01/REL-02)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("两次相同发布请求只触发一次微信 API(幂等缓存跨请求生效)", async () => {
    const { draftAddCalls } = stubWechatApi();
    const app = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher() });
    const headers = { "x-mpp-token": "test-token", "content-type": "application/json" };
    const payload = { title: "标题", content: "<p>正文</p>", coverImageUrl: "https://example.com/c.png" };

    const first = await app.inject({ method: "POST", url: "/wechat/publish", headers, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().ok).toBe(true);
    expect(draftAddCalls()).toBe(1);

    // 第二次相同请求:命中单例发布器的幂等缓存,不再调用微信 API。
    const second = await app.inject({ method: "POST", url: "/wechat/publish", headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json().ok).toBe(true);
    expect(draftAddCalls()).toBe(1);

    // 内容变化 → 幂等键变化 → 再次调用(仅一次)。
    const changed = { ...payload, content: "<p>改过的正文</p>" };
    const third = await app.inject({ method: "POST", url: "/wechat/publish", headers, payload: changed });
    expect(third.statusCode).toBe(200);
    expect(draftAddCalls()).toBe(2);
    await app.close();
  });

  it("20 个并发相同 HTTP 请求仍只触发一次微信 API", async () => {
    const { draftAddCalls } = stubWechatApi({
      onDraftAdd: () => new Promise((r) => setTimeout(r, 15)), // 放大并发窗口
    });
    const app = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher() });
    const headers = { "x-mpp-token": "test-token", "content-type": "application/json" };
    const payload = { title: "标题", content: "<p>正文</p>", coverImageUrl: "https://example.com/c.png" };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: "POST", url: "/wechat/publish", headers, payload })),
    );
    for (const r of results) {
      expect(r.statusCode).toBe(200);
      expect(r.json().ok).toBe(true);
    }
    expect(draftAddCalls()).toBe(1);
    await app.close();
  });
});

describe("TEST-01 路由集成:/upload 鉴权 + 配额 + schema(SEC-01/03/05)", () => {
  it("未携带 token 的上传返回 401", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const { body, headers } = multipartBody("a.png", "image/png", "PNG_BYTES");
    const res = await app.inject({ method: "POST", url: "/upload", payload: body, headers });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("合法 token 上传超单文件上限返回 413", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const { body, headers } = multipartBody("big.png", "image/png", "x".repeat(4096));
    const res = await app.inject({
      method: "POST",
      url: "/upload",
      payload: body,
      headers: { ...headers, "x-mpp-token": "test-token" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("畸形公众号请求返回统一错误 envelope(不含堆栈)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers: { "x-mpp-token": "test-token", "content-type": "application/json" },
      payload: { content: "<p>缺标题</p>" },
    });
    expect(res.statusCode).toBe(400);
    const json = res.json() as { ok?: boolean; error?: string };
    // 统一 envelope:ok:false + error 字段;不把内部堆栈/凭据泄漏给客户端。
    expect(json.ok).toBe(false);
    expect(typeof json.error).toBe("string");
    expect(JSON.stringify(json)).not.toContain("at ");
    await app.close();
  });

  it("未配置凭据时通过鉴权但给出明确业务提示", async () => {
    const cfg: ServerConfig = {
      ...authedConfig(),
      wechat: { appId: "", secret: "", configured: false },
    };
    const app = await buildServerApp({ config: cfg });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers: { "x-mpp-token": "test-token", "content-type": "application/json" },
      payload: { title: "标题", content: "<p>正文</p>" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(String(res.json().message)).toContain("未配置公众号凭据");
    await app.close();
  });
});

describe("TEST-01 路由集成:错误 envelope 与 404(SEC-03)", () => {
  it("未知路由返回统一 404 envelope", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "GET",
      url: "/no-such-route",
      headers: { "x-mpp-token": "test-token" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, statusCode: 404 });
    await app.close();
  });
});
