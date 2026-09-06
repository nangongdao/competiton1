/** 健康检查 —— 返回非敏感摘要,便于客户端探测服务可用性。 */
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";

export function registerHealthRoutes(app: FastifyInstance, config: ServerConfig): void {
  app.get("/health", async () => ({
    ok: true,
    service: "mpp-server",
    wechatConfigured: config.wechat.configured,
    // 不返回 token、不返回路径/凭据细节(敏感信息走已鉴权诊断接口)。
    hint: config.wechat.configured
      ? "已配置公众号凭据;若真实发布报 errcode 40164,请把本机出口 IP 加入公众号后台白名单。"
      : "未配置公众号 AppID/Secret,仅支持模拟发布;在 .env 配置后可真实调用草稿 API。",
  }));
}
