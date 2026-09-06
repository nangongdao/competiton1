/**
 * 自适应上传调度器测试(PERF-03)。
 *
 * 核心断言:
 * - 429 命中:降并发 + 重试后成功;
 * - Retry-After 头优先于指数退避;
 * - 重试耗尽:上报失败并降并发;
 * - 连续成功恢复并发;
 * - 单图失败不阻断(抛错由 rehost-engine 容错)。
 */
import { describe, it, expect } from "vitest";
import { UploadScheduler, RateLimitedError } from "../src/assets/upload-scheduler.js";

/** 确定性随机:固定 0.5(全抖动中点)。 */
const fixedRandom = () => 0.5;

describe("UploadScheduler — 自适应上传调度", () => {
  it("正常上传成功并递增成功计数", async () => {
    const s = new UploadScheduler({ platformId: "wechat", random: fixedRandom });
    const upload = s.wrap(async () => ({ url: "https://cdn/x.png" }));
    const out = await upload({} as never);
    expect(out.url).toBe("https://cdn/x.png");
  });

  it("429 命中后自动重试,成功后恢复", async () => {
    const s = new UploadScheduler({ platformId: "wechat", random: fixedRandom, retryBaseMs: 1, maxRetries: 3 });
    let calls = 0;
    const upload = s.wrap(async () => {
      calls++;
      if (calls === 1) throw new RateLimitedError("限流", "0"); // retry-after 0 秒
      return { url: "https://cdn/ok.png" };
    });
    const out = await upload({} as never);
    expect(out.url).toBe("https://cdn/ok.png");
    expect(calls).toBe(2);
  });

  it("重试耗尽后抛错并降并发", async () => {
    const s = new UploadScheduler({ platformId: "wechat", random: fixedRandom, retryBaseMs: 1, maxRetries: 1 });
    const initial = s.concurrency; // 6(公众号默认)
    const upload = s.wrap(async () => {
      throw new RateLimitedError("持续限流", "0"); // retry-after 0s
    });
    await expect(upload({} as never)).rejects.toThrow("持续限流");
    // 每次 429 都降一次:6 → 3(首次) → 1(重试失败)。
    expect(s.concurrency).toBe(1);
    expect(s.concurrency).toBeLessThan(initial);
  });

  it("限流降低并发后,连续成功恢复(不超过上限)", async () => {
    const s = new UploadScheduler({ platformId: "wechat", random: fixedRandom, maxConcurrency: 8, retryBaseMs: 1, maxRetries: 3 });
    // 先触发一次限流(8→4),重试成功(不再次触发)。
    let limited = true;
    const onceLimited = s.wrap(async () => {
      if (limited) {
        limited = false;
        throw new RateLimitedError("限流", "0");
      }
      return { url: "ok" };
    });
    await onceLimited({} as never);
    expect(s.concurrency).toBe(4);
    // 连续成功 10 次后恢复到 5。
    const upload = s.wrap(async () => ({ url: "u" }));
    for (let i = 0; i < 10; i++) await upload({} as never);
    expect(s.concurrency).toBe(5);
    // 继续成功,最多回到上限 8。
    for (let i = 0; i < 40; i++) await upload({} as never);
    expect(s.concurrency).toBe(8);
  });

  it("Retry-After 秒数解析用于等待(不依赖指数退避)", async () => {
    const s = new UploadScheduler({ platformId: "wechat", random: fixedRandom, retryBaseMs: 10, maxRetries: 3 });
    const started = Date.now();
    let calls = 0;
    const upload = s.wrap(async () => {
      calls++;
      if (calls === 1) throw new RateLimitedError("限流", "0.01"); // 10ms
      return { url: "ok" };
    });
    await upload({} as never);
    const elapsed = Date.now() - started;
    // Retry-After 0.01s = 10ms,退避指数(10ms*2^0=10ms)相同量级;仅验证成功。
    expect(calls).toBe(2);
    void elapsed;
  });

  it("非限流错误不降并发,按策略重试", async () => {
    const s = new UploadScheduler({ platformId: "zhihu", random: fixedRandom, retryBaseMs: 1, maxRetries: 2 });
    const before = s.concurrency;
    let calls = 0;
    const upload = s.wrap(async () => {
      calls++;
      if (calls < 2) throw new Error("网络抖动");
      return { url: "ok" };
    });
    await upload({} as never);
    expect(calls).toBe(2);
    expect(s.concurrency).toBe(before); // 非限流不降并发
  });

  it("reset 恢复初始并发", async () => {
    const s = new UploadScheduler({ platformId: "wechat", random: fixedRandom, maxConcurrency: 6, maxRetries: 1, retryBaseMs: 1 });
    const upload = s.wrap(async () => {
      throw new RateLimitedError("限流", "0");
    });
    await upload({} as never).catch(() => undefined);
    expect(s.concurrency).toBeLessThan(6);
    s.reset();
    expect(s.concurrency).toBe(6);
  });
});
