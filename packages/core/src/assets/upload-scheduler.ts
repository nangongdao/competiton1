/**
 * 自适应上传调度器(PERF-03)。
 *
 * 把 AdaptiveConcurrency(AIMD) + jitteredBackoff(指数退避+抖动) + Retry-After
 * 接入图片上传链路。调用方把返回的 upload 注入 RehostContext,即可获得:
 * - 限流(429)自动降并发 + 退避重试;
 * - 连续成功缓慢恢复并发;
 * - Retry-After 头优先于指数退避;
 * - 单图失败不阻断整篇(与 rehost-engine 的容错一致)。
 *
 * 纯编排 + 网络注入:core 不直接发请求,依赖调用方提供的 rawUpload。
 */
import type { Asset } from "../ir/types.js";
import { AdaptiveConcurrency, parseRetryAfter } from "./rate-policy.js";
import { ratePolicyFor } from "./rate-policy.js";

/** 一次上传的结果(与 RehostContext.upload 一致)。 */
export interface UploadOutcome {
  readonly url?: string;
  readonly mediaId?: string;
}

/** 原始上传(不感知限流,抛错或返回错误码)。 */
export type RawUpload = (asset: Asset) => Promise<UploadOutcome>;

/** 上传错误(可携带 Retry-After 信息)。 */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    /** Retry-After 头值(秒或日期),可选。 */
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "RateLimitedError";
  }
}

/** 上传调度器选项。 */
export interface UploadSchedulerOptions {
  /** 平台 id(用于取限流策略)。 */
  readonly platformId: string;
  /** 并发上限覆盖(默认按平台策略)。 */
  readonly maxConcurrency?: number;
  /** 最大重试次数(默认按平台策略)。 */
  readonly maxRetries?: number;
  /** 退避基数(默认按平台策略)。 */
  readonly retryBaseMs?: number;
  /** 随机种子注入(测试确定性;默认 Math.random)。 */
  readonly random?: () => number;
}

/**
 * 自适应上传调度器。
 *
 * @example
 * ```ts
 * const scheduler = new UploadScheduler({ platformId: "wechat" });
 * const ctx: RehostContext = {
 *   platformId: "wechat",
 *   concurrency: () => scheduler.concurrency, // 动态并发
 *   upload: scheduler.wrap(rawUpload),
 * };
 * ```
 */
export class UploadScheduler {
  private readonly controller: AdaptiveConcurrency;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly random: () => number;

  constructor(options: UploadSchedulerOptions) {
    const policy = ratePolicyFor(options.platformId);
    this.controller = new AdaptiveConcurrency(
      options.maxConcurrency ?? policy.assetConcurrency,
      1,
      options.maxConcurrency ?? policy.assetConcurrency,
    );
    this.maxRetries = options.maxRetries ?? policy.maxRetries;
    this.retryBaseMs = options.retryBaseMs ?? policy.retryBaseMs;
    this.random = options.random ?? Math.random;
  }

  /** 当前建议并发数(随限流动态变化)。 */
  get concurrency(): number {
    return this.controller.value;
  }

  /** 包装原始上传:注入 AIMD 并发事件 + 退避重试。 */
  wrap(raw: RawUpload): (asset: Asset) => Promise<UploadOutcome> {
    return async (asset) => {
      let attempt = 0;
      // 首次直接尝试;失败按策略重试。
      for (;;) {
        try {
          const outcome = await raw(asset);
          this.controller.onSuccess();
          return outcome;
        } catch (err) {
          const isRateLimit = err instanceof RateLimitedError;
          const retryAfterMs = isRateLimit
            ? parseRetryAfter((err as RateLimitedError).retryAfter, Date.now())
            : null;
          // 命中限流:每次失败都降并发(AIMD 乘性下降)。
          if (isRateLimit) this.controller.onRateLimited();
          if (attempt >= this.maxRetries) {
            // 重试耗尽:上报失败(单图失败由 rehost-engine 容错,不阻断整篇)。
            throw err;
          }
          attempt++;
          // Retry-After 优先,否则指数退避 + 抖动。
          const wait = retryAfterMs ?? jitteredBackoff(this.retryBaseMs, attempt, 0.5, this.random);
          await sleep(wait);
        }
      }
    };
  }

  /** 恢复初始并发(新发布批次开始)。 */
  reset(): void {
    this.controller.reset();
  }
}

/** 全抖动退避(带可注入随机源)。 */
function jitteredBackoff(baseMs: number, attempt: number, jitter: number, random: () => number): number {
  const exp = baseMs * 2 ** Math.max(0, attempt - 1);
  const min = exp * (1 - jitter);
  const span = exp * jitter * 2;
  return Math.round(min + random() * span);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
