/**
 * INBOX-04 公众号评论回发 —— server 侧真实实现(官方 comment/reply API)。
 *
 * 与 `WechatInboxFetcher`(同步评论)互补,构成「同步 → AI 自动回复 → 真实回发」闭环:
 * - server 是唯一持有公众号凭据的进程,接收 app 转发的回复请求;
 * - 用 stable_token 调 `comment/reply`,把回复真实回发到公众号评论区;
 * - 幂等:同一条 user_comment_id 重复回发时,公众号侧会拒绝(不重复发);
 * - 负面/紧急评论由 app 侧策略层拦截,server 只负责「把给定的文案回发到指定评论」。
 */
import { TokenCache } from "./token-cache.js";
import { postJson } from "./http-client.js";
import { WechatApi } from "@mpp/core";

export interface WechatCommentReplyOptions {
  readonly appId: string;
  readonly secret: string;
  /** 注入 HTTP(测试可替换)。 */
  readonly fetchJson?: (url: string, body: unknown) => Promise<unknown>;
}

export interface WechatCommentReplyResult {
  readonly ok: boolean;
  /** 回发到的 user_comment_id。 */
  readonly userCommentId: number;
  readonly remoteReplyId?: string;
  readonly error?: string;
}

/** 从游标/remoteId 解析 msg_data_id 与 user_comment_id(与同步侧格式对齐)。 */
export function parseCommentReplyTarget(remoteId: string): { msgDataId?: string; userCommentId?: number; index?: number } {
  // 期望格式:wechat-comment-<user_comment_id>。可选前缀 <msg_data_id>:wechat-comment-<id>。
  const m = /^(?:([^:]+):)?wechat-comment-([0-9]+)$/.exec(remoteId.trim());
  if (!m) return {};
  return {
    msgDataId: m[1],
    userCommentId: Number(m[2]),
  };
}

/** 公众号评论回发器(server 侧真实实现)。 */
export class WechatCommentReplier {
  private readonly tokens: TokenCache;
  private readonly fetchJson: (url: string, body: unknown) => Promise<unknown>;

  constructor(options: WechatCommentReplyOptions) {
    this.tokens = new TokenCache(options.appId, options.secret, options.fetchJson ?? postJson);
    this.fetchJson = options.fetchJson ?? postJson;
  }

  /** 真实回发一条回复到公众号评论(comment/reply)。 */
  async reply(input: {
    /** 本地收件箱消息的 remoteId(wechat-comment-<id> 或 <msg_data_id>:wechat-comment-<id>)。 */
    remoteId: string;
    text: string;
    /** 评论所属文章的 msg_data_id(可选;缺省时走 freepublish/batchget 反查第一篇文章)。 */
    msgDataId?: string;
  }): Promise<WechatCommentReplyResult> {
    const parsed = parseCommentReplyTarget(input.remoteId);
    const userCommentId = parsed.userCommentId ?? Number(input.remoteId.replace(/^wechat-comment-/, ""));
    if (!Number.isInteger(userCommentId) || userCommentId <= 0) {
      return { ok: false, userCommentId: 0, error: `无法从 remoteId 解析 user_comment_id: ${input.remoteId}` };
    }
    const text = input.text.trim();
    if (!text) {
      return { ok: false, userCommentId, error: "回复内容不能为空" };
    }

    let token: string;
    try {
      token = await this.tokens.get();
    } catch (err) {
      return { ok: false, userCommentId, error: err instanceof Error ? err.message : String(err) };
    }

    // msg_data_id:优先显式传入;否则从最近发布文章反查(与同步侧同链路)。
    let msgDataId = input.msgDataId ?? parsed.msgDataId;
    if (!msgDataId) {
      try {
        msgDataId = await this.resolveLatestMsgDataId(token);
      } catch {
        msgDataId = undefined;
      }
    }
    if (!msgDataId) {
      return { ok: false, userCommentId, error: "无法定位评论所属文章(msg_data_id),请在收件箱关联内容后重试" };
    }

    try {
      const req = WechatApi.buildCommentReplyRequest(msgDataId, userCommentId, text);
      const raw = (await this.fetchJson(
        `${req.url.replace("TOKEN", encodeURIComponent(token))}`,
        req.body,
      )) as { errcode?: number; errmsg?: string };
      if (raw.errcode && raw.errcode !== 0) {
        // 公众号侧幂等:已回复过的评论会返回错误,视为已回发(不重复发)。
        if (/回复|重复|exist/i.test(raw.errmsg ?? "")) {
          return { ok: true, userCommentId, remoteReplyId: `wechat-reply-${userCommentId}`, error: undefined };
        }
        return { ok: false, userCommentId, error: `评论回发失败: errcode=${raw.errcode} ${raw.errmsg ?? ""}` };
      }
      return { ok: true, userCommentId, remoteReplyId: `wechat-reply-${userCommentId}`, error: undefined };
    } catch (err) {
      return { ok: false, userCommentId, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 从已发布文章列表反查第一篇的 msg_data_id(评论同步同链路)。 */
  private async resolveLatestMsgDataId(token: string): Promise<string | undefined> {
    const listReq = WechatApi.buildFreepublishBatchGetRequest(0, 10);
    const raw = (await this.fetchJson(
      `${listReq.url.replace("TOKEN", encodeURIComponent(token))}`,
      listReq.body,
    )) as { item?: unknown[]; errcode?: number; errmsg?: string };
    if (raw.errcode && raw.errcode !== 0) return undefined;
    const articles = Array.isArray(raw.item) ? raw.item : [];
    for (const article of articles) {
      const detail = (article as Record<string, unknown>)["article_detail"] as Record<string, unknown> | undefined;
      const msgDataId = detail ? (detail["msg_data_id"] ?? detail["media_id"]) : undefined;
      if (msgDataId) return String(msgDataId);
    }
    return undefined;
  }
}
