/**
 * v8 Phase 1/2 · 运营驾驶舱抽屉 —— 把零散的效果数据与发布状态整合为可视化视图。
 *
 * 能力(与 ROADMAP_V8 对齐):
 * - **发布概览**(EXEC-02):成功/失败/进行中/未知统计 + 成功率;
 * - **效果趋势**(DASH-01):按日阅读/互动 SVG 折线图;
 * - **平台对比**(DASH-02):各平台平均阅读/互动率条形对比;
 * - **内容排行**(DASH-03):按综合得分 Top N 内容;
 * - **目标进度**(DASH-04):月阅读/发布数目标进度条(可设定目标);
 * - **发布健康**(EXEC-01):失败原因聚合表 + 一键重试;
 * - **内容优化建议**(OPT-01):基于效果数据 + 内容特征的可执行优化建议(可一键应用/撤销);
 * - **最佳发布时间**(OPT-02):从历史效果学习最佳发布时段(按小时聚合)。
 *
 * 约束:全部基于既有 `analytics`(效果回收)与 `jobs`(发布任务)纯函数派生,不新增埋点;
 * 图标规范:全 Lucide 图标,无表情符号;SVG 手绘图表,不引入第三方图表库。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  TrendingUp,
  BarChart3,
  Trophy,
  Target,
  Activity,
  RefreshCw,
  RotateCcw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  MinusCircle,
  Lightbulb,
  Clock3,
  Wand2,
  Undo2,
  Recycle,
  Sparkles,
  Tags,
  Search,
  Send,
  LayoutGrid,
  MessagesSquare,
  Bell,
  GitCompareArrows,
  ScanSearch,
  Compass,
  Crosshair,
} from "lucide-react";
import {
  buildTrendSeries,
  comparePlatforms,
  platformDisplayName,
  rankContent,
  goalProgress,
  aggregateFailures,
  summarizePublishResults,
  generateContentOptimize,
  type ContentOptimizeSuggestion,
  detectAgingContent,
  forecastPerformance,
  buildPublishDecision,
  deriveRuleTags,
  type AgingContent,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 简单 SVG 折线图(纯手绘,无第三方依赖)。 */
function LineChart({
  points,
}: {
  points: readonly { day: string; views: number }[];
}) {
  const W = 520;
  const H = 120;
  const PAD = 8;
  if (points.length === 0) {
    return (
      <div className="dash-empty">
        <Activity size={16} aria-hidden /> 暂无趋势数据，请先在「效果回收」录入或导入
      </div>
    );
  }
  const max = Math.max(1, ...points.map((p) => p.views));
  const min = Math.min(0, ...points.map((p) => p.views));
  const range = max - min || 1;
  const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: PAD + i * stepX,
    y: H - PAD - ((p.views - min) / range) * (H - PAD * 2),
    p,
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${path} L${coords[coords.length - 1].x.toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dash-line" role="img" aria-label="阅读趋势折线图">
      <defs>
        <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dashArea)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c) => (
        <circle key={c.p.day} cx={c.x} cy={c.y} r="3" fill="var(--accent)">
          <title>{`${c.p.day}: ${c.p.views} 阅读`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** 条形对比图(纯 div 宽度百分比,无依赖)。 */
function BarRow({ label, value, max, suffix }: { label: string; value: number; max: number; suffix: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="dash-bar-row">
      <span className="dash-bar-label">{label}</span>
      <div className="dash-bar-track">
        <div className="dash-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="dash-bar-value">
        {value.toFixed(1)}
        {suffix}
      </span>
    </div>
  );
}

export function DashboardDrawer({ open, onOpenChange }: Props) {
  const performanceRecords = useStore((s) => s.performanceRecords);
  const jobs = useStore((s) => s.jobs);
  const wordGoal = useStore((s) => s.wordGoal);
  const retryJobPlatform = useStore((s) => s.retryJobPlatform);
  const loadPerformance = useStore((s) => s.loadPerformance);
  const loadJobs = useStore((s) => s.loadJobs);

  const [monthlyViewsGoal, setMonthlyViewsGoal] = useState(0);
  const [monthlyPostsGoal, setMonthlyPostsGoal] = useState(0);
  const [retrying, setRetrying] = useState<{ jobId: string; platformId: string } | null>(null);
  // OPT-01/02:内容优化建议 + 最佳发布时间学习。
  const markdown = useStore((s) => s.markdown);
  const setMarkdown = useStore((s) => s.setMarkdown);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<{
    suggestions: readonly ContentOptimizeSuggestion[];
    summary: string;
    usedLlm: boolean;
    bestTime: {
      hasData: boolean;
      hour: number | null;
      views: number;
      count: number;
      description: string;
      buckets: readonly { hour: number; views: number; count: number }[];
    };
  } | null>(null);
  // 撤销栈:应用一条优化修复后入栈,支持一键撤销。
  const [optimizeUndo, setOptimizeUndo] = useState<{ text: string; index: number } | null>(null);

  // ---- v9 内容生命周期(LC-01/02/03) ----
  const [agingResult, setAgingResult] = useState<{ items: readonly AgingContent[]; summary: string; safeFallback: boolean } | null>(null);
  const [agingScanning, setAgingScanning] = useState(false);
  // 复用片段检索。
  const [fragmentQuery, setFragmentQuery] = useState("");
  const [fragments, setFragments] = useState<readonly import("@mpp/core").ContentFragment[]>([]);

  // ---- v9 发布效果预测(FORECAST-01/02) ----
  const [forecastResult, setForecastResult] = useState<import("@mpp/core").ForecastResult | null>(null);
  const [forecasting, setForecasting] = useState(false);

  // ---- v10 标签筛选 / 内容矩阵 / 发布后运营 ----
  const [tagQuery, setTagQuery] = useState("");
  const [matrixResult, setMatrixResult] = useState<import("@mpp/core").ContentMatrix | null>(null);
  const [loopResult, setLoopResult] = useState<import("@mpp/core").PostPublishLoop | null>(null);
  // v10 FOLLOWUP-NOTIFY:待跟进提醒开关 + 最近一次提醒摘要。
  const followUpReminderEnabled = useStore((s) => s.followUpReminderEnabled);
  const followUpReminderDigest = useStore((s) => s.followUpReminderDigest);
  const setFollowUpReminderEnabled = useStore((s) => s.setFollowUpReminderEnabled);
  const runFollowUpReminder = useStore((s) => s.runFollowUpReminder);
  const [reminderBusy, setReminderBusy] = useState(false);
  // v11 深化 GOAL-NOTIFY-01:目标达成提醒开关 + 最近一次提醒摘要 + 策略采纳。
  const goalReminderEnabled = useStore((s) => s.goalReminderEnabled);
  const goalReminderDigest = useStore((s) => s.goalReminderDigest);
  const setGoalReminderEnabled = useStore((s) => s.setGoalReminderEnabled);
  const runGoalReminder = useStore((s) => s.runGoalReminder);
  const adoptStrategyToQueue = useStore((s) => s.adoptStrategyToQueue);
  const currentDraftId = useStore((s) => s.currentDraftId);
  const [goalReminderBusy, setGoalReminderBusy] = useState(false);
  // 批量翻新入队(勾选老化条目)。
  const [selectedAging, setSelectedAging] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const refreshAndEnqueue = useStore((s) => s.refreshAndEnqueue);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);

  useEffect(() => {
    if (open) {
      void loadPerformance();
      void loadJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- 派生数据(全部为纯函数,无副作用) ----
  const trend = useMemo(() => buildTrendSeries(performanceRecords, 30), [performanceRecords]);
  const compare = useMemo(() => comparePlatforms(performanceRecords), [performanceRecords]);
  const ranking = useMemo(() => rankContent(performanceRecords, 10), [performanceRecords]);
  const goals = useMemo(
    () =>
      goalProgress(performanceRecords, {
        monthlyViewsGoal: monthlyViewsGoal || undefined,
        monthlyPostsGoal: monthlyPostsGoal || undefined,
      }),
    [performanceRecords, monthlyViewsGoal, monthlyPostsGoal],
  );
  const failures = useMemo(() => aggregateFailures(jobs), [jobs]);
  const summary = useMemo(() => summarizePublishResults(jobs), [jobs]);

  const doRetry = useCallback(
    async (jobId: string, platformId: string) => {
      setRetrying({ jobId, platformId });
      try {
        await retryJobPlatform(jobId, platformId);
        toast("已提交重试，可在任务面板查看进度");
        await loadJobs();
      } catch (err) {
        toast(err instanceof Error ? err.message : "重试失败");
      } finally {
        setRetrying(null);
      }
    },
    [retryJobPlatform, loadJobs],
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadPerformance(), loadJobs()]);
  }, [loadPerformance, loadJobs]);

  // OPT-01:生成内容优化建议(结合效果数据与当前内容)。
  const runOptimize = useCallback(async () => {
    setOptimizing(true);
    setOptimizeUndo(null);
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const result = await generateContentOptimize(llmAdapter, {
        title: deriveTitleFromMarkdown(markdown),
        markdown,
        performanceRecords,
      });
      setOptimizeResult({
        suggestions: result.suggestions,
        summary: result.summary,
        usedLlm: result.usedLlm,
        bestTime: result.bestTime,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "生成优化建议失败");
    } finally {
      setOptimizing(false);
    }
  }, [llm, llmConfigs, activeLlmConfigId, markdown, performanceRecords]);

  // OPT-01:一键应用某条建议的修复动作(可撤销)。
  const applyOptimizeFix = useCallback(
    (suggestion: ContentOptimizeSuggestion, index: number) => {
      if (!suggestion.fix) return;
      const applied = suggestion.fix.apply(markdown);
      if (applied === markdown) {
        toast("内容没有变化，无需应用");
        return;
      }
      setOptimizeUndo({ text: markdown, index });
      setMarkdown(applied);
      toast(`已应用：${suggestion.fix.description}`);
    },
    [markdown, setMarkdown],
  );

  // OPT-01:撤销最近一次应用的优化修复。
  const undoOptimizeFix = useCallback(() => {
    if (!optimizeUndo) {
      toast("没有可撤销的优化操作");
      return;
    }
    setMarkdown(optimizeUndo.text);
    setOptimizeUndo(null);
    toast("已撤销优化修改");
  }, [optimizeUndo, setMarkdown]);

  // ---- v9 LC-01:扫描内容老化 ----
  const scanAging = useCallback(() => {
    setAgingScanning(true);
    try {
      const result = detectAgingContent(performanceRecords);
      setAgingResult({ items: result.items, summary: result.summary, safeFallback: result.safeFallback });
    } catch (err) {
      toast(err instanceof Error ? err.message : "扫描老化内容失败");
    } finally {
      setAgingScanning(false);
    }
  }, [performanceRecords]);

  // ---- v9 FORECAST-01:效果预测 ----
  const runForecast = useCallback(() => {
    setForecasting(true);
    try {
      const result = forecastPerformance(performanceRecords, {
        title: deriveTitleFromMarkdown(markdown),
        contentText: markdown,
        topN: 3,
      });
      setForecastResult(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "效果预测失败");
    } finally {
      setForecasting(false);
    }
  }, [performanceRecords, markdown]);

  // ---- v9 FORECAST-02:发布决策 ----
  const decision = useMemo(() => {
    if (!forecastResult) return null;
    return buildPublishDecision({
      forecast: forecastResult,
      allPassed: true,
    });
  }, [forecastResult]);

  // ---- v9 TAG-01:当前内容标签(规则) ----
  const contentTags = useMemo(() => deriveRuleTags({ title: deriveTitleFromMarkdown(markdown), contentText: markdown }), [markdown]);

  // ---- v9 LC-02:从当前内容抽取可复用片段 ----
  const extractFragments = useCallback(() => {
    // 从当前编辑器内容抽取片段(本地确定性,不依赖 LLM)。
    import("@mpp/core").then(({ extractContentFragments, searchFragments }) => {
      const draftId = useStore.getState().currentDraftId ?? "current";
      const title = deriveTitleFromMarkdown(markdown);
      const all = extractContentFragments(markdown, draftId, title);
      const hits = fragmentQuery.trim() ? searchFragments(all, fragmentQuery) : all;
      setFragments(hits);
      toast(all.length > 0 ? `已抽取 ${all.length} 个可复用片段` : "未抽取到可复用片段");
    });
  }, [markdown, fragmentQuery]);

  // ---- v10 MATRIX-01:构建内容矩阵 ----
  const runMatrix = useCallback(() => {
    try {
      import("@mpp/core").then(({ buildContentMatrix }) => {
        setMatrixResult(buildContentMatrix(performanceRecords));
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "构建内容矩阵失败");
    }
  }, [performanceRecords]);

  // ---- v10 LOOP-01:构建发布后运营视图 ----
  const runLoop = useCallback(() => {
    try {
      import("@mpp/core").then(({ buildPostPublishLoop }) => {
        setLoopResult(buildPostPublishLoop(performanceRecords));
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "生成发布后运营视图失败");
    }
  }, [performanceRecords]);

  // ---- v11 REFRESH-TRACK-01:翻新效果追踪 + v11 深化 REFRESH-TRACK-CLOSED-01:接入翻新入队自动打标 ----
  const [refreshTrack, setRefreshTrack] = useState<import("@mpp/core").RefreshTrackResult | null>(null);
  const [refreshTracing, setRefreshTracing] = useState(false);
  const refreshMarks = useStore((s) => s.refreshMarks);
  const trackRefresh = useCallback(() => {
    setRefreshTracing(true);
    try {
      import("@mpp/core").then(({ trackRefreshPerformance }) => {
        setRefreshTrack(trackRefreshPerformance(performanceRecords, { refreshMarks }));
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "追踪翻新效果失败");
    } finally {
      setRefreshTracing(false);
    }
  }, [performanceRecords, refreshMarks]);

  // ---- v11 ATTRIBUTE-01:效果归因分析 ----
  const [attributeResult, setAttributeResult] = useState<import("@mpp/core").AttributeResult | null>(null);
  const [attributing, setAttributing] = useState(false);
  const runAttribute = useCallback(() => {
    setAttributing(true);
    try {
      import("@mpp/core").then(({ attributePerformance }) => {
        setAttributeResult(attributePerformance(performanceRecords));
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "效果归因分析失败");
    } finally {
      setAttributing(false);
    }
  }, [performanceRecords]);

  // ---- v11 STRATEGY-01:内容策略主线 + GOAL-STRATEGY-01:策略对齐目标 ----
  const [strategyResult, setStrategyResult] = useState<import("@mpp/core").ContentStrategy | null>(null);
  const [goalProjection, setGoalProjection] = useState<import("@mpp/core").GoalAchievementProjection | null>(null);
  const [strategyBusy, setStrategyBusy] = useState(false);
  const runStrategy = useCallback(async () => {
    setStrategyBusy(true);
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      import("@mpp/core").then(async ({ buildContentStrategy, projectGoalAchievement }) => {
        const [strategy, goal] = await Promise.all([
          buildContentStrategy(performanceRecords, llmAdapter, {
            title: deriveTitleFromMarkdown(markdown),
            goalOptions: { monthlyViewsGoal: monthlyViewsGoal || undefined },
          }),
          projectGoalAchievement(performanceRecords, {
            monthlyViewsGoal: monthlyViewsGoal || undefined,
          }),
        ]);
        setStrategyResult(strategy);
        setGoalProjection(goal);
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "生成内容策略失败");
    } finally {
      setStrategyBusy(false);
    }
  }, [llm, llmConfigs, activeLlmConfigId, markdown, performanceRecords, monthlyViewsGoal]);

  // ---- v10 FOLLOWUP-NOTIFY:手动立即发送一次待跟进提醒(复用 NOTIFY 能力) ----
  const remindNow = useCallback(async () => {
    setReminderBusy(true);
    try {
      const result = await runFollowUpReminder(true);
      if (!result.ok) {
        toast(result.error ?? "提醒发送失败", "error");
      } else if (result.notified) {
        toast("已发送待跟进提醒", "success");
      } else {
        toast("暂无待跟进项，无需提醒", "info");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "提醒发送失败", "error");
    } finally {
      setReminderBusy(false);
    }
  }, [runFollowUpReminder]);

  // v11 深化 GOAL-NOTIFY-01:手动立即发送一次目标达成提醒(复用 NOTIFY 能力,force 绕过同日去重)。
  const remindGoalNow = useCallback(async () => {
    setGoalReminderBusy(true);
    try {
      const result = await runGoalReminder(true);
      if (!result.ok) {
        toast(result.error ?? "目标达成提醒发送失败", "error");
      } else if (result.notified) {
        toast("已发送目标达成提醒", "success");
      } else {
        toast("当前目标状态无需提醒(达成中/未设目标)", "info");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "目标达成提醒发送失败", "error");
    } finally {
      setGoalReminderBusy(false);
    }
  }, [runGoalReminder]);

  // v11 深化 STRATEGY-ADOPT-01:策略动作一键采纳到发布队列(默认用当前草稿 + 建议平台/时段)。
  const adoptStrategyStep = useCallback(
    async (s: import("@mpp/core").StrategyStep) => {
      if (!s.adoptable) {
        toast("该策略动作暂无可直接采纳的平台/时段", "info");
        return;
      }
      try {
        const result = await adoptStrategyToQueue({
          title: s.title,
          platformIds: s.platformId ? [s.platformId] : [],
          hour: s.hour ?? null,
          draftId: currentDraftId ?? undefined,
        });
        if (result.ok) toast(`已采纳「${s.title}」并排入发布队列`, "success");
        else toast(result.error ?? "采纳失败", "error");
      } catch (err) {
        toast(err instanceof Error ? err.message : "采纳策略动作失败", "error");
      }
    },
    [adoptStrategyToQueue, currentDraftId],
  );

  // ---- v10 TAG-FILTER-01:按标签筛选内容排行 ----
  const tagFilteredRanking = useMemo(() => {
    if (!tagQuery.trim()) return ranking.items;
    const q = tagQuery.trim().toLowerCase();
    return ranking.items.filter((item) => {
      const title = item.title.toLowerCase();
      return title.includes(q) || platformDisplayName(item.platformId).toLowerCase().includes(q);
    });
  }, [ranking, tagQuery]);

  // ---- v10 TAG-FILTER-01:各标签聚合表现 ----
  const tagAggregate = useMemo(() => {
    try {
      return import("@mpp/core").then(({ aggregateByTag }) => aggregateByTag(performanceRecords));
    } catch {
      return Promise.resolve({ tags: [] as readonly import("@mpp/core").TagAggregate[], safeFallback: true });
    }
  }, [performanceRecords]);
  const [tagAgg, setTagAgg] = useState<readonly import("@mpp/core").TagAggregate[]>([]);
  useEffect(() => {
    void tagAggregate.then((r) => setTagAgg(r.tags));
  }, [tagAggregate]);

  // ---- v10 REFRESH-QUEUE-01:批量翻新入队 ----
  const toggleAgingSelect = useCallback((key: string) => {
    setSelectedAging((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const doRefreshAndEnqueue = useCallback(async () => {
    if (!agingResult || selectedAging.size === 0) {
      toast("请先勾选要翻新的老化内容");
      return;
    }
    const items = agingResult.items.filter((it, idx) => selectedAging.has(`${it.title}-${idx}`));
    setRefreshing(true);
    try {
      const result = await refreshAndEnqueue({
        agingItems: items,
        platformIds: selectedPlatforms.length > 0 ? [...selectedPlatforms] : undefined,
      });
      if (result.ok) {
        toast(`已生成 ${result.planned} 条翻新计划,成功排入 ${result.enqueued} 篇`, "success");
        setSelectedAging(new Set());
      } else {
        toast(result.error ?? "翻新入队失败", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "翻新入队失败", "error");
    } finally {
      setRefreshing(false);
    }
  }, [agingResult, selectedAging, refreshAndEnqueue, selectedPlatforms]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dashboard-drawer" aria-label="运营驾驶舱">
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">
              <BarChart3 size={16} aria-hidden /> 运营驾驶舱
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={16} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="dialog-body dashboard-body">
            <button type="button" className="btn-ghost dash-refresh" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden /> 刷新
            </button>

            {/* 发布概览(EXEC-02) */}
            <section className="dash-section" aria-label="发布概览">
              <h3 className="dash-section-title">
                <Activity size={14} aria-hidden /> 发布概览
              </h3>
              {summary.hasData ? (
                <div className="dash-summary-grid">
                  <div className="dash-summary-item ok">
                    <CheckCircle2 size={14} aria-hidden />
                    <span>成功 {summary.succeeded}</span>
                  </div>
                  <div className="dash-summary-item fail">
                    <AlertTriangle size={14} aria-hidden />
                    <span>失败 {summary.failed}</span>
                  </div>
                  <div className="dash-summary-item">
                    <Hourglass size={14} aria-hidden />
                    <span>进行中 {summary.inProgress}</span>
                  </div>
                  <div className="dash-summary-item">
                    <MinusCircle size={14} aria-hidden />
                    <span>取消 {summary.cancelled}</span>
                  </div>
                  <div className="dash-summary-item">
                    <span>未知 {summary.unknown}</span>
                  </div>
                  <div className="dash-summary-item rate">
                    <span>成功率 {summary.successRate === null ? "—" : `${Math.round(summary.successRate * 100)}%`}</span>
                  </div>
                </div>
              ) : (
                <div className="dash-empty">暂无发布任务记录</div>
              )}
            </section>

            {/* 效果趋势(DASH-01) */}
            <section className="dash-section" aria-label="效果趋势">
              <h3 className="dash-section-title">
                <TrendingUp size={14} aria-hidden /> 效果趋势（近 {Math.min(30, trend.points.length || 0)} 天）
              </h3>
              {trend.points.length > 0 ? (
                <>
                  <LineChart points={trend.points} />
                  <div className="dash-meta">
                    总阅读 {trend.totalViews} · 总互动 {trend.totalEngagement}
                    {trend.peakDay ? ` · 峰值 ${trend.peakDay}（${trend.peakViews}）` : ""}
                  </div>
                </>
              ) : (
                <div className="dash-empty">暂无趋势数据，请先在「效果回收」录入或导入</div>
              )}
            </section>

            {/* 平台对比(DASH-02) */}
            <section className="dash-section" aria-label="平台对比">
              <h3 className="dash-section-title">
                <BarChart3 size={14} aria-hidden /> 平台对比
              </h3>
              {compare.hasData ? (
                <div className="dash-compare">
                  {compare.items.map((it) => (
                    <BarRow
                      key={it.platformId}
                      label={platformDisplayName(it.platformId)}
                      value={it.avgViews}
                      max={compare.items[0]?.avgViews ?? 1}
                      suffix=""
                    />
                  ))}
                  <div className="dash-meta">
                    最佳阅读 {compare.bestByViews ? platformDisplayName(compare.bestByViews) : "—"}
                    {" · "}最佳互动率{" "}
                    {compare.bestByEngagement ? platformDisplayName(compare.bestByEngagement) : "—"}
                  </div>
                </div>
              ) : (
                <div className="dash-empty">暂无平台数据</div>
              )}
            </section>

            {/* 内容排行(DASH-03) + v10 TAG-FILTER-01:按标签/关键词筛选 */}
            <section className="dash-section" aria-label="内容排行">
              <h3 className="dash-section-title">
                <Trophy size={14} aria-hidden /> 内容排行 Top {tagFilteredRanking.length}
              </h3>
              <input
                className="dash-fragment-input"
                placeholder="按关键词/平台筛选排行…"
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
              />
              {tagFilteredRanking.length > 0 ? (
                <ol className="dash-ranking">
                  {tagFilteredRanking.map((it, idx) => (
                    <li key={it.id} className="dash-ranking-item">
                      <span className="dash-rank-no">{idx + 1}</span>
                      <span className="dash-rank-title" title={it.title}>
                        {it.title}
                      </span>
                      <span className="dash-rank-platform">{platformDisplayName(it.platformId)}</span>
                      <span className="dash-rank-views">{it.views} 阅读</span>
                      {it.remoteUrl ? (
                        <a href={it.remoteUrl} target="_blank" rel="noreferrer" className="dash-rank-link">
                          打开
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="dash-empty">{ranking.hasData ? "没有匹配的内容" : "暂无内容数据"}</div>
              )}
            </section>

            {/* 目标进度(DASH-04) */}
            <section className="dash-section" aria-label="目标进度">
              <h3 className="dash-section-title">
                <Target size={14} aria-hidden /> 目标进度（本月）
              </h3>
              <div className="dash-goals">
                {goals.map((g) => (
                  <div key={g.label} className="dash-goal">
                    <div className="dash-goal-head">
                      <span>{g.label}</span>
                      <span>
                        {g.actual} / {g.hasGoal ? g.goal : "未设定"}
                        {g.achieved ? " ✅" : ""}
                      </span>
                    </div>
                    <div className="dash-goal-track">
                      <div
                        className={`dash-goal-fill${g.achieved ? " achieved" : ""}`}
                        style={{ width: `${Math.round(g.progress * 100)}%` }}
                      />
                    </div>
                    <div className="dash-goal-meta">
                      {g.hasGoal
                        ? g.achieved
                          ? "已达成"
                          : `还差 ${g.remaining}`
                        : "请在下方设定目标"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="dash-goal-inputs">
                <label>
                  月阅读目标
                  <input
                    type="number"
                    min={0}
                    value={monthlyViewsGoal || ""}
                    placeholder={String(wordGoal || 0)}
                    onChange={(e) => setMonthlyViewsGoal(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label>
                  月发布目标
                  <input
                    type="number"
                    min={0}
                    value={monthlyPostsGoal || ""}
                    onChange={(e) => setMonthlyPostsGoal(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </div>
            </section>

            {/* 发布健康(EXEC-01) */}
            <section className="dash-section" aria-label="发布健康">
              <h3 className="dash-section-title">
                <Activity size={14} aria-hidden /> 发布健康
              </h3>
              {failures.hasData ? (
                <table className="dash-fail-table">
                  <thead>
                    <tr>
                      <th>平台</th>
                      <th>原因</th>
                      <th>数量</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.aggregates.map((a) => (
                      <tr key={a.key}>
                        <td>{platformDisplayName(a.platformId)}</td>
                        <td className="dash-fail-reason">
                          {a.reason}
                          {a.kind === "unknown" ? "（未知，需人工核对）" : ""}
                          {a.kind === "needs-user-action" ? "（待人工处理）" : ""}
                        </td>
                        <td>{a.count}</td>
                        <td>
                          {a.retryable ? (
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={!!retrying}
                              onClick={() => {
                                const target = failures.retryableJobs.find(
                                  (rj) => rj.platformId === a.platformId,
                                );
                                if (target) void doRetry(target.jobId, target.platformId);
                              }}
                            >
                              {retrying ? <Loader2 size={12} className="spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />}{" "}
                              重试
                            </button>
                          ) : (
                            <span className="dash-no-retry">不可自动重试</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="dash-empty">暂无失败/待处理任务，发布链路健康</div>
              )}
            </section>

            {/* 内容优化建议(OPT-01)+ 最佳发布时间(OPT-02) */}
            <section className="dash-section" aria-label="内容优化建议">
              <h3 className="dash-section-title">
                <Lightbulb size={14} aria-hidden /> 内容优化建议（OPT-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">
                  结合效果数据与当前内容生成可执行优化建议
                  {llm.baseUrl && llm.apiKey && llm.model ? ` · LLM(${llm.model})` : " · 规则模式(未配置 LLM)"}
                </span>
                <div className="dash-optimize-actions">
                  {optimizeUndo && (
                    <button type="button" className="btn-ghost" onClick={undoOptimizeFix}>
                      <Undo2 size={13} aria-hidden /> 撤销
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => void runOptimize()}
                    disabled={optimizing}
                  >
                    {optimizing ? (
                      <Loader2 size={14} className="spin" aria-hidden />
                    ) : (
                      <Wand2 size={14} aria-hidden />
                    )}
                    {optimizing ? "生成中…" : "生成优化建议"}
                  </button>
                </div>
              </div>

              {!optimizeResult ? (
                <div className="dash-empty">
                  点击「生成优化建议」,结合效果数据与当前内容得到可执行的优化建议(可一键应用/撤销)
                </div>
              ) : (
                <>
                  <div className="dash-optimize-summary">
                    {optimizeResult.summary}
                    {optimizeResult.usedLlm ? " · LLM 增强" : " · 规则兜底"}
                  </div>
                  <div className="dash-optimize-list">
                    {optimizeResult.suggestions.map((s, idx) => (
                      <div key={s.id} className={`dash-opt-item dash-opt-${s.severity}`}>
                        <span className="dash-opt-kind">{optimizeKindLabel(s.kind)}</span>
                        <span className="dash-opt-msg">{s.message}</span>
                        {s.source === "llm" ? <span className="dash-opt-source">LLM</span> : null}
                        {s.fix ? (
                          <button
                            type="button"
                            className="btn-ghost dash-opt-fix"
                            onClick={() => applyOptimizeFix(s, idx)}
                          >
                            <Wand2 size={12} aria-hidden /> 应用
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* 最佳发布时间学习(OPT-02) */}
            <section className="dash-section" aria-label="最佳发布时间">
              <h3 className="dash-section-title">
                <Clock3 size={14} aria-hidden /> 最佳发布时间（OPT-02）
              </h3>
              {!optimizeResult ? (
                <div className="dash-empty">生成优化建议后,这里会展示从历史效果学习到的最佳发布时段</div>
              ) : !optimizeResult.bestTime.hasData ? (
                <div className="dash-empty">{optimizeResult.bestTime.description}</div>
              ) : (
                <>
                  <div className="dash-opt-time">
                    <strong>{optimizeResult.bestTime.hour}:00 前后(UTC)</strong>
                    <span>共 {optimizeResult.bestTime.count} 条记录 · {optimizeResult.bestTime.views} 阅读</span>
                  </div>
                  <div className="dash-opt-time-buckets">
                    {optimizeResult.bestTime.buckets.map((b) => (
                      <span
                        key={b.hour}
                        className={`dash-opt-bucket${b.hour === optimizeResult.bestTime.hour ? " peak" : ""}`}
                        title={`${b.hour}:00 · ${b.views} 阅读 / ${b.count} 条`}
                        style={{
                          height: `${bestTimeBarHeight(b.views, optimizeResult.bestTime.views)}px`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="dash-meta">{optimizeResult.bestTime.description}</div>
                </>
              )}
            </section>

            {/* v9 LC-01/02:内容生命周期 */}
            <section className="dash-section" aria-label="内容生命周期">
              <h3 className="dash-section-title">
                <Recycle size={14} aria-hidden /> 内容生命周期（LC-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">检测老化内容并生成翻新 / 复用建议</span>
                <div className="dash-optimize-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={scanAging}
                    disabled={agingScanning}
                  >
                    {agingScanning ? <Loader2 size={14} className="spin" aria-hidden /> : <Recycle size={14} aria-hidden />}
                    {agingScanning ? "扫描中…" : "扫描老化内容"}
                  </button>
                </div>
              </div>

              {!agingResult ? (
                <div className="dash-empty">点击「扫描老化内容」,基于效果数据检测已发布内容的老化情况</div>
              ) : agingResult.safeFallback ? (
                <div className="dash-empty">{agingResult.summary}</div>
              ) : (
                <>
                  <div className="dash-optimize-summary">{agingResult.summary}</div>
                  <div className="dash-optimize-actions" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => void doRefreshAndEnqueue()}
                      disabled={refreshing || selectedAging.size === 0}
                    >
                      {refreshing ? <Loader2 size={14} className="spin" aria-hidden /> : <Send size={14} aria-hidden />}
                      {refreshing ? "翻新入队中…" : `批量翻新入队(${selectedAging.size})`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setSelectedAging(new Set())}
                      disabled={selectedAging.size === 0}
                    >
                      清空选择
                    </button>
                  </div>
                  <div className="dash-opt-list">
                    {agingResult.items.map((it, idx) => (
                      <div
                        key={`${it.title}-${idx}`}
                        className={`dash-opt-item dash-opt-${it.severity}`}
                        onClick={(e) => {
                          if (it.action !== "refresh") return;
                          if ((e.target as HTMLElement).tagName === "INPUT") return;
                          toggleAgingSelect(`${it.title}-${idx}`);
                        }}
                        role={it.action === "refresh" ? "button" : undefined}
                      >
                        {it.action === "refresh" ? (
                          <input
                            type="checkbox"
                            className="dash-opt-check"
                            checked={selectedAging.has(`${it.title}-${idx}`)}
                            onChange={() => toggleAgingSelect(`${it.title}-${idx}`)}
                            aria-label={`勾选翻新 ${it.title}`}
                          />
                        ) : null}
                        <span className="dash-opt-kind">{agingActionLabel(it.action)}</span>
                        <span className="dash-opt-msg">
                          <strong>{it.title}</strong>
                          <span className="dash-opt-sub">
                            {it.ageDays} 天前 · {it.totalViews} 阅读
                            {it.reuseWindow ? ` · 建议 ${it.reuseWindow[0]}-${it.reuseWindow[1]} 天后再发` : ""}
                          </span>
                          <span className="dash-opt-sub">{it.reasons.join("；")}</span>
                        </span>
                        <span className="dash-opt-source">{agingSeverityLabel(it.severity)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* v9 LC-02:内容片段复用库 */}
            <section className="dash-section" aria-label="内容片段复用">
              <h3 className="dash-section-title">
                <Sparkles size={14} aria-hidden /> 内容片段复用（LC-02）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">从当前内容抽取金句 / 段落 / 标题供复用</span>
                <div className="dash-optimize-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={extractFragments}>
                    <Search size={14} aria-hidden /> 抽取片段
                  </button>
                </div>
              </div>
              <input
                className="dash-fragment-input"
                placeholder="搜索片段关键词…"
                value={fragmentQuery}
                onChange={(e) => setFragmentQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") extractFragments();
                }}
              />
              {fragments.length === 0 ? (
                <div className="dash-empty">点击「抽取片段」从当前内容提取可复用片段</div>
              ) : (
                <div className="dash-opt-list">
                  {fragments.slice(0, 8).map((f) => (
                    <div key={f.id} className="dash-opt-item dash-opt-info">
                      <span className="dash-opt-kind">{fragmentKindLabel(f.kind)}</span>
                      <span className="dash-opt-msg">
                        <span className="dash-fragment-text">{f.text}</span>
                        <span className="dash-opt-sub">{f.charCount} 字 · {f.sourceTitle}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* v9 FORECAST-01/02:发布效果预测 */}
            <section className="dash-section" aria-label="发布效果预测">
              <h3 className="dash-section-title">
                <TrendingUp size={14} aria-hidden /> 发布效果预测（FORECAST）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">从历史效果学习预期阅读区间与推荐平台</span>
                <div className="dash-optimize-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={runForecast}
                    disabled={forecasting}
                  >
                    {forecasting ? <Loader2 size={14} className="spin" aria-hidden /> : <TrendingUp size={14} aria-hidden />}
                    {forecasting ? "预测中…" : "效果预测"}
                  </button>
                </div>
              </div>
              {!forecastResult ? (
                <div className="dash-empty">点击「效果预测」,基于历史数据预估发布效果</div>
              ) : forecastResult.safeFallback ? (
                <div className="dash-empty">{forecastResult.summary}</div>
              ) : (
                <>
                  <div className="dash-optimize-summary">{forecastResult.summary}</div>
                  <div className="dash-forecast-list">
                    {forecastResult.platforms.map((p) => (
                      <div key={p.platformId} className="dash-forecast-row">
                        <span className="dash-forecast-name">{platformDisplayName(p.platformId)}</span>
                        <span className="dash-forecast-range">
                          {p.range.lower}~{p.range.upper} 阅读
                        </span>
                        <span className="dash-forecast-meta">
                          {p.sampleCount} 样本 · 置信 {Math.round(p.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                  {decision ? (
                    <div className={`dash-decision dash-decision-${decision.kind}`}>
                      <strong>{decisionLabel(decision.kind)}</strong>
                      <span>{decision.reason}</span>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {/* v9 TAG-01:统一内容标签 + v10 TAG-FILTER-01:标签聚合表现 */}
            <section className="dash-section" aria-label="内容标签">
              <h3 className="dash-section-title">
                <Tags size={14} aria-hidden /> 内容标签（TAG-01）
              </h3>
              <div className="dash-optimize-hint" style={{ marginBottom: 8 }}>
                当前内容的自动标签(规则派生)
              </div>
              {contentTags.length === 0 ? (
                <div className="dash-empty">输入标题或正文后自动生成标签</div>
              ) : (
                <div className="dash-tag-list">
                  {contentTags.map((t) => (
                    <span key={t} className="dash-tag">
                      <Tags size={10} aria-hidden /> {t}
                    </span>
                  ))}
                </div>
              )}
              {tagAgg.length > 0 ? (
                <>
                  <div className="dash-optimize-hint" style={{ margin: "10px 0 6px" }}>
                    各标签聚合表现(按阅读量排序)
                  </div>
                  <div className="dash-opt-list">
                    {tagAgg.slice(0, 8).map((t) => (
                      <div key={t.tag} className="dash-opt-item dash-opt-info">
                        <span className="dash-opt-kind">{t.tag}</span>
                        <span className="dash-opt-msg">
                          <span className="dash-opt-sub">
                            {t.count} 篇 · {t.views} 阅读 · 均互动 {t.avgEngagement}
                          </span>
                        </span>
                        <span className="dash-opt-source">均阅 {t.avgViews}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>

            {/* v10 MATRIX-01:内容矩阵 */}
            <section className="dash-section" aria-label="内容矩阵">
              <h3 className="dash-section-title">
                <LayoutGrid size={14} aria-hidden /> 内容矩阵（MATRIX-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">跨平台内容覆盖与标签维度表现</span>
                <div className="dash-optimize-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={runMatrix}>
                    <LayoutGrid size={14} aria-hidden /> 构建矩阵
                  </button>
                </div>
              </div>
              {!matrixResult ? (
                <div className="dash-empty">点击「构建矩阵」查看跨平台内容覆盖与健康度</div>
              ) : matrixResult.safeFallback ? (
                <div className="dash-empty">{matrixResult.summary}</div>
              ) : (
                <>
                  <div className="dash-optimize-summary">{matrixResult.summary}</div>
                  <div className={`dash-health dash-health-${matrixResult.health}`}>{matrixResult.healthNote}</div>
                  <div className="dash-opt-list">
                    {matrixResult.platformCoverage.map((p) => (
                      <div key={p.platformId} className="dash-opt-item dash-opt-info">
                        <span className="dash-opt-kind">{platformDisplayName(p.platformId)}</span>
                        <span className="dash-opt-msg">
                          <span className="dash-opt-sub">{p.count} 篇 · {p.views} 阅读</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* v10 LOOP-01:发布后运营 */}
            <section className="dash-section" aria-label="发布后运营">
              <h3 className="dash-section-title">
                <MessagesSquare size={14} aria-hidden /> 发布后运营（LOOP-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">评论/互动趋势与待跟进清单</span>
                <div className="dash-optimize-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={runLoop}>
                    <MessagesSquare size={14} aria-hidden /> 生成运营视图
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void remindNow()}
                    disabled={reminderBusy}
                  >
                    {reminderBusy ? <Loader2 size={14} className="spin" aria-hidden /> : <Bell size={14} aria-hidden />}
                    提醒我
                  </button>
                </div>
              </div>
              {/* v10 FOLLOWUP-NOTIFY:待跟进提醒开关(复用 NOTIFY 能力,心跳自动检查) */}
              <div className="dash-opt-item dash-opt-info" style={{ marginBottom: 8 }}>
                <span className="dash-opt-kind">
                  <Bell size={10} aria-hidden /> 提醒
                </span>
                <span className="dash-opt-msg">
                  <label className="dash-remind-toggle" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={followUpReminderEnabled}
                      onChange={(e) => setFollowUpReminderEnabled(e.target.checked)}
                      aria-label="开启待跟进提醒"
                    />
                    自动提醒待跟进项(每分钟心跳检查,同日不重复;点击通知直达效果回收)
                  </label>
                  {followUpReminderDigest && (
                    <span className="dash-opt-sub">
                      最近检查:{followUpReminderDigest.summary}
                      {followUpReminderDigest.shouldNotify ? " · 已发送提醒" : " · 无需提醒"}
                    </span>
                  )}
                </span>
              </div>
              {!loopResult ? (
                <div className="dash-empty">点击「生成运营视图」查看发布后的互动趋势与待跟进项</div>
              ) : loopResult.safeFallback ? (
                <div className="dash-empty">{loopResult.summary}</div>
              ) : (
                <>
                  <div className="dash-optimize-summary">{loopResult.summary}</div>
                  {loopResult.dataGapNote ? <div className="dash-health dash-health-gaps">{loopResult.dataGapNote}</div> : null}
                  {loopResult.followUps.length === 0 ? (
                    <div className="dash-empty">暂无待跟进项,所有内容互动正常</div>
                  ) : (
                    <div className="dash-opt-list">
                      {loopResult.followUps.slice(0, 8).map((f, idx) => (
                        <div key={`${f.title}-${idx}`} className={`dash-opt-item dash-opt-${f.kind === "high-engagement" ? "high" : f.kind === "low-engagement" ? "warning" : "info"}`}>
                          <span className="dash-opt-kind">
                            {f.kind === "high-engagement" ? "待回复" : f.kind === "low-engagement" ? "待复盘" : "数据缺口"}
                          </span>
                          <span className="dash-opt-msg">
                            <strong>{f.title}</strong>
                            <span className="dash-opt-sub">
                              {platformDisplayName(f.platformId)} · {f.views} 阅读 · 互动 {f.engagement}
                            </span>
                            <span className="dash-opt-sub">{f.note}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* v11 REFRESH-TRACK-01:翻新效果追踪 */}
            <section className="dash-section" aria-label="翻新效果追踪">
              <h3 className="dash-section-title">
                <GitCompareArrows size={14} aria-hidden /> 翻新效果追踪（REFRESH-TRACK-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">翻新重发后与原版效果对照</span>
                <div className="dash-optimize-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={trackRefresh} disabled={refreshTracing}>
                    {refreshTracing ? <Loader2 size={14} className="spin" aria-hidden /> : <GitCompareArrows size={14} aria-hidden />}
                    追踪翻新效果
                  </button>
                </div>
              </div>
              {!refreshTrack ? (
                <div className="dash-empty">点击「追踪翻新效果」查看翻新重发后与原版的对照</div>
              ) : refreshTrack.safeFallback ? (
                <div className="dash-empty">{refreshTrack.summary}</div>
              ) : (
                <>
                  <div className="dash-optimize-summary">
                    {refreshTrack.summary}
                    {refreshTrack.avgViewDeltaRate !== null && (
                      <span className="dash-opt-sub">平均阅读变化率 {(refreshTrack.avgViewDeltaRate * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  <div className="dash-opt-list">
                    {refreshTrack.comparisons.slice(0, 8).map((c, idx) => (
                      <div
                        key={`${c.refreshedTitle}-${idx}`}
                        className={`dash-opt-item ${
                          c.outcome === "improved" ? "dash-opt-high" : c.outcome === "declined" ? "dash-opt-warning" : "dash-opt-info"
                        }`}
                      >
                        <span className="dash-opt-kind">
                          {c.outcome === "improved" ? "提升" : c.outcome === "declined" ? "下降" : c.outcome === "flat" ? "持平" : "未配对"}
                        </span>
                        <span className="dash-opt-msg">
                          <strong>{c.refreshedTitle}</strong>
                          <span className="dash-opt-sub">
                            {platformDisplayName(c.platformId)} · 原版 {c.original ? `${c.original.metrics.views ?? "?"} 阅读` : "未配对"} → 翻新 {c.refreshed.metrics.views ?? "?"} 阅读
                          </span>
                          {c.viewDeltaRate !== null && (
                            <span className="dash-opt-sub">
                              阅读变化 {(c.viewDeltaRate * 100).toFixed(0)}%{c.engagementDelta !== null ? ` · 互动变化 ${c.engagementDelta >= 0 ? "+" : ""}${c.engagementDelta}` : ""}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* v11 ATTRIBUTE-01:效果归因分析 */}
            <section className="dash-section" aria-label="效果归因">
              <h3 className="dash-section-title">
                <ScanSearch size={14} aria-hidden /> 效果归因（ATTRIBUTE-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">平台 / 时段 / 标题风格 / 主题 维度差异</span>
                <div className="dash-optimize-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={runAttribute} disabled={attributing}>
                    {attributing ? <Loader2 size={14} className="spin" aria-hidden /> : <ScanSearch size={14} aria-hidden />}
                    归因分析
                  </button>
                </div>
              </div>
              {!attributeResult ? (
                <div className="dash-empty">点击「归因分析」查看高/低表现特征的差异来源</div>
              ) : attributeResult.safeFallback ? (
                <div className="dash-empty">{attributeResult.summary}</div>
              ) : (
                <>
                  <div className="dash-optimize-summary">{attributeResult.summary}</div>
                  <div className="dash-opt-list">
                    {attributeResult.factors.slice(0, 6).map((f, idx) => (
                      <div key={`${f.dimension}-${idx}`} className="dash-opt-item dash-opt-info">
                        <span className="dash-opt-kind">{f.label}</span>
                        <span className="dash-opt-msg">
                          <span className="dash-opt-sub">
                            高表现 <strong>{f.highFeature}</strong>({f.highAvgViews} 平均阅读 / {f.highCount} 篇)
                          </span>
                          <span className="dash-opt-sub">
                            低表现 <strong>{f.lowFeature}</strong>({f.lowAvgViews} 平均阅读 / {f.lowCount} 篇)
                            {f.ratio !== null ? ` · ${f.ratio.toFixed(1)}x` : ""}
                          </span>
                          <span className="dash-opt-sub">{f.note}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* v11 STRATEGY-01:内容策略主线 + GOAL-STRATEGY-01:策略对齐目标 */}
            <section className="dash-section" aria-label="内容策略">
              <h3 className="dash-section-title">
                <Compass size={14} aria-hidden /> 内容策略（STRATEGY-01 + GOAL-STRATEGY-01）
              </h3>
              <div className="dash-optimize-head">
                <span className="dash-optimize-hint">现状 → 归因 → 下一步行动,并对齐目标</span>
                <div className="dash-optimize-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void runStrategy()} disabled={strategyBusy}>
                    {strategyBusy ? <Loader2 size={14} className="spin" aria-hidden /> : <Compass size={14} aria-hidden />}
                    生成策略
                  </button>
                </div>
              </div>
              {!strategyResult && !goalProjection ? (
                <div className="dash-empty">点击「生成策略」查看内容策略主线与目标达成预测</div>
              ) : (
                <>
                  {goalProjection && (
                    <div className={`dash-opt-item dash-opt-${goalProjection.status === "on-track" ? "high" : goalProjection.status === "at-risk" ? "warning" : "info"}`}>
                      <span className="dash-opt-kind">
                        <Crosshair size={10} aria-hidden /> 目标
                      </span>
                      <span className="dash-opt-msg">
                        <span className="dash-opt-sub">{goalProjection.summary}</span>
                        <span className="dash-opt-sub">
                          达成预测 {(goalProjection.projection * 100).toFixed(0)}% · 缺口 {goalProjection.gap}
                          {goalProjection.postsNeeded > 0 ? ` · 需加发约 ${goalProjection.postsNeeded} 篇` : ""}
                        </span>
                      </span>
                    </div>
                  )}
                  {/* v11 深化 GOAL-NOTIFY-01:目标达成预警接入提醒(心跳 at-risk/off-track 提醒 + 建议动作直达) */}
                  <div className="dash-opt-item dash-opt-info" style={{ marginBottom: 8 }}>
                    <span className="dash-opt-kind">
                      <Bell size={10} aria-hidden /> 提醒
                    </span>
                    <span className="dash-opt-msg">
                      <label className="dash-remind-toggle" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={goalReminderEnabled}
                          onChange={(e) => setGoalReminderEnabled(e.target.checked)}
                          aria-label="开启目标达成提醒"
                        />
                        目标达成预警(at-risk / off-track 时心跳提醒;点击通知直达本面板)
                      </label>
                      {goalReminderDigest && (
                        <span className="dash-opt-sub">
                          最近检查:{goalReminderDigest.summary}
                          {goalReminderDigest.shouldNotify ? " · 已发送预警" : " · 无需提醒"}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void remindGoalNow()}
                        disabled={goalReminderBusy}
                        style={{ marginTop: 4 }}
                      >
                        {goalReminderBusy ? <Loader2 size={12} className="spin" aria-hidden /> : <Bell size={12} aria-hidden />}
                        立即检查
                      </button>
                    </span>
                  </div>
                  {strategyResult && (
                    <>
                      <div className="dash-optimize-summary">
                        {strategyResult.summary}
                        {strategyResult.usedLlm ? <span className="dash-opt-sub">LLM 增强</span> : <span className="dash-opt-sub">规则模式</span>}
                      </div>
                      {strategyResult.situation && <div className="dash-opt-sub" style={{ padding: "4px 0" }}>{strategyResult.situation}</div>}
                      {strategyResult.attribution && <div className="dash-opt-sub" style={{ padding: "4px 0" }}>{strategyResult.attribution}</div>}
                      <div className="dash-opt-list">
                        {strategyResult.steps.slice(0, 6).map((s, idx) => (
                          <div key={`${s.title}-${idx}`} className="dash-opt-item dash-opt-info">
                            <span className="dash-opt-kind">{s.source === "llm" ? "AI" : "规则"}</span>
                            <span className="dash-opt-msg">
                              <strong>{s.title}</strong>
                              <span className="dash-opt-sub">{s.detail}</span>
                              <span className="dash-opt-sub">依据:{s.basis}{s.platformId ? ` · 平台 ${platformDisplayName(s.platformId)}` : ""}{s.hour !== undefined ? ` · ${s.hour}:00 前后` : ""}</span>
                            </span>
                            {s.adoptable ? (
                              <button
                                type="button"
                                className="btn-ghost dash-opt-fix"
                                onClick={() => void adoptStrategyStep(s)}
                              >
                                <Send size={12} aria-hidden /> 采纳到发布队列
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 优化建议类型的人类可读标签。 */
function optimizeKindLabel(kind: ContentOptimizeSuggestion["kind"]): string {
  switch (kind) {
    case "title":
      return "标题";
    case "body":
      return "正文";
    case "image":
      return "配图";
    case "heading":
      return "小标题";
    case "timing":
      return "时段";
    case "strategy":
      return "策略";
    case "data-gap":
      return "数据";
    case "llm":
      return "AI";
  }
}

/** 老化动作的人类可读标签。 */
function agingActionLabel(action: import("@mpp/core").AgingActionKind): string {
  switch (action) {
    case "refresh":
      return "翻新";
    case "reuse":
      return "复用";
    case "retire":
      return "下线";
  }
}

/** 老化严重度的人类可读标签。 */
function agingSeverityLabel(severity: import("@mpp/core").AgingSeverity): string {
  switch (severity) {
    case "high":
      return "高优先";
    case "medium":
      return "中优先";
    case "low":
      return "低优先";
  }
}

/** 片段类型的人类可读标签。 */
function fragmentKindLabel(kind: import("@mpp/core").FragmentKind): string {
  switch (kind) {
    case "heading":
      return "标题";
    case "paragraph":
      return "段落";
    case "quote":
      return "金句";
    case "list":
      return "列表";
    case "key-point":
      return "要点";
  }
}

/** 发布决策类型的人类可读标签。 */
function decisionLabel(kind: import("@mpp/core").PublishDecisionKind): string {
  switch (kind) {
    case "publish-now":
      return "立即发布";
    case "reschedule":
      return "改期发布";
    case "optimize-first":
      return "先优化再发";
    case "skip":
      return "暂不发布";
  }
}

/** 最佳发布时间柱高(最少 4px 保证可见)。 */
function bestTimeBarHeight(views: number, max: number): number {
  if (max <= 0) return 4;
  return Math.max(4, Math.round((views / max) * 48));
}

/** 从 Markdown 首行 # 标题或首行提取草稿标题。 */
function deriveTitleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 30) : "";
}
