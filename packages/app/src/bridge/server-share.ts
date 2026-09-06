/**
 * v4 Phase 3 · COLLAB-01/03 共享内容 REST 客户端 —— 转发到本地 server /share/*。
 *
 * 与 server `routes/share.ts` 的 REST 契约对应:
 * - GET    /share?kind=         列表(元信息 + payload 摘要)
 * - GET    /share/:kind/:id     单条(含正文)
 * - POST   /share/:kind/:id     推送/覆盖单条(X-MPP-Token 鉴权)
 * - DELETE /share/:kind/:id     删除单条
 *
 * 设计约束:
 * - 凭据不落盘:前端只传 serverUrl + capability token;
 * - 无同步源时优雅降级:server 返回 sync=null,列表/拉取/推送仍可用。
 */
import type { SharedContentKind, SharedItem } from "@mpp/core";

export interface ShareListResult {
  readonly ok: boolean;
  readonly sync?: string | null;
  readonly items?: readonly SharedItemSummary[];
  readonly message?: string;
}

/** 列表条目(server 返回的元信息 + payload 摘要)。 */
export interface SharedItemSummary {
  readonly meta: SharedItem["meta"];
  readonly payloadSummary: Readonly<Record<string, unknown>>;
}

export interface ShareItemResult {
  readonly ok: boolean;
  readonly item?: SharedItem;
  readonly message?: string;
}

export interface ShareApiResult {
  readonly ok: boolean;
  readonly message?: string;
  /** COLLAB-01 版本化:写入模式(created/updated/conflict/unchanged)。 */
  readonly mode?: "created" | "updated" | "conflict" | "unchanged";
  /** conflict 时新版本实际写入的 id(带 `#v{n}` 后缀)。 */
  readonly id?: string;
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/** 调 server 拉取共享内容列表(可按 kind 过滤)。 */
export async function fetchSharedItems(
  serverUrl: string,
  token: string | undefined,
  kind?: SharedContentKind,
): Promise<ShareListResult> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["X-MPP-Token"] = token;
    const url = kind
      ? `${serverUrl.replace(/\/+$/, "")}/share/${kind}`
      : `${serverUrl.replace(/\/+$/, "")}/share`;
    const res = await fetch(url, { headers });
    const data = (await res.json()) as ShareListResult;
    if (!res.ok || !data.ok) {
      return fail(data.message ?? `server 返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    return fail(`无法连接本地 server(${serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 拉取单条共享内容(含正文)。 */
export async function fetchSharedItem(
  serverUrl: string,
  token: string | undefined,
  kind: SharedContentKind,
  id: string,
): Promise<ShareItemResult> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["X-MPP-Token"] = token;
    const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/share/${kind}/${encodeURIComponent(id)}`, { headers });
    const data = (await res.json()) as ShareItemResult;
    if (!res.ok || !data.ok) {
      return fail(data.message ?? `server 返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    return fail(`无法连接本地 server(${serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 推送/覆盖单条共享内容到 server 共享库。 */
export async function pushSharedItem(
  serverUrl: string,
  token: string | undefined,
  item: SharedItem,
): Promise<ShareApiResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-MPP-Token"] = token;
    const res = await fetch(
      `${serverUrl.replace(/\/+$/, "")}/share/${item.meta.kind}/${encodeURIComponent(item.meta.id)}`,
      { method: "POST", headers, body: JSON.stringify(item) },
    );
    const data = (await res.json()) as ShareApiResult;
    if (!res.ok || !data.ok) {
      return fail(data.message ?? `server 返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    return fail(`无法连接本地 server(${serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 删除 server 共享库中的单条内容。 */
export async function deleteSharedItem(
  serverUrl: string,
  token: string | undefined,
  kind: SharedContentKind,
  id: string,
): Promise<ShareApiResult> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["X-MPP-Token"] = token;
    const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/share/${kind}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    const data = (await res.json()) as ShareApiResult;
    if (!res.ok || !data.ok) {
      return fail(data.message ?? `server 返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    return fail(`无法连接本地 server(${serverUrl}):${err instanceof Error ? err.message : String(err)}`);
  }
}
