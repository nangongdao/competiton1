/**
 * 账号矩阵分组管理抽屉(v11 BRAND-01) —— 多平台账号集中管理。
 *
 * 能力:
 * - 按品牌 / 业务线对账号分组(一个账号可属多个分组);
 * - 分组视图:成员数 / 启用数 / 近期表现聚合(总阅读 / 总点赞 / 最佳平台);
 * - 新建 / 重命名 / 删除分组;成员增删;
 * - 全矩阵总览:每个分组的快照 + 全部账号的分组归属。
 *
 * 数据来源:store.accounts(账号)+ store.accountGroups(分组)+ store.performanceRecords(表现)。
 * 纯展示组件,动作由 store 注入。全 Lucide 图标。
 */
import { useCallback, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutGrid,
  X,
  Plus,
  Trash2,
  Pencil,
  Check,
  Users,
  TrendingUp,
  Loader2,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import {
  buildGroupMatrix,
  createAccountGroup,
  type AccountGroup,
} from "@mpp/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_COLORS = ["#7c6cff", "#22d3ee", "#fb7299", "#fbbf24", "#3fb950", "#f85149"];

export function BrandMatrixDrawer({ open, onOpenChange }: Props) {
  const accounts = useStore((s) => s.accounts);
  const accountGroups = useStore((s) => s.accountGroups);
  const performanceRecords = useStore((s) => s.performanceRecords);
  const actions = useStore(
    useShallow((s) => ({
      loadAccountGroups: s.loadAccountGroups,
      saveAccountGroup: s.saveAccountGroup,
      deleteAccountGroup: s.deleteAccountGroup,
      setGroupMember: s.setGroupMember,
      reorderAccountGroups: s.reorderAccountGroups,
    })),
  );

  const [editing, setEditing] = useState<AccountGroup | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // BRAND-01 拖动排序:被拖拽分组 id + 悬停目标 id。
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const matrix = useMemo(
    () => buildGroupMatrix(accountGroups, accounts, performanceRecords),
    [accountGroups, accounts, performanceRecords],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const doCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const color = GROUP_COLORS[accountGroups.length % GROUP_COLORS.length];
      const r = await actions.saveAccountGroup(
        createAccountGroup({ name, description: newDesc.trim() || undefined, color }),
      );
      if (r.ok) {
        setNewName("");
        setNewDesc("");
        toast("分组已创建", "success");
      } else {
        toast(r.error ?? "创建失败", "error");
      }
    } finally {
      setBusy(false);
    }
  }, [newName, newDesc, accountGroups.length, actions]);

  const doRename = useCallback(async () => {
    if (!editing) return;
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await actions.saveAccountGroup({ ...editing, name });
      if (r.ok) {
        setEditing(null);
        setNewName("");
        setNewDesc("");
        toast("分组已保存", "success");
      } else {
        toast(r.error ?? "保存失败", "error");
      }
    } finally {
      setBusy(false);
    }
  }, [editing, newName, actions]);

  const doDelete = useCallback(
    async (g: AccountGroup) => {
      if (!window.confirm(`确认删除分组「${g.name}」?分组下的账号不会被删除。`)) return;
      await actions.deleteAccountGroup(g.id);
    },
    [actions],
  );

  const toggleMember = useCallback(
    async (g: AccountGroup, accountId: string, member: boolean) => {
      const r = await actions.setGroupMember(g.id, accountId, member);
      if (r.ok) toast(member ? "已加入分组" : "已移出分组", "success");
      else toast(r.error ?? "操作失败", "error");
    },
    [actions],
  );

  // BRAND-01 拖动排序:把被拖分组移动到目标分组位置(基于当前可见顺序重排并落盘)。
  const doDrop = useCallback(
    (targetId: string) => {
      setDragOverId(null);
      const from = dragGroupId;
      if (!from || from === targetId) {
        setDragGroupId(null);
        return;
      }
      const ids = matrix.map((s) => s.group.id);
      const fromIdx = ids.indexOf(from);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) {
        setDragGroupId(null);
        return;
      }
      const next = [...ids];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      setDragGroupId(null);
      void actions.reorderAccountGroups(next);
    },
    [matrix, dragGroupId, actions],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide brand-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <LayoutGrid size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              账号矩阵分组
            </Dialog.Title>
            <div className="drawer-header-actions">
              <button
                type="button"
                className="btn-icon"
                aria-label="刷新"
                onClick={() => void actions.loadAccountGroups()}
              >
                <Users size={16} aria-hidden />
              </button>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭">
                  <X size={16} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="drawer-body">
            {accounts.length === 0 && (
              <div className="brand-hint">
                当前还没有账号。请先在「账号管理」中创建账号，再按品牌 / 业务线分组。
              </div>
            )}

            {/* 新建分组 */}
            {!editing ? (
              <div className="brand-create">
                <input
                  className="field-input"
                  placeholder="分组名(如:品牌 A / 业务线 B)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className="field-input"
                  placeholder="描述(可选)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || !newName.trim()}
                  onClick={() => void doCreate()}
                >
                  {busy ? <Loader2 size={13} className="spinner" aria-hidden /> : <Plus size={13} aria-hidden />}
                  新建分组
                </button>
              </div>
            ) : (
              <div className="brand-create">
                <input
                  className="field-input"
                  placeholder="分组名"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className="field-input"
                  placeholder="描述(可选)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || !newName.trim()}
                  onClick={() => void doRename()}
                >
                  <Check size={13} aria-hidden /> 保存
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setEditing(null);
                    setNewName("");
                    setNewDesc("");
                  }}
                >
                  <X size={13} aria-hidden /> 取消
                </button>
              </div>
            )}

            {matrix.length === 0 ? (
              <div className="assistant-empty">
                <LayoutGrid size={28} aria-hidden />
                <p>还没有账号分组。输入分组名并点击「新建分组」创建第一个矩阵。</p>
              </div>
            ) : (
              matrix.map((s) => {
                const g = s.group;
                const isOpen = expanded.has(g.id);
                const isDragging = dragGroupId === g.id;
                const isOver = dragOverId === g.id && dragGroupId !== g.id;
                return (
                  <div
                    key={g.id}
                    className={`brand-group${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDragGroupId(g.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", g.id);
                    }}
                    onDragEnd={() => {
                      setDragGroupId(null);
                      setDragOverId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverId(g.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === g.id) setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      doDrop(g.id);
                    }}
                  >
                    <div className="brand-group-head">
                      <span className="brand-group-grip" aria-hidden>
                        <GripVertical size={14} />
                      </span>
                      <button
                        type="button"
                        className="brand-group-toggle"
                        onClick={() => toggleExpanded(g.id)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                      </button>
                      <span
                        className="brand-group-dot"
                        style={{ background: g.color ?? "var(--accent)" }}
                        aria-hidden
                      />
                      <span className="brand-group-name">{g.name}</span>
                      <span className="brand-group-meta">
                        {s.memberCount} 账号 · 启用 {s.enabledCount}
                      </span>
                      <span className="brand-group-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label="编辑分组"
                          onClick={() => {
                            setEditing(g);
                            setNewName(g.name);
                            setNewDesc(g.description ?? "");
                          }}
                        >
                          <Pencil size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label="删除分组"
                          onClick={() => void doDelete(g)}
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </span>
                    </div>

                    {g.description && <div className="brand-group-desc">{g.description}</div>}

                    {s.performance.records > 0 && (
                      <div className="brand-group-perf">
                        <TrendingUp size={12} aria-hidden />
                        总阅读 {s.performance.totalViews} · 总点赞 {s.performance.totalLikes}
                        {s.performance.bestPlatform && (
                          <>
                            {" "}
                            · 最佳平台
                            <span style={{ color: platformColor(s.performance.bestPlatform) }}>
                              {s.performance.bestPlatform}
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    {isOpen && (
                      <div className="brand-group-members">
                        <div className="brand-group-members-label">成员账号</div>
                        {s.accounts.length === 0 && (
                          <div className="brand-member-empty">该分组暂无账号</div>
                        )}
                        {s.accounts.map((a) => (
                          <div key={a.accountId} className="brand-member">
                            <span
                              className="brand-member-platform"
                              style={{ color: platformColor(a.platformId) }}
                            >
                              {a.platformId}
                            </span>
                            <span className="brand-member-name">{a.name}</span>
                            <span className={`brand-member-status ${a.status}`}>
                              {a.status === "enabled" ? "启用" : "停用"}
                            </span>
                            {a.performance && (
                              <span className="brand-member-perf">
                                阅读 {a.performance.totalViews} · 赞 {a.performance.totalLikes}
                              </span>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void toggleMember(g, a.accountId, false)}
                            >
                              <X size={12} aria-hidden /> 移出
                            </button>
                          </div>
                        ))}

                        {/* 候选账号(未在组内) */}
                        <div className="brand-group-members-label">可加入账号</div>
                        {accounts
                          .filter((a) => !g.memberIds.includes(a.id))
                          .map((a) => (
                            <div key={a.id} className="brand-member brand-member-candidate">
                              <span
                                className="brand-member-platform"
                                style={{ color: platformColor(a.platformId) }}
                              >
                                {a.platformId}
                              </span>
                              <span className="brand-member-name">{a.name}</span>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => void toggleMember(g, a.id, true)}
                              >
                                <Plus size={12} aria-hidden /> 加入
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* 全矩阵总览 */}
            {matrix.length > 0 && (
              <div className="brand-matrix-overview">
                <div className="brand-matrix-overview-title">
                  <LayoutGrid size={14} aria-hidden /> 全矩阵总览
                </div>
                <div className="brand-matrix-grid">
                  {matrix.map((s) => (
                    <div key={s.group.id} className="brand-matrix-card">
                      <span className="brand-matrix-card-name">{s.group.name}</span>
                      <span className="brand-matrix-card-meta">{s.memberCount} 账号</span>
                      <span className="brand-matrix-card-perf">
                        阅读 {s.performance.totalViews} · 赞 {s.performance.totalLikes}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
