/**
 * 平台编辑器选择器表 —— 外置,便于平台改版时单点维护 / 远程覆盖。
 *
 * 注入策略本身在 injectors.ts;此处只描述"去哪里找编辑器"。
 * 每个平台给出候选选择器数组(按优先级),注入器逐个尝试,命中即用。
 * 运行时可经 applySelectorOverride 用 setting 下发的覆盖表替换,无需发版即可修复改版。
 */

/** 单平台编辑器选择器配置。 */
export interface PlatformSelectors {
  /** 富文本编辑器(contenteditable)候选,按优先级。 */
  readonly editable?: readonly string[];
  /** 纯文本输入区(textarea / contenteditable)候选,按优先级。 */
  readonly textarea?: readonly string[];
}

export type SelectorMap = Readonly<Record<string, PlatformSelectors>>;

/** 内置默认选择器(改版时优先改这里;紧急情况走远程 override)。 */
export const DEFAULT_SELECTORS: SelectorMap = {
  wechat: {
    editable: ["#ueditor_0 .body", ".rich_media_content", '[contenteditable="true"]'],
  },
  zhihu: {
    editable: [".public-DraftEditor-content", '[contenteditable="true"]'],
  },
  bilibili: {
    editable: [".ql-editor", '[contenteditable="true"]'],
  },
  xiaohongshu: {
    textarea: ["#post-textarea", "textarea", '[contenteditable="true"]'],
  },
};

/** 运行时生效的选择器表(可被 override 覆盖)。 */
let activeSelectors: SelectorMap = DEFAULT_SELECTORS;

/** 取某平台的选择器配置(取不到返回空)。 */
export function getSelectors(platformId: string): PlatformSelectors {
  return activeSelectors[platformId] ?? {};
}

/**
 * 选择器合法性校验:只允许常规 CSS 选择器字符,且长度受限。
 * 防止恶意覆盖把注入目标指向任意元素(如 body)。
 */
const SAFE_SELECTOR = /^[#.[\]="'\w\s>:()-]{1,200}$/;

/** 校验单个选择器配置对象的数组字段是否全部为合法选择器。 */
function isSafeSelectorList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every((item) => typeof item === "string" && SAFE_SELECTOR.test(item))
  );
}

function isSafeSelectors(sel: unknown): sel is PlatformSelectors {
  if (!sel || typeof sel !== "object") return false;
  const s = sel as Record<string, unknown>;
  return (s.editable === undefined || isSafeSelectorList(s.editable)) &&
    (s.textarea === undefined || isSafeSelectorList(s.textarea));
}

/**
 * 应用远程下发的选择器覆盖(逐平台浅合并到默认表)。
 * 用于平台改版后不发版即修复:setting "mpp.selectors" 存 JSON。
 * 非法输入忽略,保持默认,绝不抛错中断注入链路。
 */
export function applySelectorOverride(raw: string | undefined): void {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, PlatformSelectors>>;
    if (!parsed || typeof parsed !== "object") return;
    const merged: Record<string, PlatformSelectors> = { ...DEFAULT_SELECTORS };
    for (const [platformId, sel] of Object.entries(parsed)) {
      if (!isSafeSelectors(sel)) continue;
      merged[platformId] = { ...DEFAULT_SELECTORS[platformId], ...sel };
    }
    activeSelectors = merged;
  } catch {
    /* 损坏的覆盖表:保持默认 */
  }
}

/** 重置为内置默认(测试用)。 */
export function resetSelectors(): void {
  activeSelectors = DEFAULT_SELECTORS;
}
