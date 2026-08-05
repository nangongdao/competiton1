/**
 * 平台限流策略 + 自适应并发控制器(UPGRADE §4.2)。
 *
 * 不同平台图床/素材接口的限流强度不同:固定一个并发数不是最优。
 * - 静态基线:PLATFORM_RATE_POLICY 给出各平台默认图片并发与重试参数。
 * - 动态调节:AdaptiveConcurrency 按"遇 429 减半、连续成功缓慢恢复"的 AIMD 策略
 *   自适应升降并发,调用方把它注入 RehostContext.concurrency 即可生效。
 */
export interface RatePolicy {
  /** 单平台内图片上传并发上限。 */
  readonly assetConcurrency: number;
  /** 限流重试退避基数(ms)。 */
  readonly retryBaseMs: number;
  /** 单次发布最大重试次数。 */
  readonly maxRetries: number;
}

/** 各平台限流基线(公众号素材接口频率限制最严,收敛到 3)。 */
export const PLATFORM_RATE_POLICY: Readonly<Record<string, RatePolicy>> = {
  wechat: { assetConcurrency: 3, retryBaseMs: 1000, maxRetries: 3 },
  zhihu: { assetConcurrency: 6, retryBaseMs: 500, maxRetries: 3 },
  bilibili: { assetConcurrency: 4, retryBaseMs: 800, maxRetries: 3 },
  xiaohongshu: { assetConcurrency: 6, retryBaseMs: 500, maxRetries: 2 },
};

/** 未列出的平台回退默认策略。 */
export const DEFAULT_RATE_POLICY: RatePolicy = { assetConcurrency: 6, retryBaseMs: 500, maxRetries: 3 };

/** 取平台限流策略(未注册/未知平台回退默认)。 */
export function ratePolicyFor(platformId: string): RatePolicy {
  return PLATFORM_RATE_POLICY[platformId] ?? DEFAULT_RATE_POLICY;
}

/**
 * 自适应并发控制器 —— AIMD(Additive Increase Multiplicative Decrease)。
 *
 * 命中限流(429)时并发减半(乘性下降),连续成功 10 次后 +1(加性恢复)。
 * 保证:并发恒在 [min, max] 区间;调用方按 upload 的返回码喂事件。
 */
export class AdaptiveConcurrency {
  private current: number;
  private successStreak = 0;

  constructor(
    private readonly max: number,
    private readonly min = 1,
    initial?: number,
  ) {
    this.current = Math.max(min, Math.min(max, initial ?? max));
  }

  /** 当前建议并发数。 */
  get value(): number {
    return this.current;
  }

  /** 命中限流:并发减半(不破下限),成功计数清零。 */
  onRateLimited(): void {
    this.current = Math.max(this.min, Math.floor(this.current / 2));
    this.successStreak = 0;
  }

  /** 一次成功上传:连续成功满 10 次则并发 +1(不超过上限)。 */
  onSuccess(): void {
    if (++this.successStreak >= 10) {
      this.current = Math.min(this.max, this.current + 1);
      this.successStreak = 0;
    }
  }

  /** 恢复初始并发(新发布批次开始时可调用)。 */
  reset(): void {
    this.current = this.max;
    this.successStreak = 0;
  }
}
