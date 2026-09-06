/**
 * LLM 适配器工具 —— 从 AI 连接中心的多配置构造运行时适配器。
 *
 * 供各 AI 功能组件(自动完成 / 内容助手 / 批量改写 / 计划任务)复用:
 * - 未配置 → undefined(纯规则兜底);
 * - 单配置(无已保存多配置) → 当前 llm 单配置直连(带指数退避重试);
 * - 多配置 → 当前生效配置为主 + 其余为备用(主失败自动回退 + 重试)。
 */
import { fallbackFromConfigs, type LlmAdapter, type LlmConfig } from "@mpp/core";
import type { LlmSettings } from "../state/store.js";

export interface LlmSource {
  llm: LlmSettings;
  llmConfigs: readonly LlmConfig[];
  activeLlmConfigId: string | null;
}

/** 由当前生效 LLM 配置 + 已保存多配置构造适配器。 */
export function buildLlmAdapter(source: LlmSource): LlmAdapter | undefined {
  const { llm, llmConfigs, activeLlmConfigId } = source;
  if (!llm.baseUrl || !llm.apiKey || !llm.model) return undefined;
  const active = llmConfigs.find((c) => c.id === activeLlmConfigId);
  const backups = llmConfigs
    .filter((c) => c.id !== activeLlmConfigId && c.baseUrl && c.model)
    .filter((c) => c.id !== active?.id);
  if (active) {
    // 当前生效配置优先(含 key),其余备用配置作为回退。
    return fallbackFromConfigs(
      { ...active, apiKey: active.apiKey || llm.apiKey },
      backups.map((c) => ({ ...c, apiKey: c.apiKey || llm.apiKey })),
      { retry: { maxRetries: 1 } },
    );
  }
  // 无已保存配置:直接用当前 llm 单配置(带重试)。
  return fallbackFromConfigs({ ...llm }, backups.map((c) => ({ ...c, apiKey: c.apiKey || llm.apiKey })), {
    retry: { maxRetries: 1 },
  });
}
