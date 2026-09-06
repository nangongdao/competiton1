/**
 * v11 Part 2 · AI 跨平台本土化纯函数测试(LOCALIZE-01/02)。
 */
import { describe, expect, it } from "vitest";
import {
  LOCALIZE_PROFILES,
  localizeContentRule,
  localizeContent,
  localizeLlmRequest,
  parseLocalizeJson,
} from "../src/localize/localize.js";
import {
  inferNiche,
  suggestHashtagsRule,
  suggestHashtags,
  parseHashtagJson,
} from "../src/localize/hashtags.js";
import { NoopLlm } from "../src/llm/noop-llm.js";

const TITLE = "如何用 AI 提升内容团队 10 倍产出效率";
const MD = `# 如何用 AI 提升内容团队 10 倍产出效率

## 为什么内容团队需要 AI
传统内容生产链路长、重复劳动多。AI 可以把整条链路提速。

## 三个核心方法
用 AI 做选题、改写与复盘。`;

describe("localize — LOCALIZE-01 跨平台风格适配", () => {
  it("小红书版:闺蜜语气 + emoji", () => {
    const r = localizeContentRule(TITLE, MD, "xiaohongshu");
    expect(r.label).toBe("小红书");
    expect(r.text.length).toBeLessThanOrEqual(LOCALIZE_PROFILES.xiaohongshu.maxChars);
    expect(r.styleNotes.some((n) => n.includes("小红书"))).toBe(true);
    expect(r.usedLlm).toBe(false);
  });

  it("知乎版:专业开头 + 保留结构", () => {
    const r = localizeContentRule(TITLE, MD, "zhihu");
    expect(r.text).toContain("先说结论");
    expect(r.text.length).toBeLessThanOrEqual(LOCALIZE_PROFILES.zhihu.maxChars);
  });

  it("领英版:职场商务开场", () => {
    const r = localizeContentRule(TITLE, MD, "linkedin");
    expect(r.text).toContain("行业观察");
    expect(r.styleNotes.some((n) => n.includes("职场"))).toBe(true);
  });

  it("微博版:带话题且 ≤140 字", () => {
    const r = localizeContentRule(TITLE, MD, "weibo");
    expect(r.text.length).toBeLessThanOrEqual(140);
    expect(r.tags.length).toBeGreaterThan(0);
  });

  it("LLM 不可用/失败回退规则", async () => {
    const r = await localizeContent(TITLE, MD, "xiaohongshu", new NoopLlm());
    expect(r.usedLlm).toBe(false);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("LLM 请求构造与解析", () => {
    const req = localizeLlmRequest(TITLE, MD, "zhihu");
    expect(req.platformId).toBe("zhihu");
    expect(parseLocalizeJson('{"text":"正文","tags":["#a"]}')?.text).toBe("正文");
    expect(parseLocalizeJson("bad")).toBeNull();
  });
});

describe("localize/hashtags — LOCALIZE-02 智能标签与话题", () => {
  it("领域推断", () => {
    expect(inferNiche("职场晋升指南", "面试 简历 老板")).toBe("职场");
    expect(inferNiche(TITLE, "AI 效率 工具")).toBe("效率");
  });

  it("规则话题建议带热度与来源", () => {
    const tags = suggestHashtagsRule(TITLE, "AI 效率 工具 内容 效率", 6);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(6);
    for (const t of tags) {
      expect(t.tag.startsWith("#")).toBe(true);
      expect(["high", "medium", "low"]).toContain(t.heat);
      expect(t.source).toBe("rule");
    }
  });

  it("LLM 失败回退规则", async () => {
    const r = await suggestHashtags(TITLE, "AI 效率", new NoopLlm());
    expect(r.usedLlm).toBe(false);
    expect(r.tags.length).toBeGreaterThan(0);
  });

  it("parseHashtagJson 解析", () => {
    expect(parseHashtagJson('["#效率", "职场"]')).toEqual(["#效率", "#职场"]);
    expect(parseHashtagJson("bad")).toEqual([]);
  });
});
