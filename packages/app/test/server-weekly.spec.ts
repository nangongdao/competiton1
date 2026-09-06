/**
 * v4 Phase 2 · WEEKLY-03 周报投递客户端单元测试 —— sendWeeklyViaServer。
 *
 * 验证:
 * - POST /weekly/send 拼接 URL、带 X-MPP-Token、发送 report+deliveries;
 * - 解析逐渠道结果;
 * - 非 2xx / 网络异常返回统一错误提示(不泄露细节)。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWeeklyViaServer } from "../src/bridge/server-weekly.js";

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

describe("sendWeeklyViaServer", () => {
  it("POST /weekly/send 携带 token 与 report/deliveries,解析结果", async () => {
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
          allDelivered: true,
          configured: true,
          results: [{ kind: "webhook", ok: true, message: "已送达" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const res = await sendWeeklyViaServer({
      serverUrl: BASE,
      token: TOKEN,
      report: "# 周报",
      title: "内容周报",
      deliveries: [{ kind: "webhook", target: "https://hooks.slack.com/x" }],
    });
    expect(capturedUrl).toBe(`${BASE}/weekly/send`);
    expect(capturedToken).toBe(TOKEN);
    expect(capturedBody).toMatchObject({ title: "内容周报", report: "# 周报" });
    expect(res.ok).toBe(true);
    expect(res.allDelivered).toBe(true);
    expect(res.results[0]?.ok).toBe(true);
  });

  it("server ok=false 返回统一错误", async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ ok: false, allDelivered: false, configured: false, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await sendWeeklyViaServer({
      serverUrl: BASE,
      token: TOKEN,
      report: "# 周报",
      deliveries: [{ kind: "email", target: "boss@example.com" }],
    });
    expect(res.ok).toBe(false);
  });

  it("非 2xx 返回统一错误提示", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "内部错误" }), { status: 502 }));
    const res = await sendWeeklyViaServer({
      serverUrl: BASE,
      report: "# 周报",
      deliveries: [],
    });
    expect(res.ok).toBe(false);
    expect(res.message).toBe("内部错误");
  });

  it("网络异常返回统一错误提示(不泄露细节)", async () => {
    stubFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const res = await sendWeeklyViaServer({
      serverUrl: BASE,
      report: "# 周报",
      deliveries: [],
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("无法连接本地 server");
  });
});
