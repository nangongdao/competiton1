/**
 * 平台 API 网络客户端契约 + 通用工具。
 *
 * - `PlatformHttpClient` 由 server/runner 注入真实 fetch 实现(测试可注入 mock);
 * - `fetchPlatformHttp` 是浏览器/Node 的 fetch 实现;
 * - `parseJsonResponse` / `strField` 等解析工具让"一键解析"各平台响应时行为一致。
 */
import type { ParsedApiResponse, PlatformHttpClient, PlatformHttpRequest, PlatformHttpResponse } from "./types.js";

export type { PlatformHttpClient, PlatformHttpRequest, PlatformHttpResponse };

/** 浏览器/Node fetch 实现 —— server/runner 用它注入真实请求。 */
export async function fetchPlatformHttp(
  req: PlatformHttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 15_000);
  try {
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      signal: controller.signal,
    });
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text: await res.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 把 HTTP 响应解析为 JSON(失败给出明确错误)。 */
export function parseJsonResponse<T>(res: PlatformHttpResponse): ParsedApiResponse<T> {
  if (res.text.length === 0) {
    return { ok: false, platformId: "", raw: "", error: `空响应(${res.status})`, errorKind: "api-error" };
  }
  try {
    return { ok: true, platformId: "", raw: JSON.parse(res.text) as T };
  } catch {
    return { ok: false, platformId: "", raw: res.text, error: `响应不是合法 JSON(${res.status}): ${truncate(res.text, 200)}` };
  }
}

/** 从未知结构中安全读取字符串字段(一键解析时容错)。 */
export function strField(value: unknown, ...keys: readonly string[]): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** 截断字符串(防止超长响应刷屏)。 */
export function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 脱敏:把密钥类字段值替换为掩码(永不展示完整密钥)。 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
