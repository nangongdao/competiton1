/**
 * v7 Phase 4 · OUTLINE-01 —— 文档大纲提取。
 *
 * 从 Markdown 提取标题树(按行号 + 层级),供编辑器侧边大纲面板导航:
 * - 以 `#`~`######` 标题行构造树,缺失层级的标题自动补为"父级 + 1"(不跳级);
 * - 每个条目带 `lineIndex`(0 基行号)与 `charIndex`(字符索引),点击可定位到编辑器;
 * - `activeIndexFor` 根据光标行号计算"当前所在章节",供高亮;
 * - 纯 TS 零 DOM,可单测。
 */

export interface OutlineNode {
  /** 标题文本(去掉 # 前缀与尾部标记)。 */
  readonly title: string;
  /** 标题级别 1-6。 */
  readonly level: number;
  /** 0 基行号。 */
  readonly lineIndex: number;
  /** 该行在整篇 Markdown 中的字符索引(供定位)。 */
  readonly charIndex: number;
  /** 子节点。 */
  children: OutlineNode[];
}

export interface OutlineResult {
  readonly nodes: readonly OutlineNode[];
  /** 是否有标题(无标题时大纲为空)。 */
  readonly hasHeadings: boolean;
  /** 标题总数。 */
  readonly headingCount: number;
}

/** 提取标题文本(去掉 # 前缀、行内代码/链接标记、尾部 #)。 */
export function headingTextOf(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

/** 从 Markdown 提取全部标题行(带行号与字符索引,跳过代码块)。 */
export function collectHeadings(markdown: string): { title: string; level: number; lineIndex: number; charIndex: number }[] {
  const out: { title: string; level: number; lineIndex: number; charIndex: number }[] = [];
  const lines = markdown.split("\n");
  let charIndex = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // 代码围栏切换(``` 或 ~~~)。
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      charIndex += line.length + 1;
      continue;
    }
    if (!inFence) {
      const m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) {
        const title = headingTextOf(line);
        if (title) {
          out.push({ title, level: m[1]!.length, lineIndex: i, charIndex });
        }
      }
    }
    charIndex += line.length + 1; // +1 换行符
  }
  return out;
}

/** 把扁平标题列表构造成树(缺失层级自动补位)。 */
export function buildOutlineTree(
  headings: readonly { title: string; level: number; lineIndex: number; charIndex: number }[],
): readonly OutlineNode[] {
  const root: OutlineNode[] = [];
  // 栈:每层最后一个节点。
  const stack: { node: OutlineNode; level: number }[] = [];
  for (const h of headings) {
    const node: OutlineNode = { ...h, children: [] };
    let parentLevel = 0;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) {
      stack.pop();
    }
    if (stack.length > 0) {
      parentLevel = stack[stack.length - 1]!.level;
      const parent = stack[stack.length - 1]!.node;
      parent.children = [...parent.children, node];
    } else {
      root.push(node);
    }
    // 若跳级(如 h3 前面没有 h2),记录实际父级层级 = 栈顶层级;未入栈的按实际层级入栈。
    void parentLevel;
    stack.push({ node, level: h.level });
  }
  return root;
}

/** 提取大纲(扁平 + 树)。 */
export function extractOutline(markdown: string): OutlineResult {
  const headings = collectHeadings(markdown);
  return {
    nodes: buildOutlineTree(headings),
    hasHeadings: headings.length > 0,
    headingCount: headings.length,
  };
}

/** 根据光标所在行号找到当前所在章节(返回最近的前置标题节点,无则 undefined)。 */
export function activeNodeAtLine(
  nodes: readonly OutlineNode[],
  lineIndex: number,
): OutlineNode | undefined {
  let current: OutlineNode | undefined;
  const walk = (list: readonly OutlineNode[]): void => {
    for (const n of list) {
      if (n.lineIndex <= lineIndex) {
        // 后续同级或子级标题行号更大时,当前节点更精确 —— 先记录,再深入子树。
        current = n;
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return current;
}
