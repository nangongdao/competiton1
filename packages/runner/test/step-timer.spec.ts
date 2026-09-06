import { describe, expect, it } from "vitest";
import { StepTimer, formatStepTiming, isStepSlow, type PublishStep } from "../src/diagnostics/step-timer.js";

describe("StepTimer(§6.2 分步耗时观测)", () => {
  it("begin/end 记录每步耗时并汇总总耗时", () => {
    const timer = new StepTimer();
    const endOpen = timer.begin("open-session", "打开浏览器会话");
    endOpen();
    const endGoto = timer.begin("goto-editor", "打开平台编辑器");
    endGoto();

    const summary = timer.summarize();
    expect(summary.samples).toHaveLength(2);
    expect(summary.samples[0]).toMatchObject({ step: "open-session", label: "打开浏览器会话" });
    expect(summary.samples[1].step).toBe("goto-editor");
    expect(summary.totalMs).toBeGreaterThanOrEqual(0);
    expect(summary.slowSteps).toHaveLength(0);
  });

  it("超过预算的步骤被标记为 exceeded", () => {
    let t = 0;
    const timer = new StepTimer(() => t);
    const end = timer.begin("prepare", "检测登录/风控", 100);
    t = 150; // 模拟耗时 150ms > 预算 100ms
    end();

    const sample = timer.snapshot[0]!;
    expect(sample.exceeded).toBe(true);
    expect(isStepSlow(sample)).toBe(true);
  });

  it("summarize 用预算表判定慢步骤", () => {
    let t = 0;
    const timer = new StepTimer(() => t);
    const end = timer.begin("submit", "填写并点击发布", 1000);
    t = 5000; // 模拟耗时 5s > 预算 1s
    end();

    const slow = timer.summarize({ submit: 10 });
    expect(slow.slowSteps).toHaveLength(1);
    expect(slow.slowSteps[0]!.step).toBe("submit");
  });

  it("formatStepTiming 输出可读文本", () => {
    const timer = new StepTimer();
    timer.begin("open-session", "打开浏览器会话")(0);
    const summary = timer.summarize();
    const text = formatStepTiming(summary);
    expect(text).toContain("步骤耗时");
    expect(text).toContain("open-session");
  });

  it("未开始任何步骤时汇总为空", () => {
    const timer = new StepTimer();
    const summary = timer.summarize();
    expect(summary.samples).toHaveLength(0);
    expect(summary.totalMs).toBe(0);
  });

  it("支持任意步骤枚举(未来扩展步骤不破坏类型)", () => {
    const steps: PublishStep[] = ["open-session", "goto-editor", "prepare", "confirm", "submit", "verify", "artifacts"];
    expect(steps).toHaveLength(7);
  });
});
