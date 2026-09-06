/**
 * FindReplaceBar —— 编辑器查找/替换面板(v7 创作工作流)。
 *
 * - Ctrl/Cmd+F 在编辑区唤起:实时匹配计数、当前匹配通过 textarea 选区高亮;
 * - 支持「下一个 / 上一个 / 替换 / 全部替换」;
 * - 可选「区分大小写」「整词匹配」「正则匹配」;
 * - v7 Phase 3:替换后 toast 摘要、全部匹配以 CSS 变量高亮(非当前匹配淡色、当前匹配选区)。
 * - 全部基于 textarea 选区实现,纯交互组件,不引入编辑器依赖。
 *
 * 设计要点:
 * - 通过 editorRef 读写 textarea value/选区,不直接改受控 value(由 App 统一 setMarkdown);
 * - 替换操作先快照到 editorHistory(可与 MarkdownToolbar 共享撤销栈),再 onApply;
 * - 匹配计数与选项均纯函数(find-replace.ts)可单测。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, Replace, ReplaceAll, X, CaseSensitive, AlignJustify, Regex } from "lucide-react";
import { findMatches, replaceRange, replaceAll, isValidRegex, lineOfIndex } from "./find-replace.js";
import { editorHistory } from "./editor-history.js";
import { toast } from "./toast.js";

interface Props {
  /** 当前编辑器文本。 */
  text: string;
  /** 真实编辑 textarea 引用(读写选区)。 */
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 应用新文本(受控更新)。 */
  onApply: (value: string) => void;
  /** 关闭面板。 */
  onClose: () => void;
}

export function FindReplaceBar({ text, editorRef, onApply, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [active, setActive] = useState(0); // 当前匹配索引
  const inputRef = useRef<HTMLInputElement | null>(null);

  const regexInvalid = useRegex && query.length > 0 && !isValidRegex(query);

  // 全部匹配区间(普通 / 正则)。
  const matches = useMemo(
    () => findMatches(text, query, { caseSensitive, wholeWord, useRegex }),
    [text, query, caseSensitive, wholeWord, useRegex],
  );
  const total = matches.length;

  // 当前匹配所在行(高亮当前行)。
  const activeMatchLine = useMemo(() => {
    if (matches.length === 0) return -1;
    const m = matches[Math.min(active, matches.length - 1)]!;
    return lineOfIndex(text, m.start);
  }, [matches, active, text]);

  /** 跳转到第 idx 个匹配(循环)。 */
  const jumpTo = useCallback(
    (idx: number) => {
      if (matches.length === 0) return;
      const i = ((idx % matches.length) + matches.length) % matches.length;
      const m = matches[i]!;
      setActive(i);
      const area = editorRef.current;
      if (area) {
        area.focus();
        area.setSelectionRange(m.start, m.end);
      }
    },
    [matches, editorRef],
  );

  // 高亮当前匹配行(v7 Phase 2):设置 CSS 变量供编辑器背景线性渐变定位。
  useEffect(() => {
    const area = editorRef.current;
    if (!area) return;
    if (activeMatchLine < 0) {
      area.style.removeProperty("--find-line");
      return;
    }
    area.style.setProperty("--find-line", String(activeMatchLine));
  }, [activeMatchLine, editorRef]);

  // v7 Phase 3:匹配分布统计 —— 计算匹配覆盖的行数(供面板展示“N 处 / M 行”)。
  const matchedLines = useMemo(() => {
    if (matches.length === 0) return 0;
    const lines = new Set(matches.map((m) => lineOfIndex(text, m.start)));
    return lines.size;
  }, [matches, text]);

  // 查询/选项变化时重置高亮到第一个匹配。
  useEffect(() => {
    setActive(0);
    if (total > 0) {
      const m = matches[0]!;
      const area = editorRef.current;
      if (area) area.setSelectionRange(m.start, m.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, useRegex, total]);

  // 打开时聚焦输入框。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 编辑器文本被外部替换后,若当前匹配越界则回退到 0。
  useEffect(() => {
    if (active >= total) setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  /** 替换当前匹配。 */
  const doReplace = useCallback(() => {
    if (matches.length === 0) return;
    const m = matches[Math.min(active, matches.length - 1)]!;
    const area = editorRef.current;
    if (area) {
      editorHistory.push({ text: area.value, start: area.selectionStart, end: area.selectionEnd });
    }
    const next = replaceRange(text, m, replacement);
    onApply(next.text);
    toast(`已替换 1 处`);
    // 替换后跳转到同一位置的下一个匹配(若存在)。
    requestAnimationFrame(() => {
      const nxt = findMatches(next.text, query, { caseSensitive, wholeWord, useRegex });
      if (nxt.length > 0) {
        const after = nxt.find((x) => x.start >= m.end);
        const ni = after ? nxt.indexOf(after) : 0;
        setActive(ni);
        const area2 = editorRef.current;
        if (area2) area2.setSelectionRange(nxt[ni]!.start, nxt[ni]!.end);
      } else {
        setActive(0);
      }
    });
  }, [matches, active, replacement, text, query, caseSensitive, wholeWord, useRegex, onApply, editorRef]);

  /** 全部替换。 */
  const doReplaceAll = useCallback(() => {
    if (matches.length === 0) return;
    const area = editorRef.current;
    if (area) {
      editorHistory.push({ text: area.value, start: area.selectionStart, end: area.selectionEnd });
    }
    const next = replaceAll(text, query, replacement, { caseSensitive, wholeWord, useRegex });
    onApply(next.text);
    toast(`已全部替换 ${next.count} 处`);
    setActive(0);
  }, [matches.length, text, query, replacement, caseSensitive, wholeWord, useRegex, onApply, editorRef]);

  const noResult = query.length > 0 && total === 0;

  return (
    <div className="find-replace-bar" role="search" aria-label="查找与替换">
      <div className="find-row">
        <input
          ref={inputRef}
          type="text"
          className="find-input"
          placeholder="查找…"
          value={query}
          aria-label="查找内容"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              jumpTo(e.shiftKey ? active - 1 : active + 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <span className={`find-count ${regexInvalid ? "find-count-invalid" : noResult ? "find-count-none" : ""}`} aria-live="polite">
          {regexInvalid ? "正则错误" : query ? (noResult ? "无结果" : `${active + 1}/${total} · ${matchedLines} 行`) : ""}
        </span>
        <button type="button" className={`find-opt ${useRegex ? "active" : ""}`} title="正则匹配" aria-label="正则匹配" aria-pressed={useRegex} onClick={() => setUseRegex((v) => !v)}>
          <Regex size={13} aria-hidden />
        </button>
        <button type="button" className={`find-opt ${caseSensitive ? "active" : ""}`} title="区分大小写" aria-label="区分大小写" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>
          <CaseSensitive size={13} aria-hidden />
        </button>
        <button type="button" className={`find-opt ${wholeWord ? "active" : ""}`} title="整词匹配" aria-label="整词匹配" aria-pressed={wholeWord} onClick={() => setWholeWord((v) => !v)}>
          <AlignJustify size={13} aria-hidden />
        </button>
        <button type="button" className="find-nav" title="上一个 (Shift+Enter)" aria-label="上一个匹配" onClick={() => jumpTo(active - 1)}>
          <ArrowUp size={13} aria-hidden />
        </button>
        <button type="button" className="find-nav" title="下一个 (Enter)" aria-label="下一个匹配" onClick={() => jumpTo(active + 1)}>
          <ArrowDown size={13} aria-hidden />
        </button>
        <button type="button" className="find-close" aria-label="关闭查找" onClick={onClose}>
          <X size={13} aria-hidden />
        </button>
      </div>
      <div className="find-row find-replace-row">
        <input
          type="text"
          className="find-input"
          placeholder="替换为…"
          value={replacement}
          aria-label="替换为"
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doReplace();
            }
          }}
        />
        <button type="button" className="find-action" disabled={total === 0} onClick={doReplace}>
          <Replace size={13} aria-hidden />
          替换
        </button>
        <button type="button" className="find-action" disabled={total === 0} onClick={doReplaceAll}>
          <ReplaceAll size={13} aria-hidden />
          全部替换
        </button>
      </div>
    </div>
  );
}
