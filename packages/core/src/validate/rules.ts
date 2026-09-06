/**
 * 通用校验规则 —— 基于序列化产物 + 能力声明,产出 error/warning。
 *
 * 规则按"能力声明"驱动:长度上限、必须封面、图片张数、违禁词等。
 * 截断行为发生在序列化层;校验层负责告知用户"发生了什么/需注意什么"。
 */
import type { Capabilities, Document, PlatformLimits } from "../ir/types.js";
import { graphemeCount } from "../transforms/grapheme-count.js";
import { scanBannedWords, DEFAULT_BANNED_WORDS } from "../transforms/banned-word-filter.js";
import type { SerializedPayload } from "../adapters/types.js";
import type { ValidationIssue } from "./types.js";

/** 文本类 MIME(纯文本 / Markdown)与 HTML 区分:文本类无需去标签。 */
export function isTextMime(mime: string): boolean {
  return mime === "text/plain" || mime === "text/markdown";
}

/** 标题长度规则。 */
export function checkTitle(payload: SerializedPayload, limits: PlatformLimits): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const max = limits.titleMax;
  if (!payload.title.trim()) {
    issues.push({ severity: "error", code: "title-empty", message: "标题为空", field: "title" });
  }
  if (max) {
    const n = graphemeCount(payload.title);
    if (n > max) {
      issues.push({
        severity: "error",
        code: "title-too-long",
        message: `标题 ${n} 字,超过上限 ${max} 字`,
        field: "title",
      });
    }
  }
  return issues;
}

/** 正文长度规则(对纯文本/HTML 取可见字符数粗算)。 */
export function checkBody(payload: SerializedPayload, limits: PlatformLimits): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const max = limits.bodyMax;
  if (!max) return issues;
  // 纯文本直接计数;HTML 去标签后计数。
  const text = isTextMime(payload.mime) ? payload.content : stripTags(payload.content);
  const n = graphemeCount(text);
  if (n > max) {
    issues.push({
      severity: "error",
      code: "body-too-long",
      message: `正文 ${n} 字,超过上限 ${max} 字`,
      field: "body",
    });
  }
  return issues;
}

/** 摘要长度规则。 */
export function checkSummary(payload: SerializedPayload, limits: PlatformLimits): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const max = limits.summaryMax;
  if (max && payload.summary && graphemeCount(payload.summary) > max) {
    issues.push({
      severity: "warning",
      code: "summary-too-long",
      message: `摘要超过 ${max} 字,将被截断`,
      field: "summary",
    });
  }
  return issues;
}

/** 必须封面 / 图片张数规则。 */
export function checkMedia(payload: SerializedPayload, cap: Capabilities): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasAnyImage = !!payload.coverAssetId || payload.imageAssetIds.length > 0;
  if (cap.requiresCover && !hasAnyImage) {
    const isXhs = cap.contentModel === "plaintext";
    issues.push({
      severity: isXhs ? "error" : "warning",
      code: "cover-missing",
      message: isXhs ? "小红书必须有图,需生成封面卡片" : "缺少封面,建议补充以提升分发",
      field: "cover",
    });
  }
  if (cap.limits.maxImages && payload.imageAssetIds.length > cap.limits.maxImages) {
    issues.push({
      severity: "error",
      code: "too-many-images",
      message: `图片 ${payload.imageAssetIds.length} 张,超过上限 ${cap.limits.maxImages} 张`,
      field: "images",
    });
  }
  return issues;
}

/** 标签数量规则。 */
export function checkTags(payload: SerializedPayload, limits: PlatformLimits): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (limits.tagsMax && payload.tags.length > limits.tagsMax) {
    issues.push({
      severity: "warning",
      code: "too-many-tags",
      message: `标签 ${payload.tags.length} 个,超过建议上限 ${limits.tagsMax} 个`,
      field: "tags",
    });
  }
  return issues;
}

/** 违禁词规则(基于原始文档扫描)。 */
export function checkBannedWords(
  doc: Document,
  cap: Capabilities,
  bannedWords: readonly string[] = DEFAULT_BANNED_WORDS,
): ValidationIssue[] {
  if (!cap.bannedWordFilter) return [];
  const hits = scanBannedWords(doc, bannedWords);
  return hits.map((h) => ({
    severity: "warning" as const,
    code: "banned-word",
    message: `检测到极限/违禁词「${h.word}」(${h.count} 处),已替换以保护流量`,
    field: "body",
  }));
}

/** 图片重托管规则:对声明 requiresImageRehost 的平台,检测是否仍有未重托管的图片。 */
export function checkImageRehost(doc: Document, platformId: string, cap: Capabilities): ValidationIssue[] {
  if (!cap.requiresImageRehost) return [];
  const unrehosted = doc.assets.filter((a) => {
    if (a.kind !== "image") return false;
    if (a.source.generated) return false;
    const rehost = a.rehosted[platformId];
    return !rehost?.url && !rehost?.mediaId;
  });
  if (unrehosted.length === 0) return [];
  return [
    {
      severity: "warning",
      code: "image-not-rehosted",
      message: `${unrehosted.length} 张图片未重托管,可能因防盗链无法显示。请配置图床服务(http://127.0.0.1:8787)后重试`,
      field: "images",
    },
  ];
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
