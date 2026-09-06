/**
 * server 平台 API 连接路由 —— POST /platform-api/connect。
 *
 * 公众号官方 API 的一键连接:server 持有凭据,用 appid+secret 换取 stable_token,
 * 再查账号信息。与 runner 的会话式平台连接互补:
 * - wechat(官方 API) → server(本路由);
 * - zhihu/bilibili/xiaohongshu/juejin/csdn(浏览器登录态/官方接口) → runner。
 *
 * 鉴权:副作用路由强制 X-MPP-Token(registerAuth 全局前置钩子已覆盖)。
 */
import type { FastifyInstance } from "fastify";
import { WechatPlatformApiProvider } from "@mpp/core";
import type { PlatformHttpClient } from "@mpp/core";
import type { ServerConfig } from "../config.js";
import type { WechatAccountRegistry } from "../wechat/accounts.js";
import { postJson, getJson } from "../wechat/http-client.js";

/** Node 实现的 PlatformHttpClient(复用 server 的 postJson/getJson)。 */
function serverHttpClient(): PlatformHttpClient {
  return {
    async request({ method, url, headers, body }) {
      if (method === "GET") {
        const res = await fetch(url, { headers });
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text: await res.text() };
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text: await res.text() };
    },
  };
}

/** 注册平台 API 连接路由(公众号官方 API)。 */
export function registerPlatformApiRoutes(app: FastifyInstance, config: ServerConfig, accountRegistry?: WechatAccountRegistry): void {
  const provider = new WechatPlatformApiProvider();
  const http = serverHttpClient();

  app.post<{ Body: { platformId?: unknown; credentials?: unknown; serverProfileId?: unknown } }>(
    "/platform-api/connect",
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (platformId !== "wechat") {
        return reply.code(400).send({
          ok: false,
          error: "server 仅支持公众号(wechat)官方 API 连接;知乎/B站/小红书/掘金/CSDN 请走 runner。",
        });
      }
      const credentialsRaw = request.body?.credentials;
      const provided =
        typeof credentialsRaw === "object" && credentialsRaw !== null && !Array.isArray(credentialsRaw)
          ? (credentialsRaw as Record<string, string>)
          : {};
      // ACCOUNT-03:多公众号账号 —— 客户端传 serverProfileId 时按引用取凭据。
      const profileId = typeof request.body?.serverProfileId === "string" ? request.body.serverProfileId : undefined;
      const profileCreds = profileId ? accountRegistry?.credentialsFor(profileId) : undefined;
      // server 持有公众号凭据:客户端不传时回退到 server 配置/账号引用(一键连接无需在前端输入密钥)。
      const credentials = provided["appid"] && provided["secret"]
        ? provided
        : profileCreds
          ? { appid: profileCreds.appId, secret: profileCreds.secret }
          : { appid: config.wechat.appId, secret: config.wechat.secret };
      if (!credentials["appid"] || !credentials["secret"]) {
        return reply.send({
          ok: false,
          platformId: "wechat",
          message: "server 未配置公众号凭据(.env 的 WECHAT_APPID/WECHAT_SECRET);无法一键连接。",
          errorKind: "invalid-credentials",
          at: new Date().toISOString(),
        });
      }
      const result = await provider.checkConnection(
        { platformId: "wechat", credentials },
        http,
        () => new Date().toISOString(),
      );
      return reply.send(result);
    },
  );

  // 诊断接口:公众号凭据配置状态(已鉴权,非敏感摘要)。
  app.get("/platform-api/status", async () => ({
    ok: true,
    wechat: {
      configured: accountRegistry ? accountRegistry.configured : config.wechat.configured,
      profiles: accountRegistry?.listProfiles() ?? [{ id: "default" }],
      // 不回显 appid/secret,只给配置状态与账号引用。
    },
  }));
}

export { postJson, getJson };
