import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { listAdapters } from "@mpp/core";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useShallow } from "zustand/react/shallow";
import { Loader2, Send, Sparkles, Check, Inbox, Rocket, ListChecks, CalendarDays, FileDown, Settings2, FileText, Wand2, LayoutTemplate, Radar, CalendarClock, BarChart3, Database, Plug, History, Cable, Search, Activity, SquareTerminal, Users, Share2, SendToBack, Layers, FolderOpen, ShieldCheck, ListTree, Blocks, Focus, LayoutGrid } from "lucide-react";
import { useStore } from "./state/store.js";
import { useTheme } from "./styles/use-theme.js";
import { Toolbar } from "./components/Toolbar.js";
import { PlatformPreview } from "./components/PlatformPreview.js";
import { ImagePicker, PlatformChips, CoverPreview } from "./components/EditorExtras.js";
import { MarkdownToolbar } from "./components/MarkdownToolbar.js";
import { FindReplaceBar } from "./components/FindReplaceBar.js";
import { CreatorQuickActions } from "./components/CreatorQuickActions.js";
import { DocStats } from "./components/DocStats.js";
import { OutlinePanel } from "./components/OutlinePanel.js";
import { SnippetPicker } from "./components/SnippetPicker.js";
import { DocWriteBar } from "./components/DocWriteBar.js";
import {
  indentSelection,
  outdentSelection,
  autoCloseDelimiter,
  toggleBlockQuote,
  toggleBulletList,
  toggleOrderedList,
  handleEnter,
  type EditorInputResult,
} from "./components/editor-input.js";
import { SaveStatus } from "./components/SaveStatus.js";
import { ToastHost } from "./components/ToastHost.js";
import { AuroraCanvas } from "./components/AuroraCanvas.js";
import { CursorGlow } from "./components/CursorGlow.js";
import { IntroOverlay } from "./components/IntroOverlay.js";
import type { CommandItem } from "./components/CommandPalette.js";

// PERF-05:抽屉(设置/草稿/任务)是非首屏重组件,动态导入拆包,延迟加载。
const SettingsDrawer = lazy(() => import("./components/SettingsDrawer.js").then((m) => ({ default: m.SettingsDrawer })));
const DraftsDrawer = lazy(() => import("./components/DraftsDrawer.js").then((m) => ({ default: m.DraftsDrawer })));
const TaskPanel = lazy(() => import("./components/TaskPanel.js").then((m) => ({ default: m.TaskPanel })));
// Phase 5:内容助手/模板/批量审批/平台健康均非首屏组件,懒加载拆包。
const AssistantDrawer = lazy(() => import("./components/AssistantDrawer.js").then((m) => ({ default: m.AssistantDrawer })));
const TemplatesDrawer = lazy(() => import("./components/TemplatesDrawer.js").then((m) => ({ default: m.TemplatesDrawer })));
const BatchDrawer = lazy(() => import("./components/BatchDrawer.js").then((m) => ({ default: m.BatchDrawer })));
const DriftPanel = lazy(() => import("./components/DriftPanel.js").then((m) => ({ default: m.DriftPanel })));
const SchedulerDrawer = lazy(() => import("./components/SchedulerDrawer.js").then((m) => ({ default: m.SchedulerDrawer })));
const VersionHistoryDrawer = lazy(() => import("./components/VersionHistoryDrawer.js").then((m) => ({ default: m.VersionHistoryDrawer })));
const PerformanceDrawer = lazy(() => import("./components/PerformanceDrawer.js").then((m) => ({ default: m.PerformanceDrawer })));
const ServerJobsPanel = lazy(() => import("./components/ServerJobsPanel.js").then((m) => ({ default: m.ServerJobsPanel })));
// 平台一键连接抽屉(懒加载拆包)。
const PlatformConnectDrawer = lazy(() => import("./components/PlatformConnectDrawer.js").then((m) => ({ default: m.PlatformConnectDrawer })));
// AI 自动完成抽屉(懒加载拆包)。
const AutoAgentDrawer = lazy(() => import("./components/AutoAgentDrawer.js").then((m) => ({ default: m.AutoAgentDrawer })));
// AI 连接中心抽屉(Roadmap v2:预设模板 + 多配置管理 + 连通性检测,懒加载拆包)。
const AiConnectDrawer = lazy(() => import("./components/AiConnectDrawer.js").then((m) => ({ default: m.AiConnectDrawer })));
// AI 草稿检索抽屉(Phase D AI-INSIGHT-03:草稿摘要索引 + 本地检索,懒加载拆包)。
const DraftSearchDrawer = lazy(() => import("./components/DraftSearchDrawer.js").then((m) => ({ default: m.DraftSearchDrawer })));
// LLM 调用观测抽屉(AI-ROBUST-03:成本/响应观测,懒加载拆包)。
const LlmTelemetryDrawer = lazy(() => import("./components/LlmTelemetryDrawer.js").then((m) => ({ default: m.LlmTelemetryDrawer })));
// v3:AI 选区操作 / 内容日历 / 复盘报告 / 命令面板(懒加载拆包)。
const SelectionAiBar = lazy(() => import("./components/SelectionAiBar.js").then((m) => ({ default: m.SelectionAiBar })));
const ContentCalendar = lazy(() => import("./components/ContentCalendar.js").then((m) => ({ default: m.ContentCalendar })));
const ReportDrawer = lazy(() => import("./components/ReportDrawer.js").then((m) => ({ default: m.ReportDrawer })));
const CommandPalette = lazy(() => import("./components/CommandPalette.js").then((m) => ({ default: m.CommandPalette })));
// v4 Phase 1:账号管理抽屉(多账号平台管理,懒加载拆包)。
const AccountManagerDrawer = lazy(() => import("./components/AccountManagerDrawer.js").then((m) => ({ default: m.AccountManagerDrawer })));
// v4 Phase 3:协作共享抽屉(局域网共享 + 共享包搬运,懒加载拆包)。
const CollabDrawer = lazy(() => import("./components/CollabDrawer.js").then((m) => ({ default: m.CollabDrawer })));
// ROADMAP_V5 Phase 1:发布队列抽屉(稍后发布 / 定时发布,懒加载拆包)。
const PublishQueueDrawer = lazy(() => import("./components/PublishQueueDrawer.js").then((m) => ({ default: m.PublishQueueDrawer })));
// ROADMAP_V5 Phase 2:发布批次抽屉(一次排队多篇 / 批量复盘,懒加载拆包)。
const PublishBatchDrawer = lazy(() => import("./components/PublishBatchDrawer.js").then((m) => ({ default: m.PublishBatchDrawer })));
// ROADMAP_V5 Phase 3:内容资产库抽屉(封面/图床/产物/快照统一视图,懒加载拆包)。
const AssetLibraryDrawer = lazy(() => import("./components/AssetLibraryDrawer.js").then((m) => ({ default: m.AssetLibraryDrawer })));
// v7 创作工作流:发布前健康检查抽屉(PREFLIGHT,懒加载拆包)。
const PreflightDrawer = lazy(() => import("./components/PreflightDrawer.js").then((m) => ({ default: m.PreflightDrawer })));
// v8 Phase 1/2:运营驾驶舱抽屉(效果趋势/平台对比/内容排行/目标进度/发布健康,懒加载拆包)。
const DashboardDrawer = lazy(() => import("./components/DashboardDrawer.js").then((m) => ({ default: m.DashboardDrawer })));
// v11 Part 1:统一收件箱抽屉(评论/私信/@提及/通知聚合,懒加载拆包)。
const InboxDrawer = lazy(() => import("./components/InboxDrawer.js").then((m) => ({ default: m.InboxDrawer })));
// v11 Part 1:账号矩阵分组抽屉(按品牌/业务线分组管理,懒加载拆包)。
const BrandMatrixDrawer = lazy(() => import("./components/BrandMatrixDrawer.js").then((m) => ({ default: m.BrandMatrixDrawer })));
// v11 Part 2:AI 智能增强工作台(一键裂变/本土化/多媒体AI/评论营销/合规审查,懒加载拆包)。
const AiStudioDrawer = lazy(() => import("./components/AiStudioDrawer.js").then((m) => ({ default: m.AiStudioDrawer })));
import type { TauriBridge } from "./bridge/tauri-bridge.js";

// 内置终端(xterm.js)仅在桌面端需要;React.lazy 确保浏览器/扩展主包不加载它。
const TerminalPanel = lazy(() =>
  import("./components/TerminalPanel.js").then((m) => ({ default: m.TerminalPanel })),
);

const ADAPTERS = listAdapters();

/** 从 Markdown 提取标题(首个 # 行),供导出文件名/草稿标题使用。 */
function titleOf(markdown: string): string {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m?.[1]?.trim() ?? "";
}

export function App() {
  // 分片选择器订阅:按字段取值,避免任一 state 变化重渲染整棵树。
  const markdown = useStore((s) => s.markdown);
  const authorName = useStore((s) => s.authorName);
  const tags = useStore((s) => s.tags);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);
  const results = useStore((s) => s.results);
  const receipts = useStore((s) => s.receipts);
  const publishing = useStore((s) => s.publishing);
  const drafts = useStore((s) => s.drafts);
  const currentDraftId = useStore((s) => s.currentDraftId);
  const history = useStore((s) => s.history);
  const llm = useStore((s) => s.llm);
  const persistLlmKey = useStore((s) => s.persistLlmKey);
  const enhance = useStore((s) => s.enhance);
  const serverUrl = useStore((s) => s.serverUrl);
  const runnerUrl = useStore((s) => s.runnerUrl);
  const serverToken = useStore((s) => s.serverToken);
  const runnerToken = useStore((s) => s.runnerToken);
  const wechatPublishMode = useStore((s) => s.wechatPublishMode);
  const automationModes = useStore((s) => s.automationModes);
  const bridge = useStore((s) => s.bridge);
  const env = useStore((s) => s.bridge?.env);
  const jobs = useStore((s) => s.jobs);
  const activeJobId = useStore((s) => s.activeJobId);
  const wordGoal = useStore((s) => s.wordGoal);
  const typewriterMode = useStore((s) => s.typewriterMode);
  const preflightReport = useStore((s) => s.preflightReport);
  const preflightComputing = useStore((s) => s.preflightComputing);
  const runPreflight = useStore((s) => s.runPreflight);
  // v7 Phase 4:整篇 AI 写作状态。
  const docWriteBusy = useStore((s) => s.docWriteBusy);
  const docWriteResult = useStore((s) => s.docWriteResult);
  const jobPublishing = useStore((s) => s.activeJobId !== null);
  // 行为(action)引用恒定,用 useShallow 一次性取出,不引入额外渲染。
  const actions = useStore(
    useShallow((s) => ({
      setMarkdown: s.setMarkdown,
      setAuthorName: s.setAuthorName,
      setTags: s.setTags,
      togglePlatform: s.togglePlatform,
      insertLocalImage: s.insertLocalImage,
      setLlm: s.setLlm,
      setPersistLlmKey: s.setPersistLlmKey,
      clearLlmKey: s.clearLlmKey,
      setEnhance: s.setEnhance,
      setServerUrl: s.setServerUrl,
      setRunnerUrl: s.setRunnerUrl,
      setServerToken: s.setServerToken,
      setRunnerToken: s.setRunnerToken,
      setWechatPublishMode: s.setWechatPublishMode,
      setAutomationMode: s.setAutomationMode,
      llmReady: s.llmReady,
      adapt: s.adapt,
      publishAll: s.publishAll,
      loadDrafts: s.loadDrafts,
      newDraft: s.newDraft,
      loadDraft: s.loadDraft,
      flushDraft: s.flushDraft,
      saveDraft: s.saveDraft,
      deleteDraft: s.deleteDraft,
      exportData: s.exportData,
      importData: s.importData,
      loadJobs: s.loadJobs,
      createPublishJob: s.createPublishJob,
      loadScheduledTasks: s.loadScheduledTasks,
      runDueScheduledTasks: s.runDueScheduledTasks,
      loadPublishQueue: s.loadPublishQueue,
      runDuePublishQueue: s.runDuePublishQueue,
      loadPublishBatches: s.loadPublishBatches,
      runDuePublishBatches: s.runDuePublishBatches,
      loadAssetLibrary: s.loadAssetLibrary,
      loadPerformance: s.loadPerformance,
      loadVersions: s.loadVersions,
      loadAccounts: s.loadAccounts,
      loadAccountGroups: s.loadAccountGroups,
      loadInbox: s.loadInbox,
      autoFixPreflightIssues: s.autoFixPreflightIssues,
      setWordGoal: s.setWordGoal,
      setTypewriterMode: s.setTypewriterMode,
      runDocWrite: s.runDocWrite,
      insertSnippet: s.insertSnippet,
    })),
  );

  const { mode, cycle } = useTheme();
  const [previewOnly, setPreviewOnly] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [serverJobsOpen, setServerJobsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [autoAgentOpen, setAutoAgentOpen] = useState(false);
  const [aiConnectOpen, setAiConnectOpen] = useState(false);
  const [draftSearchOpen, setDraftSearchOpen] = useState(false);
  const [llmTelemetryOpen, setLlmTelemetryOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [publishQueueOpen, setPublishQueueOpen] = useState(false);
  const [publishBatchOpen, setPublishBatchOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  // v11:统一收件箱 / 账号矩阵分组 / AI 智能增强工作台。
  const [inboxOpen, setInboxOpen] = useState(false);
  const [brandMatrixOpen, setBrandMatrixOpen] = useState(false);
  const [aiStudioOpen, setAiStudioOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  // v7 Phase 4:大纲 / 片段库 / 整篇 AI 写作面板 + 专注写作模式。
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [docWriteOpen, setDocWriteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  // v7 Phase 2:真实发布强制体检确认 —— true 表示由「真实发布」按钮触发,体检通过后确认执行。
  const [realPublishArm, setRealPublishArm] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  // 编辑器 textarea 引用(供 MarkdownToolbar / 快捷键读取选区)。
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // v7 Phase 3:编辑器智能输入辅助 —— Tab 缩进 / Shift+Tab 反缩进、
  // 成对定界符自动补全、列表/引用回车续行(纯函数在 editor-input.ts)。
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const area = editorRef.current;
    if (!area) return;
    const { selectionStart, selectionEnd } = area;
    const cur = markdown;
    let result: EditorInputResult | null = null;

    if (e.key === "Tab") {
      e.preventDefault();
      result = e.shiftKey
        ? outdentSelection(cur, selectionStart, selectionEnd)
        : indentSelection(cur, selectionStart, selectionEnd);
    } else if (e.key === "Enter" && !e.shiftKey) {
      result = handleEnter(cur, selectionStart, selectionEnd);
      if (result) e.preventDefault();
    } else if (e.key === "`" || e.key === "*" || e.key === "~") {
      result = autoCloseDelimiter(cur, selectionStart, selectionEnd, e.key);
      if (result.text !== cur) e.preventDefault();
    } else if (e.key === ">" && e.ctrlKey) {
      e.preventDefault();
      result = toggleBlockQuote(cur, selectionStart, selectionEnd);
    } else if (e.key === "u" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      result = toggleBulletList(cur, selectionStart, selectionEnd);
    } else if (e.key === "o" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      result = toggleOrderedList(cur, selectionStart, selectionEnd);
    }

    if (result) {
      actions.setMarkdown(result.text);
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(result!.selectionStart, result!.selectionEnd);
      });
    }
  };

  // 打字机模式:监听光标位置,更新 --typewriter-line 变量以高亮当前行。
  useEffect(() => {
    const area = editorRef.current;
    if (!area || !typewriterMode) return;
    const updateLine = () => {
      const upTo = area.value.slice(0, area.selectionStart);
      const line = upTo.split(/\n/).length - 1;
      area.style.setProperty("--typewriter-line", String(line));
    };
    updateLine();
    area.addEventListener("keyup", updateLine);
    area.addEventListener("click", updateLine);
    area.addEventListener("input", updateLine);
    return () => {
      area.removeEventListener("keyup", updateLine);
      area.removeEventListener("click", updateLine);
      area.removeEventListener("input", updateLine);
    };
  }, [typewriterMode, markdown]);

  // 全局快捷键:Ctrl/Cmd+S 保存、Ctrl/Cmd+Enter 触发发布、Ctrl/Cmd+Shift+A 打开 AI 自动完成。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      // 避免与抽屉内输入/textarea 的默认行为冲突。
      const tag = target?.tagName;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void actions.saveDraft();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        // Ctrl/Cmd+Enter 在输入框内触发发布(编辑态常用)。
        if (tag === "TEXTAREA" || tag === "INPUT") {
          e.preventDefault();
          void actions.publishAll();
        }
        return;
      }
      if (e.key.toLowerCase() === "a" && e.shiftKey) {
        // 桌面端/网页统一快捷键:打开「AI 自动完成」面板。
        e.preventDefault();
        setAutoAgentOpen(true);
      }
      if (e.key.toLowerCase() === "m" && e.shiftKey) {
        // v4:桌面端/网页统一快捷键 Ctrl/Cmd+Shift+M 打开「账号管理」。
        e.preventDefault();
        setAccountsOpen(true);
      }
      if (e.key.toLowerCase() === "s" && e.shiftKey) {
        // v4 Phase 3:Ctrl/Cmd+Shift+S 打开「协作共享」。
        e.preventDefault();
        setCollabOpen(true);
      }
      if (e.key.toLowerCase() === "b" && e.shiftKey) {
        // v6 Phase 2:Ctrl/Cmd+Shift+B 打开「发布批次」。
        e.preventDefault();
        setPublishBatchOpen(true);
      }
      if (e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        // v3 全局命令面板:Ctrl/Cmd+K 打开。
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if (e.key.toLowerCase() === "f" && !e.shiftKey && !e.altKey) {
        // v7 创作工作流:Ctrl/Cmd+F 唤起编辑器查找/替换(优先于浏览器默认查找)。
        if (tag === "TEXTAREA" || tag === "INPUT") {
          e.preventDefault();
          setFindOpen((v) => !v);
        }
        return;
      }
      if (e.key.toLowerCase() === "o" && e.shiftKey) {
        // v7 Phase 4:Ctrl/Cmd+Shift+O 切换文档大纲。
        e.preventDefault();
        setOutlineOpen((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === "f" && e.shiftKey) {
        // v7 Phase 4:Ctrl/Cmd+Shift+F 切换专注写作模式。
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === "p" && e.shiftKey) {
        // v7 Phase 4:Ctrl/Cmd+Shift+P 切换片段库。
        e.preventDefault();
        setSnippetOpen((v) => !v);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 桌面端:订阅系统托盘 / 全局快捷键触发的功能面板事件(统一 desktop://app-event 分发)。
  useEffect(() => {
    if (!bridge?.onDesktopEvent) return;
    let unlisten: (() => void) | undefined;
    void bridge.onDesktopEvent((action) => {
      // 与 Rust AppEventAction / 托盘菜单项一一对应。
      switch (action) {
        case "ai-agent":
          setAutoAgentOpen(true);
          break;
        case "calendar":
          setCalendarOpen(true);
          break;
        case "report":
          setReportOpen(true);
          break;
        case "command-palette":
          setCommandOpen(true);
          break;
        case "accounts":
          setAccountsOpen(true);
          break;
        case "collab":
          setCollabOpen(true);
          break;
        case "publish-queue":
          setPublishQueueOpen(true);
          break;
        case "publish-batch":
          setPublishBatchOpen(true);
          break;
        // v7 Phase 2:托盘创作快捷操作 —— 与创作快捷操作条(CreatorQuickActions)对齐。
        case "creator-copy":
          void useStore.getState().copyMarkdown();
          break;
        case "creator-export":
          void useStore.getState().exportMarkdown();
          break;
        case "creator-save":
          void useStore.getState().saveDraft();
          break;
        case "creator-clear":
          void useStore.getState().clearMarkdown();
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [bridge]);

  // 兼容旧版 Rust(仍发 desktop://ai-agent 事件)的订阅,避免升级后 AI 自动完成入口失效。
  useEffect(() => {
    if (!bridge?.onAiAgent || bridge.onDesktopEvent) return;
    let unlisten: (() => void) | undefined;
    void bridge.onAiAgent(() => setAutoAgentOpen(true)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [bridge]);

  // v6 Phase 2:Web 通知点击跳转 —— 订阅 `mpp:notification-click`(mock/chrome bridge 在
  // Notification.onclick 中派发,action 为要打开的面板动作,与托盘/全局快捷键共用映射)。
  useEffect(() => {
    const onNotifyClick = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (!action) return;
      // 与 desktop://app-event 分发保持一致。
      switch (action) {
        case "publish-queue":
          setPublishQueueOpen(true);
          break;
        case "publish-batch":
          setPublishBatchOpen(true);
          break;
        case "scheduler":
          setSchedulerOpen(true);
          break;
        case "calendar":
          setCalendarOpen(true);
          break;
        case "performance":
          setPerformanceOpen(true);
          break;
        case "serverjobs":
          setServerJobsOpen(true);
          break;
        case "inbox":
          setInboxOpen(true);
          break;
        case "tasks":
          setTasksOpen(true);
          break;
        case "strategy":
          // v11 深化 GOAL-NOTIFY-01:目标达成预警点击直达运营驾驶舱(内容策略/目标达成预测卡)。
          setDashboardOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("mpp:notification-click", onNotifyClick);
    return () => window.removeEventListener("mpp:notification-click", onNotifyClick);
  }, []);

  // 首次挂载触发一次适配,并加载已存草稿/历史/任务。
  useEffect(() => {
    actions.adapt();
    void actions.loadDrafts();
    void actions.loadJobs();
    void actions.loadScheduledTasks();
    void actions.loadPublishQueue();
    void actions.loadPublishBatches();
    void actions.loadAssetLibrary();
    void actions.loadPerformance();
    void actions.loadVersions();
    void actions.loadAccounts();
    void actions.loadAccountGroups();
    void actions.loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FLOW-03 计划任务心跳:每 60s 检查一次到期任务并执行(机器/登录态在线时)。
  // 只在页面可见(非后台标签页)时 tick,避免后台空转;执行会刷新面板运行记录。
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        void actions.runDueScheduledTasks();
        void actions.runDuePublishQueue();
        void actions.runDuePublishBatches();
        // v10 FOLLOWUP-NOTIFY:开启待跟进提醒时,心跳一并检查(同日不重复)。
        if (useStore.getState().followUpReminderEnabled) {
          void useStore.getState().runFollowUpReminder(false);
        }
        // v11 INBOX-07:开启置顶评论跟进提醒时,心跳一并检查(同日不重复)。
        if (useStore.getState().pinnedFollowUpEnabled) {
          void useStore.getState().runPinnedFollowUpReminder(false);
        }
        // v11 深化 GOAL-NOTIFY-01:开启目标达成提醒时,心跳一并检查(at-risk/off-track 提醒,同日不重复)。
        if (useStore.getState().goalReminderEnabled) {
          void useStore.getState().runGoalReminder(false);
        }
      }
    };
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 编辑后自动保存草稿(防抖 1.2s)。
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!markdown.trim()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void actions.saveDraft(), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, authorName, tags]);

  // v7 创作工作流:编辑器有未保存修改时,刷新/关闭页面弹出原生确认提示。
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().editorDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const ready = actions.llmReady();
  const aiEnabled = ready && (enhance.title || enhance.summary || enhance.colloquialize || enhance.rewrite);
  const isDesktop = bridge?.env === "desktop";
  const tauriBridge = isDesktop && bridge ? (bridge as TauriBridge) : null;

  // v7 Phase 4 OUTLINE-01:跟踪编辑器光标所在行(供大纲高亮)。
  const [cursorLine, setCursorLine] = useState(0);
  useEffect(() => {
    const area = editorRef.current;
    if (!area) return;
    const update = () => {
      const upTo = area.value.slice(0, area.selectionStart);
      setCursorLine(upTo.split(/\n/).length - 1);
    };
    update();
    area.addEventListener("keyup", update);
    area.addEventListener("click", update);
    area.addEventListener("input", update);
    return () => {
      area.removeEventListener("keyup", update);
      area.removeEventListener("click", update);
      area.removeEventListener("input", update);
    };
  }, [markdown]);

  // v3:全局命令面板命令集合(打开各功能抽屉 + 常用文档动作)。
  const commandItems: CommandItem[] = [
    { id: "calendar", label: "内容日历", hint: "月历聚合草稿/任务/发布/效果", keywords: "日历 calendar 计划 发布 效果", icon: CalendarDays, run: () => setCalendarOpen(true) },
    { id: "report", label: "发布复盘报告", hint: "效果回收 + 策略建议一键导出", keywords: "报告 复盘 report 效果 导出", icon: FileDown, run: () => setReportOpen(true) },
    { id: "drafts", label: "草稿与历史", hint: "管理已保存草稿", keywords: "草稿 drafts 历史", icon: FileText, run: () => setDraftsOpen(true) },
    { id: "settings", label: "设置", hint: "AI 增强 / 服务地址 / 发布模式", keywords: "设置 settings 配置", icon: Settings2, run: () => setSettingsOpen(true) },
    { id: "tasks", label: "发布任务面板", hint: "真实发布任务与状态", keywords: "任务 tasks 发布", icon: ListChecks, run: () => setTasksOpen(true) },
    { id: "assistant", label: "内容助手", hint: "排版建议 / 多方案 / 事实检查", keywords: "助手 assistant 建议 多方案 事实", icon: Wand2, run: () => setAssistantOpen(true) },
    { id: "templates", label: "平台模板", hint: "可复用平台配置模板", keywords: "模板 templates 配置", icon: LayoutTemplate, run: () => setTemplatesOpen(true) },
    { id: "batch", label: "批量与审批", hint: "多草稿批量生成 / AI 自动完成", keywords: "批量 batch 审批 自动完成", icon: ListChecks, run: () => setBatchOpen(true) },
    { id: "drift", label: "平台健康", hint: "能力漂移探测 / conformance", keywords: "健康 drift 漂移 平台", icon: Radar, run: () => setDriftOpen(true) },
    { id: "scheduler", label: "本机计划任务", hint: "定时自动执行任务", keywords: "计划任务 scheduler 定时", icon: CalendarClock, run: () => setSchedulerOpen(true) },
    { id: "publishqueue", label: "发布队列", hint: "稍后发布 / 定时发布队列", keywords: "发布队列 queue 稍后 定时 排队 定时发布", icon: SendToBack, run: () => setPublishQueueOpen(true) },
    { id: "publishbatch", label: "发布批次", hint: "一次排队多篇 / 批量效果回收 / 批次复盘", keywords: "发布批次 batch 批量 多篇 复盘 效果回收", icon: Layers, run: () => setPublishBatchOpen(true) },
    { id: "assetlibrary", label: "内容资产库", hint: "封面 / 图床 / 平台产物 / 草稿快照统一检索", keywords: "资产 资产库 asset 封面 图床 产物 快照 素材", icon: FolderOpen, run: () => setAssetLibraryOpen(true) },
    { id: "inbox", label: "统一收件箱", hint: "评论 / 私信 / @提及 / 通知聚合", keywords: "收件箱 inbox 评论 私信 互动 聚合", icon: Inbox, run: () => setInboxOpen(true) },
    { id: "brandmatrix", label: "账号矩阵分组", hint: "按品牌 / 业务线分组管理账号", keywords: "矩阵 分组 brand 账号 品牌 业务线", icon: LayoutGrid, run: () => setBrandMatrixOpen(true) },
    { id: "aistudio", label: "AI 智能增强", hint: "一键裂变 / 本土化 / 多媒体 AI / 评论营销 / 合规审查", keywords: "AI 增强 裂变 本土化 多媒体 评论营销 合规 工作台", icon: Sparkles, run: () => setAiStudioOpen(true) },
    { id: "performance", label: "发布效果回收", hint: "导入 / 录入 / 官方指标同步", keywords: "效果 performance 回收 指标 分析", icon: BarChart3, run: () => setPerformanceOpen(true) },
    { id: "dashboard", label: "运营驾驶舱", hint: "趋势 / 平台对比 / 内容排行 / 目标进度 / 发布健康", keywords: "驾驶舱 dashboard 趋势 排行 目标 发布健康 分析 图表", icon: BarChart3, run: () => setDashboardOpen(true) },
    { id: "serverjobs", label: "服务器任务", hint: "server 持久化发布任务", keywords: "服务器 server 任务", icon: Database, run: () => setServerJobsOpen(true) },
    { id: "connect", label: "平台一键连接", hint: "各平台 API 连接与解析", keywords: "连接 connect 平台 api", icon: Plug, run: () => setConnectOpen(true) },
    { id: "accounts", label: "账号管理", hint: "多账号平台管理 / 密钥安全分级", keywords: "账号 多账号 account 管理 密钥", icon: Users, run: () => setAccountsOpen(true) },
    { id: "collab", label: "协作共享", hint: "局域网共享 / 共享包导出导入 / 远程同步", keywords: "协作 共享 collab 团队 局域网 共享包 同步", icon: Share2, run: () => setCollabOpen(true) },
    { id: "version", label: "版本历史", hint: "文章快照与回滚", keywords: "版本 version 历史 回滚", icon: History, run: () => setVersionHistoryOpen(true) },
    { id: "autoagent", label: "AI 自动完成", hint: "分析 → 修复 → 增强 → 复核", keywords: "AI 自动完成 agent 增强 改写", icon: Sparkles, run: () => setAutoAgentOpen(true) },
    { id: "aiconnect", label: "AI 连接中心", hint: "预设 / 多配置 / 连通性检测", keywords: "AI 连接 模型 baseurl api key", icon: Cable, run: () => setAiConnectOpen(true) },
    { id: "search", label: "AI 草稿检索", hint: "自然语言检索旧内容", keywords: "检索 search 草稿 AI", icon: Search, run: () => setDraftSearchOpen(true) },
    { id: "telemetry", label: "LLM 调用观测", hint: "成本 / 响应 / 失败率", keywords: "观测 telemetry LLM 成本 调用", icon: Activity, run: () => setLlmTelemetryOpen(true) },
    { id: "newdraft", label: "新建草稿", hint: "清空当前内容开始新草稿", keywords: "新建 草稿 new draft", icon: FileText, run: () => void actions.newDraft() },
    { id: "savedraft", label: "保存草稿", hint: "Ctrl/Cmd+S", keywords: "保存 草稿 save", icon: FileText, run: () => void actions.saveDraft() },
    { id: "export", label: "导出数据", hint: "全部草稿与历史导出 JSON", keywords: "导出 export 数据 备份", icon: FileDown, run: () => void actions.exportData() },
  ];
  if (isDesktop) {
    commandItems.push({
      id: "terminal",
      label: "内置终端",
      hint: "启动 server / runner",
      keywords: "终端 terminal server runner",
      icon: SquareTerminal,
      run: () => setTerminalOpen(true),
    });
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="app">
        <AuroraCanvas />
        <CursorGlow />
        {!introDone && <IntroOverlay onDone={() => setIntroDone(true)} />}

        <Toolbar
          env={env}
          themeMode={mode}
          onCycleTheme={cycle}
          previewOnly={previewOnly}
          onTogglePreviewOnly={() => setPreviewOnly((v) => !v)}
          draftCount={drafts.length}
          onOpenDrafts={() => setDraftsOpen(true)}
          llmReady={ready}
          onOpenSettings={() => setSettingsOpen(true)}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          showTerminal={isDesktop}
          assistantOpen={assistantOpen}
          onOpenAssistant={() => setAssistantOpen(true)}
          templatesOpen={templatesOpen}
          onOpenTemplates={() => setTemplatesOpen(true)}
          batchOpen={batchOpen}
          onOpenBatch={() => setBatchOpen(true)}
          driftOpen={driftOpen}
          onOpenDrift={() => setDriftOpen(true)}
          schedulerOpen={schedulerOpen}
          onOpenScheduler={() => setSchedulerOpen(true)}
          performanceOpen={performanceOpen}
          onOpenPerformance={() => setPerformanceOpen(true)}
          dashboardOpen={dashboardOpen}
          onOpenDashboard={() => setDashboardOpen(true)}
          serverJobsOpen={serverJobsOpen}
          onOpenServerJobs={() => setServerJobsOpen(true)}
          connectOpen={connectOpen}
          onOpenConnect={() => setConnectOpen(true)}
          versionHistoryOpen={versionHistoryOpen}
          onOpenVersionHistory={() => setVersionHistoryOpen(true)}
          autoAgentOpen={autoAgentOpen}
          onOpenAutoAgent={() => setAutoAgentOpen(true)}
          aiConnectOpen={aiConnectOpen}
          onOpenAiConnect={() => setAiConnectOpen(true)}
          draftSearchOpen={draftSearchOpen}
          onOpenDraftSearch={() => setDraftSearchOpen(true)}
          llmTelemetryOpen={llmTelemetryOpen}
          onOpenLlmTelemetry={() => setLlmTelemetryOpen(true)}
          calendarOpen={calendarOpen}
          onOpenCalendar={() => setCalendarOpen(true)}
          reportOpen={reportOpen}
          onOpenReport={() => setReportOpen(true)}
          commandOpen={commandOpen}
          onOpenCommand={() => setCommandOpen(true)}
          accountsOpen={accountsOpen}
          onOpenAccounts={() => setAccountsOpen(true)}
          collabOpen={collabOpen}
          onOpenCollab={() => setCollabOpen(true)}
          publishQueueOpen={publishQueueOpen}
          onOpenPublishQueue={() => setPublishQueueOpen(true)}
          publishBatchOpen={publishBatchOpen}
          onOpenPublishBatch={() => setPublishBatchOpen(true)}
          assetLibraryOpen={assetLibraryOpen}
          onOpenAssetLibrary={() => setAssetLibraryOpen(true)}
          inboxOpen={inboxOpen}
          onOpenInbox={() => setInboxOpen(true)}
          brandMatrixOpen={brandMatrixOpen}
          onOpenBrandMatrix={() => setBrandMatrixOpen(true)}
          aiStudioOpen={aiStudioOpen}
          onOpenAiStudio={() => setAiStudioOpen(true)}
        />

        <div className={previewOnly || focusMode ? (focusMode ? "workspace preview-only focus-mode" : "workspace preview-only") : "workspace"}>
          {/* 左栏:编辑 */}
          <section className="editor-pane" aria-label="编辑区">
            <div className="editor-meta">
              <div className="editor-section-title">文档信息</div>
              <div className="editor-meta-fields">
                <label className="field">
                  <span className="field-label">作者</span>
                  <input
                    className="field-input"
                    value={authorName}
                    onChange={(e) => actions.setAuthorName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">标签（逗号分隔）</span>
                  <input
                    className="field-input"
                    value={tags.join(", ")}
                    onChange={(e) =>
                      actions.setTags(
                        e.target.value
                          .split(/[,，]/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </label>
              </div>
            </div>

            <div className="editor-subtoolbar">
              <span className="editor-subtoolbar-label">编辑工具</span>
              <span className="editor-subtoolbar-right">
                <button
                  type="button"
                  className={`es-btn ${outlineOpen ? "active" : ""}`}
                  onClick={() => setOutlineOpen((v) => !v)}
                  aria-label="文档大纲"
                  aria-pressed={outlineOpen}
                  title="文档大纲 (Ctrl/Cmd+Shift+O)"
                >
                  <ListTree size={13} aria-hidden />
                  大纲
                </button>
                <button
                  type="button"
                  className={`es-btn ${snippetOpen ? "active" : ""}`}
                  onClick={() => setSnippetOpen((v) => !v)}
                  aria-label="Markdown 片段库"
                  aria-pressed={snippetOpen}
                  title="插入常用片段"
                >
                  <Blocks size={13} aria-hidden />
                  片段
                </button>
                <button
                  type="button"
                  className={`es-btn ${docWriteOpen ? "active" : ""}`}
                  onClick={() => setDocWriteOpen((v) => !v)}
                  aria-label="整篇 AI 写作"
                  aria-pressed={docWriteOpen}
                  title="整篇 AI 写作(润色/扩写/续写/摘要)"
                >
                  <Sparkles size={13} aria-hidden />
                  AI 写作
                </button>
                <button
                  type="button"
                  className={`es-btn ${focusMode ? "active" : ""}`}
                  onClick={() => setFocusMode((v) => !v)}
                  aria-label={focusMode ? "退出专注写作" : "专注写作"}
                  aria-pressed={focusMode}
                  title={focusMode ? "退出专注写作 (Ctrl/Cmd+Shift+F)" : "专注写作:隐藏干扰,沉浸创作 (Ctrl/Cmd+Shift+F)"}
                >
                  <Focus size={13} aria-hidden />
                  专注
                </button>
                <SaveStatus />
                <ImagePicker onPick={actions.insertLocalImage} />
              </span>
            </div>

            <div className="editor-body">
              <MarkdownToolbar onApply={actions.setMarkdown} editorRef={editorRef} />
              <Suspense fallback={null}>
                <SelectionAiBar onApply={actions.setMarkdown} editorRef={editorRef} />
              </Suspense>
              {findOpen && (
                <FindReplaceBar
                  text={markdown}
                  editorRef={editorRef}
                  onApply={actions.setMarkdown}
                  onClose={() => setFindOpen(false)}
                />
              )}
              {outlineOpen && (
                <OutlinePanel
                  markdown={markdown}
                  cursorLine={cursorLine}
                  onNavigate={(charIndex) => {
                    // 定位编辑器到对应字符索引。
                    const area = editorRef.current;
                    if (area) {
                      area.focus();
                      area.setSelectionRange(charIndex, charIndex);
                      area.scrollTop = area.scrollHeight;
                    }
                  }}
                  onClose={() => setOutlineOpen(false)}
                />
              )}
              {snippetOpen && (
                <SnippetPicker
                  onInsert={(text) => actions.insertSnippet(text)}
                  onClose={() => setSnippetOpen(false)}
                />
              )}
              {docWriteOpen && (
                <DocWriteBar
                  llmReady={ready}
                  busy={docWriteBusy}
                  lastResult={docWriteResult}
                  onRun={(op) => void actions.runDocWrite(op)}
                  onClose={() => setDocWriteOpen(false)}
                />
              )}
              <textarea
                ref={editorRef}
                className={
                  typewriterMode
                    ? "editor-textarea typewriter"
                    : findOpen
                      ? "editor-textarea find-line-active"
                      : "editor-textarea"
                }
                value={markdown}
                onChange={(e) => actions.setMarkdown(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                placeholder="# 在这里输入标题&#10;&#10;正文支持 Markdown，左侧编辑、右侧实时预览多平台适配效果……"
                aria-label="Markdown 内容"
              />
            </div>

            <div className="editor-stats">
              <DocStats
                markdown={markdown}
                selectedPlatforms={selectedPlatforms}
                wordGoal={wordGoal}
                typewriterMode={typewriterMode}
                onWordGoalChange={actions.setWordGoal}
                onTypewriterModeChange={actions.setTypewriterMode}
              />
            </div>

            <div className="editor-extras">
              <div className="editor-section-title">发布设置</div>
              <PlatformChips
                adapters={ADAPTERS}
                selected={selectedPlatforms}
                onToggle={actions.togglePlatform}
              />
              <CoverPreview markdown={markdown} authorName={authorName} tags={tags} />
            </div>

            <div className="editor-footer">
              <div className="editor-footer-tools">
                <CreatorQuickActions
                  markdown={markdown}
                  draftTitle={titleOf(markdown)}
                  onSave={() => void actions.saveDraft()}
                  onClear={() => actions.setMarkdown("")}
                />
              </div>
              <div className="editor-footer-publish">
              <button className="btn btn-primary btn-lg" disabled={publishing} onClick={() => actions.publishAll()}>
                {publishing ? (
                  <>
                    <Loader2 size={18} className="spinner" aria-hidden />
                    发布中…
                  </>
                ) : aiEnabled ? (
                  <>
                    <Sparkles size={18} aria-hidden />
                    AI 增强并一键模拟发布
                  </>
                ) : (
                  <>
                    <Send size={18} aria-hidden />
                    一键模拟发布
                  </>
                )}
              </button>
              <button
                className="btn btn-secondary btn-lg"
                disabled={jobPublishing}
                onClick={() => {
                  // v7 Phase 2:真实发布前强制弹出健康检查 —— 先体检,再确认后走真实发布。
                  setJobError(null);
                  setRealPublishArm(true);
                  runPreflight();
                  setPreflightOpen(true);
                }}
              >
                {jobPublishing ? (
                  <>
                    <Loader2 size={18} className="spinner" aria-hidden />
                    真实发布中…
                  </>
                ) : (
                  <>
                    <Rocket size={18} aria-hidden />
                    真实发布
                  </>
                )}
              </button>
              <button
                className="btn btn-ghost btn-lg task-toggle"
                onClick={() => {
                  runPreflight();
                  setPreflightOpen(true);
                }}
                aria-label="发布前健康检查"
                title="发布前健康检查"
              >
                <ShieldCheck size={18} aria-hidden />
                发布前检查
              </button>
              <button className="btn btn-ghost btn-lg task-toggle" onClick={() => setTasksOpen((v) => !v)} aria-label="打开发布任务面板">
                <ListChecks size={18} aria-hidden />
                任务({jobs.length})
                {activeJobId && <span className="task-pulse" aria-hidden />}
              </button>
              {jobError && <div className="editor-footer-error">{jobError}</div>}
              </div>
            </div>
          </section>

          {/* 右栏:多平台预览 */}
          <section className="preview-pane" aria-label="预览区">
            {results.length === 0 ? (
              <div className="preview-placeholder">
                <span className="preview-placeholder-icon" aria-hidden>
                  <Inbox size={30} />
                </span>
                <span className="preview-placeholder-title">实时多平台预览</span>
                <span className="preview-placeholder-hint">
                  在左侧输入 Markdown，这里会实时显示公众号 / 知乎 / B站 / 小红书 / 掘金 / CSDN 的适配效果与校验结果。
                </span>
              </div>
            ) : (
              <div className="preview-grid">
                {results.map((r) => (
                  <div key={r.platformId} className="preview-cell">
                    <PlatformPreview result={r} bridge={bridge} sourceMarkdown={markdown} />
                    {receipts[r.platformId] && (
                      <div className="receipt">
                        <Check size={14} aria-hidden />
                        {receipts[r.platformId]}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <Suspense fallback={null}>
          <SettingsDrawer
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            llm={llm}
            persistLlmKey={persistLlmKey}
            enhance={enhance}
            ready={ready}
            serverUrl={serverUrl}
            runnerUrl={runnerUrl}
            serverToken={serverToken}
            runnerToken={runnerToken}
            wechatPublishMode={wechatPublishMode}
            automationModes={automationModes}
            onLlm={actions.setLlm}
            onPersistLlmKey={actions.setPersistLlmKey}
            onClearLlmKey={actions.clearLlmKey}
            onEnhance={actions.setEnhance}
            onServerUrl={actions.setServerUrl}
            onRunnerUrl={actions.setRunnerUrl}
            onServerToken={actions.setServerToken}
            onRunnerToken={actions.setRunnerToken}
            onWechatPublishMode={actions.setWechatPublishMode}
            onAutomationMode={actions.setAutomationMode}
          />
        </Suspense>
        <Suspense fallback={null}>
          <DraftsDrawer
            open={draftsOpen}
            onOpenChange={setDraftsOpen}
            drafts={drafts}
            currentDraftId={currentDraftId}
            history={history}
            onNew={() => {
              // v7 创作工作流:新建前 flush 未保存修改(避免丢失当前内容)。
              void actions.flushDraft().then(() => {
                actions.newDraft();
                setDraftsOpen(false);
              });
            }}
            onLoad={(id) => {
              // v7 创作工作流:切换草稿前 flush 未保存修改(避免丢失当前内容)。
              void actions.flushDraft().then(() => {
                void actions.loadDraft(id);
                setDraftsOpen(false);
              });
            }}
            onDelete={(id) => void actions.deleteDraft(id)}
            onExport={() => actions.exportData()}
            onImport={(raw) => actions.importData(raw)}
          />
        </Suspense>
        <Suspense fallback={null}>
          <TaskPanel open={tasksOpen} onOpenChange={setTasksOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <AssistantDrawer open={assistantOpen} onOpenChange={setAssistantOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <TemplatesDrawer open={templatesOpen} onOpenChange={setTemplatesOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <BatchDrawer open={batchOpen} onOpenChange={setBatchOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <DriftPanel open={driftOpen} onOpenChange={setDriftOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <SchedulerDrawer open={schedulerOpen} onOpenChange={setSchedulerOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <PerformanceDrawer open={performanceOpen} onOpenChange={setPerformanceOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <DashboardDrawer open={dashboardOpen} onOpenChange={setDashboardOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <ServerJobsPanel
            open={serverJobsOpen}
            onOpenChange={setServerJobsOpen}
            serverUrl={serverUrl}
            serverToken={serverToken}
            api={{
              list: (req) =>
                bridge?.listServerJobs
                  ? bridge.listServerJobs(req)
                  : Promise.resolve({ ok: false, error: "当前环境不支持服务器任务接口" }),
              resume: (req) =>
                bridge?.resumeServerJob
                  ? bridge.resumeServerJob(req)
                  : Promise.resolve({ ok: false, error: "当前环境不支持服务器任务接口" }),
              cancel: (req) =>
                bridge?.cancelServerJob
                  ? bridge.cancelServerJob(req)
                  : Promise.resolve({ ok: false, error: "当前环境不支持服务器任务接口" }),
              retry: (req) =>
                bridge?.retryServerJob
                  ? bridge.retryServerJob(req)
                  : Promise.resolve({ ok: false, error: "当前环境不支持服务器任务接口" }),
            }}
          />
        </Suspense>
        <Suspense fallback={null}>
          <PlatformConnectDrawer
            open={connectOpen}
            onOpenChange={setConnectOpen}
            bridge={bridge}
            serverUrl={serverUrl}
            serverToken={serverToken}
            runnerUrl={runnerUrl}
            runnerToken={runnerToken}
          />
        </Suspense>
        <Suspense fallback={null}>
          <VersionHistoryDrawer
            open={versionHistoryOpen}
            onOpenChange={setVersionHistoryOpen}
          />
        </Suspense>
        <Suspense fallback={null}>
          <AutoAgentDrawer open={autoAgentOpen} onOpenChange={setAutoAgentOpen} />
        </Suspense>
        <Suspense fallback={null}>
          <AiConnectDrawer open={aiConnectOpen} onOpenChange={setAiConnectOpen} />
          <DraftSearchDrawer open={draftSearchOpen} onOpenChange={setDraftSearchOpen} />
          <LlmTelemetryDrawer open={llmTelemetryOpen} onOpenChange={setLlmTelemetryOpen} />
          <ContentCalendar
            open={calendarOpen}
            onOpenChange={setCalendarOpen}
            onNavigate={(kind, refId) => {
              // CAL-03 / v6 CAL-04:点击日历事件 → 打开对应详情抽屉/加载草稿。
              if (kind === "draft") {
                setCalendarOpen(false);
                void actions.loadDraft(refId);
                setDraftsOpen(true);
              } else if (kind === "task") {
                setCalendarOpen(false);
                setSchedulerOpen(true);
              } else if (kind === "queue") {
                setCalendarOpen(false);
                setPublishQueueOpen(true);
              } else if (kind === "batch") {
                setCalendarOpen(false);
                setBatchOpen(true);
              } else if (kind === "metric") {
                setCalendarOpen(false);
                setPerformanceOpen(true);
              } else if (kind === "publish") {
                setCalendarOpen(false);
                setPerformanceOpen(true);
              }
            }}
          />
          <ReportDrawer open={reportOpen} onOpenChange={setReportOpen} />
          <AccountManagerDrawer open={accountsOpen} onOpenChange={setAccountsOpen} />
          <CollabDrawer
            open={collabOpen}
            onOpenChange={setCollabOpen}
            serverUrl={serverUrl}
            serverToken={serverToken}
            api={{
              list: (req) =>
                bridge?.listSharedItems
                  ? bridge.listSharedItems(req)
                  : Promise.resolve({ ok: false, message: "当前环境不支持协作共享接口" }),
              get: (req) =>
                bridge?.getSharedItem
                  ? bridge.getSharedItem(req)
                  : Promise.resolve({ ok: false, message: "当前环境不支持协作共享接口" }),
              push: (req) =>
                bridge?.pushSharedItem
                  ? bridge.pushSharedItem(req)
                  : Promise.resolve({ ok: false, message: "当前环境不支持协作共享接口" }),
              remove: (req) =>
                bridge?.deleteSharedItem
                  ? bridge.deleteSharedItem(req)
                  : Promise.resolve({ ok: false, message: "当前环境不支持协作共享接口" }),
            }}
            localApi={{
              list: async () => {
                await useStore.getState().refreshLocalShared();
                return (useStore.getState().localSharedItems ?? []) as import("@mpp/core").SharedItem[];
              },
              get: async (kind, id) => {
                const items = (useStore.getState().localSharedItems ?? []) as import("@mpp/core").SharedItem[];
                return items.find((i) => i.meta.kind === kind && i.meta.id === id);
              },
              push: async (item) => {
                const result = await useStore.getState().localSharedPush(item);
                return {
                  ok: true,
                  mode: result.mode,
                  id: result.item.meta.id,
                  message:
                    result.mode === "conflict"
                      ? `检测到并发覆盖,已保留双版本(新版本 ${result.item.meta.id})`
                      : result.mode === "unchanged"
                        ? "与本地共享库现有版本一致,未产生新版本"
                        : "已写入本地共享库",
                };
              },
              remove: async (kind, id) => {
                await useStore.getState().localSharedRemove(kind, id);
              },
            }}
          />
          <PublishQueueDrawer open={publishQueueOpen} onOpenChange={setPublishQueueOpen} />
          <PublishBatchDrawer open={publishBatchOpen} onOpenChange={setPublishBatchOpen} />
          <AssetLibraryDrawer open={assetLibraryOpen} onOpenChange={setAssetLibraryOpen} />
          <InboxDrawer open={inboxOpen} onOpenChange={setInboxOpen} />
          <BrandMatrixDrawer open={brandMatrixOpen} onOpenChange={setBrandMatrixOpen} />
          <AiStudioDrawer open={aiStudioOpen} onOpenChange={setAiStudioOpen} />
          <PreflightDrawer
            open={preflightOpen}
            onOpenChange={setPreflightOpen}
            report={preflightReport}
            computing={preflightComputing}
            onRecheck={() => runPreflight()}
            onAutoFix={() => actions.autoFixPreflightIssues()}
            onPublish={() => {
              setPreflightOpen(false);
              void actions.publishAll();
            }}
            onRealPublish={() => {
              // v7 Phase 2:健康检查通过后确认真实发布。
              setPreflightOpen(false);
              setRealPublishArm(false);
              setJobError(null);
              void actions
                .createPublishJob()
                .then(() => setTasksOpen(true))
                .catch((err: unknown) => setJobError(err instanceof Error ? err.message : String(err)));
            }}
            selectedCount={selectedPlatforms.length}
            realMode={realPublishArm}
          />
          <CommandPalette
            open={commandOpen}
            onOpenChange={setCommandOpen}
            commands={commandItems}
            onCustomAction={(action) => {
              // CMD-02:自定义命令动作 → 匹配内置命令 id 或抽屉名。
              const target = commandItems.find((c) => c.id === action || c.label === action || (c.keywords ?? "").includes(action));
              if (target) {
                target.run();
              } else {
                const byLabel: Record<string, () => void> = {
                  内容日历: () => setCalendarOpen(true),
                  复盘报告: () => setReportOpen(true),
                  草稿: () => setDraftsOpen(true),
                  设置: () => setSettingsOpen(true),
                  任务: () => setTasksOpen(true),
                  内容助手: () => setAssistantOpen(true),
                  模板: () => setTemplatesOpen(true),
                  批量: () => setBatchOpen(true),
                  计划任务: () => setSchedulerOpen(true),
                  发布队列: () => setPublishQueueOpen(true),
                  发布批次: () => setPublishBatchOpen(true),
                  资产库: () => setAssetLibraryOpen(true),
                  "统一收件箱": () => setInboxOpen(true),
                  收件箱: () => setInboxOpen(true),
                  "账号矩阵": () => setBrandMatrixOpen(true),
                  矩阵: () => setBrandMatrixOpen(true),
                  "AI 智能增强": () => setAiStudioOpen(true),
                  智能增强: () => setAiStudioOpen(true),
                  效果: () => setPerformanceOpen(true),
                  服务器任务: () => setServerJobsOpen(true),
                  平台连接: () => setConnectOpen(true),
                  账号管理: () => setAccountsOpen(true),
                  协作共享: () => setCollabOpen(true),
                  版本历史: () => setVersionHistoryOpen(true),
                  "AI 自动完成": () => setAutoAgentOpen(true),
                  "AI 连接中心": () => setAiConnectOpen(true),
                  "AI 草稿检索": () => setDraftSearchOpen(true),
                  "LLM 调用观测": () => setLlmTelemetryOpen(true),
                  终端: () => setTerminalOpen(true),
                };
                const openByAction = byLabel[action] ?? byLabel[action.trim()];
                if (openByAction) {
                  openByAction();
                } else {
                  setCommandOpen(true);
                }
              }
            }}
          />
        </Suspense>
        {tauriBridge && terminalOpen && (
          <Suspense
            fallback={
              <div className="terminal-panel">
                <div className="terminal-body terminal-loading">正在加载终端…</div>
              </div>
            }
          >
            <TerminalPanel bridge={tauriBridge} theme={mode === "dark" ? "dark" : "light"} />
          </Suspense>
        )}
        <ToastHost />
      </div>
    </Tooltip.Provider>
  );
}
