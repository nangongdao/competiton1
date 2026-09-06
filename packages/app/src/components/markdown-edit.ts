/**
 * Markdown 编辑器快捷操作 —— 纯函数工具。
 *
 * 围绕 textarea selectionStart/selectionEnd 实现:
 * - 包裹语法(加粗/斜体/行内代码):在选区前后插入定界符,光标落在合适位置;
 * - 行首语法(标题/引用/无序列表/有序列表/代码块):对选区覆盖的每一行加前缀;
 * - 链接/图片:替换占位符并预选文本;
 * - 撤销:返回上一次编辑快照(由调用方管理历史栈)。
 *
 * 所有函数都返回 { text, selectionStart, selectionEnd },由调用方应用,保持纯函数可测。
 */
export type MarkdownEditResult = {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

const EMPTY_SELECTION = (text: string, pos: number): MarkdownEditResult => ({
  text,
  selectionStart: pos,
  selectionEnd: pos,
});

/** 包裹选区:在选区前后插入定界符。 */
function wrap(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
  placeholder: string,
): MarkdownEditResult {
  const sel = text.slice(start, end);
  const content = sel || placeholder;
  const next = text.slice(0, start) + open + content + close + text.slice(end);
  // 选区为空时,光标停在占位符后;有选区时选中包裹后的完整内容。
  const selStart = sel ? start + open.length : start + open.length + content.length;
  const selEnd = sel ? start + open.length + content.length + close.length : selStart;
  return { text: next, selectionStart: selStart, selectionEnd: selEnd };
}

/** 行首前缀:对选区覆盖的每一行加前缀(已有前缀则去除 —— toggle 语义)。 */
function linePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
  placeholder = "",
): MarkdownEditResult {
  // 将选区扩展到完整行(选区为空时作用于光标所在行)。
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let rawEnd = end;
  const nlAfter = text.indexOf("\n", end);
  const lineEnd = nlAfter === -1 ? text.length : nlAfter;
  if (end === start) rawEnd = lineEnd;
  else if (end < lineEnd) rawEnd = lineEnd;

  const block = text.slice(lineStart, rawEnd);
  const lines = block.split("\n");
  const allHave = lines.every((l) => l.startsWith(prefix));
  const nextLines = allHave ? lines.map((l) => l.slice(prefix.length)) : lines.map((l) => prefix + l);
  // 区块为空时插入占位文本。
  if (!block.trim()) nextLines[0] = prefix + placeholder;
  const nextText = nextLines.join("\n");
  const next = text.slice(0, lineStart) + nextText + text.slice(rawEnd);
  const selStart = lineStart + (allHave ? 0 : prefix.length);
  const selEnd = lineStart + nextText.length;
  return { text: next, selectionStart: selStart, selectionEnd: selEnd };
}

export function bold(text: string, start: number, end: number): MarkdownEditResult {
  return wrap(text, start, end, "**", "**", "加粗文字");
}

export function italic(text: string, start: number, end: number): MarkdownEditResult {
  return wrap(text, start, end, "*", "*", "斜体文字");
}

export function strikethrough(text: string, start: number, end: number): MarkdownEditResult {
  return wrap(text, start, end, "~~", "~~", "删除线文字");
}

export function inlineCode(text: string, start: number, end: number): MarkdownEditResult {
  return wrap(text, start, end, "`", "`", "code");
}

export function heading(text: string, start: number, end: number): MarkdownEditResult {
  return linePrefix(text, start, end, "## ", "章节标题");
}

export function quote(text: string, start: number, end: number): MarkdownEditResult {
  return linePrefix(text, start, end, "> ", "引用内容");
}

export function bulletList(text: string, start: number, end: number): MarkdownEditResult {
  return linePrefix(text, start, end, "- ", "列表项");
}

export function orderedList(text: string, start: number, end: number): MarkdownEditResult {
  return linePrefix(text, start, end, "1. ", "列表项");
}

export function codeBlock(text: string, start: number, end: number): MarkdownEditResult {
  const sel = text.slice(start, end);
  const content = sel || "// 在这里写代码";
  const fenced = `\`\`\`\n${content}\n\`\`\``;
  const next = text.slice(0, start) + fenced + text.slice(end);
  const selStart = start + 4 + (sel ? 0 : content.length);
  const selEnd = start + fenced.length - 4;
  return { text: next, selectionStart: selStart, selectionEnd: selEnd };
}

export function link(text: string, start: number, end: number): MarkdownEditResult {
  const sel = text.slice(start, end);
  const label = sel || "链接文字";
  const url = "https://";
  const next = text.slice(0, start) + `[${label}](${url})` + text.slice(end);
  // 预选 URL,方便直接输入。
  const selStart = start + label.length + 3;
  const selEnd = selStart + url.length;
  return { text: next, selectionStart: selStart, selectionEnd: selEnd };
}

export function image(text: string, start: number, end: number): MarkdownEditResult {
  const sel = text.slice(start, end);
  const alt = sel || "图片描述";
  const next = text.slice(0, start) + `![${alt}](https://)` + text.slice(end);
  const selStart = start + alt.length + 4;
  const selEnd = selStart + 8;
  return { text: next, selectionStart: selStart, selectionEnd: selEnd };
}

export function undoEdit(text: string, _start: number, _end: number): MarkdownEditResult {
  // 撤销由调用方维护历史栈,此处仅为类型统一(实际不修改文本)。
  return EMPTY_SELECTION(text, _start);
}
