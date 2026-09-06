import { describe, expect, it } from "vitest";
import { buildRunnerApp } from "../src/server.js";
import { loadRunnerConfig } from "../src/config.js";
import type { RunnerConfig } from "../src/config.js";
import type { AutomationPublishRequest, AutomationPublishReceipt } from "../src/types.js";

/** 测试配置:关闭鉴权(老用例语义不变)。 */
function testConfig(): RunnerConfig {
  return { ...loadRunnerConfig({}), token: "test-token", authEnabled: false };
}

/** 启用鉴权的配置。 */
function authedConfig(): RunnerConfig {
  return { ...loadRunnerConfig({}), token: "test-token", authEnabled: true };
}

describe("runner HTTP API", () => {
  it("reports runner health", async () => {
    const app = await buildRunnerApp({
      config: testConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "unused" }),
    });

    const res = await app.inject({ method: "GET", url: "/health" });
    const json = res.json() as { ok: boolean; runner: string; browser: { installed: boolean }; profilesDir: string };

    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.runner).toBe("playwright");
    expect(json.browser.installed).toBeTypeOf("boolean");
    expect(json.profilesDir).toContain("playwright-profiles");
  });

  it("rejects invalid publish requests", async () => {
    const app = await buildRunnerApp({
      config: testConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "unused" }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/automation/publish",
      payload: { platformId: "unknown-foo", mode: "full-auto", payload: {} },
    });
    const json = res.json() as { ok: boolean; error: string };

    expect(res.statusCode).toBe(400);
    expect(json).toEqual({ ok: false, error: "unsupported platformId" });
  });

  it("delegates valid publish requests to the injected publisher", async () => {
    const calls: AutomationPublishRequest[] = [];
    const app = await buildRunnerApp({
      config: testConfig(),
      publisher: async (req): Promise<AutomationPublishReceipt> => {
        calls.push(req);
        return { ok: true, status: "published", message: `published ${req.platformId}`, remoteUrl: "https://example.test/p/1" };
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/automation/publish",
      payload: {
        platformId: "zhihu",
        mode: "full-auto",
        payload: { title: "A", content: "<p>B</p>", mime: "text/html" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      status: "published",
      message: "published zhihu",
      remoteUrl: "https://example.test/p/1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.platformId).toBe("zhihu");
  });

  it("session open returns a user-action receipt before real browser sessions exist", async () => {
    const app = await buildRunnerApp({
      config: testConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "unused" }),
    });

    const res = await app.inject({ method: "POST", url: "/automation/session/open", payload: { platformId: "zhihu" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: false,
      status: "needs-user-action",
    });
  });
});

describe("runner 鉴权(SEC-01)", () => {
  it("未携带 token 的副作用请求返回 401", async () => {
    const app = await buildRunnerApp({
      config: authedConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "unused" }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/automation/publish",
      payload: { platformId: "zhihu", mode: "full-auto", payload: { title: "A", content: "<p>B</p>" } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false });
    expect(JSON.stringify(res.json())).toContain("缺少访问令牌");
  });

  it("错误 token 返回 403", async () => {
    const app = await buildRunnerApp({
      config: authedConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "unused" }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/automation/publish",
      headers: { "x-mpp-token": "wrong-token" },
      payload: { platformId: "zhihu", mode: "full-auto", payload: { title: "A", content: "<p>B</p>" } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: "访问令牌无效" });
  });

  it("合法 token 通过鉴权", async () => {
    const app = await buildRunnerApp({
      config: authedConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "published zhihu", remoteUrl: "https://example.test/p/1" }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/automation/publish",
      headers: { "x-mpp-token": "test-token" },
      payload: { platformId: "zhihu", mode: "full-auto", payload: { title: "A", content: "<p>B</p>", mime: "text/html" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: "published" });
  });

  it("健康检查无需 token", async () => {
    const app = await buildRunnerApp({
      config: authedConfig(),
      publisher: async () => ({ ok: true, status: "published", message: "unused" }),
    });

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});
