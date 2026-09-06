/**
 * 公众号官方评论拉取器 —— server 侧 INBOX-03 真实消息同步实现。
 *
 * 链路:
 *   app(收件箱「同步平台消息」)
 *     → POST /inbox/sync  { platformId:"wechat", cursor }   (X-MPP-Token 鉴权)
 *     → server 用 stable_token 调 comment/listall 拉取近期评论
 *     → 归一化为 RemoteInboxItem(评论 → 收件箱 comment 消息)
 *
 * 说明:
 * - 公众号评论接口 comment/listall 需要文章的 msg_data_id(与 freepublish/batchget
 *   返回的 article_detail 关联)。近 30 天发布文章可用 freepublish/batchget 列出,
 *   再逐个拉评论;游标用「评论 id 上限」做增量(comment/listall 返回的 user_comment_id 为数字)。
 * - 安全:server 是唯一持有公众号密钥的进程,只返回归一化消息,不暴露 token/密钥。
 */
import { WechatApi } from "@mpp/core";
import type { RemoteInboxItem } from "@mpp/core";
import { TokenCache } from "./token-cache.js";
import { postJson } from "./http-client.js";

export interface WechatInboxFetcherOptions {
  readonly appId: string;
  readonly secret: string;
  /** 注入 HTTP(测试可替换)。 */
  readonly fetchJson?: (url: string, body: unknown) => Promise<unknown>;
}

/** 单篇文章的评论列表(comment/listall 响应子结构)。 */
interface WechatComment {
  readonly user_comment_id?: number;
  readonly openid?: string;
  readonly nickname?: string;
  readonly content?: string;
  readonly create_time?: number;
  readonly reply?: { content?: string };
  readonly comment_type?: number;
}

/** 一次拉取的归一化结果。 */
export interface WechatInboxFetchResult {
  readonly ok: boolean;
  readonly items: readonly RemoteInboxItem[];
  /** 本次拉取到的最大 user_comment_id(作为增量游标)。 */
  readonly cursor?: string;
  readonly error?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** 把 comment/listall 的列表归一化为 RemoteInboxItem(评论 → comment 消息)。 */
export function normalizeWechatComments(raw: unknown, limit: number): RemoteInboxItem[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(obj["comment"]) ? (obj["comment"] as unknown[]) : [];
  const items: RemoteInboxItem[] = [];
  for (const entry of list.slice(0, limit)) {
    const c = (entry ?? {}) as WechatComment;
    const id = c.user_comment_id;
    if (typeof id !== "number") continue;
    const content = str(c.content);
    if (!content) continue;
    items.push({
      remoteId: `wechat-comment-${id}`,
      kind: "comment",
      author: str(c.nickname) ?? "微信用户",
      authorId: str(c.openid),
      text: content,
      receivedAt: c.create_time
        ? new Date(c.create_time * 1000).toISOString()
        : undefined,
    });
  }
  return items;
}

/** 公众号官方评论拉取器(server 侧真实实现)。 */
export class WechatInboxFetcher {
  private readonly tokens: TokenCache;
  private readonly fetchJson: (url: string, body: unknown) => Promise<unknown>;

  constructor(options: WechatInboxFetcherOptions) {
    this.tokens = new TokenCache(options.appId, options.secret, options.fetchJson ?? postJson);
    this.fetchJson = options.fetchJson ?? postJson;
  }

  /** 拉取公众号近期评论(增量,按游标只取新增)。 */
  async fetchComments(cursor: string | undefined, limit = 50): Promise<WechatInboxFetchResult> {
    let token: string;
    try {
      token = await this.tokens.get();
    } catch (err) {
      return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
    }
    const maxCursor = cursor ? Number(cursor) || 0 : 0;
    const items: RemoteInboxItem[] = [];
    let maxId = maxCursor;

    try {
      // 1) 列出近 30 天已发布文章(取前 10 篇即可覆盖近期评论)。
      const listReq = WechatApi.buildFreepublishBatchGetRequest(0, 10);
      const listRaw = (await this.fetchJson(
        `${listReq.url.replace("TOKEN", encodeURIComponent(token))}`,
        listReq.body,
      )) as { item?: unknown[]; errcode?: number; errmsg?: string };
      if (listRaw.errcode && listRaw.errcode !== 0) {
        return { ok: false, items: [], error: `获取文章列表失败: errcode=${listRaw.errcode} ${listRaw.errmsg ?? ""}` };
      }
      const articles = Array.isArray(listRaw.item) ? listRaw.item : [];
      if (articles.length === 0) {
        return { ok: true, items: [], cursor: cursor };
      }

      // 2) 对每篇文章拉评论(comment/listall),增量去重由游标完成。
      for (const article of articles) {
        const detail = (article as Record<string, unknown>)["article_detail"] as Record<string, unknown> | undefined;
        const msgDataId = detail ? (detail["msg_data_id"] ?? detail["media_id"]) : undefined;
        if (!msgDataId) continue;
        const commentReq = WechatApi.buildCommentListAllRequest(String(msgDataId), { count: Math.min(limit, 50) });
        const raw = (await this.fetchJson(
          `${commentReq.url.replace("TOKEN", encodeURIComponent(token))}`,
          commentReq.body,
        )) as { comment?: unknown[]; errcode?: number; errmsg?: string };
        if (raw.errcode && raw.errcode !== 0) continue; // 单篇失败不阻断(如无评论权限)
        const normalized = normalizeWechatComments(raw, limit);
        for (const item of normalized) {
          const idNum = Number(item.remoteId.replace("wechat-comment-", ""));
          if (idNum <= maxCursor) continue; // 游标之后的才拉
          items.push(item);
          if (idNum > maxId) maxId = idNum;
        }
        if (items.length >= limit) break;
      }

      return {
        ok: true,
        items,
        ...(maxId > maxCursor ? { cursor: String(maxId) } : {}),
      };
    } catch (err) {
      return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
