/**
 * v9 Phase 1 内容生命周期管理 —— 纯函数测试(LC-01/02/03)。
 */
import { describe, expect, it } from "vitest";
import type { PerformanceRecord } from "../src/analytics/types.js";
import {
  detectAgingContent,
  AGING_ACTION_LABELS,
  AGING_SEVERITY_LABELS,
  suggestedRepublishHour,
} from "../src/lifecycle/aging.js";
import {
  extractFragmentsFromDocument,
  extractContentFragments,
  searchFragments,
} from "../src/lifecycle/fragments.js";
import { buildRefreshDraft } from "../src/lifecycle/refresh.js";
import { markdownToIR } from "../src/parse/md-to-ir.js";

function rec(partial: Partial<PerformanceRecord> & { id: string; platformId: string; title: string }): PerformanceRecord {
  return {
    historyId: undefined,
    remoteId: undefined,
    remoteUrl: undefined,
    publishedAt: "2026-08-01T10:00:00.000Z",
    collectedAt: "2026-08-01T10:00:00.000Z",
    metrics: {},
    source: "manual",
    ...partial,
  };
}

const NOW = () => "2026-08-07T00:00:00.000Z";

describe("detectAgingContent — LC-01 内容老化检测", () => {
  it("空数据安全回退", () => {
    const r = detectAgingContent([], { now: NOW });
    expect(r.safeFallback).toBe(true);
    expect(r.items).toEqual([]);
    expect(r.count).toBe(0);
  });

  it("检测超期且阅读低迷的内容 → 建议翻新", () => {
    // 60 天前发布,阅读远低于同平台平均。
    const records = [
      rec({
        id: "old",
        platformId: "wechat",
        title: "旧文",
        publishedAt: "2026-06-01T10:00:00Z",
        metrics: { views: 10 },
      }),
      rec({
        id: "hot1",
        platformId: "wechat",
        title: "热文1",
        publishedAt: "2026-08-05T10:00:00Z",
        metrics: { views: 500 },
      }),
      rec({
        id: "hot2",
        platformId: "wechat",
        title: "热文2",
        publishedAt: "2026-08-06T10:00:00Z",
        metrics: { views: 600 },
      }),
    ];
    const r = detectAgingContent(records, { now: NOW, oldAfterDays: 30 });
    expect(r.count).toBe(1);
    const item = r.items[0]!;
    expect(item.title).toBe("旧文");
    expect(item.action).toBe("refresh");
    expect(item.ageDays).toBeGreaterThanOrEqual(30);
    expect(item.severity).toBe("high");
    expect(item.reasons.length).toBeGreaterThan(0);
    expect(item.suggestion).toContain("翻新");
    expect(item.reuseWindow).not.toBeNull();
  });

  it("跨平台聚合:同标题多平台视为同一内容", () => {
    const records = [
      rec({
        id: "a1",
        platformId: "wechat",
        title: "跨平台文",
        publishedAt: "2026-06-01T10:00:00Z",
        metrics: { views: 10 },
      }),
      rec({
        id: "a2",
        platformId: "zhihu",
        title: "跨平台文",
        publishedAt: "2026-06-01T10:00:00Z",
        metrics: { views: 400 },
      }),
    ];
    const r = detectAgingContent(records, { now: NOW, oldAfterDays: 30, aggregateAcrossPlatforms: true });
    expect(r.count).toBe(1);
    const item = r.items[0]!;
    // 跨平台聚合 → 平台表现不均(wechat 低 → 翻新重发)。
    expect(item.title).toBe("跨平台文");
    expect(item.totalViews).toBe(410);
  });

  it("未过期且表现正常的内容不报告", () => {
    const records = [
      rec({
        id: "fresh",
        platformId: "wechat",
        title: "新文",
        publishedAt: "2026-08-06T10:00:00Z",
        metrics: { views: 300 },
      }),
      rec({
        id: "fresh2",
        platformId: "wechat",
        title: "新文2",
        publishedAt: "2026-08-06T10:00:00Z",
        metrics: { views: 400 },
      }),
    ];
    const r = detectAgingContent(records, { now: NOW, oldAfterDays: 30 });
    expect(r.count).toBe(0);
  });

  it("标签常量可读", () => {
    expect(AGING_ACTION_LABELS.refresh).toBe("翻新");
    expect(AGING_SEVERITY_LABELS.high).toBe("高");
  });
});

describe("extractFragmentsFromDocument — LC-02 内容片段抽取", () => {
  const markdown = `# 标题一

这是第一段正文,讲的是如何高效写作。

> 引用一句金句:好文章是改出来的。

- 列表项一
- 列表项二

## 二级标题

第二段正文内容。
`;

  it("从 Markdown 抽取段落/标题/引用/列表片段", () => {
    const parsed = markdownToIR(markdown);
    const frags = extractFragmentsFromDocument(parsed.document, "draft-1");
    expect(frags.length).toBeGreaterThanOrEqual(4);
    const kinds = frags.map((f) => f.kind);
    expect(kinds).toContain("heading");
    expect(kinds).toContain("paragraph");
    expect(kinds).toContain("quote");
    expect(kinds).toContain("list");
    // 片段都带来源与位置。
    for (const f of frags) {
      expect(f.sourceDraftId).toBe("draft-1");
      expect(f.blockIndex).toBeGreaterThanOrEqual(0);
      expect(f.text.length).toBeGreaterThan(0);
      expect(f.keywords.length).toBeGreaterThan(0);
    }
  });

  it("不包含引用时跳过 quote", () => {
    const parsed = markdownToIR(markdown);
    const frags = extractFragmentsFromDocument(parsed.document, "draft-1", { includeQuotes: false });
    expect(frags.some((f) => f.kind === "quote")).toBe(false);
  });

  it("extractContentFragments 容错空文本", () => {
    const frags = extractContentFragments("", "draft-x", "无内容");
    expect(Array.isArray(frags)).toBe(true);
  });
});

describe("searchFragments — LC-02 片段检索", () => {
  const markdown = `# 标题:高效写作

正文讲高效写作技巧,包含番茄工作法。

> 金句:输入决定输出。`;

  it("按关键词检索并排序", () => {
    const parsed = markdownToIR(markdown);
    const frags = extractFragmentsFromDocument(parsed.document, "draft-1");
    const hits = searchFragments(frags, "写作");
    expect(hits.length).toBeGreaterThan(0);
    // 标题与正文都含"写作",命中 ≥ 2。
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("空查询返回全部(带过滤)", () => {
    const parsed = markdownToIR(markdown);
    const frags = extractFragmentsFromDocument(parsed.document, "draft-1");
    const all = searchFragments(frags, "");
    expect(all.length).toBe(frags.length);
    const onlyQuote = searchFragments(frags, "", { kind: "quote" });
    expect(onlyQuote.every((f) => f.kind === "quote")).toBe(true);
  });

  it("无命中返回空", () => {
    const parsed = markdownToIR(markdown);
    const frags = extractFragmentsFromDocument(parsed.document, "draft-1");
    const hits = searchFragments(frags, "不存在的关键词xyz");
    expect(hits).toEqual([]);
  });
});

describe("buildRefreshDraft — LC-03 翻新草稿生成", () => {
  it("生成带日期后缀与翻新说明的新草稿", () => {
    const r = buildRefreshDraft({
      title: "我的文章",
      markdown: "# 我的文章\n\n正文内容",
      reason: "阅读低迷,建议翻新",
      refreshNote: "更新时效数据",
      now: NOW,
    });
    expect(r.title).toContain("翻新 2026-08-07");
    expect(r.markdown).toContain("翻新原因");
    expect(r.markdown).toContain("更新时效数据");
    expect(r.markdown).toContain("# 我的文章");
    expect(r.source.title).toBe("我的文章");
    expect(r.changed).toBe(true);
  });

  it("appendDateToTitle=false 时标题不变", () => {
    const r = buildRefreshDraft({
      title: "我的文章",
      markdown: "# 我的文章",
      appendDateToTitle: false,
      now: NOW,
    });
    expect(r.title).toBe("我的文章");
  });

  it("无翻新说明时不改动正文", () => {
    const r = buildRefreshDraft({
      title: "我的文章",
      markdown: "# 我的文章\n\n正文",
      now: NOW,
    });
    expect(r.markdown).toBe("# 我的文章\n\n正文");
    // 标题仍加日期后缀。
    expect(r.title).toContain("翻新 2026-08-07");
  });
});

describe("suggestedRepublishHour — LC-01 再发布时段", () => {
  it("缺数据返回 null + 提示", () => {
    const r = suggestedRepublishHour([]);
    expect(r.hour).toBeNull();
    expect(r.note.length).toBeGreaterThan(0);
  });
});
