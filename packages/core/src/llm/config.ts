/**
 * LLM 连接配置 —— AI 连接中心的多配置管理契约。
 *
 * 一套配置 = 一个可切换的"大模型连接"。apiKey 遵循 SEC-04:
 * 默认仅会话保存,只有用户显式开启持久化才写入本地存储。
 */

/** 一条可持久化的 LLM 连接配置。 */
export interface LlmConfig {
  /** 配置唯一 id(本地生成)。 */
  readonly id: string;
  /** 展示名(用户可改,如"我的 DeepSeek")。 */
  readonly name: string;
  /** API 基址(到 /v1 级别)。 */
  readonly baseUrl: string;
  /** API key(空表示未填写;持久化策略见 SEC-04)。 */
  readonly apiKey: string;
  /** 模型名。 */
  readonly model: string;
  /** 采样温度(默认 0.7)。 */
  readonly temperature?: number;
  /** 单次最大 token(默认 1024)。 */
  readonly maxTokens?: number;
  /** 系统提示词(任务级覆盖;缺省用内置模板)。 */
  readonly systemPrompt?: string;
  /** 请求超时 ms(默认 30000)。 */
  readonly timeoutMs?: number;
  /** 是否本地/自托管服务。 */
  readonly isLocal?: boolean;
  /** 来源预设 id(可选,用于 UI 标注来源)。 */
  readonly presetId?: string;
}

/** 配置校验结果。 */
export interface LlmConfigValidation {
  readonly ok: boolean;
  /** 可读的错误信息(ok=false 时)。 */
  readonly errors: readonly string[];
}

/** 校验配置是否合法(必填字段完整性 + 基址格式)。 */
export function validateLlmConfig(config: Partial<LlmConfig>): LlmConfigValidation {
  const errors: string[] = [];
  if (!config.name || !config.name.trim()) errors.push("配置名称不能为空");
  if (!config.baseUrl || !config.baseUrl.trim()) {
    errors.push("API 基址不能为空");
  } else {
    try {
      const u = new URL(config.baseUrl);
      if (!/^https?:$/.test(u.protocol)) errors.push("API 基址需为 http(s) 协议");
    } catch {
      errors.push("API 基址格式不正确(应为 https://api.example.com/v1)");
    }
  }
  if (!config.model || !config.model.trim()) errors.push("模型名不能为空");
  return { ok: errors.length === 0, errors };
}

/** 归一化:补齐缺省字段,返回一份可用于 OpenAiCompatLlm 的完整配置。 */
export function normalizeLlmConfig(config: Partial<LlmConfig>): LlmConfig {
  return {
    id: config.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: (config.name ?? "").trim() || "未命名配置",
    baseUrl: (config.baseUrl ?? "").trim().replace(/\/+$/, ""),
    apiKey: config.apiKey ?? "",
    model: (config.model ?? "").trim() || "",
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 1024,
    systemPrompt: config.systemPrompt ?? "",
    timeoutMs: config.timeoutMs ?? 30000,
    isLocal: config.isLocal ?? false,
    presetId: config.presetId,
  };
}

/** 配置中剔除 apiKey(用于持久化/诊断,符合 SEC-04)。 */
export function stripApiKey(config: LlmConfig): Omit<LlmConfig, "apiKey"> {
  const { apiKey: _removed, ...rest } = config;
  return rest;
}

/** 判断配置是否已可发起请求(基址 + 模型 + key 齐全)。 */
export function isConfigReady(config: Pick<LlmConfig, "baseUrl" | "apiKey" | "model">): boolean {
  return !!config.baseUrl && !!config.apiKey && !!config.model;
}
