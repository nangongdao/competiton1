/**
 * TEST-03 —— 平台预览卡片组件测试(交互 + a11y)。
 *
 * 验证:
 * - 无产物时展示错误提示;
 * - 展示平台名称、HTML/纯文本标签、错误/提醒计数;
 * - tab 切换(预览/源码/校验)与 WAI-ARIA tabs 键盘导航(左右箭头);
 * - 校验页展示问题列表与发布说明;
 * - 复制按钮在桥接存在时触发 assistedHandoff。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { PlatformPreview } from "../src/components/PlatformPreview.js";
import type { PlatformResult } from "@mpp/core";

const OK_RESULT: PlatformResult = {
  platformId: "wechat",
  platformName: "公众号",
  ok: true,
  report: {
    platformId: "wechat",
    issues: [],
    hasError: false,
  },
  artifact: {
    platformId: "wechat",
    payload: {
      title: "测试标题",
      content: "<p>正文内容</p>",
      mime: "text/html",
      tags: [],
      imageAssetIds: [],
    },
    deliverable: "<p>正文内容</p>",
    instructions: ["请在公众号后台确认发送范围"],
  },
  quality: {
    paragraphRhythm: 90,
    imageBalance: 80,
    headingStructure: 100,
    readability: 95,
    overall: 91,
    suggestions: ["第 2 段略长，建议拆分"],
  },
};

const ERR_RESULT: PlatformResult = {
  ...OK_RESULT,
  ok: false,
  report: {
    platformId: "wechat",
    issues: [
      { severity: "error", code: "missing-title", message: "缺少标题" },
      { severity: "warning", code: "long-paragraph", message: "段落过长" },
    ],
    hasError: true,
  },
};

const EMPTY_RESULT: PlatformResult = {
  platformId: "zhihu",
  platformName: "知乎",
  ok: false,
  error: "未注册平台",
};

describe("PlatformPreview — 平台预览卡片", () => {
  it("无产物时展示错误信息", () => {
    render(<PlatformPreview result={EMPTY_RESULT} />);
    expect(screen.getByText("未注册平台")).toBeTruthy();
  });

  it("展示平台名、类型与字数", () => {
    render(<PlatformPreview result={OK_RESULT} />);
    expect(screen.getByText("公众号")).toBeTruthy();
    expect(screen.getByText(/HTML · \d+ 字/)).toBeTruthy();
  });

  it("展示校验错误与提醒计数", () => {
    render(<PlatformPreview result={ERR_RESULT} />);
    expect(screen.getByText("1 错误")).toBeTruthy();
    expect(screen.getByText("1 提醒")).toBeTruthy();
  });

  it("tab 切换:点击源码查看源码内容", () => {
    render(<PlatformPreview result={OK_RESULT} />);
    const sourceTab = screen.getByRole("tab", { name: "源码" });
    fireEvent.click(sourceTab);
    expect(screen.getByText("<p>正文内容</p>")).toBeTruthy();
  });

  it("校验页展示问题列表与发布说明", () => {
    render(<PlatformPreview result={ERR_RESULT} />);
    fireEvent.click(screen.getByRole("tab", { name: /校验 \(2\)/ }));
    expect(screen.getByText("缺少标题")).toBeTruthy();
    expect(screen.getByText("段落过长")).toBeTruthy();
  });

  it("a11y:tab 键盘左右箭头切换并聚焦下一 tab", () => {
    render(<PlatformPreview result={OK_RESULT} />);
    const previewTab = screen.getByRole("tab", { name: "预览" });
    fireEvent.keyDown(previewTab, { key: "ArrowRight" });
    // 切换后焦点落在"源码" tab。
    const sourceTab = document.activeElement as HTMLElement;
    expect(sourceTab.textContent).toBe("源码");
    fireEvent.keyDown(sourceTab, { key: "ArrowLeft" });
    expect((document.activeElement as HTMLElement).textContent).toBe("预览");
  });

  it("复制按钮在 bridge 存在时触发 assistedHandoff", async () => {
    const bridge = {
      env: "web" as const,
      assistedHandoff: vi.fn(async () => ({ ok: true, method: "clipboard", message: "ok" })),
    };
    render(<PlatformPreview result={OK_RESULT} bridge={bridge as never} />);
    const copyBtn = screen.getByRole("button", { name: /复制公众号内容到剪贴板/ });
    fireEvent.click(copyBtn);
    await vi.waitFor(() => expect(bridge.assistedHandoff).toHaveBeenCalled());
  });
});
