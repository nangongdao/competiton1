/**
 * OpenAI 兼容 LLM 适配器 —— 走 /v1/chat/completions,一份实现通吃
 * OpenAI / DeepSeek / Kimi / Qwen / 本地 Ollama / vLLM 等。
 *
 * 安全:apiKey 由调用方注入(来自前端本地存储或 server env),core 不持久化、不记录。
 * 网络:fetch 可注入便于测试;无 key 时 available=false,sync 链路退化为不调用。
 * 超时:支持 timeoutMs(AbortController),超时抛错由上层捕获回退,不挂死调用方。
 * 任务级参数:LlmRequest 可覆盖 temperature / maxTokens / systemPrompt。
 */
import type { LlmAdapter, LlmRequest } from "./types.js";
import { buildPrompt } from "./prompt-templates.js";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from "./openai-compat-constants.js";
import { llmTelemetry } from "./telemetry.js";
import type { LlmTelemetry } from "./telemetry.js";

export interface OpenAiCompatOptions {
  /** API 基址(到 /v1 级别,如 https://api.deepseek.com/v1)。 */
  readonly baseUrl: string;
  /** API key(无则适配器 available=false)。 */
  readonly apiKey: string;
  /** 模型名(如 deepseek-chat / gpt-4o-mini / qwen-plus)。 */
  readonly model: string;
  /** 注入的 fetch(测试用);缺省用全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
  /** 采样温度,默认 0.7。 */
  readonly temperature?: number;
  /** 单次最大 token,默认 1024。 */
  readonly maxTokens?: number;
  /** 系统提示词(缺省用内置新媒体编辑提示)。 */
  readonly systemPrompt?: string;
  /** 请求超时 ms,默认 30000。 */
  readonly timeoutMs?: number;
  /** 观测器(缺省用全局共享实例;测试可注入独立实例)。 */
  readonly telemetry?: LlmTelemetry;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class OpenAiCompatLlm implements LlmAdapter {
  readonly id = "openai-compat";
  private readonly fetchImpl: typeof fetch;
  private readonly telemetry: LlmTelemetry;

  constructor(private readonly opts: OpenAiCompatOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.telemetry = opts.telemetry ?? llmTelemetry;
  }

  get available(): boolean {
    return !!this.opts.apiKey && !!this.opts.baseUrl && !!this.opts.model;
  }

  /** 适配器级超时 ms。 */
  get timeoutMs(): number {
    return this.opts.timeoutMs ?? 30000;
  }

  /** 适配器级温度。 */
  get temperature(): number {
    return this.opts.temperature ?? DEFAULT_TEMPERATURE;
  }

  /** 适配器级 maxTokens。 */
  get maxTokens(): number {
    return this.opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /** 适配器级系统提示词。 */
  get systemPrompt(): string {
    return this.opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async run(req: LlmRequest): Promise<string> {
    if (!this.available) return req.input; // 与 NoopLlm 一致:不可用即透传。
    const prompt = buildPrompt(req);
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const timeoutMs = this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: [
            {
              role: "system",
              content: req.systemPrompt ?? this.systemPrompt,
            },
            { role: "user", content: prompt },
          ],
          temperature: req.temperature ?? this.temperature,
          max_tokens: req.maxTokens ?? this.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`LLM 请求失败: HTTP ${res.status}`);
        this.observe(req, prompt, undefined, Date.now() - started, err, res.status);
        throw err;
      }
      const data = (await res.json()) as ChatCompletionResponse;
      if (data.error?.message) {
        const err = new Error(`LLM 返回错误: ${data.error.message}`);
        this.observe(req, prompt, undefined, Date.now() - started, err);
        throw err;
      }
      const content = data.choices?.[0]?.message?.content;
      const out = content?.trim() || req.input; // 空响应回退原文,保证不破坏内容。
      this.observe(req, prompt, out, Date.now() - started, undefined);
      return out;
    } catch (err) {
      if (controller.signal.aborted) {
        const timeoutErr = new Error(`LLM 请求超时(>${timeoutMs}ms): ${url}`);
        this.observe(req, prompt, undefined, Date.now() - started, timeoutErr);
        throw timeoutErr;
      }
      // 已观测的错误直接抛出;未观测(网络层等)补记一条。
      this.observe(req, prompt, undefined, Date.now() - started, err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 记录一次调用观测(AI-ROBUST-03)。 */
  private observe(
    req: LlmRequest,
    inputText: string,
    outputText: string | undefined,
    durationMs: number,
    error: unknown,
    status?: number,
  ): void {
    this.telemetry.record({
      task: req.task,
      model: this.opts.model,
      baseUrl: this.opts.baseUrl,
      durationMs,
      ok: !error,
      inputText,
      outputText,
      error: error ?? undefined,
      adapterId: this.id,
      status,
    });
  }
}
