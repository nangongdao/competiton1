/**
 * ROADMAP_V5 Phase 3 · ASSET-02 资产库抽屉 —— 封面/图床/平台产物/草稿快照统一视图。
 *
 * 能力(与 ROADMAP_V5 Phase 3 对齐):
 * - **按类型浏览**:封面 / 图床 / 平台产物 / 草稿快照 四类 tab;
 * - **检索**:本地确定性检索(标题/平台/引用加权评分,离线可用);
 * - **复制引用 / 下载**:图床 URL 一键复制;dataURL 短哈希展示;平台产物远端 URL 打开;
 * - **删除**:移除不再需要的资产记录(仅删索引,不影响草稿/任务本身);
 * - **手动录入**:可手工登记一条资产(如外链封面、图床 URL);
 * - **一键重建索引**:从草稿 / 发布队列 / 发布批次增量构建封面与图床索引。
 *
 * 约束(延续路线图):索引不含密钥/凭据;dataURL 只存短哈希不落完整二进制;
 * 删除仅移除本地索引,不删除草稿/任务/远端资源。
 * 图标规范:全 Lucide 图标,无表情符号。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  RefreshCw,
  Search,
  Copy,
  Trash2,
  Plus,
  Link2,
  Image,
  FileText,
  Layers,
  Clock,
  Loader2,
  Check,
  AlertTriangle,
  Database,
  Download,
} from "lucide-react";
import { ASSET_KIND_LABELS, type AssetLibraryKind } from "@mpp/core";
import { useStore, type AssetHitPublic } from "../state/store.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KIND_TABS: readonly { kind: AssetLibraryKind; label: string; icon: React.ReactNode }[] = [
  { kind: "cover", label: "封面", icon: <Image size={14} aria-hidden /> },
  { kind: "rehost", label: "图床", icon: <Link2 size={14} aria-hidden /> },
  { kind: "artifact", label: "平台产物", icon: <Layers size={14} aria-hidden /> },
  { kind: "snapshot", label: "草稿快照", icon: <Clock size={14} aria-hidden /> },
];

const ALL_KINDS: readonly AssetLibraryKind[] = ["cover", "rehost", "artifact", "snapshot"];

function formatTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function sourceLabel(source: { from: string }): string {
  switch (source.from) {
    case "draft":
      return "草稿";
    case "job":
      return "发布任务";
    case "batch":
      return "发布批次";
    case "queue":
      return "发布队列";
    case "manual":
      return "手工录入";
    default:
      return source.from;
  }
}

export function AssetLibraryDrawer({ open, onOpenChange }: Props) {
  const assetLibrary = useStore((s) => s.assetLibrary);
  const assetLibraryReady = useStore((s) => s.assetLibraryReady);
  const lastAssetIndex = useStore((s) => s.lastAssetIndex);
  const loadAssetLibrary = useStore((s) => s.loadAssetLibrary);
  const rebuildAssetIndex = useStore((s) => s.rebuildAssetIndex);
  const searchAssets = useStore((s) => s.searchAssets);
  const addAsset = useStore((s) => s.addAsset);
  const removeAsset = useStore((s) => s.removeAsset);

  const [kind, setKind] = useState<AssetLibraryKind | "all">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addKind, setAddKind] = useState<AssetLibraryKind>("rehost");
  const [addTitle, setAddTitle] = useState("");
  const [addPlatform, setAddPlatform] = useState("");
  const [addRef, setAddRef] = useState("");

  const refresh = useCallback(async () => {
    await loadAssetLibrary();
  }, [loadAssetLibrary]);

  useEffect(() => {
    if (open) {
      void refresh();
      setQuery("");
      setMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doRebuild = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await rebuildAssetIndex();
      if (result.ok) {
        setMsg({ kind: "ok", text: "资产索引已重建(新增/更新/忽略见上方统计)" });
      } else {
        setMsg({ kind: "err", text: result.error ?? "重建索引失败" });
      }
    } finally {
      setBusy(false);
    }
  }, [rebuildAssetIndex]);

  const copyRef = useCallback(
    async (reference: string) => {
      try {
        await navigator.clipboard.writeText(reference);
        toast("已复制引用", "success");
      } catch {
        toast("复制失败,请检查剪贴板权限", "error");
      }
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      await removeAsset(id);
    },
    [removeAsset],
  );

  const doAdd = useCallback(async () => {
    if (!addTitle.trim() || !addRef.trim()) {
      setMsg({ kind: "err", text: "请填写标题与引用" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const result = await addAsset({
        kind: addKind,
        title: addTitle.trim(),
        platformId: addPlatform.trim() || undefined,
        reference: addRef.trim(),
      });
      if (result.ok) {
        setMsg({ kind: "ok", text: "已手动录入资产" });
        setAdding(false);
        setAddTitle("");
        setAddPlatform("");
        setAddRef("");
        void refresh();
      } else {
        setMsg({ kind: "err", text: result.error ?? "录入失败" });
      }
    } finally {
      setBusy(false);
    }
  }, [addKind, addTitle, addPlatform, addRef, addAsset, refresh]);

  /** 按类型过滤 + 检索后的展示列表。 */
  const visible = useMemo<readonly AssetHitPublic[]>(() => {
    const records = kind === "all" ? assetLibrary : assetLibrary.filter((r) => r.kind === kind);
    if (!query.trim()) {
      return records.map((record) => ({ record, score: 1 }));
    }
    return searchAssets(query, kind === "all" ? undefined : kind);
  }, [assetLibrary, kind, query, searchAssets]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Database size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              内容资产库
            </Dialog.Title>
            <div className="drawer-header-actions">
              <button type="button" className="btn-icon" aria-label="刷新" onClick={() => void refresh()}>
                <RefreshCw size={16} aria-hidden />
              </button>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭">
                  <X size={18} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="drawer-body">
            <div className="assistant-fact-summary">
              封面 / 图床 / 平台产物 / 草稿快照统一索引与检索。索引不含密钥,dataURL 只存短哈希,不落完整二进制。
            </div>

            {/* 操作区 */}
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: "var(--sp-2)" }}>
              <button type="button" className="btn btn-primary" onClick={() => void doRebuild()} disabled={busy}>
                {busy ? <Loader2 size={15} className="spinner" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
                重建索引
              </button>
              <button type="button" className="btn" onClick={() => setAdding((v) => !v)} disabled={busy}>
                <Plus size={15} aria-hidden />
                手动录入
              </button>
              {!assetLibraryReady && (
                <span style={{ fontSize: 12, opacity: 0.7 }}>(资产库存储不可用)</span>
              )}
            </div>

            {lastAssetIndex && (
              <div className="data-msg data-msg-ok" style={{ marginBottom: "var(--sp-2)" }}>
                <Check size={13} aria-hidden />
                上次索引:新增 {lastAssetIndex.added} · 更新 {lastAssetIndex.updated} · 忽略 {lastAssetIndex.ignored} · 共 {lastAssetIndex.total} 条
              </div>
            )}
            {msg && (
              <div className={msg.kind === "ok" ? "data-msg data-msg-ok" : "data-msg data-msg-err"} style={{ marginBottom: "var(--sp-2)" }}>
                {msg.kind === "ok" ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                {msg.text}
              </div>
            )}

            {/* 手动录入表单 */}
            {adding && (
              <div className="scheduler-form" style={{ marginBottom: "var(--sp-2)" }}>
                <div className="drift-section-label">手动录入资产</div>
                <label className="scheduler-field">
                  <span>类型</span>
                  <select value={addKind} onChange={(e) => setAddKind(e.target.value as AssetLibraryKind)}>
                    {ALL_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ASSET_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="scheduler-field">
                  <span>标题</span>
                  <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="例如:AI 写作指南封面" />
                </label>
                <label className="scheduler-field">
                  <span>平台(可选,如 wechat / zhihu)</span>
                  <input value={addPlatform} onChange={(e) => setAddPlatform(e.target.value)} placeholder="留空 = 通用" />
                </label>
                <label className="scheduler-field">
                  <span>引用(URL / 文本)</span>
                  <input value={addRef} onChange={(e) => setAddRef(e.target.value)} placeholder="https://… 或任意引用文本" />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => void doAdd()} disabled={busy}>
                  {busy ? <Loader2 size={14} className="spinner" aria-hidden /> : <Plus size={14} aria-hidden />}
                  保存资产
                </button>
              </div>
            )}

            {/* 检索 */}
            <div style={{ position: "relative", marginBottom: "var(--sp-2)" }}>
              <Search size={14} aria-hidden style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", opacity: 0.6 }} />
              <input
                className="field-input"
                style={{ paddingLeft: 28 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="检索资产(标题 / 平台 / 引用)…"
                aria-label="检索资产"
              />
            </div>

            {/* 类型 tab */}
            <div className="collab-tabs" style={{ display: "flex", gap: 4, marginBottom: "var(--sp-2)" }}>
              <button
                type="button"
                className={kind === "all" ? "btn btn-sm active" : "btn btn-sm"}
                onClick={() => setKind("all")}
                aria-pressed={kind === "all"}
              >
                全部
              </button>
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
            <div className="drift-section-label" style={{ marginTop: 8 }}>
              {kind === "all" ? "全部资产" : ASSET_KIND_LABELS[kind]}({visible.length})
            </div>
            {visible.length === 0 ? (
              <div className="assistant-empty">
                <Database size={26} aria-hidden />
                <span>暂无{kind === "all" ? "资产" : ASSET_KIND_LABELS[kind]}</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>点击「重建索引」从草稿/队列/批次生成,或手动录入</span>
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {visible.map(({ record, score }) => (
                  <li
                    key={record.id}
                    style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid var(--border, rgba(128,128,128,.15))" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {record.title}
                        {record.kind === "cover" && <span style={{ opacity: 0.6, marginLeft: 6 }}>(封面)</span>}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.75, wordBreak: "break-all", marginTop: 2 }}>
                        {record.reference.startsWith("data:") ? record.reference : record.reference.length > 80 ? `${record.reference.slice(0, 80)}…` : record.reference}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                        {ASSET_KIND_LABELS[record.kind]} · {record.platformId ?? "通用"} · {sourceLabel(record.source)}
                        {record.bytes !== undefined && ` · ${(record.bytes / 1024).toFixed(1)} KB`}
                        {record.mime && ` · ${record.mime}`}
                        {score < 1 && ` · 相关 ${score}`}
                        {record.metrics?.views !== undefined && ` · 阅读 ${record.metrics.views}`}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>{formatTime(record.updatedAt)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {record.refKind === "url" && (
                        <a
                          className="btn btn-sm"
                          href={record.reference.startsWith("http") ? record.reference : "#"}
                          target={record.reference.startsWith("http") ? "_blank" : undefined}
                          rel="noreferrer"
                          title="打开引用"
                        >
                          <Download size={13} aria-hidden />
                        </a>
                      )}
                      <button type="button" className="btn btn-sm" onClick={() => void copyRef(record.reference)} title="复制引用">
                        <Copy size={13} aria-hidden />
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove(record.id)} title="删除资产(仅本地索引)">
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 12 }}>
              <FileText size={12} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
              删除仅移除本地索引,不影响草稿 / 任务 / 远端资源。
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
