/**
 * 批量处理与发布审批面板 —— Phase 5 FLOW-02 批量校验/生成 + FLOW-04 发布前审批清单。
 *
 * - 批量:对当前草稿 + 已保存草稿批量跑"校验 + 生成多平台产物",默认不真实发布;
 * - 审批:真实发布前把各平台产物 + 内容摘要整理成清单,full-auto 必须逐项确认,
 *   未确认或校验未通过则不能 proceed;
 * - AI 自动完成:多草稿一键批量跑 runAutoAgent(分析 → 修复 → 增强 → 复核),
 *   让大模型批量自动维护草稿质量;结果可一键写回草稿/当前编辑区。
 */
import { useMemo, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ListChecks, Play, CheckCircle2, ShieldCheck, Loader2, AlertTriangle, Sparkles, Check, PenLine, CalendarClock } from "lucide-react";
import {
  batchGenerate,
  buildApprovalManifest,
  confirmApprovalItem,
  canProceed,
  batchAutoComplete,
  buildQueueEntriesFromBatch,
  type BatchItemResult,
  type ApprovalManifest,
  type BatchAutoCompleteResult,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { listAdapters } from "@mpp/core";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ADAPTERS = listAdapters();
const ALL_IDS = ADAPTERS.map((a) => a.id);

type BatchMode = "generate" | "ai";

export function BatchDrawer({ open, onOpenChange }: Props) {
  const markdown = useStore((s) => s.markdown);
  const drafts = useStore((s) => s.drafts);
  const authorName = useStore((s) => s.authorName);
  const tags = useStore((s) => s.tags);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const setMarkdown = useStore((s) => s.setMarkdown);
  const applyBatchAutoCompleteResults = useStore((s) => s.applyBatchAutoCompleteResults);
  const enqueuePublishBatch = useStore((s) => s.enqueuePublishBatch);
  const [mode, setMode] = useState<BatchMode>("generate");
  const [running, setRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<readonly BatchItemResult[]>([]);
  const [manifest, setManifest] = useState<ApprovalManifest | null>(null);
  const [error, setError] = useState("");
  const [aiResults, setAiResults] = useState<readonly BatchAutoCompleteResult[]>([]);
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(new Set());
  // AI-INSIGHT-02:批量改写任务级参数(温度 / 最大 token / 每篇最大改写段数)。
  const [rewriteTemp, setRewriteTemp] = useState("0.7");
  const [rewriteMaxTokens, setRewriteMaxTokens] = useState("1024");
  const [maxRewriteParagraphs, setMaxRewriteParagraphs] = useState(3);

  const llmReady = !!llm.baseUrl && !!llm.apiKey && !!llm.model;

  // 待处理的条目:当前编辑内容 + 已保存草稿(去重,最多 6 条)。
  const items = useMemo(() => {
    const current = {
      id: "current",
      title: "当前编辑",
      markdown,
      authorName,
      tags: [...tags],
    };
    const rest = drafts
      .filter((d) => d.markdown.trim())
      .slice(0, 5)
      .map((d) => ({ id: d.id, title: d.title, markdown: d.markdown, authorName: d.authorName, tags: [...d.tags] }));
    return [current, ...rest];
  }, [markdown, drafts, authorName, tags]);

  const resetAi = useCallback(() => {
    setAiResults([]);
    setAppliedIds(new Set());
  }, []);

  // AI-QUEUE-02:批量 AI 完成后一键把多篇结果排入发布队列。
  const enqueueBatchToQueue = useCallback(async () => {
    if (aiResults.length === 0) return;
    setRunning(true);
    setError("");
    try {
      const specs = buildQueueEntriesFromBatch(
        aiResults.map((r) => ({
          id: r.id,
          title: r.title,
          changed: r.ok && !!r.agent.markdown && r.agent.markdown !== items.find((it) => it.id === r.id)?.markdown,
        })),
        {
          platformIds: ALL_IDS,
          // 默认 1 小时后,可被用户随后在发布队列面板改期。
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      );
      if (specs.length === 0) {
        setError("没有内容有变化的 AI 结果,无需排队");
        return;
      }
      const result = await enqueuePublishBatch({
        items: specs.map((s) => ({ draftId: s.draftId, name: s.name, platformIds: [...s.platformIds], scheduledAt: s.scheduledAt, realPublish: s.realPublish })),
      });
      if (!result.ok) {
        setError(result.error ?? "排队失败");
        return;
      }
      toast(`已将 ${result.enqueued} 篇 AI 结果排入发布队列`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [aiResults, items, enqueuePublishBatch]);

  const switchMode = useCallback(
    (m: BatchMode) => {
      setMode(m);
      setError("");
      if (m === "generate") {
        resetAi();
      } else {
        setBatchResults([]);
        setManifest(null);
      }
    },
    [resetAi],
  );

  const runBatch = useCallback(async () => {
    if (items.length === 0) return;
    setRunning(true);
    setError("");
    try {
      const results = await batchGenerate(items, { platformIds: ALL_IDS }, 2);
      setBatchResults(results);
      setManifest(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [items]);

  const runAi = useCallback(async () => {
    if (items.length === 0) return;
    setRunning(true);
    setError("");
    resetAi();
    try {
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      // AI-INSIGHT-02:批量改写透传任务级参数(温度/最大 token/每篇最大改写段数),
      // 多模型回退由 buildLlmAdapter(FallbackLlm) 与重试(LlmRetry) 统一保障。
      const results = await batchAutoComplete(items, {
        platformIds: ALL_IDS,
        llm: llmAdapter,
        autoFix: true,
        maxFixRounds: 3,
        enhance: true,
        maxRewriteParagraphs,
        temperature: Number.parseFloat(rewriteTemp) || undefined,
        maxTokens: Number.parseInt(rewriteMaxTokens, 10) || undefined,
      }, 2);
      setAiResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [items, llm, llmConfigs, activeLlmConfigId, resetAi, rewriteTemp, rewriteMaxTokens, maxRewriteParagraphs]);

  const buildApproval = useCallback(async () => {
    const first = batchResults[0];
    if (!first) return;
    const intents: Record<string, "draft" | "publish"> = Object.fromEntries(ALL_IDS.map((id) => [id, "draft"]));
    const m = await buildApprovalManifest(first, intents);
    setManifest(m);
  }, [batchResults]);

  const confirmItem = useCallback(
    (platformId: string) => {
      if (!manifest) return;
      const digest = manifest.items.find((i) => i.platformId === platformId)?.digest ?? "";
      setManifest(confirmApprovalItem(manifest, platformId, digest));
    },
    [manifest],
  );

  // 把批量 AI 结果写回:当前编辑 → 编辑区;已保存草稿 → 落库。
  const applyAiResults = useCallback(async () => {
    if (aiResults.length === 0) return;
    let applied = 0;
    let saved = 0;
    try {
      const draftUpdates: Array<{ id: string; markdown: string }> = [];
      for (const r of aiResults) {
        const markdown = r.agent.markdown;
        if (!markdown || r.agent.markdown === items.find((it) => it.id === r.id)?.markdown) continue;
        if (r.id === "current") {
          setMarkdown(markdown);
          applied++;
        } else {
          draftUpdates.push({ id: r.id, markdown });
        }
      }
      if (draftUpdates.length > 0) {
        const result = await applyBatchAutoCompleteResults(draftUpdates);
        if (!result.ok) {
          toast(`批量写回草稿失败:${result.error ?? "未知错误"}`, "error");
          return;
        }
        saved = result.saved;
      }
      setAppliedIds(new Set(aiResults.map((r) => r.id)));
      toast(`已应用批量 AI 自动完成结果:${applied} 篇当前编辑 + ${saved} 篇草稿`, "success");
    } catch (err) {
      toast(`应用批量 AI 结果失败:${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [aiResults, items, setMarkdown, applyBatchAutoCompleteResults]);

  const proceed = useMemo(() => (manifest ? canProceed(manifest) : { ok: false }), [manifest]);
  const passedCount = useMemo(
    () => batchResults.reduce((n, r) => n + (r.ok ? 1 : 0), 0),
    [batchResults],
  );
  const aiChanged = useMemo(
    () =>
      aiResults.filter(
        (r) => r.agent.markdown && r.agent.markdown !== items.find((it) => it.id === r.id)?.markdown,
      ).length,
    [aiResults, items],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <ListChecks size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              批量与审批
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            {/* 模式切换:批量校验/生成 ↔ AI 自动完成 */}
            <div className="assistant-toolbar batch-mode-switch">
              <button
                type="button"
                className={`batch-mode-btn ${mode === "generate" ? "active" : ""}`}
                onClick={() => switchMode("generate")}
                aria-pressed={mode === "generate"}
              >
                <Play size={13} aria-hidden />
                批量校验/生成
              </button>
              <button
                type="button"
                className={`batch-mode-btn ${mode === "ai" ? "active" : ""}`}
                onClick={() => switchMode("ai")}
                aria-pressed={mode === "ai"}
              >
                <Sparkles size={13} aria-hidden />
                AI 自动完成
              </button>
            </div>

            {mode === "generate" && (
              <>
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">
                    对 {items.length} 篇内容批量生成全平台产物（默认不真实发布）
                  </span>
                  <button type="button" className="btn btn-sm btn-primary" onClick={runBatch} disabled={running || items.length === 0}>
                    {running ? <Loader2 size={14} className="spinner" aria-hidden /> : <Play size={14} aria-hidden />}
                    {running ? "处理中…" : "批量校验/生成"}
                  </button>
                </div>
                {error && <div className="assistant-error">{error}</div>}

                {batchResults.length > 0 && (
                  <div className="assistant-section">
                    <div className="assistant-fact-summary">
                      已处理 {batchResults.length} 篇：{passedCount} 篇全部通过，{batchResults.length - passedCount} 篇存在校验问题。
                    </div>
                    {batchResults.map((r) => (
                      <div key={r.id} className="batch-item">
                        <div className="batch-item-head">
                          <span className="batch-item-title">{r.title}</span>
                          <span className={r.ok ? "batch-item-ok" : "batch-item-fail"}>
                            {r.ok ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                            {r.ok ? "通过" : "有错误"}
                          </span>
                        </div>
                        <div className="batch-item-meta">
                          {r.summary.passed}/{r.summary.total} 平台通过
                          {r.contentDigest ? ` · 摘要 ${r.contentDigest.slice(0, 12)}…` : ""}
                        </div>
                      </div>
                    ))}
                    <div className="assistant-toolbar">
                      <button type="button" className="btn btn-sm" onClick={buildApproval} disabled={!batchResults[0]}>
                        <ShieldCheck size={14} aria-hidden />
                        生成发布审批清单
                      </button>
                    </div>
                  </div>
                )}

                {manifest && (
                  <div className="assistant-section">
                    <div className="assistant-fact-summary">
                      发布审批清单：{manifest.draftTitle}（{manifest.createdAt.slice(0, 10)}）
                    </div>
                    {manifest.items.map((item) => {
                      const color = platformColor(item.platformId);
                      return (
                        <div key={item.platformId} className="approval-item" style={{ ["--chip-color" as string]: color }}>
                          <div className="approval-item-head">
                            <span className="assistant-platform" style={{ color }}>
                              {item.platformName}
                            </span>
                            <span className="approval-item-intent">{item.intent}</span>
                            {item.hasError && <span className="approval-item-err">校验未通过</span>}
                          </div>
                          <div className="approval-item-title">{item.title}</div>
                          <div className="approval-item-meta">
                            {item.charCount} 字 · 摘要 {item.digest.slice(0, 12)}…
                          </div>
                          <div className="approval-item-actions">
                            {item.confirmed ? (
                              <span className="approval-confirmed">
                                <CheckCircle2 size={13} aria-hidden />
                                已确认
                              </span>
                            ) : (
                              <button type="button" className="btn btn-sm btn-primary" onClick={() => confirmItem(item.platformId)} disabled={item.hasError}>
                                确认内容摘要
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className={proceed.ok ? "assistant-proceed-ok" : "assistant-proceed-block"}>
                      {proceed.ok ? (
                        <>
                          <CheckCircle2 size={14} aria-hidden />
                          全部确认，可进入发布
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={14} aria-hidden />
                          {proceed.reason ?? "请先确认全部平台"}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {mode === "ai" && (
              <>
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">
                    对 {items.length} 篇内容一键批量 AI 自动完成（分析 → 修复 → 增强 → 复核）
                    {llmReady ? ` · 已配置 LLM(${llm.model})` : " · 未配置 LLM,将用规则引擎兜底"}
                  </span>
                  <button type="button" className="btn btn-sm btn-primary" onClick={runAi} disabled={running || items.length === 0}>
                    {running ? <Loader2 size={14} className="spinner" aria-hidden /> : <Sparkles size={14} aria-hidden />}
                    {running ? "批量 AI 完成中…" : "一键批量 AI 自动完成"}
                  </button>
                </div>
                {/* AI-INSIGHT-02:任务级改写参数(温度/最大 token/每篇最大改写段数) */}
                <div className="assistant-toolbar batch-ai-params">
                  <label className="field-inline">
                    <span className="field-label">改写温度</span>
                    <input
                      className="field-input field-input-sm"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={rewriteTemp}
                      aria-label="改写温度"
                      onChange={(e) => setRewriteTemp(e.target.value)}
                    />
                  </label>
                  <label className="field-inline">
                    <span className="field-label">最大 Token</span>
                    <input
                      className="field-input field-input-sm"
                      type="number"
                      min={1}
                      step={1}
                      value={rewriteMaxTokens}
                      aria-label="最大 Token"
                      onChange={(e) => setRewriteMaxTokens(e.target.value)}
                    />
                  </label>
                  <label className="field-inline">
                    <span className="field-label">每篇改写段数</span>
                    <input
                      className="field-input field-input-sm"
                      type="number"
                      min={1}
                      max={8}
                      step={1}
                      value={maxRewriteParagraphs}
                      aria-label="每篇改写段数"
                      onChange={(e) => setMaxRewriteParagraphs(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                    />
                  </label>
                  <span className="assistant-toolbar-hint">参数将透传至逐段风格改写;多模型回退/重试随当前生效配置自动生效</span>
                </div>
                {error && <div className="assistant-error">{error}</div>}

                {aiResults.length > 0 && (
                  <div className="assistant-section">
                    <div className="assistant-fact-summary">
                      已批量 AI 自动完成 {aiResults.length} 篇：{aiResults.filter((r) => r.ok).length} 篇成功，
                      {aiResults.reduce((n, r) => n + r.fixCount, 0)} 处修复，
                      {aiResults.reduce((n, r) => n + r.paragraphRewriteCount, 0)} 段风格改写。
                    </div>
                    {aiResults.map((r) => (
                      <div key={r.id} className="batch-item">
                        <div className="batch-item-head">
                          <span className="batch-item-title">{r.title}</span>
                          <span className={r.ok ? "batch-item-ok" : "batch-item-fail"}>
                            {r.ok ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                            {r.ok ? (r.allPassed ? "全部通过" : "有校验问题") : "失败"}
                          </span>
                        </div>
                        <div className="batch-item-meta">
                          {r.usedLlm ? "LLM" : "规则"}模式 · 修复 {r.fixCount} 处 · 改写 {r.paragraphRewriteCount} 段
                          {r.agent.elapsedMs ? ` · ${(r.agent.elapsedMs / 1000).toFixed(1)}s` : ""}
                          {r.error ? ` · ${r.error}` : ""}
                        </div>
                        {r.ok && r.agent.markdown !== items.find((it) => it.id === r.id)?.markdown && (
                          <div className="assistant-toolbar">
                            <span className="assistant-toolbar-hint">内容有变化，可一键应用</span>
                          </div>
                        )}
                      </div>
                    ))}
                    {aiChanged > 0 && (
                      <div className="assistant-toolbar">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={applyAiResults}
                          disabled={appliedIds.size > 0}
                        >
                          {appliedIds.size > 0 ? <Check size={14} aria-hidden /> : <PenLine size={14} aria-hidden />}
                          {appliedIds.size > 0 ? "已全部应用" : `应用全部改写结果（${aiChanged} 篇）`}
                        </button>
                        <span className="assistant-toolbar-hint">
                          当前编辑直接生效；已保存草稿将写回存储（可回溯）。
                        </span>
                      </div>
                    )}
                    {aiResults.some((r) => r.ok && r.agent.markdown !== items.find((it) => it.id === r.id)?.markdown) && (
                      <div className="assistant-toolbar">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={enqueueBatchToQueue}
                          disabled={running}
                        >
                          <CalendarClock size={14} aria-hidden />
                          一键把 AI 结果排入发布队列
                        </button>
                        <span className="assistant-toolbar-hint">
                          AI-QUEUE-02：把有改写的篇目排入「发布队列」（可改期/取消）
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {aiResults.length === 0 && !running && (
                  <div className="assistant-empty">
                    <Sparkles size={22} aria-hidden />
                    让大模型一键批量完成多篇草稿的「分析 → 修复 → 增强 → 复核」
                  </div>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
