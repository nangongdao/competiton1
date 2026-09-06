/**
 * 本机特权服务鉴权插件 —— 校验客户端携带的 capability token。
 *
 * - 无 token → 401;token 错误 → 403;
 * - /health 与静态资源 /uploads 不强制鉴权(健康检查需要可探测,静态资源是已鉴权上传的产物);
 * - 所有其它路由(含副作用路由 /upload、/wechat/publish)必须携带 X-MPP-Token。
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { extractBearerToken, safeEqual } from "./token.js";

/** 客户端请求头。 */
export const TOKEN_HEADER = "x-mpp-token";

/** 不需要鉴权的路径前缀(健康检查 / 静态产物)。 */
const PUBLIC_PREFIXES = ["/health", "/uploads/", "/favicon.ico"];

export interface AuthPluginOptions {
  readonly token: string;
  readonly enabled: boolean;
}

/** 注册全局鉴权前置钩子。 */
export function registerAuth(app: FastifyInstance, options: AuthPluginOptions): void {
  if (!options.enabled) return;

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split("?")[0] ?? "";
    if (PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(p))) return;

    const header = request.headers[TOKEN_HEADER];
    const bearer = extractBearerToken(typeof header === "string" ? header : undefined);
    const presented = bearer ?? (typeof header === "string" ? header.trim() : "");

    if (!presented) {
      return reply.code(401).send({ ok: false, error: "缺少访问令牌(X-MPP-Token)", statusCode: 401 });
    }
    if (!safeEqual(presented, options.token)) {
      return reply.code(403).send({ ok: false, error: "访问令牌无效", statusCode: 403 });
    }
  });
}
