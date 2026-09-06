/**
 * server 任务 REST 客户端单元测试 —— fetchServerJobs / postServerJob。
 *
 * 验证:
 * - GET /jobs 拼接 URL、带 X-MPP-Token、解析 jobs;
 * - POST resume/cancel/retry 路径与 body;
 * - 非 2xx 返回错误(不抛异常);
 * - 网络异常返回统一错误提示(不泄露细节)。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchServerJobs, postServerJob } from "../src/bridge/server-jobs.js";

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

describe("fetchServerJobs", () => {
  it("GET /jobs 携带 token,解析 jobs 列表", async () => {
    let capturedUrl = "";
    let capturedToken = "";
    stubFetch((url, init) => {
      capturedUrl = url;
      capturedToken = (init.headers as Record<string, string>)["X-MPP-Token"] ?? "";
      return new Response(
        JSON.stringify({
          ok: true,
          jobs: [{ id: "j1", stage: "succeeded", contentDigest: "d", platforms: [], createdAt: "", updatedAt: "" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const res = await fetchServerJobs({ serverUrl: BASE, token: TOKEN });
    expect(capturedUrl).toBe(`${BASE}/jobs`);
    expect(capturedToken).toBe(TOKEN);
    expect(res.ok).toBe(true);
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs?.[0]?.id).toBe("j1");
  });

  it("非 2xx 返回 ok=false 与错误信息", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: false, error: "任务不存在" }), { status: 404 }));
    const res = await fetchServerJobs({ serverUrl: BASE, token: TOKEN });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("任务不存在");
  });

  it("网络异常返回统一错误提示", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const res = await fetchServerJobs({ serverUrl: BASE, token: TOKEN });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("无法连接本地 server");
  });
});

describe("postServerJob", () => {
  it("resume 路径为 /jobs/:id/resume,携带 token", async () => {
    let capturedUrl = "";
    stubFetch((url, init) => {
      capturedUrl = url;
      void init;
      return new Response(JSON.stringify({ ok: true, job: { id: "j1", stage: "verifying" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const res = await postServerJob({ serverUrl: BASE, token: TOKEN, jobId: "j1" }, "resume");
    expect(capturedUrl).toBe(`${BASE}/jobs/j1/resume`);
    expect(res.ok).toBe(true);
    expect(res.job?.stage).toBe("verifying");
  });

  it("retry 带 platformId body", async () => {
    let capturedBody = "";
    stubFetch((_url, init) => {
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ ok: true, job: { id: "j1", stage: "adapting" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const res = await postServerJob({ serverUrl: BASE, token: TOKEN, jobId: "j1", platformId: "wechat" }, "retry", {
      platformId: "wechat",
    });
    expect(res.ok).toBe(true);
    expect(JSON.parse(capturedBody)).toEqual({ platformId: "wechat" });
  });

  it("cancel 请求空 body 时发送 {} ", async () => {
    let capturedBody = "";
    stubFetch((_url, init) => {
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ ok: true, job: { id: "j1", stage: "cancelled" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const res = await postServerJob({ serverUrl: BASE, token: TOKEN, jobId: "j1" }, "cancel");
    expect(res.ok).toBe(true);
    expect(JSON.parse(capturedBody)).toEqual({});
  });
});
