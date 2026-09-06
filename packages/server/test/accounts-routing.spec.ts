/**
 * ACCOUNT-03 server 侧多公众号账号测试 —— 配置解析 + 按 serverProfileId 路由。
 *
 * 覆盖:
 * - parseWechatProfiles:合法/非法/空/损坏 JSON;
 * - resolveWechatCredentials:按 profile 引用 / 回退默认 / 无凭据;
 * - /wechat/publish 携带 serverProfileId 路由到对应公众号(draft/add 用对应 appid 换取 token);
 * - 未配置凭据 → 明确提示。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { parseWechatProfiles, resolveWechatCredentials } from "../src/config.js";
import { WechatPublisher, type ImageFetcher } from "../src/wechat/rehost.js";

function mockFetcher(): ImageFetcher {
  return async (url) => ({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/png",
    finalUrl: url,
  });
}

function testPublisher(): WechatPublisher {
  return new WechatPublisher("appid", "secret", { imageFetcher: mockFetcher() });
}

function authedConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    wechat: {
      appId: "appid",
      secret: "secret",
      configured: true,
      profiles: [
        { id: "profile-main", appId: "wx-main", secret: "secret-main", name: "主号" },
        { id: "profile-sub", appId: "wx-sub", secret: "secret-sub", name: "副号" },
      ],
    },
    ...overrides,
  };
}

/** stub 微信 API:记录每次 draft/add 用的 access_token 对应的 appid。 */
function stubWechatApi() {
  const usedAppIds: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
      if (url.includes("/cgi-bin/stable_token")) {
        const reqBody = init?.body ? JSON.parse(String(init.body)) : {};
        body.access_token = `TOKEN_${reqBody.appid}`;
      }
      if (url.includes("/draft/add")) {
        const token = url.match(/access_token=([^&]+)/)?.[1] ?? "";
        usedAppIds.push(token.replace("TOKEN_", ""));
        body.media_id = "MEDIA_1";
      }
      if (url.includes("/material/add_material")) body.media_id = "THUMB_1";
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { usedAppIds: () => usedAppIds };
}

const headers = { "x-mpp-token": "test-token", "content-type": "application/json" };
const samplePayload = {
  title: "标题",
  content: "<p>正文</p>",
  coverImageUrl: "https://example.com/c.png",
};

describe("parseWechatProfiles", () => {
  it("解析合法 JSON 数组", () => {
    const profiles = parseWechatProfiles(
      JSON.stringify([
        { id: "a", appId: "wx1", secret: "s1", name: "主号" },
        { id: "b", appId: "wx2", secret: "s2" },
      ]),
    );
    expect(profiles.length).toBe(2);
    expect(profiles[0]).toEqual({ id: "a", appId: "wx1", secret: "s1", name: "主号" });
  });

  it("跳过非法条目 / 空 / 损坏回退空数组", () => {
    expect(parseWechatProfiles(JSON.stringify([{ id: "x" }, { id: "y", appId: "a", secret: "" }]))).toEqual([]);
    expect(parseWechatProfiles("")).toEqual([]);
    expect(parseWechatProfiles("not-json")).toEqual([]);
    expect(parseWechatProfiles('{"a":1}')).toEqual([]);
  });
});

describe("resolveWechatCredentials", () => {
  const wechat = authedConfig().wechat;
  it("按 profile 引用取凭据", () => {
    const creds = resolveWechatCredentials(wechat, "profile-sub");
    expect(creds).toEqual({ appId: "wx-sub", secret: "secret-sub", name: "副号" });
  });
  it("未指定引用回退默认配置", () => {
    const creds = resolveWechatCredentials(wechat, undefined);
    expect(creds).toEqual({ appId: "appid", secret: "secret" });
  });
  it("引用不存在时回退默认配置", () => {
    const creds = resolveWechatCredentials(wechat, "nope");
    expect(creds?.appId).toBe("appid");
  });
  it("无凭据返回 undefined", () => {
    expect(resolveWechatCredentials({ appId: "", secret: "", configured: false, profiles: [] }, undefined)).toBeUndefined();
  });
});

describe("server /wechat/publish 多账号路由", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ACCOUNT-03:serverProfileId 路由到对应公众号凭据", async () => {
    const stub = stubWechatApi();
    const app = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher(), imageFetcher: mockFetcher() });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers,
      payload: { ...samplePayload, serverProfileId: "profile-sub" },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { ok: boolean; remoteId?: string };
    expect(json.ok).toBe(true);
    expect(json.remoteId).toBe("MEDIA_1");
    // draft/add 应使用 profile-sub 的 token(即 wx-sub)。
    expect(stub.usedAppIds()).toContain("wx-sub");
    expect(stub.usedAppIds()).not.toContain("wx-main");
  });

  it("ACCOUNT-03:未指定 serverProfileId 回退默认凭据", async () => {
    const stub = stubWechatApi();
    const app = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher(), imageFetcher: mockFetcher() });
    const res = await app.inject({
      method: "POST",
      url: "/wechat/publish",
      headers,
      payload: samplePayload,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
    expect(stub.usedAppIds()).toContain("appid");
  });
});
