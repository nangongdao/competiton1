/**
 * ROADMAP_V5 Phase 1 发布队列拖动排序 —— sortOrder / reorderQueueEntries 测试。
 */
import { describe, expect, it } from "vitest";
import {
  sortQueueEntries,
  reorderQueueEntries,
  type PublishQueueEntry,
} from "../src/publish-queue/types.js";

// createPublishQueueEntry 可能未导出,这里用最小工厂。
function entry(id: string, scheduledAt: string): PublishQueueEntry {
  return {
    id,
    name: `条目${id}`,
    draftId: "d1",
    platformIds: ["wechat"],
    scheduledAt,
    accountRefs: [],
    realPublish: true,
    status: "queued",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
  };
}

describe("publish-queue/types — 队列拖动排序", () => {
  it("sortQueueEntries:无 sortOrder 时按 scheduledAt 倒序", () => {
    const a = entry("a", "2026-08-10T00:00:00Z");
    const b = entry("b", "2026-08-12T00:00:00Z");
    const sorted = sortQueueEntries([a, b]);
    expect(sorted[0]!.id).toBe("b");
  });

  it("reorderQueueEntries:重排并落盘新 sortOrder", () => {
    const a = entry("a", "2026-08-10T00:00:00Z");
    const b = entry("b", "2026-08-12T00:00:00Z");
    const c = entry("c", "2026-08-09T00:00:00Z");
    const reordered = reorderQueueEntries([a, b, c], ["c", "a"]);
    const byId = new Map(reordered.map((e) => [e.id, e]));
    expect(byId.get("c")!.sortOrder).toBe(0);
    expect(byId.get("a")!.sortOrder).toBe(1);
    expect(byId.get("b")).toBeDefined();
  });

  it("sortQueueEntries:sortOrder 优先于 scheduledAt", () => {
    const a = { ...entry("a", "2026-08-10T00:00:00Z"), sortOrder: 5 };
    const b = { ...entry("b", "2026-08-12T00:00:00Z"), sortOrder: 0 };
    const c = entry("c", "2026-08-09T00:00:00Z");
    const sorted = sortQueueEntries([a, b, c]);
    expect(sorted.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });
});
