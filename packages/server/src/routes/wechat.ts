/** 公众号真实发布路由 —— 接收 payload,调用官方草稿 API。 */
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { WechatPublisher } from "../wechat/rehost.js";
import type { WechatAccountRegistry } from "../wechat/accounts.js";

/** 请求体 JSON Schema(SEC-03):畸形请求在进入副作用代码前被稳定拒绝。 */
const publishSchema = {
  type: "object",
  required: ["title", "content"],
  additionalProperties: true,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    content: { type: "string", minLength: 1, maxLength: 2_000_000 },
    summary: { type: "string", maxLength: 2000 },
    author: { type: "string", maxLength: 100 },
    contentSourceUrl: { type: "string", maxLength: 2000 },
    coverImageUrl: { type: "string", maxLength: 5000 },
    bodyImageUrls: { type: "array", items: { type: "string", maxLength: 5000 }, maxItems: 200 },
    publish: { type: "boolean" },
    /** ACCOUNT-03:公众号多账号 —— server profile 引用。 */
    serverProfileId: { type: "string", maxLength: 200 },
  },
} as const;

/**
 * 注册公众号发布路由。
 *
 * @param app Fastify 实例
 * @param config 配置(凭据/图片抓取)
 * @param publisher 应用生命周期单例(幂等缓存跨请求生效)
 * @param accountRegistry ACCOUNT-03:多公众号账号注册表(按 serverProfileId 路由)
 */
export function registerWechatRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  publisher: WechatPublisher,
  accountRegistry?: WechatAccountRegistry,
): void {
  app.post<{ Body: import("../wechat/rehost.js").WechatPublishPayload & { serverProfileId?: string } }>(
    "/wechat/publish",
    { schema: { body: publishSchema } },
    async (request, reply) => {
      const configured = accountRegistry ? accountRegistry.configured : config.wechat.configured;
      if (!configured) {
        return reply.send({
          ok: false,
          message: "server 未配置公众号凭据(.env 的 WECHAT_APPID/WECHAT_SECRET);请改用模拟发布。",
        });
      }
      const payload = request.body;
      if (!payload?.title || !payload?.content) {
        return reply.code(400).send({ ok: false, message: "缺少 title 或 content" });
      }
      try {
        // ACCOUNT-03:按 serverProfileId 路由到对应公众号发布器;未指定回退默认。
        const pub = accountRegistry?.publisherFor(payload.serverProfileId) ?? publisher;
        const outcome = await pub.publish(payload);
        return reply.send(outcome);
      } catch (err) {
        return reply.send({
          ok: false,
          message: `发布异常: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  );
}
