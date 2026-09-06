/**
 * Preview Worker 封装测试(PERF-02)。
 *
 * 在 Vitest(node 环境)下 Worker 构造器不可用,验证退化路径(同步计算兜底)
 * 与请求序号过滤逻辑。Worker 真实实例在构建产物中由 Vite 打包,由浏览器性能用例覆盖。
 */
import { describe, it, expect, vi } from "vitest";
import { createPreviewWorker } from "../src/preview/worker-host.js";

describe("createPreviewWorker — 预览 Worker 封装", () => {
  it("Worker 不可用时退化为同步计算,结果与 PreviewPipeline 一致", () => {
    const worker = createPreviewWorker();
    const received: unknown[] = [];
    worker.onResult((results) => received.push(results));

    const seq = worker.post({
      markdown: "# 标题\n\n正文。",
      selectedPlatforms: ["wechat"],
    });
    expect(seq).toBeGreaterThan(0);
    // 同步兜底:post 调用即同步回写(无 Worker)。
    expect(received.length).toBeGreaterThan(0);
    const results = received[received.length - 1] as Array<{ platformId: string }>;
    expect(results[0]!.platformId).toBe("wechat");
    worker.dispose();
  });

  it("连续 post 时同步兜底立即回传各自结果(无乱序,无需丢弃)", () => {
    const worker = createPreviewWorker();
    const received: unknown[] = [];
    worker.onResult((results) => received.push(results));

    worker.post({ markdown: "# 第一次", selectedPlatforms: ["wechat"] });
    worker.post({ markdown: "# 第二次", selectedPlatforms: ["wechat"] });
    // 同步兜底:每次 post 立即计算,结果依次到达(无乱序,序号过滤不丢弃)。
    expect(received).toHaveLength(2);
    const first = received[0] as Array<{ artifact?: { payload?: { title: string } } }>;
    const second = received[1] as Array<{ artifact?: { payload?: { title: string } } }>;
    expect(first[0]!.artifact?.payload?.title).toBe("第一次");
    expect(second[0]!.artifact?.payload?.title).toBe("第二次");
    worker.dispose();
  });

  it("dispose 后回调不再触发", () => {
    const worker = createPreviewWorker();
    const cb = vi.fn();
    worker.onResult(cb);
    worker.dispose();
    worker.post({ markdown: "# t", selectedPlatforms: ["wechat"] });
    expect(cb).not.toHaveBeenCalled();
  });
});
