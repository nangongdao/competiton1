/**
 * server 发布任务 REST API 客户端(web/扩展/桌面共用)。
 *
 * 与 server `routes/jobs.ts` 的 REST 契约对应:
 * - GET  /jobs                任务列表
 * - POST /jobs/:id/resume     恢复/续跑
 * - POST /jobs/:id/cancel     取消
 * - POST /jobs/:id/retry      重试平台
 *
 * 鉴权:X-MPP-Token(capability token),由调用方传入。
 */
import type {
  ServerJobApiResult,
  ServerJobRequest,
} from "../bridge/types.js";

function jsonHeaders(req: ServerJobRequest): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.token) headers["X-MPP-Token"] = req.token;
  return headers;
}

/** 请求失败的统一提示(不暴露 token/路径细节)。 */
function fail(message: string): ServerJobApiResult {
  return { ok: false, error: message };
}

export async function fetchServerJobs(req: ServerJobRequest): Promise<ServerJobApiResult> {
  try {
    const res = await fetch(`${req.serverUrl}/jobs`, {
      method: "GET",
      headers: jsonHeaders(req),
    });
    const data = (await res.json()) as ServerJobApiResult;
    if (!res.ok) {
      return fail(data.error ?? `server 返回 ${res.status}`);
    }
    return { ok: true, jobs: data.jobs ?? [] };
  } catch (err) {
    return fail(`无法连接本地 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function postServerJob(
  req: ServerJobRequest & { jobId: string },
  action: "resume" | "cancel" | "retry",
  body?: Record<string, unknown>,
): Promise<ServerJobApiResult> {
  try {
    const res = await fetch(`${req.serverUrl}/jobs/${encodeURIComponent(req.jobId)}/${action}`, {
      method: "POST",
      headers: jsonHeaders(req),
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json()) as ServerJobApiResult;
    if (!res.ok) {
      return fail(data.error ?? `server 返回 ${res.status}`);
    }
    return { ok: true, job: data.job };
  } catch (err) {
    return fail(`无法连接本地 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}
