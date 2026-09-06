/**
 * 统一收件箱抽屉(v11 INBOX-01/02/03) —— 互动与私信聚合 + 真实平台消息同步。
 *
 * 能力:
 * - 把多平台评论 / 私信 / @提及 / 通知收敛为一视图;
 * - 按平台 / 类型 / 状态 / 关键词过滤 + 按时间倒序(置顶优先);
 * - 会话聚合(同平台+作者)、待跟进摘要、未读统计;
 * - 状态流转:标记已读 / 回复 / 归档 / 关闭 / 批量操作 / 置顶;
 * - **真实平台消息同步(INBOX-03)**:一键拉取各平台评论/私信并增量合并(去重);
 *   已配置本地 server/runner 时走真实接口,否则回退到规则版演示适配器闭环;
 * - 支持手工录入模拟一条收件箱消息(便于演示与测试);
 * - 评论营销引擎标注(意图 / 情绪 / 高意向 / 自动回复文案)直接展示。
 *
 * 纯展示组件:数据来自 store 的 inboxMessages,动作回调由 store 注入。
 * 图标规范:全 Lucide 图标,禁止表情符号。
 */
import { useCallback, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Inbox,
  X,
  RefreshCw,
  MessageCircle,
  Send,
  AtSign,
  Bell,
  Check,
  Archive,
  Trash2,
  Reply,
  Loader2,
  AlertTriangle,
  Sparkles,
  Plus,
  Search,
  CheckCheck,
  Pin,
  PinOff,
  CloudDownload,
  GripVertical,
} from "lucide-react";
import {
  queryInbox,
  groupByThread,
  buildInboxDigest,
  summarizeInbox,
  markMessageRead,
  recordReply,
  analyzeCommentRule,
  type InboxMessage,
  type InboxMessageKind,
} from "@mpp/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 消息类型展示名。 */
const KIND_LABEL: Record<InboxMessageKind, string> = {
  comment: "评论",
  "direct-message": "私信",
  mention: "@提及",
  notification: "通知",
};

function KindIcon({ kind }: { kind: InboxMessageKind }) {
  switch (kind) {
    case "direct-message":
      return <Send size={13} aria-hidden />;
    case "mention":
      return <AtSign size={13} aria-hidden />;
    case "notification":
      return <Bell size={13} aria-hidden />;
    default:
      return <MessageCircle size={13} aria-hidden />;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("zh-CN", sameYear ? { month: "2-digit", day: "2-digit" } : undefined);
}

export function InboxDrawer({ open, onOpenChange }: Props) {
  const inboxMessages = useStore((s) => s.inboxMessages);
  const inboxSyncCursors = useStore((s) => s.inboxSyncCursors);
  const inboxSyncing = useStore((s) => s.inboxSyncing);
  const pinnedFollowUpEnabled = useStore((s) => s.pinnedFollowUpEnabled);
  const pinnedFollowUpDigest = useStore((s) => s.pinnedFollowUpDigest);
  const setPinnedFollowUpEnabled = useStore((s) => s.setPinnedFollowUpEnabled);
  const runPinnedFollowUpReminder = useStore((s) => s.runPinnedFollowUpReminder);
  const actions = useStore(
    useShallow((s) => ({
      loadInbox: s.loadInbox,
      upsertInboxMessage: s.upsertInboxMessage,
      batchUpdateInboxMessages: s.batchUpdateInboxMessages,
      removeInboxMessage: s.removeInboxMessage,
      toggleInboxPinned: s.toggleInboxPinned,
      syncInboxFromPlatforms: s.syncInboxFromPlatforms,
      replyInboxMessage: s.replyInboxMessage,
      autoReplyInboxMessages: s.autoReplyInboxMessages,
    })),
  );

  const [filter, setFilter] = useState<{ keyword: string; kind: string; platformId: string; status: string }>({
    keyword: "",
    kind: "all",
    platformId: "all",
    status: "all",
  });
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [adding, setAdding] = useState(false);
  const [newAuthor, setNewAuthor] = useState("");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  // INBOX-05:消息拖动排序(基于当前过滤视图内的可见顺序重排)。
  const [dragMsgId, setDragMsgId] = useState<string | null>(null);
  const [dragOverMsgId, setDragOverMsgId] = useState<string | null>(null);

  const reorderInboxMessages = useStore((s) => s.reorderInboxMessages);

  const refresh = useCallback(async () => {
    await actions.loadInbox();
  }, [actions]);

  // INBOX-03:同步全部已注册平台的消息(真实接口优先,演示适配器兜底)。
  const doSyncAll = useCallback(async () => {
    setBusy(true);
    try {
      const platformIds = [...new Set(inboxMessages.map((m) => m.platformId))];
      // 至少包含当前过滤平台,确保首次同步可触发。
      if (filter.platformId !== "all") platformIds.push(filter.platformId);
      const ids = platformIds.length > 0 ? platformIds : ["wechat", "xiaohongshu", "zhihu", "bilibili", "juejin", "weibo", "douyin"];
      const result = await actions.syncInboxFromPlatforms(ids);
      toast(result.message, result.ok ? "success" : "info");
    } finally {
      setBusy(false);
    }
  }, [actions, inboxMessages, filter.platformId]);

  const summary = useMemo(() => summarizeInbox(inboxMessages), [inboxMessages]);
  const digest = useMemo(() => buildInboxDigest(inboxMessages), [inboxMessages]);
  const platformIds = useMemo(
    () => [...new Set(inboxMessages.map((m) => m.platformId))].sort(),
    [inboxMessages],
  );

  const query = useMemo(
    () =>
      queryInbox(inboxMessages, {
        ...(filter.platformId !== "all" ? { platformIds: [filter.platformId] } : {}),
        ...(filter.kind !== "all" ? { kinds: [filter.kind as InboxMessageKind] } : {}),
        ...(filter.status !== "all"
          ? { statuses: [filter.status as InboxMessage["status"]] }
          : {}),
        ...(filter.keyword ? { keyword: filter.keyword } : {}),
      }),
    [inboxMessages, filter],
  );
  const threads = useMemo(() => groupByThread(query.items), [query.items]);

  // INBOX-05:把被拖消息移动到目标消息位置(基于当前查询视图的可见顺序,落盘 sortOrder)。
  const doDropMsg = useCallback(
    (targetId: string) => {
      setDragOverMsgId(null);
      const from = dragMsgId;
      if (!from || from === targetId) {
        setDragMsgId(null);
        return;
      }
      const ids = query.items.map((m) => m.id);
      const fromIdx = ids.indexOf(from);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) {
        setDragMsgId(null);
        return;
      }
      const next = [...ids];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      setDragMsgId(null);
      void reorderInboxMessages(next);
    },
    [query.items, dragMsgId, reorderInboxMessages],
  );

  const doMarkRead = useCallback(
    async (m: InboxMessage) => {
      if (m.status !== "unread") return;
      await actions.upsertInboxMessage(markMessageRead(m));
    },
    [actions],
  );

  const doReply = useCallback(
    async (m: InboxMessage) => {
      if (!replyText.trim()) return;
      setBusy(true);
      try {
        // INBOX-04:真实回发到平台(配置 server/runner 后),否则降级本地记录。
        const result = await actions.replyInboxMessage(m, replyText);
        if (result.ok) {
          setReplyingId(null);
          setReplyText("");
          toast("已回发到平台并记录", "success");
        } else {
          toast(result.error ?? "回发失败,已保留本地回复记录", "error");
          await actions.upsertInboxMessage(recordReply(m, replyText));
          setReplyingId(null);
          setReplyText("");
        }
      } finally {
        setBusy(false);
      }
    },
    [actions, replyText],
  );

  const doBatch = useCallback(
    async (action: "mark-read" | "archive" | "close") => {
      await actions.batchUpdateInboxMessages(action);
      toast(
        action === "mark-read" ? "已全部标记已读" : action === "archive" ? "已归档" : "已关闭",
        "success",
      );
    },
    [actions],
  );

  const doAdd = useCallback(async () => {
    if (!newAuthor.trim() || !newText.trim()) return;
    setBusy(true);
    try {
      await actions.upsertInboxMessage({
        platformId: filter.platformId !== "all" ? filter.platformId : "wechat",
        remoteId: `manual-${Date.now().toString(36)}`,
        author: newAuthor.trim(),
        text: newText.trim(),
        kind: "comment",
        status: "unread",
      });
      setNewAuthor("");
      setNewText("");
      setAdding(false);
      toast("已加入收件箱", "success");
    } finally {
      setBusy(false);
    }
  }, [actions, newAuthor, newText, filter.platformId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide inbox-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Inbox size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              统一收件箱
            </Dialog.Title>
            <div className="drawer-header-actions">
              <button
                type="button"
                className="btn-icon"
                aria-label="同步平台消息"
                title="同步平台消息(评论/私信,真实接口优先,演示适配器兜底)"
                disabled={busy || inboxSyncing}
                onClick={() => void doSyncAll()}
              >
                {busy || inboxSyncing ? <Loader2 size={16} className="spinner" aria-hidden /> : <CloudDownload size={16} aria-hidden />}
              </button>
              <button type="button" className="btn-icon" aria-label="刷新" onClick={() => void refresh()}>
                <RefreshCw size={16} aria-hidden />
              </button>
              <button type="button" className="btn-icon" aria-label="新增" onClick={() => setAdding((v) => !v)}>
                <Plus size={16} aria-hidden />
              </button>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭">
                  <X size={16} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="inbox-filters">
            <label className="field field-inline inbox-filter-field">
              <span className="field-label">平台</span>
              <select
                className="field-input"
                value={filter.platformId}
                onChange={(e) => setFilter((f) => ({ ...f, platformId: e.target.value }))}
              >
                <option value="all">全部</option>
                {platformIds.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-inline inbox-filter-field">
              <span className="field-label">类型</span>
              <select
                className="field-input"
                value={filter.kind}
                onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value }))}
              >
                <option value="all">全部</option>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-inline inbox-filter-field">
              <span className="field-label">状态</span>
              <select
                className="field-input"
                value={filter.status}
                onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="all">全部</option>
                <option value="unread">未读</option>
                <option value="read">已读</option>
                <option value="replied">已回复</option>
                <option value="closed">已关闭</option>
              </select>
            </label>
            <label className="field field-inline inbox-search">
              <Search size={14} aria-hidden />
              <input
                className="field-input"
                placeholder="搜索作者 / 内容"
                value={filter.keyword}
                onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
              />
            </label>
          </div>

          <div className="inbox-summary">
            <span className="inbox-summary-item">
              共 {summary.total} 条 · 未读 <b>{summary.unread}</b>
            </span>
            <span className="inbox-summary-item">待回复 {summary.pendingReply}</span>
            <span className="inbox-summary-item inbox-summary-negative">
              {summary.negative > 0 && <AlertTriangle size={12} aria-hidden />} 负面 {summary.negative}
            </span>
            {digest.hotThreads.length > 0 && (
              <span className="inbox-summary-item inbox-summary-hot">
                <Sparkles size={12} aria-hidden /> 热会话 {digest.hotThreads.length}
              </span>
            )}
            {Object.keys(inboxSyncCursors).length > 0 && (
              <span className="inbox-summary-item">
                <CloudDownload size={12} aria-hidden /> 已同步 {Object.keys(inboxSyncCursors).length} 平台
              </span>
            )}
            <span className="inbox-summary-item">
              <Bell size={12} aria-hidden /> 置顶跟进
              <button
                type="button"
                className={`btn btn-sm ${pinnedFollowUpEnabled ? "btn-primary" : ""}`}
                title="置顶评论超过 30 分钟未回复时,心跳自动发通知提醒(开启后立即检查一次)"
                onClick={() => {
                  setPinnedFollowUpEnabled(!pinnedFollowUpEnabled);
                  if (!pinnedFollowUpEnabled) {
                    void runPinnedFollowUpReminder(true);
                  }
                }}
              >
                {pinnedFollowUpEnabled ? "已开启" : "已关闭"}
              </button>
              {pinnedFollowUpDigest && pinnedFollowUpDigest.shouldNotify && (
                <span className="inbox-summary-hot" title={pinnedFollowUpDigest.notifyBody}>
                  待跟进 {pinnedFollowUpDigest.items.filter((i) => i.overdue).length}
                </span>
              )}
            </span>
            <span className="inbox-summary-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy || inboxSyncing}
                title="对当前过滤平台未回复消息批量 AI 自动回复(真实回发到平台)"
                onClick={() => {
                  const target = filter.platformId !== "all" ? filter.platformId : platformIds[0];
                  if (!target) {
                    toast("请先选择一个平台(或在过滤器中指定)", "info");
                    return;
                  }
                  void (async () => {
                    setBusy(true);
                    try {
                      const result = await actions.autoReplyInboxMessages(target);
                      toast(result.message, result.ok ? "success" : "info");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                <Sparkles size={13} aria-hidden /> AI 自动回复
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void doBatch("mark-read")}>
                <CheckCheck size={13} aria-hidden /> 全部已读
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void doBatch("archive")}>
                <Archive size={13} aria-hidden /> 归档
              </button>
            </span>
          </div>

          {adding && (
            <div className="inbox-add-form">
              <input
                className="field-input"
                placeholder="作者昵称"
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
              />
              <input
                className="field-input"
                placeholder="消息内容(如:这个多少钱?)"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy || !newAuthor.trim() || !newText.trim()}
                onClick={() => void doAdd()}
              >
                {busy ? <Loader2 size={13} className="spinner" aria-hidden /> : <Plus size={13} aria-hidden />}
                加入收件箱
              </button>
            </div>
          )}

          <div className="drawer-body inbox-body">
            {inboxMessages.length === 0 ? (
              <div className="assistant-empty">
                <Inbox size={28} aria-hidden />
                <p>收件箱为空。可在右上角「新增」手工录入一条模拟消息，或接入平台同步后查看聚合。</p>
              </div>
            ) : query.items.length === 0 ? (
              <div className="assistant-empty">
                <Search size={28} aria-hidden />
                <p>没有符合过滤条件的消息。</p>
              </div>
            ) : (
              threads.map((t) => (
                <div key={t.key} className="inbox-thread">
                  <div className="inbox-thread-head">
                    <span className="inbox-thread-author" style={{ color: platformColor(t.platformId) }}>
                      {t.author}
                    </span>
                    <span className="inbox-thread-meta">
                      {t.platformId} · {t.messageCount} 条
                      {t.unreadCount > 0 && <span className="inbox-thread-unread">未读 {t.unreadCount}</span>}
                    </span>
                  </div>
                  {t.messages.map((m) => {
                    const insight = m.intent ? analyzeCommentRule(m.text) : null;
                    const isDraggingMsg = dragMsgId === m.id;
                    const isOverMsg = dragOverMsgId === m.id && dragMsgId !== m.id;
                    return (
                      <div
                        key={m.id}
                        className={`inbox-msg ${m.status === "unread" ? "unread" : ""}${isDraggingMsg ? " dragging" : ""}${isOverMsg ? " drag-over" : ""}`}
                        draggable
                        onDragStart={(e) => {
                          setDragMsgId(m.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", m.id);
                        }}
                        onDragEnd={() => {
                          setDragMsgId(null);
                          setDragOverMsgId(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverMsgId(m.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverMsgId === m.id) setDragOverMsgId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          doDropMsg(m.id);
                        }}
                      >
                        <div className="inbox-msg-head">
                          <span className="inbox-msg-kind">
                            <GripVertical size={11} className="inbox-msg-grip" aria-hidden />
                            <KindIcon kind={m.kind} />
                            {KIND_LABEL[m.kind]}
                          </span>
                          <span className="inbox-msg-time">{formatTime(m.receivedAt)}</span>
                        </div>
                        <div className="inbox-msg-text">
                          {m.pinned && <Pin size={11} className="inbox-msg-pinned" aria-hidden />}
                          {m.text}
                        </div>
                        {insight && (insight.intent !== "other" || insight.sentiment !== "neutral") && (
                          <div className="inbox-msg-insight">
                            <Sparkles size={11} aria-hidden />
                            意图 {insight.intent} · 情绪 {insight.sentiment}
                            {insight.highIntent && <span className="inbox-badge high">高意向</span>}
                            {insight.needsAttention && <span className="inbox-badge warn">需关注</span>}
                          </div>
                        )}
                        {m.autoReply && (
                          <div className="inbox-msg-autoreply">
                            自动回复建议: {m.autoReply}
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy || m.status === "replied" || m.status === "closed"}
                              title="用建议文案一键真实回发到平台"
                              onClick={() => {
                                if (!m.autoReply) return;
                                void (async () => {
                                  setBusy(true);
                                  try {
                                    const result = await actions.replyInboxMessage(m, m.autoReply!);
                                    if (result.ok) toast("已回发 AI 回复到平台", "success");
                                    else toast(result.error ?? "回发失败", "error");
                                  } finally {
                                    setBusy(false);
                                  }
                                })();
                              }}
                            >
                              <Sparkles size={12} aria-hidden /> 回发
                            </button>
                          </div>
                        )}
                        {m.reply && <div className="inbox-msg-reply">已回复: {m.reply}</div>}
                        <div className="inbox-msg-actions">
                          {m.pinned && <GripVertical size={12} className="inbox-msg-grip" aria-hidden />}
                          {m.status === "unread" && (
                            <button type="button" className="btn btn-sm" onClick={() => void doMarkRead(m)}>
                              <Check size={12} aria-hidden /> 已读
                            </button>
                          )}
                          {m.pinned ? (
                            <button type="button" className="btn btn-sm" onClick={() => void actions.toggleInboxPinned(m.id)}>
                              <PinOff size={12} aria-hidden /> 取消置顶
                            </button>
                          ) : (
                            <button type="button" className="btn btn-sm" onClick={() => void actions.toggleInboxPinned(m.id)}>
                              <Pin size={12} aria-hidden /> 置顶
                            </button>
                          )}
                          {replyingId === m.id ? (
                            <>
                              <input
                                className="field-input field-input-sm"
                                placeholder="回复内容…"
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                disabled={busy || !replyText.trim()}
                                onClick={() => void doReply(m)}
                              >
                                <Reply size={12} aria-hidden /> 提交
                              </button>
                            </>
                          ) : (
                            m.status !== "closed" && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => {
                                  setReplyingId(m.id);
                                  setReplyText("");
                                }}
                              >
                                <Reply size={12} aria-hidden /> 回复
                              </button>
                            )
                          )}
                          {m.status !== "closed" && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void actions.upsertInboxMessage({ ...m, status: "closed" })}
                            >
                              <Archive size={12} aria-hidden /> 关闭
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => void actions.removeInboxMessage(m.id)}
                          >
                            <Trash2 size={12} aria-hidden />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
