/**
 * 编辑器智能输入辅助 —— 纯函数工具。
 *
 * 围绕 textarea 的 text + selectionStart/selectionEnd 实现创作期高频编辑动作:
 * - `indentSelection`:Tab 缩进选中行(选区为空时在光标处插入两个空格);
 * - `outdentSelection`:Shift+Tab 反缩进选中行;
 * - `autoCloseDelimiter`:输入成对 Markdown 定界符时自动补全闭合符
 *   (`**` `*` `~~` `` ` ``),并把光标/选区放到合理位置;
 * - `toggleBlockQuote` / `toggleBulletList` / `toggleOrderedList`:行首语法 toggle
 *   (与 MarkdownToolbar 语义一致,供快捷键复用);
 * - `handleEnter`:回车时延续列表 / 引用 / 代码块前缀,空项自动退出。
 *
 * 设计原则:
 * - 纯 TS、零 DOM,返回 { text, selectionStart, selectionEnd },由调用方应用;
 * - 全部函数可单测,不依赖编辑器实现;
 * - 与 markdown-edit.ts 的选区语义一致(字符索引,Unicode 码点)。
 */

export interface EditorInputResult {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

const EMPTY = (text: string, pos: number): EditorInputResult => ({
  text,
  selectionStart: pos,
  selectionEnd: pos,
});

/** 行首(不含换行)的字符索引。 */
function lineStartOf(text: string, index: number): number {
  const nl = text.lastIndexOf("\n", Math.max(0, index - 1));
  return nl === -1 ? 0 : nl + 1;
}

/** 行尾(不含换行)的字符索引。 */
function lineEndOf(text: string, index: number): number {
  const nl = text.indexOf("\n", index);
  return nl === -1 ? text.length : nl;
}

const INDENT = "  ";

/**
 * Tab 缩进:对选区覆盖的每一行在行首插入缩进;
 * 选区为空时在光标处插入两个空格(与常见编辑器一致)。
 */
export function indentSelection(text: string, start: number, end: number): EditorInputResult {
  if (start === end) {
    const next = text.slice(0, start) + INDENT + text.slice(end);
    return { text: next, selectionStart: start + INDENT.length, selectionEnd: start + INDENT.length };
  }
  // 选区扩展到完整行(与 linePrefix 语义一致)。
  const lineStart = lineStartOf(text, start);
  let rawEnd = end;
  const nlAfter = text.indexOf("\n", end);
  const lineEnd = nlAfter === -1 ? text.length : nlAfter;
  rawEnd = lineEnd;
  const block = text.slice(lineStart, rawEnd);
  const lines = block.split("\n");
  const nextLines = lines.map((l) => INDENT + l);
  const nextText = nextLines.join("\n");
  const next = text.slice(0, lineStart) + nextText + text.slice(rawEnd);
  return { text: next, selectionStart: lineStart, selectionEnd: lineStart + nextText.length };
}

/**
 * Shift+Tab 反缩进:对选区覆盖的每一行移除前导缩进(每次最多一个缩进单位);
 * 选区为空时作用当前行。
 */
export function outdentSelection(text: string, start: number, end: number): EditorInputResult {
  const lineStart = lineStartOf(text, start);
  let rawEnd = end;
  if (start === end) {
    rawEnd = lineEndOf(text, start);
  } else {
    const nlAfter = text.indexOf("\n", end);
    rawEnd = nlAfter === -1 ? text.length : nlAfter;
  }
  const block = text.slice(lineStart, rawEnd);
  const lines = block.split("\n");
  const nextLines = lines.map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.startsWith("\t") ? l.slice(1) : l));
  const nextText = nextLines.join("\n");
  const next = text.slice(0, lineStart) + nextText + text.slice(rawEnd);
  return { text: next, selectionStart: lineStart, selectionEnd: lineStart + nextText.length };
}

/** 成对定界符自动补全配置。 */
const DELIMITERS = [
  { open: "**", close: "**" },
  { open: "*", close: "*" },
  { open: "~~", close: "~~" },
  { open: "`", close: "`" },
] as const;

/**
 * 输入定界符时自动补全闭合符。
 * - 若输入的是 `*`/`` ` ``/`~` 且与下一个字符重复(如输入 `*` 时后面已是 `*`),
 *   则跳过已存在的闭合符(光标前进一位,不重复插入);
 * - 若输入的是 `*` 且前一个字符已是 `*`(补全场景),则在当前位置插入 `**` 并光标居中;
 * - 否则按常规补全:插入 open + close,光标落在两者之间。
 */
export function autoCloseDelimiter(text: string, start: number, end: number, typed: string): EditorInputResult {
  const delim = DELIMITERS.find((d) => d.open === typed);
  if (!delim) return EMPTY(text, start);

  const before = text.slice(0, start);
  const after = text.slice(end);

  // 情形 1:输入字符与后续字符相同(如输入 `*` 时后面已是 `*`)—— 跳过闭合符。
  if (after.startsWith(delim.open)) {
    return { text, selectionStart: start + delim.open.length, selectionEnd: start + delim.open.length };
  }
  // 情形 2:前一个字符已是定界符(用户在已开头的定界符后继续输入)—— 补全闭合,光标居中。
  if (before.endsWith(delim.open)) {
    const next = text.slice(0, start) + delim.close + after;
    return { text: next, selectionStart: start, selectionEnd: start };
  }
  // 情形 3:常规补全 —— open + close,光标落在中间。
  const next = text.slice(0, start) + delim.open + delim.close + after;
  return { text: next, selectionStart: start + delim.open.length, selectionEnd: start + delim.open.length };
}

/** 行首前缀 toggle(带前缀则去除,否则添加)。 */
function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
): EditorInputResult {
  const lineStart = lineStartOf(text, start);
  let rawEnd = end;
  if (start === end) {
    rawEnd = lineEndOf(text, start);
  } else {
    const nlAfter = text.indexOf("\n", end);
    rawEnd = nlAfter === -1 ? text.length : nlAfter;
  }
  const block = text.slice(lineStart, rawEnd);
  const lines = block.split("\n");
  const allHave = lines.every((l) => l.startsWith(prefix));
  const nextLines = allHave ? lines.map((l) => l.slice(prefix.length)) : lines.map((l) => prefix + l);
  const nextText = nextLines.join("\n");
  const next = text.slice(0, lineStart) + nextText + text.slice(rawEnd);
  return {
    text: next,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextText.length,
  };
}

/** 引用 toggle。 */
export function toggleBlockQuote(text: string, start: number, end: number): EditorInputResult {
  return toggleLinePrefix(text, start, end, "> ");
}

/** 无序列表 toggle。 */
export function toggleBulletList(text: string, start: number, end: number): EditorInputResult {
  return toggleLinePrefix(text, start, end, "- ");
}

/** 有序列表 toggle。 */
export function toggleOrderedList(text: string, start: number, end: number): EditorInputResult {
  return toggleLinePrefix(text, start, end, "1. ");
}

/** 当前行前缀(用于回车续行判断)。 */
function linePrefixOf(line: string): string | null {
  if (/^(\d+)\.\s+/.test(line)) {
    return (/^(\d+)\.\s+/.exec(line)![1]!) + ". ";
  }
  if (/^-\s+/.test(line)) return "- ";
  if (/^>\s?/.test(line)) return line.match(/^>\s?/)![0]!;
  return null;
}

/**
 * 回车(Enter)智能处理:
 * - 列表项 / 引用行:在新行续上前缀;
 * - 空列表项 / 空引用:退出列表(移除前缀,恢复普通文本);
 * - 代码块内:仅换行(保留缩进);
 * - 普通行:返回 null,由调用方走默认换行。
 */
export function handleEnter(text: string, start: number, end: number): EditorInputResult | null {
  if (start !== end) return null; // 有选区时不干预
  const lineStart = lineStartOf(text, start);
  const line = text.slice(lineStart, lineEndOf(text, start));

  // 代码块内:保留行首空白(缩进),其余默认。
  const prefix = linePrefixOf(line);
  if (!prefix) return null;

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const isList = prefix.endsWith(". ") || prefix === "- ";
  const isEmptyItem = line.trim() === prefix.trim();

  if (isEmptyItem) {
    // 空列表/引用项:回车退出,移除前缀与行首空白。
    const before = text.slice(0, lineStart);
    const after = text.slice(lineStart + line.length);
    const next = before + after;
    return { text: next, selectionStart: lineStart, selectionEnd: lineStart };
  }

  // 有序列表自动递增编号。
  let nextPrefix = prefix;
  if (isList && /^\d+\.\s+$/.test(prefix)) {
    const num = Number.parseInt(prefix, 10) + 1;
    nextPrefix = `${num}. `;
  }

  const next = text.slice(0, start) + "\n" + leadingWhitespace + nextPrefix + text.slice(end);
  const sel = start + 1 + leadingWhitespace.length + nextPrefix.length;
  return { text: next, selectionStart: sel, selectionEnd: sel };
}
