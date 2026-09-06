/**
 * server 公众号官方指标转发路由 —— DATA-03 落地。
 *
 * 链路:
 *   app(效果回收面板「官方 API 同步」)
 *     → POST /metrics/sync  { remoteIds: string[] }    (X-MPP-Token 鉴权)
 *     → server 用 stable_token 调 datacube/getarticlesummary(近 30 天)
 *     → 按 remoteId(draft media_id 前缀匹配)解析为统一指标写回
 *
 * 设计约束(与平台 API 契约层一致):
 * - server 是唯一持有公众号密钥的进程,前端只传 remoteId,绝不接触密钥;
 * - 数据在 server 侧解析为 `PostMetrics`(统一 schema),不把微信原始字段直接透传给前端;
 * - 未配置凭据 → 明确提示(不假装成功);remoteId 在 30 天内无匹配 → 该条跳过并说明原因;
 * - 结果按 remoteId 去重,避免重复拉取。
 */
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { WechatAccountRegistry } from "../wechat/accounts.js";
import { WechatMetricsFetcher } from "../wechat/metrics.js";

/** 同步请求体 schema(SEC-03:进入副作用前稳定拒绝畸形请求)。 */
const syncSchema = {
  type: "object",
  required: ["remoteIds"],
  additionalProperties: true,
  properties: {
    remoteIds: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 500 },
      minItems: 1,
      maxItems: 200,
    },
    /** ACCOUNT-03:公众号多账号 —— server profile 引用。 */
    serverProfileId: { type: "string", maxLength: 200 },
  },
} as const;

export interface RegisterMetricsRoutesOptions {
  readonly config: ServerConfig;
  /** 注入公众号指标拉取器(默认用 WechatMetricsFetcher;测试可替换)。 */
  readonly fetcher?: WechatMetricsFetcher;
  /** ACCOUNT-03:多公众号账号注册表(按 serverProfileId 路由)。 */
  readonly accountRegistry?: WechatAccountRegistry;
}

export function registerMetricsRoutes(app: FastifyInstance, options: RegisterMetricsRoutesOptions): void {
  const { config } = options;
  const registry = options.accountRegistry;
  const fetcher =
    options.fetcher ??
    new WechatMetricsFetcher({
      appId: config.wechat.appId,
      secret: config.wechat.secret,
    });

  app.post<{ Body: { remoteIds?: unknown; serverProfileId?: unknown } }>(
    "/metrics/sync",
    { schema: { body: syncSchema } },
    async (request, reply) => {
      const configured = registry ? registry.configured : config.wechat.configured;
      if (!configured) {
        return reply.send({
          ok: false,
          message: "server 未配置公众号凭据(.env 的 WECHAT_APPID/WECHAT_SECRET);无法同步官方指标。",
          updated: 0,
          skipped: 0,
          results: [],
        });
      }
      const remoteIds = (request.body?.remoteIds as string[] | undefined) ?? [];
      // ACCOUNT-03:按 serverProfileId 路由到对应公众号的指标拉取器。
      const profileId = typeof request.body?.serverProfileId === "string" ? request.body.serverProfileId : undefined;
      const creds = registry ? registry.credentialsFor(profileId) : undefined;
      const activeFetcher =
        registry && creds
          ? new WechatMetricsFetcher({ appId: creds.appId, secret: creds.secret })
          : fetcher;
      try {
        const result = await activeFetcher.fetchMany(remoteIds);
        return reply.send({ ok: true, ...result });
      } catch (err) {
        return reply.code(502).send({
          ok: false,
          message: `同步公众号指标失败: ${err instanceof Error ? err.message : String(err)}`,
          statusCode: 502,
        });
      }
    },
  );
}
