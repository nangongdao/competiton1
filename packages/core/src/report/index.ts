/**
 * v3 · 发布复盘报告模块统一导出。
 */
export {
  buildPerformanceReport,
  formatCount,
  suggestionsToMarkdown,
  filterRecordsByWindow,
  reportMarkdownToHtml,
  REPORT_TEMPLATE_LABELS,
  type BuildReportOptions,
  type ReportTemplate,
} from "./report.js";

// v9 Phase 3 · AI 报告解读(REPORT-AI-01)
export {
  ruleReportInsight,
  reportInsightRequest,
  parseReportInsightJson,
  summarizeReportWithLlm,
  type ReportAiInsight,
} from "./ai-insight.js";
