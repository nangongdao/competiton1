/**
 * local 图床配额/保留/清理测试(SEC-05)。
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkQuota, cleanupExpired, computeDirStats } from "../src/security/local-store.js";
import type { LocalImageStoreConfig } from "../src/config.js";

const CFG: LocalImageStoreConfig = {
  maxTotalBytes: 1000,
  maxFileBytes: 500,
  retentionMs: 60 * 1000,
  cleanupEnabled: true,
};

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mpp-store-"));
}

describe("computeDirStats", () => {
  it("统计目录字节数与文件数(含子目录)", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "a.png"), Buffer.alloc(10));
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "b.png"), Buffer.alloc(20));
    const stats = await computeDirStats(dir);
    expect(stats.totalBytes).toBe(30);
    expect(stats.fileCount).toBe(2);
  });
});

describe("checkQuota", () => {
  it("配额内允许", async () => {
    const dir = await tempDir();
    const r = await checkQuota(dir, 100, CFG);
    expect(r.allowed).toBe(true);
  });

  it("超过总容量拒绝", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "big.png"), Buffer.alloc(900));
    const r = await checkQuota(dir, 200, CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("总容量");
  });

  it("超过单文件上限拒绝", async () => {
    const dir = await tempDir();
    const r = await checkQuota(dir, 600, CFG);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("单文件");
  });
});

describe("cleanupExpired", () => {
  it("删除过期文件,保留未过期文件", async () => {
    const dir = await tempDir();
    const now = Date.now();
    // 过期文件:手动设置 mtime 为过去(通过写后再改 mtime 不可靠,这里直接生成旧文件)。
    const oldFile = join(dir, "old.png");
    await writeFile(oldFile, Buffer.alloc(5));
    const past = new Date(now - 2 * 60 * 1000);
    // 用 utimes 设置旧时间。
    const { utimes } = await import("node:fs/promises");
    await utimes(oldFile, past, past);

    const newFile = join(dir, "new.png");
    await writeFile(newFile, Buffer.alloc(5));

    const removed = await cleanupExpired(dir, 60 * 1000);
    expect(removed).toBe(1);
    const remaining = await readdir(dir);
    expect(remaining).toContain("new.png");
    expect(remaining).not.toContain("old.png");
  });

  it("不跟随符号链接", async () => {
    const dir = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, "secret.txt"), Buffer.alloc(5));
    // 创建指向目录外的符号链接。
    const { symlink } = await import("node:fs/promises");
    await symlink(join(outside, "secret.txt"), join(dir, "link.txt")).catch(() => undefined);
    const stats = await computeDirStats(dir);
    expect(stats.fileCount).toBe(0); // 符号链接不计入
  });
});
