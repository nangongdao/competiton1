/**
 * 内容助手抽屉 —— Phase 5 内容助手(AI-01/02/03)。
 *
 * 三个标签页:
 * - 建议(AI-01):把排版/校验建议结构化展示,支持"定位 + 一键修复 + 撤销";
 * - 多方案(AI-02):为各平台标题/摘要生成候选,用户选择后应用到平台覆盖层;
 * - 事实检查(AI-03):扫描正文,标记无来源支撑的断言(只标记,不伪造引用)。
 *
 * 全部为纯前端实时计算(复用 @mpp/core 的 assistant 模块),无持久化依赖。
 */
import { useMemo, useState, useCallback, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Wand2, Lightbulb, GitCompare, ShieldAlert, Check, Undo2, Loader2, Info } from "lucide-react";
import {
  markdownToIR,
  deriveTypographySuggestions,
  deriveValidationSuggestions,
  factCheckDocument,
  summarizeFactCheck,
  generateVariants,
  type ContentSuggestion,
  type VariantOption,
  type LlmAdapter,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { platformColor } from "./platform-meta.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Tab = "suggestions" | "variants" | "facts";

/** 修复记录(支持撤销)。 */
interface FixRecord {
  readonly before: string;
  readonly after: string;
  readonly description: string;
}

export function AssistantDrawer({ open, onOpenChange }: Props) {
  const markdown = useStore((s) => s.markdown);
  const results = useStore((s) => s.results);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const [tab, setTab] = useState<Tab>("suggestions");
  const [fixHistory, setFixHistory] = useState<FixRecord[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [variantLoading, setVariantLoading] = useState(false);
  const [variants, setVariants] = useState<Record<string, { titles: VariantOption[]; summaries: VariantOption[] }>>({});
  const [selectedVariant, setSelectedVariant] = useState<Record<string, { title?: string; summary?: string }>>({});
  const [variantsError, setVariantsError] = useState("");

  // 派生结构化建议:基于当前 markdown + 各平台预览结果。
  const { suggestions, factItems } = useMemo(() => {
    if (!markdown.trim()) return { suggestions: [], factItems: [] };
    let doc;
    try {
      doc = markdownToIR(markdown).document;
    } catch {
      return { suggestions: [], factItems: [] };
    }
    const items: ContentSuggestion[] = [];
    for (const r of results) {
      const quality = r.quality;
      if (quality) {
        items.push(...deriveTypographySuggestions(doc, r.platformId, quality.suggestions));
      }
      if (r.report) {
        items.push(...deriveValidationSuggestions(r.report.issues, r.platformId, doc));
      }
    }
    return { suggestions: items, factItems: factCheckDocument(doc) };
  }, [markdown, results]);

  const factSummary = useMemo(() => summarizeFactCheck(factItems), [factItems]);
  const fixableCount = useMemo(() => suggestions.filter((s) => s.fix).length, [suggestions]);

  // 重置选择状态(内容变化后清除已应用标记,避免误导)。
  useEffect(() => {
    setAppliedIds(new Set());
  }, [markdown]);

  // AI-01:一键应用某条建议的修复动作。
  const applyFix = useCallback(
    (s: ContentSuggestion) => {
      if (!s.fix || appliedIds.has(s.id)) return;
      const before = markdown;
      const after = s.fix.apply(before);
      if (after === before) return;
      useStore.getState().setMarkdown(after);
      setFixHistory((h) => [{ before, after, description: s.fix!.description }, ...h].slice(0, 20));
      setAppliedIds((prev) => new Set(prev).add(s.id));
    },
    [markdown, appliedIds],
  );

  // AI-01:撤销最近一次修复。
  const undoLastFix = useCallback(() => {
    setFixHistory((h) => {
      const last = h[0];
      if (!last) return h;
      useStore.getState().setMarkdown(last.before);
      setAppliedIds(new Set());
      return h.slice(1);
    });
  }, []);

  // AI-02:生成各平台标题/摘要候选。
  const generateVariantsForAll = useCallback(async () => {
    if (!markdown.trim()) return;
    setVariantLoading(true);
    setVariantsError("");
    try {
      let doc;
      try {
        doc = markdownToIR(markdown).document;
      } catch {
        doc = null;
      }
      if (!doc) {
        setVariantsError("无法解析当前内容");
        return;
      }
      const llmAdapter: LlmAdapter | undefined = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
      const contentText = doc.blocks
        .map(blockToText)
        .filter(Boolean)
        .join(" ")
        .slice(0, 800);
      const next: Record<string, { titles: VariantOption[]; summaries: VariantOption[] }> = {};
      for (const platformId of selectedPlatforms) {
        const result = results.find((r) => r.platformId === platformId);
        const title = result?.artifact?.payload.title ?? doc.meta.title ?? "未命名";
        const summary = result?.artifact?.payload.summary;
        const r = await generateVariants(
          { platformId, title, summary, contentText, titleMax: 30, summaryMax: 120 },
          llmAdapter,
          3,
        );
        next[platformId] = { titles: [...r.titles], summaries: [...r.summaries] };
      }
      setVariants(next);
    } catch (err) {
      setVariantsError(err instanceof Error ? err.message : String(err));
    } finally {
      setVariantLoading(false);
    }
  }, [markdown, selectedPlatforms, results, llm, llmConfigs, activeLlmConfigId]);

  // AI-02:把选中的标题/摘要应用到对应平台覆盖层。
  const applyVariant = useCallback(
    (platformId: string, kind: "title" | "summary", text: string) => {
      setSelectedVariant((prev) => ({
        ...prev,
        [platformId]: { ...prev[platformId], [kind]: text },
      }));
    },
    [],
  );

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "suggestions", label: "建议", badge: suggestions.length },
    { key: "variants", label: "多方案" },
    { key: "facts", label: "事实检查", badge: factSummary.unverified },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Wand2 size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              内容助手
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="assistant-tabs" role="tablist" aria-label="内容助手功能">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? "assistant-tab active" : "assistant-tab"}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {typeof t.badge === "number" && t.badge > 0 && <span className="assistant-badge">{t.badge}</span>}
              </button>
            ))}
          </div>

          <div className="drawer-body">
            {tab === "suggestions" && (
              <SuggestionsTab
                suggestions={suggestions}
                fixableCount={fixableCount}
                appliedIds={appliedIds}
                fixHistory={fixHistory}
                onApply={applyFix}
                onUndo={undoLastFix}
              />
            )}
            {tab === "variants" && (
              <VariantsTab
                platforms={selectedPlatforms}
                variants={variants}
                selected={selectedVariant}
                loading={variantLoading}
                error={variantsError}
                onGenerate={generateVariantsForAll}
                onSelect={applyVariant}
              />
            )}
            {tab === "facts" && <FactsTab items={factItems} summary={factSummary} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// AI-01 建议 tab
// ---------------------------------------------------------------------------

function SuggestionsTab({
  suggestions,
  fixableCount,
  appliedIds,
  fixHistory,
  onApply,
  onUndo,
}: {
  suggestions: readonly ContentSuggestion[];
  fixableCount: number;
  appliedIds: ReadonlySet<string>;
  fixHistory: readonly FixRecord[];
  onApply: (s: ContentSuggestion) => void;
  onUndo: () => void;
}) {
  if (suggestions.length === 0) {
    return (
      <div className="assistant-empty">
        <Lightbulb size={22} aria-hidden />
        暂无建议。输入内容后,这里会给出排版与校验优化建议。
      </div>
    );
  }
  return (
    <div className="assistant-section">
      {fixHistory.length > 0 && (
        <div className="assistant-toolbar">
          <span className="assistant-toolbar-hint">已应用 {fixHistory.length} 项修复</span>
          <button type="button" className="btn btn-sm" onClick={onUndo}>
            <Undo2 size={14} aria-hidden />
            撤销
          </button>
        </div>
      )}
      {fixableCount > 0 && (
        <div className="assistant-toolbar">
          <span className="assistant-toolbar-hint">
            <Info size={13} aria-hidden style={{ verticalAlign: "-2px" }} />
            {fixableCount} 项可一键修复
          </span>
        </div>
      )}
      <div className="assistant-suggestion-list">
        {suggestions.map((s, idx) => {
          const color = platformColor(s.platformId);
          return (
            <div key={`${s.id}-${idx}`} className={`assistant-suggestion issue-${s.severity}`} style={{ ["--chip-color" as string]: color }}>
              <div className="assistant-suggestion-head">
                <span className="assistant-platform" style={{ color }}>
                  {s.platformId}
                </span>
                <span className="assistant-code">{s.code}</span>
              </div>
              <div className="assistant-suggestion-msg">{s.message}</div>
              {s.locate && (
                <div className="assistant-locate">
                  定位：{s.locate.blockType}
                  {s.locate.blockIndex >= 0 ? ` #${s.locate.blockIndex + 1}` : "（标题）"}
                  {s.locate.charCount ? ` · ${s.locate.charCount} 字` : ""}
                  <span className="assistant-excerpt">「{s.locate.excerpt}…」</span>
                </div>
              )}
              {s.fix && !appliedIds.has(s.id) && (
                <button type="button" className="btn btn-sm assistant-fix-btn" onClick={() => onApply(s)}>
                  <Wand2 size={13} aria-hidden />
                  一键修复
                </button>
              )}
              {s.fix && appliedIds.has(s.id) && (
                <span className="assistant-applied">
                  <Check size={13} aria-hidden />
                  已应用
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI-02 多方案 tab
// ---------------------------------------------------------------------------

function VariantsTab({
  platforms,
  variants,
  selected,
  loading,
  error,
  onGenerate,
  onSelect,
}: {
  platforms: readonly string[];
  variants: Record<string, { titles: VariantOption[]; summaries: VariantOption[] }>;
  selected: Record<string, { title?: string; summary?: string }>;
  loading: boolean;
  error: string;
  onGenerate: () => void;
  onSelect: (platformId: string, kind: "title" | "summary", text: string) => void;
}) {
  return (
    <div className="assistant-section">
      <div className="assistant-toolbar">
        <span className="assistant-toolbar-hint">
          为每个平台生成标题/摘要候选（选择后应用到该平台预览）
        </span>
        <button type="button" className="btn btn-sm btn-primary" onClick={onGenerate} disabled={loading || platforms.length === 0}>
          {loading ? <Loader2 size={14} className="spinner" aria-hidden /> : <GitCompare size={14} aria-hidden />}
          {loading ? "生成中…" : "生成候选"}
        </button>
      </div>
      {error && <div className="assistant-error">{error}</div>}
      {platforms.length === 0 && <div className="assistant-empty">请先选择至少一个平台。</div>}
      {platforms.map((platformId) => {
        const v = variants[platformId];
        if (!v) return null;
        const color = platformColor(platformId);
        return (
          <div key={platformId} className="variant-platform" style={{ ["--chip-color" as string]: color }}>
            <div className="variant-platform-title" style={{ color }}>
              {platformId}
            </div>
            <VariantGroup
              label="标题"
              options={v.titles}
              selected={selected[platformId]?.title}
              onPick={(text) => onSelect(platformId, "title", text)}
            />
            <VariantGroup
              label="摘要"
              options={v.summaries}
              selected={selected[platformId]?.summary}
              onPick={(text) => onSelect(platformId, "summary", text)}
            />
          </div>
        );
      })}
    </div>
  );
}

function VariantGroup({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: readonly VariantOption[];
  selected?: string;
  onPick: (text: string) => void;
}) {
  return (
    <div className="variant-group">
      <div className="variant-group-label">{label}</div>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={selected === opt.text ? "variant-option active" : "variant-option"}
          onClick={() => onPick(opt.text)}
        >
          <span className="variant-option-text">{opt.text}</span>
          <span className="variant-option-meta">
            {opt.source === "llm" ? "AI" : opt.source === "rule" ? "规则" : "原文"}
            {opt.withinLimit ? "" : " · 超限"}
            {opt.charCount > 0 ? ` · ${opt.charCount}字` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI-03 事实检查 tab
// ---------------------------------------------------------------------------

function FactsTab({
  items,
  summary,
}: {
  items: readonly ReturnType<typeof factCheckDocument>[number][];
  summary: { total: number; unverified: number; withCitation: number };
}) {
  if (items.length === 0) {
    return (
      <div className="assistant-empty">
        <ShieldAlert size={22} aria-hidden />
        没有可检查的句子。事实检查会标记"含具体数字/日期但缺来源"的内容。
      </div>
    );
  }
  return (
    <div className="assistant-section">
      <div className="assistant-fact-summary">
        共 {summary.total} 句，{summary.unverified} 句缺少来源标注，{summary.withCitation} 句已含引用。
        <div className="assistant-fact-note">
          原则：只标记缺证据内容，不伪造引用；证据与生成文本分层展示。
        </div>
      </div>
      <div className="assistant-suggestion-list">
        {items.map((item) => (
          <div
            key={item.id}
            className={`assistant-suggestion ${item.verdict === "unverified-claim" ? "issue-warning" : "issue-info"}`}
          >
            <div className="assistant-suggestion-msg">「{item.sentence}」</div>
            <div className="assistant-locate">
              {item.verdict === "unverified-claim"
                ? "⚠ 含可核验线索但缺少来源标注"
                : item.verdict === "has-citation"
                  ? "✓ 含引用/来源标注"
                  : "观点陈述，无具体可核验线索"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 把块转纯文本(供 AI-02 提取正文)。 */
function blockToText(b: { type: string; inlines?: readonly unknown[] }): string {
  if (b.type === "paragraph" || b.type === "heading") {
    return (b.inlines ?? []).map(inlineText).join("");
  }
  return "";
}
function inlineText(i: unknown): string {
  if (!i || typeof i !== "object") return "";
  const it = i as { type?: string; value?: string; children?: readonly unknown[]; tex?: string };
  if (it.type === "text" || it.type === "code" || it.type === "emoji") return it.value ?? "";
  if (it.type === "strong" || it.type === "em" || it.type === "link") return (it.children ?? []).map(inlineText).join("");
  if (it.type === "inlineMath") return it.tex ?? "";
  if (it.type === "lineBreak") return " ";
  return "";
}
