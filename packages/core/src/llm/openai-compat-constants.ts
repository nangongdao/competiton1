/**
 * OpenAI 兼容 LLM 的默认常量 —— 集中管理,供适配器与预设复用。
 */

/** 默认系统提示词(新媒体内容编辑助手,只输出改写结果)。 */
export const DEFAULT_SYSTEM_PROMPT =
  "你是中文新媒体内容编辑助手,只输出改写结果,不加解释。";

/** 默认采样温度。 */
export const DEFAULT_TEMPERATURE = 0.7;

/** 默认单次最大 token。 */
export const DEFAULT_MAX_TOKENS = 1024;

/** 默认请求超时 ms。 */
export const DEFAULT_TIMEOUT_MS = 30000;
