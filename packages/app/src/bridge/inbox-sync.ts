/**
 * 收件箱平台消息同步客户端 —— INBOX-03 落地(app 侧)。
 *
 * 路由规则(与 server/runner 的 /inbox/sync 对应):
 * - wechat → server(官方评论接口,server 持有凭据);
 * - 其余平台 → runner(浏览器登录态网页自动化,暂未实现时返回 unsupported 提示)。
 *
 * 返回统一归一化结果(core RemoteInboxItem 数组 + 游标),由 store 走
 * `syncInboxFromPlatform` 去重合并进本地收件箱。
 */
import type { InboxSyncResult, RemoteInboxItem } from "@mpp/core";

export interface InboxSyncBridgeRequest {
  readonly baseUrl: string;
  /** 本机 capability token。 */
  readonly token?: string;
  readonly platformId: string;
  /** 平台侧增量游标(评论最大 id 等;首次为空)。 */
  readonly cursor?: string;
  /** 关联账号(公众号 server profile 引用 / 会话平台 profile 目录)。 */
  readonly accountId?: string;
  /** ACCOUNT-03:公众号 server profile 引用。 */
  readonly serverProfileId?: string;
  /** 单次拉取上限。 */
  readonly limit?: number;
}

export interface InboxSyncBridgeResult extends InboxSyncResult {
  /** 拉取到的远端消息(归一化后,由 store 合并)。 */
  readonly items?: readonly RemoteInboxItem[];
}

/** 需要转发到 runner 的会话平台(其余默认走 server)。 */
const RUNNER_PLATFORM_IDS = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"] as const;

/** 请求失败的统一提示(不暴露 token/路径细节)。 */
function fail(platformId: string, message: string): InboxSyncBridgeResult {
  return {
    ok: false,
    platformId,
    fetched: 0,
    added: 0,
    skipped: 0,
    at: new Date().toISOString(),
    error: message,
  };
}

/** 调用 server/runner 同步平台消息。 */
export async function syncInbox(req: InboxSyncBridgeRequest): Promise<InboxSyncBridgeResult> {
  const isRunner = (RUNNER_PLATFORM_IDS as readonly string[]).includes(req.platformId);
  const base = req.baseUrl.replace(/\/+$/, "");
  const url = `${base}/inbox/sync`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platformId: req.platformId,
        ...(req.cursor ? { cursor: req.cursor } : {}),
        ...(req.accountId ? { accountId: req.accountId } : {}),
        ...(req.serverProfileId ? { serverProfileId: req.serverProfileId } : {}),
        ...(req.limit ? { limit: req.limit } : {}),
      }),
    });
    const data = (await res.json()) as InboxSyncBridgeResult;
    if (!res.ok || data.ok === false) {
      return fail(req.platformId, (data as { error?: string }).error ?? `同步服务返回 ${res.status}`);
    }
    return data;
  } catch (err) {
    const service = isRunner ? "runner" : "server";
    return fail(
      req.platformId,
      `无法连接本地 ${service}(${req.baseUrl}):${err instanceof Error ? err.message : String(err)}。请先在设置/终端启动 ${service}。`,
    );
  }
}
