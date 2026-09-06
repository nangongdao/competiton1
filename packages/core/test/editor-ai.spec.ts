/**
 * v3 · AI 选区操作测试。
 *
 * 覆盖:
 * - runSelectionAi:LLM 不可用 → 原文回退(usedLlm:false);
 * - LLM 可用且输出正常 → 使用 LLM 输出;
 * - 输出为空 / 块级结构 / 与原文一致 → 防御性回退原文;
 * - LLM 抛错 → 回退原文并附 error;
 * - selectionAiRequest:各操作任务类型 / 温度 / 系统提示词;
 * - selectionOpToLlmTask / SELECTION_AI_OP_LABELS;
 * - isBlockishOutput:代码块 / 标题 / 列表 / 引用 / 表格检测。
 */
import { describe, expect, it } from "vitest";
import {
  runSelectionAi,
  runSelectionAiForPlatforms,
  selectionAiRequest,
  selectionOpToLlmTask,
  isBlockishOutput,
  mapBounded,
  platformStyleHint,
  SELECTION_AI_OP_LABELS,
  type SelectionAiOp,
} from "../src/editor-ai/editor-ai.js";
import type { LlmAdapter } from "../src/llm/types.js";

/** 构造一个可编程 LLM 假适配器。 */
function fakeLlm(impl: (input: string) => string | Promise<string>): LlmAdapter {
  return {
    id: "fake",
    available: true,
    async run(req) {
      return impl(req.input);
    },
  };
}

describe("runSelectionAi", () => {
  it("选区为空时直接返回空结果", async () => {
    const res = await runSelectionAi({ selected: "   ", op: "rewrite" }, fakeLlm((s) => s));
    expect(res.text).toBe("");
    expect(res.usedLlm).toBe(false);
    expect(res.error).toBe("选区为空");
  });

  it("LLM 不可用(undefined)时回退原文", async () => {
    const res = await runSelectionAi({ selected: "你好世界", op: "rewrite" });
    expect(res.text).toBe("你好世界");
    expect(res.usedLlm).toBe(false);
    expect(res.error).toBe("未配置 LLM");
  });

  it("LLM available=false 时回退原文", async () => {
    const noop: LlmAdapter = { id: "noop", available: false, async run(r) { return r.input; } };
    const res = await runSelectionAi({ selected: "原文", op: "polish" }, noop);
    expect(res.text).toBe("原文");
    expect(res.usedLlm).toBe(false);
  });

  it("LLM 输出正常时使用 LLM 输出", async () => {
    const res = await runSelectionAi({ selected: "这段文字需要改写", op: "rewrite" }, fakeLlm(() => "这段文字已被改写"));
    expect(res.text).toBe("这段文字已被改写");
    expect(res.usedLlm).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it("LLM 输出为空时回退原文", async () => {
    const res = await runSelectionAi({ selected: "原文内容", op: "rewrite" }, fakeLlm(() => "  \n  "));
    expect(res.text).toBe("原文内容");
    expect(res.usedLlm).toBe(false);
  });

  it("LLM 输出包含块级结构时回退原文(防破坏选区)", async () => {
    const res = await runSelectionAi({ selected: "原文", op: "rewrite" }, fakeLlm(() => "# 标题\n\n内容"));
    expect(res.text).toBe("原文");
    expect(res.usedLlm).toBe(false);
    expect(res.error).toContain("块级结构");
  });

  it("LLM 输出与原文一致时回退原文", async () => {
    const res = await runSelectionAi({ selected: "一模一样", op: "rewrite" }, fakeLlm((s) => s));
    expect(res.text).toBe("一模一样");
    expect(res.usedLlm).toBe(false);
  });

  it("LLM 抛错时回退原文并附 error", async () => {
    const bad: LlmAdapter = {
      id: "bad",
      available: true,
      async run() {
        throw new Error("网络超时");
      },
    };
    const res = await runSelectionAi({ selected: "原文", op: "expand" }, bad);
    expect(res.text).toBe("原文");
    expect(res.usedLlm).toBe(false);
    expect(res.error).toBe("网络超时");
  });

  it("保留 platformId 透传", async () => {
    const res = await runSelectionAi(
      { selected: "内容", op: "rewrite", platformId: "xiaohongshu" },
      fakeLlm(() => "新内容"),
    );
    expect(res.platformId).toBe("xiaohongshu");
  });
});

describe("selectionAiRequest", () => {
  it("rewrite 使用 rewrite 任务与平台上下文", () => {
    const req = selectionAiRequest({ selected: "文本", op: "rewrite", platformId: "zhihu", temperature: 0.5 });
    expect(req.task).toBe("rewrite");
    expect(req.platformId).toBe("zhihu");
    expect(req.temperature).toBe(0.5);
    expect(req.systemPrompt).toContain("风格改写");
  });

  it("summarize 使用 summary 任务", () => {
    const req = selectionAiRequest({ selected: "很长的一段内容", op: "summarize" });
    expect(req.task).toBe("summary");
  });

  it("translate 任务包含翻译系统提示词", () => {
    const zh = selectionAiRequest({ selected: "Hello world", op: "translate-en-zh" });
    expect(zh.systemPrompt).toContain("中文");
    const en = selectionAiRequest({ selected: "你好", op: "translate-zh-en" });
    expect(en.systemPrompt).toContain("英文");
  });

  it("continue 任务提示从结尾续写", () => {
    const req = selectionAiRequest({ selected: "开头内容", op: "continue" });
    expect(req.systemPrompt).toContain("续写");
  });

  it("polish 任务提示最小改动", () => {
    const req = selectionAiRequest({ selected: "内容", op: "polish" });
    expect(req.systemPrompt).toContain("润色");
  });
});

describe("selectionOpToLlmTask / labels", () => {
  it("映射到 LLM 任务类型", () => {
    expect(selectionOpToLlmTask("rewrite")).toBe("rewrite");
    expect(selectionOpToLlmTask("summarize")).toBe("summary");
    expect(selectionOpToLlmTask("translate-zh-en")).toBe("rewrite");
    expect(selectionOpToLlmTask("polish")).toBe("rewrite");
  });

  it("所有操作都有标签", () => {
    const ops: SelectionAiOp[] = ["rewrite", "expand", "continue", "summarize", "translate-zh-en", "translate-en-zh", "polish"];
    for (const op of ops) {
      expect(SELECTION_AI_OP_LABELS[op]).toBeTruthy();
    }
  });
});

describe("isBlockishOutput", () => {
  it("识别代码块", () => {
    expect(isBlockishOutput("```\ncode\n```")).toBe(true);
  });
  it("识别标题", () => {
    expect(isBlockishOutput("## 小标题")).toBe(true);
  });
  it("识别列表", () => {
    expect(isBlockishOutput("- 项目")).toBe(true);
    expect(isBlockishOutput("1. 项目")).toBe(true);
  });
  it("识别引用", () => {
    expect(isBlockishOutput("> 引用")).toBe(true);
  });
  it("识别表格", () => {
    expect(isBlockishOutput("| a | b |")).toBe(true);
  });
  it("纯文本段落通过", () => {
    expect(isBlockishOutput("这是一段普通的纯文本段落,可以安全应用。")).toBe(false);
  });
});

describe("runSelectionAiForPlatforms (EDIT-AI-04)", () => {
  it("多平台各自独立改写(有界并发)并返回差异提示", async () => {
    const platformLlm: LlmAdapter = {
      id: "platform-fake",
      available: true,
      async run(req) {
        return `${req.platformId}:${req.input}`;
      },
    };
    const res = await runSelectionAiForPlatforms(
      { selected: "你好世界", op: "rewrite", platforms: ["wechat", "xiaohongshu"] },
      platformLlm,
    );
    expect(res.items).toHaveLength(2);
    expect(res.items[0].platformId).toBe("wechat");
    expect(res.items[0].result.usedLlm).toBe(true);
    expect(res.items[0].result.text).toBe("wechat:你好世界");
    expect(res.items[1].result.usedLlm).toBe(true);
    expect(res.allUsedLlm).toBe(true);
    expect(res.hasDifference).toBe(true);
    expect(res.differenceHint).toContain("两平台");
  });

  it("LLM 不可用 → 全部平台回退原文且 allUsedLlm=false", async () => {
    const res = await runSelectionAiForPlatforms(
      { selected: "原文", op: "polish", platforms: ["wechat", "zhihu"] },
    );
    expect(res.items).toHaveLength(2);
    expect(res.allUsedLlm).toBe(false);
    expect(res.items.every((i) => i.result.text === "原文")).toBe(true);
  });

  it("单平台时差异提示为无需对比", async () => {
    const res = await runSelectionAiForPlatforms(
      { selected: "内容", op: "rewrite", platforms: ["wechat"] },
      fakeLlm((s) => s),
    );
    expect(res.hasDifference).toBe(false);
    expect(res.differenceHint).toContain("无需对比");
  });

  it("所有平台结果一致时提示无风格差异", async () => {
    const res = await runSelectionAiForPlatforms(
      { selected: "内容", op: "rewrite", platforms: ["wechat", "zhihu"] },
      fakeLlm((s) => `改写:${s}`),
    );
    // 两个平台同一输入 → 相同输出 → 无差异
    expect(res.items.every((i) => i.result.text === "改写:内容")).toBe(true);
    expect(res.hasDifference).toBe(false);
    expect(res.differenceHint).toContain("一致");
  });

  it("部分平台失败时标注 failed 平台并保留其原文", async () => {
    let calls = 0;
    const flaky: LlmAdapter = {
      id: "flaky",
      available: true,
      async run() {
        calls += 1;
        if (calls === 1) throw new Error("超时");
        return "成功改写";
      },
    };
    const res = await runSelectionAiForPlatforms(
      { selected: "原文", op: "rewrite", platforms: ["wechat", "zhihu"] },
      flaky,
    );
    expect(res.items[0].result.usedLlm).toBe(false);
    expect(res.items[0].result.text).toBe("原文");
    expect(res.items[1].result.usedLlm).toBe(true);
    expect(res.allUsedLlm).toBe(false);
  });
});

describe("mapBounded", () => {
  it("按最大并发执行并保持输入顺序", async () => {
    const order: number[] = [];
    const out = await mapBounded([1, 2, 3, 4], 2, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 5));
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8]);
    // 至少有两组并发(2 个 worker),顺序数组长度 = 4
    expect(order.length).toBe(4);
  });

  it("空输入直接返回空数组", async () => {
    const out = await mapBounded<number, number>([], 2, async (n) => n);
    expect(out).toEqual([]);
  });
});

describe("platformStyleHint", () => {
  it("一致时提示无差异", () => {
    expect(platformStyleHint("aaa", "aaa")).toContain("一致");
  });
  it("长度差异大时提示明显差异", () => {
    expect(platformStyleHint("短", "这是一段非常非常非常非常非常非常非常非常非常非常非常非常长的文本内容用于测试长度差异足够大")).toContain("明显");
  });
  it("长度接近但不同时提示措辞不同", () => {
    expect(platformStyleHint("abcdef", "abxdef")).toContain("接近");
  });
});
