/**
 * local 图床配额与保留策略 —— 防止上传无上限耗尽磁盘。
 *
 * - 总容量配额:达到 maxTotalBytes 后拒绝新上传;
 * - 单文件上限:maxFileBytes;
 * - 保留周期:过期文件在清理时删除(不越过 uploads 根目录)。
 *
 * 路径安全:所有清理/统计只在配置的根目录内递归,绝不跟随符号链接越过边界。
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LocalImageStoreConfig } from "../config.js";

/** 目录统计结果。 */
export interface DirStats {
  readonly totalBytes: number;
  readonly fileCount: number;
}

/**
 * 递归统计目录总字节数与文件数(仅统计,不修改)。
 *
 * 安全:使用 lstat 判断符号链接并跳过,绝不跟随,防止链接指向目录外。
 */
export async function computeDirStats(root: string): Promise<DirStats> {
  const absRoot = resolve(root);
  let totalBytes = 0;
  let fileCount = 0;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      // 符号链接一律跳过(不统计、不删除),防止越界。
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile()) {
        try {
          const st = await stat(full);
          totalBytes += st.size;
          fileCount += 1;
        } catch {
          /* 文件被并发删除则忽略 */
        }
      }
    }
  }

  await walk(absRoot);
  return { totalBytes, fileCount };
}

/**
 * 判断新上传是否在配额内。
 *
 * @param root 图床根目录
 * @param newBytes 待上传文件大小
 * @param cfg 配额配置
 * @returns { allowed, reason? }
 */
export async function checkQuota(root: string, newBytes: number, cfg: LocalImageStoreConfig): Promise<{ allowed: boolean; reason?: string }> {
  if (newBytes > cfg.maxFileBytes) {
    return { allowed: false, reason: `单文件超过上限(${cfg.maxFileBytes} 字节)` };
  }
  const stats = await computeDirStats(root);
  if (stats.totalBytes + newBytes > cfg.maxTotalBytes) {
    return { allowed: false, reason: `图床总容量已达上限(${cfg.maxTotalBytes} 字节)` };
  }
  return { allowed: true };
}

/**
 * 清理过期文件(按 mtime 超过 retentionMs 删除)。
 *
 * 只清理直接位于根目录下的文件与一级子目录内文件(上传产物按日期/哈希散列),
 * 不递归删除深层目录,避免误删。符号链接不跟随、不删除。
 *
 * @param root 图床根目录
 * @param retentionMs 保留周期
 * @returns 删除的文件数
 */
export async function cleanupExpired(root: string, retentionMs: number): Promise<number> {
  const absRoot = resolve(root);
  const cutoff = Date.now() - retentionMs;
  let removed = 0;

  const targets = [absRoot];
  try {
    const top = await readdir(absRoot, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        targets.push(join(absRoot, entry.name));
      }
    }
  } catch {
    return 0;
  }

  for (const dir of targets) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      try {
        const st = await stat(full);
        if (st.mtimeMs < cutoff) {
          await unlink(full);
          removed += 1;
        }
      } catch {
        /* 忽略并发删除/权限错误 */
      }
    }
  }

  return removed;
}
