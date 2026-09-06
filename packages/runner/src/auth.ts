/**
 * runner 鉴权 —— 复用 server 的安全基元(常量时间比较 + bearer 提取)。
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** 客户端请求头。 */
export const TOKEN_HEADER = "x-mpp-token";

/** 不需要鉴权的路径前缀(健康检查)。 */
const PUBLIC_PREFIXES = ["/health"];

/** 常量时间比较。 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 从请求头提取 bearer token。 */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1];
}

export interface RunnerAuthOptions {
  readonly token: string;
  readonly enabled: boolean;
}

/** 注册全局鉴权前置钩子。 */
export function registerRunnerAuth(app: FastifyInstance, options: RunnerAuthOptions): void {
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
