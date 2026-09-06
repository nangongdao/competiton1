/**
 * AI 草稿检索抽屉(AI-INSIGHT-03)—— 为草稿生成摘要/关键词索引并本地 AI 检索。
 *
 * - 索引:对每篇草稿生成「一句话摘要 + 关键词 + 主题标签」(LLM 可用时 LLM 生成,
 *   否则规则兜底),本地缓存;
 * - 检索:输入自然语言,在标题/关键词/摘要/主题上做**确定性相关度评分**(离线、
 *   不依赖 LLM),按相关度排序;点击命中项直接载入草稿到编辑区;
 * - 安全:索引不含 apiKey / token;数据仅本地。
 */
import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Search, Sparkles, FileText, Loader2, RefreshCw, Check, AlertTriangle } from "lucide-react";
import {
  buildDraftIndex,
  searchDraftIndexes,
  type DraftIndex,
  type DraftHit,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DraftSearchDrawer({ open, onOpenChange }: Props) {
  const drafts = useStore((s) => s.drafts);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const draftIndexes = useStore((s) => s.draftIndexes);
  const setDraftIndexes = useStore((s) => s.setDraftIndexes);
  const loadDraft = useStore((s) => s.loadDraft);

  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(0);
  const [error, setError] = useState("");

  const llmReady = !!llm.baseUrl && !!llm.apiKey && !!llm.model;

  /** 已索引的草稿 id 集合。 */
  const indexedIds = useMemo(() => new Set(draftIndexes.map((d) => d.draftId)), [draftIndexes]);

  /** 为一篇草稿生成索引(LLM 可用则 LLM,否则规则)。 */
  const indexOne = async (d: { id: string; title: string; markdown: string }): Promise<DraftIndex> => {
    const adapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
    return buildDraftIndex(d.id, d.title, d.markdown, adapter);
  };

  /** 重建/补齐全部草稿索引(有 LLM 则用 LLM,无则规则兜底)。 */
  const rebuildAll = async () => {
    setBuilding(true);
    setError("");
    try {
      const targets = drafts.filter((d) => !indexedIds.has(d.id));
      const results: DraftIndex[] = [];
      let count = 0;
      for (const d of targets) {
        const idx = await indexOne(d);
        results.push(idx);
        count++;
      }
      // 保留已有的索引,新增/更新本次生成的。
      const merged = [...draftIndexes.filter((x) => !results.some((r) => r.draftId === x.draftId)), ...results];
      setDraftIndexes(merged);
      setBuilt(count);
      toast(`已为 ${count} 篇草稿生成摘要索引`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast(`索引生成失败:${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setBuilding(false);
    }
  };

  const hits = useMemo(
    () => searchDraftIndexes(draftIndexes, query, { limit: 8, minScore: 0.1 }),
    [draftIndexes, query],
  );

  const loadHit = async (hit: DraftHit) => {
    await loadDraft(hit.draftId);
    toast(`已载入《${hit.title}》`, "success");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Search size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              AI 草稿检索
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            <div className="assistant-fact-summary">
              为草稿生成摘要/关键词索引({draftIndexes.length}/{drafts.length} 已索引),输入自然语言即可本地检索定位旧内容。
              {llmReady ? ` · LLM(${llm.model})` : " · 规则模式(未配置 LLM)"}
            </div>

            <div className="assistant-toolbar">
              <input
                className="field-input"
                value={query}
                placeholder="搜索草稿,如:效率工具 / 时间管理 / 上周写的那篇…"
                aria-label="搜索草稿"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void rebuildAll()}
                disabled={building || drafts.length === 0}
                title="为未索引草稿生成摘要/关键词"
              >
                {building ? (
                  <Loader2 size={14} className="spinner" aria-hidden />
                ) : (
                  <RefreshCw size={14} aria-hidden />
                )}
                {building ? "生成中…" : indexedIds.size < drafts.length ? `补建索引(${drafts.length - indexedIds.size})` : "重建索引"}
              </button>
            </div>
            {error && <div className="assistant-error">{error}</div>}
            {built > 0 && !error && (
              <div className="field-hint" style={{ color: "var(--success)", display: "flex", alignItems: "center", gap: 6 }}>
                <Check size={12} aria-hidden />
                本轮新索引 {built} 篇,可立即检索
              </div>
            )}

            {/* 检索结果 */}
            {query.trim() && hits.length > 0 && (
              <div className="assistant-section">
                <div className="assistant-section-title">命中 {hits.length} 条</div>
                {hits.map((h) => (
                  <div key={h.draftId} className="config-item" style={{ cursor: "pointer" }}>
                    <button
                      type="button"
                      className="config-item-info"
                      style={{ all: "unset", display: "flex", flexDirection: "column", gap: 4, cursor: "pointer", textAlign: "left", flex: 1 }}
                      onClick={() => void loadHit(h)}
                    >
                      <span className="config-item-name">
                        <FileText size={13} aria-hidden />
                        {h.title}
                        <span className="config-item-active">相关度 {Math.round(h.score * 100)}%</span>
                      </span>
                      <span className="config-item-meta">{h.summary}</span>
                      {h.matchedKeywords.length > 0 && (
                        <span className="config-item-meta">命中关键词:{h.matchedKeywords.join(" / ")}</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {query.trim() && hits.length === 0 && draftIndexes.length > 0 && (
              <div className="assistant-empty">
                <AlertTriangle size={20} aria-hidden />
                没有命中。换个关键词,或先为草稿补建索引。
              </div>
            )}

            {/* 索引列表 */}
            {!query.trim() && (
              <div className="assistant-section">
                <div className="assistant-section-title">已索引草稿</div>
                {draftIndexes.length === 0 ? (
                  <div className="assistant-empty">
                    <Sparkles size={20} aria-hidden />
                    还没有索引。点击「补建索引」为草稿生成摘要/关键词。
                  </div>
                ) : (
                  draftIndexes.slice(0, 8).map((idx) => (
                    <div key={idx.draftId} className="config-item">
                      <div className="config-item-info">
                        <span className="config-item-name">
                          <FileText size={13} aria-hidden />
                          {idx.title}
                          {idx.usedLlm ? (
                            <span className="config-item-active">LLM</span>
                          ) : (
                            <span className="config-item-meta">规则</span>
                          )}
                        </span>
                        <span className="config-item-meta">{idx.summary}</span>
                        <span className="config-item-meta">
                          {idx.keywords.slice(0, 4).join(" · ")}
                          {idx.topics && idx.topics.length > 0 ? ` · #${idx.topics.join(" #")}` : ""}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
