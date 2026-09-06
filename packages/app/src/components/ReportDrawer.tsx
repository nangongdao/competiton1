/**
 * v3 · 发布复盘报告 + v4 Phase 2 · 内容智能周报自动化(WEEKLY-04)。
 *
 * REP-03 增强:
 * - 支持模板:综合复盘 / 周报 / 月报 / 平台专项;
 * - 导出格式:Markdown(.md) / HTML(.html) / PDF(打印对话框);
 * - 可选:先生成 LLM 策略建议(走 AI 连接中心),再合并进报告;
 * - 全 Lucide 图标,懒加载拆包。
 *
 * WEEKLY-04 增强:
 * - 「周报自动化」区:创建/编辑定时周报任务(模板/窗口/投递渠道/LLM 开关)、
 *   手动立即生成、最近执行历史;
 * - 投递渠道:文件(客户端导出) / 邮件(server SMTP) / Webhook(server 白名单);
 * - 复用报告模板与导出能力。
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X, FileDown, Copy, Check, Sparkles, Loader2, FileText, FileCode2, Printer, CalendarRange,
  Send, Mail, Webhook, Trash2, Pause, Play, Plus, RefreshCw, RotateCcw, FileClock,
} from "lucide-react";
import {
  buildPerformanceReport, generatePublishStrategy, reportMarkdownToHtml, REPORT_TEMPLATE_LABELS,
  summarizeReportWithLlm, type ReportAiInsight,
  type ReportTemplate, type WeeklyDelivery, type WeeklyDeliveryKind,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TEMPLATES: readonly ReportTemplate[] = ["overview", "weekly", "monthly", "platform"];
const WEEKLY_TEMPLATES: readonly ReportTemplate[] = ["weekly", "monthly", "overview", "platform"];

export function ReportDrawer({ open, onOpenChange }: Props) {
  const performanceRecords = useStore((s) => s.performanceRecords);
  const markdown = useStore((s) => s.markdown);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const weeklyJobs = useStore((s) => s.weeklyJobs);
  const weeklyReportPreview = useStore((s) => s.weeklyReportPreview);
  const weeklyGenerating = useStore((s) => s.weeklyGenerating);

  const loadWeeklyJobs = useStore((s) => s.loadWeeklyJobs);
  const createWeeklyJob = useStore((s) => s.createWeeklyJob);
  const setWeeklyJobStatus = useStore((s) => s.setWeeklyJobStatus);
  const removeWeeklyJob = useStore((s) => s.removeWeeklyJob);
  const generateWeeklyReport = useStore((s) => s.generateWeeklyReport);
  const previewWeeklyReport = useStore((s) => s.previewWeeklyReport);
  const sendWeeklyReport = useStore((s) => s.sendWeeklyReport);

  const [report, setReport] = useState("");
  const [generating, setGenerating] = useState(false);
  const [useLlm, setUseLlm] = useState(true);
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState<ReportTemplate>("overview");
  const [platformId, setPlatformId] = useState<string>("wechat");

  // WEEKLY-04 新建周报表单
  const [weeklyTab, setWeeklyTab] = useState<"report" | "automation">("report");
  const [weeklyName, setWeeklyName] = useState("");
  const [weeklyTemplate, setWeeklyTemplate] = useState<ReportTemplate>("weekly");
  const [weeklyWindowDays, setWeeklyWindowDays] = useState("7");
  const [weeklyUseLlm, setWeeklyUseLlm] = useState(true);
  const [weeklyDeliveryKind, setWeeklyDeliveryKind] = useState<WeeklyDeliveryKind>("file");
  const [weeklyDeliveryTarget, setWeeklyDeliveryTarget] = useState("");
  const [sending, setSending] = useState(false);

  // REPORT-AI-01:AI 报告解读。
  const [aiInsight, setAiInsight] = useState<ReportAiInsight | null>(null);
  const [aiInsighting, setAiInsighting] = useState(false);

  // 可用的平台 id(来自记录,保底常见平台)。
  const platformIds = [...new Set(performanceRecords.map((r) => r.platformId))];

  // 打开时加载周报任务列表。
  useEffect(() => {
    if (open) {
      void loadWeeklyJobs();
    }
  }, [open, loadWeeklyJobs]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      let suggestions;
      if (useLlm) {
        const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
        const res = await generatePublishStrategy(llmAdapter, {
          title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "",
          contentText: markdown,
          performanceRecords,
        });
        suggestions = res.suggestions.length > 0 ? res.suggestions : undefined;
      }
      const out = buildPerformanceReport({
        records: performanceRecords,
        strategySuggestions: suggestions,
        template,
        platformId: template === "platform" ? platformId : undefined,
      });
      setReport(out);
      setCopied(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setGenerating(false);
    }
  }, [performanceRecords, markdown, useLlm, llm, llmConfigs, activeLlmConfigId, template, platformId]);

  // REPORT-AI-01:AI 解读当前报告。
  const runAiInsight = useCallback(async () => {
    const text = weeklyReportPreview || report;
    if (!text) return;
    setAiInsighting(true);
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const insight = await summarizeReportWithLlm(text, llmAdapter);
      setAiInsight(insight);
      toast(insight.usedLlm ? "AI 解读完成" : "规则解读完成(未配置 LLM)");
    } catch (err) {
      toast(err instanceof Error ? err.message : "AI 解读失败");
    } finally {
      setAiInsighting(false);
    }
  }, [weeklyReportPreview, report, llm, llmConfigs, activeLlmConfigId]);

  const copy = useCallback(async () => {
    const text = weeklyReportPreview || report;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast("报告已复制到剪贴板", "success");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制失败,请手动选择文本", "error");
    }
  }, [report, weeklyReportPreview]);

  const downloadFile = useCallback((filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const download = useCallback(() => {
    const text = weeklyReportPreview || report;
    if (!text) return;
    const date = new Date().toISOString().slice(0, 10);
    const label = REPORT_TEMPLATE_LABELS[template];
    downloadFile(`发布复盘报告-${label}-${date}.md`, text, "text/markdown;charset=utf-8");
    toast("报告已导出 Markdown", "success");
  }, [report, weeklyReportPreview, template, downloadFile]);

  const downloadHtml = useCallback(() => {
    const text = weeklyReportPreview || report;
    if (!text) return;
    const date = new Date().toISOString().slice(0, 10);
    const label = REPORT_TEMPLATE_LABELS[template];
    const html = reportMarkdownToHtml(text, `${label} · ${date}`);
    downloadFile(`发布复盘报告-${label}-${date}.html`, html, "text/html;charset=utf-8");
    toast("报告已导出 HTML", "success");
  }, [report, weeklyReportPreview, template, downloadFile]);

  const printPdf = useCallback(() => {
    const text = weeklyReportPreview || report;
    if (!text) return;
    const date = new Date().toISOString().slice(0, 10);
    const label = REPORT_TEMPLATE_LABELS[template];
    const html = reportMarkdownToHtml(text, `${label} · ${date}`);
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast("请允许弹出窗口以打印 PDF", "error");
      return;
    }
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 400);
    toast("已打开打印预览,可选择「另存为 PDF」", "info");
  }, [report, weeklyReportPreview, template]);

  // WEEKLY-04:创建周报任务
  const createWeekly = useCallback(async () => {
    const windowDays = Number(weeklyWindowDays);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
      toast("窗口天数需为 1-90 的整数", "error");
      return;
    }
    const deliveries: WeeklyDelivery[] = [];
    if (weeklyDeliveryKind !== "file") {
      if (!weeklyDeliveryTarget.trim()) {
        toast("请填写投递目标(邮箱或 Webhook URL)", "error");
        return;
      }
      deliveries.push({ kind: weeklyDeliveryKind, target: weeklyDeliveryTarget.trim() });
    }
    const res = await createWeeklyJob({
      name: weeklyName || undefined,
      template: weeklyTemplate,
      windowDays,
      deliveries,
      useLlm: weeklyUseLlm,
    });
    if (res.ok) {
      toast("周报任务已创建", "success");
      setWeeklyName("");
      setWeeklyDeliveryTarget("");
      setWeeklyDeliveryKind("file");
    } else {
      toast(res.error ?? "创建失败", "error");
    }
  }, [weeklyName, weeklyTemplate, weeklyWindowDays, weeklyUseLlm, weeklyDeliveryKind, weeklyDeliveryTarget, createWeeklyJob]);

  // WEEKLY-04:手动立即生成(写入预览 + 任务运行历史)
  const runWeekly = useCallback(
    async (id: string) => {
      const res = await generateWeeklyReport(id);
      if (res.ok) toast("周报已生成,可预览/导出/投递", "success");
      else toast(res.error ?? "生成失败", "error");
    },
    [generateWeeklyReport],
  );

  // WEEKLY-04:生成一份预览(不落任务)
  const runPreview = useCallback(async () => {
    const res = await previewWeeklyReport(weeklyTemplate, Number(weeklyWindowDays) || 7);
    if (res.ok) {
      toast("周报预览已生成", "success");
      setWeeklyTab("report");
    } else toast(res.error ?? "生成失败", "error");
  }, [previewWeeklyReport, weeklyTemplate, weeklyWindowDays]);

  // WEEKLY-04:投递周报
  const deliverWeekly = useCallback(
    async (deliveries: readonly WeeklyDelivery[]) => {
      if (deliveries.length === 0) {
        toast("请先选择投递渠道", "error");
        return;
      }
      setSending(true);
      const res = await sendWeeklyReport("", [...deliveries]);
      setSending(false);
      if (res.ok) toast(res.message ?? "周报已投递", "success");
      else toast(res.message ?? "投递失败(检查 server 是否配置渠道凭据)", "error");
    },
    [sendWeeklyReport],
  );

  // WEEKLY-04:任务最近运行摘要
  const latestRun = useMemo(
    () => (job: { runs: readonly { outcome: string; recordsUsed?: number; usedLlm?: boolean; deliveryResults?: readonly { ok: boolean }[]; error?: string }[] }) => job.runs[0],
    [],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide report-drawer" aria-label="发布复盘报告">
          <div className="drawer-header">
            <div className="drawer-title">
              <FileDown size={18} aria-hidden />
              发布复盘报告
            </div>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭复盘报告">
                <X size={16} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {/* WEEKLY-04:报告 / 周报自动化 双 tab */}
          <div className="report-tabs">
            <button
              type="button"
              className={weeklyTab === "report" ? "report-tab active" : "report-tab"}
              onClick={() => setWeeklyTab("report")}
            >
              <FileText size={13} aria-hidden />
              报告
            </button>
            <button
              type="button"
              className={weeklyTab === "automation" ? "report-tab active" : "report-tab"}
              onClick={() => setWeeklyTab("automation")}
            >
              <FileClock size={13} aria-hidden />
              周报自动化
            </button>
          </div>

          {weeklyTab === "report" ? (
            <>
              <div className="report-controls">
                <label className="report-template-label" title="选择报告模板">
                  <CalendarRange size={13} aria-hidden />
                  <select
                    className="report-template-select"
                    aria-label="报告模板"
                    value={template}
                    onChange={(e) => setTemplate(e.target.value as ReportTemplate)}
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t} value={t}>
                        {REPORT_TEMPLATE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                {template === "platform" && (
                  <label className="report-template-label" title="平台专项的目标平台">
                    <select
                      className="report-template-select"
                      aria-label="目标平台"
                      value={platformId}
                      onChange={(e) => setPlatformId(e.target.value)}
                    >
                      {(platformIds.length > 0 ? platformIds : ["wechat"]).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="report-llm-toggle" title="使用 LLM 生成发布策略建议(失败自动回退规则)">
                  <input
                    type="checkbox"
                    checked={useLlm}
                    onChange={(e) => setUseLlm(e.target.checked)}
                  />
                  <Sparkles size={13} aria-hidden />
                  使用 AI 策略建议
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void generate()}
                  disabled={generating || performanceRecords.length === 0}
                >
                  {generating ? <Loader2 size={14} className="spinner" aria-hidden /> : <FileText size={14} aria-hidden />}
                  生成报告
                </button>
                {performanceRecords.length === 0 && (
                  <span className="report-hint">暂无效果记录,请先在「发布效果回收」录入数据</span>
                )}
              </div>

              {(report || weeklyReportPreview) ? (
                <>
                  <div className="report-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
                      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                      {copied ? "已复制" : "复制 Markdown"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
                      <FileDown size={14} aria-hidden />
                      导出 .md
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={downloadHtml}>
                      <FileCode2 size={14} aria-hidden />
                      导出 HTML
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={printPdf}>
                      <Printer size={14} aria-hidden />
                      打印 / PDF
                    </button>
                  </div>
                  <pre className="report-preview">{weeklyReportPreview || report}</pre>
                  {/* REPORT-AI-01:AI 报告解读 */}
                  <div className="report-ai-block">
                    <div className="report-ai-head">
                      <span className="report-ai-title">
                        <Sparkles size={13} aria-hidden /> AI 报告解读
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void runAiInsight()}
                        disabled={aiInsighting}
                      >
                        {aiInsighting ? <Loader2 size={14} className="spinner" aria-hidden /> : <Sparkles size={14} aria-hidden />}
                        {aiInsighting ? "解读中…" : aiInsight ? "重新解读" : "AI 解读"}
                      </button>
                    </div>
                    {!aiInsight ? (
                      <div className="report-ai-empty">
                        点击「AI 解读」,把报告提炼为亮点 / 问题 / 下一步行动(未配置 LLM 时自动规则解读)
                      </div>
                    ) : (
                      <div className="report-ai-grid">
                        <div className="report-ai-col report-ai-highlight">
                          <strong>亮点</strong>
                          {aiInsight.highlights.length === 0 ? (
                            <span className="report-ai-none">未识别到亮点</span>
                          ) : (
                            aiInsight.highlights.map((h, i) => <span key={i}>· {h}</span>)
                          )}
                        </div>
                        <div className="report-ai-col report-ai-issue">
                          <strong>问题</strong>
                          {aiInsight.issues.length === 0 ? (
                            <span className="report-ai-none">未识别到问题</span>
                          ) : (
                            aiInsight.issues.map((i2, i) => <span key={i}>· {i2}</span>)
                          )}
                        </div>
                        <div className="report-ai-col report-ai-action">
                          <strong>下一步行动</strong>
                          {aiInsight.actions.length === 0 ? (
                            <span className="report-ai-none">未识别到行动建议</span>
                          ) : (
                            aiInsight.actions.map((a, i) => <span key={i}>· {a}</span>)
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="report-empty">
                  <FileDown size={28} aria-hidden />
                  <p>点击「生成报告」,把效果回收与智能分析汇总为一份可导出的复盘报告(支持周报 / 月报 / 平台专项)。</p>
                </div>
              )}
            </>
          ) : (
            <div className="weekly-body">
              {/* 新建周报任务 */}
              <div className="weekly-section">
                <div className="drift-section-label">新建周报任务</div>
                <div className="weekly-form">
                  <label className="scheduler-field">
                    <span>任务名称</span>
                    <input
                      value={weeklyName}
                      onChange={(e) => setWeeklyName(e.target.value)}
                      placeholder="例如:主编每周五周报"
                    />
                  </label>
                  <div className="scheduler-cron-row weekly-form-row">
                    <label className="report-template-label">
                      <span>模板</span>
                      <select
                        className="report-template-select"
                        value={weeklyTemplate}
                        onChange={(e) => setWeeklyTemplate(e.target.value as ReportTemplate)}
                      >
                        {WEEKLY_TEMPLATES.map((t) => (
                          <option key={t} value={t}>
                            {REPORT_TEMPLATE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="report-template-label">
                      <span>窗口(天)</span>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={weeklyWindowDays}
                        onChange={(e) => setWeeklyWindowDays(e.target.value)}
                        style={{ width: 72, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", background: "var(--surface)", color: "var(--text)" }}
                      />
                    </label>
                  </div>
                  <label className="report-llm-toggle" title="使用 LLM 生成周报总结(失败自动回退规则)">
                    <input
                      type="checkbox"
                      checked={weeklyUseLlm}
                      onChange={(e) => setWeeklyUseLlm(e.target.checked)}
                    />
                    <Sparkles size={13} aria-hidden />
                    使用 AI 周报总结
                  </label>
                  <div className="weekly-delivery-row">
                    <span className="report-template-label">投递渠道</span>
                    <select
                      className="report-template-select"
                      value={weeklyDeliveryKind}
                      onChange={(e) => setWeeklyDeliveryKind(e.target.value as WeeklyDeliveryKind)}
                      aria-label="投递渠道"
                    >
                      <option value="file">仅导出文件</option>
                      <option value="email">邮件(SMTP)</option>
                      <option value="webhook">Webhook</option>
                    </select>
                    {weeklyDeliveryKind !== "file" && (
                      <input
                        className="weekly-target-input"
                        value={weeklyDeliveryTarget}
                        onChange={(e) => setWeeklyDeliveryTarget(e.target.value)}
                        placeholder={weeklyDeliveryKind === "email" ? "收件邮箱" : "https://hooks.example.com/..."}
                        aria-label="投递目标"
                      />
                    )}
                  </div>
                  <div className="weekly-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void createWeekly()}>
                      <Plus size={13} aria-hidden />
                      创建周报任务
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void runPreview()}
                      disabled={weeklyGenerating || performanceRecords.length === 0}
                    >
                      {weeklyGenerating ? <Loader2 size={13} className="spinner" aria-hidden /> : <RotateCcw size={13} aria-hidden />}
                      立即生成预览
                    </button>
                  </div>
                </div>
              </div>

              {/* 已配置周报任务 */}
              <div className="weekly-section">
                <div className="drift-section-label">
                  已配置周报任务（{weeklyJobs.length}）
                  <button type="button" className="btn-icon" aria-label="刷新周报任务" onClick={() => void loadWeeklyJobs()}>
                    <RefreshCw size={13} aria-hidden />
                  </button>
                </div>
                {weeklyJobs.length === 0 && (
                  <div className="assistant-empty">还没有周报任务,先在上面创建一个。</div>
                )}
                {weeklyJobs.map((job) => {
                  const run = latestRun(job);
                  return (
                    <div key={job.id} className="scheduler-task">
                      <div className="scheduler-task-head">
                        <span className="scheduler-task-name">{job.name}</span>
                        <span className={job.status === "enabled" ? "drift-ok" : "drift-warn"}>
                          {job.status === "enabled" ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
                          {job.status === "enabled" ? "启用" : "已暂停"}
                        </span>
                      </div>
                      <div className="scheduler-task-meta">
                        {REPORT_TEMPLATE_LABELS[job.template]} · 近 {job.windowDays} 天 ·{" "}
                        {job.deliveries.length === 0 ? "仅本地导出" : job.deliveries.map((d) => d.kind).join(" / ")} ·{" "}
                        {job.useLlm ? "AI 总结" : "规则总结"}
                      </div>
                      {run && (
                        <div className="scheduler-task-run">
                          最近:{" "}
                          {run.outcome === "succeeded" ? "成功" : run.outcome === "failed" ? "失败" : run.outcome === "skipped" ? "跳过" : "未知"}
                          {run.recordsUsed !== undefined ? ` · ${run.recordsUsed} 条记录` : ""}
                          {run.usedLlm ? " · LLM" : ""}
                          {run.deliveryResults && run.deliveryResults.length > 0
                            ? ` · 投递 ${run.deliveryResults.filter((d) => d.ok).length}/${run.deliveryResults.length}`
                            : ""}
                          {run.error ? ` — ${run.error}` : ""}
                        </div>
                      )}
                      <div className="scheduler-task-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void runWeekly(job.id)}
                          disabled={weeklyGenerating}
                        >
                          <Send size={12} aria-hidden /> 立即生成
                        </button>
                        {job.deliveries.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void deliverWeekly(job.deliveries)}
                            disabled={sending}
                          >
                            {sending ? <Loader2 size={12} className="spinner" aria-hidden /> : <Mail size={12} aria-hidden />}
                            投递
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void setWeeklyJobStatus(job.id, job.status === "enabled" ? "paused" : "enabled")}
                        >
                          {job.status === "enabled" ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
                          {job.status === "enabled" ? "暂停" : "恢复"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void removeWeeklyJob(job.id)}
                          aria-label="删除周报任务"
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 周报投递说明 */}
              <div className="assistant-fact-summary" style={{ marginTop: 12 }}>
                <Webhook size={13} aria-hidden />
                投递凭据(邮件 SMTP / Webhook 白名单)由本地 server 持有,在 server .env 配置(MAIL_* / WEEKLY_WEBHOOK_HOSTS),前端不接触密钥。
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
