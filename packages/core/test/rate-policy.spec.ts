import { describe, it, expect } from "vitest";
import {
  PLATFORM_RATE_POLICY,
  DEFAULT_RATE_POLICY,
  ratePolicyFor,
  AdaptiveConcurrency,
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
