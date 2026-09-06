/**
 * MockBridge —— web 环境实现(普通网页,主演示路径)。
 *
 * 用浏览器原生 API:剪贴板用 navigator.clipboard,设置用 localStorage,
 * 公众号"真实发布"在 web 环境直接走 fetch 到 server(若配置),否则返回提示。
 */
import type {
  AssistedHandoffRequest,
  AssistedHandoffResult,
  AutomationPublishRequest,
  AutomationPublishResult,
  ClipboardPayload,
  PlatformBridge,
  ServerJobApiResult,
  ServerJobRequest,
  UploadAssetRequest,
  UploadAssetResult,
  WechatPublishRequest,
  WechatPublishResult,
} from "./types.js";
import { uploadAssetViaServer } from "./upload.js";
import { fetchServerJobs, postServerJob } from "./server-jobs.js";
import { connectPlatform } from "./connect.js";
import { syncInbox } from "./inbox-sync.js";
import { replyInbox, autoReplyInbox } from "./inbox-reply.js";
import {
  fetchSharedItems,
  fetchSharedItem,
  pushSharedItem as pushSharedItemViaServer,
  deleteSharedItem as deleteSharedItemViaServer,
} from "./server-share.js";

export class MockBridge implements PlatformBridge {
  readonly env = "web" as const;

  async writeClipboard(payload: ClipboardPayload): Promise<boolean> {
    try {
      if (payload.html && typeof ClipboardItem !== "undefined") {
        const item = new ClipboardItem({
          "text/html": new Blob([payload.html], { type: "text/html" }),
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(payload.text);
      }
      return true;
    } catch {
      return false;
    }
  }

  async assistedHandoff(req: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    // web 环境无法注入目标平台编辑器(跨域),只能复制到剪贴板。
    const ok = await this.writeClipboard(req.clipboard);
    return {
      ok,
      method: ok ? "clipboard" : "failed",
      message: ok
        ? "已复制到剪贴板,请到目标平台编辑器 Ctrl+V 粘贴(web 环境不支持自动注入,需用扩展)"
        : "复制失败,请检查浏览器剪贴板权限",
    };
  }

  async publishWechat(req: WechatPublishRequest): Promise<WechatPublishResult> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (req.token) headers["X-MPP-Token"] = req.token;
      const res = await fetch(`${req.serverUrl}/wechat/publish`, {
        method: "POST",
        headers,
        body: JSON.stringify(req.payload),
      });
      const data = (await res.json()) as { ok: boolean; message: string; remoteId?: string };
      return data;
    } catch (err) {
      return {
        ok: false,
        message: `无法连接本地 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}。请先启动 server 包。`,
      };
    }
  }

  async publishAutomation(req: AutomationPublishRequest): Promise<AutomationPublishResult> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (req.token) headers["X-MPP-Token"] = req.token;
      const res = await fetch(`${req.runnerUrl}/automation/publish`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          platformId: req.platformId,
          mode: req.mode,
          payload: req.payload,
          ...(req.contentDigest ? { contentDigest: req.contentDigest } : {}),
          ...(req.confirmed !== undefined ? { confirmed: req.confirmed } : {}),
          ...(req.profileDir ? { options: { profileDir: req.profileDir } } : {}),
        }),
      });
      return (await res.json()) as AutomationPublishResult;
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        message: `无法连接本地 Playwright runner(${req.runnerUrl}):${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async uploadAsset(req: UploadAssetRequest): Promise<UploadAssetResult> {
    return uploadAssetViaServer(req);
  }

  async listServerJobs(req: ServerJobRequest): Promise<ServerJobApiResult> {
    return fetchServerJobs(req);
  }
  async resumeServerJob(req: ServerJobRequest & { jobId: string }): Promise<ServerJobApiResult> {
    return postServerJob(req, "resume");
  }
  async cancelServerJob(req: ServerJobRequest & { jobId: string }): Promise<ServerJobApiResult> {
    return postServerJob(req, "cancel");
  }
  async retryServerJob(req: ServerJobRequest & { jobId: string; platformId?: string }): Promise<ServerJobApiResult> {
    return postServerJob(req, "retry", req.platformId ? { platformId: req.platformId } : {});
  }

  async connectPlatform(req: import("./types.js").PlatformConnectRequest): Promise<import("./types.js").PlatformConnectResult> {
    return connectPlatform(req);
  }

  async syncInbox(req: import("./inbox-sync.js").InboxSyncBridgeRequest): Promise<import("./inbox-sync.js").InboxSyncBridgeResult> {
    return syncInbox(req);
  }

  async replyInbox(req: import("./inbox-reply.js").InboxReplyBridgeRequest): Promise<import("./inbox-reply.js").InboxReplyBridgeResult> {
    return replyInbox(req);
  }

  async autoReplyInbox(req: import("./inbox-reply.js").InboxAutoReplyBridgeRequest): Promise<import("./inbox-reply.js").InboxAutoReplyBridgeResult> {
    return autoReplyInbox(req);
  }

  async listSharedItems(req: import("./types.js").ServerJobRequest & { kind?: import("@mpp/core").SharedContentKind }): Promise<import("./server-share.js").ShareListResult> {
    return fetchSharedItems(req.serverUrl, req.token, req.kind);
  }
  async getSharedItem(req: import("./types.js").ServerJobRequest & { kind: import("@mpp/core").SharedContentKind; id: string }): Promise<import("./server-share.js").ShareItemResult> {
    return fetchSharedItem(req.serverUrl, req.token, req.kind, req.id);
  }
  async pushSharedItem(req: import("./types.js").ServerJobRequest & { item: import("@mpp/core").SharedItem }): Promise<import("./server-share.js").ShareApiResult> {
    return pushSharedItemViaServer(req.serverUrl, req.token, req.item);
  }
  async deleteSharedItem(req: import("./types.js").ServerJobRequest & { kind: import("@mpp/core").SharedContentKind; id: string }): Promise<import("./server-share.js").ShareApiResult> {
    return deleteSharedItemViaServer(req.serverUrl, req.token, req.kind, req.id);
  }

  async getSetting(key: string): Promise<string | undefined> {
    return localStorage.getItem(key) ?? undefined;
  }

  async setSetting(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  /** v6 NOTIFY-01:浏览器系统通知(Notification API;不可用/未授权则忽略)。
   *  @param action 可选:点击通知后派发 `mpp:notification-click` 事件,由 App 订阅打开对应面板。
   */
  async showNotification(title: string, body: string, action?: string): Promise<void> {
    try {
      if (typeof Notification === "undefined") return;
      const create = () => {
        const n = new Notification(title, { body });
        if (action) {
          n.onclick = () => {
            try {
              window.dispatchEvent(new CustomEvent("mpp:notification-click", { detail: action }));
              n.close?.();
            } catch {
              /* 忽略 */
            }
          };
        }
      };
      if (Notification.permission === "granted") {
        create();
      } else if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission === "granted") create();
      }
    } catch {
      /* 通知尽力而为,失败不阻塞业务 */
    }
  }
}
