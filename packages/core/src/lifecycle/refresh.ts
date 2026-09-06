/**
 * v9 Phase 1 · LC-03 翻新草稿生成。
 *
 * 基于原草稿 + 老化建议生成「翻新草稿」骨架(标题 / 结构 / 平台覆盖层可配置),
 * 生成结果为**新草稿**(不动原文),可撤销,保留原文溯源。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;生成结果可撤销(由调用方管理,本模块只产出骨架);
 * - 保留原文溯源:翻新草稿携带 `sourceDraftId` / `sourceUpdatedAt`;
 * - 结构保守:只做确定性文本变换(标题加时间戳/摘要、正文保持不变,
 *   可选插入"翻新说明"),不依赖 LLM(LLM 增强由上层负责)。
 */
import type { PlatformOverride } from "../ir/types.js";

/** 翻新草稿选项。 */
export interface RefreshDraftOptions {
  /** 原草稿标题(必填)。 */
  readonly title: string;
  /** 原草稿正文 Markdown。 */
  readonly markdown: string;
  /** 翻新说明(插入到草稿头部,可选)。 */
  readonly refreshNote?: string;
  /** 是否把当前日期追加到标题(默认 true)。 */
  readonly appendDateToTitle?: boolean;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
  /** 平台覆盖层(可配置标题/摘要)。 */
  readonly platformOverrides?: Readonly<Record<string, PlatformOverride>>;
  /** 翻新理由(来自老化建议,可选)。 */
  readonly reason?: string;
}

/** 翻新草稿结果。 */
export interface RefreshDraftResult {
  /** 新草稿标题。 */
  readonly title: string;
  /** 新草稿正文。 */
  readonly markdown: string;
  /** 平台覆盖层(透传)。 */
  readonly platformOverrides: Readonly<Record<string, PlatformOverride>>;
  /** 来源草稿溯源。 */
  readonly source: { readonly title: string; readonly refreshedAt: string };
  /** 是否发生了变更(标题变化 / 插入说明)。 */
  readonly changed: boolean;
}

/** 当前日期(YYYY-MM-DD)。 */
function today(now: () => string): string {
  return now().slice(0, 10);
}

/**
 * LC-03 生成翻新草稿骨架。
 *
 * - 标题:原文 + `(翻新 YYYY-MM-DD)` 后缀(可关闭);
 * - 正文:在头部插入 `> 🔄 翻新说明`(可选),正文内容原样保留;
 * - 平台覆盖层:透传调用方配置(不自动改动)。
 */
export function buildRefreshDraft(options: RefreshDraftOptions): RefreshDraftResult {
  const now = options.now ?? (() => new Date().toISOString());
  const refreshedAt = now();
  const appendDate = options.appendDateToTitle ?? true;

  const dateSuffix = appendDate ? `(翻新 ${today(now)})` : "";
  const title = options.title.endsWith(")") && dateSuffix ? `${options.title}${dateSuffix}` : `${options.title}${dateSuffix}`;

  let markdown = options.markdown;
  const noteParts: string[] = [];
  if (options.reason) noteParts.push(`> 🔄 **翻新原因**:${options.reason}`);
  if (options.refreshNote) noteParts.push(`> 📝 **翻新说明**:${options.refreshNote}`);

  if (noteParts.length > 0) {
    const note = `> ---\n${noteParts.join("\n")}\n> ---\n\n`;
    markdown = note + markdown.trimStart();
  }

  const changed = title !== options.title || markdown !== options.markdown;

  return {
    title,
    markdown,
    platformOverrides: options.platformOverrides ?? {},
    source: { title: options.title, refreshedAt },
    changed,
  };
}
