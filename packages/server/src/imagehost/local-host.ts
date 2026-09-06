/** 本地落盘图床 —— 把图片写入磁盘目录,经 @fastify/static 暴露为公开 URL。
 *
 * 部署到公网服务器时,localBaseUrl 指向对外域名即成为真实图床。
 * 本机开发时作为零配置兜底(无需任何对象存储凭据即可端到端跑通)。
 *
 * 容量安全(SEC-05):单文件上限 + 总容量配额 + 过期清理,防止长期运行耗尽磁盘。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ImageHost, ImageUploadResult } from "@mpp/core";
import type { LocalImageStoreConfig } from "../config.js";
import { checkQuota, cleanupExpired } from "../security/local-store.js";

export class LocalImageHost implements ImageHost {
  readonly id = "local";

  /**
   * @param dir 落盘目录(相对 server 包根或绝对路径)
   * @param baseUrl 公开访问基址(最终 URL = baseUrl + "/uploads/" + filename)
   * @param store 配额/保留配置
   * @param onWarn 清理/配额告警回调(可选)
   */
  constructor(
    private readonly dir: string,
    private readonly baseUrl: string,
    private readonly store: LocalImageStoreConfig,
    private readonly onWarn?: (msg: string) => void,
  ) {}

  async upload(bytes: Uint8Array, filename: string, _mime: string): Promise<ImageUploadResult> {
    const absDir = resolve(this.dir);
    await mkdir(absDir, { recursive: true });

    // 容量配额:先检查再落盘(含单文件上限)。
    const quota = await checkQuota(absDir, bytes.byteLength, this.store);
    if (!quota.allowed) {
      throw new Error(quota.reason ?? "图床配额不足");
    }

    // 内容哈希前缀防止重名覆盖,保留原扩展名。
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const safeName = `${hash}-${filename.replace(/[^\w.-]/g, "_")}`;
    await writeFile(join(absDir, safeName), bytes);
    return { url: `${this.baseUrl}/uploads/${safeName}` };
  }

  /** 清理过期文件;返回删除数量(供启动时调用)。 */
  async cleanup(): Promise<number> {
    if (!this.store.cleanupEnabled) return 0;
    try {
      const removed = await cleanupExpired(this.dir, this.store.retentionMs);
      if (removed > 0) this.onWarn?.(`已清理 ${removed} 个过期图片(保留 ${this.store.retentionMs / 86_400_000} 天)`);
      return removed;
    } catch (err) {
      this.onWarn?.(`图床清理失败: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
}
