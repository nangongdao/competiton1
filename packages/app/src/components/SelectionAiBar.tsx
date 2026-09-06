/**
 * v3 · AI 选区操作栏 —— 编辑器选中文本后浮出的 AI 智能操作。
 *
 * 选中文本后显示一组操作按钮:
 * - 风格改写 / 扩写 / 续写 / 摘要 / 中译英 / 英译中 / 润色;
 * - 点击后调用 core `runSelectionAi`(经 AI 连接中心构造回退/重试适配器);
 * - 结果直接替换选区(最小侵入),保留光标;
 * - LLM 不可用/失败时 toast 提示并保留原文。
 *
 * 懒加载拆包;全 Lucide 图标;无表情符号。
 */
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Wand2,
  Expand,
  ArrowDownToDot,
  AlignLeft,
  Languages,
  PenLine,
  X,
  Loader2,
  Check,
  Layers,
} from "lucide-react";
import {
  runSelectionAi,
  runSelectionAiForPlatforms,
  SELECTION_AI_OP_LABELS,
  type SelectionAiOp,
} from "@mpp/core";
import { useStore } from "../state/store.js";
import { buildLlmAdapter } from "../bridge/llm-adapter.js";
import { toast } from "./toast.js";
import { editorHistory } from "./editor-history.js";

interface Props {
  /** 编辑器 textarea 引用(读选区 / 写结果)。 */
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 应用新文本到正文(由 store 的 setMarkdown 处理)。 */
  onApply: (text: string) => void;
}

const OPS: readonly SelectionAiOp[] = [
  "rewrite",
  "polish",
  "expand",
  "continue",
  "summarize",
  "translate-zh-en",
  "translate-en-zh",
];

const OP_ICONS: Record<SelectionAiOp, typeof Wand2> = {
  rewrite: Wand2,
  polish: PenLine,
  expand: Expand,
  continue: ArrowDownToDot,
  summarize: AlignLeft,
  "translate-zh-en": Languages,
  "translate-en-zh": Languages,
};

/** 读取选区(仅当有非空选中文本时显示)。 */
function readSelection(area: HTMLTextAreaElement | null): { start: number; end: number; text: string } | null {
  if (!area) return null;
  const { selectionStart, selectionEnd, value } = area;
  if (selectionEnd <= selectionStart) return null;
  const text = value.slice(selectionStart, selectionEnd).trim();
  if (!text) return null;
  return { start: selectionStart, end: selectionEnd, text };
}

export function SelectionAiBar({ editorRef, onApply }: Props) {
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const [running, setRunning] = useState<SelectionAiOp | null>(null);
  const llm = useStore((s) => s.llm);
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const selectedPlatforms = useStore((s) => s.selectedPlatforms);
  const markdown = useStore((s) => s.markdown);
  const latestSel = useRef(sel);
  latestSel.current = sel;

  // 监听编辑器选区变化:有非空选中文本时展示操作栏。
  useEffect(() => {
    const area = editorRef.current;
    if (!area) return;
    const update = () => {
      const next = readSelection(area);
      setSel(next);
      if (!next) {
        setRunning(null);
      }
    };
    update();
    area.addEventListener("mouseup", update);
    area.addEventListener("keyup", update);
    area.addEventListener("selectionchange", update);
    return () => {
      area.removeEventListener("mouseup", update);
      area.removeEventListener("keyup", update);
      area.removeEventListener("selectionchange", update);
    };
  }, [editorRef, markdown]);

  const apply = useCallback(
    (text: string) => {
      const area = editorRef.current;
      const current = latestSel.current;
      if (!area || !current) return;
      const before = area.value;
      // 并入共享撤销栈(与 MarkdownToolbar 同一撤销历史)。
      editorHistory.push({ text: before, start: current.start, end: current.end });
      const next = before.slice(0, current.start) + text + before.slice(current.end);
      onApply(next);
      // 光标定位到替换文本末尾。
      requestAnimationFrame(() => {
        area.focus();
        const pos = current.start + text.length;
        area.setSelectionRange(pos, pos);
      });
      // 清空选区状态(已应用)。
      setSel(null);
    },
    [editorRef, onApply],
  );

  const runOp = useCallback(
    async (op: SelectionAiOp, applyToAll = false) => {
      const current = latestSel.current;
      if (!current || running) return;
      setRunning(op);
      try {
        const llmAdapter = buildLlmAdapter({ llm, llmConfigs, activeLlmConfigId });
        if (applyToAll && selectedPlatforms.length > 0) {
          // EDIT-AI-04:应用到全部已选平台(每平台独立改写 + 差异提示)。
          const multi = await runSelectionAiForPlatforms(
            { selected: current.text, op, platforms: selectedPlatforms },
            llmAdapter,
          );
          const used = multi.items.filter((i) => i.result.usedLlm);
          if (multi.allUsedLlm) {
            const area = editorRef.current;
            const sel = latestSel.current;
            if (area && sel) {
              // 应用第一个成功平台的结果到选区(保留编辑器可编辑)。
              apply(used[0]?.result.text ?? sel.text);
            }
            toast(
              `${SELECTION_AI_OP_LABELS[op]}·全部平台完成(${multi.items.length} 平台)`, "success",
            );
            if (multi.hasDifference) {
              toast(multi.differenceHint, "info");
            }
          } else {
            const failed = multi.items.filter((i) => !i.result.usedLlm);
            toast(
              `部分平台失败(${failed.length}/${multi.items.length}),已保留原文`, "error",
            );
          }
        } else {
          const res = await runSelectionAi(
            { selected: current.text, op, platformId: selectedPlatforms[0] },
            llmAdapter,
          );
          if (res.usedLlm) {
            apply(res.text);
            toast(`${SELECTION_AI_OP_LABELS[op]}完成`, "success");
          } else if (res.error) {
            toast(res.error === "未配置 LLM" ? "未配置 LLM,请在「AI 连接中心」填入 API 与 BaseURL" : res.error, "error");
          }
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setRunning(null);
      }
    },
    [llm, llmConfigs, activeLlmConfigId, selectedPlatforms, running, apply, editorRef],
  );

  if (!sel) return null;

  return (
    <div className="selection-ai-bar" role="toolbar" aria-label="AI 选区操作">
      <span className="selection-ai-hint" title="选中的文本">
        <Check size={12} aria-hidden />
        {sel.text.length > 12 ? `${sel.text.slice(0, 12)}…` : sel.text}
      </span>
      <span className="selection-ai-sep" aria-hidden />
      {OPS.map((op) => {
        const Icon = OP_ICONS[op];
        const isRunning = running === op;
        return (
          <button
            key={op}
            type="button"
            className="selection-ai-btn"
            title={`${SELECTION_AI_OP_LABELS[op]}选区`}
            aria-label={`${SELECTION_AI_OP_LABELS[op]}选区`}
            onClick={() => void runOp(op)}
            disabled={running !== null}
          >
            {isRunning ? <Loader2 size={13} className="spinner" aria-hidden /> : <Icon size={13} aria-hidden />}
            <span>{SELECTION_AI_OP_LABELS[op]}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="selection-ai-btn selection-ai-all"
        title="应用到全部已选平台(每平台独立风格改写 + 差异提示)"
        aria-label="AI 操作应用到全部平台"
        onClick={() => void runOp(running ?? "rewrite", true)}
        disabled={running !== null || selectedPlatforms.length === 0}
      >
        {running ? <Loader2 size={13} className="spinner" aria-hidden /> : <Layers size={13} aria-hidden />}
        <span>全部平台</span>
      </button>
      <button
        type="button"
        className="selection-ai-close"
        aria-label="关闭 AI 选区操作"
        title="关闭"
        onClick={() => setSel(null)}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
