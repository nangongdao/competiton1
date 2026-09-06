/**
 * 微信公众号官方 API provider —— 一键连接(stable_token)+ 账号解析 + 真实发布。
 *
 * 复用 core 已有 `WechatApi` 请求构造(wechat-official-api.ts),补上:
 * - `checkConnection`: 用 appid+secret 换取 stable_token,再查 user/get 得到昵称/头像;
 * - 端点清单: stable_token / draft/add / freepublish/submit / media/uploadimg / material/add_material / datacube;
 * - 真实发布直接调用既有 draft/add → freepublish 流程(由 server 持有密钥执行)。
 *
 * 安全:本 provider 只构造请求与解析响应,密钥不落盘、不进入日志/诊断工件。
 */
import * as WechatApi from "../publish/wechat-official-api.js";
import { strField } from "./http.js";
import type {
  ApiCallResult,
  ConnectionCheckRequest,
  ConnectionCheckResult,
  PlatformApiDescriptor,
  PlatformApiProvider,
  PlatformHttpClient,
  PlatformPublishRequest,
} from "./types.js";

/** 公众号凭据字段。 */
export const WECHAT_CREDENTIAL_FIELDS = [
  { key: "appid", kind: "text", label: "AppID", placeholder: "wx1234...", required: true, hint: "公众号后台 → 设置与开发 → 基本配置" },
  { key: "secret", kind: "secret", label: "AppSecret", placeholder: "32 位密钥", required: true, hint: "调用方 IP 需加入公众号 IP 白名单" },
] as const;

export const wechatPlatformApiDescriptor: PlatformApiDescriptor = {
  platformId: "wechat",
  name: "微信公众号",
  docsUrl: "https://developers.weixin.qq.com/doc/offiaccount/",
  credentials: WECHAT_CREDENTIAL_FIELDS,
  capabilities: ["check", "publish", "metrics"],
  endpoints: [
    {
      name: "stable_token",
      label: "获取 access_token（一键连接）",
      method: "POST",
      urlTemplate: "https://api.weixin.qq.com/cgi-bin/stable_token",
      description: "用 appid+secret 换取稳定 access_token，校验凭据并得到账号信息",
      needsAuth: false,
      bodyExample: { grant_type: "client_credential", appid: "APPID", secret: "SECRET" },
    },
    {
      name: "draft_add",
      label: "创建草稿（draft/add）",
      method: "POST",
      urlTemplate: "https://api.weixin.qq.com/cgi-bin/draft/add?access_token={access_token}",
      description: "提交图文草稿，返回 media_id",
      needsAuth: true,
      bodyExample: { articles: [{ title: "标题", content: "<p>正文</p>", thumb_media_id: "mediaId" }] },
    },
    {
      name: "freepublish_submit",
      label: "发布草稿（freepublish/submit）",
      method: "POST",
      urlTemplate: "https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token={access_token}",
      description: "把草稿提交为正式发布（异步）",
      needsAuth: true,
      bodyExample: { media_id: "draftMediaId" },
    },
    {
      name: "uploadimg",
      label: "正文图片上传（media/uploadimg）",
      method: "POST",
      urlTemplate: "https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token={access_token}",
      description: "multipart 上传正文图片，返回 CDN URL",
      needsAuth: true,
    },
    {
      name: "add_material",
      label: "永久素材（封面）",
      method: "POST",
      urlTemplate: "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token={access_token}&type=image",
      description: "上传封面为永久素材，返回 media_id 作 thumb_media_id",
      needsAuth: true,
    },
    {
      name: "datacube",
      label: "数据统计（datacube）",
      method: "POST",
      urlTemplate: "https://api.weixin.qq.com/datacube/getarticlesummary?access_token={access_token}",
      description: "拉取文章阅读/点赞等指标（效果回收）",
      needsAuth: true,
    },
  ],
};

/** 解析 stable_token / user/get 响应中的账号信息。 */
export function parseWechatAccountInfo(raw: unknown): { id?: string; name?: string; avatar?: string; url?: string } {
  const obj = raw as Record<string, unknown>;
  const data = (obj["data"] ?? obj) as Record<string, unknown>;
  const openid = Array.isArray(data["openid"]) ? (data["openid"] as unknown[])[0] : undefined;
  return {
    id: strField(obj, "openid", "user_name", "fakeid") ?? (typeof openid === "string" ? openid : undefined),
    name: strField(obj, "nickname", "nick_name", "name") ?? strField(data, "nickname", "nick_name", "name"),
    avatar: strField(obj, "headimgurl", "head_img", "avatar", "logo_url") ?? strField(data, "headimgurl", "avatar", "logo_url"),
    url: strField(obj, "url") ?? strField(data, "url"),
  };
}

/** 把微信 errcode 转为一键连接的错误类别。 */
export function classifyWechatError(errcode: unknown): ConnectionCheckResult["errorKind"] {
  const code = Number(errcode);
  if (code === 40013 || code === 40125 || code === 40001 || code === 40002) return "invalid-credentials";
  if (code === 40164) return "unauthorized";
  if (code === 45009) return "rate-limited";
  return "api-error";
}

/**
 * 公众号 provider。真实发布复用既有官方草稿 API 流程(与 server 的 WechatPublisher 同构,
 * 这里仅补"一键连接 + 解析"契约;server 仍负责真实网络执行)。
 */
export class WechatPlatformApiProvider implements PlatformApiProvider {
  readonly descriptor: PlatformApiDescriptor = wechatPlatformApiDescriptor;

  async checkConnection(req: ConnectionCheckRequest, http: PlatformHttpClient, now?: () => string): Promise<ConnectionCheckResult> {
    const started = Date.now();
    const at = (now ?? (() => new Date().toISOString()))();
    const appid = req.credentials["appid"]?.trim() ?? "";
    const secret = req.credentials["secret"]?.trim() ?? "";
    if (!appid || !secret) {
      return {
        ok: false,
        platformId: "wechat",
        message: "缺少 AppID 或 AppSecret",
        errorKind: "invalid-credentials",
        latencyMs: Date.now() - started,
        at,
      };
    }
    const tokenReq = WechatApi.buildStableTokenRequest(appid, secret);
    try {
      const res = await http.request({
        method: "POST",
        url: tokenReq.url,
        headers: { "Content-Type": "application/json" },
        body: tokenReq.body,
      });
      const parsed = JSON.parse(res.text) as { access_token?: string; errcode?: number; errmsg?: string };
      if (!parsed.access_token) {
        const kind = classifyWechatError(parsed.errcode);
        return {
          ok: false,
          platformId: "wechat",
          message: `连接失败: ${parsed.errmsg ?? `errcode=${parsed.errcode}`}`,
          errorKind: kind,
          latencyMs: Date.now() - started,
          at,
        };
      }

      // 用 token 查账号信息(user/get 需 token)。
      const accountRes = await http.request({
        method: "GET",
        url: `https://api.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(parsed.access_token)}`,
      });
      const accountRaw = (() => {
        try {
          return JSON.parse(accountRes.text);
        } catch {
          return undefined;
        }
      })();
      const account = parseWechatAccountInfo(accountRaw ?? parsed);
      const total = (accountRaw as { total?: number } | undefined)?.total;
      return {
        ok: true,
        platformId: "wechat",
        message: "连接成功:已获取 access_token" + (total !== undefined ? `,粉丝数 ${total}` : ""),
        account: account.name || account.id ? account : undefined,
        parsed: total !== undefined ? { followerCount: total } : undefined,
        latencyMs: Date.now() - started,
        at,
      };
    } catch (err) {
      return {
        ok: false,
        platformId: "wechat",
        message: `网络错误: ${err instanceof Error ? err.message : String(err)}`,
        errorKind: "network",
        latencyMs: Date.now() - started,
        at,
      };
    }
  }

  async publish(req: PlatformPublishRequest, http: PlatformHttpClient, now?: () => string): Promise<ApiCallResult> {
    const at = (now ?? (() => new Date().toISOString()))();
    const appid = req.credentials["appid"]?.trim() ?? "";
    const secret = req.credentials["secret"]?.trim() ?? "";
    if (!appid || !secret) {
      return { ok: false, platformId: "wechat", action: "publish", message: "缺少 AppID/AppSecret", at };
    }
    try {
      const tokenRes = await http.request({
        method: "POST",
        url: WechatApi.buildStableTokenRequest(appid, secret).url,
        headers: { "Content-Type": "application/json" },
        body: WechatApi.buildStableTokenRequest(appid, secret).body,
      });
      const tokenParsed = JSON.parse(tokenRes.text) as { access_token?: string; errcode?: number; errmsg?: string };
      if (!tokenParsed.access_token) {
        return {
          ok: false,
          platformId: "wechat",
          action: "publish",
          message: `获取 access_token 失败: ${tokenParsed.errmsg ?? tokenParsed.errcode}`,
          at,
        };
      }
      const token = tokenParsed.access_token;

      // 封面:无封面时无法建草稿(公众号要求 thumb_media_id)。
      const extra = (req.payload.extra ?? {}) as { coverImageUrl?: string; bodyImageUrls?: readonly string[]; author?: string; contentSourceUrl?: string };
      let thumbMediaId = "";
      if (extra.coverImageUrl) {
        const coverRes = await http.request({
          method: "POST",
          url: WechatApi.addMaterialUrl(token),
          headers: { "Content-Type": "application/json" },
          body: { media: extra.coverImageUrl },
        });
        const coverParsed = JSON.parse(coverRes.text) as { media_id?: string; errcode?: number; errmsg?: string };
        if (!coverParsed.media_id) {
          return {
            ok: false,
            platformId: "wechat",
            action: "publish",
            message: `封面上传失败: ${coverParsed.errmsg ?? coverParsed.errcode}`,
            at,
          };
        }
        thumbMediaId = coverParsed.media_id;
      }

      const article = WechatApi.buildDraftArticle(
        {
          content: req.payload.content,
          mime: "text/html",
          title: req.payload.title,
          summary: req.payload.summary,
          tags: [],
          imageAssetIds: [],
          extra: { author: extra.author, contentSourceUrl: extra.contentSourceUrl },
        },
        thumbMediaId,
      );
      const draftReq = WechatApi.buildDraftAddRequest(token, [article]);
      const draftRes = await http.request({
        method: "POST",
        url: draftReq.url,
        headers: { "Content-Type": "application/json" },
        body: draftReq.body,
      });
      const draftParsed = JSON.parse(draftRes.text) as { media_id?: string; errcode?: number; errmsg?: string };
      if (!draftParsed.media_id) {
        return {
          ok: false,
          platformId: "wechat",
          action: "publish",
          message: `创建草稿失败: ${draftParsed.errmsg ?? draftParsed.errcode}`,
          at,
        };
      }
      if (req.mode === "draft") {
        return {
          ok: true,
          platformId: "wechat",
          action: "publish",
          remoteId: draftParsed.media_id,
          message: "已创建公众号草稿",
          at,
        };
      }
      const pubReq = WechatApi.buildFreepublishRequest(token, draftParsed.media_id);
      const pubRes = await http.request({
        method: "POST",
        url: pubReq.url,
        headers: { "Content-Type": "application/json" },
        body: pubReq.body,
      });
      const pubParsed = JSON.parse(pubRes.text) as { publish_id?: string; errcode?: number; errmsg?: string };
      if (pubParsed.errcode && pubParsed.errcode !== 0) {
        return {
          ok: false,
          platformId: "wechat",
          action: "publish",
          message: `发布失败: ${pubParsed.errmsg ?? pubParsed.errcode}`,
          at,
        };
      }
      return {
        ok: true,
        platformId: "wechat",
        action: "publish",
        remoteId: pubParsed.publish_id ?? draftParsed.media_id,
        message: "已提交发布（异步）",
        at,
      };
    } catch (err) {
      return {
        ok: false,
        platformId: "wechat",
        action: "publish",
        message: `发布异常: ${err instanceof Error ? err.message : String(err)}`,
        at,
      };
    }
  }
}
