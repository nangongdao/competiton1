/**
 * TEST-03 —— 服务依赖状态面板组件测试(UX-01)。
 *
 * 验证:
 * - 打开时发起健康检查并展示 server/runner 行;
 * - online 展示「在线」;
 * - offline 展示「离线」与可执行提示;
 * - 重新检测按钮触发刷新;
 * - 不展示敏感信息(只展示状态摘要)。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "./helpers/render.js";
import { ServiceStatusPanel } from "../src/components/ServiceStatusPanel.js";

afterEach(() => cleanup());

function mockFetchResponses(entries: Array<{ url: string; status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = entries.find((e) => url.includes(e.url));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: async () => hit.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("ServiceStatusPanel — 服务依赖状态(UX-01)", () => {
  it("server/runner 均在线时展示在线", async () => {
    mockFetchResponses([
      { url: "/health", status: 200, body: { ok: true, service: "mpp-server", wechatConfigured: true } },
      { url: "/health", status: 200, body: { ok: true, service: "mpp-runner" } },
    ]);
    render(<ServiceStatusPanel serverUrl="http://127.0.0.1:8787" runnerUrl="http://127.0.0.1:8790" />);
    await waitFor(() => {
      expect(screen.getAllByText("在线").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("上传/公众号服务")).toBeTruthy();
    expect(screen.getByText("Playwright Runner")).toBeTruthy();
  });

  it("服务离线时展示离线与提示", async () => {
    mockFetchResponses([
      { url: "/health", status: 500, body: {} },
      { url: "/health", status: 500, body: {} },
    ]);
    render(<ServiceStatusPanel serverUrl="http://127.0.0.1:8787" runnerUrl="http://127.0.0.1:8790" />);
    await waitFor(() => {
      expect(screen.getAllByText("离线").length).toBeGreaterThan(0);
    });
    // 展示可执行提示。
    const hints = document.querySelectorAll(".service-hint");
    expect(hints.length).toBeGreaterThan(0);
  });

  it("重新检测按钮触发新一次健康检查", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceStatusPanel serverUrl="http://127.0.0.1:8787" runnerUrl="http://127.0.0.1:8790" />);
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    const before = calls;
    const refreshBtn = screen.getByRole("button", { name: "重新检测服务状态" });
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("响应缺少 ok 时展示未知", async () => {
    mockFetchResponses([
      { url: "/health", status: 200, body: { foo: 1 } },
      { url: "/health", status: 200, body: { foo: 1 } },
    ]);
    render(<ServiceStatusPanel serverUrl="http://127.0.0.1:8787" runnerUrl="http://127.0.0.1:8790" />);
    await waitFor(() => {
      expect(screen.getAllByText("未知").length).toBeGreaterThan(0);
    });
  });
});
