/**
 * runner 平台 API 连接路由 —— POST /platform-api/connect。
 *
 * 一键连接:接收 { platformId, credentials },完成连接检查并解析账号信息。
 * - 会话平台(知乎/B站/小红书/掘金):打开浏览器登录态编辑器,检测登录/风控,解析账号;
 * - CSDN:用 Cookie 调官方 /myself/info 接口解析账号;
 * - wechat:runner 不持密钥,由 server /platform-api/connect 处理(见 @mpp/server)。
 *
 * 鉴权:副作用路由强制 X-MPP-Token(registerRunnerAuth 全局前置钩子已覆盖)。
 */
import type { FastifyInstance } from "fastify";
import type { PlatformHttpClient } from "@mpp/core";
import type { SessionOpener } from "./connect.js";
import { makeCsdnConnectionChecker, makeSessionConnectionChecker } from "./connect.js";

const SESSION_PLATFORM_IDS = [
  "zhihu",
  "bilibili",
  "xiaohongshu",
  "juejin",
  "cnblogs",
  "csdn",
  "weibo",
  "toutiao",
  "douyin",
  "kuaishou",
  "shipinhao",
] as const;
type SessionPlatformId = (typeof SESSION_PLATFORM_IDS)[number];

export interface PlatformApiConnectOptions {
  /** 浏览器会话打开器(复用 runner 的 BrowserSessionManager)。 */
  readonly opener: SessionOpener;
  /** HTTP 客户端(CSDN 官方接口用;缺省用 Node fetch)。 */
  readonly http?: PlatformHttpClient;
}

function isSessionPlatformId(value: unknown): value is SessionPlatformId {
  return typeof value === "string" && (SESSION_PLATFORM_IDS as readonly string[]).includes(value);
}

/** 一键连接检查路由。 */
export function registerPlatformApiConnectRoute(app: FastifyInstance, options: PlatformApiConnectOptions): void {
  app.post<{ Body: { platformId?: unknown; credentials?: unknown; profileDir?: unknown } }>(
    "/platform-api/connect",
    async (request, reply) => {
      const platformId = request.body?.platformId;
      const credentialsRaw = request.body?.credentials;
      if (!isSessionPlatformId(platformId)) {
        return reply.code(400).send({
          ok: false,
          error: `runner 仅支持会话式平台连接: ${SESSION_PLATFORM_IDS.join(", ")};公众号请走 server。`,
        });
      }
      if (typeof credentialsRaw !== "object" || credentialsRaw === null || Array.isArray(credentialsRaw)) {
        return reply.code(400).send({ ok: false, error: "credentials 必须是对象" });
      }
      const credentials = credentialsRaw as Record<string, string>;
      // ACCOUNT-03:会话平台多账号 —— 按账号的浏览器登录 profile 目录路由。
      const profileDir = typeof request.body?.profileDir === "string" && request.body.profileDir ? request.body.profileDir : undefined;
      const now = () => new Date().toISOString();

      if (platformId === "csdn") {
        const http = options.http ?? nodeFetchHttp();
        const result = await makeCsdnConnectionChecker(http)({ platformId, credentials }, now);
        return reply.send(result);
      }

      const result = await makeSessionConnectionChecker(options.opener)({ platformId, credentials, profileDir }, now);
      return reply.send(result);
    },
  );
}

/** Node fetch 实现的 PlatformHttpClient(缺省)。 */
function nodeFetchHttp(): PlatformHttpClient {
  return {
    async request({ method, url, headers, body }) {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text: await res.text() };
    },
  };
}
