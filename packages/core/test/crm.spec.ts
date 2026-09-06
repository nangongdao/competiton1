/**
 * v11 Part 2 · AI 智能客服与评论营销纯函数测试(CRM-01)。
 */
import { describe, expect, it } from "vitest";
import {
  analyzeCommentRule,
  analyzeComment,
  digestNegativeComments,
  parseCommentInsightJson,
} from "../src/crm/crm.js";
import { NoopLlm } from "../src/llm/noop-llm.js";

describe("crm — CRM-01 评论意图识别与情绪分析", () => {
  it("识别问价/求购为高意向", () => {
    const price = analyzeCommentRule("这个工具多少钱?");
    expect(price.intent).toBe("price-inquiry");
    expect(price.highIntent).toBe(true);
    expect(price.crmTags).toContain("high-intent");
    expect(price.suggestedAction).toBe("auto-reply");
    expect(price.autoReply).toBeTruthy();

    const buy = analyzeCommentRule("怎么买?求链接");
    expect(buy.intent).toBe("how-to-buy");
    expect(buy.highIntent).toBe(true);
  });

  it("识别好评并自动回复", () => {
    const praise = analyzeCommentRule("太棒了,学到了!");
    expect(praise.intent).toBe("praise");
    expect(praise.sentiment).toBe("positive");
    expect(praise.suggestedAction).toBe("auto-reply");
  });

  it("识别差评/退款为负面并提醒", () => {
    const bad = analyzeCommentRule("垃圾,根本没用");
    expect(bad.sentiment).toBe("negative");
    expect(bad.needsAttention).toBe(true);
    expect(bad.suggestedAction).toBe("notify");

    const urgent = analyzeCommentRule("我要退款!你们是骗子!");
    expect(urgent.sentiment).toBe("urgent");
    expect(urgent.needsAttention).toBe(true);
  });

  it("识别垃圾广告", () => {
    const spam = analyzeCommentRule("加微信:xxx,兼职日赚 500");
    expect(spam.intent).toBe("spam");
  });

  it("LLM 不可用回退规则", async () => {
    const r = await analyzeComment("这个多少钱?", new NoopLlm());
    expect(r.source).toBe("rule");
    expect(r.highIntent).toBe(true);
  });

  it("负面预警摘要", () => {
    const d = digestNegativeComments(["太棒了!", "垃圾产品,退款!", "一般般"]);
    expect(d.total).toBe(1);
    expect(d.alerts[0]!.sentiment).toBe("urgent");
  });

  it("parseCommentInsightJson 解析", () => {
    const parsed = parseCommentInsightJson('{"intent":"price-inquiry","sentiment":"neutral","autoReply":"私信您了"}');
    expect(parsed?.intent).toBe("price-inquiry");
    expect(parsed?.autoReply).toBe("私信您了");
    expect(parseCommentInsightJson("bad")).toBeNull();
  });
});
