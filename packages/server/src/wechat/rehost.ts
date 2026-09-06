/**
 * 公众号发布编排 —— 真实调用官方草稿 API。
 *
 * 流程:get token → (SecureImageFetcher 重托管正文图 + 上传封面) → draft/add。
 * 安全:本模块在 server 运行,持密钥;扩展/web 只传 payload。
 * 现实障碍:调用 IP 必须在公众号白名单,本机动态 IP 常调不通 → 失败时返回清晰错误。
 *
 * 可靠性与幂等(REL-01/REL-02):
 * - Publisher 由应用生命周期持有(单例),幂等缓存跨请求生效;
 * - 相同内容的并发请求做 in-flight 合并,只产生一次平台副作用;
 * - 幂等键用 SHA-256(而非 FNV),真实发布摘要不能被客户端提供的 key 污染;
 * - 成功结果长 TTL 缓存;瞬时失败不缓存 24h(只短 TTL,避免把瞬时网络错误固定成长期失败)。
 */
import {
  WechatApi,
  buildIdempotencyKey,
  contentHashOfPayload,
  mapWithConcurrency,
  sanitizeHtml,
} from "@mpp/core";
import { TokenCache } from "./token-cache.js";
import { postJson } from "./http-client.js";
import { WechatImageHost } from "../imagehost/wechat-host.js";
import { fetchSecureImage, type SecureImageResult } from "../security/image-fetcher.js";
import type { ImageFetchConfig } from "../config.js";

/** 幂等缓存:成功结果保留时长(公众号草稿长期有效,24h 足够防抖)。 */
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
/** 瞬时失败短缓存:只防同一秒内的重复请求打爆接口,不把网络抖动固化成长期失败。 */
const TRANSIENT_FAIL_TTL_MS = 30 * 1000;
/** 幂等缓存最大条目数,防止长时间运行内存无限增长。 */
const IDEMPOTENCY_MAX_ENTRIES = 500;
/** 在途请求合并表大小上限。 */
const INFLIGHT_MAX = 100;

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

interface CacheEntry {
  readonly outcome: PublishOutcome;
  readonly at: number;
  /** true=成功(长 TTL);false=失败(短 TTL)。 */
  readonly success: boolean;
}

/** 远程图片抓取器(SSRF 权威边界)。默认用 SecureImageFetcher;测试可注入 mock。 */
export type ImageFetcher = (url: string) => Promise<SecureImageResult>;

/** 默认抓取器:经 DNS 逐跳校验的 SecureImageFetcher。 */
export function defaultImageFetcher(imageFetch: ImageFetchConfig): ImageFetcher {
  return (url) => fetchSecureImage(url, imageFetch);
}

export interface WechatPublisherOptions {
  /** 远程图片抓取安全配置(SSRF 边界)。 */
  readonly imageFetch: ImageFetchConfig;
  /** 注入图片抓取器(默认 SecureImageFetcher;测试可替换)。 */
  readonly imageFetcher?: ImageFetcher;
}

export class WechatPublisher {
  private readonly tokens: TokenCache;
  /** 幂等缓存:key → { 结果, 记录时间, 是否成功 }。 */
  private readonly receipts = new Map<string, CacheEntry>();
  /** 在途请求:相同 key 的并发请求复用同一次副作用,结束后移除。 */
  private readonly inflight = new Map<string, Promise<PublishOutcome>>();
  private readonly fetchImage: ImageFetcher;

  constructor(
    appId: string,
    secret: string,
    options?: WechatPublisherOptions,
  ) {
    this.tokens = new TokenCache(appId, secret, postJson);
    const imageFetch = options?.imageFetch ?? {
      timeoutMs: 10_000,
      maxBytes: 10 * 1024 * 1024,
      maxRedirects: 3,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    };
    this.fetchImage = options?.imageFetcher ?? defaultImageFetcher(imageFetch);
  }

  async publish(payload: WechatPublishPayload): Promise<PublishOutcome> {
    // 幂等:相同内容 + 相同意图(draft/publish)→ 相同 key(SHA-256 摘要)。
    const key = await this.buildKey(payload);
    this.pruneIdempotency();

    const cached = this.receipts.get(key);
    if (cached && this.isCacheFresh(cached)) return cached.outcome;

    // 并发合并:相同 key 的并发请求复用同一个在途 Promise。
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const run = this.publishOnce(payload).then((outcome) => {
      // 失败也缓存(短 TTL):避免同一秒内的重复请求反复打微信 API;
      // 成功长缓存:重试直接返回首次结果,不二次提交平台。
      this.receipts.set(key, {
        outcome,
        at: Date.now(),
        success: outcome.ok,
      });
      return outcome;
    });
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(key);
      if (this.inflight.size > INFLIGHT_MAX) {
        const first = this.inflight.keys().next().value;
        if (first !== undefined) this.inflight.delete(first);
      }
    }
  }

  /** 幂等缓存清理:按成功/失败不同 TTL 过期剔除;超上限时丢弃最早记录(FIFO)。 */
  private pruneIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.receipts) {
      const ttl = entry.success ? SUCCESS_TTL_MS : TRANSIENT_FAIL_TTL_MS;
      if (now - entry.at > ttl) this.receipts.delete(key);
    }
    if (this.receipts.size > IDEMPOTENCY_MAX_ENTRIES) {
      const first = this.receipts.keys().next().value;
      if (first !== undefined) this.receipts.delete(first);
    }
  }

  private isCacheFresh(entry: CacheEntry): boolean {
    const ttl = entry.success ? SUCCESS_TTL_MS : TRANSIENT_FAIL_TTL_MS;
    return Date.now() - entry.at <= ttl;
  }

  /** 由 payload 派生幂等键(SHA-256 摘要,客户端提供的 key 不被信任)。 */
  private buildKey(payload: WechatPublishPayload): Promise<string> {
    return contentHashOfPayload(
      {
        content: payload.content,
        mime: "text/html",
        title: payload.title,
        summary: payload.summary,
        tags: [],
        imageAssetIds: [],
      },
      payload.publish === true,
    ).then((hash) =>
      buildIdempotencyKey(
        "wechat",
        hash,
        payload.publish === true ? "publish" : "draft",
      ),
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
    // 抓取统一走 SecureImageFetcher(SSRF 权威边界),单图失败不阻断整篇。
    let content = payload.content;
    if (payload.bodyImageUrls && payload.bodyImageUrls.length > 0) {
      const imgHost = new WechatImageHost(() => Promise.resolve(token), "image");
      const uniqueUrls = [...new Set(payload.bodyImageUrls)];
      const replacements = await mapWithConcurrency(uniqueUrls, 3, async (origUrl) => {
        try {
          const fetched = await this.fetchImage(origUrl);
          const uploaded = await imgHost.upload(fetched.bytes, "body.png", fetched.mime);
          return uploaded.url ? { from: origUrl, to: uploaded.url } : null;
        } catch {
          // 单图失败不阻断整篇发布,保留原始 URL(微信会过滤,但不致命)。
          return null;
        }
      });
      for (const rep of replacements) {
        if (rep && rep.to !== rep.from) {
          content = content.split(rep.from).join(rep.to);
        }
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

    // 构造并提交草稿:提交微信 API 前再次净化正文 HTML(不能把客户端净化视为信任边界)。
    const article = WechatApi.buildDraftArticle(
      {
        content: sanitizeHtml(content),
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

  /** 上传封面为永久素材,返回 media_id(经 SecureImageFetcher 抓取)。 */
  private async uploadCover(token: string, imageUrl: string): Promise<PublishOutcome> {
    try {
      const fetched = await this.fetchImage(imageUrl);
      const form = new FormData();
      form.append("media", new Blob([fetched.bytes], { type: fetched.mime }), "cover.png");
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
