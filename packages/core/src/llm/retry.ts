/**
 * LLM 指数退避重试包装器 —— 瞬时错误自动重试,尊重 Retry-After。
 *
 * 仅对"可重试"错误重试:网络异常 / 5xx / 429。4xx(除 429)与业务错误不重试。
 * 支持注入时钟与 sleep 便于测试;重试次数可配(默认 2 次重试)。
 */
import type { LlmAdapter, LlmRequest } from "./types.js";

/** 判定错误是否可重试。 */
export function isRetryableLlmError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg.includes("HTTP 429") || msg.includes("超时") || msg.includes("fetch failed") || msg.includes("Failed to fetch")) {
    return true;
  }
  // 5xx
  for (const code of [500, 502, 503, 504]) {
    if (msg.includes(`HTTP ${code}`)) return true;
  }
  return false;
}

export interface LlmRetryOptions {
  /** 最大重试次数(默认 2,即总共最多 3 次尝试)。 */
  readonly maxRetries?: number;
  /** 基础退避 ms(默认 300,指数增长)。 */
  readonly baseDelayMs?: number;
  /** 注入 sleep(测试用;默认 setTimeout)。 */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 注入时钟(测试用;默认 Date.now)。 */
  readonly now?: () => number;
  /** 每次重试前的回调(观测)。 */
  readonly onRetry?: (attempt: number, err: Error, delayMs: number) => void;
}

/** 指数退避延迟(带随机抖动 ±20%),尊重错误中的 Retry-After(秒)。 */
export function backoffDelay(attempt: number, baseDelayMs: number, err?: unknown, now?: () => number): number {
  // 尝试解析 Retry-After(HTTP 头格式,秒)。
  if (err instanceof Error) {
    const m = err.message.match(/Retry-After[=:\s]+(\d+)/i);
    if (m) {
      const sec = Number(m[1]);
      if (Number.isFinite(sec) && sec >= 0) return Math.min(sec, 60) * 1000;
    }
  }
  const base = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20%
  void now;
  return Math.round(base * jitter);
}

/** 带重试的 LLM 适配器包装器。 */
export class LlmRetry implements LlmAdapter {
  readonly id = "llm-retry";

  constructor(
    private readonly inner: LlmAdapter,
    private readonly opts: LlmRetryOptions = {},
  ) {}

  get available(): boolean {
    return this.inner.available;
  }

  async run(req: LlmRequest): Promise<string> {
    const maxRetries = Math.max(0, this.opts.maxRetries ?? 2);
    const baseDelayMs = this.opts.baseDelayMs ?? 300;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.inner.run(req);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        lastErr = e;
        if (!isRetryableLlmError(e) || attempt === maxRetries) break;
        const delay = backoffDelay(attempt + 1, baseDelayMs, e);
        this.opts.onRetry?.(attempt + 1, e, delay);
        await sleep(delay);
      }
    }
    throw lastErr ?? new Error("LLM 请求失败");
  }
}
