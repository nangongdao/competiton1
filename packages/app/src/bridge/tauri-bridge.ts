/**
 * TauriBridge —— 桌面端实现(Tauri 2)。
 *
 * 与 web(MockBridge)/扩展(ChromeBridge)共享 PlatformBridge 接口:
 * - 设置:经 Tauri store/fs 落盘前先走 localStorage(与 web 一致的轻量持久化);
 * - 终端:通过 Tauri command(spawn_terminal / write_terminal / close_terminal)与
 *   Rust 侧 portable-pty 子进程会话通信;
 * - 其余(剪贴板/公众号发布/runner/图床)与 web 一致,复用 fetch 到本地服务。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AssistedHandoffRequest,
  AssistedHandoffResult,
  AutomationPublishRequest,
  AutomationPublishResult,
  ClipboardPayload,
  DesktopEventAction,
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

/** 终端输出事件负载(Rust 侧 term://output)。 */
export interface TerminalOutputEvent {
  readonly line: string;
  readonly stream: "stdout" | "stderr";
}

/** 终端退出事件负载(Rust 侧 term://exit 直接推 sessionId 字符串)。 */
export type TerminalExitEvent = string;

/**
 * 可启动的本地服务白名单 —— 与 Rust COMMANDS 常量一一对应。
 * 这里只放“可选本地服务”本身,不开放任意 shell。
 */
export const DESKTOP_TERMINAL_COMMANDS = [
  { id: "server", label: "本地服务 server", exe: "node", hint: "图床 / 公众号官方 API(需先 npm run build:core)" },
  { id: "runner", label: "Playwright runner", exe: "node", hint: "知乎/B站/小红书网页端自动化" },
] as const;

export type DesktopTerminalCommandId = (typeof DESKTOP_TERMINAL_COMMANDS)[number]["id"];

export class TauriBridge implements PlatformBridge {
  readonly env = "desktop" as const;

  /** 订阅终端输出(返回取消函数)。 */
  async onTerminalOutput(handler: (line: string) => void): Promise<UnlistenFn> {
    return listen<TerminalOutputEvent>("term://output", (event) => handler(event.payload.line));
  }

  /** 订阅终端退出。 */
  async onTerminalExit(handler: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<TerminalExitEvent>("term://exit", (event) => handler(event.payload));
  }

  /** 订阅桌面端托盘/全局快捷键触发的功能面板事件(统一 `desktop://app-event` 通道)。 */
  async onDesktopEvent(handler: (action: DesktopEventAction) => void): Promise<UnlistenFn> {
    return listen<string>("desktop://app-event", (event) => {
      const action = event.payload as DesktopEventAction;
      if (
        action === "ai-agent" ||
        action === "calendar" ||
        action === "report" ||
        action === "command-palette" ||
        action === "accounts" ||
        action === "collab" ||
        action === "publish-queue" ||
        action === "publish-batch" ||
        action === "creator-copy" ||
        action === "creator-export" ||
        action === "creator-save" ||
        action === "creator-clear"
      ) {
        handler(action);
      }
    });
  }

  /** 兼容旧事件名:订阅托盘/全局快捷键触发的「AI 自动完成」事件(桌面端)。 */
  async onAiAgent(handler: () => void): Promise<UnlistenFn> {
    return listen("desktop://ai-agent", () => handler());
  }

  /** 启动一个白名单本地服务会话,返回 sessionId。 */
  async spawnTerminal(name: DesktopTerminalCommandId, args: string[] = []): Promise<string> {
    return invoke<string>("spawn_terminal", { req: { name, args } });
  }

  /** 向会话写输入(xterm 按键)。 */
  async writeTerminal(sessionId: string, input: string): Promise<void> {
    await invoke("write_terminal", { sessionId, input });
  }

  /** 关闭会话。 */
  async closeTerminal(sessionId: string): Promise<void> {
    await invoke("close_terminal", { sessionId });
  }

  async writeClipboard(payload: ClipboardPayload): Promise<boolean> {
    try {
      if (payload.html && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([payload.html], { type: "text/html" }),
            "text/plain": new Blob([payload.text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(payload.text);
      }
      return true;
    } catch {
      return false;
    }
  }

  async assistedHandoff(req: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    const ok = await this.writeClipboard(req.clipboard);
    return {
      ok,
      method: ok ? "clipboard" : "failed",
      message: ok
        ? "已复制到剪贴板,请到目标平台编辑器 Ctrl+V 粘贴(桌面端无扩展注入)"
        : "复制失败,请检查剪贴板权限",
    };
  }

  async publishWechat(req: WechatPublishRequest): Promise<WechatPublishResult> {
    try {
      const res = await fetch(`${req.serverUrl}/wechat/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.payload),
      });
      return (await res.json()) as WechatPublishResult;
    } catch (err) {
      return {
        ok: false,
        message: `无法连接本地 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}。可在内置终端启动 server。`,
      };
    }
  }

  async publishAutomation(req: AutomationPublishRequest): Promise<AutomationPublishResult> {
    try {
      const res = await fetch(`${req.runnerUrl}/automation/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: req.platformId,
          mode: req.mode,
          payload: req.payload,
          ...(req.profileDir ? { options: { profileDir: req.profileDir } } : {}),
        }),
      });
      return (await res.json()) as AutomationPublishResult;
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        message: `无法连接本地 Playwright runner(${req.runnerUrl}):${err instanceof Error ? err.message : String(err)}。可在内置终端启动 runner。`,
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

  /** 读取桌面端本地共享库(FileSharedStore 由 Rust 落盘到应用数据目录)。 */
  async readLocalSharedStore(): Promise<string> {
    return invoke<string>("shared_local_read");
  }

  /** 写入桌面端本地共享库(整个 JSON 原子写,与 server FileSharedStore 同格式)。 */
  async writeLocalSharedStore(raw: string): Promise<void> {
    await invoke("shared_local_write", { raw });
  }

  async getSetting(key: string): Promise<string | undefined> {
    return localStorage.getItem(key) ?? undefined;
  }

  async setSetting(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  /** v6 NOTIFY-01:桌面端系统通知(经 Rust show_notification;失败静默)。
   *  @param action 可选:透传给 Rust,点击系统通知后唤起窗口并打开对应面板。
   */
  async showNotification(title: string, body: string, action?: string): Promise<void> {
    try {
      await invoke("show_notification", { title, body, action: action ?? null });
    } catch {
      /* 通知尽力而为,失败不阻塞业务 */
    }
  }
}

/** 运行环境检测:存在 Tauri 全局对象则视为桌面端。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
