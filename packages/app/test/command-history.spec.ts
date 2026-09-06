/**
 * CMD-02 命令面板进阶测试 —— 最近使用排序 / 自定义命令 / 别名匹配。
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createCommandHistory,
  sortByRecent,
  loadRecentFromStorage,
  persistRecentToStorage,
  loadCustomCommands,
  saveCustomCommands,
  matchesCustomCommand,
  type RecentEntry,
  type CustomCommandSpec,
} from "../src/components/command-history.js";

describe("command-history · 最近使用", () => {
  it("record 记录执行次数与时间", () => {
    const h = createCommandHistory();
    h.record("a");
    h.record("b");
    h.record("a");
    const list = h.list();
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.id === "a")?.count).toBe(2);
    expect(list.find((e) => e.id === "b")?.count).toBe(1);
  });

  it("sortByRecent 无查询时最近使用的排最前", () => {
    const items = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    const recents: RecentEntry[] = [
      { id: "c", lastUsed: 300, count: 1 },
      { id: "a", lastUsed: 100, count: 1 },
    ];
    const sorted = sortByRecent(items, recents, "");
    expect(sorted.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("sortByRecent 有查询时保持原顺序(相关性优先)", () => {
    const items = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const recents: RecentEntry[] = [{ id: "b", lastUsed: 999, count: 1 }];
    const sorted = sortByRecent(items, recents, "查询");
    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("持久化读写 localStorage", () => {
    localStorage.clear();
    persistRecentToStorage([
      { id: "x", lastUsed: 123, count: 2 },
      { id: "y", lastUsed: 456, count: 1 },
    ]);
    const loaded = loadRecentFromStorage();
    expect(loaded).toHaveLength(2);
    expect(loaded.find((e) => e.id === "x")?.count).toBe(2);
  });

  it("损坏的存储数据静默回退空数组", () => {
    localStorage.setItem("mpp.commandHistory", "not-json");
    expect(loadRecentFromStorage()).toEqual([]);
    localStorage.setItem("mpp.commandHistory", JSON.stringify({ bad: true }));
    expect(loadRecentFromStorage()).toEqual([]);
  });
});

describe("command-history · 自定义命令", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("保存并读取自定义命令", () => {
    const spec: CustomCommandSpec = {
      id: "c1",
      name: "打开效果",
      aliases: "效果 数据",
      action: "效果",
    };
    saveCustomCommands([spec]);
    const loaded = loadCustomCommands();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("打开效果");
  });

  it("matchesCustomCommand 匹配名称/别名/关键词", () => {
    const spec: CustomCommandSpec = { id: "c1", name: "周报", aliases: "weekly 周", keywords: "复盘", action: "周报" };
    expect(matchesCustomCommand(spec, "周")).toBe(true);
    expect(matchesCustomCommand(spec, "weekly")).toBe(true);
    expect(matchesCustomCommand(spec, "复盘")).toBe(true);
    expect(matchesCustomCommand(spec, "不存在的")).toBe(false);
    expect(matchesCustomCommand(spec, "")).toBe(true);
  });

  it("损坏的自定义命令数据被过滤", () => {
    localStorage.setItem("mpp.customCommands", JSON.stringify([{ name: "缺 id" }, { id: "c2", name: "ok", action: "a" }]));
    const loaded = loadCustomCommands();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("c2");
  });
});
