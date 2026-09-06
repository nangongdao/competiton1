/**
 * INBOX-04 runner 评论同步/自动回复路由 —— POST /inbox/sync、/inbox/reply、/inbox/auto-reply。
 *
 * 与 server 的 /inbox/sync 分工:
 * - 公众号(wechat)→ server(官方 API,server 持凭据);
 * - 会话平台(zhihu/bilibili/xiaohongshu/juejin/cnblogs)→ runner(浏览器登录态网页自动化);
 * - csdn:凭据 Cookie 走官方接口(暂以 runner 页面自动化兜底)。
 *
 * 鉴权:副作用路由强制 X-MPP-Token(registerRunnerAuth 全局前置钩子已覆盖)。
 */
import type { FastifyInstance } from "fastify";
import type { InboxStore } from "@mpp/core";
import type { CommentSessionOpener } from "./automation.js";
import { fetchCommentsFromPage, makeRunnerCommentReplyAdapter } from "./automation.js";
import { isCommentAutomationPlatform } from "./selectors.js";

/** 需要转发到 runner 的会话平台(与 bridge 的 RUNNER_PLATFORM_IDS 对齐)。 */
const RUNNER_PLATFORM_IDS = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"] as const;

function isRunnerPlatform(platformId: string): boolean {
  return (RUNNER_PLATFORM_IDS as readonly string[]).includes(platformId);
}

export interface RegisterRunnerInboxRoutesOptions {
  /** 浏览器会话打开器(复用 runner 的 BrowserSessionManager)。 */
  readonly opener: CommentSessionOpener;
  /** 收件箱存储(去重/落盘)。缺省用内存实现(演示/测试)。 */
  readonly store?: InboxStore;
}

function emptyResult(platformId: string, message: string) {
  return {
    ok: false,
    platformId,
    fetched: 0,
    added: 0,
    skipped: 0,
    at: new Date().toISOString(),
    error: message,
  };
}

/** 注册 runner 收件箱路由。 */
export function registerRunnerInboxRoutes(app: FastifyInstance, options: RegisterRunnerInboxRoutesOptions): void {
  const { opener } = options;

  // POST /inbox/sync —— 网页自动化同步评论(仅会话平台;wechat 走 server)。
  app.post<{ Body: { platformId?: unknown; cursor?: unknown; accountId?: unknown; limit?: unknown } }>(
    "/inbox/sync",
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (typeof platformId !== "string" || !isRunnerPlatform(platformId)) {
        return reply.code(400).send({
          ok: false,
          platformId: String(platformId ?? ""),
          fetched: 0,
          added: 0,
          skipped: 0,
          error: `runner 仅支持会话平台评论同步: ${RUNNER_PLATFORM_IDS.join(", ")};公众号请走 server。`,
          at: new Date().toISOString(),
        });
      }
      const profileDir = typeof request.body?.accountId === "string" && request.body.accountId ? request.body.accountId : undefined;
      const limit = typeof request.body?.limit === "number" ? request.body.limit : 50;
      try {
        // 无存储时直接返回归一化结果(app 侧负责合并);有存储时做增量去重入库。
        const store = options.store;
        let seenIds: ReadonlySet<string> | undefined;
        if (store) {
          const existing = await store.listByPlatform(platformId);
          seenIds = new Set(existing.map((m) => m.remoteId));
        }
        const result = await fetchCommentsFromPage(opener, {
          platformId,
          profileDir,
          limit,
          ...(seenIds ? { seenIds } : {}),
        });
        return reply.send({ ...result, platformId, at: new Date().toISOString() });
      } catch (err) {
        return reply.send(emptyResult(platformId, err instanceof Error ? err.message : String(err)));
      }
    },
  );

  // POST /inbox/reply —— 单条评论真实回发(接收 message + text)。
  app.post<{ Body: { platformId?: unknown; message?: unknown; text?: unknown; profileDir?: unknown } }>(
    "/inbox/reply",
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (typeof platformId !== "string" || !isCommentAutomationPlatform(platformId)) {
        return reply.code(400).send({
          ok: false,
          platformId: String(platformId ?? ""),
          error: `runner 仅支持会话平台评论回发: ${RUNNER_PLATFORM_IDS.filter(isCommentAutomationPlatform).join(", ")};公众号请走 server。`,
        });
      }
      const text = request.body?.text;
      if (typeof text !== "string" || text.trim().length === 0) {
        return reply.code(400).send({ ok: false, platformId, error: "text 必须是非空字符串" });
      }
      const message = request.body?.message;
      const profileDir = typeof request.body?.profileDir === "string" ? request.body.profileDir : undefined;
      const adapter = makeRunnerCommentReplyAdapter(opener, platformId);
      try {
        const outcome = await adapter.reply({
          platformId,
          message: message as never,
          text,
          ...(profileDir ? { profileDir } : {}),
        });
        return reply.send({
          ok: outcome.ok,
          platformId,
          messageId: message && typeof message === "object" && "id" in message ? String((message as { id: unknown }).id) : undefined,
          ...(outcome.remoteReplyId ? { remoteReplyId: outcome.remoteReplyId } : {}),
          ...(outcome.error ? { error: outcome.error } : {}),
          at: new Date().toISOString(),
        });
      } catch (err) {
        return reply.send({ ok: false, platformId, error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // POST /inbox/auto-reply —— 对收件箱待回复消息批量自动回复(真实回发)。
  // 请求体 { platformId, messages: InboxMessage[], limit?, policy? }。
  app.post<{ Body: { platformId?: unknown; messages?: unknown; limit?: unknown; policy?: unknown } }>(
    "/inbox/auto-reply",
    async (request, reply) => {
      const platformId = request.body?.platformId;
      if (typeof platformId !== "string" || !isCommentAutomationPlatform(platformId)) {
        return reply.code(400).send({ ok: false, platformId: String(platformId ?? ""), error: "不支持的评论回发平台" });
      }
      const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
      if (messages.length === 0) {
        return reply.send({ ok: true, platformId, planned: 0, sent: 0, failed: [], at: new Date().toISOString() });
      }
      const limit = typeof request.body?.limit === "number" ? request.body.limit : 20;
      const { sendAutoReplies } = await import("@mpp/core");
      const adapter = makeRunnerCommentReplyAdapter(opener, platformId);
      // INBOX-06:接收定时任务携带的回复策略(预设/模板/去重/时效窗口)。
      const policy = isRecord(request.body?.policy) ? (request.body.policy as never) : undefined;
      // 按接收时间倒序(优先回复最新),单批不超过 limit。
      const ordered = [...(messages as Array<{ receivedAt?: string }>)].sort((a, b) =>
        (a.receivedAt ?? "") < (b.receivedAt ?? "") ? 1 : -1,
      ).slice(0, limit);
      const summary = await sendAutoReplies(
        ordered as never[],
        adapter,
        { limit, ...(policy ? (policy as Record<string, unknown>) : {}) } as never,
      );
      return reply.send({ ...summary, platformId, at: new Date().toISOString() });
    },
  );

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
