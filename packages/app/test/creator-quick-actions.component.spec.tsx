/**
 * CreatorQuickActions —— 组件测试。
 *
 * 覆盖:
 * - 渲染四个操作按钮;
 * - 复制 Markdown(剪贴板 mock);
 * - 导出 .md(URL.createObjectURL mock);
 * - 清空内容两次确认;
 * - 保存回调。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "./helpers/render.js";
import { CreatorQuickActions } from "../src/components/CreatorQuickActions.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreatorQuickActions — 创作快捷操作", () => {
  it("渲染操作按钮(复制/导出/导出HTML/保存/清空)", () => {
    render(
      <CreatorQuickActions
        markdown="# 标题\n\n正文"
        draftTitle="我的草稿"
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("复制 Markdown")).toBeTruthy();
    expect(screen.getByLabelText("导出 .md")).toBeTruthy();
    expect(screen.getByLabelText("导出 HTML")).toBeTruthy();
    expect(screen.getByLabelText("保存草稿")).toBeTruthy();
    expect(screen.getByLabelText("清空内容")).toBeTruthy();
  });

  it("复制 Markdown 写入剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <CreatorQuickActions
        markdown={"# 标题\n\n正文"}
        draftTitle="t"
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("复制 Markdown"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("# 标题\n\n正文"));
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("空内容时复制不写入剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <CreatorQuickActions
        markdown=""
        draftTitle=""
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("复制 Markdown"));
    await new Promise((r) => setTimeout(r, 10));
    expect(writeText).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("导出 .md 创建下载链接", () => {
    const create = vi.fn(() => "blob:url");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    render(
      <CreatorQuickActions
        markdown="# 标题\n\n正文"
        draftTitle="我的草稿"
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("导出 .md"));
    expect(create).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("清空内容需要二次确认", () => {
    const onClear = vi.fn();
    render(
      <CreatorQuickActions
        markdown="# 标题"
        draftTitle="t"
        onSave={vi.fn()}
        onClear={onClear}
      />,
    );
    const clearBtn = screen.getByLabelText("清空内容");
    fireEvent.click(clearBtn);
    expect(onClear).not.toHaveBeenCalled();
    // 按钮文字变为确认提示。
    expect(screen.getByText(/确认清空/)).toBeTruthy();
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });

  it("保存按钮触发 onSave", () => {
    const onSave = vi.fn();
    render(
      <CreatorQuickActions
        markdown="# 标题"
        draftTitle="t"
        onSave={onSave}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("保存草稿"));
    expect(onSave).toHaveBeenCalled();
  });

  it("导出 HTML 创建下载链接且内容含渲染后的 HTML", async () => {
    let capturedBlob: Blob | null = null;
    const create = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:url";
    });
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <CreatorQuickActions
        markdown={"# 标题\n\n正文"}
        draftTitle="我的草稿"
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("导出 HTML"));
    expect(create).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    const content = await capturedBlob!.text();
    expect(content).toContain("<!doctype html>");
    expect(content).toContain("<h1>标题</h1>");
    expect(content).toContain("正文");
    vi.unstubAllGlobals();
    clickSpy.mockRestore();
  });

  it("空内容时导出 HTML 不创建下载", () => {
    const create = vi.fn(() => "blob:url");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    render(
      <CreatorQuickActions
        markdown=""
        draftTitle=""
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("导出 HTML"));
    expect(create).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
