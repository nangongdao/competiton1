/**
 * server 侧公众号发布执行器 —— 把 `WechatPublisher` 适配为 `PlatformExecutor`。
 *
 * 让公众号真实发布任务可以被 `PublishJobService` 编排并持久化:
 * - prepare:透传平台产物(payload 由任务层持久化,重启后可恢复);
 * - upload:公众号正文图由 publisher 内部 SecureImageFetcher 重托管,不单独上传;
 * - submit:调用 WechatPublisher.publish 提交草稿/发布;
 * - verify:以 publisher 返回结果判定最终状态。
 *
 * payload 约定:发布所需真实 URL(封面/正文图)放在 SerializedPayload 的 extra 字段,
 * 由任务创建方(server 路由)在入库前写入,以便持久化恢复。
 */
import type { PlatformExecutor, SerializedPayload, JobReceipt } from "@mpp/core";
import type { WechatPublisher, WechatPublishPayload } from "../wechat/rehost.js";

/** extra 中存放的公众号发布字段(序列化后持久化)。 */
export interface WechatPublishExtra {
  readonly author?: string;
  readonly contentSourceUrl?: string;
  /** 封面图真实 URL。 */
  readonly coverImageUrl?: string;
  /** 正文图真实 URL 列表。 */
  readonly bodyImageUrls?: readonly string[];
}

/** 从持久化 payload 重建公众号发布请求(extra 里的真实 URL 随任务落盘)。 */
export function buildWechatPublishPayload(payload: SerializedPayload, publish: boolean): WechatPublishPayload {
  const extra = (payload.extra ?? {}) as WechatPublishExtra;
  return {
    title: payload.title,
    content: payload.content,
    summary: payload.summary,
    author: extra.author,
    contentSourceUrl: extra.contentSourceUrl,
    coverImageUrl: extra.coverImageUrl,
    bodyImageUrls: extra.bodyImageUrls ?? [],
    publish,
  };
}

/** 把公众号发布请求的字段写入 SerializedPayload.extra(供任务持久化)。 */
export function toSerializedPayload(req: {
  readonly title: string;
  readonly content: string;
  readonly summary?: string;
  readonly author?: string;
  readonly contentSourceUrl?: string;
  readonly coverImageUrl?: string;
  readonly bodyImageUrls?: readonly string[];
}): SerializedPayload {
  return {
    title: req.title,
    content: req.content,
    mime: "text/html",
    summary: req.summary,
    tags: [],
    imageAssetIds: req.bodyImageUrls ?? [],
    coverAssetId: req.coverImageUrl,
    extra: {
      author: req.author,
      contentSourceUrl: req.contentSourceUrl,
      coverImageUrl: req.coverImageUrl,
      bodyImageUrls: req.bodyImageUrls ?? [],
    } satisfies WechatPublishExtra,
  };
}

export interface WechatJobExecutorOptions {
  readonly publisher: WechatPublisher;
  /** 是否 publish(true=草稿+发布,false=仅草稿)。 */
  readonly publish?: boolean;
}

/** 把 WechatPublisher 包装成 PlatformExecutor 的适配器。 */
export class WechatJobExecutor implements PlatformExecutor {
  private readonly publisher: WechatPublisher;
  private readonly publish: boolean;

  constructor(options: WechatJobExecutorOptions) {
    this.publisher = options.publisher;
    this.publish = options.publish ?? false;
  }

  async prepare(payload: SerializedPayload): Promise<{ payload: SerializedPayload }> {
    return { payload };
  }

  async upload(): Promise<readonly { assetId: string; url?: string; mediaId?: string }[]> {
    // 公众号正文图由 publisher 内部 SecureImageFetcher 重托管,不单独上传。
    return [];
  }

  async submit(payload: SerializedPayload, _signal?: AbortSignal): Promise<JobReceipt> {
    const wechatPayload = buildWechatPublishPayload(payload, this.publish);
    const outcome = await this.publisher.publish(wechatPayload);
    return {
      platformId: "wechat",
      status: outcome.ok ? (this.publish ? "submitted" : "staged") : "failed",
      message: outcome.message,
      remoteId: outcome.remoteId,
      at: new Date().toISOString(),
    };
  }

  async verify(_payload: SerializedPayload, receipt: JobReceipt): Promise<JobReceipt> {
    // 公众号 draft/add 返回 media_id 即成功证据;freepublish 为异步受理(published 待后台发布)。
    const success = receipt.status === "staged" || receipt.status === "submitted" || receipt.status === "published";
    return {
      ...receipt,
      status: success ? "published" : "failed",
      message: success ? receipt.message : `发布未成功: ${receipt.message}`,
    };
  }
}
