/**
 * 平台一键连接抽屉 —— 一键自动连接每个平台的接口并解析账号信息。
 *
 * 能力(对应 core `platform-api` 注册表):
 * - 展示每个平台的能力/端点/凭据字段(一键解析接口说明);
 * - 点「一键连接」:公众号走 server(官方 API),知乎/B站/小红书/掘金/CSDN 走 runner
 *   (浏览器登录态/官方接口);
 * - 连接结果展示脱敏账号信息与解析字段。
 *
 * 安全:密钥类凭据只在本组件内存中,不写入 localStorage/提交文件。
 */
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plug, Loader2, CheckCircle2, XCircle, KeyRound, Info, X } from "lucide-react";
import { listPlatformApis } from "@mpp/core";
import type { PlatformBridge, PlatformConnectResult } from "../bridge/types.js";
import { useStore } from "../state/store.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bridge: PlatformBridge | null;
  serverUrl: string;
  serverToken: string;
  runnerUrl: string;
  runnerToken: string;
}

/** 平台 → 走哪个本地服务(与 bridge/connect.ts 路由一致)。 */
const RUNNER_PLATFORM_IDS = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"] as const;

/** 平台展示元信息(排序 + 颜色)。 */
const PLATFORM_META: Record<string, { color: string; icon: string }> = {
  wechat: { color: "#07c160", icon: "微" },
  zhihu: { color: "#0084ff", icon: "知" },
  bilibili: { color: "#fb7299", icon: "B" },
  xiaohongshu: { color: "#ff2442", icon: "红" },
  juejin: { color: "#1e80ff", icon: "掘" },
  cnblogs: { color: "#005a9c", icon: "博" },
  csdn: { color: "#fc5531", icon: "C" },
  weibo: { color: "#e6162d", icon: "微" },
  toutiao: { color: "#fe2c55", icon: "头" },
  douyin: { color: "#161823", icon: "抖" },
  kuaishou: { color: "#ff4906", icon: "快" },
  shipinhao: { color: "#fa9d3b", icon: "视" },
};

/** 平台一键连接抽屉(懒加载组件)。 */
export function PlatformConnectDrawer({ open, onOpenChange, bridge, serverUrl, serverToken, runnerUrl, runnerToken }: Props) {
  const apis = useMemo(() => listPlatformApis(), []);
  // 连接状态:platformId → { checking, result, credentials }。
  const [states, setStates] = useState<Record<string, { checking: boolean; result?: PlatformConnectResult; credentials: Record<string, string> }>>({});
  // 连接历史(全部平台最近一次结果,展示概览)。
  const [history, setHistory] = useState<Record<string, PlatformConnectResult>>({});

  // 打开时重置(每次进入面板重新拉取最新状态)。
  useEffect(() => {
    if (open) setStates({});
  }, [open]);

  const connect = async (platformId: string) => {
    const state = states[platformId] ?? { credentials: {} };
    setStates((prev) => ({ ...prev, [platformId]: { ...state, checking: true } }));
    try {
      const isRunner = (RUNNER_PLATFORM_IDS as readonly string[]).includes(platformId);
      // ACCOUNT-03:连接按当前账号路由(会话平台带浏览器 profile,公众号带 server profile 引用)。
      const account = useStore.getState().accountFor(platformId);
      const result = await bridge?.connectPlatform?.({
        baseUrl: isRunner ? runnerUrl : serverUrl,
        token: isRunner ? runnerToken : serverToken,
        platformId,
        credentials: state.credentials,
        ...(account?.profileDir ? { profileDir: account.profileDir } : {}),
        ...(account?.serverProfileId ? { serverProfileId: account.serverProfileId } : {}),
      });
      const final = result ?? {
        ok: false,
        platformId,
        message: "当前环境不支持平台连接接口",
        at: new Date().toISOString(),
      };
      // ACCOUNT-04:连接成功后回写账号昵称(供账号列表展示,脱敏)。
      if (final.ok && final.account?.name && account) {
        void useStore
          .getState()
          .saveAccount({
            id: account.id,
            platformId: account.platformId,
            name: account.name,
            lastAccountName: final.account.name,
            lastConnectedAt: final.at,
          });
      }
      setHistory((prev) => ({ ...prev, [platformId]: final }));
      setStates((prev) => ({ ...prev, [platformId]: { ...(prev[platformId] ?? { credentials: {} }), checking: false, result: final } }));
    } catch (err) {
      const failed: PlatformConnectResult = {
        ok: false,
        platformId,
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      setHistory((prev) => ({ ...prev, [platformId]: failed }));
      setStates((prev) => ({ ...prev, [platformId]: { ...(prev[platformId] ?? { credentials: {} }), checking: false, result: failed } }));
    }
  };

  // 凭据输入更新(仅内存,不持久化)。
  const setCred = (platformId: string, key: string, value: string) => {
    setStates((prev) => {
      const cur = prev[platformId] ?? { credentials: {} };
      return { ...prev, [platformId]: { ...cur, credentials: { ...cur.credentials, [key]: value } } };
    });
  };

  const connectedCount = Object.values(history).filter((h) => h.ok).length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Plug size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              平台一键连接
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            <div className="platform-connect">
              <div className="platform-connect-summary">
                <span className="tag tag-ok">已连接 {connectedCount}/{apis.length}</span>
                <p>
                  一键自动连接每个平台的接口:公众号走官方 API(server 持凭据),知乎/B站/小红书/掘金/博客园/CSDN
                  走 runner 浏览器登录态/官方接口。连接后自动解析并展示账号信息。
                </p>
              </div>

              <div className="platform-connect-list">
                {apis.map((api) => {
                  const meta = PLATFORM_META[api.descriptor.platformId] ?? { color: "#666", icon: "?" };
                  const state = states[api.descriptor.platformId] ?? { credentials: {} };
                  const historyItem = history[api.descriptor.platformId];
                  const isRunner = (RUNNER_PLATFORM_IDS as readonly string[]).includes(api.descriptor.platformId);
                  const base = isRunner ? runnerUrl : serverUrl;
                  const cap = isRunner ? runnerToken : serverToken;
                  return (
                    <div className="platform-connect-item" key={api.descriptor.platformId}>
                      <div className="platform-connect-item-head">
                        <span className="platform-connect-badge" style={{ backgroundColor: meta.color }} aria-hidden>
                          {meta.icon}
                        </span>
                        <div className="platform-connect-item-title">
                          <strong>{api.descriptor.name}</strong>
                          <span className="platform-connect-capabilities">
                            {api.descriptor.capabilities.map((c) => capLabel(c)).join(" · ")}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={state.checking}
                          onClick={() => void connect(api.descriptor.platformId)}
                          aria-label={`一键连接 ${api.descriptor.name}`}
                        >
                          {state.checking ? (
                            <>
                              <Loader2 size={14} className="spinner" aria-hidden />
                              连接中…
                            </>
                          ) : historyItem?.ok ? (
                            <>
                              <CheckCircle2 size={14} aria-hidden />
                              已连接
                            </>
                          ) : (
                            <>
                              <Plug size={14} aria-hidden />
                              一键连接
                            </>
                          )}
                        </button>
                      </div>

                      {/* 凭据字段(仅公众号/CSDN 需要;会话平台提示浏览器登录) */}
                      {api.descriptor.credentials.length > 0 && (
                        <div className="platform-connect-creds">
                          {api.descriptor.credentials.map((field) =>
                            field.key === "session" ? (
                              <small key={field.key} className="field-hint" style={{ display: "block", marginTop: 6 }}>
                                {field.hint}
                              </small>
                            ) : (
                              <label className="field" key={field.key}>
                                <span className="field-label">
                                  <KeyRound size={12} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                                  {field.label}
                                </span>
                                <input
                                  className="field-input"
                                  type={field.kind === "secret" ? "password" : "text"}
                                  value={state.credentials[field.key] ?? ""}
                                  placeholder={field.placeholder}
                                  onChange={(e) => setCred(api.descriptor.platformId, field.key, e.target.value)}
                                />
                                {field.hint && <small className="field-hint">{field.hint}</small>}
                              </label>
                            ),
                          )}
                        </div>
                      )}

                      {/* 连接结果 */}
                      {historyItem && (
                        <div className={`platform-connect-result ${historyItem.ok ? "ok" : "err"}`}>
                          <span aria-hidden>{historyItem.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}</span>
                          <span>
                            {historyItem.message}
                            {historyItem.account?.name ? `（账号:${historyItem.account.name}）` : ""}
                            {historyItem.latencyMs !== undefined ? `，${historyItem.latencyMs}ms` : ""}
                          </span>
                        </div>
                      )}

                      {/* 端点说明(一键解析接口文档) */}
                      <details className="platform-connect-endpoints">
                        <summary>
                          <Info size={12} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                          查看该平台接口({api.descriptor.endpoints.length})
                        </summary>
                        <ul>
                          {api.descriptor.endpoints.map((ep) => (
                            <li key={ep.name}>
                              <code>
                                {ep.method} {ep.urlTemplate}
                              </code>
                              <span>{ep.description}</span>
                            </li>
                          ))}
                        </ul>
                      </details>

                      <small className="platform-connect-base">
                        连接地址:{base} · 鉴权:token {cap ? "已配置" : "未配置"}
                      </small>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function capLabel(c: string): string {
  switch (c) {
    case "check":
      return "一键连接";
    case "publish":
      return "真实发布";
    case "metrics":
      return "效果同步";
    default:
      return c;
  }
}
