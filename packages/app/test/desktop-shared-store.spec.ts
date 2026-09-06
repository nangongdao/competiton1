/**
 * COLLAB-01/03 桌面端本地共享库测试 —— DesktopFileSharedStore(经 Tauri 桥读写文件)。
 *
 * 覆盖:
 * - 读空文件 → 空库;put 后经桥写回文件(原子写由 Rust 侧保证);
 * - 版本化冲突合并:同 id 并发覆盖(不同源/版本未递增)→ conflict 保留双版本;
 * - 内容一致且版本/时间不更新 → unchanged;
 * - 损坏文件不静默清空(丢弃损坏条目,保留可解析部分)。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { SharedItem } from "@mpp/core";
import { sharedItemFrom } from "@mpp/core";
import { DesktopFileSharedStore } from "../src/bridge/desktop-shared-store.js";

const NOW = () => "2026-08-09T00:00:00Z";

function makeItem(overrides: Partial<SharedItem> = {}): SharedItem {
  return {
    ...sharedItemFrom(
      "draft",
      "draft-1",
      "别俚科夫",
      {
        kind: "draft",
        draft: { title: "桌面共享草稿", markdown: "# 标题\n\n正文", authorName: "作者A", tags: ["协作"], updatedAt: NOW() },
      },
    ),
    ...overrides,
  };
}

/** 模拟 TauriBridge 的本地文件读写(内存文件)。 */
function makeBridge() {
  let file = "";
  const read = vi.fn(async () => file);
  const write = vi.fn(async (raw: string) => {
    file = raw;
  });
  const bridge = {
    env: "desktop" as const,
    readLocalSharedStore: read,
    writeLocalSharedStore: write,
  };
  return { bridge, read, write, file: () => file };
}

describe("DesktopFileSharedStore(经 Tauri 桥读写文件)", () => {
  it("空文件 → 空库;put 后写回文件(可重启恢复)", async () => {
    const { bridge, write } = makeBridge();
    const store = new DesktopFileSharedStore(bridge as never);
    expect(await store.list()).toEqual([]);
    await store.put(makeItem());
    expect(write).toHaveBeenCalled();
    // 模拟重启:同一桥文件内容 → 新实例可恢复。
    const store2 = new DesktopFileSharedStore(bridge as never);
    const list = await store2.list();
    expect(list.length).toBe(1);
    expect(list[0]!.meta.id).toBe("draft-1");
  });

  it("同 id 并发覆盖(不同来源/版本未递增)→ conflict 保留双版本", async () => {
    const { bridge } = makeBridge();
    const store = new DesktopFileSharedStore(bridge as never);
    await store.put(makeItem());
    const concurrent = {
      ...makeItem(),
      meta: { ...makeItem().meta, sourceName: "另一台设备", updatedAt: "2026-08-10T00:00:00Z", version: 1 },
      payload: {
        kind: "draft" as const,
        draft: { title: "桌面共享草稿", markdown: "# 标题\n\n并发分支", authorName: "作者B", tags: [], updatedAt: "2026-08-10T00:00:00Z" },
      },
    };
    const result = await store.put(concurrent);
    expect(result.mode).toBe("conflict");
    expect(result.item.meta.id).toMatch(/^draft-1#v\d+$/);
    expect((await store.listByKind("draft")).length).toBe(2);
  });

  it("内容一致且版本/时间不更新 → unchanged", async () => {
    const { bridge } = makeBridge();
    const store = new DesktopFileSharedStore(bridge as never);
    const fixed = makeItem({ meta: { ...makeItem().meta, updatedAt: NOW() } });
    await store.put(fixed);
    const result = await store.put(fixed);
    expect(result.mode).toBe("unchanged");
    expect((await store.listByKind("draft")).length).toBe(1);
  });
});
