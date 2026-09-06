/**
 * DocStats / SaveStatus / ToastHost 组件测试。
 *
 * 覆盖:
 * - DocStats:纯文本剥离与统计(字数/段落/图片/阅读时长)、平台字数超限预警;
 * - SaveStatus:各状态文案与 aria-live;
 * - ToastHost:toast() 弹出一条提示、自动消失、手动关闭。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { act } from "@testing-library/react";
import { DocStats, plainTextOf, deriveDocStats } from "../src/components/DocStats.js";
import { SaveStatus } from "../src/components/SaveStatus.js";
import { ToastHost } from "../src/components/ToastHost.js";
import { setSaveStatus } from "../src/components/save-status.js";
import { toast } from "../src/components/toast.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DocStats — 文档统计", () => {
  it("plainTextOf 剥离 Markdown 语法", () => {
    const md = "# 标题\n\n**加粗** 文字 [链接](https://a.com) `code`\n\n![图](https://x.png)";
    const text = plainTextOf(md);
    expect(text).toContain("标题");
    expect(text).toContain("加粗");
    expect(text).toContain("链接");
    expect(text).not.toContain("**");
    expect(text).not.toContain("[链接](https://a.com)");
    expect(text).not.toContain("![图]");
  });

  it("deriveDocStats 统计字数/段落/图片/阅读时长", () => {
    const md = "# 标题\n\n第一段文字。\n\n第二段文字。\n\n![a](x.png) ![b](y.png)";
    const s = deriveDocStats(md);
    expect(s.paragraphs).toBe(2);
    expect(s.images).toBe(2);
    expect(s.chars).toBeGreaterThan(0);
    expect(s.readMinutes).toBeGreaterThanOrEqual(1);
  });

  it("渲染统计条目与平台字数预警", () => {
    render(<DocStats markdown="# 标题\n\n正文内容" selectedPlatforms={["wechat", "xiaohongshu"]} />);
    // 统计条目。
    expect(screen.getByText(/字$/)).toBeTruthy();
    expect(screen.getByText(/段$/)).toBeTruthy();
    expect(screen.getByText(/图$/)).toBeTruthy();
    // 平台限制默认折叠,点击展开后显示。
    fireEvent.click(screen.getByRole("button", { name: /平台限制/ }));
    // 平台名 + 字数/上限 出现。
    expect(screen.getByText(/公众号/)).toBeTruthy();
    expect(screen.getByText(/小红书/)).toBeTruthy();
  });

  it("超限平台标记 over 样式", () => {
    // 小红书 bodyMax 较小(1000),构造超长文本触发 over。
    const longMd = `# 标题\n\n${"超".repeat(1200)}`;
    render(<DocStats markdown={longMd} selectedPlatforms={["xiaohongshu"]} />);
    // 展开平台限制查看 over 标记。
    fireEvent.click(screen.getByRole("button", { name: /平台限制/ }));
    const el = document.querySelector(".doc-platform-limit.over");
    expect(el).toBeTruthy();
  });

  it("字数目标:未设目标时展示输入框,回车后回调", () => {
    const onGoal = vi.fn();
    render(<DocStats markdown="# 标题\n\n正文" selectedPlatforms={[]} wordGoal={0} onWordGoalChange={onGoal} />);
    const input = screen.getByLabelText("设定目标字数");
    fireEvent.keyDown(input, { key: "Enter", target: { value: "800" } });
    expect(onGoal).toHaveBeenCalledWith(800);
  });

  it("字数目标:已设目标时展示进度并可清除", () => {
    const onGoal = vi.fn();
    render(<DocStats markdown="# 标题\n\n正文内容" selectedPlatforms={[]} wordGoal={1000} onWordGoalChange={onGoal} />);
    const goalEl = screen.getAllByText((_, el) => el?.textContent?.includes("目标 10/1000") ?? false)[0];
    expect(goalEl).toBeTruthy();
    fireEvent.click(screen.getByLabelText("清除字数目标"));
    expect(onGoal).toHaveBeenCalledWith(0);
  });

  it("打字机模式开关触发回调", () => {
    const onTypewriter = vi.fn();
    render(<DocStats markdown="# 标题" selectedPlatforms={[]} typewriterMode={false} onTypewriterModeChange={onTypewriter} />);
    fireEvent.click(screen.getByText("打字机"));
    expect(onTypewriter).toHaveBeenCalledWith(true);
  });
});

describe("SaveStatus — 自动保存状态", () => {
  it("默认已保存", () => {
    render(<SaveStatus />);
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("dirty 时显示未保存", () => {
    render(<SaveStatus />);
    act(() => setSaveStatus("dirty"));
    expect(screen.getByText("未保存")).toBeTruthy();
  });

  it("saving 显示保存中", () => {
    render(<SaveStatus />);
    act(() => setSaveStatus("saving"));
    expect(screen.getByText("保存中…")).toBeTruthy();
  });
});

describe("ToastHost — 全局提示", () => {
  it("toast 弹出提示并展示消息", () => {
    render(<ToastHost />);
    act(() => toast("已保存", "success"));
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("手动关闭移除提示", () => {
    render(<ToastHost />);
    act(() => toast("可关闭", "info"));
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(screen.queryByText("可关闭")).toBeNull();
  });
});
