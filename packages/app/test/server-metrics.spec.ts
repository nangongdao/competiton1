/**
 * server 公众号指标同步客户端单元测试 —— syncServerMetrics / metricsForRemoteId。
 *
 * 验证:
 * - POST /metrics/sync 拼接 URL、带 X-MPP-Token、发送 remoteIds;
 * - 解析统一指标结果;
 * - 非 2xx / ok=false 返回错误(不抛异常);
 * - 网络异常返回统一错误提示(不泄露细节);
 * - metricsForRemoteId 按 remoteId 取出对应指标。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncServerMetrics, metricsForRemoteId } from "../src/bridge/server-metrics.js";

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

describe("syncServerMetrics", () => {
  it("POST /metrics/sync 携带 token 与 remoteIds,解析结果", async () => {
    let capturedUrl = "";
    let capturedToken = "";
    let capturedBody: unknown = null;
    stubFetch((url, init) => {
      capturedUrl = url;
      capturedToken = (init.headers as Record<string, string>)["X-MPP-Token"] ?? "";
      capturedBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          ok: true,
          updated: 2,
          skipped: 0,
          results: [
            { remoteId: "MEDIA_1", ok: true, metrics: { views: 1200, likes: 30 } },
            { remoteId: "MEDIA_2", ok: true, metrics: { views: 800 } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const res = await syncServerMetrics({ serverUrl: BASE, token: TOKEN, remoteIds: ["MEDIA_1", "MEDIA_2"] });
    expect(capturedUrl).toBe(`${BASE}/metrics/sync`);
    expect(capturedToken).toBe(TOKEN);
    expect(capturedBody).toEqual({ remoteIds: ["MEDIA_1", "MEDIA_2"] });
    expect(res.ok).toBe(true);
    expect(res.updated).toBe(2);
    expect(res.results).toHaveLength(2);
  });

  it("server ok=false 返回统一错误", async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ ok: false, message: "未配置公众号凭据", updated: 0, skipped: 0, results: [] }), {
        status: 200,
      }),
    );
    const res = await syncServerMetrics({ serverUrl: BASE, token: TOKEN, remoteIds: ["MEDIA_1"] });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未配置");
  });

  it("非 2xx 返回错误(不抛异常)", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "内部错误" }), { status: 502 }));
    const res = await syncServerMetrics({ serverUrl: BASE, token: TOKEN, remoteIds: ["MEDIA_1"] });
    expect(res.ok).toBe(false);
  });

  it("网络异常返回统一错误提示", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const res = await syncServerMetrics({ serverUrl: BASE, token: TOKEN, remoteIds: ["MEDIA_1"] });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("无法连接本地 server");
  });
});

describe("metricsForRemoteId", () => {
  it("按 remoteId 取出对应指标", () => {
    const result = {
      ok: true,
      updated: 2,
      skipped: 0,
      results: [
        { remoteId: "MEDIA_1", ok: true, metrics: { views: 1200, likes: 30 } },
        { remoteId: "MEDIA_2", ok: false, metrics: {}, message: "无数据" },
      ],
    };
    expect(metricsForRemoteId(result, "MEDIA_1")).toEqual({ views: 1200, likes: 30 });
    expect(metricsForRemoteId(result, "MEDIA_2")).toEqual({});
    expect(metricsForRemoteId(result, "MEDIA_3")).toEqual({});
  });
});
