/**
 * Phase D AI-INSIGHT-03 —— AI 草稿摘要索引与检索测试。
 *
 * 覆盖:
 * - plainTextOfMarkdown 去标记;
 * - 规则摘要与关键词提取;
 * - LLM 可用时生成摘要/关键词(topics);
 * - LLM 返回非法 → 规则兜底;
 * - searchDraftIndexes 相关性排序与关键词命中;
 * - 空查询 / 空索引安全返回。
 */
import { describe, expect, it, vi } from "vitest";
import {
  plainTextOfMarkdown,
  ruleDraftSummary,
  extractKeywords,
  buildDraftIndex,
  searchDraftIndexes,
  parseDraftIndexJson,
  tokenizeQuery,
} from "../src/insight/draft-index.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";

const NOW = "2026-08-06T12:00:00Z";
const now = () => NOW;

const MD = `# 我用效率工具省下两小时

最近发现一个时间管理方法:把一天切成九十分钟专注块。

## 三个方法

1. 时间块
2. 单任务
3. 复盘

![示意图](https://x.example/a.png)
`;

function makeLlm(content: string) {
  return new OpenAiCompatLlm({
    baseUrl: "https://x/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    })) as unknown as typeof fetch,
  });
}

describe("AI 草稿摘要索引(AI-INSIGHT-03)", () => {
  it("plainTextOfMarkdown 去除图片/链接/标题标记", () => {
    const text = plainTextOfMarkdown(MD);
    expect(text).not.toContain("![");
    expect(text).not.toContain("https://x.example");
    expect(text).toContain("效率工具");
    expect(text).toContain("时间管理");
  });

  it("规则摘要取首段并截断", () => {
    const summary = ruleDraftSummary("标题", "正文" + "很长的内容".repeat(50));
    expect(summary.length).toBeLessThanOrEqual(90);
  });

  it("extractKeywords 提取正文高频词", () => {
    const keywords = extractKeywords("效率工具", "时间管理 时间管理 效率工具 效率工具 专注块", 4);
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords[0]).toBeTruthy();
  });

  it("无 LLM 时规则兜底索引", async () => {
    const idx = await buildDraftIndex("d1", "效率工具", MD, undefined, { now });
    expect(idx.draftId).toBe("d1");
    expect(idx.usedLlm).toBe(false);
    expect(idx.keywords.length).toBeGreaterThan(0);
    expect(idx.summary.length).toBeGreaterThan(0);
  });

  it("LLM 可用时生成摘要/关键词/topics", async () => {
    const llm = makeLlm(
      '{"summary":"用时间块方法提升效率","keywords":["时间管理","效率","专注"],"topics":["效率","工作"]}',
    );
    const idx = await buildDraftIndex("d1", "效率工具", MD, llm, { now });
    expect(idx.usedLlm).toBe(true);
    expect(idx.summary).toContain("时间块");
    expect(idx.keywords).toContain("效率");
    expect(idx.topics).toContain("工作");
  });

  it("LLM 返回非法 → 规则兜底", async () => {
    const llm = makeLlm("不是 JSON");
    const idx = await buildDraftIndex("d1", "效率工具", MD, llm, { now });
    expect(idx.usedLlm).toBe(false);
    expect(idx.summary.length).toBeGreaterThan(0);
  });

  it("parseDraftIndexJson 宽松解析代码块", () => {
    const parsed = parseDraftIndexJson('```json\n{"summary":"摘要","keywords":["a","b"]}\n```');
    expect(parsed?.summary).toBe("摘要");
    expect(parsed?.keywords).toEqual(["a", "b"]);
  });

  it("searchDraftIndexes 相关性排序并返回命中关键词", () => {
    const indexes = [
      { draftId: "d1", title: "效率工具", summary: "用时间块提升效率", keywords: ["时间管理", "效率"], topics: ["效率"], usedLlm: false, indexedAt: NOW },
      { draftId: "d2", title: "旅游攻略", summary: "周末去哪里玩", keywords: ["旅游", "周末"], topics: ["生活"], usedLlm: false, indexedAt: NOW },
    ];
    const hits = searchDraftIndexes(indexes, "效率 时间管理", { limit: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.draftId).toBe("d1");
    expect(hits[0]!.matchedKeywords.length).toBeGreaterThan(0);
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  it("空查询 / 空索引安全返回空", () => {
    expect(searchDraftIndexes([], "查询")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});
