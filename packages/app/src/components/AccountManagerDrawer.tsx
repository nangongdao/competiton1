/**
 * 账号管理抽屉 —— v4 Phase 1 多账号平台管理(ACCOUNT-04)。
 *
 * 能力:
 * - 按平台分组展示账号列表(名称 / profileDir / serverProfileId / 安全分级徽标);
 * - 新建 / 编辑 / 删除账号;
 * - 切换「当前账号」(全局生效账号)+ 平台级账号选择(每平台独立);
 * - 密钥脱敏输入:默认仅会话保存,显式开启「持久化密钥」才落盘(SEC-04 对齐);
 * - 会话平台可填浏览器 profile 目录名(多账号隔离登录态);公众号可填 server profile 引用。
 *
 * 安全:密钥类输入永远不回显已保存值(只显示占位符);持久化/导出经 stripAccountSecrets 剔除。
 * 图标规范:全 Lucide 图标,禁止表情符号。
 */
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Users,
  X,
  Plus,
  Trash2,
  Pencil,
  Check,
  KeyRound,
  FolderGit2,
  Server,
  Lock,
  Save,
  ChevronDown,
} from "lucide-react";
import { listAdapters } from "@mpp/core";
import type { AccountProfile, NewAccountProfile } from "@mpp/core";
import { accountSecurityLevel } from "@mpp/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../state/store.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 平台展示元信息(Lucide 品牌字母,与 PlatformConnectDrawer 对齐)。 */
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

const PLATFORM_IDS = listAdapters().map((a) => a.id);

/** 账号表单草稿。 */
interface FormState {
  id?: string;
  platformId: string;
  name: string;
  serverProfileId: string;
  profileDir: string;
  secrets: Record<string, string>;
  persistSecrets: boolean;
}

const EMPTY_FORM: FormState = {
  platformId: "wechat",
  name: "",
  serverProfileId: "",
  profileDir: "",
  secrets: {},
  persistSecrets: false,
};

function securityLabel(profile: AccountProfile): { text: string; kind: "session" | "persistent" } {
  const level = accountSecurityLevel(profile);
  return level === "persistent" ? { text: "持久化", kind: "persistent" } : { text: "仅会话", kind: "session" };
}

/** 账号管理抽屉(懒加载组件)。 */
export function AccountManagerDrawer({ open, onOpenChange }: Props) {
  const accounts = useStore((s) => s.accounts);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const accountForPlatform = useStore((s) => s.accountForPlatform);
  const actions = useStore(
    useShallow((s) => ({
      saveAccount: s.saveAccount,
      deleteAccount: s.deleteAccount,
      setActiveAccount: s.setActiveAccount,
      setAccountForPlatform: s.setAccountForPlatform,
    })),
  );

  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const openNew = (platformId: string) => {
    setEditing({ ...EMPTY_FORM, platformId });
  };

  const openEdit = (profile: AccountProfile) => {
    setEditing({
      id: profile.id,
      platformId: profile.platformId,
      name: profile.name,
      serverProfileId: profile.serverProfileId ?? "",
      profileDir: profile.profileDir ?? "",
      secrets: profile.persistSecrets ? { ...profile.secrets } : {},
      persistSecrets: profile.persistSecrets,
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return;
    setSaving(true);
    try {
      const input: NewAccountProfile = {
        id: editing.id,
        platformId: editing.platformId,
        name: editing.name.trim(),
        ...(editing.serverProfileId.trim() ? { serverProfileId: editing.serverProfileId.trim() } : {}),
        ...(editing.profileDir.trim() ? { profileDir: editing.profileDir.trim() } : {}),
        persistSecrets: editing.persistSecrets,
        // 仅会话保存的账号:密钥不进表单(每次从会话内存重新输入)。
        secrets: Object.fromEntries(
          Object.entries(editing.secrets).filter(([, v]) => v.length > 0),
        ),
      };
      const result = await actions.saveAccount(input);
      if (!result.ok) {
        window.alert(result.error ?? "保存失败");
        return;
      }
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("确定删除该账号配置?")) return;
    await actions.deleteAccount(id);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Users size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              账号管理
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            <div className="account-summary">
              <span className="tag tag-ok">账号 {accounts.length} 个</span>
              <p>
                每个平台可保存多套账号配置。公众号走 server 凭据(引用 server profile),知乎/B站/小红书/掘金/博客园/CSDN
                走浏览器登录 profile(独立目录隔离多账号登录态)。密钥默认仅会话保存,不落盘。
              </p>
            </div>

            {/* 全局当前账号 */}
            <div className="account-global">
              <div className="account-global-title">
                <Check size={14} aria-hidden /> 全局当前账号
              </div>
              <select
                className="field"
                value={activeAccountId ?? ""}
                onChange={(e) => actions.setActiveAccount(e.target.value || null)}
                aria-label="全局当前账号"
              >
                <option value="">未指定(每平台取各自账号/默认单账号)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.platformId}
                  </option>
                ))}
              </select>
            </div>

            {/* 按平台分组 */}
            {PLATFORM_IDS.map((pid) => {
              const meta = PLATFORM_META[pid] ?? { color: "#64748b", icon: "P" };
              const items = accounts.filter((a) => a.platformId === pid);
              const platformPick = accountForPlatform[pid];
              return (
                <div className="account-group" key={pid}>
                  <div className="account-group-head">
                    <span className="platform-connect-badge" style={{ backgroundColor: meta.color }} aria-hidden>
                      {meta.icon}
                    </span>
                    <span className="account-group-name">{pid}</span>
                    {items.length > 0 && <span className="tag">启用 {items.filter((a) => a.status === "enabled").length}</span>}
                    <button type="button" className="btn-icon" aria-label={`新建 ${pid} 账号`} onClick={() => openNew(pid)}>
                      <Plus size={16} aria-hidden />
                    </button>
                  </div>

                  {items.length === 0 && !(editing?.platformId === pid) && (
                    <div className="account-empty">暂无账号,点上方 + 新建</div>
                  )}

                  {items.map((a) => {
                    const sec = securityLabel(a);
                    const isPlatformPick = platformPick === a.id;
                    return (
                      <div className={`account-item ${a.status === "disabled" ? "account-item-disabled" : ""}`} key={a.id}>
                        <div className="account-item-main">
                          <div className="account-item-name">
                            {a.name}
                            {isPlatformPick && <span className="tag tag-ok">本平台</span>}
                            {a.status === "disabled" && <span className="tag">停用</span>}
                          </div>
                          <div className="account-item-meta">
                            {a.serverProfileId && (
                              <span className="account-meta-chip">
                                <Server size={12} aria-hidden /> profile:{a.serverProfileId}
                              </span>
                            )}
                            {a.profileDir && (
                              <span className="account-meta-chip">
                                <FolderGit2 size={12} aria-hidden /> dir:{a.profileDir}
                              </span>
                            )}
                            <span className="account-meta-chip">
                              <Lock size={12} aria-hidden /> 密钥{sec.kind === "persistent" ? "已持久化" : "仅会话"}
                            </span>
                          </div>
                        </div>
                        <div className="account-item-actions">
                          {a.status === "enabled" && (
                            <button
                              type="button"
                              className={isPlatformPick ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}
                              onClick={() => actions.setAccountForPlatform(pid, isPlatformPick ? null : a.id)}
                              aria-label={isPlatformPick ? `取消 ${pid} 平台账号选择` : `设为 ${pid} 平台账号`}
                            >
                              {isPlatformPick ? <Check size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                            </button>
                          )}
                          <button type="button" className="btn-icon" aria-label={`编辑 ${a.name}`} onClick={() => openEdit(a)}>
                            <Pencil size={14} aria-hidden />
                          </button>
                          <button type="button" className="btn-icon" aria-label={`删除 ${a.name}`} onClick={() => void remove(a.id)}>
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* 新建/编辑表单 */}
            {editing && (
              <div className="account-form">
                <div className="account-form-title">
                  <Pencil size={14} aria-hidden /> {editing.id ? "编辑账号" : "新建账号"}
                </div>
                <label className="field-label" htmlFor="acct-platform">
                  平台
                </label>
                <select
                  id="acct-platform"
                  className="field"
                  value={editing.platformId}
                  onChange={(e) => setEditing({ ...editing, platformId: e.target.value })}
                  disabled={!!editing.id}
                >
                  {PLATFORM_IDS.map((pid) => (
                    <option key={pid} value={pid}>
                      {pid}
                    </option>
                  ))}
                </select>

                <label className="field-label" htmlFor="acct-name">
                  账号名称
                </label>
                <input
                  id="acct-name"
                  className="field"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="如:主号 / 副号"
                />

                {editing.platformId === "wechat" && (
                  <>
                    <label className="field-label" htmlFor="acct-profile">
                      server profile 引用(公众号凭据)
                    </label>
                    <input
                      id="acct-profile"
                      className="field"
                      value={editing.serverProfileId}
                      onChange={(e) => setEditing({ ...editing, serverProfileId: e.target.value })}
                      placeholder="如:profile-main(对应 server 侧多公众号凭据)"
                    />
                  </>
                )}

                {editing.platformId !== "wechat" && (
                  <>
                    <label className="field-label" htmlFor="acct-dir">
                      浏览器登录 profile 目录
                    </label>
                    <input
                      id="acct-dir"
                      className="field"
                      value={editing.profileDir}
                      onChange={(e) => setEditing({ ...editing, profileDir: e.target.value })}
                      placeholder="如:zhihu-main(仅字母数字.-_,无路径)"
                    />
                  </>
                )}

                <label className="field-label" htmlFor="acct-secret">
                  平台密钥(CSDN Cookie 等,仅会话保存)
                </label>
                <input
                  id="acct-secret"
                  className="field"
                  type="password"
                  value={editing.secrets["secret"] ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, secrets: { ...editing.secrets, secret: e.target.value } })
                  }
                  placeholder={editing.persistSecrets ? "留空表示不修改已保存密钥" : "输入密钥(仅本次会话)"}
                />

                <label className="switch-row">
                  <span>
                    <KeyRound size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                    持久化保存密钥
                    <span className="account-sec-hint">开启后密钥写入本地存储;默认仅会话(SEC-04 对齐)</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={editing.persistSecrets}
                    onChange={(e) => setEditing({ ...editing, persistSecrets: e.target.checked })}
                    aria-label="持久化保存密钥"
                  />
                </label>

                <div className="account-form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void save()}
                    disabled={saving || !editing.name.trim()}
                  >
                    <Save size={14} aria-hidden /> {editing.id ? "保存" : "创建"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
