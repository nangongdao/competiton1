/**
 * LLM 适配器工厂 —— 从 LlmConfig(或多配置)构造可用的 LlmAdapter。
 *
 * 单一配置 → OpenAiCompatLlm;多配置 → FallbackLlm(主 + 备用)。
 * 连接中心保存的多套配置可通过此工厂统一转换为运行时适配器。
 * 观测(AI-ROBUST-03):构造时默认接入全局共享观测器(llmTelemetry),
 * 调用方可通过 opts.telemetry 注入独立实例(测试用)。
 */
import type { LlmConfig } from "./config.js";
import { normalizeLlmConfig } from "./config.js";
import { OpenAiCompatLlm } from "./openai-compat-llm.js";
import { LlmRetry } from "./retry.js";
import { FallbackLlm } from "./fallback.js";
import { llmTelemetry } from "./telemetry.js";
import type { LlmTelemetry } from "./telemetry.js";
import type { LlmAdapter } from "./types.js";
import type { LlmRetryOptions } from "./retry.js";

/** 由单条配置构造适配器(可叠加重试)。 */
export function adapterFromConfig(
  config: Partial<LlmConfig>,
  opts: { retry?: LlmRetryOptions; telemetry?: LlmTelemetry } = {},
): LlmAdapter {
  const c = normalizeLlmConfig(config);
  const base = new OpenAiCompatLlm({
    baseUrl: c.baseUrl,
    apiKey: c.apiKey,
    model: c.model,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    systemPrompt: c.systemPrompt,
    timeoutMs: c.timeoutMs,
    telemetry: opts.telemetry ?? llmTelemetry,
  });
  return opts.retry ? new LlmRetry(base, opts.retry) : base;
}

/** 由"当前生效配置 + 备用配置列表"构造回退适配器(每套均可带重试)。 */
export function fallbackFromConfigs(
  primary: Partial<LlmConfig>,
  backups: readonly Partial<LlmConfig>[],
  opts: { retry?: LlmRetryOptions; telemetry?: LlmTelemetry } = {},
): LlmAdapter {
  const candidates = [primary, ...backups].filter((c) => c && (c.apiKey || c.model || c.baseUrl));
  if (candidates.length <= 1) return adapterFromConfig(primary, opts);
  const adapters = candidates.map((c) => adapterFromConfig(c, opts));
  return new FallbackLlm({ primary: adapters[0], fallbacks: adapters.slice(1) });
}
