/**
 * v3 · 发布复盘报告 —— 把效果回收 + 智能分析 + 策略建议一键生成 Markdown 报告。
 *
 * 报告内容(全部本地数据,脱敏):
 * - 概览:记录总数 / 覆盖平台 / 总阅读 / 平均阅读;
 * - 智能分析摘要:`analyzePerformance` 的洞察与行动建议;
 * - 策略建议:`ruleStrategySuggestions`(规则)或传入的 LLM 建议;
 * - 分平台明细:按平台聚合阅读/点赞/收藏/评论等指标;
 * - 最佳单篇:表现最好的文章。
 *
 * 设计原则:
 * - 纯函数,输出完整 Markdown(可直接导出 .md 文件或复制);
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段;
 * - 无 LLM 依赖:即使策略建议未生成,报告也完整可用。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import { analyzePerformance } from "../analytics/insights.js";
import { summarizePerformance } from "../analytics/import.js";
import type { StrategySuggestion } from "../insight/publish-strategy.js";
import { ruleStrategySuggestions } from "../insight/publish-strategy.js";

export interface BuildReportOptions {
  /** 效果记录(空时输出空态报告)。 */
  readonly records?: readonly PerformanceRecord[];
  /** 可选:LLM 生成的策略建议(缺省用规则建议)。 */
  readonly strategySuggestions?: readonly StrategySuggestion[];
  /** 报告标题(默认"多平台发布复盘报告")。 */
  readonly title?: string;
  /** 生成时间(默认当前时间)。 */
  readonly now?: () => string;
  /** REP-03:报告模板(默认综合)。 */
  readonly template?: ReportTemplate;
  /** REP-03:平台专项模板的目标平台(仅 platform 模板生效)。 */
  readonly platformId?: string;
}

/** REP-03:报告模板类型。 */
export type ReportTemplate = "overview" | "weekly" | "monthly" | "platform";

/** REP-03:模板人类可读名称。 */
export const REPORT_TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  overview: "多平台发布复盘报告",
  weekly: "周报",
  monthly: "月报",
  platform: "平台专项",
};

/** 按时间窗口过滤记录(近 N 天)。 */
export function filterRecordsByWindow(
  records: readonly PerformanceRecord[],
  days: number,
  now: () => string,
): readonly PerformanceRecord[] {
  const cutoff = new Date(now());
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();
  return records.filter((r) => (r.publishedAt ?? r.collectedAt) >= cutoffIso);
}

/** 对单个指标做千分位格式化。 */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** 把策略建议列表渲染为 Markdown 清单。 */
export function suggestionsToMarkdown(suggestions: readonly StrategySuggestion[]): string {
  if (suggestions.length === 0) return "- 暂无建议。";
  const lines = suggestions.map((s) => {
    const tag = s.source === "llm" ? "LLM" : "规则";
    const platform = s.platformId ? `（${s.platformId}）` : "";
    return `- **[${tag}] ${s.text}**${platform}\n  - 理由：${s.reason || "—"}`;
  });
  return lines.join("\n");
}

/**
 * 生成发布复盘报告 Markdown(支持模板:综合 / 周报 / 月报 / 平台专项)。
 */
export function buildPerformanceReport(options: BuildReportOptions = {}): string {
  const records = options.records ?? [];
  const template = options.template ?? "overview";
  const title = options.title ?? REPORT_TEMPLATE_LABELS[template];
  const now = options.now ? options.now() : new Date().toISOString();

  // 模板数据裁剪:周报近 7 天 / 月报近 30 天 / 平台专项仅该平台。
  let scope = records;
  if (template === "weekly") scope = filterRecordsByWindow(records, 7, () => now);
  else if (template === "monthly") scope = filterRecordsByWindow(records, 30, () => now);
  else if (template === "platform" && options.platformId) {
    scope = records.filter((r) => r.platformId === options.platformId);
  }

  if (scope.length === 0) {
    return [
      `# ${title}`,
      "",
      `> 生成时间：${now}`, "",
      "## 概览", "",
      scope !== records
        ? `- 当前${REPORT_TEMPLATE_LABELS[template]}时间窗口内暂无效果记录。`
        : "- 暂无效果记录。请在「发布效果回收」中导入 CSV 或手工录入数据后重新生成。",
      "",
    ].join("\n");
  }

  const insights = analyzePerformance(scope);
  const summary = summarizePerformance(scope);
  const strategy = options.strategySuggestions ?? ruleStrategySuggestions(scope);
  const best = insights.ranking[0];
  const bestPost = insights.insights.find((i) => i.kind === "best-platform");

  const totalViews = scope.reduce((n, r) => n + (r.metrics.views ?? 0), 0);
  const totalLikes = scope.reduce((n, r) => n + (r.metrics.likes ?? 0), 0);
  const totalFavorites = scope.reduce((n, r) => n + (r.metrics.favorites ?? 0), 0);
  const totalComments = scope.reduce((n, r) => n + (r.metrics.comments ?? 0), 0);
  const avgViews = scope.length > 0 ? Math.round(totalViews / scope.length) : 0;

  const platformLines = [...summary]
    .sort((a, b) => b.totalViews - a.totalViews)
    .map((s) => {
      return `| ${s.platformId} | ${s.count} | ${formatCount(s.totalViews)} | ${formatCount(s.totalLikes)} | ${formatCount(s.totalComments)} |`;
    })
    .join("\n");

  const insightLines = insights.insights
    .map((i) => `- **[${severityLabel(i.severity)}] ${i.title}**：${i.detail}`)
    .join("\n");

  const actionLines = insights.recommendations.map((r) => `- ${r}`).join("\n");

  // 最佳单篇明细(平台专项模板重点呈现)。
  const bestPostLines =
    template === "platform"
      ? scope
          .slice()
          .sort((a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0))
          .slice(0, 5)
          .map(
            (r, i) =>
              `${i + 1}. **${r.title}** — ${formatCount(r.metrics.views ?? 0)} 阅读 / ${formatCount(r.metrics.likes ?? 0)} 赞 / ${formatCount(r.metrics.comments ?? 0)} 评`,
          )
          .join("\n")
      : "";

  const scopeNote =
    template === "weekly"
      ? "近 7 天数据"
      : template === "monthly"
        ? "近 30 天数据"
        : template === "platform"
          ? `平台专项：${options.platformId ?? "—"}`
          : "全部本地效果数据";

  const body = [
    `# ${title}`,
    "",
    `> 生成时间：${now} ｜ 数据范围：${scopeNote}`,
    "",
    "## 概览",
    "",
    `- 记录总数：**${scope.length}**`,
    `- 覆盖平台：**${summary.length}**`,
    `- 总阅读：**${formatCount(totalViews)}**（平均 ${formatCount(avgViews)}/篇）`,
    `- 总点赞 / 收藏 / 评论：${formatCount(totalLikes)} / ${formatCount(totalFavorites)} / ${formatCount(totalComments)}`,
    "",
    "## 智能分析",
    "",
    insightLines || "- 暂无洞察。",
    "",
    "### 行动建议",
    "",
    actionLines || "- 暂无建议。",
    "",
    "## 发布策略建议",
    "",
    suggestionsToMarkdown(strategy),
    "",
    "## 分平台汇总",
    "",
    "| 平台 | 记录数 | 阅读 | 点赞 | 评论 |",
    "|---|---:|---:|---:|---:|",
    platformLines,
    "",
  ];

  if (template === "platform" && bestPostLines) {
    body.push("## 最佳单篇", "", bestPostLines, "");
  }

  body.push(
    "## 最佳表现",
    "",
    best
      ? `- 最佳平台：**${best.platformId}**（平均阅读 ${Math.round(best.avgViews)}）`
      : "- 暂无平台排名。",
    bestPost ? `- 最佳洞察：**${bestPost.title}**` : "",
    "",
    "---",
    "",
    "> 本报告由「多平台内容发布工具」生成，数据仅来自本地效果回收，不含任何凭据。",
    "",
  );

  return body.filter((line) => line !== undefined).join("\n");
}

/** 严重度标签。 */
function severityLabel(severity: string): string {
  switch (severity) {
    case "positive":
      return "佳";
    case "warning":
      return "警";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "提示";
  }
}

/**
 * REP-03 —— 把报告 Markdown 转换为自包含 HTML(供预览 / 打印 PDF)。
 *
 * 轻量实现(不引入完整 Markdown 引擎):支持标题 / 粗体 / 列表 / 引用 / 表格 / 分隔线。
 * 输出含内联 CSS 的完整 HTML 文档,可直接打印为 PDF(浏览器打印对话框)。
 * 纯函数,可单测。
 */
export function reportMarkdownToHtml(markdown: string, title = "发布复盘报告"): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const lines = markdown.split(/\n/);
  const out: string[] = [];
  let inTable = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const inline = (s: string) =>
      esc(s)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]*)`/g, "<code>$1</code>");

    // 空行
    if (!line.trim()) {
      closeList();
      closeTable();
      continue;
    }
    // 表格行
    if (/^\|/.test(line.trim())) {
      closeList();
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      // 分隔行(|---|)跳过
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!inTable) {
        out.push("<table><thead><tr>");
        cells.forEach((c) => out.push(`<th>${inline(c)}</th>`));
        out.push("</tr></thead><tbody>");
        inTable = true;
      } else {
        out.push("<tr>");
        cells.forEach((c) => out.push(`<td>${inline(c)}</td>`));
        out.push("</tr>");
      }
      continue;
    }
    closeTable();
    // 标题
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    // 列表
    const li = /^[-*+]\s+(.+)$/.exec(line);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    // 分隔线
    if (/^---+$/.test(line.trim())) {
      out.push("<hr />");
      continue;
    }
    // 普通段落
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 820px; margin: 32px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.7; }
  h1 { font-size: 26px; border-bottom: 2px solid #7c6cff; padding-bottom: 8px; }
  h2 { font-size: 20px; margin-top: 28px; color: #4b3fd8; }
  h3 { font-size: 16px; margin-top: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #d8d4f5; padding: 8px 12px; text-align: left; font-size: 14px; }
  th { background: #f0eeff; }
  blockquote { border-left: 4px solid #7c6cff; margin: 12px 0; padding: 4px 14px; color: #555; background: #faf9ff; }
  code { background: #f0eeff; padding: 2px 5px; border-radius: 4px; font-size: 13px; }
  hr { border: none; border-top: 1px solid #e3e0f7; margin: 24px 0; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  strong { color: #14122e; }
</style>
</head>
<body>
${out.join("\n")}
</body>
</html>`;
}
