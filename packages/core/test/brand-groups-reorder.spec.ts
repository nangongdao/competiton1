/**
 * v11 BRAND-01 账号分组拖动排序 —— sortOrder / reorderGroups / sortGroups 测试。
 */
import { describe, expect, it } from "vitest";
import {
  createAccountGroup,
  sortGroups,
  reorderGroups,
  type AccountGroup,
} from "../src/brand/groups.js";

const NOW = () => "2026-08-08T00:00:00Z";

function grp(name: string, id: string): AccountGroup {
  return createAccountGroup({ name, id }, NOW);
}

describe("brand/groups — BRAND-01 拖动排序", () => {
  it("sortGroups:无 sortOrder 时按更新时间倒序", () => {
    const a = grp("A", "a");
    const b = grp("B", "b");
    const c = createAccountGroup({ name: "C", id: "c" }, () => "2026-08-01T00:00:00Z");
    const sorted = sortGroups([c, b, a]);
    // a/b 更新时间相同(同一 now);c 更旧排在最后。
    expect(sorted[2]!.id).toBe("c");
    expect(sorted.slice(0, 2).map((g) => g.id).sort()).toEqual(["a", "b"]);
  });

  it("reorderGroups:重排并落盘新 sortOrder,未出现分组保留", () => {
    const a = grp("A", "a");
    const b = grp("B", "b");
    const c = grp("C", "c");
    const reordered = reorderGroups([a, b, c], ["c", "a"]);
    const byId = new Map(reordered.map((g) => [g.id, g]));
    expect(byId.get("c")!.sortOrder).toBe(0);
    expect(byId.get("a")!.sortOrder).toBe(1);
    // b 未在 orderedIds 中,保留但无新 sortOrder。
    expect(byId.get("b")).toBeDefined();
    expect(byId.get("b")!.sortOrder).toBeUndefined();
  });

  it("sortGroups:sortOrder 生效(越小越靠前),缺省排最后", () => {
    const a = { ...grp("A", "a"), sortOrder: 2 };
    const b = { ...grp("B", "b"), sortOrder: 0 };
    const c = grp("C", "c");
    const sorted = sortGroups([a, c, b]);
    expect(sorted.map((g) => g.id)).toEqual(["b", "a", "c"]);
  });
});
