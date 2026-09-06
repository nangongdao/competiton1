/**
 * v7 Phase 4 · SNIPPET-01 —— Markdown 片段库。
 *
 * 常用 Markdown 片段(表格 / 代码块 / 引用 / 告警 / 分隔线 / 折叠 / 公式 / 图片占位 /
 * 任务列表 / 脚注)一键插入编辑器。设计:
 * - 每个片段声明 `id / 名称 / 分类 / 插入文本 / 光标落点(placeholder 标记 `{cursor}`)`;
 * - `insertSnippet(markdown, start, end, snippet)` 纯函数:在光标/选区处插入片段,
 *   返回新文本 + 光标位置(落在 `{cursor}` 处,无则片段末尾);
 * - 可自定义片段(`custom` 标志 + 用户保存),由 app 侧持久化;
 * - 纯 TS 零 DOM,可单测。
 */

export interface MarkdownSnippet {
  readonly id: string;
  readonly name: string;
  /** 分类:通用 / 表格 / 代码 / 引用 / 排版。 */
  readonly category: string;
  /** 插入的 Markdown 文本;`{cursor}` 标记光标落点(0/1 个)。 */
  readonly text: string;
  /** 是否内建(内置为 true,自定义为 false)。 */
  readonly builtin: boolean;
  /** 自定义片段的关键词(供搜索)。 */
  readonly keywords?: string;
}

export interface SnippetInsertResult {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/** 内置片段库。 */
export const BUILTIN_SNIPPETS: readonly MarkdownSnippet[] = [
  {
    id: "table",
    name: "表格",
    category: "通用",
    builtin: true,
    text: "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| {cursor} |  |  |\n|  |  |  |",
    keywords: "table 表格",
  },
  {
    id: "code-block",
    name: "代码块",
    category: "代码",
    builtin: true,
    text: "```\n{cursor}\n```",
    keywords: "code 代码",
  },
  {
    id: "inline-code",
    name: "行内代码",
    category: "代码",
    builtin: true,
    text: "`{cursor}`",
    keywords: "inline code",
  },
  {
    id: "blockquote",
    name: "引用",
    category: "通用",
    builtin: true,
    text: "> {cursor}",
    keywords: "quote 引用",
  },
  {
    id: "callout",
    name: "提示框",
    category: "排版",
    builtin: true,
    text: "> **提示**：{cursor}",
    keywords: "callout tip 提示",
  },
  {
    id: "warning",
    name: "警告框",
    category: "排版",
    builtin: true,
    text: "> ⚠️ **注意**：{cursor}",
    keywords: "warning 警告",
  },
  {
    id: "divider",
    name: "分隔线",
    category: "排版",
    builtin: true,
    text: "\n---\n\n{cursor}",
    keywords: "hr divider 分隔线",
  },
  {
    id: "details",
    name: "折叠块",
    category: "排版",
    builtin: true,
    text: "<details>\n<summary>展开查看</summary>\n\n{cursor}\n\n</details>",
    keywords: "details collapse 折叠",
  },
  {
    id: "math",
    name: "行内公式",
    category: "排版",
    builtin: true,
    text: "$ {cursor} $",
    keywords: "math 公式",
  },
  {
    id: "math-block",
    name: "公式块",
    category: "排版",
    builtin: true,
    text: "$$\n{cursor}\n$$",
    keywords: "math block 公式块",
  },
  {
    id: "image",
    name: "图片占位",
    category: "通用",
    builtin: true,
    text: "![图片描述]({cursor})",
    keywords: "image 图片",
  },
  {
    id: "link",
    name: "链接",
    category: "通用",
    builtin: true,
    text: "[链接文字]({cursor})",
    keywords: "link 链接",
  },
  {
    id: "task-list",
    name: "任务列表",
    category: "通用",
    builtin: true,
    text: "- [ ] {cursor}\n- [ ] ",
    keywords: "todo task 任务",
  },
  {
    id: "footnote",
    name: "脚注",
    category: "排版",
    builtin: true,
    text: "正文{^[脚注内容]}{cursor}",
    keywords: "footnote 脚注",
  },
];

/** 从片段文本找到 `{cursor}` 占位位置(-1 表示无)。 */
export function cursorIndexIn(text: string): number {
  return text.indexOf("{cursor}");
}

/**
 * 在 markdown 的光标/选区处插入片段。
 * - 选区非空时,先用选区内容替换 `{cursor}` 占位(无占位则插入在选区后);
 * - 返回新文本与光标位置。
 */
export function insertSnippet(
  markdown: string,
  start: number,
  end: number,
  snippet: Pick<MarkdownSnippet, "text">,
): SnippetInsertResult {
  const selected = markdown.slice(start, end);
  const cursorAt = cursorIndexIn(snippet.text);
  let body: string;
  if (cursorAt >= 0) {
    body = snippet.text.replace("{cursor}", selected || "");
  } else {
    body = snippet.text;
  }
  const next = markdown.slice(0, start) + body + markdown.slice(end);
  let sel = start + body.length;
  if (cursorAt >= 0) {
    // 光标落在占位处(若选区为空则占位变空字符串,光标在占位起点)。
    sel = start + cursorAt + selected.length;
  }
  return { text: next, selectionStart: sel, selectionEnd: sel };
}

/** 搜索片段(名称/分类/关键词,大小写不敏感)。 */
export function searchSnippets(
  snippets: readonly MarkdownSnippet[],
  query: string,
): readonly MarkdownSnippet[] {
  const q = query.trim().toLowerCase();
  if (!q) return snippets;
  return snippets.filter((s) =>
    `${s.name} ${s.category} ${s.keywords ?? ""}`.toLowerCase().includes(q),
  );
}

/** 按分类分组(保持片段顺序)。 */
export function groupSnippetsByCategory(
  snippets: readonly MarkdownSnippet[],
): readonly { category: string; items: readonly MarkdownSnippet[] }[] {
  const map = new Map<string, MarkdownSnippet[]>();
  for (const s of snippets) {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}
