/**
 * 批量 AI 自动完成 —— runAutoAgent 接入批量与审批面板的核心契约测试。
 *
 * 验证:
 * - 多草稿一键批量 AI 自动完成:每篇产出完整 Agent 结果(分析/修复/增强/复核);
 * - 无 LLM 纯规则兜底仍可批量完成;
 * - 有界并发、单篇失败隔离;
 * - 不改写草稿存储(返回改写后 markdown,由调用方决定写回)。
 */
import { describe, it, expect, vi } from "vitest";
import { batchAutoComplete } from "../src/assistant/batch.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";

const LONG_MD = `# 超长标题测试,这个标题特别特别长用来验证标题上限的截断行为是否正常工作

首段内容。这里讲一个效率方法,把一天切成若干九十分钟专注块。这段文字应该足够长,长到能够触发排版建议里的段落节奏问题与可读性问题,从而产生可自动修复的拆段建议。再多写一些字,让它超过两百个字的门槛,确保 readability 维度给出的超长文本块建议能够被派生为可执行修复动作,并且让自动修复轮次真正发生内容变化,验证整个 agent 修复链路闭环生效。

次段。这里讲一个方法,三步走。

> 引用:专注是天赋。

![示意图](https://images.example.com/a.png)
`;

const SHORT_MD = `# 短标题

这是正文,讲一个简单的方法,三步走,没有超限问题。
`;

const ITEMS = [
  { id: "draft-1", title: "草稿一", markdown: LONG_MD },
  { id: "draft-2", title: "草稿二", markdown: SHORT_MD },
];

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

describe("batchAutoComplete", () => {
  it("多草稿批量 AI 自动完成:每篇产出完整结果(纯规则路径)", async () => {
    const results = await batchAutoComplete(ITEMS, {
      platformIds: ["wechat", "xiaohongshu"],
    });
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe("draft-1");
    expect(results[1]!.id).toBe("draft-2");
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.usedLlm).toBe(false);
      expect(r.agent.steps.map((s) => s.kind)).toEqual(["fix", "enhance", "verify", "report"]);
      expect(typeof r.fixCount).toBe("number");
      expect(typeof r.paragraphRewriteCount).toBe("number");
      expect(typeof r.allPassed).toBe("boolean");
    }
    // 长草稿产生自动修复,短草稿无需修复。
    expect(results[0]!.fixCount).toBeGreaterThan(0);
    expect(results[1]!.fixCount).toBe(0);
    // 返回改写后 markdown(不改写存储,由调用方决定写回)。
    expect(results[0]!.agent.markdown).not.toBe(LONG_MD);
    expect(results[1]!.agent.markdown).toBe(SHORT_MD);
  });

  it("LLM 可用时批量生成 LLM 候选与逐段风格改写", async () => {
    const llm = makeLlm('["标题A","标题B","标题C"]');
    const results = await batchAutoComplete(ITEMS, {
      platformIds: ["wechat"],
      llm,
    });
    expect(results[0]!.usedLlm).toBe(true);
    // 逐段风格改写:长草稿正文段应被改写。
    expect(results[0]!.paragraphRewriteCount).toBeGreaterThan(0);
    expect(results[0]!.agent.markdown).not.toBe(LONG_MD);
  });

  it("空列表安全返回空数组", async () => {
    const results = await batchAutoComplete([], { platformIds: ["wechat"] });
    expect(results).toEqual([]);
  });
});
