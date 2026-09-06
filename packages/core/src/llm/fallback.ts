/**
 * 多模型回退 —— 主配置失败自动切换备用配置。
 *
 * 场景:用户配置了多个 LLM(如 DeepSeek 主 + OpenAI 备),主模型限流/超时/5xx
 * 时自动回退到备用,保证 AI 任务不中断。结果透传,附带 usedFallback 观测标记
 * (通过实例状态读取)。
 */
import type { LlmAdapter, LlmRequest } from "./types.js";
import { isRetryableLlmError } from "./retry.js";

export interface FallbackLlmOptions {
  /** 主适配器。 */
  readonly primary: LlmAdapter;
  /** 备用适配器(按优先级排列)。 */
  readonly fallbacks: readonly LlmAdapter[];
  /** 注入回调(观测回退事件)。 */
  readonly onFallback?: (from: LlmAdapter, to: LlmAdapter, err: Error) => void;
}

export class FallbackLlm implements LlmAdapter {
  readonly id = "llm-fallback";
  /** 最近一次调用是否发生了回退(供 UI/诊断读取)。 */
  lastUsedFallback = false;
  /** 最近一次调用实际使用的适配器 id。 */
  lastUsedAdapterId = "";
  /** 累计回退次数。 */
  fallbackCount = 0;

  constructor(private readonly opts: FallbackLlmOptions) {}

  get available(): boolean {
    return this.opts.primary.available || this.opts.fallbacks.some((f) => f.available);
  }

  async run(req: LlmRequest): Promise<string> {
    const candidates: LlmAdapter[] = [
      this.opts.primary,
      ...this.opts.fallbacks.filter((f) => f !== this.opts.primary),
    ].filter((a) => a.available);

    let lastErr: Error | undefined;
    for (let i = 0; i < candidates.length; i++) {
      const adapter = candidates[i];
      try {
        const out = await adapter.run(req);
        this.lastUsedAdapterId = adapter.id;
        if (i > 0) {
          this.lastUsedFallback = true;
          this.fallbackCount++;
        } else {
          this.lastUsedFallback = false;
        }
        return out;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        lastErr = e;
        // 只有可重试错误才值得回退;业务错误(4xx)直接上抛。
        if (!isRetryableLlmError(e)) break;
        if (i < candidates.length - 1) {
          this.opts.onFallback?.(adapter, candidates[i + 1], e);
        }
      }
    }
    this.lastUsedFallback = candidates.length > 1;
    throw lastErr ?? new Error("所有 LLM 配置均不可用");
  }
}
