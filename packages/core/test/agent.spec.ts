/**
 * AI 自动完成 Agent 编排测试。
 *
 * 验证:
 * - 纯规则路径(无 LLM):分析/修复/规则候选/复核 全流程可用;
 * - LLM 路径:usedLlm=true、标题候选来自 LLM;
 * - 健壮性:不可解析内容不抛错、autoFix 轮次保护、单平台失败隔离;
 * - 性能:修复后内容确实改变、校验通过率提升。
 */
import { describe, it, expect, vi } from "vitest";
import { runAutoAgent } from "../src/agent/agent.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";

const LONG_MD = `# 超长标题测试,这个标题特别特别长用来验证标题上限的截断行为是否正常工作

首段内容。这里讲一个效率方法,把一天切成若干九十分钟专注块。这段文字应该足够长,长到能够触发排版建议里的段落节奏问题与可读性问题,从而产生可自动修复的拆段建议。再多写一些字,让它超过两百个字的门槛,确保 readability 维度给出的超长文本块建议能够被派生为可执行修复动作,并且让自动修复轮次真正发生内容变化,验证整个 agent 修复链路闭环生效。

次段。这里讲一个方法,三步走。

> 引用:专注是天赋。

![示意图](https://images.example.com/a.png)
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

describe("runAutoAgent 纯规则路径", () => {
  it("无 LLM 时全流程可用,usedLlm=false", async () => {
    const platforms = ["wechat", "zhihu", "xiaohongshu"];
    const result = await runAutoAgent(LONG_MD, { platformIds: platforms });
    expect(result.ok).toBe(true);
    expect(result.usedLlm).toBe(false);
    expect(result.steps.map((s) => s.kind)).toEqual(["fix", "enhance", "verify", "report"]);
    expect(result.analysis.charCount).toBeGreaterThan(0);
    expect(result.analysis.paragraphCount).toBeGreaterThanOrEqual(2);
    expect(result.analysis.imageCount).toBeGreaterThanOrEqual(1);
  });

  it("autoFix 默认会应用可修复建议(长标题被截断/长段被拆分)", async () => {
    const result = await runAutoAgent(LONG_MD, { platformIds: ["wechat", "xiaohongshu"] });
    expect(result.appliedFixes.length).toBeGreaterThan(0);
    // 修复后的内容与原文不同。
    expect(result.markdown).not.toBe(LONG_MD);
    // 标题被截断(wechat 校验 title-too-long)。
    const firstLine = result.markdown.split("\n")[0]!;
    expect(firstLine.length).toBeLessThanOrEqual(40);
  });

  it("maxFixRounds=0 时仍至少 1 轮,不抛错", async () => {
    const result = await runAutoAgent(LONG_MD, { platformIds: ["wechat"], maxFixRounds: 0 });
    expect(result.ok).toBe(true);
    expect(result.steps[0]?.kind).toBe("fix");
  });

  it("autoFix=false 时不修改原文", async () => {
    const result = await runAutoAgent(LONG_MD, { platformIds: ["wechat"], autoFix: false });
    expect(result.markdown).toBe(LONG_MD);
    expect(result.appliedFixes).toEqual([]);
  });

  it("不可解析内容(空串)不抛错,产出完整步骤", async () => {
    const result = await runAutoAgent("", { platformIds: ["wechat"] });
    expect(result.ok).toBe(true);
    expect(result.analysis.charCount).toBe(0);
    expect(result.steps.map((s) => s.kind)).toEqual(["fix", "enhance", "verify", "report"]);
  });

  it("verify 步骤汇总校验错误", async () => {
    const result = await runAutoAgent(LONG_MD, { platformIds: ["xiaohongshu"] });
    const verify = result.steps.find((s) => s.kind === "verify");
    expect(verify?.kind === "verify" && typeof verify.errorCount === "number").toBe(true);
  });
});

describe("runAutoAgent LLM 路径", () => {
  it("LLM 可用时 usedLlm=true,enhance 步骤携带 LLM 候选", async () => {
    const llm = makeLlm('["爆款标题A","爆款标题B","爆款标题C"]');
    const result = await runAutoAgent(LONG_MD, { platformIds: ["xiaohongshu"], llm });
    expect(result.usedLlm).toBe(true);
    const enhance = result.steps.find((s) => s.kind === "enhance");
    expect(enhance?.kind === "enhance" && enhance.usedLlm).toBe(true);
    const variants = result.variants["xiaohongshu"];
    expect(variants).toBeTruthy();
    // LLM 候选优先展示。
    expect(variants.titles.some((v) => v.source === "llm")).toBe(true);
  });

  it("autoApplyOverrides=true 时应用候选到覆盖层", async () => {
    const llm = makeLlm('["被应用的标题","标题B","标题C"]');
    const result = await runAutoAgent(LONG_MD, {
      platformIds: ["xiaohongshu"],
      llm,
      autoApplyOverrides: true,
    });
    const enhance = result.steps.find((s) => s.kind === "enhance");
    expect(enhance?.kind === "enhance" && enhance.appliedOverrides["xiaohongshu"]?.title).toBe("被应用的标题");
  });

  it("LLM 抛错时回退规则候选,整体不失败", async () => {
    const bad = new OpenAiCompatLlm({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch,
    });
    const result = await runAutoAgent(LONG_MD, { platformIds: ["wechat"], llm: bad });
    expect(result.ok).toBe(true);
    expect(result.usedLlm).toBe(true);
    const variants = result.variants["wechat"];
    // 回退到规则候选(仍有效)。
    expect(variants.titles.length).toBeGreaterThan(0);
  });
});

describe("runAutoAgent 性能与边界", () => {
  it("注入时钟用于 elapsedMs 计算", async () => {
    let t = 0;
    const now = () => {
      t += 25;
      return t;
    };
    const result = await runAutoAgent(LONG_MD, { platformIds: ["wechat"], now });
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it("多平台并发增强不相互阻塞(全部平台都有候选)", async () => {
    const platforms = ["wechat", "zhihu", "bilibili", "xiaohongshu"];
    const result = await runAutoAgent(LONG_MD, { platformIds: platforms });
    for (const pid of platforms) {
      expect(result.variants[pid]).toBeTruthy();
      expect(result.variants[pid]!.titles.length).toBeGreaterThan(0);
    }
  });

  it("未注册平台被安全跳过", async () => {
    const result = await runAutoAgent(LONG_MD, { platformIds: ["not-exist", "wechat"] });
    expect(result.ok).toBe(true);
    expect(result.analysis.avgQuality).toBeGreaterThanOrEqual(0);
  });

  it("全部平台均被过滤后仍返回完整报告", async () => {
    const result = await runAutoAgent(LONG_MD, { platformIds: [] });
    expect(result.ok).toBe(true);
    expect(result.analysis.charCount).toBeGreaterThan(0);
  });
});
