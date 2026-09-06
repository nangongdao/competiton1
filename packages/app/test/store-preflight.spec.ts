/**
 * 发布前健康检查 store 行为测试。
 *
 * 验证:
 * - runPreflight 在已选平台时生成报告并复位 computing;
 * - 未选平台时清空报告;
 * - 报告 ready 反映内容健康度。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore, type AppState } from "../src/state/store.js";

describe("preflight store 行为", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      markdown: "",
      selectedPlatforms: [],
      preflightReport: null,
      preflightComputing: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("未选平台时清空报告且不计算", () => {
    useStore.setState({ selectedPlatforms: [] });
    useStore.getState().runPreflight();
    expect(useStore.getState().preflightReport).toBeNull();
    expect(useStore.getState().preflightComputing).toBe(false);
  });

  it("已选平台时生成报告并复位 computing", () => {
    useStore.setState({
      markdown: "# 标题\n\n这是一段足够长的正文内容。".repeat(30),
      selectedPlatforms: ["wechat"],
    });
    useStore.getState().runPreflight();
    expect(useStore.getState().preflightComputing).toBe(true);
    vi.runAllTimers();
    const state = useStore.getState();
    expect(state.preflightComputing).toBe(false);
    expect(state.preflightReport).not.toBeNull();
    expect(state.preflightReport!.ready).toBe(true);
  });

  it("空内容报告 ready=false", () => {
    useStore.setState({
      markdown: "",
      selectedPlatforms: ["wechat"],
    });
    useStore.getState().runPreflight();
    vi.runAllTimers();
    const report = useStore.getState().preflightReport;
    expect(report).not.toBeNull();
    expect(report!.ready).toBe(false);
    expect(report!.counts.errors).toBeGreaterThanOrEqual(1);
  });

  it("内容变化后重新检查会更新报告", () => {
    useStore.setState({
      markdown: "# 标题\n\n这是一段足够长的正文内容。".repeat(30),
      selectedPlatforms: ["wechat"],
    });
    useStore.getState().runPreflight();
    vi.runAllTimers();
    const first = useStore.getState().preflightReport;
    expect(first!.ready).toBe(true);

    useStore.setState({ markdown: "" });
    useStore.getState().runPreflight();
    vi.runAllTimers();
    const second = useStore.getState().preflightReport;
    expect(second!.ready).toBe(false);
  });
});

describe("editorDirty / flushDraft — 创作工作流", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      markdown: "",
      editorDirty: false,
      currentDraftId: null,
      drafts: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setMarkdown 标记 editorDirty", () => {
    useStore.getState().setMarkdown("# 标题\n\n正文");
    expect(useStore.getState().editorDirty).toBe(true);
  });

  it("flushDraft 在无修改时直接复位不保存", async () => {
    useStore.setState({ editorDirty: false });
    await useStore.getState().flushDraft();
    expect(useStore.getState().editorDirty).toBe(false);
  });

  it("flushDraft 在有修改时调用 saveDraft", async () => {
    useStore.setState({ markdown: "# 标题\n\n正文内容", editorDirty: true });
    const saved = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ saveDraft: saved as unknown as AppState["saveDraft"] });
    await useStore.getState().flushDraft();
    expect(saved).toHaveBeenCalled();
  });

  it("flushDraft 在无内容时直接复位不调用 saveDraft", async () => {
    useStore.setState({ markdown: "", editorDirty: true });
    const saved = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ saveDraft: saved as unknown as AppState["saveDraft"] });
    await useStore.getState().flushDraft();
    expect(saved).not.toHaveBeenCalled();
    expect(useStore.getState().editorDirty).toBe(false);
  });
});

describe("v7 Phase 2 — 托盘创作快捷操作", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copyMarkdown 空内容提示不复制", async () => {
    useStore.setState({ markdown: "" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await useStore.getState().copyMarkdown();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copyMarkdown 复制当前内容", async () => {
    useStore.setState({ markdown: "# 标题\n\n正文" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await useStore.getState().copyMarkdown();
    expect(writeText).toHaveBeenCalledWith("# 标题\n\n正文");
  });

  it("clearMarkdown 清空内容并标记 dirty", async () => {
    useStore.setState({ markdown: "# 标题\n\n正文", editorDirty: false });
    await useStore.getState().clearMarkdown();
    const state = useStore.getState();
    expect(state.markdown).toBe("");
    expect(state.editorDirty).toBe(true);
  });
});

describe("v7 Phase 3 — 一键自动修复", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("修复缺 alt 图片并触发重新体检", async () => {
    useStore.setState({
      markdown: "# 标题\n\n正文 ![ ](https://a.com/cat.png)",
      selectedPlatforms: ["wechat"],
      preflightReport: null,
      preflightComputing: false,
    });
    useStore.getState().autoFixPreflightIssues();
    // 等待动态 import 完成并修复 markdown。
    await vi.waitFor(() => {
      expect(useStore.getState().markdown).toContain("![cat](https://a.com/cat.png)");
    });
    // 修复后触发重新体检,最终得到报告(已选平台)。
    await vi.waitFor(() => {
      expect(useStore.getState().preflightReport).not.toBeNull();
    });
  });

  it("无可修复问题时内容不变", async () => {
    const md = "# 标题\n\n正文 ![小猫](https://a.com/cat.png)";
    useStore.setState({ markdown: md });
    useStore.getState().autoFixPreflightIssues();
    await new Promise((r) => setTimeout(r, 50));
    expect(useStore.getState().markdown).toBe(md);
  });
});
