/**
 * LLM 改写适配器接口 —— 预留扩展点,默认 noop。
 *
 * 核心格式转换全部用确定性规则;LLM 仅用于"风格改写"这类规则做不好的任务:
 * 小红书口语化、爆款标题生成、摘要生成。无 key 时用 NoopLlm(透传),有 key 时注入真实实现。
 */

export type LlmTask =
  | "colloquialize"
  | "title"
  | "summary"
  | "rewrite"
  | "paragraph-rewrite"
  | "strategy";

export interface LlmRequest {
  readonly task: LlmTask;
  readonly platformId: string;
  readonly input: string;
  /** 任务相关约束(如标题最大字数)。 */
  readonly constraints?: Readonly<Record<string, unknown>>;
  /** 任务级采样温度(覆盖适配器默认;缺省用适配器默认)。 */
  readonly temperature?: number;
  /** 任务级单次最大 token(覆盖适配器默认;缺省用适配器默认)。 */
  readonly maxTokens?: number;
  /** 任务级系统提示词(覆盖适配器默认)。 */
  readonly systemPrompt?: string;
}

export interface LlmAdapter {
  readonly id: string;
  readonly available: boolean;
  run(req: LlmRequest): Promise<string>;
}
