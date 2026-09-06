/**
 * server 公众号收件箱消息同步路由 —— INBOX-03 真实消息同步落地。
 *
 * 链路:
 *   app(收件箱「同步平台消息」)
 *     → POST /inbox/sync  { platformId, cursor, accountId }   (X-MPP-Token 鉴权)
 *     → server 用公众号官方评论接口拉取近期评论,归一化为 RemoteInboxItem
 *
 * 约束(与其它 server 路由一致):
 * - 仅支持公众号(wechat);其它平台走 runner 网页自动化或本地演示适配器;
 * - server 是唯一持有公众号密钥的进程,前端只传平台 id 与游标,绝不接触密钥;
 * - 结果归一化为 core `RemoteInboxItem`(不含任何敏感字段)。
 */
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { WechatAccountRegistry } from "../wechat/accounts.js";
import { WechatInboxFetcher } from "../wechat/inbox.js";
import { WechatCommentReplier, type WechatCommentReplyResult } from "../wechat/reply.js";

/** 同步请求体 schema(进入副作用前稳定拒绝畸形请求)。 */
const syncSchema = {
  type: "object",
  required: ["platformId"],
  additionalProperties: true,
  properties: {
    platformId: { type: "string", maxLength: 40 },
    cursor: { type: "string", maxLength: 200 },
    accountId: { type: "string", maxLength: 200 },
    /** ACCOUNT-03:公众号多账号 —— server profile 引用。 */
    serverProfileId: { type: "string", maxLength: 200 },
    limit: { type: "number", minimum: 1, maximum: 200 },
  },
} as const;

/** 评论回发请求体 schema(INBOX-04)。 */
const replySchema = {
  type: "object",
  required: ["platformId", "remoteId", "text"],
  additionalProperties: true,
  properties: {
    platformId: { type: "string", maxLength: 40 },
    remoteId: { type: "string", maxLength: 300 },
    text: { type: "string", minLength: 1, maxLength: 2000 },
    accountId: { type: "string", maxLength: 200 },
    serverProfileId: { type: "string", maxLength: 200 },
    msgDataId: { type: "string", maxLength: 200 },
  },
} as const;

/** 批量自动回复请求体 schema(INBOX-04)。 */
const autoReplySchema = {
  type: "object",
  required: ["platformId"],
  additionalProperties: true,
  properties: {
    platformId: { type: "string", maxLength: 40 },
    messages: { type: "array", maxItems: 200 },
    limit: { type: "number", minimum: 1, maximum: 100 },
    serverProfileId: { type: "string", maxLength: 200 },
  },
} as const;

export interface RegisterInboxRoutesOptions {
  readonly config: ServerConfig;
  /** ACCOUNT-03:多公众号账号注册表(按 serverProfileId 路由)。 */
  readonly accountRegistry?: WechatAccountRegistry;
}

export function registerInboxRoutes(app: FastifyInstance, options: RegisterInboxRoutesOptions): void {
  const { config, accountRegistry } = options;
  // 默认用主配置凭据;多公众号注册表按 accountId/serverProfileId 路由后新建 fetcher。
  const defaultFetcher = new WechatInboxFetcher({
    appId: config.wechat.appId,
    secret: config.wechat.secret,
  });

  app.post<{ Body: { platformId?: unknown; cursor?: unknown; accountId?: unknown; serverProfileId?: unknown; limit?: unknown } }>(
    "/inbox/sync",
    { schema: { body: syncSchema } },
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (platformId !== "wechat") {
        return reply.send({
          ok: false,
          platformId: String(platformId ?? ""),
          fetched: 0,
          added: 0,
          skipped: 0,
          error: "server 仅支持公众号(wechat)评论同步;其它平台请用 runner 或本地演示适配器。",
          at: new Date().toISOString(),
        });
      }
      const configured = accountRegistry ? accountRegistry.configured : config.wechat.configured;
      if (!configured) {
        return reply.send({
          ok: false,
          platformId: "wechat",
          fetched: 0,
          added: 0,
          skipped: 0,
          error: "server 未配置公众号凭据(.env 的 WECHAT_APPID/WECHAT_SECRET);无法同步评论。",
          at: new Date().toISOString(),
        });
      }
      const cursor = typeof request.body?.cursor === "string" ? request.body.cursor : undefined;
      const limit = typeof request.body?.limit === "number" ? request.body.limit : 50;
      // ACCOUNT-03:按账号引用路由到对应公众号的拉取器。
      const accountId = typeof request.body?.accountId === "string" ? request.body.accountId : undefined;
      const profileId =
        typeof request.body?.serverProfileId === "string" ? request.body.serverProfileId : undefined;
      const creds = accountRegistry?.credentialsFor(profileId ?? accountId);
      const fetcher =
        accountRegistry && creds
          ? new WechatInboxFetcher({ appId: creds.appId, secret: creds.secret })
          : defaultFetcher;
      try {
        const result = await fetcher.fetchComments(cursor, limit);
        return reply.send({ ...result, platformId: "wechat", at: new Date().toISOString() });
      } catch (err) {
        return reply.send({
          ok: false,
          platformId: "wechat",
          fetched: 0,
          added: 0,
          skipped: 0,
          error: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        });
      }
    },
  );

  // 解析公众号回复器(按账号路由;未配置时返回明确提示)。
  const replyWith = async (
    _platformId: string,
    profileId: string | undefined,
    accountId: string | undefined,
    action: (replier: WechatCommentReplier) => Promise<WechatCommentReplyResult>,
  ): Promise<WechatCommentReplyResult> => {
    const configured = accountRegistry ? accountRegistry.configured : config.wechat.configured;
    if (!configured) {
      return {
        ok: false,
        userCommentId: 0,
        error: "server 未配置公众号凭据(.env 的 WECHAT_APPID/WECHAT_SECRET);无法回发评论。",
      };
    }
    const creds = accountRegistry?.credentialsFor(profileId ?? accountId);
    const replier =
      accountRegistry && creds
        ? new WechatCommentReplier({ appId: creds.appId, secret: creds.secret })
        : new WechatCommentReplier({ appId: config.wechat.appId, secret: config.wechat.secret });
    try {
      return await action(replier);
    } catch (err) {
      return {
        ok: false,
        userCommentId: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // POST /inbox/reply —— 单条公众号评论真实回发(comment/reply)。
  app.post<{ Body: { platformId?: unknown; remoteId?: unknown; text?: unknown; serverProfileId?: unknown; accountId?: unknown; msgDataId?: unknown } }>(
    "/inbox/reply",
    { schema: { body: replySchema } },
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (platformId !== "wechat") {
        return reply.code(400).send({
          ok: false,
          platformId: String(platformId ?? ""),
          error: "server 仅支持公众号(wechat)评论回发;其它平台请用 runner 网页自动化。",
          at: new Date().toISOString(),
        });
      }
      const remoteId = typeof request.body?.remoteId === "string" ? request.body.remoteId : "";
      const text = typeof request.body?.text === "string" ? request.body.text : "";
      if (!remoteId || !text.trim()) {
        return reply.code(400).send({ ok: false, platformId, error: "缺少 remoteId 或 text" });
      }
      const profileId = typeof request.body?.serverProfileId === "string" ? request.body.serverProfileId : undefined;
      const accountId = typeof request.body?.accountId === "string" ? request.body.accountId : undefined;
      const msgDataId = typeof request.body?.msgDataId === "string" && request.body.msgDataId ? request.body.msgDataId : undefined;
      const outcome = await replyWith("wechat", profileId, accountId, (replier) =>
        replier.reply({ remoteId, text, ...(msgDataId ? { msgDataId } : {}) }),
      );
      return reply.send({
        ok: outcome.ok,
        platformId,
        ...(outcome.userCommentId !== undefined ? { userCommentId: outcome.userCommentId } : {}),
        ...(outcome.remoteReplyId ? { remoteReplyId: outcome.remoteReplyId } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
        at: new Date().toISOString(),
      });
    },
  );

  // POST /inbox/auto-reply —— 对公众号收件箱待回复消息批量自动回复(真实回发)。
  app.post<{ Body: { platformId?: unknown; messages?: unknown; limit?: unknown; serverProfileId?: unknown; policy?: unknown } }>(
    "/inbox/auto-reply",
    { schema: { body: autoReplySchema } },
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (platformId !== "wechat") {
        return reply.code(400).send({ ok: false, platformId: String(platformId ?? ""), error: "server 仅支持公众号自动回复" });
      }
      const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
      if (messages.length === 0) {
        return reply.send({ ok: true, platformId, planned: 0, sent: 0, failed: [], at: new Date().toISOString() });
      }
      const limit = typeof request.body?.limit === "number" ? request.body.limit : 20;
      const profileId = typeof request.body?.serverProfileId === "string" ? request.body.serverProfileId : undefined;
      // INBOX-06:接收定时任务携带的回复策略(预设/模板/去重/时效窗口)。
      const policy =
        typeof request.body?.policy === "object" && request.body.policy !== null && !Array.isArray(request.body.policy)
          ? (request.body.policy as Record<string, unknown>)
          : undefined;
      const { sendAutoReplies } = await import("@mpp/core");
      const adapter = {
        platformId: "wechat",
        reply: async (req: { message: { remoteId: string }; text: string }) => {
          const out = await replyWith("wechat", profileId, undefined, (replier) =>
            replier.reply({ remoteId: req.message.remoteId, text: req.text }),
          );
          return { ok: out.ok, error: out.error, remoteReplyId: out.remoteReplyId };
        },
      };
      const ordered = [...(messages as Array<{ receivedAt?: string }>)].sort((a, b) =>
        (a.receivedAt ?? "") < (b.receivedAt ?? "") ? 1 : -1,
      ).slice(0, limit);
      const summary = await sendAutoReplies(ordered as never[], adapter, {
        limit,
        ...(policy ? (policy as never) : {}),
      });
      return reply.send({ ...summary, platformId, at: new Date().toISOString() });
    },
  );
}
