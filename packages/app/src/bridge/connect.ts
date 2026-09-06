/**
 * 平台一键连接客户端 —— web/扩展/桌面共用。
 *
 * 路由规则(与 server/runner 的 /platform-api/connect 对应):
 * - wechat → server(官方 API,server 持有凭据);
 * - zhihu/bilibili/xiaohongshu/juejin/cnblogs/csdn → runner(浏览器登录态/官方接口)。
 */
import type { PlatformConnectRequest, PlatformConnectResult } from "./types.js";

/** 需要转发到 runner 的会话平台(其余默认走 server)。 */
const RUNNER_PLATFORM_IDS = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"] as const;

/** 统一的一键连接实现。 */
export async function connectPlatform(req: PlatformConnectRequest): Promise<PlatformConnectResult> {
  const isRunner = (RUNNER_PLATFORM_IDS as readonly string[]).includes(req.platformId);
  const base = req.baseUrl.replace(/\/+$/, "");
  const url = `${base}/platform-api/connect`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platformId: req.platformId,
        credentials: req.credentials,
        ...(req.profileDir ? { profileDir: req.profileDir } : {}),
        ...(req.serverProfileId ? { serverProfileId: req.serverProfileId } : {}),
      }),
    });
    const data = (await res.json()) as PlatformConnectResult;
    if (!res.ok) {
      return {
        ok: false,
        platformId: req.platformId,
        message: (data as { error?: string }).error ?? `连接服务返回 ${res.status}`,
        at: new Date().toISOString(),
      };
    }
    return data;
  } catch (err) {
    const service = isRunner ? "runner" : "server";
    return {
      ok: false,
      platformId: req.platformId,
      message: `无法连接本地 ${service}(${req.baseUrl}):${err instanceof Error ? err.message : String(err)}。请先在设置/终端启动 ${service}。`,
      at: new Date().toISOString(),
    };
  }
}
