/**
 * LLM 预设模板注册表 —— 一键填充"API 基址 + 默认模型 + 说明"。
 *
 * 面向 OpenAI 兼容接口的常见服务商。预设只是模板,用户可随时在 AI 连接中心
 * 修改 baseUrl / model / apiKey。密钥绝不进入预设。
 */
import type { LlmConfig } from "./config.js";

/** 预设模板(不含 apiKey)。 */
export interface LlmPreset {
  /** 预设唯一 id(如 deepseek / openai / ollama)。 */
  readonly id: string;
  /** 展示名(如 DeepSeek / OpenAI / Ollama 本地)。 */
  readonly name: string;
  /** API 基址(到 /v1 级别,如 https://api.deepseek.com/v1)。 */
  readonly baseUrl: string;
  /** 默认模型名。 */
  readonly defaultModel: string;
  /** 一句话说明。 */
  readonly description: string;
  /** 默认 temperature(缺省 0.7)。 */
  readonly temperature?: number;
  /** 默认 maxTokens(缺省 1024)。 */
  readonly maxTokens?: number;
  /** 是否本地/自托管(如 Ollama / vLLM),提示无外网亦可。 */
  readonly isLocal?: boolean;
}

const PRESETS: readonly LlmPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    description: "DeepSeek 官方 API,deepseek-chat 高性价比,适合标题/摘要/段落改写。",
    temperature: 0.7,
    maxTokens: 1024,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    description: "OpenAI 官方 API,gpt-4o-mini 兼顾质量与成本。",
    temperature: 0.7,
    maxTokens: 1024,
  },
  {
    id: "moonshot",
    name: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    description: "月之暗面 Kimi,中文长文本能力强。",
    temperature: 0.7,
    maxTokens: 1024,
  },
  {
    id: "qwen",
    name: "通义千问 (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    description: "阿里通义千问,OpenAI 兼容模式。",
    temperature: 0.7,
    maxTokens: 1024,
  },
  {
    id: "glm",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    description: "智谱 AI,glm-4-flash 免费模型适合高频调用。",
    temperature: 0.7,
    maxTokens: 1024,
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen2.5:7b",
    description: "本地 Ollama 服务,OpenAI 兼容端点,无需外网与密钥。",
    temperature: 0.7,
    maxTokens: 1024,
    isLocal: true,
  },
  {
    id: "vllm",
    name: "vLLM (自托管)",
    baseUrl: "http://127.0.0.1:8000/v1",
    defaultModel: "Qwen2.5-7B-Instruct",
    description: "自托管 vLLM OpenAI 兼容端点,适合内网/私有部署。",
    temperature: 0.7,
    maxTokens: 1024,
    isLocal: true,
  },
];

/** 全部预设(只读)。 */
export function listLlmPresets(): readonly LlmPreset[] {
  return PRESETS;
}

/** 按 id 取预设(不存在返回 undefined)。 */
export function getLlmPreset(id: string): LlmPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 由预设构造一份可编辑的 LlmConfig(apiKey 置空,由用户填写)。 */
export function configFromPreset(preset: LlmPreset): LlmConfig {
  return {
    id: `custom-${preset.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.defaultModel,
    temperature: preset.temperature ?? 0.7,
    maxTokens: preset.maxTokens ?? 1024,
    isLocal: preset.isLocal,
    presetId: preset.id,
  };
}
