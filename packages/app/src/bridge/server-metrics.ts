/**
 * server 公众号官方指标同步客户端 —— DATA-03 落地(app 侧)。
 *
 * 与 server `routes/metrics.ts` 的 POST /metrics/sync 契约对应。
 * 由 store 的 syncPerformanceFromApi 注入给 core 的 `WechatOfficialApiMetricsProvider`。
 */
import type { PostMetrics } from "@mpp/core";

export interface ServerMetricsRequest {
  readonly serverUrl: string;
  /** 本机 capability token(X-MPP-Token)。 */
  readonly token?: string;
  readonly remoteIds: readonly string[];
  /** ACCOUNT-03:公众号账号的 server profile 引用(多账号凭据选择)。 */
  readonly serverProfileId?: string;
}

export interface ServerMetricsSyncItem {
  readonly remoteId: string;
  readonly ok: boolean;
  readonly metrics?: Record<string, number>;
  readonly message?: string;
}

export interface ServerMetricsSyncResult {
  readonly ok: boolean;
  readonly updated: number;
  readonly skipped: number;
  readonly results: readonly ServerMetricsSyncItem[];
  readonly message?: string;
}

/** 请求失败的统一提示(不暴露 token/路径细节)。 */
function fail(message: string): ServerMetricsSyncResult {
  return { ok: false, updated: 0, skipped: 0, results: [], message };
}

/** 调用 server 同步公众号官方指标(一次 POST 批量拉取)。 */
export async function syncServerMetrics(req: ServerMetricsRequest): Promise<ServerMetricsSyncResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(`${req.serverUrl.replace(/\/+$/, "")}/metrics/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        remoteIds: req.remoteIds,
        ...(req.serverProfileId ? { serverProfileId: req.serverProfileId } : {}),
      }),
    });
    const data = (await res.json()) as ServerMetricsSyncResult;
    if (!res.ok || !data.ok) {
      return fail(data.message ?? `server 返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    return fail(`无法连接本地 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 把 server 批量同步结果按 remoteId 转成 core provider 需要的单个指标。 */
export function metricsForRemoteId(
  result: ServerMetricsSyncResult,
  remoteId: string,
): PostMetrics {
  const item = result.results.find((r) => r.remoteId === remoteId);
  if (!item || !item.ok || !item.metrics) return {};
  return { ...item.metrics } as PostMetrics;
}
