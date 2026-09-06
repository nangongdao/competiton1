/**
 * CMD-02 命令面板组件测试 —— 最近使用 / 自定义命令 / 别名匹配。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { CommandPalette, type CommandItem } from "../src/components/CommandPalette.js";
import { saveCustomCommands } from "../src/components/command-history.js";
import { FileText } from "lucide-react";

function makeCommands(): CommandItem[] {
  return [
    { id: "drafts", label: "草稿与历史", hint: "管理草稿", keywords: "草稿 历史", icon: FileText, run: vi.fn() },
    { id: "settings", label: "设置", hint: "AI 增强", keywords: "设置 配置", icon: FileText, run: vi.fn() },
    { id: "calendar", label: "内容日历", hint: "月历", keywords: "日历 计划", icon: FileText, run: vi.fn() },
  ];
}

describe("CommandPalette · CMD-02", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("渲染命令列表并执行", () => {
    const commands = makeCommands();
    render(<CommandPalette open onOpenChange={() => undefined} commands={commands} />);
    expect(screen.getByText("草稿与历史")).toBeTruthy();
    fireEvent.click(screen.getByText("草稿与历史"));
    expect(commands[0].run).toHaveBeenCalled();
  });

  it("自定义命令显示并可执行(onCustomAction 回调)", async () => {
    saveCustomCommands([
      { id: "c1", name: "打开周报", aliases: "weekly 周报", keywords: "复盘", action: "周报" },
    ]);
    const commands = makeCommands();
    const onCustom = vi.fn();
    render(<CommandPalette open onOpenChange={() => undefined} commands={commands} onCustomAction={onCustom} />);
    // 输入别名「weekly」命中自定义命令
    const input = screen.getByLabelText("搜索命令");
    fireEvent.change(input, { target: { value: "weekly" } });
    await waitFor(() => {
      expect(screen.getByText("打开周报")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("打开周报"));
    expect(onCustom).toHaveBeenCalledWith("周报");
  });

  it("删除自定义命令", () => {
    saveCustomCommands([
      { id: "c1", name: "打开周报", action: "周报" },
    ]);
    const commands = makeCommands();
    render(<CommandPalette open onOpenChange={() => undefined} commands={commands} />);
    const del = screen.getByLabelText("删除命令 打开周报");
    fireEvent.click(del);
    expect(screen.queryByText("打开周报")).toBeNull();
  });

  it("新增自定义命令表单保存", async () => {
    const commands = makeCommands();
    render(<CommandPalette open onOpenChange={() => undefined} commands={commands} />);
    fireEvent.click(screen.getByLabelText("新增自定义命令"));
    const nameInput = screen.getByLabelText("命令名称");
    fireEvent.change(nameInput, { target: { value: "我的命令" } });
    fireEvent.change(screen.getByLabelText("命令别名"), { target: { value: "mycmd 我的" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    // 保存后列表出现该命令
    await waitFor(() => {
      expect(screen.getByText("我的命令")).toBeTruthy();
    });
    // localStorage 已持久化
    expect(localStorage.getItem("mpp.customCommands")).toContain("我的命令");
  });
});
