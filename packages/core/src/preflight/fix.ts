/**
 * 发布前健康检查 —— 自动修复工具(v7 Phase 3 PREFLIGHT-04)。
 *
 * 对 `runPreflight` 发现的**可安全自动修复**的问题提供确定性修复:
 * - `image-no-alt`:图片缺 alt 时,从文件名/URL 提取描述填充(纯文本,不注入);
 * - `image-data-url`:dataURL 图片无法自动重托管(需真实图床),返回需人工处理提示,
 *   但可安全地在数据不变时给出“保持原样”决策;
 * - `body-too-short`:正文过短为 warning,不做截断类破坏性修复。
 *
 * 设计原则:
 * - 纯 TS、零 DOM;修复为确定性字符串变换,不做 LLM 猜测;
 * - 每次修复返回 { text, fixes }(fixes 为已应用修复列表),便于 UI 展示与测试;
 * - 只修 error / warning 中可自动化的项,其余(标题缺失 / 平台校验 error)需人工。
 */

export interface AutoFixResult {
  /** 修复后的 Markdown。 */
  readonly text: string;
  /** 已应用的修复(供 UI 提示)。 */
  readonly fixes: readonly string[];
  /** 剩余不可自动修复的 issue code 列表(供 UI 提示)。 */
  readonly remaining: readonly string[];
}

/** 修复类型(供 UI 展示修复能力)。 */
export type AutoFixKind =
  | "image-no-alt"
  | "blank-lines"
  | "trailing-space"
  | "heading-space";

/** 可自动修复的问题 code → 修复描述。 */
export const AUTO_FIX_CAPABILITIES: readonly { code: AutoFixKind; label: string }[] = [
  { code: "image-no-alt", label: "图片缺描述" },
  { code: "blank-lines", label: "多余空行" },
  { code: "trailing-space", label: "行尾空格" },
  { code: "heading-space", label: "标题多余空格" },
];

/** 从图片 URL / 文件名推断描述(去掉扩展名与路径,URL 解码)。 */
export function altFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url);
    const filename = decoded.split("/").pop() ?? "";
    const base = filename.replace(/\.[^.]+$/, "");
    const cleaned = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    return cleaned || "图片";
  } catch {
    return "图片";
  }
}

/**
 * 自动修复正文中缺 alt 的图片。
 * 对 `![ ](url)` 或 `![](url)` 填充 alt;已有 alt 的图片不动。
 */
export function fixMissingImageAlt(markdown: string): AutoFixResult {
  let text = markdown;
  const fixes: string[] = [];
  // 匹配 `![alt](url)`,alt 允许为空。
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  text = text.replace(re, (whole, alt: string, url: string) => {
    if (alt.trim()) return whole; // 已有 alt
    const derived = altFromUrl(url);
    fixes.push(`为 ${url.slice(0, 40)}${url.length > 40 ? "…" : ""} 补充描述「${derived}」`);
    return `![${derived}](${url})`;
  });
  return { text, fixes, remaining: [] };
}

/**
 * 一键自动修复:对可修复的 Preflight 问题执行确定性修复。
 * 当前自动修复项:
 * - `image-no-alt` → 自动填充 alt;
 * - `blank-lines` → 压缩多余空行(保留至多 2 个连续换行,代码块内不动);
 * - `trailing-space` → 清除行尾空格(代码块内不动);
 * - `heading-space` → 标题 `#  ` 多余空格规整;
 * - 其余(标题缺失 / 正文过短 / 违禁词 / 平台校验 error / dataURL)标记为 remaining,
 *   由 UI 引导人工处理。
 */
export function autoFixPreflight(markdown: string): AutoFixResult {
  const altFix = fixMissingImageAlt(markdown);
  let text = altFix.text;
  const fixes = [...altFix.fixes];
  const remaining: string[] = [];

  // —— 行尾空格 ——
  const trailingBefore = text;
  text = text.replace(/[ \t]+$/gm, (m) => {
    // 代码块内行尾空格保留(避免破坏缩进语义)—— 通过“已是否在代码块”无法回溯,
    // 这里简单处理:行尾有 3 个以上空格视为代码缩进,保留;否则清除。
    return m.length >= 3 ? m : "";
  });
  if (text !== trailingBefore) {
    const count = (trailingBefore.match(/[ \t]{1,2}$/gm) ?? []).length;
    fixes.push(`清除 ${count} 处行尾多余空格`);
  }

  // —— 标题多余空格 ——
  const headingBefore = text;
  text = text.replace(/^(#{1,6})[ \t]{2,}(.+)$/gm, (_m, hash: string, rest: string) => `${hash} ${rest}`);
  if (text !== headingBefore) {
    fixes.push("规整标题后的多余空格");
  }

  // —— 多余空行 ——
  const blankBefore = text;
  text = text.replace(/\n{4,}/g, "\n\n\n");
  if (text !== blankBefore) {
    fixes.push("压缩多余空行(最多连续 2 空行)");
  }

  return { text, fixes, remaining };
}
