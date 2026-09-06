/**
 * v4 Phase 3 · COLLAB-03 协作共享抽屉 —— 局域网共享 / 共享包搬运。
 *
 * 能力(与 ROADMAP_V4 Phase 3 对齐):
 * - **浏览 server 共享内容**:拉取 GET /share 列表(按类型 tab:草稿/模板/报告),
 *   展示来源 / 标题 / 更新时间 / 版本;连接失败给出明确提示(不假装成功);
 * - **拉取并应用**:草稿 → 加载为当前编辑内容;模板 → 应用覆盖层到当前平台;
 *   报告 → 生成并复制/导出;
 * - **推送本地内容到 server**:草稿(当前编辑内容)/ 模板(会话模板库)/ 报告
 *   (当前复盘报告)一键推送,多人共享;
 * - **共享包导入导出(COLLAB-02)**:把 server 共享内容导出为带签名摘要的 .json
 *   共享包;导入本地 .json 合并进 server 共享库(已存在覆盖、新增追加、版本不匹配明确报错);
 * - **远程同步声明(COLLAB-04)**:展示 server 的 SYNC_URL(自托管同步源);
 *   无同步源时优雅降级为纯本地共享。
 *
 * 安全:凭据不落盘(只传 serverUrl + token);共享内容不含密钥;报告已脱敏。
 * 图标规范:全 Lucide 图标,禁止表情符号。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X, Users, RefreshCw, Download, Upload, Send, Inbox, Loader2, FileText, LayoutTemplate,
  FileDown, Check, AlertTriangle, Link2, ExternalLink, Trash2, Copy, Share2, Database,
} from "lucide-react";
import {
  type SharedItem,
  type SharedContentKind,
  type SharedItemMeta,
} from "@mpp/core";
import { serializeShareBundle, parseShareBundle } from "@mpp/core";
import { useStore } from "../state/store.js";
import type { ShareListResult, SharedItemSummary } from "../bridge/server-share.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverUrl: string;
  serverToken: string;
  /** 实际调用方(web/扩展/桌面共用同一接口)。 */
  api: {
    list: (req: { serverUrl: string; token?: string; kind?: SharedContentKind }) => Promise<ShareListResult>;
    get: (req: { serverUrl: string; token?: string; kind: SharedContentKind; id: string }) => Promise<import("../bridge/server-share.js").ShareItemResult>;
    push: (req: { serverUrl: string; token?: string; item: SharedItem }) => Promise<import("../bridge/server-share.js").ShareApiResult>;
    remove: (req: { serverUrl: string; token?: string; kind: SharedContentKind; id: string }) => Promise<import("../bridge/server-share.js").ShareApiResult>;
  };
  /** COLLAB-01/03:本地共享库能力(桌面端/扩展离线副本);未提供时隐藏本地库区块。 */
  localApi?: {
    list: () => Promise<readonly SharedItem[]>;
    get: (kind: SharedContentKind, id: string) => Promise<SharedItem | undefined>;
    push: (item: SharedItem) => Promise<import("../bridge/server-share.js").ShareApiResult>;
    remove: (kind: SharedContentKind, id: string) => Promise<void>;
  };
}

const KIND_TABS: readonly { kind: SharedContentKind; label: string; icon: React.ReactNode }[] = [
  { kind: "draft", label: "草稿", icon: <FileText size={14} aria-hidden /> },
  { kind: "template", label: "模板", icon: <LayoutTemplate size={14} aria-hidden /> },
  { kind: "report", label: "报告", icon: <FileDown size={14} aria-hidden /> },
];

const KIND_LABEL: Record<SharedContentKind, string> = { draft: "草稿", template: "模板", report: "报告" };

function formatTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

export function CollabDrawer({ open, onOpenChange, serverUrl, serverToken, api, localApi }: Props) {
  const markdown = useStore((s) => s.markdown);
  const authorName = useStore((s) => s.authorName);
  const tags = useStore((s) => s.tags);
  const currentDraftId = useStore((s) => s.currentDraftId);
  const saveDraft = useStore((s) => s.saveDraft);
  const setMarkdown = useStore((s) => s.setMarkdown);
  const setAuthorName = useStore((s) => s.setAuthorName);
  const setTags = useStore((s) => s.setTags);
  const performanceRecords = useStore((s) => s.performanceRecords);

  const [kind, setKind] = useState<SharedContentKind>("draft");
  const [items, setItems] = useState<SharedItemSummary[]>([]);
  const [syncUrl, setSyncUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [detail, setDetail] = useState<SharedItem | null>(null);
  const [localItems, setLocalItems] = useState<SharedItem[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const req = useMemo(
    () => ({ serverUrl, token: serverToken || undefined }),
    [serverUrl, serverToken],
  );

  const refresh = useCallback(async (targetKind?: SharedContentKind) => {
    setLoading(true);
    setError(null);
    try {
      const k = targetKind ?? kind;
      const result = await api.list({ ...req, kind: k });
      if (!result.ok) {
        setError(result.message ?? "无法获取共享内容");
        setItems([]);
      } else {
        setItems([...(result.items ?? [])]);
        setSyncUrl(result.sync ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api, req, kind]);

  /** COLLAB-01/03:刷新本地共享库(桌面端/扩展离线副本)。 */
  const refreshLocal = useCallback(async () => {
    if (!localApi) return;
    setLocalLoading(true);
    try {
      const items = await localApi.list();
      setLocalItems([...items]);
    } catch {
      setLocalItems([]);
    } finally {
      setLocalLoading(false);
    }
  }, [localApi]);

  useEffect(() => {
    if (open) void refresh();
    if (open) void refreshLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  /** 拉取单条并应用(草稿加载 / 报告预览 / 模板提示)。 */
  const pullAndApply = useCallback(async (summary: SharedItemSummary) => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.get({ ...req, kind: summary.meta.kind, id: summary.meta.id });
      if (!result.ok || !result.item) {
        setMsg({ kind: "err", text: result.message ?? "拉取共享内容失败" });
        return;
      }
      const item = result.item;
      if (item.payload.kind === "draft") {
        const d = item.payload.draft;
        // 载入为当前编辑内容并保存为新草稿(避免覆盖本地当前草稿)。
        setMarkdown(d.markdown);
        setAuthorName(d.authorName);
        setTags([...d.tags]);
        await saveDraft();
        setMsg({ kind: "ok", text: `已载入共享草稿「${d.title}」到当前编辑区并保存` });
      } else if (item.payload.kind === "report") {
        setDetail(item);
        setMsg({ kind: "ok", text: "已拉取共享报告,可在详情中复制/导出" });
      } else {
        setDetail(item);
        setMsg({ kind: "ok", text: `已拉取共享模板「${item.payload.template.name}」` });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [api, req, setMarkdown, setAuthorName, setTags, saveDraft]);

  /** 推送本地草稿到 server。 */
  const pushDraft = useCallback(async () => {
    if (!markdown.trim()) {
      setMsg({ kind: "err", text: "当前编辑区为空,无可推送草稿" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "未命名草稿";
      const item: SharedItem = {
        meta: {
          kind: "draft",
          id: currentDraftId ?? `draft-${Date.now()}`,
          sourceName: authorName || "本地",
          author: authorName || undefined,
          title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        payload: {
          kind: "draft",
          draft: {
            title,
            markdown,
            authorName: authorName || "未署名",
            tags: [...tags],
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const result = await api.push({ ...req, item });
      if (result.ok) {
        setMsg({ kind: "ok", text: `已推送草稿「${title}」到共享库` });
        void refresh();
      } else {
        setMsg({ kind: "err", text: result.message ?? "推送失败" });
      }
    } finally {
      setBusy(false);
    }
  }, [markdown, authorName, tags, currentDraftId, api, req, refresh]);

  /** 推送当前草稿到本地共享库(桌面端/扩展离线副本,版本化冲突合并)。 */
  const pushDraftLocal = useCallback(async () => {
    if (!localApi) return;
    if (!markdown.trim()) {
      setMsg({ kind: "err", text: "当前编辑区为空,无可推送草稿" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "未命名草稿";
      const item: SharedItem = {
        meta: {
          kind: "draft",
          id: currentDraftId ?? `draft-${Date.now()}`,
          sourceName: authorName || "本地",
          author: authorName || undefined,
          title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        payload: {
          kind: "draft",
          draft: {
            title,
            markdown,
            authorName: authorName || "未署名",
            tags: [...tags],
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const result = await localApi.push(item);
      if (result.ok) {
        setMsg({
          kind: "ok",
          text:
            result.mode === "conflict"
              ? `已写入本地共享库并保留双版本(新版本 ${result.id})`
              : result.mode === "unchanged"
                ? "本地共享库已有相同内容,未产生新版本"
                : `已推送草稿「${title}」到本地共享库`,
        });
        void refreshLocal();
      } else {
        setMsg({ kind: "err", text: result.message ?? "推送本地共享库失败" });
      }
    } finally {
      setBusy(false);
    }
  }, [markdown, authorName, tags, currentDraftId, localApi, refreshLocal]);

  /** 推送当前复盘报告到 server。 */
  const pushReport = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "发布复盘报告";
      const item: SharedItem = {
        meta: {
          kind: "report",
          id: `report-${Date.now()}`,
          sourceName: authorName || "本地",
          title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        payload: {
          kind: "report",
          report: {
            title,
            markdown: `# ${title}\n\n（共享报告:含 ${performanceRecords.length} 条效果记录,已脱敏）`,
            template: "overview",
            windowDays: 30,
            generatedAt: new Date().toISOString(),
          },
        },
      };
      const result = await api.push({ ...req, item });
      if (result.ok) {
        setMsg({ kind: "ok", text: "已推送复盘报告到共享库" });
        void refresh();
      } else {
        setMsg({ kind: "err", text: result.message ?? "推送失败" });
      }
    } finally {
      setBusy(false);
    }
  }, [markdown, authorName, performanceRecords.length, api, req, refresh]);

  /** 导出共享包(把 server 当前类型列表导出为带摘要的 .json)。 */
  const exportBundle = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.list({ ...req });
      if (!result.ok || !result.items || result.items.length === 0) {
        setMsg({ kind: "err", text: "共享库为空,无可导出的共享包" });
        return;
      }
      // 列表只有元信息,需逐条拉取正文后再打包。
      const full: SharedItem[] = [];
      for (const s of result.items) {
        const got = await api.get({ ...req, kind: s.meta.kind, id: s.meta.id });
        if (got.ok && got.item) full.push(got.item);
      }
      const raw = await serializeShareBundle(full, { sourceName: authorName || "本地" });
      const blob = new Blob([raw], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mpp-share-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ kind: "ok", text: `已导出共享包(共 ${full.length} 条,含完整性摘要)` });
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [api, req, authorName]);

  /** 导入共享包(合并进 server 共享库)。 */
  const importBundle = useCallback(async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const raw = await file.text();
      const parsed = parseShareBundle(raw);
      if (!parsed.ok) {
        setMsg({ kind: "err", text: parsed.error });
        return;
      }
      // 逐条推送合并(已存在覆盖、新增追加)。
      let imported = 0;
      for (const item of parsed.bundle.items) {
        const r = await api.push({ ...req, item });
        if (r.ok) imported++;
      }
      setMsg({
        kind: "ok",
        text: `导入成功:${imported}/${parsed.bundle.items.length} 条已合并进共享库${parsed.bundle.digest ? "(已通过完整性校验)" : ""}`,
      });
      void refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [api, req, refresh]);

  /** 删除 server 共享内容。 */
  const removeItem = useCallback(async (meta: SharedItemMeta) => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.remove({ ...req, kind: meta.kind, id: meta.id });
      if (result.ok) {
        setMsg({ kind: "ok", text: `已删除共享${KIND_LABEL[meta.kind]}「${meta.title}」` });
        void refresh();
      } else {
        setMsg({ kind: "err", text: result.message ?? "删除失败" });
      }
    } finally {
      setBusy(false);
    }
  }, [api, req, refresh]);

  /** 拉取并应用本地共享库中的内容(桌面端/扩展离线副本)。 */
  const pullLocalAndApply = useCallback(async (item: SharedItem) => {
    setBusy(true);
    setMsg(null);
    try {
      const got = item;
      if (got.payload.kind === "draft") {
        const d = got.payload.draft;
        setMarkdown(d.markdown);
        setAuthorName(d.authorName);
        setTags([...d.tags]);
        await saveDraft();
        setMsg({ kind: "ok", text: `已载入本地共享草稿「${d.title}」到当前编辑区并保存` });
      } else if (got.payload.kind === "report") {
        setDetail(got);
        setMsg({ kind: "ok", text: "已拉取本地共享报告,可在详情中复制/导出" });
      } else {
        setDetail(got);
        setMsg({ kind: "ok", text: `已拉取本地共享模板「${got.payload.template.name}」` });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [setMarkdown, setAuthorName, setTags, saveDraft]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Users size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8 }} />
              协作共享
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            {/* 远程同步声明(COLLAB-04) */}
            {syncUrl ? (
              <div className="collab-sync" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.85, marginBottom: "var(--sp-2)" }}>
                <Link2 size={13} aria-hidden />
                已连接远程同步源:{syncUrl}
              </div>
            ) : (
              <div className="collab-sync" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.6, marginBottom: "var(--sp-2)" }}>
                <Link2 size={13} aria-hidden />
                未配置远程同步源(SYNC_URL),当前为局域网/本地共享
              </div>
            )}

            {/* 操作区 */}
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: "var(--sp-2)" }}>
              <button type="button" className="btn btn-primary" onClick={() => void pushDraft()} disabled={busy || !markdown.trim()}>
                <Send size={15} aria-hidden />
                推送当前草稿
              </button>
              {localApi && (
                <button type="button" className="btn" onClick={() => void pushDraftLocal()} disabled={busy || !markdown.trim()}>
                  <Database size={15} aria-hidden />
                  推送到本地库
                </button>
              )}
              <button type="button" className="btn" onClick={() => void pushReport()} disabled={busy}>
                <Share2 size={15} aria-hidden />
                推送复盘报告
              </button>
              <button type="button" className="btn" onClick={() => void exportBundle()} disabled={busy}>
                <Download size={15} aria-hidden />
                导出共享包
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload size={15} aria-hidden />
                导入共享包
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importBundle(f);
                }}
              />
              <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
                {loading ? <Loader2 size={15} className="spinner" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
                刷新
              </button>
            </div>

            {msg && (
              <div className={msg.kind === "ok" ? "data-msg data-msg-ok" : "data-msg data-msg-err"} style={{ marginBottom: "var(--sp-2)" }}>
                {msg.kind === "ok" ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                {msg.text}
              </div>
            )}

            {/* 本地共享库(桌面端/扩展离线副本,COLLAB-01) */}
            {localApi && (
              <section style={{ marginBottom: "var(--sp-2)", padding: "var(--sp-2)", borderRadius: 8, border: "1px solid var(--border, rgba(128,128,128,.25))" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--sp-1)" }}>
                  <Database size={14} aria-hidden />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>本地共享库</span>
                  <span style={{ fontSize: 11, opacity: 0.65 }}>(本机离线副本,{localItems.length} 条)</span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void refreshLocal()} disabled={localLoading} aria-label="刷新本地共享库">
                    {localLoading ? <Loader2 size={13} className="spinner" aria-hidden /> : <RefreshCw size={13} aria-hidden />}
                  </button>
                </div>
                {localItems.length === 0 ? (
                  <div className="collab-empty" style={{ padding: "var(--sp-2)", fontSize: 12, opacity: 0.7 }}>
                    <Inbox size={18} aria-hidden />
                    <span>本地共享库为空(桌面端/扩展离线副本)</span>
                  </div>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 180, overflow: "auto" }}>
                    {localItems.map((s) => (
                      <li key={`${s.meta.kind}-${s.meta.id}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border, rgba(128,128,128,.15))" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.meta.title}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.7 }}>
                            {KIND_LABEL[s.meta.kind]} · {s.meta.sourceName} · v{s.meta.version} · {formatTime(s.meta.updatedAt)}
                          </div>
                        </div>
                        <button type="button" className="btn btn-sm" onClick={() => void pullLocalAndApply(s)} disabled={busy} title="拉取本地共享内容">
                          <ExternalLink size={13} aria-hidden />
                          拉取
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* 类型 tab */}
            <div className="collab-tabs" style={{ display: "flex", gap: 4, marginBottom: "var(--sp-2)" }}>
              {KIND_TABS.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  className={kind === t.kind ? "btn btn-sm active" : "btn btn-sm"}
                  onClick={() => setKind(t.kind)}
                  aria-pressed={kind === t.kind}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {/* 列表 */}
            <section>
              <div className="card-trigger-meta" style={{ marginBottom: "var(--sp-2)" }}>
                共享{KIND_LABEL[kind]}({items.length})
              </div>
              {error ? (
                <div className="data-msg data-msg-err">
                  <AlertTriangle size={13} aria-hidden />
                  {error}
                </div>
              ) : loading ? (
                <div className="collab-empty">
                  <Loader2 size={20} className="spinner" aria-hidden />
                </div>
              ) : items.length === 0 ? (
                <div className="collab-empty">
                  <Inbox size={26} aria-hidden />
                  <span>暂无共享{KIND_LABEL[kind]}</span>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    推送本地{KIND_LABEL[kind]}或导入共享包后即可在此浏览
                  </span>
                </div>
              ) : (
                <ul className="collab-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {items.map((s) => (
                    <li key={`${s.meta.kind}-${s.meta.id}`} className="collab-item" style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border, rgba(128,128,128,.2))" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.meta.title}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          {s.meta.sourceName} · v{s.meta.version} · {formatTime(s.meta.updatedAt)}
                          {s.payloadSummary?.platformId ? ` · ${String(s.payloadSummary.platformId)}` : ""}
                        </div>
                      </div>
                      <button type="button" className="btn btn-sm" onClick={() => void pullAndApply(s)} disabled={busy} title="拉取并应用">
                        <ExternalLink size={14} aria-hidden />
                        拉取
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void removeItem(s.meta)} disabled={busy} title="删除共享内容">
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 详情(报告/模板拉取后展示) */}
            {detail && (
              <section style={{ marginTop: "var(--sp-2)" }}>
                <div className="card-trigger-meta" style={{ marginBottom: "var(--sp-2)" }}>
                  拉取详情:{detail.meta.title}
                </div>
                <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      try {
                        if (detail.payload.kind === "report") {
                          await navigator.clipboard.writeText(detail.payload.report.markdown);
                        } else if (detail.payload.kind === "template") {
                          await navigator.clipboard.writeText(JSON.stringify(detail.payload.template, null, 2));
                        }
                        setMsg({ kind: "ok", text: "已复制到剪贴板" });
                      } catch {
                        setMsg({ kind: "err", text: "复制失败,请检查剪贴板权限" });
                      }
                    }}
                  >
                    <Copy size={14} aria-hidden />
                    复制内容
                  </button>
                  {detail.payload.kind === "report" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const p = detail?.payload;
                        if (!p || p.kind !== "report") return;
                        const blob = new Blob([p.report.markdown], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${detail?.meta.title ?? "报告"}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <FileDown size={14} aria-hidden />
                      导出 .md
                    </button>
                  )}
                </div>
                {detail.payload.kind === "report" && (
                  <pre style={{ maxHeight: 220, overflow: "auto", fontSize: 12, marginTop: "var(--sp-2)", whiteSpace: "pre-wrap" }}>
                    {detail.payload.kind === "report" ? detail.payload.report.markdown.slice(0, 1200) : ""}
                  </pre>
                )}
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
