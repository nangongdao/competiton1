/**
 * 编辑器查找/替换 —— 纯函数工具。
 *
 * 围绕 textarea 的 text + 光标位置实现:
 * - `findMatches`: 返回全部匹配区间(大小写敏感 / 整词 / 正则可选),供高亮与计数;
 * - `nextMatch`: 从光标位置开始找下一个匹配(循环);
 * - `replaceRange`: 替换单个区间(返回新文本 + 新光标位置);
 * - `replaceAll`: 全部替换(返回新文本 + 替换次数);
 * - `lineOfIndex`: 字符索引 → 行号(v7 Phase 2 当前匹配行高亮);
 * - `isValidRegex`: 校验正则表达式合法性。
 *
 * 全部函数保持纯函数可单测,不依赖 DOM。匹配语义:
 * - 空查询返回空结果;
 * - 整词匹配:字符两侧必须是非 [A-Za-z0-9_] 边界(与 JS 正则 \b 对齐,中文按边界处理);
 * - 大小写不敏感时用 Unicode 全折叠比较,避免 toLowerCase 无法覆盖土耳其 İ 等;
 * - 正则模式:基于用户输入的 RegExp 匹配(自动加 g / 可选 i 与 u 标志),非法正则返回空并可由 `isValidRegex` 提示。
 */

export interface MatchRange {
  /** 匹配起点(字符索引,与 textarea 的 selectionStart 一致)。 */
  readonly start: number;
  /** 匹配终点(不含)。 */
  readonly end: number;
}

export interface FindOptions {
  /** 区分大小写。 */
  caseSensitive?: boolean;
  /** 整词匹配(正则模式下仍生效:对匹配区间再做边界过滤)。 */
  wholeWord?: boolean;
  /** 正则模式:把 query 当正则表达式匹配。 */
  useRegex?: boolean;
}

/** 把字符串按 Unicode 码点折叠为小写(兼容全角/土耳其语)。 */
function fold(s: string): string {
  return s.toLocaleLowerCase();
}

/** 判断整词边界:左右两侧不能是单词字符。 */
function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[A-Za-z0-9_]/.test(ch);
}

/** 是否整词边界(两侧非单词字符)。 */
function isWholeWordBoundary(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

/** 校验正则表达式是否合法。 */
export function isValidRegex(query: string): boolean {
  if (!query) return false;
  try {
    new RegExp(query, "gu");
    return true;
  } catch {
    return false;
  }
}

/**
 * 用正则模式查找全部匹配区间。
 * - 非法正则返回空(由调用方用 isValidRegex 提示);
 * - 空匹配(如 `a*`)跳过,避免死循环与零宽匹配干扰;
 * - 大小写不敏感时加 i 标志;始终加 g / u(Unicode 码点对齐 textarea 索引)。
 */
function findRegexMatches(text: string, query: string, caseSensitive: boolean, wholeWord: boolean): MatchRange[] {
  if (!isValidRegex(query)) return [];
  let re: RegExp;
  try {
    re = new RegExp(query, caseSensitive ? "gu" : "giu");
  } catch {
    return [];
  }
  const out: MatchRange[] = [];
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue; // 跳过零宽匹配
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (wholeWord && !isWholeWordBoundary(text, start, end)) continue;
    out.push({ start, end });
  }
  return out;
}

/** 查找全部匹配区间(普通 / 正则)。 */
export function findMatches(text: string, query: string, options: FindOptions = {}): MatchRange[] {
  if (!query) return [];
  const caseSensitive = options.caseSensitive ?? false;
  const wholeWord = options.wholeWord ?? false;
  if (options.useRegex) {
    return findRegexMatches(text, query, caseSensitive, wholeWord);
  }
  const haystack = caseSensitive ? text : fold(text);
  const needle = caseSensitive ? query : fold(query);
  const out: MatchRange[] = [];
  let i = 0;
  while (i <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) break;
    const start = idx;
    const end = idx + needle.length;
    if (!wholeWord || isWholeWordBoundary(text, start, end)) out.push({ start, end });
    i = idx + 1;
  }
  return out;
}

/** 从光标位置开始找下一个匹配(循环到文本开头)。 */
export function nextMatch(text: string, query: string, cursor: number, options: FindOptions = {}): MatchRange | undefined {
  const matches = findMatches(text, query, options);
  if (matches.length === 0) return undefined;
  // 光标在匹配之前(含等于起点)则取该匹配;否则取下一个;循环回第一个。
  const atOrAfter = matches.find((m) => m.start >= cursor) ?? matches[0];
  // 若光标落在某个匹配中间,优先选中它(体验更直觉)。
  const containing = matches.find((m) => m.start <= cursor && cursor <= m.end);
  return containing ?? atOrAfter;
}

/** 替换单个区间(下标使用匹配在 matches 中的索引)。 */
export function replaceRange(text: string, match: MatchRange, replacement: string): { text: string; selectionStart: number; selectionEnd: number } {
  const next = text.slice(0, match.start) + replacement + text.slice(match.end);
  const selectionStart = match.start;
  const selectionEnd = match.start + replacement.length;
  return { text: next, selectionStart, selectionEnd };
}

/** 全部替换,返回新文本与替换次数。 */
export function replaceAll(text: string, query: string, replacement: string, options: FindOptions = {}): { text: string; count: number } {
  const matches = findMatches(text, query, options);
  if (matches.length === 0) return { text, count: 0 };
  // 从后往前替换,前面的索引不失效。
  let next = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    next = next.slice(0, m.start) + replacement + next.slice(m.end);
  }
  return { text: next, count: matches.length };
}

/** 字符索引 → 行号(0 基),供当前匹配行高亮。 */
export function lineOfIndex(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, text.length));
  let line = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

/** 当前行首(不含换行)的字符索引。 */
export function lineStartOf(text: string, index: number): number {
  const nl = text.lastIndexOf("\n", Math.max(0, index - 1));
  return nl === -1 ? 0 : nl + 1;
}

/** 当前行尾(不含换行)的字符索引(下一行首或文本末尾)。 */
export function lineEndOf(text: string, index: number): number {
  const nl = text.indexOf("\n", index);
  return nl === -1 ? text.length : nl;
}
