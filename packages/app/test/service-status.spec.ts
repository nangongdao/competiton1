/**
 * UX-01 服务依赖状态检测测试。
 */
import { describe, expect, it } from "vitest";
import {
  buildDefaultProbes,
  checkAllServices,
  probeService,
  type ServiceHealth,
} from "../src/services/service-status.js";

function mockFetch(status: number, body: unknown, opts?: { delay?: number; abort?: boolean }): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    const delay = opts?.delay ?? 0;
    // 模拟真实 fetch:超时通过 AbortController.abort() 触发,并在被中止时抛 AbortError。
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
    if (opts?.abort) signal?.dispatchEvent(new Event("abort"));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

const probe = { id: "server" as const, name: "上传/公众号服务", healthUrl: "http://127.0.0.1:8787/health" };

describe("probeService", () => {
  it("200 + ok:true → online", async () => {
    const h = await probeService(probe, { fetchImpl: mockFetch(200, { ok: true, service: "mpp-server", wechatConfigured: true }) });
    expect(h.status).toBe("online");
    expect(h.detail).toContain("公众号凭据已配置");
  });

  it("200 + wechatConfigured:false → online 且提示仅模拟", async () => {
    const h = await probeService(probe, { fetchImpl: mockFetch(200, { ok: true, wechatConfigured: false }) });
    expect(h.status).toBe("online");
    expect(h.detail).toContain("未配置公众号凭据");
  });

  it("HTTP 500 → offline 且带状态码", async () => {
    const h = await probeService(probe, { fetchImpl: mockFetch(500, {}) });
    expect(h.status).toBe("offline");
    expect(h.detail).toBe("HTTP 500");
    expect(h.hint).toContain("500");
  });

  it("响应缺少 ok → unknown", async () => {
    const h = await probeService(probe, { fetchImpl: mockFetch(200, { foo: 1 }) });
    expect(h.status).toBe("unknown");
  });

  it("网络错误 → offline", async () => {
    const h = await probeService(probe, {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(h.status).toBe("offline");
    expect(h.hint).toContain("未检测到");
  });

  it("超时 → offline 且提示连接超时", async () => {
    const h = await probeService(probe, {
      timeoutMs: 50,
      fetchImpl: mockFetch(200, { ok: true }, { delay: 500 }),
    });
    expect(h.status).toBe("offline");
    expect(h.detail).toContain("超时");
  });

  it("runner 响应带 browser.installed:false → online 且提示浏览器不可用", async () => {
    const runner = { id: "runner" as const, name: "Playwright Runner", healthUrl: "http://127.0.0.1:8790/health" };
    const h = await probeService(runner, { fetchImpl: mockFetch(200, { ok: true, browser: { installed: false } }) });
    expect(h.status).toBe("online");
    expect(h.detail).toContain("浏览器不可用");
  });
});

describe("buildDefaultProbes / checkAllServices", () => {
  it("构造 server/runner 探测目标并去除尾部斜杠", () => {
    const probes = buildDefaultProbes("http://127.0.0.1:8787/", "http://127.0.0.1:8790");
    expect(probes).toHaveLength(2);
    expect(probes[0]!.healthUrl).toBe("http://127.0.0.1:8787/health");
    expect(probes[1]!.healthUrl).toBe("http://127.0.0.1:8790/health");
  });

  it("并发检测全部服务并按键索引", async () => {
    const probes = buildDefaultProbes("http://127.0.0.1:8787", "http://127.0.0.1:8790");
    const healths: Record<string, ServiceHealth> = await checkAllServices(probes, {
      fetchImpl: mockFetch(200, { ok: true }),
    });
    expect(healths.server?.status).toBe("online");
    expect(healths.runner?.status).toBe("online");
  });
});
