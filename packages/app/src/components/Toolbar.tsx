import { FileText, Settings2, PanelRightClose, PanelRightOpen, SquareTerminal, Wand2, LayoutTemplate, ListChecks, Radar, CalendarClock, BarChart3, Database, Plug, PenLine, History, Sparkles, Cable, Search, Activity, CalendarDays, FileDown, Command, Users, Share2, SendToBack, Layers, FolderOpen, Inbox, LayoutGrid, Bot } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ThemeToggle } from "./ThemeToggle.js";
import type { ThemeMode } from "../styles/use-theme.js";

interface Props {
  env: "web" | "extension" | "desktop" | undefined;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  previewOnly: boolean;
  onTogglePreviewOnly: () => void;
  draftCount: number;
  onOpenDrafts: () => void;
  llmReady: boolean;
  onOpenSettings: () => void;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  showTerminal?: boolean;
  assistantOpen?: boolean;
  onOpenAssistant?: () => void;
  templatesOpen?: boolean;
  onOpenTemplates?: () => void;
  batchOpen?: boolean;
  onOpenBatch?: () => void;
  driftOpen?: boolean;
  onOpenDrift?: () => void;
  schedulerOpen?: boolean;
  onOpenScheduler?: () => void;
  performanceOpen?: boolean;
  onOpenPerformance?: () => void;
  serverJobsOpen?: boolean;
  onOpenServerJobs?: () => void;
  connectOpen?: boolean;
  onOpenConnect?: () => void;
  versionHistoryOpen?: boolean;
  onOpenVersionHistory?: () => void;
  autoAgentOpen?: boolean;
  onOpenAutoAgent?: () => void;
  aiConnectOpen?: boolean;
  onOpenAiConnect?: () => void;
  draftSearchOpen?: boolean;
  onOpenDraftSearch?: () => void;
  llmTelemetryOpen?: boolean;
  onOpenLlmTelemetry?: () => void;
  calendarOpen?: boolean;
  onOpenCalendar?: () => void;
  reportOpen?: boolean;
  onOpenReport?: () => void;
  commandOpen?: boolean;
  onOpenCommand?: () => void;
  accountsOpen?: boolean;
  onOpenAccounts?: () => void;
  collabOpen?: boolean;
  onOpenCollab?: () => void;
  publishQueueOpen?: boolean;
  onOpenPublishQueue?: () => void;
  publishBatchOpen?: boolean;
  onOpenPublishBatch?: () => void;
  assetLibraryOpen?: boolean;
  onOpenAssetLibrary?: () => void;
  dashboardOpen?: boolean;
  onOpenDashboard?: () => void;
  inboxOpen?: boolean;
  onOpenInbox?: () => void;
  brandMatrixOpen?: boolean;
  onOpenBrandMatrix?: () => void;
  aiStudioOpen?: boolean;
  onOpenAiStudio?: () => void;
}

function IconBtn({
  label,
  active,
  pressed,
  haspopup,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  pressed?: boolean;
  haspopup?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={active ? "btn-icon active" : "btn-icon"}
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          aria-haspopup={haspopup ? "dialog" : undefined}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** 工具栏分隔线 */
function Sep() {
  return <span className="toolbar-sep" aria-hidden />;
}

/** 带文字标签的工具栏按钮 */
function LabelBtn({
  label,
  active,
  pressed,
  haspopup,
  onClick,
  children,
  title,
}: {
  label: string;
  active?: boolean;
  pressed?: boolean;
  haspopup?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={active ? "btn-icon btn-icon-labeled active" : "btn-icon btn-icon-labeled"}
          onClick={onClick}
          aria-label={title ?? label}
          title={title ?? label}
          aria-pressed={pressed}
          aria-haspopup={haspopup ? "dialog" : undefined}
        >
          {children}
          <span className="btn-icon-label">{label}</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {title ?? label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** 顶部工具栏:品牌标识 + 全局操作(草稿/设置/全屏预览/主题)。 */
export function Toolbar({
  env,
  themeMode,
  onCycleTheme,
  previewOnly,
  onTogglePreviewOnly,
  draftCount,
  onOpenDrafts,
  llmReady,
  onOpenSettings,
  terminalOpen = false,
  onToggleTerminal,
  showTerminal = false,
  assistantOpen = false,
  onOpenAssistant,
  templatesOpen = false,
  onOpenTemplates,
  batchOpen = false,
  onOpenBatch,
  driftOpen = false,
  onOpenDrift,
  schedulerOpen = false,
  onOpenScheduler,
  performanceOpen = false,
  onOpenPerformance,
  serverJobsOpen = false,
  onOpenServerJobs,
  connectOpen = false,
  onOpenConnect,
  versionHistoryOpen = false,
  onOpenVersionHistory,
  autoAgentOpen = false,
  onOpenAutoAgent,
  aiConnectOpen = false,
  onOpenAiConnect,
  draftSearchOpen = false,
  onOpenDraftSearch,
  llmTelemetryOpen = false,
  onOpenLlmTelemetry,
  calendarOpen = false,
  onOpenCalendar,
  reportOpen = false,
  onOpenReport,
  commandOpen = false,
  onOpenCommand,
  accountsOpen = false,
  onOpenAccounts,
  collabOpen = false,
  onOpenCollab,
  publishQueueOpen = false,
  onOpenPublishQueue,
  publishBatchOpen = false,
  onOpenPublishBatch,
  assetLibraryOpen = false,
  onOpenAssetLibrary,
  dashboardOpen = false,
  onOpenDashboard,
  inboxOpen = false,
  onOpenInbox,
  brandMatrixOpen = false,
  onOpenBrandMatrix,
  aiStudioOpen = false,
  onOpenAiStudio,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-brand">
        <span className="toolbar-logo" aria-hidden>
          <PenLine size={18} />
        </span>
        <span className="toolbar-title">
          光谱创作台
          <span className="toolbar-title-sub">一份 Markdown · 折射多平台</span>
        </span>
        <span className="env-badge">{env === "extension" ? "扩展模式" : "网页模式"}</span>
      </div>

      <div className="toolbar-actions">
        {/* 创作工具组 */}
        <div className="toolbar-group" aria-label="创作工具">
          <LabelBtn label="助手" active={assistantOpen} onClick={onOpenAssistant ?? (() => undefined)} title="内容助手">
            <Wand2 size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="模板" active={templatesOpen} onClick={onOpenTemplates ?? (() => undefined)} title="平台模板">
            <LayoutTemplate size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="大纲" active={false} onClick={onOpenCommand ?? (() => undefined)} title="通过命令面板搜索大纲 (Ctrl/Cmd+K)">
            <ListChecks size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="日历" active={calendarOpen} onClick={onOpenCalendar ?? (() => undefined)} title="内容日历">
            <CalendarDays size={16} aria-hidden />
          </LabelBtn>
        </div>

        <Sep />

        {/* 发布与数据组 */}
        <div className="toolbar-group" aria-label="发布管理">
          <LabelBtn label="队列" active={publishQueueOpen} onClick={onOpenPublishQueue ?? (() => undefined)} title="发布队列">
            <SendToBack size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="批次" active={publishBatchOpen} onClick={onOpenPublishBatch ?? (() => undefined)} title="发布批次">
            <Layers size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="计划" active={schedulerOpen} onClick={onOpenScheduler ?? (() => undefined)} title="本机计划任务">
            <CalendarClock size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="任务" active={false} onClick={onOpenCommand ?? (() => undefined)} title="通过命令面板搜索任务 (Ctrl/Cmd+K)">
            <ListChecks size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="效果" active={performanceOpen} onClick={onOpenPerformance ?? (() => undefined)} title="发布效果回收">
            <BarChart3 size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="驾驶舱" active={dashboardOpen} onClick={onOpenDashboard ?? (() => undefined)} title="运营驾驶舱">
            <BarChart3 size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="资产" active={assetLibraryOpen} onClick={onOpenAssetLibrary ?? (() => undefined)} title="内容资产库">
            <FolderOpen size={16} aria-hidden />
          </LabelBtn>
        </div>

        <Sep />

        {/* AI 能力组 */}
        <div className="toolbar-group" aria-label="AI 能力">
          <LabelBtn label="AI 自动完成" active={autoAgentOpen} pressed={autoAgentOpen} haspopup onClick={onOpenAutoAgent ?? (() => undefined)} title="AI 自动完成">
            <Sparkles size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="增强" active={aiStudioOpen} onClick={onOpenAiStudio ?? (() => undefined)} title="AI 智能增强工作台">
            <Bot size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="AI 连接中心" active={aiConnectOpen} pressed={aiConnectOpen} haspopup onClick={onOpenAiConnect ?? (() => undefined)} title="AI 连接中心">
            <Cable size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="检索" active={draftSearchOpen} onClick={onOpenDraftSearch ?? (() => undefined)} title="AI 草稿检索">
            <Search size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="LLM 调用观测" active={llmTelemetryOpen} pressed={llmTelemetryOpen} haspopup onClick={onOpenLlmTelemetry ?? (() => undefined)} title="LLM 调用观测">
            <Activity size={16} aria-hidden />
          </LabelBtn>
        </div>

        <Sep />

        {/* 平台与账号组 */}
        <div className="toolbar-group" aria-label="平台与账号">
          <LabelBtn label="连接" active={connectOpen} onClick={onOpenConnect ?? (() => undefined)} title="平台一键连接">
            <Plug size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="账号" active={accountsOpen} onClick={onOpenAccounts ?? (() => undefined)} title="账号管理">
            <Users size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="矩阵" active={brandMatrixOpen} onClick={onOpenBrandMatrix ?? (() => undefined)} title="账号矩阵分组">
            <LayoutGrid size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="收件箱" active={inboxOpen} onClick={onOpenInbox ?? (() => undefined)} title="统一收件箱">
            <Inbox size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="协作共享" active={collabOpen} pressed={collabOpen} haspopup onClick={onOpenCollab ?? (() => undefined)} title="协作共享">
            <Share2 size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="版本" active={versionHistoryOpen} onClick={onOpenVersionHistory ?? (() => undefined)} title="版本历史">
            <History size={16} aria-hidden />
          </LabelBtn>
        </div>

        <Sep />

        {/* 其他操作组 */}
        <div className="toolbar-group" aria-label="其他操作">
          <LabelBtn label="批量" active={batchOpen} onClick={onOpenBatch ?? (() => undefined)} title="批量与审批">
            <ListChecks size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="健康" active={driftOpen} onClick={onOpenDrift ?? (() => undefined)} title="平台健康">
            <Radar size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="报告" active={reportOpen} onClick={onOpenReport ?? (() => undefined)} title="发布复盘报告">
            <FileDown size={16} aria-hidden />
          </LabelBtn>
          <LabelBtn label="服务器" active={serverJobsOpen} onClick={onOpenServerJobs ?? (() => undefined)} title="服务器任务">
            <Database size={16} aria-hidden />
          </LabelBtn>
          {showTerminal && (
            <LabelBtn label="终端" active={terminalOpen} pressed={terminalOpen} onClick={onToggleTerminal ?? (() => undefined)} title={terminalOpen ? "隐藏内置终端" : "打开内置终端"}>
              <SquareTerminal size={16} aria-hidden />
            </LabelBtn>
          )}
          <LabelBtn label="命令" active={commandOpen} onClick={onOpenCommand ?? (() => undefined)} title="全局命令面板 (Ctrl/Cmd+K)">
            <Command size={16} aria-hidden />
          </LabelBtn>
        </div>

        <Sep />

        {/* 全局操作组 */}
        <div className="toolbar-group" aria-label="全局操作">
          <IconBtn label={`草稿与历史（${draftCount}）`} haspopup onClick={onOpenDrafts}>
            <FileText size={18} aria-hidden />
          </IconBtn>
          <IconBtn
            label={llmReady ? "AI 设置（已配置）" : "AI 设置（未配置）"}
            active={llmReady}
            haspopup
            onClick={onOpenSettings}
          >
            <Settings2 size={18} aria-hidden />
          </IconBtn>
          <IconBtn
            label={previewOnly ? "显示编辑栏" : "全屏预览"}
            active={previewOnly}
            pressed={previewOnly}
            onClick={onTogglePreviewOnly}
          >
            {previewOnly ? <PanelRightOpen size={18} aria-hidden /> : <PanelRightClose size={18} aria-hidden />}
          </IconBtn>
          <ThemeToggle mode={themeMode} onCycle={onCycleTheme} />
        </div>
      </div>
    </header>
  );
}
