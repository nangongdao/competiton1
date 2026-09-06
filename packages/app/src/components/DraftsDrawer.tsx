import * as Dialog from "@radix-ui/react-dialog";
import { X, FilePlus2, Trash2, History, Check, AlertTriangle, FileText, Download, Upload, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import type { Draft, HistoryEntry } from "../storage/draft-store.js";
import { formatTime } from "./format.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drafts: Draft[];
  currentDraftId: string | null;
  history: HistoryEntry[];
  onNew: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  /** DATA-01:导出全部数据为 JSON。 */
  onExport: () => Promise<{ ok: boolean; error?: string }>;
  /** DATA-01:从 JSON 导入。 */
  onImport: (raw: string) => Promise<{ ok: boolean; error?: string; counts?: { drafts: number; history: number } }>;
}

/** 草稿与发布历史抽屉。 */
export function DraftsDrawer({
  open,
  onOpenChange,
  drafts,
  currentDraftId,
  history,
  onNew,
  onLoad,
  onDelete,
  onExport,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setMsg(null);
    const r = await onExport();
    setMsg(r.ok ? { kind: "ok", text: "已导出数据文件" } : { kind: "err", text: r.error ?? "导出失败" });
    setBusy(false);
  };

  const handleImportFile = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const raw = await file.text();
      const r = await onImport(raw);
      if (r.ok) {
        const c = r.counts;
        setMsg({ kind: "ok", text: `导入成功:新增 ${c?.drafts ?? 0} 条草稿、${c?.history ?? 0} 条历史` });
      } else {
        setMsg({ kind: "err", text: r.error ?? "导入失败" });
      }
    } catch {
      setMsg({ kind: "err", text: "读取文件失败" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <FileText size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8 }} />
              草稿与历史
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={onNew}>
                <FilePlus2 size={16} aria-hidden />
                新建草稿
              </button>
              <button type="button" className="btn" onClick={() => void handleExport()} disabled={busy}>
                {busy ? <Loader2 size={15} className="spinner" aria-hidden /> : <Download size={15} aria-hidden />}
                导出数据
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload size={15} aria-hidden />
                导入数据
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportFile(f);
                }}
              />
            </div>
            {msg && (
              <div className={msg.kind === "ok" ? "data-msg data-msg-ok" : "data-msg data-msg-err"}>
                {msg.kind === "ok" ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                {msg.text}
              </div>
            )}

            <section>
              <div className="card-trigger-meta" style={{ marginBottom: "var(--sp-2)" }}>
                草稿（{drafts.length}）
              </div>
              {drafts.length === 0 ? (
                <div className="list-empty">编辑内容会自动存为草稿，刷新不丢失。</div>
              ) : (
                <ul className="draft-list">
                  {drafts.map((d) => (
                    <li key={d.id} className={d.id === currentDraftId ? "draft-item active" : "draft-item"}>
                      <button className="draft-open" onClick={() => onLoad(d.id)} title={d.title}>
                        <span className="draft-title">{d.title || "未命名草稿"}</span>
                        <span className="draft-time">{formatTime(d.updatedAt)}</span>
                      </button>
                      <button className="draft-del" onClick={() => onDelete(d.id)} aria-label={`删除草稿 ${d.title}`}>
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {history.length > 0 && (
              <section>
                <div className="card-trigger-meta" style={{ marginBottom: "var(--sp-2)" }}>
                  <History size={13} aria-hidden />
                  发布历史（{history.length}）
                </div>
                <ul className="history-list">
                  {history.map((h) => (
                    <li key={h.id} className="history-item">
                      <div className="history-head">
                        <span className="history-title">{h.draftTitle}</span>
                        <span className="history-time">{formatTime(h.at)}</span>
                      </div>
                      <div className="history-platforms">
                        {h.platforms.map((p) => (
                          <span key={p.platformId} className={p.ok ? "tag tag-ok" : "tag tag-err"} title={p.message}>
                            {p.ok ? <Check size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
                            {p.platformId}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
