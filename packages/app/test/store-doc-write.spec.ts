/**
 * v7 Phase 4 store 行为测试 —— 整篇 AI 写作 + 片段插入。
 *
 * 验证:
 * - runDocWrite:空内容不处理;LLM 不可用时规则兜底;结果写入 docWriteResult;
 * - insertSnippet:在光标处插入片段并更新 markdown。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/state/store.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDocWrite — 整篇 AI 写作 store", () => {
  it("空内容直接返回不执行", async () => {
    useStore.setState({ markdown: "", llm: { baseUrl: "", apiKey: "", model: "" } });
    const r = await useStore.getState().runDocWrite("polish-doc");
    expect(r.changed).toBe(false);
    expect(useStore.getState().docWriteBusy).toBe(false);
  });

  it("LLM 不可用时规则兜底且结果可查", async () => {
    useStore.setState({
      markdown: "# 标题\n\n今天学习了性能优化技巧。",
      llm: { baseUrl: "", apiKey: "", model: "" },
      docWriteResult: null,
    });
    const r = await useStore.getState().runDocWrite("continue-doc");
    expect(r.usedLlm).toBe(false);
    expect(useStore.getState().docWriteResult).not.toBeNull();
    // 续写追加了内容。
    expect(useStore.getState().markdown).toContain("总的来说");
  });
});

describe("insertSnippet — 片段插入 store", () => {
  it("在光标处插入片段", async () => {
    useStore.setState({ markdown: "hello world" });
    document.body.innerHTML = '<textarea id="t">hello world</textarea>';
    const area = document.getElementById("t") as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(5, 5);
    // activeElement 需要真正聚焦。
    vi.spyOn(document, "activeElement", "get").mockReturnValue(area);
    await useStore.getState().insertSnippet("`{cursor}`");
    await new Promise((r) => setTimeout(r, 20));
    expect(useStore.getState().markdown).toContain("hello`");
  });
});
