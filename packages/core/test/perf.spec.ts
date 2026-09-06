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

import { PreviewPipeline } from "../src/preview/pipeline.js";

/** 构造一篇含较多内容块的长文(模拟真实预览输入)。 */
function longMarkdown(paragraphs: number): string {
  let md = "# 长文预览性能测试\n\n";
  for (let i = 0; i < paragraphs; i++) {
    md += `## 小节 ${i}\n\n这是第 ${i} 段正文,包含一些**加粗**、*斜体*、\`代码\` 和[链接](https://example.com/${i})。\n\n`;
  }
  md += "![配图](https://img.example.com/1.png)\n";
  return md;
}

describe("性能预算 — 预览管线(4 平台,长文)", () => {
  it("冷启动(无缓存)全量适配 p95 < 100ms,热缓存命中 p95 < 50ms", async () => {
    const pipe = new PreviewPipeline();
    const md = longMarkdown(20); // 20 段 + 标题 + 图
    const input = { markdown: md, selectedPlatforms: FOUR_PLATFORMS };

    // 预热一次(确保模块已加载)。
    pipe.adapt(input);

    // 冷启动:源变化触发全量重算。
    const cold: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      pipe.adapt({ ...input, markdown: `${md}\n\n第 ${i} 次。` });
      cold.push(performance.now() - t0);
    }

    // 热缓存:相同输入全命中。
    const hot: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      pipe.adapt(input);
      hot.push(performance.now() - t0);
    }

    const p95 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)]!;
    };
    const coldP95 = p95(cold);
    const hotP95 = p95(hot);

    // 路线图预算:冷启动 p95 < 100ms;热缓存 p95 < 50ms。
    // (节点 CI 上核心逻辑为纯 CPU,无 DOM,预算宽松以容忍 CI 抖动。)
    expect(coldP95).toBeLessThan(100);
    expect(hotP95).toBeLessThan(50);
    // 热缓存显著快于冷启动(命中有效)。
    expect(hotP95).toBeLessThan(coldP95);
  });
});
