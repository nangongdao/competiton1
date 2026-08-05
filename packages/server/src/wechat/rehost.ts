/**
 * 公众号发布编排 —— 真实调用官方草稿 API。
 *
 * 流程:get token → (重托管正文图 + 上传封面) → draft/add。
 * 安全:本模块在 server 运行,持密钥;扩展/web 只传 payload。
 * 现实障碍:调用 IP 必须在公众号白名单,本机动态 IP 常调不通 → 失败时返回清晰错误。
 */
import { WechatApi, buildIdempotencyKey, contentHashOfPayload, mapWithConcurrency } from "@mpp/core";
import { TokenCache } from "./token-cache.js";
import { postJson } from "./http-client.js";
import { WechatImageHost } from "../imagehost/wechat-host.js";

/** 幂等缓存条目 TTL:超时后允许同一内容重新提交(公众号草稿长期有效,24h 足够防抖)。 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** 幂等缓存最大条目数,防止长时间运行内存无限增长。 */
const IDEMPOTENCY_MAX_ENTRIES = 500;

export interface WechatPublishPayload {
  /** core SerializedPayload 的相关字段。 */
  readonly title: string;
  readonly content: string;
  readonly summary?: string;
  readonly author?: string;
  readonly contentSourceUrl?: string;
  /** 封面图 URL(将上传为永久素材换 thumb_media_id)。 */
  readonly coverImageUrl?: string;
  /** 正文图片 URL 列表(将逐个 uploadimg 重托管,替换 content 内同源 <img src>)。 */
  readonly bodyImageUrls?: readonly string[];
  /** 是否在 draft/add 后立即 freepublish 发布。 */
  readonly publish?: boolean;
}

export interface PublishOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly remoteId?: string;
}

export class WechatPublisher {
  private readonly tokens: TokenCache;
  /** 幂等缓存:key → { 首次结果, 记录时间 }。相同内容重试直接返回首次结果,不再二次提交平台。 */
  private readonly receipts = new Map<string, { at: number; outcome: PublishOutcome }>();

  constructor(appId: string, secret: string) {
    this.tokens = new TokenCache(appId, secret, postJson);
  }

  async publish(payload: WechatPublishPayload): Promise<PublishOutcome> {
    // 幂等:相同内容 + 相同意图(draft/publish)→ 相同 key。
    // 若客户端因网络抖动重试,这里命中缓存直接返回首次结果,避免重复草稿/重复发布。
    const key = this.buildKey(payload);
    this.pruneIdempotency();
    const cached = this.receipts.get(key);
    if (cached) return cached.outcome;

    const outcome = await this.publishOnce(payload);
    // 失败也缓存:避免对确定失败(如封面缺失)的重复请求反复打微信 API。
    this.receipts.set(key, { at: Date.now(), outcome });
    return outcome;
  }

  /** 幂等缓存清理:过期条目剔除;超上限时丢弃最早记录(简单 FIFO)。 */
  private pruneIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.receipts) {
      if (now - entry.at > IDEMPOTENCY_TTL_MS) this.receipts.delete(key);
    }
    if (this.receipts.size > IDEMPOTENCY_MAX_ENTRIES) {
      const first = this.receipts.keys().next().value;
      if (first !== undefined) this.receipts.delete(first);
    }
  }

  /** 由 payload 派生幂等键(相同内容 + 意图 → 相同 key)。 */
  private buildKey(payload: WechatPublishPayload): string {
    return buildIdempotencyKey(
      "wechat",
      contentHashOfPayload(
        {
          content: payload.content,
          mime: "text/html",
          title: payload.title,
          summary: payload.summary,
          tags: [],
          imageAssetIds: [],
        },
        payload.publish === true,
      ),
      payload.publish === true ? "publish" : "draft",
    );
  }

  /** 实际提交平台(单次副作用)。幂等缓存命中时不进入此方法。 */
  private async publishOnce(payload: WechatPublishPayload): Promise<PublishOutcome> {
    let token: string;
    try {
      token = await this.tokens.get();
    } catch (err) {
      return { ok: false, message: tokenError(err) };
    }

    // 正文图重托管:微信过滤外链图,需逐个 uploadimg 换 mp CDN URL,替换 content 内同源 <img src>。
    // 并发 3(公众号素材接口限流最严)+ 同源去重(同一 URL 只上传一次),图多长文大幅提速。
    let content = payload.content;
    if (payload.bodyImageUrls && payload.bodyImageUrls.length > 0) {
      const imgHost = new WechatImageHost(() => Promise.resolve(token), "image");
      const uniqueUrls = [...new Set(payload.bodyImageUrls)];
      const replacements = await mapWithConcurrency(uniqueUrls, 3, async (origUrl) => {
        try {
          const fetched = await fetch(origUrl);
          if (!fetched.ok) return null;
          const mime = fetched.headers.get("content-type") ?? "image/png";
          const bytes = new Uint8Array(await fetched.arrayBuffer());
          const uploaded = await imgHost.upload(bytes, "body.png", mime);
          return uploaded.url ? { from: origUrl, to: uploaded.url } : null;
        } catch {
          // 单图失败不阻断整篇发布,保留原始 URL(微信会过滤,但不致命)。
          return null;
        }
      });
      for (const rep of replacements) {
        if (rep) content = content.split(rep.from).join(rep.to);
      }
    }

    // 封面:真实场景需上传永久素材换 thumb_media_id。这里若提供封面 URL 则尝试,
    // 否则用占位提示(draft/add 要求 thumb_media_id,故无封面无法真正建草稿)。
    let thumbMediaId = "";
    if (payload.coverImageUrl) {
      const uploaded = await this.uploadCover(token, payload.coverImageUrl);
      if (!uploaded.ok) return uploaded;
      thumbMediaId = uploaded.remoteId ?? "";
    } else {
      return {
        ok: false,
        message: "公众号草稿要求封面(thumb_media_id);请提供封面图后重试。",
      };
    }

    // 构造并提交草稿(用重托管后的 content)。
    const article = WechatApi.buildDraftArticle(
      {
        content,
        mime: "text/html",
        title: payload.title,
        summary: payload.summary,
        tags: [],
        imageAssetIds: [],
        extra: { author: payload.author, contentSourceUrl: payload.contentSourceUrl },
      },
      thumbMediaId,
    );
    const draftReq = WechatApi.buildDraftAddRequest(token, [article]);
    const draftRes = (await postJson(draftReq.url, draftReq.body)) as {
      media_id?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!draftRes.media_id) {
      return { ok: false, message: apiError("draft/add", draftRes) };
    }

    if (!payload.publish) {
      return { ok: true, message: "已创建草稿,请在公众号后台确认发布", remoteId: draftRes.media_id };
    }

    // 发布草稿(异步,errcode 0 仅表示已受理)。
    const pubReq = WechatApi.buildFreepublishRequest(token, draftRes.media_id);
    const pubRes = (await postJson(pubReq.url, pubReq.body)) as {
      publish_id?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (pubRes.errcode && pubRes.errcode !== 0) {
      return { ok: false, message: apiError("freepublish/submit", pubRes) };
    }
    return {
      ok: true,
      message: "已提交发布(异步;注意:freepublish 文章不进历史消息也不群发)",
      remoteId: pubRes.publish_id ?? draftRes.media_id,
    };
  }

  /** 上传封面为永久素材,返回 media_id。 */
  private async uploadCover(token: string, imageUrl: string): Promise<PublishOutcome> {
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return { ok: false, message: `下载封面失败: ${imgRes.status}` };
      const blob = await imgRes.blob();
      const form = new FormData();
      form.append("media", blob, "cover.png");
      const res = await fetch(WechatApi.addMaterialUrl(token), { method: "POST", body: form });
      const data = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
      if (!data.media_id) return { ok: false, message: apiError("add_material", data) };
      return { ok: true, message: "封面上传成功", remoteId: data.media_id };
    } catch (err) {
      return { ok: false, message: `封面上传异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

function tokenError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /errcode=(\d+)/.exec(msg);
  if (m) {
    const hint = WechatApi.explainWechatError(Number(m[1]));
    return `获取凭据失败:${hint}(原始:${msg})`;
  }
  return `获取凭据失败:${msg}`;
}

function apiError(api: string, res: { errcode?: number; errmsg?: string }): string {
  const code = res.errcode ?? -1;
  const hint = WechatApi.explainWechatError(code);
  return `${api} 失败:${hint}(errcode=${code} ${res.errmsg ?? ""})`;
}
