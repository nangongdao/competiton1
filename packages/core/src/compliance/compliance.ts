/**
 * COMPLIANCE-01 合规与安全审查。
 *
 * 发布前扫描图文视频,提示可能触发平台限流 / 封号的敏感词、违规画面,
 * 并提供替换词建议。覆盖:
 * - 违禁词 / 极限词(扩展内置词表,输出严重度与替换建议);
 * - 敏感话题词(政治 / 医疗 / 金融 / 广告法 等领域样例);
 * - 外链风险(短链 / 可疑域名);
 * - 版权风险提示(如 "转载" / "搬运" 声明缺失)。
 *
 * 设计原则:
 * - 规则版确定性、离线可用;词表可扩展;
 * - 输出**风险等级 + 定位 + 替换建议**,不自动改内容;
 * - 纯 TS 零 DOM,可单测。
 */

/** 风险等级。 */
export type ComplianceSeverity = "high" | "medium" | "low";

/** 风险类别。 */
export type ComplianceKind =
  | "banned-word" // 违禁词/极限词
  | "sensitive-topic" // 敏感话题
  | "risky-link" // 风险链接
  | "copyright" // 版权声明缺失
  | "image-risk"; // 图片风险提示

/** 单条审查结果。 */
export interface ComplianceIssue {
  readonly kind: ComplianceKind;
  readonly severity: ComplianceSeverity;
  /** 命中的词/模式。 */
  readonly match: string;
  /** 定位(标题/正文片段)。 */
  readonly location: string;
  /** 说明。 */
  readonly message: string;
  /** 替换建议(可空)。 */
  readonly suggestion?: string;
}

/** 审查报告。 */
export interface ComplianceReport {
  readonly issues: readonly ComplianceIssue[];
  /** 是否建议发布前处理(有 high 级问题)。 */
  readonly blocked: boolean;
  /** 汇总等级:ok / warn / blocked。 */
  readonly verdict: "ok" | "warn" | "blocked";
  readonly scannedAt: string;
}

/** 审查选项。 */
export interface ComplianceOptions {
  /** 额外违禁词表(追加)。 */
  readonly extraBannedWords?: readonly string[];
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 极限词/广告法词表(高严重度)。 */
export const HIGH_RISK_WORDS: readonly string[] = [
  "国家级", "世界级", "最高级", "最佳", "最好", "第一", "顶级", "极品", "绝对", "唯一",
  "最先进", "最便宜", "最划算", "史无前例", "绝无仅有", "万能", "100%", "包治",
  "根治", "永久", "纯天然", "无副作用", "彻底治愈", "药到病除",
];

/** 敏感话题词表(中严重度,样例非穷尽)。 */
export const MEDIUM_RISK_WORDS: readonly string[] = [
  "医疗", "治疗", "疗效", "减肥神药", "丰胸", "壮阳", "炒股", "理财稳赚",
  "保本", "收益率", "代孕", "刷单", "兼职日赚", "贷款秒批", "中奖", "点击领奖",
];

/** 可疑域名模式(外链风险)。 */
const RISKY_URL_PATTERNS: readonly RegExp[] = [
  /https?:\/\/[^/\s]*(bit\.ly|t\.cn|dwz\.cn|u\.to|短链接)[^/\s]*/i,
  /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/,
  /https?:\/\/[^/\s]*\.(xyz|top|loan|click|download|zip)\b/i,
];

/** 版权提示词。 */
const COPYRIGHT_HINTS: readonly string[] = ["转载", "搬运", "转自", "来源", "摘自", "援引", "内容来自", "翻译自"];

/** 审查单个文本片段。 */
export function scanComplianceText(
  text: string,
  options: ComplianceOptions = {},
): readonly ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const banned = [...HIGH_RISK_WORDS, ...MEDIUM_RISK_WORDS, ...(options.extraBannedWords ?? [])];
  const seen = new Set<string>();

  for (const w of banned) {
    if (seen.has(w)) continue;
    if (!text.includes(w)) continue;
    seen.add(w);
    const high = HIGH_RISK_WORDS.includes(w);
    const medium = MEDIUM_RISK_WORDS.includes(w);
    issues.push({
      kind: high || medium ? (high ? "banned-word" : "sensitive-topic") : "banned-word",
      severity: high ? "high" : "medium",
      match: w,
      location: locate(text, w),
      message: high
        ? `命中极限词「${w}」,可能触发平台限流/下架`
        : `命中敏感词「${w}」,建议发布前核实是否符合平台规范`,
      suggestion: high ? suggestionFor(w) : undefined,
    });
  }

  // 外链风险。
  for (const re of RISKY_URL_PATTERNS) {
    const m = text.match(re);
    if (m && m[0]) {
      issues.push({
        kind: "risky-link",
        severity: "medium",
        match: m[0].slice(0, 60),
        location: locate(text, m[0]),
        message: "检测到疑似短链/IP/风险域名,平台可能拦截或标记",
        suggestion: "改用完整可信域名并在平台后台报备",
      });
    }
  }

  // 版权提示(仅对疑似转摘内容)。
  const hasCopyrightHint = COPYRIGHT_HINTS.some((h) => text.includes(h));
  if (text.length > 200 && !hasCopyrightHint) {
    issues.push({
      kind: "copyright",
      severity: "low",
      match: "(缺失来源声明)",
      location: "文末/开头",
      message: "长文未检测到来源/转载声明,若为二次创作请补充署名",
      suggestion: "在文首或文末补充「来源 / 原作者 / 授权说明」",
    });
  }

  return issues;
}

/** 定位文本中的命中位置(返回前后片段)。 */
function locate(text: string, needle: string): string {
  const idx = text.indexOf(needle);
  if (idx === -1) return "正文";
  const start = Math.max(0, idx - 10);
  const end = Math.min(text.length, idx + needle.length + 10);
  return `…${text.slice(start, end)}…`;
}

/** 常见极限词替换建议。 */
function suggestionFor(word: string): string | undefined {
  const map: Readonly<Record<string, string>> = {
    最佳: "很好/优选",
    最好: "很好/优选",
    第一: "领先/头部",
    顶级: "高端",
    绝对: "确实",
    国家级: "通过权威认证",
    世界级: "国际水准",
    唯一: "目前较少见",
    "100%": "绝大多数",
    根治: "明显改善",
    永久: "长期",
  };
  return map[word] ?? "替换为温和、可证实的表述";
}

/** 审查一篇 Markdown 图文(标题 + 正文纯文本)。 */
export function scanCompliance(
  title: string,
  markdown: string,
  options: ComplianceOptions = {},
): ComplianceReport {
  const scannedAt = (options.now ?? (() => new Date().toISOString()))();
  const bodyText = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " [图片] ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#|~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const issues: ComplianceIssue[] = [];
  const titleIssues = scanComplianceText(title, options);
  const bodyIssues = scanComplianceText(bodyText, options);
  issues.push(
    ...titleIssues.map((i) => ({ ...i, location: `标题:${i.location}` })),
    ...bodyIssues.map((i) => ({ ...i, location: `正文:${i.location}` })),
  );

  // 图片风险提示(没有 alt 描述的图片)。
  const imgCount = (markdown.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length;
  const imgNoAlt = (markdown.match(/!\[\]\([^)]*\)/g) ?? []).length;
  if (imgNoAlt > 0) {
    issues.push({
      kind: "image-risk",
      severity: "low",
      match: `缺 alt 图片 ×${imgNoAlt}`,
      location: "正文",
      message: `${imgCount} 张图片中有 ${imgNoAlt} 张缺描述,部分平台可能影响收录与无障碍`,
      suggestion: "为图片补充 alt 描述",
    });
  }

  const high = issues.filter((i) => i.severity === "high").length;
  const medium = issues.filter((i) => i.severity === "medium").length;
  const blocked = high > 0;
  const verdict: ComplianceReport["verdict"] = blocked ? "blocked" : high + medium > 0 ? "warn" : "ok";
  return { issues, blocked, verdict, scannedAt };
}
