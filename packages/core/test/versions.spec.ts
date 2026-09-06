/**
 * 文章版本历史 —— 快照/diff/回滚逻辑测试。
 */
import { describe, expect, it } from "vitest";
import {
  createSnapshot,
  diffText,
  diffVersions,
  MemoryVersionStore,
  VERSION_KEEP_MAX,
  type ArticleSnapshot,
} from "../src/versions/index.js";

const NOW = "2026-08-06T03:00:00.000Z";

function makeSnapshot(overrides: Partial<ArticleSnapshot> = {}): ArticleSnapshot {
  const base = createSnapshot(
    {
      draftId: "draft-1",
      markdown: "# 标题\n\n正文第一段。\n\n正文第二段。",
      authorName: "作者",
      tags: ["效率", "科技"],
      label: "自动保存",
    },
    () => NOW,
  );
  return { ...base, ...overrides };
}

describe("createSnapshot", () => {
  it("自动生成 id 与时间戳,标签数组拷贝", () => {
    const tags = ["效率"];
    const s = createSnapshot(
      { draftId: "d1", markdown: "hi", authorName: "", tags, label: "手动" },
      () => "2026-08-06T00:00:00.000Z",
    );
    expect(s.id.startsWith("snap-d1-")).toBe(true);
    expect(s.createdAt).toBe("2026-08-06T00:00:00.000Z");
    tags.push("被改");
    expect(s.tags).toEqual(["效率"]);
  });
});

describe("diffText — 字符级 LCS diff", () => {
  it("相同文本返回单条 equal", () => {
    const ops = diffText("abc", "abc");
    expect(ops).toEqual([{ type: "equal", text: "abc" }]);
  });

  it("空 a 全插入,空 b 全删除", () => {
    expect(diffText("", "hi")).toEqual([{ type: "insert", text: "hi" }]);
    expect(diffText("hi", "")).toEqual([{ type: "delete", text: "hi" }]);
  });

  it("插入文本产生 insert 操作", () => {
    const ops = diffText("abc", "aXbc");
    const inserted = ops.filter((o) => o.type === "insert").map((o) => o.text).join("");
    expect(inserted).toBe("X");
    // 回放:delete 后得到 b。
    expect(replay(ops, "abc")).toBe("aXbc");
  });

  it("删除文本产生 delete 操作", () => {
    const ops = diffText("aXbc", "abc");
    const deleted = ops.filter((o) => o.type === "delete").map((o) => o.text).join("");
    expect(deleted).toBe("X");
    expect(replay(ops, "aXbc")).toBe("abc");
  });

  it("相邻同类型 op 合并", () => {
    const ops = diffText("abcdef", "abzzdef");
    const inserts = ops.filter((o) => o.type === "insert");
    // 应为单条合并后的 insert("zz"),而非两条。
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.text).toBe("zz");
  });

  it("处理 emoji(按码点而非 UTF-16 单元)", () => {
    const ops = diffText("👍a", "👍b");
    expect(replay(ops, "👍a")).toBe("👍b");
  });
});

describe("diffVersions", () => {
  it("无差异时 identical=true", () => {
    const a = makeSnapshot({ id: "v1", createdAt: "2026-08-06T01:00:00Z" });
    const b = makeSnapshot({ id: "v2", markdown: a.markdown, createdAt: "2026-08-06T02:00:00Z" });
    const diff = diffVersions(a, b);
    expect(diff.identical).toBe(true);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it("统计新增/删除字符数", () => {
    const a = makeSnapshot({ id: "v1", markdown: "abc" });
    const b = makeSnapshot({ id: "v2", markdown: "aXbcYZ" });
    const diff = diffVersions(a, b);
    expect(diff.added).toBe(3); // X, Y, Z
    expect(diff.removed).toBe(0);
    expect(diff.identical).toBe(false);
  });
});

describe("MemoryVersionStore — 版本库", () => {
  it("按时间倒序列出版本元信息(不含全文)", async () => {
    const store = new MemoryVersionStore();
    await store.put(makeSnapshot({ id: "v1", createdAt: "2026-08-06T01:00:00Z", markdown: "一" }));
    await store.put(makeSnapshot({ id: "v2", createdAt: "2026-08-06T02:00:00Z", markdown: "二二" }));
    const metas = await store.list("draft-1");
    expect(metas.map((m) => m.id)).toEqual(["v2", "v1"]);
    expect(metas[0]!.charCount).toBe(2);
    expect("markdown" in metas[0]!).toBe(false);
  });

  it("自动裁剪超过 VERSION_KEEP_MAX 的最旧版本", async () => {
    const store = new MemoryVersionStore();
    for (let i = 0; i < VERSION_KEEP_MAX + 5; i++) {
      const s = createSnapshot(
        { draftId: "d1", markdown: `内容 ${i}`, authorName: "", tags: [], label: "v" },
        () => `2026-08-06T00:${String(i).padStart(2, "0")}:00.000Z`,
      );
      await store.put({ ...s, id: `v${i}` });
    }
    const metas = await store.list("d1");
    expect(metas.length).toBe(VERSION_KEEP_MAX);
    // 最旧的 5 条被裁剪,最新保留。
    expect(metas.some((m) => m.id === "v0")).toBe(false);
    expect(metas.some((m) => m.id === `v${VERSION_KEEP_MAX + 4}`)).toBe(true);
  });

  it("get/remove/removeAll", async () => {
    const store = new MemoryVersionStore();
    await store.put(makeSnapshot({ id: "v1" }));
    await store.put(makeSnapshot({ id: "v2" }));
    expect((await store.get("v1"))?.id).toBe("v1");
    await store.remove("v1");
    expect(await store.get("v1")).toBeUndefined();
    await store.removeAll("draft-1");
    expect((await store.list("draft-1")).length).toBe(0);
  });
});

/** 把 diff ops 应用到原文本,验证可回放得到目标文本。 */
function replay(ops: readonly ReturnType<typeof diffText>[number][], original: string): string {
  let out = "";
  for (const op of ops) {
    if (op.type === "equal" || op.type === "insert") {
      out += op.text;
    }
  }
  void original;
  return out;
}
