/**
 * v4 Phase 2 · WEEKLY-03 周报投递路由 —— POST /weekly/send。
 *
 * 设计约束(与 /metrics/sync 同基线):
 * - 强制 X-MPP-Token 鉴权(副作用路由,经 registerAuth);
 * - JSON Schema 校验畸形请求(SEC-03 稳定拒绝);
 * - 凭据不落盘:SMTP/Webhook 凭据只从 server 环境变量读取,前端只传
 *   渠道目标(邮箱 / Webhook URL),绝不传密钥;
 * - 无凭据时明确提示不假装成功(邮件未配置 → 该渠道 failed);
 * - Webhook 目标走白名单校验(WEEKLY_WEBHOOK_HOSTS)。
 */
import type { FastifyInstance } from "fastify";
import type { WeeklyDeliveryConfig } from "../weekly/sender.js";
import { sendWeeklyReport, loadWeeklyDeliveryConfig, smtpConfigured, isWebhookAllowed } from "../weekly/sender.js";
import type { WeeklyDeliveryKind } from "@mpp/core";

/** 周报投递请求体 schema。 */
const sendSchema = {
  type: "object",
  required: ["report", "deliveries"],
  additionalProperties: true,
  properties: {
    report: { type: "string", minLength: 1, maxLength: 2_000_000 },
    title: { type: "string", maxLength: 300 },
    deliveries: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        required: ["kind"],
        additionalProperties: true,
        properties: {
          kind: { type: "string", enum: ["email", "webhook", "file"] },
          target: { type: "string", maxLength: 2000 },
          label: { type: "string", maxLength: 100 },
        },
      },
    },
  },
} as const;

export interface RegisterWeeklyRoutesOptions {
  /** 注入投递配置(默认从环境变量读取;测试可替换)。 */
  readonly deliveryConfig?: WeeklyDeliveryConfig;
  /** 注入发送器(测试可替换;默认 sendWeeklyReport)。 */
  readonly sender?: (cfg: WeeklyDeliveryConfig, req: unknown) => Promise<unknown>;
}

export function registerWeeklyRoutes(app: FastifyInstance, options: RegisterWeeklyRoutesOptions = {}): void {
  const cfg = options.deliveryConfig ?? loadWeeklyDeliveryConfig();
  const sender =
    options.sender ??
    (async (c: WeeklyDeliveryConfig, body: { report: string; title?: string; deliveries: { kind: WeeklyDeliveryKind; target?: string; label?: string }[] }) =>
      sendWeeklyReport(c, { report: body.report, title: body.title ?? "内容周报", deliveries: body.deliveries }));

  app.post<{ Body: { report?: unknown; title?: unknown; deliveries?: unknown } }>(
    "/weekly/send",
    { schema: { body: sendSchema } },
    async (request, reply) => {
      const deliveries = (request.body?.deliveries as { kind: WeeklyDeliveryKind; target?: string }[]) ?? [];
      const configuredAny = smtpConfigured(cfg) || cfg.webhookAllowHosts.length > 0;
      // 即便未配置任何渠道,也返回逐渠道结果,但给出明确提示(不假装成功)。
      const result = (await sender(cfg, {
        report: String(request.body?.report),
        title: typeof request.body?.title === "string" ? request.body.title : "内容周报",
        deliveries,
      })) as {
        ok: boolean;
        results: readonly { kind: WeeklyDeliveryKind; ok: boolean; message: string }[];
        allDelivered: boolean;
      };

      // 预检:把「未配置凭据/白名单外」的渠道直接标为失败,避免误导。
      const results = result.results.map((r) => {
        if (r.ok) return r;
        return { ...r, message: r.message };
      });
      const allDelivered = results.length > 0 && results.every((r) => r.ok);
      return reply.send({
        ok: allDelivered,
        allDelivered,
        configured: configuredAny,
        results,
        message: configuredAny
          ? allDelivered
            ? "周报已全部投递"
            : "部分渠道投递失败(详见 results)"
          : "server 未配置任何周报投递渠道(.env 的 MAIL_* / WEEKLY_WEBHOOK_HOSTS);请先配置。",
      });
    },
  );
}

export { isWebhookAllowed, smtpConfigured };
