import type { PlatformResult, ValidationIssue } from "@mpp/core";
import { compareArtifact, type ArtifactComparison } from "@mpp/core";
import { memo, useState, useCallback, useMemo } from "react";
import DOMPurify from "dompurify";
import { XCircle, AlertTriangle, Info, CheckCircle2, ListChecks, Copy, Check, Loader2, Gauge, GitCompare, ChevronDown, ChevronUp } from "lucide-react";
import { platformColor, platformIcon } from "./platform-meta.js";
import type { PlatformBridge } from "../bridge/types.js";

interface Props {
  result: PlatformResult;
  bridge?: PlatformBridge | null;
  /** 源 Markdown(用于「对比」tab:产物 vs 源文)。 */
  sourceMarkdown?: string;
}

type Tab = "preview" | "source" | "issues" | "compare";
type HandoffState = "idle" | "loading" | "ok" | "fail";

// 单平台预览:渲染序列化产物 + 校验提示 + 发布指引。
// memo:仅当该平台的 result 引用变化才重渲染(避免父级全量订阅导致四卡齐刷)。
export const PlatformPreview = memo(function PlatformPreview({ result, bridge, sourceMarkdown }: Props) {
  const [tab, setTab] = useState<Tab>("preview");
  const [collapsed, setCollapsed] = useState(false);
  const [handoffState, setHandoffState] = useState<HandoffState>("idle");
  const [handoffMsg, setHandoffMsg] = useState("");
  const payload = result.artifact?.payload;
  const color = platformColor(result.platformId);

  // 平台产物对比:源文(markdown)vs 产物(去标签纯文本)。(Hook 必须无条件调用)
  const comparison = useMemo<ArtifactComparison | null>(() => {
    const p = result.artifact?.payload;
    if (!sourceMarkdown || !p) return null;
    try {
      return compareArtifact(result.platformId, sourceMarkdown, p.mime, p.content);
    } catch {
      return null;
    }
  }, [sourceMarkdown, result]);
  // 辅助注入/复制:平台产物 → 剪贴板(best-effort 注入仅扩展环境可用)。
  const handleHandoff = useCallback(async () => {
    if (!payload || !bridge) return;
    setHandoffState("loading");
    try {
      const res = await bridge.assistedHandoff({
        platformId: result.platformId,
        clipboard: {
          html: payload.mime === "text/html" ? payload.content : undefined,
          text: payload.content,
        },
        tryInject: true,
      });
      if (res.ok) {
        setHandoffState("ok");
        setHandoffMsg(res.method === "injected" ? "已注入编辑器" : "已复制到剪贴板");
      } else {
        setHandoffState("fail");
        setHandoffMsg(res.message || "操作失败");
      }
    } catch (err) {
      setHandoffState("fail");
      setHandoffMsg(err instanceof Error ? err.message : "操作失败");
    }
    // 2.5s 后自动清除状态。
    setTimeout(() => { setHandoffState("idle"); setHandoffMsg(""); }, 2500);
  }, [payload, bridge, result.platformId]);

  if (!payload) {
    return (
      <div className="platform-preview" style={{ height: "auto" }}>
        <div className="preview-empty">
          <XCircle size={22} aria-hidden />
          {result.error ?? "无产物"}
        </div>
      </div>
    );
  }

  const issues = result.report?.issues ?? [];
  const errCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;

  const tabs: { key: Tab; label: string }[] = [
    { key: "preview", label: "预览" },
    { key: "source", label: "源码" },
    { key: "issues", label: `校验 (${issues.length})` },
    { key: "compare", label: "对比" },
  ];
  const tabBase = `pp-${result.platformId}`;

  // tablist 左右箭头切换(roving tabindex,符合 WAI-ARIA tabs 模式)。
  const onTabKey = (e: React.KeyboardEvent, key: Tab) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.key === key);
    const next = e.key === "ArrowRight" ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
    const nextKey = tabs[next].key;
    setTab(nextKey);
    document.getElementById(`${tabBase}-tab-${nextKey}`)?.focus();
  };

  return (
    <div className="platform-preview" style={{ ["--platform-color" as string]: color }}>
      <div className="preview-head">
        <span className="preview-name">
          <span className="preview-name-icon" aria-hidden>
            {(() => {
              const Icon = platformIcon(result.platformId);
              return <Icon size={15} />;
            })()}
          </span>
          <span className="preview-name-dot" aria-hidden />
          {result.platformName}
        </span>
        <span className="preview-meta">
          {bridge && (
            <button
              type="button"
              className="btn-icon btn-handoff"
              disabled={handoffState === "loading"}
              onClick={handleHandoff}
              aria-label={`复制${result.platformName}内容到剪贴板`}
              title={handoffMsg || `复制/注入到${result.platformName}编辑器`}
            >
              {handoffState === "loading" ? (
                <Loader2 size={13} className="spinner" aria-hidden />
              ) : handoffState === "ok" ? (
                <Check size={13} aria-hidden />
              ) : handoffState === "fail" ? (
                <XCircle size={13} aria-hidden />
              ) : (
                <Copy size={13} aria-hidden />
              )}
              <span className="handoff-label">
                {handoffState === "loading" ? "复制中..." : handoffState === "ok" ? "已复制" : handoffState === "fail" ? "失败" : "复制"}
              </span>
            </button>
          )}
          {payload.mime === "text/html" ? "HTML" : payload.mime === "text/markdown" ? "Markdown" : "纯文本"} · {countChars(payload)} 字
          {errCount > 0 && (
            <span className="tag tag-err">
              <XCircle size={11} aria-hidden />
              {errCount} 错误
            </span>
          )}
          {warnCount > 0 && (
            <span className="tag tag-warn">
              <AlertTriangle size={11} aria-hidden />
              {warnCount} 提醒
            </span>
          )}
          {/* 排版质量分:四维评分 + 建议,从"能发布"到"发得好"。 */}
          {result.quality && (
            <span
              className="tag tag-score"
              title={`排版质量\n段落节奏 ${result.quality.paragraphRhythm}/100\n图文平衡 ${result.quality.imageBalance}/100\n标题结构 ${result.quality.headingStructure}/100\n可读性 ${result.quality.readability}/100`}
            >
              <Gauge size={11} aria-hidden />
              排版 {result.quality.overall}/100
            </span>
          )}
          {/* 图片重托管失败:发布前提示用户哪些图未上传成功(如公众号外链图会被平台屏蔽)。 */}
          {(result.rehostFailures ?? []).length > 0 && (
            <span className="tag tag-warn" title={result.rehostFailures!.map((f) => `${f.sourceUrl} → ${f.reason}`).join("\n")}>
              <AlertTriangle size={11} aria-hidden />
              {result.rehostFailures!.length} 张图重托管失败
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn-icon preview-collapse"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "展开预览" : "收起预览"}
          title={collapsed ? "展开预览" : "收起预览"}
        >
          {collapsed ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      </div>

      {!collapsed && (
        <>
      <div className="preview-tabs" role="tablist" aria-label={`${result.platformName}预览视图`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            id={`${tabBase}-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${tabBase}-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={tab === t.key ? "preview-tab active" : "preview-tab"}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onTabKey(e, t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="preview-body"
        role="tabpanel"
        id={`${tabBase}-panel-${tab}`}
        aria-labelledby={`${tabBase}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "preview" && <PreviewRender payload={payload} platformId={result.platformId} />}
        {tab === "source" && <pre className="preview-source">{payload.content}</pre>}
        {tab === "issues" && (
          <IssueList
            issues={issues}
            instructions={result.artifact?.instructions ?? []}
            suggestions={result.quality?.suggestions ?? []}
          />
        )}
        {tab === "compare" && <CompareTab comparison={comparison} />}
      </div>
        </>
      )}
    </div>
  );
});

function PreviewRender({
  payload,
  platformId,
}: {
  payload: NonNullable<PlatformResult["artifact"]>["payload"];
  platformId: string;
}) {
  if (payload.mime === "text/plain" || payload.mime === "text/markdown") {
    // 小红书/掘金:模拟移动端/文本展示。
    return (
      <div className="phone-frame">
        <div className="xhs-title">{payload.title}</div>
        <div className="xhs-body">{payload.content}</div>
      </div>
    );
  }
  // HTML:公众号用窄手机框,知乎/B站用全宽阅读区(均为浅色,所见即所得)。
  const isWechat = platformId === "wechat";
  // 纵深防御:产物虽已经 core sanitize,渲染前再过 DOMPurify(允许内联 style)。
  const safeHtml = DOMPurify.sanitize(payload.content, { ADD_ATTR: ["style"] });
  return (
    <div className="phone-frame" style={isWechat ? undefined : { maxWidth: "none" }}>
      <div className="html-title">{payload.title}</div>
      <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </div>
  );
}

function IssueIcon({ severity }: { severity: ValidationIssue["severity"] }) {
  if (severity === "error") return <XCircle size={15} aria-hidden />;
  if (severity === "warning") return <AlertTriangle size={15} aria-hidden />;
  return <Info size={15} aria-hidden />;
}

function IssueList({
  issues,
  instructions,
  suggestions,
}: {
  issues: readonly ValidationIssue[];
  instructions: readonly string[];
  suggestions: readonly string[];
}) {
  return (
    <div className="issue-list">
      {issues.length === 0 && (
        <div className="issue-ok">
          <CheckCircle2 size={16} aria-hidden />
          校验通过，无问题
        </div>
      )}
      {issues.map((i, idx) => (
        <div key={`${i.severity}-${i.message}-${idx}`} className={`issue issue-${i.severity}`}>
          <IssueIcon severity={i.severity} />
          <span>{i.message}</span>
        </div>
      ))}
      {suggestions.length > 0 && (
        <div className="issue-suggestions">
          <div className="instructions-title">
            <Gauge size={13} aria-hidden />
            排版建议
          </div>
          {suggestions.map((s, idx) => (
            <div key={`${idx}-${s}`} className="issue issue-info">
              <Info size={15} aria-hidden />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
      {instructions.length > 0 && (
        <div className="instructions">
          <div className="instructions-title">
            <ListChecks size={13} aria-hidden />
            发布说明
          </div>
          {instructions.map((t, idx) => (
            <div key={`${idx}-${t}`} className="instruction-item">
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function countChars(payload: NonNullable<PlatformResult["artifact"]>["payload"]): number {
  const text = payload.mime === "text/html" ? payload.content.replace(/<[^>]+>/g, "") : payload.content;
  return [...text].length;
}

/** 「对比」tab:源文 vs 平台产物的降级差异。 */
function CompareTab({ comparison }: { comparison: ArtifactComparison | null }) {
  if (!comparison) {
    return (
      <div className="issue-list">
        <div className="issue-ok">
          <GitCompare size={15} aria-hidden />
          需要源文才能对比（当前无 Markdown 内容）。
        </div>
      </div>
    );
  }
  return (
    <div className="compare-view">
      <div className="compare-notes">
        {comparison.notes.map((n, idx) => (
          <div key={idx} className="compare-note">
            <GitCompare size={13} aria-hidden />
            {n}
          </div>
        ))}
        <div className="compare-stats">
          <span className="compare-stat-added">+{comparison.added} 行</span>
          <span className="compare-stat-removed">-{comparison.removed} 行</span>
        </div>
      </div>
      {comparison.identical ? (
        <div className="version-diff-identical">产物与源文一致，无降级。</div>
      ) : (
        <pre className="compare-body">
          {comparison.ops.map((op, idx) => {
            if (op.type === "equal") return <span key={idx} className="diff-equal">{op.line}</span>;
            if (op.type === "insert") return <span key={idx} className="diff-insert">{op.line}</span>;
            return <span key={idx} className="diff-delete">{op.line}</span>;
          })}
        </pre>
      )}
    </div>
  );
}
