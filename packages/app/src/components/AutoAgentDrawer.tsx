/**
 * AI 自动完成抽屉 —— 让大模型自动完成"分析 → 修复 → 增强 → 复核"。
 *
 * 一键触发 runAutoAgent:
 * - 结构分析(字数/段落/标题/图片/平均排版分);
 * - 自动修复可修复建议(拆段/插标题/截断标题,可整体撤销);
 * - 为各平台生成标题/摘要候选(LLM 优先,规则兜底);
 * - 复检校验,汇总报告。
 *
 * 交互:
 * - 「开始 AI 自动完成」按钮(配置了 LLM 时提示会走 LLM;未配置时纯规则兜底);
 * - 分步报告展示(每步图标 + 摘要);
 * - 修复结果:一键应用(修改 markdown,记录撤销快照)或忽略;
 * - 候选列表:选择标题/摘要后应用到对应平台覆盖层。
 *
 * 全部为前端实时计算,无持久化依赖;每步失败独立回退。
 */
import { useMemo, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Sparkles,
  ScanSearch,
  Wrench,
  Wand2,
  ShieldCheck,
  FileCheck2,
  Check,
  Undo2,
  Loader2,
  Info,
  AlertTriangle,
  Play,
  ArrowRight,
} from "lucide-react";
import { runAutoAgent, type AutoAgentResult, type AgentStep } from "@mpp/core";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEP_META: Record<string, { icon: typeof ScanSearch; label: string }> = {
  analyze: { icon: ScanSearch, label: "结构分析" },
  fix: { icon: Wrench, label: "自动修复" },
  enhance: { icon: Wand2, label: "标题/摘要增强" },
  verify: { icon: ShieldCheck, label: "校验复核" },
  report: { icon: FileCheck2, label: "汇总报告" },
};

export function AutoAgentDrawer({ open, onOpenChange }: Props) {
  const markdown = useStore((s) => s.markdown);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const setMarkdown = useStore((s) => s.setMarkdown);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoAgentResult | null>(null);
  const [error, setError] = useState("");
  const [appliedFixes, setAppliedFixes] = useState(false);
  const [undoSnapshots, setUndoSnapshots] = useState<string[]>([]);
  const [selectedTitles, setSelectedTitles] = useState<Record<string, string>>({});
  const [selectedSummaries, setSelectedSummaries] = useState<Record<string, string>>({});

  const llmReady = !!llm.baseUrl && !!llm.apiKey && !!llm.model;
  const fixCount = result?.appliedFixes.length ?? 0;
  const paragraphCount = result ? Object.values(result.paragraphRewrites).reduce((n, list) => n + list.length, 0) : 0;

  const run = useCallback(async () => {
    if (!markdown.trim()) {
      setError("当前内容为空,请先输入 Markdown");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    setAppliedFixes(false);
    setUndoSnapshots([]);
    setSelectedTitles({});
    setSelectedSummaries({});
    try {
      // AI 连接中心:优先用当前生效配置 + 备用配置构造回退适配器(主失败自动切备用),
      // 每套配置带指数退避重试;无多配置时退化为单配置直连。
      const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const res = await runAutoAgent(markdown, {
        platformIds: selectedPlatforms,
        llm: llmAdapter,
        autoFix: true,
        maxFixRounds: 3,
        enhance: true,
        autoApplyOverrides: false,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [markdown, selectedPlatforms, llm, llmConfigs, activeLlmConfigId]);

  // 一键应用全部修复(记录撤销快照)。
  const applyAllFixes = useCallback(() => {
    if (!result || result.appliedFixes.length === 0) return;
    setUndoSnapshots((s) => [markdown, ...s].slice(0, 20));
    setMarkdown(result.markdown);
    setAppliedFixes(true);
  }, [result, markdown, setMarkdown]);

  // 撤销修复(回到运行前原文)。
  const undoFixes = useCallback(() => {
    setUndoSnapshots((s) => {
      const [last, ...rest] = s;
      if (last) setMarkdown(last);
      return rest;
    });
    setAppliedFixes(false);
  }, [setMarkdown]);

  // 应用某个平台的标题/摘要候选。
  const applyCandidate = useCallback(
    (platformId: string, kind: "title" | "summary", text: string) => {
      if (kind === "title") setSelectedTitles((p) => ({ ...p, [platformId]: text }));
      else setSelectedSummaries((p) => ({ ...p, [platformId]: text }));
    },
    [],
  );

  const stats = useMemo(() => {
    if (!result) return null;
    return result.analysis;
  }, [result]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Sparkles size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              AI 自动完成
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            <div className="assistant-toolbar">
              <span className="assistant-toolbar-hint">
                {llmReady ? (
                  <>
                    <Info size={13} aria-hidden style={{ verticalAlign: "-2px" }} />
                    已配置 LLM({llm.model}),将自动分析 / 修复 / 生成多平台标题摘要候选
                  </>
                ) : (
                  <>
                    <AlertTriangle size={13} aria-hidden style={{ verticalAlign: "-2px" }} />
                    未配置 LLM,将以规则引擎完成分析 / 修复 / 候选(零密钥可用)
                  </>
                )}
              </span>
            </div>

            <div className="assistant-toolbar">
              <button
                type="button"
                className="btn btn-primary"
                disabled={running || !markdown.trim()}
                onClick={run}
              >
                {running ? (
                  <>
                    <Loader2 size={16} className="spinner" aria-hidden />
                    AI 自动完成中…
                  </>
                ) : (
                  <>
                    <Play size={16} aria-hidden />
                    开始 AI 自动完成
                  </>
                )}
              </button>
              {result && (
                <span className="assistant-toolbar-hint">
                  耗时 {(result.elapsedMs / 1000).toFixed(2)}s · {result.usedLlm ? "LLM" : "规则"} 模式
                </span>
              )}
            </div>

            {error && <div className="assistant-error">{error}</div>}

            {stats && (
              <div className="assistant-section">
                <div className="assistant-section-title">内容概况</div>
                <div className="agent-stats-grid">
                  <span>{stats.charCount} 字</span>
                  <span>{stats.paragraphCount} 段</span>
                  <span>{stats.headingCount} 标题</span>
                  <span>{stats.imageCount} 图</span>
                  <span>平均排版 {stats.avgQuality}/100</span>
                </div>
              </div>
            )}

            {result && (
              <div className="assistant-section">
                <div className="assistant-section-title">执行步骤</div>
                <div className="agent-steps">
                  {result.steps.map((step, idx) => (
                    <StepRow key={idx} step={step} />
                  ))}
                </div>
              </div>
            )}

            {result && fixCount > 0 && (
              <div className="assistant-section">
                <div className="assistant-section-title">自动修复({fixCount} 处)</div>
                {result.appliedFixes.map((f) => (
                  <div key={f.id} className="assistant-suggestion issue-info">
                    <div className="assistant-suggestion-msg">{f.description}</div>
                  </div>
                ))}
                <div className="assistant-toolbar">
                  {appliedFixes ? (
                    <button type="button" className="btn btn-sm" onClick={undoFixes}>
                      <Undo2 size={14} aria-hidden />
                      撤销修复
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" onClick={applyAllFixes}>
                      <Check size={14} aria-hidden />
                      应用全部修复
                    </button>
                  )}
                  <span className="assistant-toolbar-hint">
                    {appliedFixes ? `已应用到编辑区(可撤销, 共 ${undoSnapshots.length} 次快照)` : "应用后将修改当前 Markdown"}
                  </span>
                </div>
              </div>
            )}

            {result && paragraphCount > 0 && (
              <div className="assistant-section">
                <div className="assistant-section-title">LLM 逐段风格改写({paragraphCount} 段)</div>
                {Object.entries(result.paragraphRewrites).map(([platformId, list]) => (
                  <div key={platformId} className="agent-variant-block">
                    <div className="agent-variant-platform" style={{ color: platformColor(platformId) }}>
                      {platformId} · {list.length} 段
                    </div>
                    {list.map((r) => (
                      <div key={`${platformId}-${r.index}`} className="assistant-suggestion issue-info">
                        <div className="assistant-suggestion-msg">第 {r.index + 1} 段已按 {platformId} 风格润色</div>
                        <div className="paragraph-rewrite-diff">
                          <div className="paragraph-rewrite-col paragraph-rewrite-before">{r.before.slice(0, 60)}{r.before.length > 60 ? "…" : ""}</div>
                          <ArrowRight size={12} className="paragraph-rewrite-arrow" aria-hidden />
                          <div className="paragraph-rewrite-col paragraph-rewrite-after">{r.after.slice(0, 60)}{r.after.length > 60 ? "…" : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">逐段风格改写已随修复结果一并应用;如需回退,使用「撤销修复」。</span>
                </div>
              </div>
            )}

            {result && Object.keys(result.variants).length > 0 && (
              <div className="assistant-section">
                <div className="assistant-section-title">平台标题/摘要候选</div>
                {Object.entries(result.variants).map(([platformId, set]) => {
                  const color = platformColor(platformId);
                  return (
                    <div key={platformId} className="agent-variant-block">
                      <div className="agent-variant-platform" style={{ color }}>
                        {platformId}
                      </div>
                      {set.titles.length > 0 && (
                        <div className="agent-variant-group">
                          <span className="agent-variant-label">标题</span>
                          <div className="agent-variant-list">
                            {set.titles.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                className={`agent-variant-item ${selectedTitles[platformId] === v.text ? "selected" : ""}`}
                                onClick={() => applyCandidate(platformId, "title", v.text)}
                              >
                                <span className="agent-variant-text">{v.text}</span>
                                <span className="agent-variant-source">{v.source}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {set.summaries.length > 0 && (
                        <div className="agent-variant-group">
                          <span className="agent-variant-label">摘要</span>
                          <div className="agent-variant-list">
                            {set.summaries.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                className={`agent-variant-item ${selectedSummaries[platformId] === v.text ? "selected" : ""}`}
                                onClick={() => applyCandidate(platformId, "summary", v.text)}
                              >
                                <span className="agent-variant-text">{v.text}</span>
                                <span className="agent-variant-source">{v.source}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {(selectedTitles[platformId] || selectedSummaries[platformId]) && (
                        <span className="assistant-toolbar-hint">已选择：{selectedTitles[platformId] ?? ""}{selectedSummaries[platformId] ? ` / ${selectedSummaries[platformId]}` : ""}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!result && !running && (
              <div className="assistant-empty">
                <Sparkles size={22} aria-hidden />
                让大模型自动完成「分析 → 修复 → 增强 → 复核」全流程
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const meta = STEP_META[step.kind];
  const Icon = meta?.icon ?? Info;
  let summary = "";
  if (step.kind === "fix") {
    summary =
      step.applied.length > 0
        ? `自动修复 ${step.applied.length} 处${step.skippedCount > 0 ? `(跳过 ${step.skippedCount})` : ""}`
        : `无需修复或全部跳过${step.skippedCount > 0 ? `(跳过 ${step.skippedCount})` : ""}`;
  } else if (step.kind === "enhance") {
    const n = Object.keys(step.variants).length;
    const paragraphTotal = Object.values(step.paragraphRewrites).reduce((sum, list) => sum + list.length, 0);
    const paragraphText = paragraphTotal > 0 ? ` · 逐段风格改写 ${paragraphTotal} 段` : "";
    summary = step.usedLlm
      ? `已为 ${n} 个平台生成 LLM 标题/摘要候选${paragraphText}`
      : `已为 ${n} 个平台生成规则候选(LLM 不可用)`;
  } else if (step.kind === "verify") {
    summary = step.allPassed
      ? "全部平台通过校验"
      : `${step.errorCount} 个平台存在校验错误${step.remainingErrors.length ? `: ${step.remainingErrors[0]}` : ""}`;
  } else if (step.kind === "report") {
    summary = step.message;
  }
  return (
    <div className="agent-step">
      <span className="agent-step-icon">
        <Icon size={15} aria-hidden />
      </span>
      <div className="agent-step-body">
        <span className="agent-step-label">{meta?.label ?? step.kind}</span>
        <span className="agent-step-summary">{summary}</span>
      </div>
      {step.kind === "verify" && (
        <span className={`agent-step-badge ${step.allPassed ? "ok" : "err"}`}>
          {step.allPassed ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
        </span>
      )}
    </div>
  );
}
