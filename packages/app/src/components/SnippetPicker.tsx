/**
 * SnippetPicker —— Markdown 片段库(v7 Phase 4 SNIPPET-01)。
 *
 * 常用片段(表格 / 代码块 / 引用 / 提示框 / 公式 / 任务列表等)一键插入编辑器:
 * - 内置片段来自 @mpp/core BUILTIN_SNIPPETS;
 * - 支持搜索(名称/分类/关键词)与分类分组;
 * - 点击片段 → 调用 insertSnippet 在光标处插入,光标落在 {cursor} 占位。
 *
 * 纯展示 + 交互组件:插入逻辑用 core 纯函数,回调由 App 注入(读取 textarea 选区)。
 * 全 Lucide 图标,无表情符号。
 */
import { useMemo, useState } from "react";
import { Blocks, Search, X } from "lucide-react";
import { BUILTIN_SNIPPETS, groupSnippetsByCategory, searchSnippets } from "@mpp/core";

interface Props {
  /** 点击插入片段(text 为片段正文)。 */
  onInsert: (snippetText: string) => void;
  /** 关闭面板。 */
  onClose: () => void;
}

export function SnippetPicker({ onInsert, onClose }: Props) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const filtered = searchSnippets(BUILTIN_SNIPPETS, query);
    return groupSnippetsByCategory(filtered);
  }, [query]);

  return (
    <div className="snippet-picker" role="dialog" aria-modal="false" aria-label="Markdown 片段库">
      <div className="snippet-header">
        <span className="snippet-title">
          <Blocks size={13} aria-hidden />
          片段库
        </span>
        <button type="button" className="snippet-close" aria-label="关闭片段库" onClick={onClose}>
          <X size={13} aria-hidden />
        </button>
      </div>
      <div className="snippet-search">
        <Search size={12} aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索片段…"
          aria-label="搜索片段"
          className="snippet-search-input"
        />
      </div>
      <div className="snippet-body">
        {groups.length === 0 ? (
          <div className="snippet-empty">没有匹配的片段。</div>
        ) : (
          groups.map((g) => (
            <div key={g.category} className="snippet-group">
              <span className="snippet-group-label">{g.category}</span>
              <div className="snippet-items">
                {g.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="snippet-item"
                    onClick={() => onInsert(s.text)}
                    title={s.text.replace("{cursor}", "").slice(0, 40)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
