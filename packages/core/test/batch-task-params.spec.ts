/**
 * Phase D AI-INSIGHT-02 —— 批量改写任务级参数透传测试。
 *
 * 验证 batchAutoComplete 会把 temperature / maxTokens 透传到
 * 段落改写 LLM 请求(OpenAiCompatLlm 在 run 中读取 req.temperature / req.maxTokens)。
 */
import { describe, it, expect, vi } from "vitest";
import { batchAutoComplete } from "../src/assistant/batch.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";

const LONG_MD = `# 标题

这是一段足够长的正文,用来触发 LLM 逐段风格改写。这里讲一个效率方法,把一天切成若干个九十分钟专注块,每块只做一件事,做完记录复盘。这段文字要超过六十个字符,这样才能被识别为值得改写的散文段落,从而验证任务级参数是否被透传到真实的 LLM 请求中。

次段,短一些,但也是散文。它可能不会被选中改写,因为优先级选择最长的段落。
`;

function makeSpyLlm() {
  const calls: Array<{ temperature?: number; maxTokens?: number }> = [];
  const llm = new OpenAiCompatLlm({
    baseUrl: "https://x/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: vi.fn(async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
        temperature?: number;
        max_tokens?: number;
      };
      calls.push({ temperature: body.temperature, maxTokens: body.max_tokens });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "改写后的段落文本,足够长,用来替换原文。" } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  return { llm, calls };
}

describe("AI-INSIGHT-02 批量改写任务级参数", () => {
  it("透传 temperature / maxTokens 到段落改写请求", async () => {
    const { llm, calls } = makeSpyLlm();
    const results = await batchAutoComplete(
      [{ id: "d1", title: "草稿", markdown: LONG_MD }],
      { platformIds: ["wechat"], llm, temperature: 0.3, maxTokens: 512 },
    );
    expect(results[0]!.usedLlm).toBe(true);
    expect(results[0]!.paragraphRewriteCount).toBeGreaterThan(0);
    // 至少有一次请求带上了任务级参数(段落改写请求)。
    expect(calls.some((c) => c.temperature === 0.3 && c.maxTokens === 512)).toBe(true);
  });

  it("未传任务级参数时保持默认", async () => {
    const { llm, calls } = makeSpyLlm();
    await batchAutoComplete(
      [{ id: "d1", title: "草稿", markdown: LONG_MD }],
      { platformIds: ["wechat"], llm },
    );
    expect(calls.length).toBeGreaterThan(0);
    // 默认温度 0.7,最大 token 1024。
    expect(calls[0]!.temperature).toBe(0.7);
    expect(calls[0]!.maxTokens).toBe(1024);
  });
});
