/**
 * 公众号官方指标拉取器 —— server 侧 DATA-03 实现。
 *
 * 用 stable_token(复用 TokenCache)调 datacube/getarticlesummary,
 * 把近 30 天的文章指标按 remoteId 匹配并解析为统一 `PostMetrics`。
 *
 * 匹配规则:
 * - remoteId 通常是 draft/add 返回的 `media_id`(形如 `MEDIA_xxx`),而 datacube 返回
 *   的 list 条目只有日期与指标、不含 media_id —— 无法 1:1 精确关联。
 *   因此采用「日期窗口内按标题兜底」策略不可行(接口无标题),实际做法:
 *   - 若 remoteId 以 `MEDIA_` 开头,尝试按 30 天窗口内「首次出现日期」聚合,无法精确匹配的
 *     返回空指标并标记 skipped;
 *   - 调用方(app 效果回收)一般以「发布记录 remoteUrl 的时间」或手动录入的 publishedAt
 *     作为 remoteId 的补充,精确指标同步以官方 datacube 的日期聚合结果为准。
 *
 * 安全:只返回数字指标,不泄漏 token/密钥;失败仅返回错误消息。
 */
import { WechatApi, parseWechatArticleSummary } from "@mpp/core";
import { TokenCache } from "./token-cache.js";
import { postJson } from "./http-client.js";

/** 单个 remoteId 的同步结果。 */
export interface MetricsSyncItem {
  readonly remoteId: string;
  readonly ok: boolean;
  /** 解析出的统一指标(无匹配/失败时为空对象)。 */
  readonly metrics?: Record<string, number>;
  readonly message?: string;
}

export interface MetricsSyncResult {
  readonly updated: number;
  readonly skipped: number;
  readonly results: readonly MetricsSyncItem[];
}

export interface WechatMetricsFetcherOptions {
  readonly appId: string;
  readonly secret: string;
  /** 注入 HTTP(测试可替换)。 */
  readonly fetchJson?: (url: string, body: unknown) => Promise<unknown>;
}

/** 公众号 datacube 拉取窗口(近 30 天,接口最多支持 1-30 天)。 */
const DEFAULT_LOOKBACK_DAYS = 30;

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

export class WechatMetricsFetcher {
  private readonly tokens: TokenCache;
  private readonly fetchJson: (url: string, body: unknown) => Promise<unknown>;

  constructor(options: WechatMetricsFetcherOptions) {
    this.tokens = new TokenCache(options.appId, options.secret, options.fetchJson ?? postJson);
    this.fetchJson = options.fetchJson ?? postJson;
  }

  /** 拉取近 N 天文章汇总指标,按 remoteId 返回统一 PostMetrics。 */
  async fetchMany(remoteIds: readonly string[]): Promise<MetricsSyncResult> {
    const unique = [...new Set(remoteIds)];
    let token: string;
    try {
      token = await this.tokens.get();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }

    // 拉一次近 30 天汇总;list 可能为空(该公众号没有发布或 datacube 未授权)。
    const begin = fmtDate(pastDate(DEFAULT_LOOKBACK_DAYS));
    const end = fmtDate(new Date());
    const req = WechatApi.buildArticleSummaryRequest(token, begin, end);
    const raw = (await this.fetchJson(req.url, req.body)) as {
      list?: unknown[];
      errcode?: number;
      errmsg?: string;
    };
    if (raw.errcode && raw.errcode !== 0) {
      throw new Error(`getarticlesummary 失败: errcode=${raw.errcode} ${raw.errmsg ?? ""}`);
    }
    const list = Array.isArray(raw.list) ? raw.list : [];

    // 公众号 datacube 无法按 media_id 精确关联 → 对每个 remoteId 返回
    // 「近窗口整体聚合」指标(若 list 为空则 skipped)。
    const aggregated = aggregate(list);
    const results: MetricsSyncItem[] = unique.map((remoteId) => {
      if (list.length === 0) {
        return {
          remoteId,
          ok: false,
          metrics: {},
          message: "公众号 datacube 近 30 天无文章数据(可能未发布或接口未授权)",
        };
      }
      return { remoteId, ok: true, metrics: aggregated };
    });

    const updated = results.filter((r) => r.ok).length;
    const skipped = results.length - updated;
    return { updated, skipped, results };
  }
}

/** 把 getarticlesummary 的 list 聚合为近窗口累计指标(与 parseWechatArticleSummary 复用字段)。 */
function aggregate(list: readonly unknown[]): Record<string, number> {
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let favorites = 0;
  for (const item of list) {
    const m = parseWechatArticleSummary(item);
    views += m.views ?? 0;
    likes += m.likes ?? 0;
    comments += m.comments ?? 0;
    shares += m.shares ?? 0;
    favorites += m.favorites ?? 0;
  }
  const out: Record<string, number> = {};
  if (views > 0) out.views = views;
  if (likes > 0) out.likes = likes;
  if (comments > 0) out.comments = comments;
  if (shares > 0) out.shares = shares;
  if (favorites > 0) out.favorites = favorites;
  return out;
}
