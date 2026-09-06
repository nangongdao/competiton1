/**
 * 计划任务 ai-auto-complete 动作 —— 核心契约验证。
 *
 * 验证:
 * - runAutoAgent 与计划任务语义兼容:输入草稿 markdown → 输出修复后 markdown + 摘要;
 * - 无 LLM 纯规则兜底仍可产出完整报告;
 * - 修复后内容可写回草稿(幂等:再次运行不再产生额外变化)。
 */
import { describe, it, expect } from "vitest";
import { runAutoAgent } from "../src/agent/agent.js";

const LONG_MD = `# 超长标题测试,这个标题特别特别长用来验证标题上限的截断行为是否正常工作

首段内容。这里讲一个效率方法,把一天切成若干九十分钟专注块。这段文字应该足够长,长到能够触发排版建议里的段落节奏问题与可读性问题,从而产生可自动修复的拆段建议。再多写一些字,让它超过两百个字的门槛,确保 readability 维度给出的超长文本块建议能够被派生为可执行修复动作,并且让自动修复轮次真正发生内容变化,验证整个 agent 修复链路闭环生效。

次段。这里讲一个方法,三步走。

> 引用:专注是天赋。

![示意图](https://images.example.com/a.png)
`;

describe("计划任务 ai-auto-complete 兼容性", () => {
  it("无 LLM 时运行并产出可写回的修复后 markdown", async () => {
    const result = await runAutoAgent(LONG_MD, {
      platformIds: ["wechat", "xiaohongshu"],
      autoFix: true,
      maxFixRounds: 3,
      enhance: true,
    });
    expect(result.ok).toBe(true);
    expect(result.markdown.length).toBeGreaterThan(0);
    const verifyStep = result.steps.find((s) => s.kind === "verify");
    expect(verifyStep?.kind === "verify" && typeof verifyStep.allPassed === "boolean").toBe(true);
  });

  it("修复写回后再次运行不再产生额外修复(幂等收敛)", async () => {
    const first = await runAutoAgent(LONG_MD, {
      platformIds: ["wechat", "xiaohongshu"],
      autoFix: true,
      maxFixRounds: 3,
      enhance: false,
    });
    // 第一次有修复(长段被拆分)。
    expect(first.appliedFixes.length).toBeGreaterThan(0);
    // 修复后的内容再次运行 → 不再产生新的内容变化。
    const second = await runAutoAgent(first.markdown, {
      platformIds: ["wechat", "xiaohongshu"],
      autoFix: true,
      maxFixRounds: 3,
      enhance: false,
    });
    expect(second.markdown).toBe(first.markdown);
  });
});
