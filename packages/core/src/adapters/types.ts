/**
 * 适配器契约 —— 加平台零改核心的关键。
 *
 * 核心只依赖 PlatformAdapter 接口 + 注册表迭代,绝无 switch(platform)。
 * 新平台 = 实现一个 adapter + 注册一次。
 */
import type { Asset, Capabilities, Document, PlatformOverride } from "../ir/types.js";
import type { PlatformConfig, ResolvedPlatformConfig } from "../config/platform-config.js";

/** 序列化产物:各平台原生表示 + 元信息。 */
export interface SerializedPayload {
  /** 平台原生主体内容:公众号内联 HTML / 知乎富文本 HTML / B站受限 HTML / 小红书纯文本。 */
  readonly content: string;
  /** 内容 MIME:text/html 或 text/plain,决定剪贴板写入方式。 */
  readonly mime: "text/html" | "text/plain";
  /** 派生的平台标题(已按平台约束处理)。 */
  readonly title: string;
  /** 派生摘要 / 推荐语。 */
  readonly summary?: string;
  /** 解析后的平台标签/话题。 */
  readonly tags: readonly string[];
  /** 需要的图片资产 id(供发布器重托管)。 */
  readonly imageAssetIds: readonly string[];
  /** 封面资产 id(若有)。 */
  readonly coverAssetId?: string;
  /** 平台特定补充字段(B站 category/tid 等)。 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** 资产重托管上下文(网络能力注入,核心不直接发请求)。 */
export interface RehostContext {
  readonly platformId: string;
  readonly upload: (asset: Asset) => Promise<{ url?: string; mediaId?: string }>;
  /** 单平台内图片上传并发上限。缺省按平台限流策略(公众号 3,其余 6)。 */
  readonly concurrency?: number;
}

export interface RehostResult {
  readonly assetId: string;
  readonly url?: string;
  readonly mediaId?: string;
}

export interface PlatformAdapter {
  readonly id: string;
  /** 展示名(中文)。 */
  readonly name: string;
  readonly capabilities: Capabilities;

  /** IR → IR:应用该平台的降级变换管线。可注入配置(违禁词表)。 */
  preprocess(doc: Document, override?: PlatformOverride, config?: PlatformConfig): Document;

  /** IR → 平台原生序列化产物。config 为主题/排版等运行时配置(可选)。 */
  serialize(doc: Document, override?: PlatformOverride, config?: ResolvedPlatformConfig): SerializedPayload;

  /** 重托管单个资产到该平台图床(网络注入)。 */
  rehostAsset(asset: Asset, ctx: RehostContext): Promise<RehostResult>;
}
