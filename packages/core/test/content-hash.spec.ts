import { describe, it, expect } from "vitest";
import { computeContentHash } from "../src/assets/content-hash.js";

describe("computeContentHash — 内容寻址哈希", () => {
  it("相同字节序列得到相同哈希(确定性)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const a = await computeContentHash(bytes);
    const b = await computeContentHash(bytes);
    expect(a).toBe(b);
  });

  it("不同字节序列得到不同哈希", async () => {
    const a = await computeContentHash(new Uint8Array([1, 2, 3]));
    const b = await computeContentHash(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it("空字节也有确定哈希", async () => {
    const h = await computeContentHash(new Uint8Array(0));
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("WebCrypto 可用时产出 SHA-256 128 位前缀(16 位十六进制)", async () => {
    const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
    // Node 20+ / 现代浏览器均带 WebCrypto。
    expect(subtle).toBeDefined();
    const h = await computeContentHash(new TextEncoder().encode("hello"));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
