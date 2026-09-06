/**
 * LLM 逐段风格改写 —— Agent「增强」正文级改写测试。
 *
 * 验证:
 * - findProseParagraphs:只识别纯文本散文段,跳过标题/列表/引用/代码/图片/表格;
 * - rewriteParagraphsWithLlm:LLM 可用时改写目标段、结构字节级不动、无 LLM 回退原文;
 * - 健壮性:输出带块级标记被拒绝、LLM 失败单段回退、改写从下往上回写行稳定;
 * - runAutoAgent 集成:开启增强 + LLM 时 paragraphRewrites 产生、正文变化、无 LLM 不产生。
 */
import { describe, it, expect, vi } from "vitest";
import { findProseParagraphs, rewriteParagraphsWithLlm } from "../src/agent/paragraph-rewrite.js";
import { runAutoAgent } from "../src/agent/agent.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";

const SAMPLE = `# 标题

这是第一段正文。讲一个效率方法,把一天切成若干个九十分钟的专注块,然后按优先级排序执行。这段文字足够长,应该能被识别为一个独立的散文段落。

## 小节标题

- 列表项一
- 列表项二

> 引用块内容,不应被改写。

这是第二段正文,同样是一段比较长的散文内容,讲的是时间管理的心得体会。要多写一些字,确保长度达到改写门槛,从而验证逐段风格改写只作用于纯文本段落。

\`\`\`js
const a = 1;
\`\`\`

![图片](https://example.com/a.png)

这是最后一段。
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

describe("findProseParagraphs", () => {
  it("只识别纯文本散文段,跳过块级结构", () => {
    const paras = findProseParagraphs(SAMPLE);
    // 3 个散文段:第一段 / 第二段 / 最后一段。
    expect(paras.length).toBe(3);
    expect(paras[0]!.text).toContain("九十分钟");
    expect(paras[1]!.text).toContain("时间管理");
    expect(paras[2]!.text).toBe("这是最后一段。");
  });

  it("空内容 / 纯结构内容不产出段落", () => {
    expect(findProseParagraphs("")).toEqual([]);
    expect(findProseParagraphs("# 只有标题\n\n- a\n- b\n")).toEqual([]);
  });
});

describe("rewriteParagraphsWithLlm", () => {
  it("LLM 可用时改写最长段落并保持结构字节级不动", async () => {
    const llm = makeLlm("【改写后的第一段】讲一个更生动的时间管理方法,把一天切分成多个专注块,按优先级执行。");
    const result = await rewriteParagraphsWithLlm(SAMPLE, { platformId: "wechat", llm, maxParagraphs: 1 });
    expect(result.rewritten.length).toBe(1);
    expect(result.markdown).not.toBe(SAMPLE);
    // 标题 / 列表 / 引用 / 代码块 / 图片均保持原样。
    expect(result.markdown).toContain("# 标题");
    expect(result.markdown).toContain("- 列表项一");
    expect(result.markdown).toContain("> 引用块内容,不应被改写。");
    expect(result.markdown).toContain("```js");
    expect(result.markdown).toContain("![图片](https://example.com/a.png)");
    // 改写后的文本确实出现在文档中。
    expect(result.markdown).toContain("【改写后的第一段】");
  });

  it("无 LLM 时直接返回原文", async () => {
    const result = await rewriteParagraphsWithLlm(SAMPLE, {
      platformId: "wechat",
      llm: { id: "noop", available: false, run: async (r) => r.input },
      maxParagraphs: 3,
    });
    expect(result.markdown).toBe(SAMPLE);
    expect(result.rewritten).toEqual([]);
  });

  it("输出含块级标记时拒绝应用,保持原文", async () => {
    const llm = makeLlm("# 不该出现的标题\n\n> 引用");
    const result = await rewriteParagraphsWithLlm(SAMPLE, { platformId: "wechat", llm, maxParagraphs: 1 });
    expect(result.rewritten).toEqual([]);
    expect(result.markdown).toBe(SAMPLE);
  });

  it("LLM 失败时单段回退,不影响整体", async () => {
    const bad = new OpenAiCompatLlm({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch,
    });
    const result = await rewriteParagraphsWithLlm(SAMPLE, { platformId: "wechat", llm: bad });
    expect(result.rewritten).toEqual([]);
    expect(result.markdown).toBe(SAMPLE);
  });

  it("改写输出与原文一致时不算改写", async () => {
    // 返回与输入完全一致的 LLM(逐段回声),任何段都不算改写。
    const echo: Parameters<typeof makeLlm>[0] = "";
    void echo;
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
        const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
        // 提取"段落:\n"之后的原文作为返回(逐字返回输入)。
        const input = user.split("段落:\n")[1] ?? "";
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: input } }] }),
        };
      }) as unknown as typeof fetch,
    });
    const result = await rewriteParagraphsWithLlm(SAMPLE, { platformId: "wechat", llm, maxParagraphs: 1 });
    expect(result.rewritten).toEqual([]);
    expect(result.markdown).toBe(SAMPLE);
  });
});

describe("runAutoAgent 集成 —— 逐段风格改写", () => {
  const LONG_MD = `# 超长标题测试,这个标题特别特别长用来验证标题上限的截断行为是否正常工作

首段内容。这里讲一个效率方法,把一天切成若干九十分钟专注块。这段文字应该足够长,长到能够触发排版建议里的段落节奏问题与可读性问题,从而产生可自动修复的拆段建议。再多写一些字,让它超过两百个字的门槛,确保 readability 维度给出的超长文本块建议能够被派生为可执行修复动作。

次段。这里讲一个方法,三步走。

![示意图](https://images.example.com/a.png)
`;

  it("LLM 可用且开启增强时,产出 paragraphRewrites 且正文变化", async () => {
    const llm = makeLlm('["标题A","标题B","标题C"]');
    const result = await runAutoAgent(LONG_MD, {
      platformIds: ["wechat", "xiaohongshu"],
      llm,
      enhance: true,
      autoFix: false,
    });
    // LLM 标题候选已生成。
    expect(result.usedLlm).toBe(true);
    const enhance = result.steps.find((s) => s.kind === "enhance");
    expect(enhance?.kind === "enhance" && enhance.paragraphRewrites).toBeTruthy();
    const anyRewrite = Object.values(result.paragraphRewrites).some((list) => list.length > 0);
    // LONG_MD 正文段足够长,LLM 可用时应产生逐段改写。
    expect(anyRewrite).toBe(true);
    expect(result.markdown).not.toBe(LONG_MD);
  });

  it("无 LLM 时不产生逐段改写(纯规则兜底)", async () => {
    const result = await runAutoAgent(LONG_MD, {
      platformIds: ["wechat"],
      enhance: true,
      autoFix: false,
    });
    expect(result.usedLlm).toBe(false);
    expect(Object.keys(result.paragraphRewrites).length).toBe(0);
  });

  it("rewriteParagraphs=false 时关闭逐段改写", async () => {
    const llm = makeLlm('["标题A","标题B","标题C"]');
    const result = await runAutoAgent(LONG_MD, {
      platformIds: ["wechat"],
      llm,
      enhance: true,
      rewriteParagraphs: false,
      autoFix: false,
    });
    expect(result.usedLlm).toBe(true);
    expect(Object.keys(result.paragraphRewrites).length).toBe(0);
    // 无 fix 时正文保持不变(未触发任何正文级改写)。
    expect(result.markdown).toBe(LONG_MD);
  });
});
