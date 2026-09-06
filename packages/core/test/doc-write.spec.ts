/**
 * 整篇 AI 写作增强 —— 纯函数测试(v7 Phase 4 AI-WRITE-01)。
 */
import { describe, expect, it } from "vitest";
import {
  runDocWrite,
  ruleDocWrite,
  docWriteRequest,
  plainParagraphs,
  isBlockishOutputDoc,
  DOC_WRITE_OP_LABELS,
} from "../src/doc-write/doc-write.js";
import type { LlmAdapter } from "../src/llm/types.js";

describe("plainParagraphs — 纯文本段落提取", () => {
  it("只取非块级段落", () => {
    const md = "# 标题\n\n正文段落\n\n- 列表\n\n> 引用\n\n```\ncode\n```";
    const ps = plainParagraphs(md);
    expect(ps).toContain("正文段落");
    expect(ps).not.toContain("- 列表");
    expect(ps).not.toContain("> 引用");
  });
});

describe("isBlockishOutputDoc — 块级结构检测", () => {
  it("纯文本通过", () => {
    expect(isBlockishOutputDoc("一段普通文本")).toBe(false);
  });
  it("标题/列表/引用被拒绝", () => {
    expect(isBlockishOutputDoc("# 标题")).toBe(true);
    expect(isBlockishOutputDoc("- 列表")).toBe(true);
    expect(isBlockishOutputDoc("> 引用")).toBe(true);
  });
});

describe("docWriteRequest — 请求构造", () => {
  it("polish 走 paragraph-rewrite 任务", () => {
    const req = docWriteRequest({ markdown: "# t\n\n正文", op: "polish-doc" });
    expect(req.task).toBe("paragraph-rewrite");
  });
  it("summarize 走 summary 任务", () => {
    const req = docWriteRequest({ markdown: "正文", op: "summarize-doc" });
    expect(req.task).toBe("summary");
  });
});

describe("ruleDocWrite — 规则兜底", () => {
  it("polish/expand 不可用时原样返回", () => {
    expect(ruleDocWrite({ markdown: "# t\n\n正文", op: "polish-doc" })).toBe("# t\n\n正文");
    expect(ruleDocWrite({ markdown: "# t\n\n正文", op: "expand-doc" })).toBe("# t\n\n正文");
  });
  it("continue 基于末段生成总结收尾", () => {
    const out = ruleDocWrite({ markdown: "# t\n\n今天学习了性能优化。", op: "continue-doc" });
    expect(out).toContain("总的来说");
  });
  it("summarize 取首段前 80 字", () => {
    const out = ruleDocWrite({ markdown: "# t\n\n这是一段很长的正文内容用来测试摘要。", op: "summarize-doc" });
    expect(out).toContain("这是一段很长的正文");
  });
});

describe("runDocWrite — 整篇 AI 写作", () => {
  it("LLM 不可用时回退规则", async () => {
    const r = await runDocWrite({ markdown: "# t\n\n正文", op: "continue-doc" });
    expect(r.usedLlm).toBe(false);
    expect(r.changed).toBe(true);
  });
  it("LLM 可用时使用 LLM 输出", async () => {
    const llm: LlmAdapter = {
      id: "test",
      available: true,
      async run() {
        return "润色后的完整 Markdown 文档";
      },
    };
    const r = await runDocWrite({ markdown: "# t\n\n正文", op: "polish-doc" }, llm);
    expect(r.usedLlm).toBe(true);
    expect(r.text).toBe("润色后的完整 Markdown 文档");
  });
  it("summarize 收到块级输出时回退规则", async () => {
    const llm: LlmAdapter = {
      id: "test",
      available: true,
      async run() {
        return "# 不该出现标题";
      },
    };
    const r = await runDocWrite({ markdown: "# t\n\n正文", op: "summarize-doc" }, llm);
    expect(r.usedLlm).toBe(false);
  });
  it("LLM 抛出异常时回退规则并记录错误", async () => {
    const llm: LlmAdapter = {
      id: "test",
      available: true,
      async run() {
        throw new Error("network down");
      },
    };
    const r = await runDocWrite({ markdown: "# t\n\n正文", op: "continue-doc" }, llm);
    expect(r.usedLlm).toBe(false);
    expect(r.error).toContain("network down");
  });
  it("动作标签存在", () => {
    expect(DOC_WRITE_OP_LABELS["polish-doc"]).toBe("整篇润色");
    expect(DOC_WRITE_OP_LABELS["summarize-doc"]).toBe("生成摘要");
  });
});
