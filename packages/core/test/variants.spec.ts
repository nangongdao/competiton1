import { describe, expect, it } from "vitest";
import { generateVariants, parseVariantList, VARIANT_PROMPT_VERSION } from "../src/assistant/variants.js";
import type { LlmAdapter, LlmRequest } from "../src/llm/types.js";

/** 可编程 LLM 适配器(测试用)。 */
class FakeLlm implements LlmAdapter {
  readonly id = "fake";
  readonly available = true;
  calls: LlmRequest[] = [];
  constructor(private readonly responder: (req: LlmRequest) => string) {}
  async run(req: LlmRequest): Promise<string> {
    this.calls.push(req);
    return this.responder(req);
  }
}

const INPUT = {
  platformId: "wechat",
  title: "原标题",
  contentText: "正文包含 5 个要点和具体数据。",
  titleMax: 30,
  summaryMax: 120,
};

describe("generateVariants — LLM 多方案生成", () => {
  it("LLM 可用时产出标题/摘要候选并标记 usedLlm", async () => {
    const llm = new FakeLlm((req) => {
      if (req.task === "title") return '["标题一：干货", "标题二：悬念", "标题三：数字亮点"]';
      return '["这是一段 AI 生成的摘要内容"]';
    });
    const result = await generateVariants(INPUT, llm, 3);
    expect(result.usedLlm).toBe(true);
    expect(result.titles.length).toBeGreaterThanOrEqual(1);
    expect(result.titles.some((t) => t.source === "llm")).toBe(true);
    expect(result.titles.some((t) => t.source === "original")).toBe(true); // 原标题始终可见
    expect(result.titles[0]!.model).toBe("fake");
    expect(result.titles[0]!.promptVersion).toBe(VARIANT_PROMPT_VERSION);
    expect(result.summaries.length).toBeGreaterThan(0);
    // LLM 请求携带约束。
    expect(llm.calls.length).toBe(2);
    expect(llm.calls[0]!.constraints?.["maxChars"]).toBe(30);
  });

  it("LLM 候选超过上限被过滤,但原文仍在", async () => {
    const llm = new FakeLlm(() => '["超长标题超过三十个字符就会被过滤掉的一个测试标题"]');
    const result = await generateVariants({ ...INPUT, titleMax: 10 }, llm, 3);
    expect(result.usedLlm).toBe(true);
    // 超限 LLM 候选被过滤;原文与规则候选仍在。
    expect(result.titles.some((t) => t.source === "llm")).toBe(false); // 超限 LLM 被过滤
    expect(result.titles.some((t) => t.source === "original")).toBe(true);
  });

  it("LLM 抛错时回退规则候选(不拖垮链路)", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("LLM 挂了");
    });
    const result = await generateVariants(INPUT, llm, 3);
    expect(result.usedLlm).toBe(false);
    expect(result.titles.length).toBeGreaterThan(0);
    expect(result.summaries.length).toBeGreaterThan(0);
  });

  it("parseVariantList 处理对象数组与空结果", () => {
    expect(parseVariantList('[{"text":"A"},{"text":"B"}]')).toEqual(["A", "B"]);
    expect(parseVariantList("")).toEqual([]);
    expect(parseVariantList("   ")).toEqual([]);
  });
});
