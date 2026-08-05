/**
 * 性能回归测试(UPGRADE §7)—— 守护"重托管并发化"不被无意回退。
 *
 * 核心断言:图片上传以受控并发执行,发布总耗时远低于串行基线;
 * 若某天有人把 mapWithConcurrency 改回 for-await 串行,本测试会立即失败。
 */
import { describe, it, expect } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import { syncToPlatforms } from "../src/sync/sync-engine.js";
import type { RehostContext } from "../src/adapters/types.js";

const FOUR_PLATFORMS = ["wechat", "zhihu", "bilibili", "xiaohongshu"];
const fixedNow = () => "2026-01-01T00:00:00.000Z";

/** 构造 N 张不同源图片的文档。 */
function docWithImages(count: number) {
  let md = "# 性能测试\n\n正文。\n";
  for (let i = 0; i < count; i++) md += `\n![图${i}](https://img.example.com/${i}.png)`;
  return markdownToIR(md).document;
}

describe("性能回归 — 重托管并发化(4 平台 × 12 图)", () => {
  it("300ms/图 的慢速图床下,发布应在 2 秒内完成(串行基线 14.4s)", async () => {
    const doc = docWithImages(12);
    const tracker = { active: 0, max: 0 };

    const makeCtx = (platformId: string): RehostContext => ({
      platformId,
      upload: async () => {
        tracker.active++;
        tracker.max = Math.max(tracker.max, tracker.active);
        // 模拟慢速图床:单图 300ms(含网络往返)。
        await new Promise((r) => setTimeout(r, 300));
        tracker.active--;
        return { url: `https://cdn/${platformId}/x.png` };
      },
    });

    const rehost = Object.fromEntries(FOUR_PLATFORMS.map((id) => [id, makeCtx(id)]));
    const start = performance.now();
    const results = await syncToPlatforms(doc, FOUR_PLATFORMS, {
      stageOnly: true,
      now: fixedNow,
      rehost,
    });
    const elapsed = performance.now() - start;

    // 全部平台产出暂存产物(供预览)。
    expect(results).toHaveLength(4);
    for (const r of results) expect(r.artifact).toBeDefined();

    // 单平台 12 图串行 = 3600ms;此处绝不允许退回串行。
    const serialPerPlatformMs = 12 * 300;
    expect(elapsed).toBeLessThan(serialPerPlatformMs * 0.6);
    // 4 平台 × 12 图 ≤ 2s(文档目标;当前实现约 1.2-1.8s)。
    expect(elapsed).toBeLessThan(2000);

    // 并发确实发生:存在同时在途上传(串行实现 max 恒为 1)。
    expect(tracker.max).toBeGreaterThanOrEqual(2);
  });
});
