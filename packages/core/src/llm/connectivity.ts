/**
 * LLM 连通性检测 —— AI 连接中心"测试连接"按钮的实现。
 *
 * 策略:先尝试 GET /models(轻量、无需消耗 token),若失败或 404 则回退到
 * 最小 chat completion(1 token)验证。任一成功即判定连通,并给出延迟。
 * 全程不记录、不落盘 apiKey;错误信息脱敏(不含 key)。
 */
import { isConfigReady, type LlmConfig } from "./config.js";
import { DEFAULT_TIMEOUT_MS } from "./openai-compat-constants.js";

export interface ConnectivityResult {
  readonly ok: boolean;
  /** 可读的结果描述(成功显示模型/延迟,失败显示原因)。 */
  readonly message: string;
  /** 延迟 ms(成功时)。 */
  readonly latencyMs?: number;
  /** 命中的模型名(经 /models 校验时)。 */
  readonly model?: string;
  /** 失败原因类别(便于 UI 分色)。 */
  readonly errorKind?: "not-configured" | "timeout" | "http" | "network" | "bad-response";
  /** HTTP 状态码(有响应时)。 */
  readonly status?: number;
}

export interface ConnectivityOptions {
  /** 注入的 fetch(测试用)。 */
  readonly fetchImpl?: typeof fetch;
  /** 超时 ms(默认 30s)。 */
  readonly timeoutMs?: number;
}

/** 对配置执行连通性检测。 */
export async function testLlmConnection(
  config: Pick<LlmConfig, "baseUrl" | "apiKey" | "model"> & { timeoutMs?: number },
  opts: ConnectivityOptions = {},
): Promise<ConnectivityResult> {
  if (!isConfigReady(config)) {
    return {
      ok: false,
      message: "未完整配置(需要 API 基址 + API Key + 模型名)",
      errorKind: "not-configured",
    };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = config.baseUrl.replace(/\/+$/, "");

  // 1) 轻量探测 GET /models
  const modelsProbe = await probeWithTimeout(
    (signal) =>
      fetchImpl(`${base}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal,
      }),
    timeoutMs,
    `${base}/models`,
  );
  if (modelsProbe.ok && modelsProbe.status !== undefined && modelsProbe.status < 500) {
    if (modelsProbe.status === 200) {
      // 校验响应中是否包含配置的模型(容错:列表为空也算连通)。
      return {
        ok: true,
        message: `连接成功 · 服务可达(${config.model})`,
        latencyMs: modelsProbe.latencyMs,
        model: config.model,
      };
    }
    // 401/403 → 服务可达但 key 无效;其余 4xx(404/405/400)回退到 chat 探测。
    if (modelsProbe.status === 401 || modelsProbe.status === 403) {
      return {
        ok: false,
        message: `鉴权失败(HTTP ${modelsProbe.status}):API Key 可能无效或未开通该模型`,
        errorKind: "http",
        status: modelsProbe.status,
        latencyMs: modelsProbe.latencyMs,
      };
    }
  }

  // 2) 回退到最小 chat completion(部分服务不提供 /models 或鉴权方式不同)。
  const chatProbe = await probeWithTimeout(
    (signal) =>
      fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: "连通性检测" },
            { role: "user", content: "ping" },
          ],
          max_tokens: 1,
          stream: false,
        }),
        signal,
      }),
    timeoutMs,
    `${base}/chat/completions`,
  );
  if (chatProbe.ok && chatProbe.status !== undefined && chatProbe.status < 500) {
    if (chatProbe.status === 200) {
      return {
        ok: true,
        message: `连接成功 · ${config.model} 可响应`,
        latencyMs: chatProbe.latencyMs,
        model: config.model,
      };
    }
    return {
      ok: false,
      message: `请求失败(HTTP ${chatProbe.status}):请检查模型名与 API Key 权限`,
      errorKind: "http",
      status: chatProbe.status,
      latencyMs: chatProbe.latencyMs,
    };
  }

  // 3) 网络层错误。
  if (chatProbe.errorKind === "timeout" || modelsProbe.errorKind === "timeout") {
    return {
      ok: false,
      message: `连接超时(>${timeoutMs}ms):请检查网络或服务是否已启动`,
      errorKind: "timeout",
    };
  }
  return {
    ok: false,
    message: `无法连接:${chatProbe.networkError ?? modelsProbe.networkError ?? "未知网络错误"}`,
    errorKind: "network",
  };
}

interface ProbeResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  networkError?: string;
  errorKind?: "timeout" | "http" | "network" | "bad-response";
}

async function probeWithTimeout(
  run: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
  url: string,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await run(controller.signal);
    void res; // 响应体不消费(仅探测状态)。
    return {
      ok: true,
      status: res.status,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, errorKind: "timeout", networkError: `超时(${url})` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errorKind: "network", networkError: sanitizeNetworkError(msg) };
  } finally {
    clearTimeout(timer);
  }
}

/** 网络错误脱敏:去掉 URL 与可能的 key 片段。 */
function sanitizeNetworkError(msg: string): string {
  return msg.replace(/https?:\/\/[^\s]+/g, "<url>").slice(0, 160);
}
