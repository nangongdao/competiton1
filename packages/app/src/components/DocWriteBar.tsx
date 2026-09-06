/**
 * DocWriteBar —— 整篇 AI 写作增强(v7 Phase 4 AI-WRITE-01)。
 *
 * 在编辑器底部提供四个整篇级 AI 动作:
 * - 整篇润色 / 扩写 / 续写 / 生成摘要;
 * - 走 core `runDocWrite`(LLM 优先 + 规则兜底,结构保守,可撤销);
 * - 结果通过 onApply 写回(并 snap 到编辑器撤销栈,可 Ctrl/Cmd+Z 回退)。
 *
 * 纯展示 + 交互组件:动作逻辑在 core,store 提供 runDocWrite action。
 * 全 Lucide 图标,无表情符号。
 */
import { useMemo } from "react";
import { Wand2, FilePlus2, ArrowDownToLine, AlignLeft, X } from "lucide-react";
import { DOC_WRITE_OP_LABELS, type DocWriteOp } from "@mpp/core";

interface Props {
  /** LLM 是否可用(不可用时展示"规则兜底"提示)。 */
  llmReady: boolean;
  /** 是否正在执行。 */
  busy: boolean;
  /** 最近一次执行结果(供展示)。 */
  lastResult?: { op: DocWriteOp; usedLlm: boolean; changed: boolean } | null;
  /** 执行某个动作。 */
  onRun: (op: DocWriteOp) => void;
  /** 关闭面板。 */
  onClose: () => void;
}

const OPS: { op: DocWriteOp; icon: typeof Wand2; hint: string }[] = [
  { op: "polish-doc", icon: Wand2, hint: "整篇润色:修正错别字/语病,保持结构" },
  { op: "expand-doc", icon: FilePlus2, hint: "扩写:补充细节与例证" },
  { op: "continue-doc", icon: ArrowDownToLine, hint: "续写:在文末自然延续一段" },
  { op: "summarize-doc", icon: AlignLeft, hint: "生成摘要:适合做副标题/推荐语" },
];

export function DocWriteBar({ llmReady, busy, lastResult, onRun, onClose }: Props) {
  const status = useMemo(() => {
    if (!lastResult) return null;
    if (!lastResult.changed) return "内容未变化(可能为空或规则兜底未改动)";
    const how = lastResult.usedLlm ? "AI 生成" : "规则兜底";
    return `${DOC_WRITE_OP_LABELS[lastResult.op]} 完成(${how}),可 Ctrl/Cmd+Z 撤销`;
  }, [lastResult]);

  return (
    <div className="doc-write-bar" role="toolbar" aria-label="整篇 AI 写作">
      <span className="doc-write-label">
        <Wand2 size={13} aria-hidden />
        整篇 AI 写作
        {!llmReady && <span className="doc-write-fallback">(未配置 LLM,使用规则兜底)</span>}
      </span>
      <div className="doc-write-actions">
        {OPS.map(({ op, icon: Icon, hint }) => (
          <button
            key={op}
            type="button"
            className="doc-write-btn"
            disabled={busy}
            onClick={() => onRun(op)}
            title={hint}
            aria-label={DOC_WRITE_OP_LABELS[op]}
          >
            <Icon size={13} aria-hidden />
            {DOC_WRITE_OP_LABELS[op]}
          </button>
        ))}
      </div>
      {status && <span className="doc-write-status" aria-live="polite">{status}</span>}
      <button type="button" className="doc-write-close" aria-label="关闭整篇 AI 写作" onClick={onClose}>
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
