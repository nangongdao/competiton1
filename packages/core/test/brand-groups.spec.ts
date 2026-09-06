/**
 * v11 Part 1 · 账号矩阵分组管理纯函数测试(BRAND-01)。
 */
import { describe, expect, it } from "vitest";
import {
  createAccountGroup,
  addMember,
  removeMember,
  buildGroupSnapshot,
  buildGroupMatrix,
  assertAccountGroup,
} from "../src/brand/groups.js";
import type { AccountProfile } from "../src/accounts/types.js";
import type { PerformanceRecord } from "../src/analytics/types.js";

function acct(id: string, platformId: string, name: string): AccountProfile {
  return { id, platformId, name, status: "enabled", secrets: {}, persistSecrets: false, createdAt: "", updatedAt: "" };
}

function rec(partial: Partial<PerformanceRecord> & { id: string; platformId: string; title: string }): PerformanceRecord {
  return {
    historyId: undefined,
    remoteId: undefined,
    remoteUrl: undefined,
    publishedAt: "2026-08-01T00:00:00Z",
    collectedAt: "2026-08-01T00:00:00Z",
    metrics: {},
    source: "manual",
    ...partial,
  };
}

describe("brand/groups — BRAND-01 账号矩阵分组", () => {
  it("创建分组并维护成员", () => {
    const g = createAccountGroup({ name: "品牌 A", memberIds: ["a", "b", "a"] });
    expect(g.name).toBe("品牌 A");
    expect(g.memberIds).toEqual(["a", "b"]); // 去重
    expect(assertAccountGroup(g)).toBe(true);

    const withC = addMember(g, "c");
    expect(withC.memberIds).toContain("c");
    expect(withC.updatedAt).not.toBe(g.updatedAt);
    const noB = removeMember(withC, "b");
    expect(noB.memberIds).not.toContain("b");
  });

  it("构建分组快照:账号状态与表现聚合", () => {
    const g = createAccountGroup({ name: "业务线 B", memberIds: ["a1", "a2"] });
    const accounts = [acct("a1", "xiaohongshu", "小红书主号"), acct("a2", "wechat", "公众号主号"), acct("a3", "zhihu", "不在组内")];
    const records = [
      rec({ id: "p1", platformId: "xiaohongshu", title: "A", metrics: { views: 1000, likes: 120 } }),
      rec({ id: "p2", platformId: "wechat", title: "B", metrics: { views: 500, likes: 30 } }),
      rec({ id: "p3", platformId: "zhihu", title: "C", metrics: { views: 99999 } }),
    ];
    const s = buildGroupSnapshot(g, accounts, records);
    expect(s.memberCount).toBe(2);
    expect(s.enabledCount).toBe(2);
    expect(s.performance.totalViews).toBe(1500);
    expect(s.performance.totalLikes).toBe(150);
    expect(s.performance.bestPlatform).toBe("xiaohongshu");
    const a1 = s.accounts.find((a) => a.accountId === "a1")!;
    expect(a1.performance?.totalViews).toBe(1000);
    // 组外账号表现不计入。
    expect(s.accounts.some((a) => a.accountId === "a3")).toBe(false);
  });

  it("矩阵总览聚合所有分组", () => {
    const groups = [createAccountGroup({ name: "G1", memberIds: ["a1"] }), createAccountGroup({ name: "G2", memberIds: ["a2"] })];
    const matrix = buildGroupMatrix(groups, [acct("a1", "wechat", "A"), acct("a2", "xiaohongshu", "B")], []);
    expect(matrix.length).toBe(2);
    expect(matrix.every((m) => m.memberCount === 1)).toBe(true);
  });
});
