/**
 * CMD-02 —— 命令面板使用历史与自定义命令。
 *
 * 能力:
 * - **最近使用排序**:记录每次执行的命令 id,下次打开时按最近使用加权排序
 *   (完全无查询时「最近使用」排在最前,其余按原顺序);
 * - **自定义命令 + 别名**:用户可新增"自定义命令"(名称 / 别名 / 关键词 / 执行动作),
 *   通过命令面板输入别名即可快速匹配。
 *
 * 存储:模块级单例(内存)+ 可注入 localStorage 持久化;纯函数可单测。
 */

export interface RecentEntry {
  readonly id: string;
  readonly lastUsed: number;
  readonly count: number;
}

export interface CustomCommandSpec {
  readonly id: string;
  /** 显示名称。 */
  readonly name: string;
  /** 别名(空格分隔,供快速匹配)。 */
  readonly aliases?: string;
  /** 关键词。 */
  readonly keywords?: string;
  /** 提示。 */
  readonly hint?: string;
  /** 执行动作(打开指定抽屉 id / 自定义动作标识)。 */
  readonly action: string;
}

/** 命令使用历史存储接口。 */
export interface CommandHistoryStore {
  list(): RecentEntry[];
  record(id: string): void;
  clear(): void;
}

class MemoryCommandHistory implements CommandHistoryStore {
  private readonly entries = new Map<string, RecentEntry>();
  constructor(load?: () => RecentEntry[]) {
    if (load) {
      for (const e of load()) this.entries.set(e.id, e);
    }
  }
  list(): RecentEntry[] {
    return [...this.entries.values()].sort((a, b) => b.lastUsed - a.lastUsed);
  }
  record(id: string): void {
    const prev = this.entries.get(id);
    this.entries.set(id, {
      id,
      lastUsed: Date.now(),
      count: (prev?.count ?? 0) + 1,
    });
  }
  clear(): void {
    this.entries.clear();
  }
}

/** 模块级单例(默认无持久化)。 */
export const commandHistory: CommandHistoryStore = new MemoryCommandHistory();

/** 工厂(测试用)。 */
export function createCommandHistory(load?: () => RecentEntry[]): CommandHistoryStore {
  return new MemoryCommandHistory(load);
}

/** 从 localStorage 读取最近使用(供桥接注入)。 */
export function loadRecentFromStorage(key = "mpp.commandHistory"): RecentEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentEntry =>
          typeof e === "object" && e !== null && typeof (e as RecentEntry).id === "string",
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

/** 把最近使用写入 localStorage(静默失败)。 */
export function persistRecentToStorage(entries: readonly RecentEntry[], key = "mpp.commandHistory"): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, 50)));
  } catch {
    /* 存储不可用静默 */
  }
}

/** 自定义命令的持久化存储 key。 */
export const CUSTOM_COMMANDS_KEY = "mpp.customCommands";

/** 读取自定义命令。 */
export function loadCustomCommands(): CustomCommandSpec[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COMMANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is CustomCommandSpec =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as CustomCommandSpec).id === "string" &&
        typeof (c as CustomCommandSpec).name === "string" &&
        typeof (c as CustomCommandSpec).action === "string",
    );
  } catch {
    return [];
  }
}

/** 保存自定义命令。 */
export function saveCustomCommands(list: readonly CustomCommandSpec[]): void {
  try {
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(list));
  } catch {
    /* 存储不可用静默 */
  }
}

/**
 * 对命令列表做最近使用排序:
 * - 无查询:最近使用的命令置顶(按 lastUsed 降序),其余保持原顺序;
 * - 有查询:保持相关性过滤结果(不重排,避免干扰搜索)。
 */
export function sortByRecent<T extends { readonly id: string }>(
  items: readonly T[],
  recents: readonly RecentEntry[],
  query: string,
): T[] {
  if (query.trim()) return [...items];
  const rank = new Map(recents.map((r) => [r.id, r.lastUsed]));
  const copy = [...items];
  copy.sort((a, b) => {
    const ra = rank.get(a.id) ?? 0;
    const rb = rank.get(b.id) ?? 0;
    if (ra !== rb) return rb - ra;
    return 0;
  });
  return copy;
}

/** 从自定义命令构造匹配(别名/名称/关键词)。 */
export function matchesCustomCommand(cmd: CustomCommandSpec, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${cmd.name} ${cmd.aliases ?? ""} ${cmd.keywords ?? ""} ${cmd.hint ?? ""} ${cmd.action}`.toLowerCase();
  return hay.includes(q);
}
