/**
 * 发布效果回收面板 —— Phase 5 DATA-02/03。
 *
 * - CSV 导入:粘贴 CSV 文本导入效果记录(platform,title,remote_id,...);
 * - 手工录入:直接录入一条阅读/互动指标;
 * - 汇总:按平台聚合阅读/点赞/评论/分享;
 * - 官方 API 同步:对已配置 provider 的平台(公众号 server 转发)拉取指标。
 *
 * 约束(路线图 §5.3):先支持可解释、低权限来源;不抓取受限数据。
 */
import { useCallback, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, BarChart3, Upload, Plus, Trash2, RefreshCw, Loader2, Sparkles, TrendingUp, TrendingDown, Lightbulb, Target } from "lucide-react";
import { listAdapters, generatePublishStrategy, type StrategySuggestion } from "@mpp/core";
import { useStore } from "../state/store.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import { platformColor } from "./platform-meta.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ADAPTERS = listAdapters();

export function PerformanceDrawer({ open, onOpenChange }: Props) {
  const performanceRecords = useStore((s) => s.performanceRecords);
  const loadPerformance = useStore((s) => s.loadPerformance);
  const importPerformanceCsv = useStore((s) => s.importPerformanceCsv);
  const addManualPerformance = useStore((s) => s.addManualPerformance);
  const removePerformanceRecord = useStore((s) => s.removePerformanceRecord);
  const syncPerformanceFromApi = useStore((s) => s.syncPerformanceFromApi);
  const performanceSummary = useStore((s) => s.performanceSummary);
  const performanceInsights = useStore((s) => s.performanceInsights);
  // AI-INSIGHT-01:发布策略建议接入当前 LLM 配置与效果记录。
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const markdown = useStore((s) => s.markdown);
  const [strategy, setStrategy] = useState<{
    suggestions: readonly StrategySuggestion[];
    summary: string;
    usedLlm: boolean;
  } | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 手工录入
  const [platformId, setPlatformId] = useState(ADAPTERS[0]?.id ?? "wechat");
  const [title, setTitle] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [views, setViews] = useState("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");
  const [shares, setShares] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    await loadPerformance();
  }, [loadPerformance]);

  const doImport = useCallback(async () => {
    if (!csvText.trim()) {
      setMessage({ kind: "err", text: "请先粘贴 CSV 内容" });
      return;
    }
    setImporting(true);
    setMessage(null);
    try {
      const result = await importPerformanceCsv(csvText);
      if (result.ok) {
        setMessage({
          kind: "ok",
          text: `已导入 ${result.imported} 条效果记录${result.error ?? ""}`,
        });
        setCsvText("");
      } else {
        setMessage({ kind: "err", text: result.error ?? "导入失败" });
      }
    } finally {
      setImporting(false);
    }
  }, [csvText, importPerformanceCsv]);

  const doAdd = useCallback(async () => {
    if (!title.trim()) {
      setMessage({ kind: "err", text: "请输入标题" });
      return;
    }
    setAdding(true);
    setMessage(null);
    try {
      const result = await addManualPerformance({
        platformId,
        title,
        remoteId: remoteId || undefined,
        publishedAt: new Date().toISOString(),
        metrics: {
          views: views ? Number(views) : undefined,
          likes: likes ? Number(likes) : undefined,
          comments: comments ? Number(comments) : undefined,
          shares: shares ? Number(shares) : undefined,
        },
      });
      if (result.ok) {
        setMessage({ kind: "ok", text: "已录入效果记录" });
        setTitle("");
        setRemoteId("");
        setViews("");
        setLikes("");
        setComments("");
        setShares("");
      } else {
        setMessage({ kind: "err", text: result.error ?? "录入失败" });
      }
    } finally {
      setAdding(false);
    }
  }, [platformId, title, remoteId, views, likes, comments, shares, addManualPerformance]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await syncPerformanceFromApi();
      setMessage({ kind: result.ok ? "ok" : "err", text: result.message });
    } finally {
      setSyncing(false);
    }
  }, [syncPerformanceFromApi]);

  const remove = useCallback(
    async (id: string) => {
      await removePerformanceRecord(id);
    },
    [removePerformanceRecord],
  );

  // AI-INSIGHT-01:生成发布策略建议(选题/平台组合/发布时段)。
  const runStrategy = useCallback(async () => {
    setStrategyLoading(true);
    setMessage(null);
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const result = await generatePublishStrategy(llmAdapter, {
        title: deriveTitleFromMarkdown(markdown),
        contentText: stripMarkdown(markdown),
        performanceRecords: performanceRecords,
      });
      setStrategy({ suggestions: result.suggestions, summary: result.summary, usedLlm: result.usedLlm });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setStrategyLoading(false);
    }
  }, [llm, llmConfigs, activeLlmConfigId, markdown, performanceRecords]);

  const summaries = performanceSummary();
  const insights = performanceInsights();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <BarChart3 size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              发布效果回收
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
              效果数据仅本地保存，支持 CSV 导入 / 手工录入 / 官方 API 同步（需配置 provider）。
            </div>

            {message && (
              <div className={message.kind === "ok" ? "batch-success" : "batch-error"}>{message.text}</div>
            )}

            {/* 汇总 */}
            {summaries.length > 0 && (
              <div className="perf-summary">
                <div className="drift-section-label">按平台汇总</div>
                <div className="perf-summary-grid">
                  {summaries.map((s) => (
                    <div key={s.platformId} className="perf-summary-item">
                      <span className="perf-summary-name" style={{ color: platformColor(s.platformId) }}>
                        {s.platformId}
                      </span>
                      <span className="perf-summary-count">{s.count} 条</span>
                      <span className="perf-summary-views">阅读 {s.totalViews}</span>
                      <span className="perf-summary-likes">赞 {s.totalLikes}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 智能分析 */}
            <div className="perf-section">
              <div className="drift-section-label">
                <Sparkles size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                发布效果智能分析
              </div>
              {insights.insights.length === 0 ? (
                <div className="assistant-empty">
                  导入/录入效果记录后,这里会自动生成趋势、增长与平台对比洞察。
                </div>
              ) : (
                <>
                  <div className="insight-list">
                    {insights.insights.map((ins, idx) => (
                      <div key={idx} className={`insight-item insight-${ins.severity}`}>
                        <span className="insight-icon" aria-hidden>
                          {ins.kind === "growth" ? (
                            <TrendingUp size={13} />
                          ) : ins.kind === "decline" ? (
                            <TrendingDown size={13} />
                          ) : (
                            <Sparkles size={13} />
                          )}
                        </span>
                        <div className="insight-body">
                          <strong>{ins.title}</strong>
                          <span>{ins.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {insights.recommendations.length > 0 && (
                    <div className="insight-recommendations">
                      <div className="drift-section-label">行动建议</div>
                      <ul>
                        {insights.recommendations.map((rec, idx) => (
                          <li key={idx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {insights.trends.length > 0 && (
                    <div className="insight-trends">
                      <div className="drift-section-label">近 7 天阅读趋势(每平台)</div>
                      {insights.trends.map((t) => (
                        <div key={t.platformId} className="insight-trend-row">
                          <span className="insight-trend-name" style={{ color: platformColor(t.platformId) }}>
                            {t.platformId}
                          </span>
                          <div className="insight-trend-bars">
                            {t.dailyViews.map((d) => (
                              <span
                                key={d.day}
                                className="insight-trend-bar"
                                title={`${d.day}: ${d.views} 阅读`}
                                style={{
                                  height: `${barHeight(d.views, maxViews(t.dailyViews))}%`,
                                  backgroundColor: platformColor(t.platformId),
                                }}
                              />
                            ))}
                          </div>
                          <span className="insight-trend-total">{t.totalViews}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* AI-INSIGHT-01:AI 发布策略建议(选题 / 平台组合 / 发布时段) */}
            <div className="perf-section">
              <div className="drift-section-label">
                <Target size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                AI 发布策略建议
              </div>
              <div className="assistant-toolbar">
                <span className="assistant-toolbar-hint">
                  结合效果回收数据与当前内容,LLM 生成「选题 / 平台组合 / 发布时段」建议
                  {llm.baseUrl && llm.apiKey && llm.model ? ` · LLM(${llm.model})` : " · 规则模式(未配置 LLM)"}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void runStrategy()}
                  disabled={strategyLoading}
                >
                  {strategyLoading ? (
                    <Loader2 size={14} className="spinner" aria-hidden />
                  ) : (
                    <Lightbulb size={14} aria-hidden />
                  )}
                  {strategyLoading ? "生成中…" : "生成发布策略"}
                </button>
              </div>
              {strategy && (
                <div className="insight-recommendations" style={{ marginTop: 8 }}>
                  <div className="drift-section-label">
                    {strategy.usedLlm ? "LLM 建议" : "规则建议"}
                  </div>
                  <ul>
                    {strategy.suggestions.map((s, idx) => (
                      <li key={idx}>
                        <strong>{kindLabel(s.kind)}:</strong>
                        {s.text}
                        {s.reason ? `（${s.reason}）` : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="field-hint">{strategy.summary}</div>
                </div>
              )}
            </div>

            {/* CSV 导入 */}
            <div className="perf-section">
              <div className="drift-section-label">CSV 导入</div>
              <textarea
                className="perf-csv-input"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={"platform,title,remote_id,remote_url,published_at,views,likes,favorites,comments,shares,follower_delta\nwechat,我的文章,100001,https://...,2026-08-05T10:00:00Z,1200,80,30,12,5,3"}
                rows={4}
              />
              <button type="button" className="btn btn-primary" onClick={() => void doImport()} disabled={importing}>
                {importing ? <Loader2 size={14} className="spin" aria-hidden /> : <Upload size={14} aria-hidden />}
                导入 CSV
              </button>
            </div>

            {/* 手工录入 */}
            <div className="perf-section">
              <div className="drift-section-label">手工录入</div>
              <div className="perf-manual-grid">
                <select value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
                  {ADAPTERS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
                <input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} placeholder="远端 ID（可选）" />
              </div>
              <div className="perf-manual-metrics">
                <input type="number" min={0} value={views} onChange={(e) => setViews(e.target.value)} placeholder="阅读" aria-label="阅读量" />
                <input type="number" min={0} value={likes} onChange={(e) => setLikes(e.target.value)} placeholder="点赞" aria-label="点赞数" />
                <input type="number" min={0} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="评论" aria-label="评论数" />
                <input type="number" min={0} value={shares} onChange={(e) => setShares(e.target.value)} placeholder="分享" aria-label="分享数" />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void doAdd()} disabled={adding}>
                {adding ? <Loader2 size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                录入
              </button>
            </div>

            {/* 官方 API 同步 */}
            <div className="perf-section">
              <div className="drift-section-label">官方 API 同步（DATA-03）</div>
              <div className="perf-sync-note">
                公众号指标经 server 调官方 datacube 拉取（需已配置凭据并带 remoteId 的记录）；其他平台跳过并提示。
              </div>
              <button type="button" className="btn" onClick={() => void doSync()} disabled={syncing}>
                {syncing ? <Loader2 size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
                从官方 API 同步指标
              </button>
            </div>

            {/* 记录列表 */}
            <div className="drift-section-label" style={{ marginTop: 16 }}>
              已回收记录（{performanceRecords.length}）
            </div>
            {performanceRecords.length === 0 && (
              <div className="assistant-empty">还没有效果记录，导入 CSV 或手工录入。</div>
            )}
            {performanceRecords.map((r) => (
              <div key={r.id} className="perf-record">
                <div className="perf-record-head">
                  <span className="perf-record-title" style={{ color: platformColor(r.platformId) }}>
                    {r.title}
                  </span>
                  <span className="perf-record-source">{r.source}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="删除记录"
                    onClick={() => void remove(r.id)}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <div className="perf-record-meta">
                  {r.platformId} · {new Date(r.publishedAt).toLocaleString()}
                  {r.remoteId ? ` · ${r.remoteId}` : ""}
                </div>
                <div className="perf-record-metrics">
                  {r.metrics.views !== undefined && <span>阅读 {r.metrics.views}</span>}
                  {r.metrics.likes !== undefined && <span>赞 {r.metrics.likes}</span>}
                  {r.metrics.comments !== undefined && <span>评论 {r.metrics.comments}</span>}
                  {r.metrics.shares !== undefined && <span>分享 {r.metrics.shares}</span>}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 趋势柱状图:取序列最大阅读量(至少 1)。 */
function maxViews(points: readonly { views: number }[]): number {
  return Math.max(1, ...points.map((p) => p.views));
}

/** 趋势柱高百分比(最小 6% 保证可见)。 */
function barHeight(views: number, max: number): number {
  if (max <= 0) return 6;
  return Math.max(6, Math.round((views / max) * 100));
}

/** 策略建议类型的人类可读标签。 */
function kindLabel(kind: StrategySuggestion["kind"]): string {
  if (kind === "topic") return "选题";
  if (kind === "platform-mix") return "平台组合";
  return "发布时段";
}

/** 从 Markdown 首行 # 标题或首行提取草稿标题。 */
function deriveTitleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 30) : "";
}

/** 剥离 Markdown 标记得到纯文本(供策略 prompt 使用,截断 400 字)。 */
function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}
