/**
 * v3 · 发布复盘报告测试。
 *
 * 覆盖:
 * - 空记录 → 空态报告;
 * - 有记录 → 概览 / 智能分析 / 策略建议 / 分平台汇总 / 最佳表现;
 * - 策略建议 Markdown 渲染(LLM 与规则来源标注);
 * - formatCount 千分位;
 * - 报告不含敏感字段(remoteUrl 不出现)。
 */
import { describe, expect, it } from "vitest";
import { buildPerformanceReport, formatCount, suggestionsToMarkdown, filterRecordsByWindow, reportMarkdownToHtml } from "../src/report/report.js";
import type { PerformanceRecord } from "../src/analytics/types.js";
import type { StrategySuggestion } from "../src/insight/publish-strategy.js";

const NOW = "2026-08-06T12:00:00Z";

function rec(partial: Partial<PerformanceRecord> & Pick<PerformanceRecord, "platformId" | "title">): PerformanceRecord {
  return {
    id: partial.id ?? `r-${Math.random().toString(36).slice(2)}`,
    platformId: partial.platformId,
    title: partial.title,
    remoteId: partial.remoteId,
    remoteUrl: partial.remoteUrl,
    publishedAt: partial.publishedAt ?? "2026-08-01T10:00:00Z",
    collectedAt: partial.collectedAt ?? "2026-08-05T10:00:00Z",
    metrics: partial.metrics ?? {},
    source: partial.source ?? "manual",
  };
}

describe("buildPerformanceReport", () => {
  it("空记录输出空态报告", () => {
    const report = buildPerformanceReport({ now: () => NOW });
    expect(report).toContain("# 多平台发布复盘报告");
    expect(report).toContain("暂无效果记录");
  });

  it("有记录时包含概览与汇总", () => {
    const records = [
      rec({ platformId: "wechat", title: "A 文章", metrics: { views: 1000, likes: 50 } }),
      rec({ platformId: "wechat", title: "B 文章", metrics: { views: 2000, likes: 80 } }),
      rec({ platformId: "zhihu", title: "C 文章", metrics: { views: 500, comments: 10 } }),
    ];
    const report = buildPerformanceReport({ records, now: () => NOW });
    expect(report).toContain("# 多平台发布复盘报告");
    expect(report).toContain("记录总数：**3**");
    expect(report).toContain("覆盖平台：**2**");
    expect(report).toContain("总阅读：**3,500**");
    expect(report).toContain("| wechat | 2 |");
    expect(report).toContain("| zhihu | 1 |");
  });

  it("包含智能分析与行动建议", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", metrics: { views: 1000, likes: 100 } }),
      rec({ platformId: "wechat", title: "B", metrics: { views: 1500, likes: 120 } }),
    ];
    const report = buildPerformanceReport({ records, now: () => NOW });
    expect(report).toContain("## 智能分析");
    expect(report).toContain("## 行动建议");
    expect(report).toContain("## 分平台汇总");
  });

  it("包含发布策略建议(规则来源)", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", metrics: { views: 1000, likes: 100 } }),
    ];
    const report = buildPerformanceReport({ records, now: () => NOW });
    expect(report).toContain("## 发布策略建议");
    expect(report).toContain("[规则]");
  });

  it("可注入 LLM 策略建议并标注来源", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", metrics: { views: 1000, likes: 100 } }),
    ];
    const llmSuggestions: StrategySuggestion[] = [
      { kind: "topic", text: "聚焦 AI 工具评测", reason: "LLM 生成", source: "llm" },
    ];
    const report = buildPerformanceReport({ records, strategySuggestions: llmSuggestions, now: () => NOW });
    expect(report).toContain("- **[LLM] 聚焦 AI 工具评测**");
  });

  it("报告不包含敏感字段(remoteUrl 不出现)", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", remoteUrl: "https://mp.weixin.qq.com/s/secret-token-123", metrics: { views: 1 } }),
    ];
    const report = buildPerformanceReport({ records, now: () => NOW });
    expect(report).not.toContain("secret-token-123");
    expect(report).not.toContain("remoteUrl");
  });

  it("自定义标题生效", () => {
    const report = buildPerformanceReport({ title: "季度复盘", now: () => NOW });
    expect(report).toContain("# 季度复盘");
  });
});

describe("formatCount", () => {
  it("千分位格式化", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("suggestionsToMarkdown", () => {
  it("空建议返回占位", () => {
    expect(suggestionsToMarkdown([])).toContain("暂无建议");
  });

  it("渲染建议与理由", () => {
    const out = suggestionsToMarkdown([
      { kind: "timing", text: "晚上 8 点发布", reason: "互动高峰", source: "rule" },
    ]);
    expect(out).toContain("- **[规则] 晚上 8 点发布**");
    expect(out).toContain("理由：互动高峰");
  });
});

describe("REP-03 报告模板", () => {
  const now = () => "2026-08-06T12:00:00Z";

  it("周报模板裁剪近 7 天数据并标注数据范围", () => {
    const records = [
      rec({ platformId: "wechat", title: "本周文章", publishedAt: "2026-08-05T10:00:00Z", metrics: { views: 1000 } }),
      rec({ platformId: "wechat", title: "旧文章", publishedAt: "2026-07-20T10:00:00Z", metrics: { views: 500 } }),
    ];
    const report = buildPerformanceReport({ records, template: "weekly", now });
    expect(report).toContain("# 周报");
    expect(report).toContain("近 7 天数据");
    expect(report).toContain("记录总数：**1**");
    expect(report).not.toContain("旧文章");
  });

  it("月报模板裁剪近 30 天数据", () => {
    const records = [
      rec({ platformId: "wechat", title: "近月文章", publishedAt: "2026-08-01T10:00:00Z", metrics: { views: 200 } }),
      rec({ platformId: "wechat", title: "超窗旧文", publishedAt: "2026-06-01T10:00:00Z", metrics: { views: 300 } }),
    ];
    const report = buildPerformanceReport({ records, template: "monthly", now });
    expect(report).toContain("# 月报");
    expect(report).toContain("记录总数：**1**");
    expect(report).not.toContain("超窗旧文");
  });

  it("平台专项模板仅统计目标平台并列出最佳单篇", () => {
    const records = [
      rec({ platformId: "wechat", title: "微信文", publishedAt: "2026-08-01T10:00:00Z", metrics: { views: 900, likes: 20 } }),
      rec({ platformId: "zhihu", title: "知乎文", publishedAt: "2026-08-02T10:00:00Z", metrics: { views: 500 } }),
    ];
    const report = buildPerformanceReport({ records, template: "platform", platformId: "wechat", now });
    expect(report).toContain("平台专项：wechat");
    expect(report).toContain("## 最佳单篇");
    expect(report).toContain("微信文");
    expect(report).not.toContain("知乎文");
  });

  it("周报无窗口数据时给出窗口提示", () => {
    const records = [
      rec({ platformId: "wechat", title: "旧文章", publishedAt: "2026-07-01T10:00:00Z", metrics: { views: 1 } }),
    ];
    const report = buildPerformanceReport({ records, template: "weekly", now });
    expect(report).toContain("时间窗口内暂无效果记录");
  });

  it("filterRecordsByWindow 按窗口过滤", () => {
    const records = [
      rec({ platformId: "wechat", title: "A", publishedAt: "2026-08-05T10:00:00Z" }),
      rec({ platformId: "wechat", title: "B", publishedAt: "2026-07-25T10:00:00Z" }),
      rec({ platformId: "wechat", title: "C", publishedAt: "2026-08-01T10:00:00Z" }),
    ];
    const filtered = filterRecordsByWindow(records, 7, now);
    expect(filtered.map((r) => r.title)).toEqual(["A", "C"]);
  });
});

describe("REP-03 reportMarkdownToHtml", () => {
  it("生成完整 HTML 文档(含表格/标题/列表)", () => {
    const md = [
      "# 周报",
      "",
      "> 生成时间：2026-08-06",
      "",
      "## 概览",
      "",
      "- 记录总数：**3**",
      "",
      "| 平台 | 记录数 | 阅读 |",
      "|---|---:|---:|",
      "| wechat | 2 | 1,000 |",
      "",
      "---",
      "",
      "> 结尾说明",
    ].join("\n");
    const html = reportMarkdownToHtml(md, "周报");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>周报</title>");
    expect(html).toContain("<h1>周报</h1>");
    expect(html).toContain("<h2>概览</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>3</strong>");
    expect(html).toContain("<hr />");
    expect(html).toContain("<blockquote>");
  });

  it("转义 HTML 特殊字符", () => {
    const html = reportMarkdownToHtml("# 标题 <script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
