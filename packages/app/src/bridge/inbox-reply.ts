/**
 * 收件箱评论回发客户端 —— INBOX-04 落地(app 侧)。
 *
 * 路由规则(与 server/runner 的 /inbox/reply、/inbox/auto-reply 对应):
 * - wechat → server(官方 comment/reply API,server 持有凭据);
 * - 其余会话平台 → runner(浏览器登录态网页自动化真实回发)。
 *
 * 返回统一回发结果,由 store 落地本地收件箱(handling=auto-replied / replied)。
 */
import type { InboxMessage } from "@mpp/core";

export interface InboxReplyBridgeRequest {
  readonly baseUrl: string;
  /** 本机 capability token。 */
  readonly token?: string;
  readonly platformId: string;
  /** 要回复的本地收件箱消息(承载 remoteId / 作者 / 文本等)。 */
  readonly message: InboxMessage;
  /** 回发内容。 */
  readonly text: string;
  /** 公众号 server profile 引用(多账号路由)。 */
  readonly serverProfileId?: string;
  /** 会话平台浏览器登录 profile 目录名。 */
  readonly profileDir?: string;
}

export interface InboxReplyBridgeResult {
  readonly ok: boolean;
  readonly platformId: string;
  readonly messageId?: string;
  readonly remoteReplyId?: string;
  readonly error?: string;
  readonly at: string;
}

/** 批量自动回复请求(单平台一次回发多条)。 */
export interface InboxAutoReplyBridgeRequest {
  readonly baseUrl: string;
  readonly token?: string;
  readonly platformId: string;
  readonly messages: readonly InboxMessage[];
  readonly limit?: number;
  readonly serverProfileId?: string;
  /** INBOX-06:自动回复策略配置(预设/模板/去重/时效窗口)。 */
  readonly policy?: import("@mpp/core").AutoReplyPolicy;
}

export interface InboxAutoReplyBridgeResult {
  readonly ok: boolean;
  readonly platformId: string;
  readonly planned: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: readonly { messageId: string; error: string }[];
  readonly results?: readonly unknown[];
  readonly error?: string;
  readonly at: string;
}

/** 需要转发到 runner 的会话平台(与 inbox-sync.ts 的 RUNNER_PLATFORM_IDS 对齐)。 */
const RUNNER_PLATFORM_IDS = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"] as const;

function fail(platformId: string, message: string): InboxReplyBridgeResult {
  return { ok: false, platformId, error: message, at: new Date().toISOString() };
}

/** 单条评论真实回发。 */
export async function replyInbox(req: InboxReplyBridgeRequest): Promise<InboxReplyBridgeResult> {
  const isRunner = (RUNNER_PLATFORM_IDS as readonly string[]).includes(req.platformId);
  const base = req.baseUrl.replace(/\/+$/, "");
  const url = `${base}/inbox/reply`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platformId: req.platformId,
        message: req.message,
        text: req.text,
        ...(req.serverProfileId ? { serverProfileId: req.serverProfileId } : {}),
        ...(req.profileDir ? { profileDir: req.profileDir } : {}),
      }),
    });
    const data = (await res.json()) as InboxReplyBridgeResult & { error?: string };
    if (!res.ok || data.ok === false) {
      return fail(req.platformId, data.error ?? `回发服务返回 ${res.status}`);
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

/** 批量自动回复真实回发(单平台)。 */
export async function autoReplyInbox(req: InboxAutoReplyBridgeRequest): Promise<InboxAutoReplyBridgeResult> {
  const isRunner = (RUNNER_PLATFORM_IDS as readonly string[]).includes(req.platformId);
  const base = req.baseUrl.replace(/\/+$/, "");
  const url = `${base}/inbox/auto-reply`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platformId: req.platformId,
        messages: req.messages,
        ...(req.limit ? { limit: req.limit } : {}),
        ...(req.serverProfileId ? { serverProfileId: req.serverProfileId } : {}),
        ...(req.policy ? { policy: req.policy } : {}),
      }),
    });
    const data = (await res.json()) as InboxAutoReplyBridgeResult & { error?: string };
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        platformId: req.platformId,
        planned: 0,
        sent: 0,
        skipped: 0,
        failed: [],
        error: data.error ?? `自动回复服务返回 ${res.status}`,
        at: new Date().toISOString(),
      };
    }
    return data;
  } catch (err) {
    const service = isRunner ? "runner" : "server";
    return {
      ok: false,
      platformId: req.platformId,
      planned: 0,
      sent: 0,
      skipped: 0,
      failed: [],
      error: `无法连接本地 ${service}(${req.baseUrl}):${err instanceof Error ? err.message : String(err)}。请先在设置/终端启动 ${service}。`,
      at: new Date().toISOString(),
    };
  }
}
