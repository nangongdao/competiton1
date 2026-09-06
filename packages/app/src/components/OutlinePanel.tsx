/**
 * OutlinePanel —— 文档大纲导航(v7 Phase 4 OUTLINE-01)。
 *
 * 从当前 Markdown 提取标题树,以侧边小面板展示:
 * - 点击标题 → 定位编辑器到对应行(回调 onNavigate);
 * - 当前所在章节高亮(基于光标行号,由 App 传入 activeId);
 * - 无标题时展示空态提示。
 *
 * 纯展示组件:大纲提取用 @mpp/core 的 extractOutline / activeNodeAtLine 纯函数。
 * 全 Lucide 图标,无表情符号。
 */
import { useMemo } from "react";
import { ListTree, X } from "lucide-react";
import { extractOutline, type OutlineNode } from "@mpp/core";

interface Props {
  /** 当前 Markdown。 */
  markdown: string;
  /** 当前光标所在行号(0 基,由 App 从 textarea 读取)。 */
  cursorLine: number;
  /** 点击标题定位到指定字符索引。 */
  onNavigate: (charIndex: number) => void;
  /** 关闭面板。 */
  onClose: () => void;
}

/** 递归渲染大纲树。 */
function OutlineTree({
  nodes,
  activeTitle,
  onNavigate,
}: {
  nodes: readonly OutlineNode[];
  activeTitle: string | null;
  onNavigate: (charIndex: number) => void;
}) {
  return (
    <ul className="outline-tree">
      {nodes.map((n, i) => {
        const isActive = activeTitle === n.title;
        return (
          <li key={`${n.title}-${n.lineIndex}-${i}`}>
            <button
              type="button"
              className={`outline-node outline-lv-${n.level} ${isActive ? "active" : ""}`}
              style={{ paddingLeft: `${(n.level - 1) * 12 + 8}px` }}
              onClick={() => onNavigate(n.charIndex)}
              title={`${n.title} · 第 ${n.lineIndex + 1} 行`}
            >
              <span className="outline-dot" aria-hidden />
              <span className="outline-title">{n.title}</span>
            </button>
            {n.children.length > 0 && (
              <OutlineTree nodes={n.children} activeTitle={activeTitle} onNavigate={onNavigate} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function OutlinePanel({ markdown, cursorLine, onNavigate, onClose }: Props) {
  const outline = useMemo(() => extractOutline(markdown), [markdown]);

  // 当前章节标题(基于光标行号)。
  const activeTitle = useMemo(() => {
    if (outline.nodes.length === 0) return null;
    const walk = (nodes: readonly OutlineNode[]): string | null => {
      for (const n of nodes) {
        if (n.lineIndex <= cursorLine) {
          const child = walk(n.children);
          return child ?? n.title;
        }
      }
      return null;
    };
    return walk(outline.nodes);
  }, [outline, cursorLine]);

  return (
    <div className="outline-panel" role="complementary" aria-label="文档大纲">
      <div className="outline-header">
        <span className="outline-title-label">
          <ListTree size={13} aria-hidden />
          大纲
        </span>
        <button type="button" className="outline-close" aria-label="关闭大纲" onClick={onClose}>
          <X size={13} aria-hidden />
        </button>
      </div>
      {outline.headingCount === 0 ? (
        <div className="outline-empty">
          暂无标题。以 <code># 标题</code> 开头即可生成大纲。
        </div>
      ) : (
        <div className="outline-body">
          <OutlineTree nodes={outline.nodes} activeTitle={activeTitle} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
