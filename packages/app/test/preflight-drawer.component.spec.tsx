/**
 * PreflightDrawer —— 组件测试。
 *
 * 覆盖:
 * - 空态(未选择平台 / 无报告);
 * - ready 状态展示「可以发布」并启用发布按钮;
 * - blocked 状态展示错误并禁用发布按钮;
 * - 平台汇总 / 问题清单 / 建议列表渲染;
 * - 重新检查回调。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { PreflightDrawer } from "../src/components/PreflightDrawer.js";
import type { PreflightReport } from "@mpp/core";

function makeReport(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    ready: true,
    issues: [],
    perPlatform: [],
    suggestions: [],
    counts: { errors: 0, warnings: 0, infos: 0 },
    ...overrides,
  };
}

function base(overrides: Partial<Parameters<typeof PreflightDrawer>[0]> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    report: null,
    computing: false,
    onRecheck: vi.fn(),
    onPublish: vi.fn(),
    selectedCount: 1,
    ...overrides,
  };
}

describe("PreflightDrawer — 发布前健康检查", () => {
  it("未选择平台时展示空态", () => {
    render(<PreflightDrawer {...base({ selectedCount: 0 })} />);
    expect(screen.getByText(/请先在左侧选择至少一个发布平台/)).toBeTruthy();
  });

  it("无报告且未计算时展示提示", () => {
    render(<PreflightDrawer {...base()} />);
    expect(screen.getByText(/点击下方「重新检查」/)).toBeTruthy();
  });

  it("ready 时展示「可以发布」并启用发布按钮", () => {
    const onPublish = vi.fn();
    render(
      <PreflightDrawer
        {...base({ report: makeReport(), onPublish })}
      />,
    );
    expect(screen.getByText("可以发布")).toBeTruthy();
    const publishBtn = screen.getByRole("button", { name: /一键模拟发布/ });
    expect((publishBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(publishBtn);
    expect(onPublish).toHaveBeenCalled();
  });

  it("blocked 时展示错误并禁用发布按钮", () => {
    const report = makeReport({
      ready: false,
      counts: { errors: 2, warnings: 1, infos: 0 },
      issues: [
        { severity: "error", code: "title-missing", message: "缺少标题", field: "title" },
        { severity: "error", code: "body-empty", message: "正文为空", field: "body" },
        { severity: "warning", code: "banned-word", message: "含极限词", field: "words" },
      ],
    });
    render(<PreflightDrawer {...base({ report })} />);
    expect(screen.getByText("存在阻塞问题")).toBeTruthy();
    expect(screen.getByText(/2 错误 · 1 警告/)).toBeTruthy();
    const publishBtn = screen.getByRole("button", { name: /修复后再发布/ });
    expect((publishBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("渲染平台汇总与问题清单", () => {
    const report = makeReport({
      ready: false,
      perPlatform: [
        { platformId: "xiaohongshu", platformName: "小红书", errors: 1, warnings: 0, issues: [] },
      ],
      issues: [
        { severity: "error", code: "body-over", message: "正文超长", platformId: "xiaohongshu", field: "platform" },
      ],
    });
    render(<PreflightDrawer {...base({ report })} />);
    expect(screen.getByText(/小红书/)).toBeTruthy();
    expect(screen.getByText("正文超长")).toBeTruthy();
  });

  it("渲染行动建议列表", () => {
    const report = makeReport({
      ready: true,
      suggestions: ["请补充标题", "建议增加正文长度"],
    });
    render(<PreflightDrawer {...base({ report })} />);
    expect(screen.getByText("请补充标题")).toBeTruthy();
    expect(screen.getByText("建议增加正文长度")).toBeTruthy();
  });

  it("重新检查触发 onRecheck", () => {
    const onRecheck = vi.fn();
    render(<PreflightDrawer {...base({ onRecheck })} />);
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onRecheck).toHaveBeenCalled();
  });
});

describe("v7 Phase 2 — 真实发布强制体检", () => {
  it("提供 onRealPublish 时展示真实发布按钮", () => {
    const onRealPublish = vi.fn();
    render(<PreflightDrawer {...base({ report: makeReport(), onRealPublish })} />);
    const realBtn = screen.getByRole("button", { name: /真实发布/ });
    expect((realBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(realBtn);
    expect(onRealPublish).toHaveBeenCalled();
  });

  it("realMode=true 时按钮文案为「确认真实发布」", () => {
    const onRealPublish = vi.fn();
    render(<PreflightDrawer {...base({ report: makeReport(), onRealPublish, realMode: true })} />);
    expect(screen.getByRole("button", { name: "确认真实发布" })).toBeTruthy();
  });

  it("blocked 时真实发布按钮禁用", () => {
    const report = makeReport({ ready: false, counts: { errors: 1, warnings: 0, infos: 0 } });
    render(<PreflightDrawer {...base({ report, onRealPublish: vi.fn() })} />);
    const realBtns = screen.getAllByRole("button", { name: /修复后再发布/ });
    expect(realBtns.length).toBeGreaterThanOrEqual(1);
    for (const btn of realBtns) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("v7 Phase 3 — 一键自动修复", () => {
  it("存在缺 alt 图片时展示自动修复条", () => {
    const report = makeReport({
      ready: false,
      counts: { errors: 0, warnings: 1, infos: 0 },
      issues: [
        {
          severity: "warning",
          code: "image-no-alt",
          message: "图片缺少描述",
          field: "images",
        },
      ],
    });
    render(<PreflightDrawer {...base({ report, onAutoFix: vi.fn() })} />);
    expect(screen.getByText(/1 张图片缺少描述/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "自动修复" })).toBeTruthy();
  });

  it("点击自动修复触发 onAutoFix", () => {
    const onAutoFix = vi.fn();
    const report = makeReport({
      ready: false,
      counts: { errors: 0, warnings: 1, infos: 0 },
      issues: [
        {
          severity: "warning",
          code: "image-no-alt",
          message: "图片缺少描述",
          field: "images",
        },
      ],
    });
    render(<PreflightDrawer {...base({ report, onAutoFix })} />);
    fireEvent.click(screen.getByRole("button", { name: "自动修复" }));
    expect(onAutoFix).toHaveBeenCalled();
  });

  it("无缺 alt 问题时不展示自动修复条", () => {
    render(<PreflightDrawer {...base({ report: makeReport(), onAutoFix: vi.fn() })} />);
    expect(screen.queryByText(/图片缺少描述/)).toBeNull();
  });
});
