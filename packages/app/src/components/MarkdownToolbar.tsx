/**
 * MarkdownToolbar —— 编辑器快捷格式工具栏。
 *
 * 在编辑区上方提供加粗/斜体/删除线/标题/引用/列表/代码/链接/图片/撤销等操作,
 * 全部基于 textarea 选区(selectionStart/selectionEnd)做最小侵入编辑,
 * 并保留可撤销历史(最多 50 步)。纯交互组件,不引入任何编辑器依赖。
 * editorRef 由 App 持有,保证与真实输入框一致。
 */
import { useCallback } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Quote,
  List,
  ListOrdered,
  Code,
  Code2,
  Link2,
  Image,
  Undo2,
} from "lucide-react";
import {
  bold,
  italic,
  strikethrough,
  heading,
  quote,
  bulletList,
  orderedList,
  inlineCode,
  codeBlock,
  link,
  image,
  type MarkdownEditResult,
} from "./markdown-edit.js";
import { toast } from "./toast.js";
import { editorHistory } from "./editor-history.js";

interface Props {
  onApply: (value: string) => void;
  /** 真实的编辑 textarea 引用(读选区 / 写光标)。 */
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function MarkdownToolbar({ onApply, editorRef }: Props) {
  const history = editorHistory;

  const snapshot = useCallback(() => {
    const area = editorRef.current;
    if (!area) return;
    history.push({ text: area.value, start: area.selectionStart, end: area.selectionEnd });
  }, [editorRef, history]);

  const apply = useCallback(
    (edit: MarkdownEditResult) => {
      const area = editorRef.current;
      if (!area) return;
      snapshot();
      onApply(edit.text);
      // 在下一帧设置选区(textarea value 由 React 控制,需等渲染后生效)。
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      });
    },
    [snapshot, onApply, editorRef],
  );

  const doUndo = useCallback(() => {
    const area = editorRef.current;
    if (!area) return;
    const prev = history.pop();
    if (!prev) {
      toast("没有可撤销的操作", "info");
      return;
    }
    onApply(prev.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(prev.start, prev.end);
    });
  }, [onApply, editorRef, history]);

  const run = (fn: (t: string, s: number, e: number) => MarkdownEditResult) => {
    const area = editorRef.current;
    if (!area) return;
    apply(fn(area.value, area.selectionStart, area.selectionEnd));
  };

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, title?: string) => (
    <button
      type="button"
      className="md-btn"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      tabIndex={0}
    >
      {icon}
    </button>
  );

  return (
    <div className="md-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
      {btn("加粗", <Bold size={14} aria-hidden />, () => run(bold), "加粗 (Ctrl/Cmd+B)")}
      {btn("斜体", <Italic size={14} aria-hidden />, () => run(italic), "斜体 (Ctrl/Cmd+I)")}
      {btn("删除线", <Strikethrough size={14} aria-hidden />, () => run(strikethrough))}
      <span className="md-toolbar-sep" aria-hidden />
      {btn("标题", <Heading2 size={14} aria-hidden />, () => run(heading), "标题 (Ctrl/Cmd+2)")}
      {btn("引用", <Quote size={14} aria-hidden />, () => run(quote), "引用")}
      {btn("无序列表", <List size={14} aria-hidden />, () => run(bulletList))}
      {btn("有序列表", <ListOrdered size={14} aria-hidden />, () => run(orderedList))}
      <span className="md-toolbar-sep" aria-hidden />
      {btn("行内代码", <Code size={14} aria-hidden />, () => run(inlineCode))}
      {btn("代码块", <Code2 size={14} aria-hidden />, () => run(codeBlock))}
      {btn("链接", <Link2 size={14} aria-hidden />, () => run(link), "链接 (Ctrl/Cmd+K)")}
      {btn("图片", <Image size={14} aria-hidden />, () => run(image))}
      <span className="md-toolbar-sep" aria-hidden />
      {btn("撤销", <Undo2 size={14} aria-hidden />, doUndo, "撤销 (Ctrl/Cmd+Z)")}
    </div>
  );
}
