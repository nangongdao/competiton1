/**
 * 版本历史抽屉 —— 快照时间线 / 差异对比 / 一键回滚。
 *
 * - 时间线:按时间倒序展示当前草稿的版本快照(自动保存 / 手动保存);
 * - 差异对比:选中两个版本后展示字符级 diff(新增高亮 / 删除划线);
 * - 一键回滚:恢复到历史版本(回滚前自动保存当前内容快照,可再回退)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useShallow } from "zustand/react/shallow";
import { X, History, Camera, RotateCcw, GitCompare, Check, Loader2, Inbox, Plus, Minus } from "lucide-react";
import { useStore } from "../state/store.js";
import { formatTime } from "./format.js";
import type { VersionDiff } from "@mpp/core";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryDrawer({ open, onOpenChange }: Props) {
  const versions = useStore((s) => s.versions);
  const currentDraftId = useStore((s) => s.currentDraftId);
  const actions = useStore(
    useShallow((s) => ({
      loadVersions: s.loadVersions,
      saveVersionSnapshot: s.saveVersionSnapshot,
      diffVersion: s.diffVersion,
      restoreVersion: s.restoreVersion,
    })),
  );

  const [baseId, setBaseId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 打开时加载版本列表。
  useEffect(() => {
    if (open) void actions.loadVersions();
  }, [open, currentDraftId, actions]);

  // 打开/草稿变化时重置选择。
  useEffect(() => {
    if (open) {
      setBaseId(null);
      setTargetId(null);
      setDiff(null);
      setMsg(null);
    }
  }, [open, currentDraftId]);

  const selectedIds = useMemo(() => {
    const ids = versions.map((v) => v.id);
    const first = baseId && ids.includes(baseId) ? baseId : ids[0] ?? null;
    const second = targetId && ids.includes(targetId) ? targetId : ids[1] ?? null;
    return { first, second };
  }, [versions, baseId, targetId]);

  // 对比两个版本。
  const runDiff = useCallback(async () => {
    const { first, second } = selectedIds;
    if (!first || !second || first === second) return;
    setDiffLoading(true);
    setDiff(null);
    try {
      const d = await actions.diffVersion(first, second);
      setDiff(d);
    } finally {
      setDiffLoading(false);
    }
  }, [selectedIds, actions]);

  // 回滚到某版本。
  const restore = useCallback(async (id: string) => {
    setRestoring(id);
    setMsg(null);
    const r = await actions.restoreVersion(id);
    setMsg(r.ok ? { kind: "ok", text: "已回滚,可随时再次回退" } : { kind: "err", text: r.error ?? "回滚失败" });
    setRestoring(null);
  }, [actions]);

  const saveSnapshot = useCallback(async () => {
    setMsg(null);
    await actions.saveVersionSnapshot();
  }, [actions]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <History size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              版本历史
            </Dialog.Title>
            <div className="drawer-header-actions">
              <button type="button" className="btn btn-sm" onClick={saveSnapshot} title="保存当前内容为命名快照">
                <Camera size={14} aria-hidden />
                保存快照
              </button>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭">
                  <X size={18} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="drawer-body">
            {msg && (
              <div className={msg.kind === "ok" ? "data-msg data-msg-ok" : "data-msg data-msg-err"}>
                {msg.kind === "ok" ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                {msg.text}
              </div>
            )}

            {!currentDraftId ? (
              <div className="assistant-empty">
                <Inbox size={22} aria-hidden />
                还没有已保存的草稿。编辑内容并自动保存后,这里会记录每次变更快照。
              </div>
            ) : versions.length === 0 ? (
              <div className="assistant-empty">
                <Inbox size={22} aria-hidden />
                暂无版本记录。每次自动保存都会生成快照,也可以点右上角「保存快照」手动标记关键节点。
              </div>
            ) : (
              <>
                <section>
                  <div className="card-trigger-meta" style={{ marginBottom: "var(--sp-2)" }}>
                    版本时间线（{versions.length}）
                  </div>
                  <ul className="version-list">
                    {versions.map((v, idx) => (
                      <li key={v.id} className="version-item">
                        <div className="version-item-head">
                          <span className="version-label">{v.label}</span>
                          <span className="version-time">{formatTime(v.createdAt)}</span>
                        </div>
                        <div className="version-meta">
                          {v.charCount} 字
                          {idx === 0 && <span className="tag tag-ok">最新</span>}
                        </div>
                        <div className="version-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setTargetId(v.id);
                              if (selectedIds.first !== v.id) {
                                // 默认与最新版本对比。
                                setBaseId(versions[0]!.id);
                              }
                            }}
                            aria-label={`对比版本 ${v.id.slice(-6)}`}
                          >
                            <GitCompare size={12} aria-hidden />
                            对比
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void restore(v.id)}
                            disabled={restoring === v.id}
                            aria-label={`回滚到版本 ${v.id.slice(-6)}`}
                          >
                            {restoring === v.id ? <Loader2 size={12} className="spinner" aria-hidden /> : <RotateCcw size={12} aria-hidden />}
                            回滚
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <div className="card-trigger-meta" style={{ marginBottom: "var(--sp-2)" }}>
                    版本对比
                  </div>
                  <div className="version-diff-controls">
                    <select
                      className="field-input"
                      value={selectedIds.first ?? ""}
                      onChange={(e) => setBaseId(e.target.value)}
                      aria-label="对比基准版本"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} · {formatTime(v.createdAt)}
                        </option>
                      ))}
                    </select>
                    <span className="version-diff-arrow" aria-hidden>
                      →
                    </span>
                    <select
                      className="field-input"
                      value={selectedIds.second ?? ""}
                      onChange={(e) => setTargetId(e.target.value)}
                      aria-label="对比目标版本"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} · {formatTime(v.createdAt)}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void runDiff()} disabled={diffLoading || selectedIds.first === selectedIds.second} aria-label="运行版本对比">
                      {diffLoading ? <Loader2 size={13} className="spinner" aria-hidden /> : <GitCompare size={13} aria-hidden />}
                      对比
                    </button>
                  </div>
                  {diff && (
                    <DiffView diff={diff} />
                  )}
                </section>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 字符级 diff 渲染:新增绿底高亮、删除红底划线。 */
function DiffView({ diff }: { diff: VersionDiff }) {
  if (diff.identical) {
    return <div className="version-diff-identical">两个版本内容一致，无差异。</div>;
  }
  return (
    <div className="version-diff">
      <div className="version-diff-summary">
        <span className="version-diff-added">
          <Plus size={12} aria-hidden />
          +{diff.added}
        </span>
        <span className="version-diff-removed">
          <Minus size={12} aria-hidden />
          -{diff.removed}
        </span>
      </div>
      <div className="version-diff-body">
        {diff.ops.map((op, idx) => {
          if (op.type === "equal") {
            return <span key={idx} className="diff-equal">{op.text}</span>;
          }
          if (op.type === "insert") {
            return <span key={idx} className="diff-insert">{op.text}</span>;
          }
          return <span key={idx} className="diff-delete">{op.text}</span>;
        })}
      </div>
    </div>
  );
}
