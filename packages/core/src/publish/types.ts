/**
 * 两阶段(stage → confirm)Publisher 契约。
 *
 * 为什么两阶段:多平台中仅公众号有官方 API 且发布异步、无法触达所有粉丝;其余无 API。
 * 因此默认 stage 产出"暂存产物"(可导出/复制粘贴),confirm 才真正提交(或模拟提交)。
 * 这与业界(Wechatsync 发布到草稿,人工确认)一致,能扛分步失败与平台审核。
 */
import type { Document, PlatformOverride } from "../ir/types.js";
import type { SerializedPayload } from "../adapters/types.js";

/** 暂存产物:序列化结果 + 可交付物(供导出/复制粘贴/辅助发布)。 */
export interface PublishArtifact {
  readonly platformId: string;
  readonly payload: SerializedPayload;
  /** 适合复制到剪贴板/粘贴到编辑器的主体(HTML 或纯文本)。 */
  readonly deliverable: string;
  /** 人类可读的发布指引(各平台不同)。 */
  readonly instructions: readonly string[];
}

/** 发布回执。 */
export interface PublishReceipt {
  readonly platformId: string;
  readonly status: "mock" | "staged" | "submitted" | "failed";
  readonly message: string;
  /** 平台返回的标识(公众号 draft media_id / publish_id)。 */
  readonly remoteId?: string;
  /** 模拟发布的产物落点/链接(演示用)。 */
  readonly previewUrl?: string;
  readonly at: string; // ISO 时间戳(由调用方注入,避免核心依赖时钟)
}

export interface PublishContext {
  readonly platformId: string;
  readonly document: Document;
  readonly override?: PlatformOverride;
  /** 时间戳注入(核心不直接调时钟,便于测试/确定性)。 */
  readonly now: () => string;
}

export interface Publisher {
  readonly kind: string;
  /** 阶段一:产出暂存产物(纯逻辑,不触网)。 */
  stage(payload: SerializedPayload, ctx: PublishContext): PublishArtifact;
  /** 阶段二:确认发布(模拟或真实)。 */
  confirm(artifact: PublishArtifact, ctx: PublishContext): Promise<PublishReceipt>;
}
