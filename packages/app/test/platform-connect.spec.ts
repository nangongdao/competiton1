/**
 * 平台一键连接客户端测试 —— connectPlatform 路由与错误处理。
 *
 * 验证:
 * - wechat 走 server;
 * - 会话平台(zhihu/bilibili/xiaohongshu/juejin/cnblogs/csdn)走 runner;
 * - 携带 X-MPP-Token;
 * - 非 2xx 返回错误提示;
 * - 网络异常返回统一提示(不泄漏细节)。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectPlatform } from "../src/bridge/connect.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})),
  );
}

describe("connectPlatform", () => {
  it("wechat 走 server,携带 token", async () => {
    let capturedUrl = "";
    let capturedToken = "";
    stubFetch((url, init) => {
      capturedUrl = url;
      capturedToken = (init.headers as Record<string, string>)["X-MPP-Token"] ?? "";
      return new Response(
        JSON.stringify({
          ok: true,
          platformId: "wechat",
          message: "连接成功",
          account: { name: "公众号" },
          at: "2026-08-05T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const res = await connectPlatform({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
      platformId: "wechat",
      credentials: {},
    });
    expect(capturedUrl).toBe("http://127.0.0.1:8787/platform-api/connect");
    expect(capturedToken).toBe("tok");
    expect(res.ok).toBe(true);
    expect(res.account?.name).toBe("公众号");
  });

  it("会话平台走 runner", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ ok: true, platformId: "zhihu", message: "已连接", at: "2026-08-05T00:00:00Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const res = await connectPlatform({
      baseUrl: "http://127.0.0.1:8790",
      token: "tok2",
      platformId: "zhihu",
      credentials: {},
    });
    expect(capturedUrl).toBe("http://127.0.0.1:8790/platform-api/connect");
    expect(res.ok).toBe(true);
  });

  it("非 2xx 返回错误信息", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: false, error: "不支持的平台" }), { status: 400 }));
    const res = await connectPlatform({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
      platformId: "wechat",
      credentials: {},
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("不支持的平台");
  });

  it("网络异常返回统一提示(含服务名与可排查信息)", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const res = await connectPlatform({
      baseUrl: "http://127.0.0.1:8790",
      token: "tok",
      platformId: "bilibili",
      credentials: {},
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("无法连接本地 runner");
    expect(res.message).toContain("请先在设置/终端启动 runner");
    expect(res.message).toContain("http://127.0.0.1:8790");
  });
});
