/**
 * v11 Part 2 · AI 内容一键裂变纯函数测试(FISSION-01/02/03)。
 */
import { describe, expect, it } from "vitest";
import {
  fissionLongContent,
  fissionLongContentWithLlm,
  plainTextOf,
  deriveHashTags,
  ruleXiaohongshuDraft,
  ruleWeiboFlash,
  ruleDouyinScript,
  parseFissionJson,
} from "../src/fission/fission.js";
import {
  expandShortContent,
  expandShortContentWithLlm,
  deriveTopicSuggestions,
  generateTopicSuggestions,
  parseExpandJson,
  parseTopicSuggestions,
} from "../src/fission/expand.js";
import {
  rewriteVariantsRule,
  generateRewriteVariants,
  similarityOf,
  rewriteWithSynonyms,
  parseRewriteVariants,
} from "../src/fission/variants.js";
import { NoopLlm } from "../src/llm/noop-llm.js";

const TITLE = "如何用 AI 提升内容团队 10 倍产出效率";
const MD = `# 如何用 AI 提升内容团队 10 倍产出效率

## 为什么内容团队需要 AI
传统内容生产链路长、重复劳动多。

## 三个核心方法
第一,用 AI 做选题与大纲;
第二,用 AI 做多平台改写;
第三,用 AI 做发布后复盘。

## 总结
AI 不是替代人,而是放大人的效率。`;

describe("fission — FISSION-01 长内容一键拆解", () => {
  it("规则版拆出三平台(小红书/微博/抖音)", () => {
    const r = fissionLongContent(TITLE, MD, undefined, { useLlm: false });
    expect(r.pieces.map((p) => p.target)).toEqual(["xiaohongshu", "weibo", "douyin"]);
    for (const p of r.pieces) expect(p.usedLlm).toBe(false);
    const xhs = r.pieces[0]!;
    expect(xhs.text.length).toBeGreaterThan(10);
    expect(xhs.text.length).toBeLessThanOrEqual(1000);
    const wb = r.pieces[1]!;
    expect(wb.text.length).toBeLessThanOrEqual(140);
    const dy = r.pieces[2]!;
    expect(dy.text.length).toBeLessThanOrEqual(400);
    expect(dy.text).toContain("开场钩子");
  });

  it("plainTextOf 去除 Markdown 标记", () => {
    const t = plainTextOf("# 标题\n**加粗** 和 [链接](https://a.b)");
    expect(t).not.toContain("#");
    expect(t).not.toContain("**");
    expect(t).not.toContain("](");
  });

  it("话题标签派生", () => {
    const tags = deriveHashTags(TITLE, "AI 效率 工具 效率 内容", 4);
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(tags.length).toBeLessThanOrEqual(4);
  });

  it("LLM 不可用时降级规则版(fissionLongContentWithLlm)", async () => {
    const r = await fissionLongContentWithLlm(TITLE, MD, undefined, { useLlm: false });
    expect(r.pieces.every((p) => p.usedLlm === false)).toBe(true);
  });

  it("LLM 为空/Noop 时回退规则", async () => {
    const r = await fissionLongContentWithLlm(TITLE, MD, new NoopLlm(), { useLlm: true });
    expect(r.pieces.every((p) => p.usedLlm === false)).toBe(true);
  });

  it("parseFissionJson 宽松解析", () => {
    const parsed = parseFissionJson('{"xiaohongshu":{"text":"种草","tags":["#a"]},"weibo":{"text":"快讯"}}');
    expect(parsed?.xiaohongshu?.text).toBe("种草");
    expect(parsed?.weibo?.text).toBe("快讯");
    expect(parseFissionJson("not json")).toBeNull();
  });

  it("规则拆解平台字数合规", () => {
    const xhs = ruleXiaohongshuDraft(TITLE, MD, { maxChars: 1000 });
    expect(xhs.text.length).toBeLessThanOrEqual(1000);
    const wb = ruleWeiboFlash(TITLE, MD, { maxChars: 140 });
    expect(wb.text.length).toBeLessThanOrEqual(140);
    expect(wb.text).toContain("#");
    const dy = ruleDouyinScript(TITLE, MD, { maxChars: 400 });
    expect(dy.text.length).toBeLessThanOrEqual(400);
  });
});

describe("fission/expand — FISSION-02 短内容扩写与热点选题", () => {
  it("规则版扩写出结构化骨架", () => {
    const r = expandShortContent("AI 正在改变内容创作的方式", { genre: "blog" });
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.outline).toContain("## ");
    expect(r.intro.length).toBeGreaterThan(10);
    expect(r.usedLlm).toBe(false);
  });

  it("LLM 增强失败回退规则", async () => {
    const r = await expandShortContentWithLlm("一句话扩写", new NoopLlm(), { useLlm: true });
    expect(r.usedLlm).toBe(false);
    expect(r.title.length).toBeGreaterThan(0);
  });

  it("parseExpandJson 容错", () => {
    expect(parseExpandJson('{"title":"T","outline":"## A"}')?.title).toBe("T");
    expect(parseExpandJson("bad")).toBeNull();
  });

  it("规则选题结合账号定位", () => {
    const hots = ["AI 大模型新进展", "效率工具推荐"];
    const topics = deriveTopicSuggestions(hots, { niche: "效率工具" });
    expect(topics.length).toBe(2);
    expect(topics[0]!.outline.length).toBeGreaterThanOrEqual(3);
    expect(topics[0]!.source).toBe("rule");
  });

  it("LLM 选题失败回退规则", async () => {
    const topics = await generateTopicSuggestions(["热点A"], { niche: "职场" }, new NoopLlm());
    expect(topics.length).toBe(1);
    expect(topics[0]!.source).toBe("rule");
  });

  it("parseTopicSuggestions 解析", () => {
    const parsed = parseTopicSuggestions('[{"title":"T","reason":"R","outline":["a","b"]}]');
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.title).toBe("T");
    expect(parseTopicSuggestions("nope")).toEqual([]);
  });
});

describe("fission/variants — FISSION-03 多版本同义改写", () => {
  const SRC = "这个工具真的很好用,能显著提高内容团队的效率,帮助我们快速解决很多问题。";

  it("规则版生成多版本且不改变核心信息", () => {
    const r = rewriteVariantsRule(SRC, { count: 3, seed: 1 });
    expect(r.variants.length).toBe(3);
    for (const v of r.variants) {
      expect(v.source).toBe("rule");
      expect(v.text.length).toBeGreaterThan(0);
      expect(v.similarityToSource).toBeGreaterThan(0);
    }
  });

  it("相似度评估:相同文本 1,完全不同接近 0", () => {
    expect(similarityOf("你好世界", "你好世界")).toBe(1);
    const low = similarityOf("今天天气很好", "量子计算原理详解");
    expect(low).toBeLessThan(0.3);
  });

  it("同义替换不丢失原文语义", () => {
    const out = rewriteWithSynonyms("这个方法很重要,能解决很多问题");
    expect(out.length).toBeGreaterThan(5);
    // 核心词被替换为同义词,语义保留但表述不同。
    expect(out).not.toEqual("这个方法很重要,能解决很多问题");
    expect(out).toMatch(/这个/);
  });

  it("LLM 失败回退规则", async () => {
    const r = await generateRewriteVariants(SRC, new NoopLlm(), { count: 2, useLlm: true });
    expect(r.variants.length).toBe(2);
    expect(r.variants[0]!.source).toBe("rule");
  });

  it("parseRewriteVariants 解析字符串/对象", () => {
    const parsed = parseRewriteVariants('["版本一",{"text":"版本二"}]');
    expect(parsed).toEqual(["版本一", "版本二"]);
    expect(parseRewriteVariants("bad")).toEqual([]);
  });
});
