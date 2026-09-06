/**
 * v4 Phase 2 · WEEKLY-03 周报投递客户端 —— 转发到本地 server /weekly/send。
 *
 * 与 server `routes/weekly.ts` 的 REST 契约对应:
 * - POST /weekly/send { report, title, deliveries[] } (X-MPP-Token 鉴权)
 * - 凭据不落盘:前端只传渠道目标(邮箱 / Webhook URL),密钥由 server 持有。
 */
import type { WeeklyDeliveryKind } from "@mpp/core";

export interface WeeklySendRequest {
  readonly serverUrl: string;
  /** 本机 capability token(X-MPP-Token)。 */
  readonly token?: string;
  readonly report: string;
  readonly title?: string;
  readonly deliveries: readonly { kind: WeeklyDeliveryKind; target?: string; label?: string }[];
}

export interface WeeklySendItemResult {
  readonly kind: WeeklyDeliveryKind;
  readonly ok: boolean;
  readonly message: string;
}

export interface WeeklySendResult {
  readonly ok: boolean;
  readonly allDelivered: boolean;
  readonly configured: boolean;
  readonly results: readonly WeeklySendItemResult[];
  readonly message?: string;
}

/** 请求失败的统一提示(不暴露 token/路径细节)。 */
function fail(message: string): WeeklySendResult {
  return { ok: false, allDelivered: false, configured: false, results: [], message };
}

/** 调用 server 投递周报(多渠道)。 */
export async function sendWeeklyViaServer(req: WeeklySendRequest): Promise<WeeklySendResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(`${req.serverUrl.replace(/\/+$/, "")}/weekly/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        report: req.report,
        title: req.title ?? "内容周报",
        deliveries: req.deliveries,
      }),
    });
    const data = (await res.json()) as WeeklySendResult;
    if (!res.ok || !data) {
      return fail(data?.message ?? `server 返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    return fail(`无法连接本地 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}
