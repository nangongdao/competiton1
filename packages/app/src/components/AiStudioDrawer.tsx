/**
 * AI 智能增强工作台(v11 Part 2) —— AI 内容一键裂变 / 跨平台本土化 /
 * 视觉与多媒体 AI / AI 智能客服与评论营销 / 合规与安全审查。
 *
 * 能力:
 * - 一键裂变:长内容 → 小红书 / 微博 / 抖音三平台(LLM 增强,失败回退规则);
 * - 跨平台本土化:同一内容按六平台文风适配 + 智能 Hashtag;
 * - 视觉与多媒体 AI:多风格封面建议 / 视频横竖屏转换 / 数字人播报分镜;
 * - 评论营销:粘贴评论列表 → 意图识别 / 情绪分析 / 高意向与负面预警;
 * - 合规审查:对当前标题+正文扫描极限词 / 敏感词 / 风险链接 / 版权 / 图片缺 alt。
 *
 * 全部纯函数闭环:LLM 可用时增强,失败自动回退规则(离线可跑)。
 * 全 Lucide 图标。输入来自当前 markdown + 评论粘贴框。
 */
import { useCallback, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Sparkles,
  X,
  Wand2,
  Scissors,
  Languages,
  Image as ImageIcon,
  MessageSquareHeart,
  ShieldCheck,
  Loader2,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Users,
  Hash,
  Film,
  Bot,
} from "lucide-react";
import {
  fissionLongContentWithLlm,
  generateRewriteVariants,
  localizeContent,
  suggestHashtags,
  suggestCovers,
  adaptVideoRule,
  buildAnchorStoryboard,
  analyzeComment,
  digestNegativeComments,
  scanCompliance,
  LOCALIZE_PROFILES,
  type LocalizeTarget,
  type FissionResult,
  type LocalizedContent,
  type CoverSuggestion,
  type AnchorStoryboard,
  type RewriteVariantsResult,
  type ComplianceReport,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import { platformColor } from "./platform-meta.js";
import { toast } from "./toast.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 从 Markdown 提取标题。 */
function deriveTitleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 30) : "";
}

function deriveTitleFromMarkdownSafe(markdown: string): string {
  return deriveTitleFromMarkdown(markdown);
}

type StudioTab = "fission" | "localize" | "media" | "crm" | "compliance";

export function AiStudioDrawer({ open, onOpenChange }: Props) {
  const markdown = useStore((s) => s.markdown);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);

  const [tab, setTab] = useState<StudioTab>("fission");
  const [busy, setBusy] = useState(false);

  // 裂变
  const [fission, setFission] = useState<FissionResult | null>(null);
  // 本土化
  const [localized, setLocalized] = useState<Record<string, LocalizedContent>>({});
  const [localizeTargets, setLocalizeTargets] = useState<LocalizeTarget[]>([
    "xiaohongshu",
    "zhihu",
    "linkedin",
  ]);
  const [hashtags, setHashtags] = useState<readonly { tag: string; heat: string }[]>([]);
  // 多媒体
  const [covers, setCovers] = useState<readonly CoverSuggestion[]>([]);
  const [anchor, setAnchor] = useState<AnchorStoryboard | null>(null);
  // 改写
  const [variants, setVariants] = useState<RewriteVariantsResult | null>(null);
  // 评论营销
  const [commentsText, setCommentsText] = useState("");
  const [crmResults, setCrmResults] = useState<readonly {
    text: string;
    intent: string;
    sentiment: string;
    highIntent: boolean;
    needsAttention: boolean;
    autoReply?: string;
    suggestedAction: string;
  }[]>([]);
  const [negativeDigest, setNegativeDigest] = useState<{ total: number; alerts: readonly { action: string }[] } | null>(null);
  // 合规
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null);

  const llmAdapter = useMemo(
    () => buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId }),
    [llm, llmConfigs, activeLlmConfigId],
  );
  const title = useMemo(() => deriveTitleFromMarkdownSafe(markdown), [markdown]);
  const llmReady = useMemo(() => Boolean(llmAdapter?.available), [llmAdapter]);

  const runFission = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fissionLongContentWithLlm(title || "(未命名)", markdown, llmAdapter, {
        useLlm: llmReady,
      });
      setFission(r);
    } catch (err) {
      toast(err instanceof Error ? err.message : "一键裂变失败");
    } finally {
      setBusy(false);
    }
  }, [title, markdown, llmAdapter, llmReady]);

  const runLocalize = useCallback(async () => {
    setBusy(true);
    try {
      const out: Record<string, LocalizedContent> = {};
      for (const target of localizeTargets) {
        out[target] = await localizeContent(title || "(未命名)", markdown, target, llmAdapter, {
          useLlm: llmReady,
        });
      }
      setLocalized(out);
      const tags = await suggestHashtags(title || "(未命名)", markdown, llmAdapter, {
        useLlm: llmReady,
      });
      setHashtags(tags.tags);
    } catch (err) {
      toast(err instanceof Error ? err.message : "本土化适配失败");
    } finally {
      setBusy(false);
    }
  }, [title, markdown, localizeTargets, llmAdapter, llmReady]);

  const runMedia = useCallback(async () => {
    setBusy(true);
    try {
      const c = await suggestCovers(title || "(未命名)", markdown, llmAdapter, {
        platforms: ["xiaohongshu", "wechat", "video"],
        useLlm: llmReady,
      });
      setCovers(c.covers);
      const a = await buildAnchorStoryboard(title || "(未命名)", markdown, llmAdapter, {
        useLlm: llmReady,
      });
      setAnchor(a);
      const v = await generateRewriteVariants(markdown, llmAdapter, {
        count: 3,
        useLlm: llmReady,
      });
      setVariants(v);
    } catch (err) {
      toast(err instanceof Error ? err.message : "多媒体生成失败");
    } finally {
      setBusy(false);
    }
  }, [title, markdown, llmAdapter, llmReady]);

  const runCrm = useCallback(async () => {
    const lines = commentsText
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast("请先粘贴评论列表(每行一条)", "error");
      return;
    }
    setBusy(true);
    try {
      const results = [];
      for (const line of lines) {
        const insight = await analyzeComment(line, llmAdapter, { useLlm: llmReady });
        results.push({
          text: line,
          intent: insight.intent,
          sentiment: insight.sentiment,
          highIntent: insight.highIntent,
          needsAttention: insight.needsAttention,
          ...(insight.autoReply ? { autoReply: insight.autoReply } : {}),
          suggestedAction: insight.suggestedAction,
        });
      }
      setCrmResults(results);
      const digest = digestNegativeComments(lines);
      setNegativeDigest({
        total: digest.total,
        alerts: digest.alerts.map((a) => ({ action: a.action })),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "评论分析失败");
    } finally {
      setBusy(false);
    }
  }, [commentsText, llmAdapter, llmReady]);

  const runCompliance = useCallback(() => {
    const report = scanCompliance(title || "(未命名)", markdown);
    setCompliance(report);
  }, [title, markdown]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板", "success");
    } catch {
      toast("复制失败");
    }
  }, []);

  const tabs: { key: StudioTab; label: string; icon: typeof Wand2 }[] = [
    { key: "fission", label: "一键裂变", icon: Scissors },
    { key: "localize", label: "本土化", icon: Languages },
    { key: "media", label: "多媒体 AI", icon: ImageIcon },
    { key: "crm", label: "评论营销", icon: MessageSquareHeart },
    { key: "compliance", label: "合规审查", icon: ShieldCheck },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide studio-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Sparkles size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              AI 智能增强工作台
            </Dialog.Title>
            <div className="drawer-header-actions">
              <span className={`studio-llm-badge ${llmReady ? "ready" : ""}`}>
                {llmReady ? <CheckCircle2 size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
                {llmReady ? "LLM 已配置" : "规则模式(离线可用)"}
              </span>
              <Dialog.Close asChild>
                <button type="button" className="btn-icon" aria-label="关闭">
                  <X size={16} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="assistant-tabs" role="tablist" aria-label="AI 智能增强功能">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? "assistant-tab active" : "assistant-tab"}
                  onClick={() => setTab(t.key)}
                >
                  <Icon size={14} aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="drawer-body studio-body">
            {tab === "fission" && (
              <div className="assistant-section">
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">
                    把当前长文拆解为小红书 / 微博 / 抖音三平台文案。
                  </span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runFission()}>
                    {busy ? <Loader2 size={13} className="spinner" aria-hidden /> : <Scissors size={13} aria-hidden />}
                    一键裂变
                  </button>
                </div>
                {fission ? (
                  <div className="studio-pieces">
                    {fission.pieces.map((p) => (
                      <div key={p.target} className="studio-piece">
                        <div className="studio-piece-head">
                          <span className="studio-piece-label" style={{ color: platformColor(p.target) }}>
                            {p.label}
                          </span>
                          <span className="studio-piece-meta">
                            {p.usedLlm ? "LLM" : "规则"} · {p.text.length} 字
                          </span>
                          <button type="button" className="btn-icon" aria-label="复制" onClick={() => void copyText(p.text)}>
                            <Copy size={12} aria-hidden />
                          </button>
                        </div>
                        <div className="studio-piece-text">{p.text}</div>
                        {p.tags.length > 0 && (
                          <div className="studio-piece-tags">{p.tags.map((t) => <span key={t} className="tag tag-neutral">{t}</span>)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="assistant-empty">
                    <Scissors size={28} aria-hidden />
                    <p>点击「一键裂变」，把当前内容拆成多平台文案。</p>
                  </div>
                )}
              </div>
            )}

            {tab === "localize" && (
              <div className="assistant-section">
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">按平台文风适配 + 智能 Hashtag。</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runLocalize()}>
                    {busy ? <Loader2 size={13} className="spinner" aria-hidden /> : <Languages size={13} aria-hidden />}
                    生成本地化
                  </button>
                </div>
                <div className="studio-targets">
                  {Object.entries(LOCALIZE_PROFILES).map(([id, profile]) => (
                    <label key={id} className="chip">
                      <input
                        type="checkbox"
                        checked={localizeTargets.includes(id as LocalizeTarget)}
                        onChange={(e) => {
                          setLocalizeTargets((prev) =>
                            e.target.checked
                              ? [...prev, id as LocalizeTarget]
                              : prev.filter((t) => t !== id),
                          );
                        }}
                      />
                      <span className="chip-dot" style={{ background: platformColor(id) }} />
                      {profile.label}
                    </label>
                  ))}
                </div>
                {Object.keys(localized).length > 0 && (
                  <div className="studio-pieces">
                    {localizeTargets.filter((t) => localized[t]).map((t) => (
                      <div key={t} className="studio-piece">
                        <div className="studio-piece-head">
                          <span className="studio-piece-label" style={{ color: platformColor(t) }}>
                            {LOCALIZE_PROFILES[t].label}
                          </span>
                          <span className="studio-piece-meta">{localized[t].usedLlm ? "LLM" : "规则"} · {localized[t].text.length} 字</span>
                          <button type="button" className="btn-icon" aria-label="复制" onClick={() => void copyText(localized[t].text)}>
                            <Copy size={12} aria-hidden />
                          </button>
                        </div>
                        <div className="studio-piece-text">{localized[t].text}</div>
                        <div className="studio-piece-tags">{localized[t].tags.map((tag) => <span key={tag} className="tag tag-neutral">{tag}</span>)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {hashtags.length > 0 && (
                  <div className="studio-hashtags">
                    <span className="studio-hashtags-label">
                      <Hash size={13} aria-hidden /> 智能话题
                    </span>
                    {hashtags.map((h) => (
                      <span key={h.tag} className={`tag ${h.heat === "high" ? "tag-ok" : h.heat === "medium" ? "tag-warn" : "tag-neutral"}`}>
                        {h.tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "media" && (
              <div className="assistant-section">
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">
                    封面建议 / 视频横竖屏转换 / 数字人播报 / 多版本改写。
                  </span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runMedia()}>
                    {busy ? <Loader2 size={13} className="spinner" aria-hidden /> : <ImageIcon size={13} aria-hidden />}
                    生成视觉方案
                  </button>
                </div>
                {covers.length > 0 && (
                  <div className="studio-covers">
                    <div className="studio-subtitle">
                      <ImageIcon size={13} aria-hidden /> 封面建议
                    </div>
                    {covers.map((c) => (
                      <div key={`${c.platformId}-${c.style}`} className="studio-cover">
                        <span className="studio-cover-ratio">{c.ratio}</span>
                        <span className="studio-cover-headline">{c.headline}</span>
                        <span className="studio-cover-style">{c.style}</span>
                        <span className="studio-cover-notes">{c.notes.join(" · ")}</span>
                      </div>
                    ))}
                  </div>
                )}
                {variants && (
                  <div className="studio-variants">
                    <div className="studio-subtitle">
                      <Users size={13} aria-hidden /> 多版本改写(矩阵防重)
                    </div>
                    {variants.variants.map((v) => (
                      <div key={v.index} className="studio-variant">
                        <span className="studio-variant-index">#{v.index}</span>
                        <span className="studio-variant-text">{v.text.slice(0, 120)}{v.text.length > 120 ? "…" : ""}</span>
                        <span className="studio-variant-sim">相似度 {((v.similarityToSource ?? 0) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {anchor && (
                  <div className="studio-anchor">
                    <div className="studio-subtitle">
                      <Bot size={13} aria-hidden /> 数字人播报分镜({anchor.durationSeconds}s)
                    </div>
                    <div className="studio-anchor-script">{anchor.script}</div>
                    <div className="studio-anchor-shots">
                      {anchor.shots.map((s, i) => (
                        <span key={i} className="tag tag-neutral">{s.time} {s.scene}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="studio-video-tip">
                  <Film size={13} aria-hidden /> 横屏 → 竖屏:
                  {(() => {
                    const v = adaptVideoRule("landscape", 300, "douyin");
                    return `${v.resolution} · 拆 ${v.splitCount} 段 · ${v.subtitlePosition}`;
                  })()}
                </div>
              </div>
            )}

            {tab === "crm" && (
              <div className="assistant-section">
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">粘贴评论列表(每行一条)识别意图 / 情绪 / 高意向。</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runCrm()}>
                    {busy ? <Loader2 size={13} className="spinner" aria-hidden /> : <MessageSquareHeart size={13} aria-hidden />}
                    分析评论
                  </button>
                </div>
                <textarea
                  className="studio-comments-input"
                  placeholder={"这个工具多少钱?\n怎么买?求链接\n太棒了,学到了!\n垃圾,根本没用"}
                  value={commentsText}
                  onChange={(e) => setCommentsText(e.target.value)}
                  rows={4}
                />
                {negativeDigest && (
                  <div className="studio-digest">
                    <AlertTriangle size={13} aria-hidden /> 负面预警: {negativeDigest.total} 条
                    {negativeDigest.alerts.map((a, i) => (
                      <span key={i} className="tag tag-err">{a.action}</span>
                    ))}
                  </div>
                )}
                {crmResults.length > 0 && (
                  <div className="studio-crm-results">
                    {crmResults.map((r, i) => (
                      <div key={i} className={`studio-crm-item ${r.needsAttention ? "warn" : ""} ${r.highIntent ? "high" : ""}`}>
                        <div className="studio-crm-text">「{r.text}」</div>
                        <div className="studio-crm-meta">
                          <span className="tag tag-neutral">意图 {r.intent}</span>
                          <span className="tag tag-neutral">情绪 {r.sentiment}</span>
                          {r.highIntent && <span className="tag tag-ok">高意向</span>}
                          {r.needsAttention && <span className="tag tag-err">需关注</span>}
                          <span className="tag tag-neutral">动作 {r.suggestedAction}</span>
                        </div>
                        {r.autoReply && <div className="studio-crm-reply">自动回复: {r.autoReply}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "compliance" && (
              <div className="assistant-section">
                <div className="assistant-toolbar">
                  <span className="assistant-toolbar-hint">发布前扫描极限词 / 敏感词 / 风险链接 / 版权 / 图片缺 alt。</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={runCompliance}>
                    <ShieldCheck size={13} aria-hidden /> 开始审查
                  </button>
                </div>
                {compliance ? (
                  <div className="studio-compliance">
                    <div className={`studio-compliance-verdict ${compliance.verdict}`}>
                      {compliance.verdict === "ok" ? (
                        <CheckCircle2 size={18} aria-hidden />
                      ) : (
                        <AlertTriangle size={18} aria-hidden />
                      )}
                      结论: {compliance.verdict === "ok" ? "可发布" : compliance.verdict === "warn" ? "有风险" : "建议阻断"}
                      {compliance.blocked && " (存在 high 级问题)"}
                    </div>
                    {compliance.issues.length === 0 ? (
                      <div className="assistant-empty-sm">未发现问题,内容干净。</div>
                    ) : (
                      <div className="studio-compliance-list">
                        {compliance.issues.map((issue, i) => (
                          <div key={i} className={`studio-compliance-issue ${issue.severity}`}>
                            <span className="studio-compliance-sev">{issue.severity}</span>
                            <span className="studio-compliance-kind">{issue.kind}</span>
                            <span className="studio-compliance-match">{issue.match}</span>
                            <span className="studio-compliance-msg">{issue.message}</span>
                            {issue.suggestion && (
                              <span className="studio-compliance-suggestion">→ {issue.suggestion}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="assistant-empty">
                    <ShieldCheck size={28} aria-hidden />
                    <p>点击「开始审查」对当前内容做合规扫描。</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
