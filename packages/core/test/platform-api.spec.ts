/**
 * 平台 API 契约层测试 —— 一键连接/一键解析/注册表/解析工具。
 *
 * 覆盖:
 * - 注册表:五平台 + CSDN 共 6 个 provider 已注册;
 * - 公众号 provider:一键连接(成功/凭据缺失/错误码分类)、账号解析;
 * - 会话式 provider:未注入 checker 时返回 unsupported 提示;
 * - CSDN:描述符/端点/账号解析;
 * - 通用工具:parseJsonResponse / strField / maskSecret / truncate。
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyWechatError,
  getPlatformApi,
  listPlatformApis,
  maskSecret,
  parseCsdnAccountInfo,
  parseJsonResponse,
  parseWechatAccountInfo,
  strField,
  truncate,
  WechatPlatformApiProvider,
} from "../src/platform-api/index.js";
import type { ConnectionCheckResult, PlatformHttpClient } from "../src/platform-api/types.js";

/** 注入的 mock HTTP client(按 URL 返回预置响应)。 */
function mockHttp(routes: ReadonlyArray<{ match: (url: string) => boolean; status?: number; text: string }>): PlatformHttpClient {
  return {
    async request(req) {
      const hit = routes.find((r) => r.match(req.url));
      if (!hit) return { status: 404, headers: {}, text: "{}" };
      return { status: hit.status ?? 200, headers: {}, text: hit.text };
    },
  };
}

const WECHAT_TOKEN = {
  match: (u: string) => u.includes("/stable_token"),
  text: JSON.stringify({ access_token: "token-abc", expires_in: 7200 }),
};
const WECHAT_USER = {
  match: (u: string) => u.includes("/user/get"),
  text: JSON.stringify({ total: 12345, data: { openid: ["o1"] } }),
};

describe("平台 API 注册表", () => {
  it("注册了七个 provider(五平台 + CSDN + 博客园)", () => {
    const apis = listPlatformApis();
    const ids = apis.map((a) => a.descriptor.platformId).sort();
    expect(ids).toEqual(["bilibili", "cnblogs", "csdn", "juejin", "wechat", "xiaohongshu", "zhihu"]);
    expect(getPlatformApi("wechat")?.descriptor.name).toBe("微信公众号");
    expect(getPlatformApi("cnblogs")?.descriptor.name).toBe("博客园");
  });

  it("每个 provider 都声明凭据字段与端点清单(供一键解析 UI)", () => {
    for (const api of listPlatformApis()) {
      expect(api.descriptor.credentials.length).toBeGreaterThan(0);
      expect(api.descriptor.endpoints.length).toBeGreaterThan(0);
      expect(api.descriptor.capabilities).toContain("check");
    }
  });
});

describe("公众号一键连接", () => {
  const provider = new WechatPlatformApiProvider();

  it("凭据齐全时成功并解析账号信息", async () => {
    const http = mockHttp([WECHAT_TOKEN, WECHAT_USER]);
    const res = await provider.checkConnection(
      { platformId: "wechat", credentials: { appid: "wx1", secret: "s3cret" } },
      http,
      () => "2026-08-05T00:00:00.000Z",
    );
    expect(res.ok).toBe(true);
    expect(res.account?.id).toBe("o1");
    expect(res.parsed).toEqual({ followerCount: 12345 });
    expect(res.message).toContain("连接成功");
    expect(res.platformId).toBe("wechat");
  });

  it("缺少凭据返回 invalid-credentials", async () => {
    const res = await provider.checkConnection(
      { platformId: "wechat", credentials: {} },
      mockHttp([]),
      () => "2026-08-05T00:00:00.000Z",
    );
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("invalid-credentials");
  });

  it("错误码分类:40164=白名单(unauthorized),40013=凭据无效", () => {
    expect(classifyWechatError(40164)).toBe("unauthorized");
    expect(classifyWechatError(40013)).toBe("invalid-credentials");
    expect(classifyWechatError(99999)).toBe("api-error");
  });

  it("access_token 获取失败返回错误分类", async () => {
    const http = mockHttp([
      {
        match: (u) => u.includes("/stable_token"),
        text: JSON.stringify({ errcode: 40164, errmsg: "invalid ip" }),
      },
    ]);
    const res = await provider.checkConnection(
      { platformId: "wechat", credentials: { appid: "wx1", secret: "s" } },
      http,
      () => "2026-08-05T00:00:00.000Z",
    );
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("unauthorized");
    expect(res.message).toContain("连接失败");
  });

  it("真实发布(draft)构造请求并返回 remoteId", async () => {
    const calls: string[] = [];
    const http: PlatformHttpClient = {
      async request(req) {
        calls.push(req.url);
        if (req.url.includes("/stable_token")) {
          return { status: 200, headers: {}, text: JSON.stringify({ access_token: "tok" }) };
        }
        if (req.url.includes("/material/add_material")) {
          return { status: 200, headers: {}, text: JSON.stringify({ media_id: "thumb-1" }) };
        }
        if (req.url.includes("/draft/add")) {
          return { status: 200, headers: {}, text: JSON.stringify({ media_id: "draft-1" }) };
        }
        return { status: 200, headers: {}, text: "{}" };
      },
    };
    const res = await provider.publish!(
      {
        platformId: "wechat",
        credentials: { appid: "wx1", secret: "s" },
        mode: "draft",
        payload: {
          title: "标题",
          content: "<p>正文</p>",
          mime: "text/html",
          tags: [],
          imageAssetIds: [],
          extra: { coverImageUrl: "https://img.example.com/cover.png" },
        },
      },
      http,
      () => "2026-08-05T00:00:00.000Z",
    );
    expect(res.ok).toBe(true);
    expect(res.remoteId).toBe("draft-1");
    expect(calls.some((u) => u.includes("/draft/add"))).toBe(true);
  });
});

describe("会话式 provider(无官方 API 平台)", () => {
  it("未注入 checker 时返回 unsupported 提示", async () => {
    const { zhihuSessionProvider } = await import("../src/platform-api/session.js");
    const provider = zhihuSessionProvider();
    const res = await provider.checkConnection(
      { platformId: "zhihu", credentials: {} },
      mockHttp([]),
      () => "2026-08-05T00:00:00.000Z",
    );
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("unsupported");
    expect(res.message).toContain("浏览器登录态");
  });

  it("注入 checker 后委托给 checker", async () => {
    const { zhihuSessionProvider } = await import("../src/platform-api/session.js");
    const checker = vi.fn(async (): Promise<ConnectionCheckResult> => ({
      ok: true,
      platformId: "zhihu",
      message: "已登录",
      account: { name: "知乎用户", id: "u1" },
      at: "2026-08-05T00:00:00.000Z",
    }));
    const provider = zhihuSessionProvider({ checker });
    const res = await provider.checkConnection({ platformId: "zhihu", credentials: {} }, mockHttp([]));
    expect(res.ok).toBe(true);
    expect(checker).toHaveBeenCalledOnce();
  });
});

describe("CSDN provider", () => {
  it("描述符包含官方端点与凭据字段", () => {
    const api = getPlatformApi("csdn")!;
    expect(api.descriptor.endpoints.some((e) => e.name === "myself_info")).toBe(true);
    expect(api.descriptor.endpoints.some((e) => e.name === "article_edit")).toBe(true);
    expect(api.descriptor.credentials[0]?.key).toBe("cookie");
  });

  it("解析 CSDN 账号信息", () => {
    expect(parseCsdnAccountInfo({ code: 200, data: { userName: "alice", nickname: "爱丽丝", avatar: "https://a.example/x.png", url: "https://blog.csdn.net/alice" } })).toEqual({
      id: "alice",
      name: "爱丽丝",
      avatar: "https://a.example/x.png",
      url: "https://blog.csdn.net/alice",
    });
  });
});

describe("通用解析工具", () => {
  it("parseJsonResponse 解析合法 JSON", () => {
    const res = parseJsonResponse<{ a: number }>({ status: 200, headers: {}, text: '{"a":1}' });
    expect(res.ok).toBe(true);
    expect((res.raw as { a: number }).a).toBe(1);
  });

  it("parseJsonResponse 对非法 JSON 返回错误", () => {
    const res = parseJsonResponse({ status: 200, headers: {}, text: "<html>oops</html>" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("不是合法 JSON");
  });

  it("strField 容错读取", () => {
    expect(strField({ a: "x", b: 3 }, "missing", "a")).toBe("x");
    expect(strField({ b: 3 }, "b")).toBe("3");
    expect(strField(null, "a")).toBeUndefined();
  });

  it("maskSecret / truncate", () => {
    expect(maskSecret("abcdef1234")).toBe("ab****34");
    expect(maskSecret("abc")).toBe("****");
    expect(truncate("x".repeat(1000), 10).endsWith("…")).toBe(true);
  });
});

describe("公众号账号解析", () => {
  it("解析 user/get 响应中的 openid 与昵称", () => {
    const parsed = parseWechatAccountInfo({ nickname: "公众号", headimgurl: "https://h/x.png", total: 1 });
    expect(parsed.name).toBe("公众号");
  });
});
