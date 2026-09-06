/**
 * DATA-03 官方 API 指标提供者实现:
 * - `MockMetricsProvider`:模拟(测试/演示,返回可配置指标);
 * - `WechatOfficialApiMetricsProvider`:公众号官方数据接口(需 server 转发,见 @mpp/server)。
 *
 * 网络注入原则与项目一致:core 不直接发请求,provider 通过注入的 fetch 函数访问。
 */
import type { MetricsProvider, PostMetrics } from "./types.js";

/** 公众号官方指标 provider 的 fetch 注入签名。 */
export interface OfficialMetricsFetcher {
  (request: {
    readonly serverUrl: string;
    readonly token?: string;
    readonly remoteId: string;
  }): Promise<PostMetrics>;
}

/**
 * 把公众号 datacube `getarticlesummary` 响应解析为 `PostMetrics`。
 *
 * 响应结构(list 数组,按日期聚合):
 * ```json
 * { "list": [
 *   { "ref_date": "2026-08-04", "int_page_read_count": 1200,
 *     "int_page_read_user": 900, "add_to_fav_count": 30, ... },
 * ] }
 * ```
 * 也可兼容单对象 `{ "int_page_read_count": ... }`。找不到任何数字字段时返回空指标。
 */
export function parseWechatArticleSummary(raw: unknown): PostMetrics {
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj["list"]) ? (obj["list"] as unknown[]) : null;
  const items = list && list.length > 0 ? list : [obj];

  const pick = (key: string): number | undefined => {
    const value = (items[0] as Record<string, unknown> | undefined)?.[key];
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const views = pick("int_page_read_count");
  const likes = pick("add_to_fav_count");
  const comments = pick("comment_count");
  const shares = pick("share_count");
  const fans = pick("add_to_fav_user");
  return {
    ...(views !== undefined ? { views } : {}),
    ...(likes !== undefined ? { likes } : {}),
    ...(comments !== undefined ? { comments } : {}),
    ...(shares !== undefined ? { shares } : {}),
    ...(fans !== undefined ? { favorites: fans } : {}),
  };
}

/** 模拟 provider(测试/演示)。 */
export class MockMetricsProvider implements MetricsProvider {
  readonly platformId: string;
  private readonly metrics: PostMetrics;

  constructor(platformId: string, metrics: PostMetrics = { views: 100, likes: 10 }) {
    this.platformId = platformId;
    this.metrics = metrics;
  }

  isConfigured(): boolean {
    return true;
  }

  async fetchMetrics(): Promise<PostMetrics> {
    return { ...this.metrics };
  }
}

/** 公众号官方 API 指标 provider(经 server 转发,默认未配置)。 */
export class WechatOfficialApiMetricsProvider implements MetricsProvider {
  readonly platformId = "wechat";
  private readonly fetcher: OfficialMetricsFetcher | null;
  private readonly serverUrl: string;
  private readonly token: string | undefined;

  constructor(options: { serverUrl: string; token?: string; fetcher?: OfficialMetricsFetcher | null }) {
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.fetcher = options.fetcher ?? null;
  }

  isConfigured(): boolean {
    return !!this.fetcher && !!this.serverUrl;
  }

  async fetchMetrics(remoteId: string, signal?: AbortSignal): Promise<PostMetrics> {
    if (!this.fetcher) throw new Error("公众号指标 provider 未注入 fetch");
    if (signal?.aborted) throw new Error("已取消");
    return this.fetcher({ serverUrl: this.serverUrl, token: this.token, remoteId });
  }
}
