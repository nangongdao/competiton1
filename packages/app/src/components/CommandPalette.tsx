/**
 * v3 · 全局命令面板 —— Ctrl/Cmd+K 唤起,搜索并打开全部功能抽屉。
 *
 * CMD-02 增强:
 * - **最近使用排序**:执行过的命令下次优先展示(带「最近」徽标);
 * - **自定义命令**:用户可新增自定义命令(名称/别名/关键词),别名快速匹配;
 * - 输入过滤(标题 + 关键词 + 别名);
 * - 方向键选择 + Enter 执行;Esc 关闭。
 *
 * 命令来源(与 Toolbar 功能对齐):全部功能抽屉 + 文档动作 + 自定义命令。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, CornerDownLeft, Command, FileText, Plus, X, History, Star, Check } from "lucide-react";
import {
  commandHistory,
  sortByRecent,
  loadRecentFromStorage,
  loadCustomCommands,
  saveCustomCommands,
  type CustomCommandSpec,
} from "./command-history.js";

/** 命令图标类型(由 App 传入具体图标)。 */
export interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly keywords?: string;
  readonly aliases?: string;
  readonly icon: typeof FileText;
  /** 执行动作(同步或异步)。 */
  readonly run: () => void | Promise<void>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 由 App 提供的命令集合(打开各抽屉)。 */
  commands: readonly CommandItem[];
  /** CMD-02:自定义命令的执行回调(action → 打开指定抽屉/动作)。 */
  onCustomAction?: (action: string) => void;
}

export function CommandPalette({ open, onOpenChange, commands, onCustomAction }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(() => loadRecentFromStorage());
  const [customCommands, setCustomCommands] = useState<CustomCommandSpec[]>(() => loadCustomCommands());
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customAliases, setCustomAliases] = useState("");
  const [customKeywords, setCustomKeywords] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开时聚焦输入框并清空查询,刷新最近使用。
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setRecents(loadRecentFromStorage());
      setCustomCommands(loadCustomCommands());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 把内置命令与自定义命令合并(自定义命令 id 加前缀避免冲突)。
  const allCommands = useMemo<CommandItem[]>(() => {
    const custom: CommandItem[] = customCommands.map((c) => ({
      id: `custom:${c.id}`,
      label: c.name,
      hint: c.hint ?? "自定义命令",
      keywords: `${c.keywords ?? ""} ${c.aliases ?? ""}`,
      aliases: c.aliases,
      icon: Star,
      run: () => {
        onCustomAction?.(c.action);
      },
    }));
    return [...commands, ...custom];
  }, [commands, customCommands, onCustomAction]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortByRecent(allCommands, recents, q);
    return allCommands.filter((c) => {
      const hay = `${c.label} ${c.keywords ?? ""} ${c.hint ?? ""} ${c.aliases ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, allCommands, recents]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length]);

  const exec = useCallback(
    (item: CommandItem) => {
      commandHistory.record(item.id);
      // 持久化最近使用(每 10 条去重 + 上限 50)。
      setRecents((prev) => {
        const next = [...prev.filter((r) => r.id !== item.id), { id: item.id, lastUsed: Date.now(), count: 1 }];
        return next.slice(0, 50);
      });
      onOpenChange(false);
      void item.run();
    },
    [onOpenChange],
  );

  const addCustom = useCallback(() => {
    const name = customName.trim();
    if (!name) return;
    const spec: CustomCommandSpec = {
      id: `c${Date.now().toString(36)}`,
      name,
      aliases: customAliases.trim() || undefined,
      keywords: customKeywords.trim() || undefined,
      action: customKeywords.trim() || name,
    };
    const next = [...customCommands, spec];
    setCustomCommands(next);
    saveCustomCommands(next);
    setCustomName("");
    setCustomAliases("");
    setCustomKeywords("");
    setAddingCustom(false);
  }, [customName, customAliases, customKeywords, customCommands]);

  const removeCustom = useCallback(
    (id: string) => {
      const next = customCommands.filter((c) => c.id !== id);
      setCustomCommands(next);
      saveCustomCommands(next);
    },
    [customCommands],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((v) => Math.min(v + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((v) => Math.max(v - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (addingCustom) {
        addCustom();
        return;
      }
      const item = filtered[active];
      if (item) exec(item);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" />
        <Dialog.Content className="cmd-palette" aria-label="全局命令面板" onKeyDown={onKeyDown}>
          <div className="cmd-input-row">
            <Search size={16} className="cmd-search-icon" aria-hidden />
            <input
              ref={inputRef}
              className="cmd-input"
              placeholder="搜索命令…(方向键选择,Enter 执行)"
              aria-label="搜索命令"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="cmd-kbd" title="快捷键">Ctrl K</span>
          </div>

          {addingCustom && (
            <div className="cmd-custom-form" aria-label="新增自定义命令">
              <input
                className="cmd-custom-input"
                placeholder="命令名称(必填)"
                aria-label="命令名称"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              <input
                className="cmd-custom-input"
                placeholder="别名(空格分隔,可选)"
                aria-label="命令别名"
                value={customAliases}
                onChange={(e) => setCustomAliases(e.target.value)}
              />
              <input
                className="cmd-custom-input"
                placeholder="执行动作 / 关键词(可选)"
                aria-label="执行动作"
                value={customKeywords}
                onChange={(e) => setCustomKeywords(e.target.value)}
              />
              <div className="cmd-custom-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={addCustom}>
                  <Check size={13} aria-hidden />
                  保存
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingCustom(false)}>
                  <X size={13} aria-hidden />
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="cmd-list" ref={listRef} role="listbox" aria-label="命令列表">
            {filtered.length === 0 ? (
              <div className="cmd-empty">没有匹配的命令</div>
            ) : (
              filtered.map((c, i) => {
                const Icon = c.icon;
                const isRecent = recents.some((r) => r.id === c.id);
                const isCustom = c.id.startsWith("custom:");
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "cmd-item active" : "cmd-item"}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => exec(c)}
                  >
                    <Icon size={15} className="cmd-item-icon" aria-hidden />
                    <span className="cmd-item-label">{c.label}</span>
                    {isCustom && c.hint === "自定义命令" && (
                      <span className="cmd-item-badge custom-badge">自定义</span>
                    )}
                    {!isCustom && isRecent && (
                      <span className="cmd-item-badge recent-badge"><History size={10} aria-hidden />最近</span>
                    )}
                    {c.hint && c.hint !== "自定义命令" && <span className="cmd-item-hint">{c.hint}</span>}
                    {isCustom && (
                      <button
                        type="button"
                        className="cmd-item-remove"
                        aria-label={`删除命令 ${c.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCustom(c.id.replace(/^custom:/, ""));
                        }}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    )}
                    {i === active && <CornerDownLeft size={13} className="cmd-item-enter" aria-hidden />}
                  </button>
                );
              })
            )}
          </div>
          <div className="cmd-footer">
            <span><Command size={11} aria-hidden /> K 打开</span>
            <span>↑↓ 选择</span>
            <span>↵ 执行</span>
            <span>Esc 关闭</span>
            <button
              type="button"
              className="cmd-add-custom"
              aria-label="新增自定义命令"
              title="新增自定义命令"
              onClick={() => setAddingCustom((v) => !v)}
            >
              <Plus size={12} aria-hidden />
              自定义
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
