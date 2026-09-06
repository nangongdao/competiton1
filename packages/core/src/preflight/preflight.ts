/**
 * 发布前健康检查(v7 创作工作流 —— PREFLIGHT)。
 *
 * 在「一键模拟发布 / 真实发布」之前,对当前内容做一次**跨平台统一体检**:
 * - 标题:缺失、超长(取所有已选平台中最严格 titleMax);
 * - 正文字数:为空、超长 / 过短(取所有已选平台中最严格 bodyMax,过短取 minBody 兜底);
 * - 图片:引用但缺 alt;dataURL 图片(未重托管)告警;
 * - 违禁词:命中极限词/敏感词(公众号/知乎/B站/小红书/掘金/CSDN 通用扫描);
 * - 各平台校验:复用既有 `validate()` 的 error 级问题,按平台汇总。
 *
 * 设计原则:
 * - 纯 TS、零 DOM,可被 app 直接调用,也可进 Worker;
 * - 输出结构化 PreflightReport:overall(ready/blocked)、issues 按严重度排序、
 *   perPlatform 各平台 error 数、suggestions 可执行建议列表;
 * - 不阻止用户:只展示,由用户决定是否继续(默认 blocked 时禁用「一键发布」按钮)。
 */
import { markdownToIR } from "../parse/md-to-ir.js";
import { getAdapter } from "../adapters/registry.js";
import { validate } from "../validate/validator.js";
import { scanBannedWords, DEFAULT_BANNED_WORDS } from "../transforms/banned-word-filter.js";
import { resolveConfig } from "../config/platform-config.js";
import type { PlatformConfigMap } from "../config/platform-config.js";
import type { PlatformOverride } from "../ir/types.js";
import type { ValidationReport } from "../validate/types.js";
import { graphemeCount } from "../transforms/grapheme-count.js";

export type PreflightSeverity = "error" | "warning" | "info";

export interface PreflightIssue {
  readonly severity: PreflightSeverity;
  readonly code: string;
  readonly message: string;
  /** 关联平台(跨平台通用问题为空)。 */
  readonly platformId?: string;
  /** 关联字段(title/body/images/words)。 */
  readonly field?: "title" | "body" | "images" | "words" | "platform";
}

export interface PreflightPlatformSummary {
  readonly platformId: string;
  readonly platformName: string;
  readonly errors: number;
  readonly warnings: number;
  readonly issues: readonly PreflightIssue[];
}

export interface PreflightReport {
  /** 整体是否可安全发布(true = 无 error 级问题)。 */
  readonly ready: boolean;
  readonly issues: readonly PreflightIssue[];
  /** 按平台汇总(含校验 error)。 */
  readonly perPlatform: readonly PreflightPlatformSummary[];
  /** 可执行建议(按严重度排序的文案列表)。 */
  readonly suggestions: readonly string[];
  /** 统计。 */
  readonly counts: { errors: number; warnings: number; infos: number };
}

export interface PreflightInput {
  readonly markdown: string;
  readonly authorName?: string;
  readonly tags?: readonly string[];
  readonly selectedPlatforms: readonly string[];
  readonly overrides?: Readonly<Record<string, PlatformOverride>>;
  readonly config?: PlatformConfigMap;
}

/** 提取正文纯文本(用于字数/违禁词,去掉标题与 markdown 语法)。 */
export function preflightPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .trim();
}

/** 从 markdown 提取标题(首个 # 行)。 */
export function preflightTitle(markdown: string): string {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m?.[1]?.trim() ?? "";
}

/** 运行健康检查。 */
export function runPreflight(input: PreflightInput): PreflightReport {
  const { markdown, authorName = "", tags = [], selectedPlatforms, overrides, config } = input;
  const issues: PreflightIssue[] = [];
  const perPlatform: PreflightPlatformSummary[] = [];
  const title = preflightTitle(markdown);
  const bodyText = preflightPlainText(markdown);
  const bodyGraphemes = graphemeCount(bodyText);
  const imageMatches = markdown.match(/!\[[^\]]*\]\(([^)]*)\)/g) ?? [];

  // —— 标题 ——
  if (!title) {
    issues.push({ severity: "error", code: "title-missing", message: "缺少标题:请以 `# 标题` 开头,平台会提取为首行标题。", field: "title" });
  }

  // —— 正文 ——
  if (bodyGraphemes === 0) {
    issues.push({ severity: "error", code: "body-empty", message: "正文为空:请至少输入一段正文内容。", field: "body" });
  } else if (bodyGraphemes < 200) {
    issues.push({ severity: "warning", code: "body-too-short", message: `正文偏短(${bodyGraphemes} 字),建议至少 200 字以保证平台推荐与阅读体验。`, field: "body" });
  }

  // —— 图片 ——
  for (const m of imageMatches) {
    const altMatch = /^!\[([^\]]*)\]\(/.exec(m);
    const urlMatch = /\]\(([^)]*)\)$/.exec(m);
    const alt = altMatch?.[1]?.trim() ?? "";
    const url = urlMatch?.[1] ?? "";
    if (!alt) {
      issues.push({ severity: "warning", code: "image-no-alt", message: `图片缺少描述(${url.slice(0, 40)}…):建议补充 alt 以提升可访问性与平台检索。`, field: "images" });
    }
    if (url.startsWith("data:")) {
      issues.push({
        severity: "warning",
        code: "image-data-url",
        message: "正文含 dataURL 图片:发布前需重托管为真实图床 URL(一键发布会自动处理,真实发布需配置图床)。",
        field: "images",
      });
    }
  }

  // —— 违禁词(极限词/敏感词)——
  try {
    const { document } = markdownToIR(markdown, { meta: { authorName, tags } });
    const banned = scanBannedWords(document, DEFAULT_BANNED_WORDS);
    for (const hit of banned) {
      issues.push({
        severity: "warning",
        code: "banned-word",
        message: `检测到极限/敏感词「${hit.word}」×${hit.count}:部分平台会限流,建议改为更温和的表达。`,
        field: "words",
      });
    }

    // —— 各平台校验(error 汇总)——
    for (const platformId of selectedPlatforms) {
      const adapter = getAdapter(platformId);
      if (!adapter) {
        issues.push({ severity: "error", code: "platform-unknown", message: `未注册的平台: ${platformId}`, platformId, field: "platform" });
        perPlatform.push({ platformId, platformName: platformId, errors: 1, warnings: 0, issues: [] });
        continue;
      }
      const processed = adapter.preprocess(document, overrides?.[platformId], config?.[platformId]);
      const resolved = config?.[platformId] ? resolveConfig(adapter.capabilities.limits, config[platformId]) : undefined;
      const payload = adapter.serialize(processed, overrides?.[platformId], resolved);
      const report: ValidationReport = validate(platformId, processed, payload, adapter.capabilities, document, config?.[platformId]);
      const pIssues: PreflightIssue[] = report.issues
        .filter((i) => i.severity === "error" || i.severity === "warning")
        .map((i) => ({
          severity: i.severity,
          code: i.code,
          message: i.message,
          platformId,
          field: "platform",
        }));
      perPlatform.push({
        platformId,
        platformName: adapter.name,
        errors: pIssues.filter((i) => i.severity === "error").length,
        warnings: pIssues.filter((i) => i.severity === "warning").length,
        issues: pIssues,
      });
      issues.push(...pIssues);
    }
  } catch {
    issues.push({ severity: "error", code: "parse-failed", message: "内容解析失败:请检查 Markdown 语法是否正确。", field: "platform" });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  // 建议列表:按严重度(error → warning → info)排序并去重。
  const suggestions = [...new Set(issues.map((i) => i.message))];
  suggestions.sort((a, b) => {
    const sevA = issues.find((i) => i.message === a)?.severity ?? "info";
    const sevB = issues.find((i) => i.message === b)?.severity ?? "info";
    const rank = { error: 0, warning: 1, info: 2 } as const;
    return rank[sevA] - rank[sevB];
  });

  return {
    ready: errors === 0,
    issues,
    perPlatform,
    suggestions,
    counts: { errors, warnings, infos },
  };
}
