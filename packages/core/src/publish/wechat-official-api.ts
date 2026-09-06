/**
 * 公众号官方 API 请求构造 —— 纯逻辑,HTTP 客户端注入。
 *
 * 安全边界:本模块只构造请求(URL/method/body),绝不持有 AppSecret,绝不在前端执行。
 * 真实网络调用由 server 注入的 HttpClient 完成(server 持密钥、在白名单 IP 上跑)。
 *
 * 发布流水线(调研确认):
 *   stable_token → 上传永久封面(thumb_media_id) → media/uploadimg(正文图) → draft/add → freepublish/submit
 */
import type { SerializedPayload } from "../adapters/types.js";

const BASE = "https://api.weixin.qq.com/cgi-bin";

/** 注入的 HTTP 客户端(server 实现真实 fetch)。 */
export interface HttpClient {
  postJson(url: string, body: unknown): Promise<unknown>;
  getJson(url: string): Promise<unknown>;
}

/** stable_token 请求构造。 */
export function buildStableTokenRequest(appId: string, appSecret: string): { url: string; body: unknown } {
  return {
    url: `${BASE}/stable_token`,
    body: { grant_type: "client_credential", appid: appId, secret: appSecret, force_refresh: false },
  };
}

/** draft/add 单篇文章结构(news 图文)。 */
export interface WechatArticle {
  readonly article_type: "news";
  readonly title: string;
  readonly author: string;
  readonly digest: string;
  readonly content: string;
  readonly content_source_url: string;
  readonly thumb_media_id: string;
  readonly need_open_comment: 0 | 1;
  readonly only_fans_can_comment: 0 | 1;
}

/** 从序列化产物构造 draft/add 的文章对象(thumb_media_id 由调用方在上传封面后填入)。 */
export function buildDraftArticle(payload: SerializedPayload, thumbMediaId: string): WechatArticle {
  const extra = payload.extra ?? {};
  return {
    article_type: "news",
    title: payload.title,
    author: String(extra["author"] ?? ""),
    digest: payload.summary ?? "",
    content: payload.content,
    content_source_url: String(extra["contentSourceUrl"] ?? ""),
    thumb_media_id: thumbMediaId,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
}

/** draft/add 请求构造。 */
export function buildDraftAddRequest(accessToken: string, articles: readonly WechatArticle[]): { url: string; body: unknown } {
  return {
    url: `${BASE}/draft/add?access_token=${encodeURIComponent(accessToken)}`,
    body: { articles },
  };
}

/** freepublish/submit 请求构造(发布草稿)。 */
export function buildFreepublishRequest(accessToken: string, draftMediaId: string): { url: string; body: unknown } {
  return {
    url: `${BASE}/freepublish/submit?access_token=${encodeURIComponent(accessToken)}`,
    body: { media_id: draftMediaId },
  };
}

/** media/uploadimg URL(正文图片上传,multipart 由 server 处理)。 */
export function uploadImgUrl(accessToken: string): string {
  return `${BASE}/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`;
}

/** 文章数据统计 URL(datacube/getarticlesummary,效果回收 DATA-03)。 */
export function articleSummaryUrl(accessToken: string): string {
  return `${BASE.replace("/cgi-bin", "/datacube")}/getarticlesummary?access_token=${encodeURIComponent(accessToken)}`;
}

/** 构造文章数据统计请求(近 N 天,最多返回 20 条)。 */
export function buildArticleSummaryRequest(
  accessToken: string,
  beginDate: string,
  endDate: string,
): { url: string; body: unknown } {
  return {
    url: articleSummaryUrl(accessToken),
    body: { begin_date: beginDate, end_date: endDate },
  };
}

/** 新增永久素材 URL(封面图,返回 media_id 作 thumb_media_id)。 */
export function addMaterialUrl(accessToken: string, type: "image" = "image"): string {
  return `${BASE}/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=${type}`;
}

/** 已发布文章列表 URL(comment/listall 前置:取已发布的文章 media_id)。 */
export function freepublishBatchGetUrl(accessToken: string): string {
  return `${BASE}/freepublish/batchget?access_token=${encodeURIComponent(accessToken)}`;
}

/** 已发布文章列表请求体(comment/listall 前置:取已发布的文章 media_id)。 */
export function buildFreepublishBatchGetRequest(offset = 0, count = 20): { url: string; body: unknown } {
  return {
    url: freepublishBatchGetUrl("TOKEN"),
    body: { offset, count, no_content: 1 },
  };
}

/** 公众号评论列表 URL(comment/listall,按文章拉取全部评论)。 */
export function commentListAllUrl(accessToken: string): string {
  return `${BASE}/comment/listall?access_token=${encodeURIComponent(accessToken)}`;
}

/** 公众号评论列表请求体(comment/listall)。 */
export function buildCommentListAllRequest(
  msgDataId: string,
  options: { index?: number; begin?: number; count?: number; type?: number } = {},
): { url: string; body: unknown } {
  return {
    url: commentListAllUrl("TOKEN"),
    body: {
      msg_data_id: msgDataId,
      index: options.index ?? 0,
      begin: options.begin ?? 0,
      count: options.count ?? 50,
      type: options.type ?? 0,
    },
  };
}

/** 公众号评论回复 URL(comment/reply,真实回复用户评论)。 */
export function commentReplyUrl(accessToken: string): string {
  return `${BASE}/comment/reply?access_token=${encodeURIComponent(accessToken)}`;
}

/** 公众号评论回复请求体(comment/reply)。 */
export function buildCommentReplyRequest(
  msgDataId: string,
  userCommentId: number,
  content: string,
  index = 0,
): { url: string; body: unknown } {
  return {
    url: commentReplyUrl("TOKEN"),
    body: { msg_data_id: msgDataId, index, user_comment_id: userCommentId, content },
  };
}

/** 公众号评论删除 URL(comment/delete,负面评论处理)。 */
export function commentDeleteUrl(accessToken: string): string {
  return `${BASE}/comment/delete?access_token=${encodeURIComponent(accessToken)}`;
}

/** 公众号评论删除请求体(comment/delete)。 */
export function buildCommentDeleteRequest(
  msgDataId: string,
  userCommentId: number,
  index = 0,
): { url: string; body: unknown } {
  return {
    url: commentDeleteUrl("TOKEN"),
    body: { msg_data_id: msgDataId, index, user_comment_id: userCommentId },
  };
}

/** 公众号评论回复后把评论置为精选/公开(comment/markelect,可选)。 */
export function commentMarkElectUrl(accessToken: string): string {
  return `${BASE}/comment/markelect?access_token=${encodeURIComponent(accessToken)}`;
}

/** 公众号评论置顶 URL(comment/top,负面处理建议动作)。 */
export function commentTopUrl(accessToken: string): string {
  return `${BASE}/comment/top?access_token=${encodeURIComponent(accessToken)}`;
}

/** 微信 API 错误码解读(常见)。 */
export function explainWechatError(errcode: number): string {
  const map: Record<number, string> = {
    40164: "调用方 IP 不在白名单(请在公众号后台添加本机出口 IP)",
    40007: "无效的 media_id(封面需用永久素材 id,而非临时)",
    40001: "access_token 无效或过期",
    45009: "接口调用频率超限",
    48001: "API 功能未授权(需认证的订阅号/服务号)",
  };
  return map[errcode] ?? `未知错误码 ${errcode}`;
}
