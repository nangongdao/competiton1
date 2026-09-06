import { describe, it, expect } from "vitest";
import { buildIdempotencyKey, contentHashOfPayload, fnv1a } from "../src/publish/idempotency.js";
import type { SerializedPayload } from "../src/adapters/types.js";

const basePayload: SerializedPayload = {
  content: "<p>正文</p>",
  mime: "text/html",
  title: "标题",
  tags: [],
  imageAssetIds: [],
};

describe("fnv1a — 确定性哈希", () => {
  it("同一输入恒得同一输出", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });

  it("不同输入大概率不同", () => {
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });

  it("输出为 8 位十六进制", () => {
    expect(fnv1a("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("contentHashOfPayload — 内容哈希", () => {
  it("相同 payload + 相同意图 → 相同哈希", async () => {
    expect(await contentHashOfPayload(basePayload, false)).toBe(await contentHashOfPayload(basePayload, false));
  });

  it("草稿与发布意图产生不同哈希", async () => {
    expect(await contentHashOfPayload(basePayload, false)).not.toBe(await contentHashOfPayload(basePayload, true));
  });

  it("正文变化产生不同哈希", async () => {
    const changed = { ...basePayload, content: "<p>改过的正文</p>" };
    expect(await contentHashOfPayload(basePayload, false)).not.toBe(await contentHashOfPayload(changed, false));
  });

  it("摘要纳入哈希", async () => {
    const withSummary = { ...basePayload, summary: "摘要" };
    expect(await contentHashOfPayload(basePayload, false)).not.toBe(await contentHashOfPayload(withSummary, false));
  });
});

describe("buildIdempotencyKey — 幂等键", () => {
  it("平台 + 哈希 + 意图组成稳定 key", async () => {
    const hash = await contentHashOfPayload(basePayload, false);
    expect(buildIdempotencyKey("wechat", hash, "draft")).toBe(
      `wechat:draft:${hash}`,
    );
  });

  it("同内容同意图跨平台 key 不同", async () => {
    const hash = await contentHashOfPayload(basePayload, false);
    expect(buildIdempotencyKey("wechat", hash, "draft")).not.toBe(
      buildIdempotencyKey("zhihu", hash, "draft"),
    );
  });
});
