/**
 * 共享编辑器撤销历史 —— 让 MarkdownToolbar 与 AI 选区操作(AI 选区改写/全部平台改写)
 * 共用同一条撤销栈,实现「选区 AI 操作并入 Markdown 格式工具栏撤销栈」。
 *
 * 设计要点:
 * - 模块级单例栈(上限 50 步,与 MarkdownToolbar 原历史一致);
 * - 快照记录 { text, start, end }:撤销时还原文本与光标位置;
 * - 纯函数 + 可注入上限,便于单测。
 */

export interface EditorSnapshot {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export const EDITOR_HISTORY_MAX = 50;

/** 可注入存储的撤销历史(默认模块级单例,供 UI 组件共享)。 */
export interface EditorHistory {
  push(snapshot: EditorSnapshot): void;
  pop(): EditorSnapshot | undefined;
  clear(): void;
  readonly length: number;
}

class StackHistory implements EditorHistory {
  private readonly stack: EditorSnapshot[] = [];
  private readonly max: number;
  constructor(max = EDITOR_HISTORY_MAX) {
    this.max = max;
  }
  get length(): number {
    return this.stack.length;
  }
  push(snapshot: EditorSnapshot): void {
    this.stack.push(snapshot);
    if (this.stack.length > this.max) this.stack.shift();
  }
  pop(): EditorSnapshot | undefined {
    return this.stack.pop();
  }
  clear(): void {
    this.stack.length = 0;
  }
}

/** 模块级共享单例:MarkdownToolbar / SelectionAiBar 共用。 */
export const editorHistory: EditorHistory = new StackHistory();

/** 工厂(测试用)。 */
export function createEditorHistory(max = EDITOR_HISTORY_MAX): EditorHistory {
  return new StackHistory(max);
}
