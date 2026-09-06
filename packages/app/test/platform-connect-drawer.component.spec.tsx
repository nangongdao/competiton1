/**
 * PlatformConnectDrawer 组件测试 —— 平台一键连接抽屉。
 *
 * 验证:
 * - 打开后列出全部平台(含 CSDN);
 * - 每个平台展示「一键连接」按钮;
 * - 点击后调用 bridge.connectPlatform 并展示结果;
 * - 公众号/CSDN 显示凭据输入框;会话平台显示浏览器登录提示;
 * - 连接结果展示账号信息。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "./helpers/render.js";
import { PlatformConnectDrawer } from "../src/components/PlatformConnectDrawer.js";
import type { PlatformBridge, PlatformConnectResult } from "../src/bridge/types.js";

function mockBridge(connect: (req: { platformId: string }) => Promise<PlatformConnectResult>): PlatformBridge {
  return {
    env: "web",
    writeClipboard: async () => true,
    assistedHandoff: async () => ({ ok: true, method: "clipboard", message: "ok" }),
    publishWechat: async () => ({ ok: true, message: "ok" }),
    publishAutomation: async () => ({ ok: true, status: "submitted", message: "ok" }),
    uploadAsset: async () => ({ ok: true, url: "https://x", message: "ok" }),
    getSetting: async () => undefined,
    setSetting: async () => undefined,
    connectPlatform: async (req) => connect(req),
  };
}

function renderDrawer(bridge: PlatformBridge, overrides: Partial<Parameters<typeof PlatformConnectDrawer>[0]> = {}) {
  return render(
    <PlatformConnectDrawer
      open
      onOpenChange={() => undefined}
      bridge={bridge}
      serverUrl="http://127.0.0.1:8787"
      serverToken="srv-tok"
      runnerUrl="http://127.0.0.1:8790"
      runnerToken="run-tok"
      {...overrides}
    />,
  );
}

describe("PlatformConnectDrawer — 平台一键连接", () => {
  it("列出全部平台(公众号/知乎/B站/小红书/掘金/博客园/CSDN)", () => {
    renderDrawer(mockBridge(async () => ({ ok: false, platformId: "x", message: "x", at: "" })));
    expect(screen.getByText("微信公众号")).toBeTruthy();
    expect(screen.getByText("知乎")).toBeTruthy();
    expect(screen.getByText("B站专栏")).toBeTruthy();
    expect(screen.getByText("小红书")).toBeTruthy();
    expect(screen.getByText("掘金")).toBeTruthy();
    expect(screen.getByText("博客园")).toBeTruthy();
    expect(screen.getByText("CSDN 博客")).toBeTruthy();
  });

  it("公众号平台展示 AppID/AppSecret 凭据输入框", () => {
    renderDrawer(mockBridge(async () => ({ ok: false, platformId: "x", message: "x", at: "" })));
    expect(screen.getByText("AppID")).toBeTruthy();
    expect(screen.getByText("AppSecret")).toBeTruthy();
  });

  it("会话平台展示浏览器登录提示而非密钥输入", () => {
    renderDrawer(mockBridge(async () => ({ ok: false, platformId: "x", message: "x", at: "" })));
    // 5 个会话平台(知乎/B站/小红书/掘金/博客园)都渲染浏览器登录提示。
    expect(screen.getAllByText(/请先在 runner 打开的浏览器中登录该平台/).length).toBe(5);
    // AppID/AppSecret 仅公众号一个(会话平台不渲染密钥输入框)。
    expect(screen.queryAllByText("AppSecret")).toHaveLength(1);
  });

  it("点击一键连接:wechat 走 server,并展示成功账号信息", async () => {
    const connect = vi.fn(async (req: { platformId: string }): Promise<PlatformConnectResult> => {
      expect(req.platformId).toBe("wechat");
      return { ok: true, platformId: "wechat", message: "连接成功:已获取 access_token", account: { name: "测试公众号" }, at: "2026-08-05T00:00:00Z" };
    });
    renderDrawer(mockBridge(connect));

    const btn = screen.getByRole("button", { name: "一键连接 微信公众号" });
    fireEvent.click(btn);
    await waitFor(() => expect(connect).toHaveBeenCalled());
    expect(await screen.findByText(/连接成功/)).toBeTruthy();
    expect(await screen.findByText(/测试公众号/)).toBeTruthy();
  });

  it("点击一键连接失败时展示错误信息", async () => {
    const connect = vi.fn(async () => ({
      ok: false,
      platformId: "zhihu",
      message: "请先登录",
      errorKind: "unauthorized",
      at: "2026-08-05T00:00:00Z",
    }));
    renderDrawer(mockBridge(connect));
    const btn = screen.getByRole("button", { name: "一键连接 知乎" });
    fireEvent.click(btn);
    expect(await screen.findByText(/请先登录/)).toBeTruthy();
  });

  it("显示连接地址与鉴权状态", () => {
    renderDrawer(mockBridge(async () => ({ ok: false, platformId: "x", message: "x", at: "" })));
    // runner 平台的连接地址提示。
    expect(screen.getAllByText(/连接地址:http:\/\/127\.0\.0\.1:8790/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/连接地址:http:\/\/127\.0\.0\.1:8787/).length).toBeGreaterThan(0);
  });
});
