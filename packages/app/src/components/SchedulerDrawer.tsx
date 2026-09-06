/**
 * 本机计划任务面板 —— Phase 5 FLOW-03。
 *
 * - 创建计划任务:选择草稿、平台、动作(校验生成/发布任务)、计划表达式(每日/每周/每小时);
 * - 列表展示:状态(enabled/paused)、下次执行时间、最近运行记录;
 * - 操作:手动触发、暂停/恢复、删除。
 *
 * 约束(路线图 §5.2):机器与登录态必须在线;计划任务到点执行本地校验/生成,
 * 真实发布仍走 PublishJobService(需鉴权与可信回执)。
 */
import { useMemo, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  CalendarClock,
  Play,
  Pause,
  Trash2,
  Plus,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { dailyAt, weeklyAt, hourly, listAdapters, generateQueueSchedule, type CronExpression, type ScheduledTask, type QueueScheduleSuggestion, type AutoReplyPolicy, type AutoReplyStrategy, AUTO_REPLY_STRATEGIES } from "@mpp/core";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import {
  deriveTitleFromMarkdown,
  stripMarkdown,
  isoToLocalHourMinute,
  ScheduleSuggestionsBlock,
} from "./schedule-ai.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ADAPTERS = listAdapters();
const ALL_IDS = ADAPTERS.map((a) => a.id);

function cronLabel(cron: CronExpression): string {
  const minute = Array.isArray(cron.minute) ? cron.minute[0] : 0;
  const hour = Array.isArray(cron.hour) ? cron.hour[0] : 0;
  const dow = Array.isArray(cron.dayOfWeek) ? cron.dayOfWeek[0] : undefined;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (Array.isArray(cron.minute) && cron.minute.length === 1 && cron.hour === "*") {
    return `每小时第 ${cron.minute[0]} 分`;
  }
  if (dow !== undefined) {
    const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `每周${names[dow]!} ${time}`;
  }
  return `每天 ${time}`;
}

export function SchedulerDrawer({ open, onOpenChange }: Props) {
  const scheduledTasks = useStore((s) => s.scheduledTasks);
  const drafts = useStore((s) => s.drafts);
  const weeklyJobs = useStore((s) => s.weeklyJobs);
  const markdown = useStore((s) => s.markdown);
  const performanceRecords = useStore((s) => s.performanceRecords);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const loadScheduledTasks = useStore((s) => s.loadScheduledTasks);
  const createScheduledTask = useStore((s) => s.createScheduledTask);
  const triggerScheduledTask = useStore((s) => s.triggerScheduledTask);
  const setScheduledTaskStatus = useStore((s) => s.setScheduledTaskStatus);
  const removeScheduledTask = useStore((s) => s.removeScheduledTask);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // 新建表单
  const [name, setName] = useState("");
  const [draftId, setDraftId] = useState("");
  const [actionKind, setActionKind] = useState<"validate-generate" | "publish-job" | "metrics-sync" | "ai-auto-complete" | "weekly-report" | "inbox-auto-reply">("validate-generate");
  const [weeklyJobId, setWeeklyJobId] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"daily" | "weekly" | "hourly">("daily");
  const [timeHour, setTimeHour] = useState("9");
  const [timeMinute, setTimeMinute] = useState("0");
  const [weekday, setWeekday] = useState("1");
  const [platformIds, setPlatformIds] = useState<string[]>([...ALL_IDS]);
  // INBOX-06:收件箱自动回复策略配置(预设/模板/去重/时效窗口)。
  const [replyStrategy, setReplyStrategy] = useState<AutoReplyStrategy>("conservative");
  const [replyQuestion, setReplyQuestion] = useState(false);
  const [skipNegative, setSkipNegative] = useState(true);
  const [dedupeByAuthor, setDedupeByAuthor] = useState(false);
  const [dailyPerAuthorCap, setDailyPerAuthorCap] = useState("0");
  const [recencyMinutes, setRecencyMinutes] = useState("0");
  const [priceTemplate, setPriceTemplate] = useState("");
  const [buyTemplate, setBuyTemplate] = useState("");
  const [praiseTemplate, setPraiseTemplate] = useState("");
  const [questionTemplate, setQuestionTemplate] = useState("");
  // AI 排期建议(本机计划任务):建议发布时间 → cron 时/分;建议平台 → 目标平台。
  const [scheduleSuggestions, setScheduleSuggestions] = useState<readonly QueueScheduleSuggestion[]>([]);
  const [scheduleSummary, setScheduleSummary] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const refresh = useCallback(async () => {
    await loadScheduledTasks();
  }, [loadScheduledTasks]);

  const buildCron = useCallback((): CronExpression | null => {
    const h = Number(timeHour);
    const m = Number(timeMinute);
    if (!Number.isInteger(h) || h < 0 || h > 23) return null;
    if (!Number.isInteger(m) || m < 0 || m > 59) return null;
    if (scheduleKind === "hourly") return hourly();
    if (scheduleKind === "weekly") return weeklyAt(Number(weekday), h, m);
    return dailyAt(h, m);
  }, [scheduleKind, timeHour, timeMinute, weekday]);

  const createTask = useCallback(async () => {
    if (!name.trim()) {
      setError("请输入任务名称");
      return;
    }
    const cron = buildCron();
    if (!cron) {
      setError("时间格式无效");
      return;
    }
    if (actionKind === "weekly-report" && !weeklyJobId) {
      setError("请选择要生成的周报任务");
      return;
    }
    if (actionKind !== "metrics-sync" && actionKind !== "weekly-report" && actionKind !== "inbox-auto-reply" && !draftId) {
      setError("请选择草稿");
      return;
    }
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      // INBOX-06:收件箱自动回复任务携带策略配置(预设/模板/去重/时效窗口)。
      const autoReplyPolicy: AutoReplyPolicy | undefined =
        actionKind === "inbox-auto-reply"
          ? {
              strategy: replyStrategy,
              replyQuestion,
              skipNegative,
              dedupeByAuthor,
              ...(Number(dailyPerAuthorCap) > 0 ? { dailyPerAuthorCap: Number(dailyPerAuthorCap) } : {}),
              ...(Number(recencyMinutes) > 0 ? { recencyWindowMs: Number(recencyMinutes) * 60 * 1000 } : {}),
              template: {
                ...(priceTemplate.trim() ? { priceInquiry: priceTemplate.trim() } : {}),
                ...(buyTemplate.trim() ? { howToBuy: buyTemplate.trim() } : {}),
                ...(praiseTemplate.trim() ? { praise: praiseTemplate.trim() } : {}),
                ...(questionTemplate.trim() ? { question: questionTemplate.trim() } : {}),
              },
            }
          : undefined;
      const result = await createScheduledTask({
        name,
        cron,
        actionKind,
        platformIds,
        draftId,
        ...(actionKind === "weekly-report" ? { weeklyJobId } : {}),
        ...(autoReplyPolicy ? { autoReplyPolicy } : {}),
      });
      if (result.ok) {
        setSuccess("计划任务已创建");
        setName("");
        setDraftId("");
        setWeeklyJobId("");
      } else {
        setError(result.error ?? "创建失败");
      }
    } finally {
      setCreating(false);
    }
  }, [name, buildCron, draftId, actionKind, platformIds, weeklyJobId, createScheduledTask, replyStrategy, replyQuestion, skipNegative, dedupeByAuthor, dailyPerAuthorCap, recencyMinutes, priceTemplate, buyTemplate, praiseTemplate, questionTemplate]);

  const trigger = useCallback(
    async (id: string) => {
      await triggerScheduledTask(id);
    },
    [triggerScheduledTask],
  );

  const toggleStatus = useCallback(
    async (task: ScheduledTask) => {
      await setScheduledTaskStatus(task.id, task.status === "enabled" ? "paused" : "enabled");
    },
    [setScheduledTaskStatus],
  );

  const remove = useCallback(
    async (id: string) => {
      await removeScheduledTask(id);
    },
    [removeScheduledTask],
  );

  const draftOptions = useMemo(() => {
    return drafts.filter((d) => d.markdown.trim());
  }, [drafts]);

  const togglePlatform = useCallback((id: string) => {
    setPlatformIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  // AI 排期建议:结合历史效果 + 当前内容生成建议发布时间/平台组合。
  const runSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setError("");
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const sourceMarkdown = drafts.find((d) => d.id === draftId)?.markdown ?? markdown;
      const result = await generateQueueSchedule(llmAdapter, {
        title: deriveTitleFromMarkdown(sourceMarkdown),
        contentText: stripMarkdown(sourceMarkdown),
        performanceRecords,
        platformIds: platformIds.length > 0 ? platformIds : ALL_IDS,
        earliestAt: new Date().toISOString(),
      });
      setScheduleSuggestions(result.suggestions);
      setScheduleSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScheduleLoading(false);
    }
  }, [draftId, markdown, drafts, performanceRecords, platformIds, llm, llmConfigs, activeLlmConfigId]);

  // 采纳一条排期建议:把建议时间落地为 cron 时/分(计划任务无日期概念),平台组合填入目标平台。
  const applySuggestion = useCallback((s: QueueScheduleSuggestion) => {
    const { hour, minute } = isoToLocalHourMinute(s.suggestedAt);
    setTimeHour(String(hour));
    setTimeMinute(String(minute));
    if (s.platformIds.length > 0) setPlatformIds([...s.platformIds]);
    toast(`已采纳排期建议:${s.name}(${hour}:${String(minute).padStart(2, "0")})`, "success");
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <CalendarClock size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              本机计划任务
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
              计划任务到点执行本地校验/生成或发起发布任务。机器与登录态必须在线，真实发布仍需可信回执与确认。
            </div>

            {error && <div className="batch-error">{error}</div>}
            {success && <div className="batch-success">{success}</div>}

            {/* 新建表单 */}
            <div className="scheduler-form">
              <div className="drift-section-label">新建计划任务</div>
              <label className="scheduler-field">
                <span>任务名称</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:每日早报校验" />
              </label>
              {actionKind !== "metrics-sync" && actionKind !== "weekly-report" && actionKind !== "inbox-auto-reply" && (
                <label className="scheduler-field">
                  <span>关联草稿</span>
                  <select value={draftId} onChange={(e) => setDraftId(e.target.value)}>
                    <option value="">请选择草稿…</option>
                    {draftOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {actionKind === "weekly-report" && (
                <label className="scheduler-field">
                  <span>周报任务</span>
                  <select value={weeklyJobId} onChange={(e) => setWeeklyJobId(e.target.value)}>
                    <option value="">请选择周报任务…</option>
                    {weeklyJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="scheduler-field">
                <span>动作</span>
                <select value={actionKind} onChange={(e) => setActionKind(e.target.value as "validate-generate" | "publish-job" | "metrics-sync" | "ai-auto-complete" | "weekly-report" | "inbox-auto-reply")}>
                  <option value="validate-generate">校验并生成产物（不真实发布）</option>
                  <option value="publish-job">创建发布任务（走任务编排）</option>
                  <option value="metrics-sync">同步公众号官方指标</option>
                  <option value="ai-auto-complete">AI 自动完成（分析/修复/复核草稿）</option>
                  <option value="weekly-report">生成周报（到点自动产出周报）</option>
                  <option value="inbox-auto-reply">收件箱 AI 自动回复（批量真实回发）</option>
                </select>
              </label>
              {actionKind === "inbox-auto-reply" && (
                <div className="scheduler-field">
                  <span>自动回复策略</span>
                  <div className="scheduler-strategy">
                    <select value={replyStrategy} onChange={(e) => setReplyStrategy(e.target.value as AutoReplyStrategy)}>
                      {(Object.keys(AUTO_REPLY_STRATEGIES) as AutoReplyStrategy[]).map((k) => (
                        <option key={k} value={k}>
                          {AUTO_REPLY_STRATEGIES[k].label}（{AUTO_REPLY_STRATEGIES[k].note}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="scheduler-checkboxes">
                    <label className="scheduler-check">
                      <input type="checkbox" checked={replyQuestion} onChange={(e) => setReplyQuestion(e.target.checked)} />
                      自动回复一般提问
                    </label>
                    <label className="scheduler-check">
                      <input type="checkbox" checked={skipNegative} onChange={(e) => setSkipNegative(e.target.checked)} />
                      负面/紧急转人工（推荐勾选）
                    </label>
                    <label className="scheduler-check">
                      <input type="checkbox" checked={dedupeByAuthor} onChange={(e) => setDedupeByAuthor(e.target.checked)} />
                      同作者去重（每作者仅回一条）
                    </label>
                  </div>
                  <div className="scheduler-cron-row" style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>每作者上限</span>
                    <input
                      type="number"
                      min={0}
                      value={dailyPerAuthorCap}
                      onChange={(e) => setDailyPerAuthorCap(e.target.value)}
                      aria-label="每作者回复上限"
                      style={{ width: 56 }}
                    />
                    <span style={{ fontSize: 12, opacity: 0.7 }}>时效窗口(分钟,0=不限)</span>
                    <input
                      type="number"
                      min={0}
                      value={recencyMinutes}
                      onChange={(e) => setRecencyMinutes(e.target.value)}
                      aria-label="时效窗口分钟"
                      style={{ width: 64 }}
                    />
                  </div>
                  <div className="scheduler-template" style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {(
                      [
                        ["priceTemplate", "问价模板", priceTemplate, setPriceTemplate],
                        ["buyTemplate", "求购模板", buyTemplate, setBuyTemplate],
                        ["praiseTemplate", "好评模板", praiseTemplate, setPraiseTemplate],
                        ["questionTemplate", "提问模板", questionTemplate, setQuestionTemplate],
                      ] as const
                    ).map(([key, label, value, setter]) => (
                      <label key={key} className="scheduler-field" style={{ margin: 0 }}>
                        <span style={{ fontSize: 12 }}>{label}(留空用默认文案)</span>
                        <input value={value} onChange={(e) => (setter as (v: string) => void)(e.target.value)} placeholder="自定义回复文案…" />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="scheduler-field">
                <span>计划</span>
                <div className="scheduler-cron-row">
                  <select value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value as "daily" | "weekly" | "hourly")}>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="hourly">每小时</option>
                  </select>
                  {scheduleKind === "weekly" && (
                    <select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                      {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((d, i) => (
                        <option key={i} value={String(i)}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                  {scheduleKind !== "hourly" && (
                    <>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={timeHour}
                        onChange={(e) => setTimeHour(e.target.value)}
                        aria-label="小时"
                        style={{ width: 56 }}
                      />
                      <span>:</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={timeMinute}
                        onChange={(e) => setTimeMinute(e.target.value)}
                        aria-label="分钟"
                        style={{ width: 56 }}
                      />
                    </>
                  )}
                </div>
              </label>
              {actionKind !== "metrics-sync" && actionKind !== "weekly-report" && (
                <div className="scheduler-field">
                  <span>目标平台</span>
                  <div className="scheduler-platforms">
                    {ADAPTERS.map((a) => {
                      const color = platformColor(a.id);
                      const active = platformIds.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={active ? "chip chip-active" : "chip"}
                          style={{ ["--chip-color" as string]: color }}
                          onClick={() => togglePlatform(a.id)}
                          aria-pressed={active}
                        >
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <button type="button" className="btn btn-primary" onClick={() => void createTask()} disabled={creating}>
                {creating ? <Loader2 size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                创建计划任务
              </button>
            </div>

            {/* AI 排期建议:结合历史效果与当前内容,建议 cron 时/分与平台组合 */}
            <ScheduleSuggestionsBlock
              hint="AI 排期建议:结合历史效果与当前内容,建议每日/每周执行时点与平台组合"
              loading={scheduleLoading}
              canRun={!!draftId || !!markdown.trim()}
              summary={scheduleSummary}
              suggestions={scheduleSuggestions}
              onRun={() => void runSchedule()}
              onApply={applySuggestion}
            />

            {/* 任务列表 */}
            <div className="drift-section-label" style={{ marginTop: 16 }}>
              已配置任务（{scheduledTasks.length}）
            </div>
            {scheduledTasks.length === 0 && (
              <div className="assistant-empty">还没有计划任务，先在上面创建一个。</div>
            )}
            {scheduledTasks.map((task) => {
              const draftTitle = drafts.find((d) => d.id === task.draftId)?.title ?? "草稿已删除";
              const lastRun = task.runs[0];
              return (
                <div key={task.id} className="scheduler-task">
                  <div className="scheduler-task-head">
                    <span className="scheduler-task-name">{task.name}</span>
                    <span className={task.status === "enabled" ? "drift-ok" : "drift-warn"}>
                      {task.status === "enabled" ? <CheckCircle2 size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
                      {task.status === "enabled" ? "启用" : "已暂停"}
                    </span>
                  </div>
                  <div className="scheduler-task-meta">
                    {cronLabel(task.cron)} · {task.action.kind === "publish-job" ? "发布任务" : task.action.kind === "metrics-sync" ? "指标同步" : task.action.kind === "ai-auto-complete" ? "AI 自动完成" : task.action.kind === "weekly-report" ? "周报生成" : task.action.kind === "inbox-auto-reply" ? "收件箱自动回复" : "校验生成"} · {task.action.kind === "weekly-report" ? (weeklyJobs.find((j) => j.id === task.weeklyReport?.weeklyJobId)?.name ?? "周报任务") : draftTitle}
                  </div>
                  <div className="scheduler-task-platforms">
                    {task.platformIds.length === 0 ? "全部平台" : task.platformIds.join(" / ")}
                  </div>
                  {task.action.kind === "inbox-auto-reply" && task.action.policy && (
                    <div className="scheduler-task-run">
                      策略:{AUTO_REPLY_STRATEGIES[task.action.policy.strategy ?? "conservative"].label}
                      {task.action.policy.replyQuestion ? " · 含提问" : ""}
                      {task.action.policy.skipNegative === false ? " · 负面试安抚" : ""}
                      {task.action.policy.dedupeByAuthor ? " · 同作者去重" : ""}
                      {task.action.policy.dailyPerAuthorCap ? ` · 每作者≤${task.action.policy.dailyPerAuthorCap}` : ""}
                      {task.action.policy.recencyWindowMs ? ` · ${Math.round(task.action.policy.recencyWindowMs / 60000)}min 时效` : ""}
                    </div>
                  )}
                  {lastRun && (
                    <div className="scheduler-task-run">
                      最近:{lastRun.outcome === "succeeded" ? "成功" : lastRun.outcome === "failed" ? "失败" : lastRun.outcome === "skipped" ? "跳过" : "未知"}
                      {lastRun.batchSummary ? ` — ${lastRun.batchSummary}` : ""}
                      {lastRun.error ? ` — ${lastRun.error}` : ""}
                    </div>
                  )}
                  <div className="scheduler-task-actions">
                    <button type="button" className="btn btn-sm" onClick={() => void trigger(task.id)}>
                      <Play size={12} aria-hidden /> 立即执行
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void toggleStatus(task)}>
                      {task.status === "enabled" ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
                      {task.status === "enabled" ? "暂停" : "恢复"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => void remove(task.id)}
                      aria-label="删除计划任务"
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
