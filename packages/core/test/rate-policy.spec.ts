import { describe, it, expect } from "vitest";
import {
  PLATFORM_RATE_POLICY,
  DEFAULT_RATE_POLICY,
  ratePolicyFor,
  AdaptiveConcurrency,
  jitteredBackoff,
  parseRetryAfter,
} from "../src/assets/rate-policy.js";

describe("ratePolicyFor — 平台限流策略", () => {
  it("公众号限流最严,资产并发 3", () => {
    expect(ratePolicyFor("wechat").assetConcurrency).toBe(3);
  });

  it("知乎/小红书资产并发 6,B站 4", () => {
    expect(ratePolicyFor("zhihu").assetConcurrency).toBe(6);
    expect(ratePolicyFor("bilibili").assetConcurrency).toBe(4);
    expect(ratePolicyFor("xiaohongshu").assetConcurrency).toBe(6);
  });

  it("未知平台回退默认策略", () => {
    expect(ratePolicyFor("unknown-platform")).toEqual(DEFAULT_RATE_POLICY);
  });

  it("默认策略与平台表为独立对象(不共享引用)", () => {
    expect(PLATFORM_RATE_POLICY).not.toContainEqual(DEFAULT_RATE_POLICY);
  });
});

describe("AdaptiveConcurrency — AIMD 自适应并发", () => {
  it("初始值为上限", () => {
    expect(new AdaptiveConcurrency(6).value).toBe(6);
  });

  it("命中限流时并发减半,不破下限", () => {
    const c = new AdaptiveConcurrency(6, 1);
    c.onRateLimited(); // 6 → 3
    c.onRateLimited(); // 3 → 1
    c.onRateLimited(); // 1 → 1(下限)
    expect(c.value).toBe(1);
  });

  it("连续成功 10 次后并发 +1,不超过上限", () => {
    const c = new AdaptiveConcurrency(4, 1);
    c.onRateLimited(); // 4 → 2
    expect(c.value).toBe(2);
    for (let i = 0; i < 10; i++) c.onSuccess();
    expect(c.value).toBe(3);
    for (let i = 0; i < 10; i++) c.onSuccess();
    expect(c.value).toBe(4);
    for (let i = 0; i < 10; i++) c.onSuccess();
    expect(c.value).toBe(4); // 不超上限
  });

  it("限流后成功计数清零,需重新积累才能恢复", () => {
    const c = new AdaptiveConcurrency(8, 1);
    c.onRateLimited(); // 8 → 4
    for (let i = 0; i < 9; i++) c.onSuccess();
    c.onRateLimited(); // 4 → 2,streak 清零
    expect(c.value).toBe(2);
    for (let i = 0; i < 9; i++) c.onSuccess();
    expect(c.value).toBe(2); // streak 未满 10
    c.onSuccess();
    expect(c.value).toBe(3);
  });

  it("reset 恢复初始并发", () => {
    const c = new AdaptiveConcurrency(6, 1);
    c.onRateLimited();
    c.onRateLimited();
    expect(c.value).toBeLessThan(6);
    c.reset();
    expect(c.value).toBe(6);
  });

  it("initial 参数可低于上限起跑", () => {
    expect(new AdaptiveConcurrency(6, 1, 2).value).toBe(2);
  });
});

describe("jitteredBackoff — 指数退避 + 抖动", () => {
  it("首次退避在 base*0.5 ~ base*1.5 之间(全抖动)", () => {
    const v = jitteredBackoff(1000, 1);
    expect(v).toBeGreaterThanOrEqual(500);
    expect(v).toBeLessThanOrEqual(1500);
  });

  it("尝试次数越高退避越久(期望值递增)", () => {
    // attempt=3 的指数基数更高(2^2=4x vs 2^1=2x),期望值翻倍。
    // 注:全抖动下两者范围有重叠,单次抽样可能 low>high,故用多次抽样均值验证期望。
    const sampleMean = (attempt: number) => {
      let sum = 0;
      const n = 500;
      for (let i = 0; i < n; i++) sum += jitteredBackoff(500, attempt);
      return sum / n;
    };
    const lowMean = sampleMean(2);
    const highMean = sampleMean(3);
    // 理论均值 1000 vs 2000;宽松断言(避免机器抖动误报)。
    expect(highMean).toBeGreaterThan(lowMean);
    expect(highMean).toBeGreaterThan(1500);
    expect(lowMean).toBeLessThan(1500);
  });

  it("attempt 从 1 开始不产生 0 延迟", () => {
    for (let i = 0; i < 50; i++) {
      expect(jitteredBackoff(100, 1)).toBeGreaterThan(0);
    }
  });
});

describe("parseRetryAfter — 解析 Retry-After 头", () => {
  it("秒数格式", () => {
    expect(parseRetryAfter("5")).toBe(5000);
  });

  it("HTTP 日期格式", () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const v = parseRetryAfter(future);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(4000);
  });

  it("空/非法返回 null", () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("abc")).toBeNull();
  });
});
