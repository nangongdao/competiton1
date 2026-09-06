import { describe, it, expect } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import { syncToPlatforms } from "../src/sync/sync-engine.js";
import type { Publisher, PublishReceipt } from "../src/publish/types.js";

const SAMPLE = "# 测试标题\n\n正文内容。\n\n![图](https://e.com/i.png)";
const fixedNow = () => "2026-01-01T00:00:00.000Z";

describe("syncToPlatforms", () => {
  it("对多平台各自产出独立结果", async () => {
    const doc = markdownToIR(SAMPLE).document;
    const results = await syncToPlatforms(doc, ["wechat", "zhihu", "bilibili", "xiaohongshu"], {
      now: fixedNow,
    });
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.artifact).toBeDefined();
      expect(r.report).toBeDefined();
    }
  });

  it("默认模拟发布产出 mock 回执", async () => {
    const doc = markdownToIR(SAMPLE).document;
    const results = await syncToPlatforms(doc, ["wechat"], { now: fixedNow });
    expect(results[0]!.receipt?.status).toBe("mock");
    expect(results[0]!.receipt?.at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stageOnly 不产生回执", async () => {
    const doc = markdownToIR(SAMPLE).document;
    const results = await syncToPlatforms(doc, ["zhihu"], { stageOnly: true, now: fixedNow });
    expect(results[0]!.receipt).toBeUndefined();
    expect(results[0]!.artifact).toBeDefined();
  });

  it("校验 error 阻止发布(小红书无图)", async () => {
    const doc = markdownToIR("# 标题\n\n纯文字无图").document;
    const results = await syncToPlatforms(doc, ["xiaohongshu"], { now: fixedNow });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.receipt).toBeUndefined();
    expect(results[0]!.error).toContain("校验未通过");
  });

  it("未注册平台返回独立错误,不抛异常", async () => {
    const doc = markdownToIR(SAMPLE).document;
    const results = await syncToPlatforms(doc, ["nonexistent", "wechat"], { now: fixedNow });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("未注册");
    expect(results[1]!.ok).toBe(true); // 其它平台不受影响
  });

  it("自定义发布器被调用", async () => {
    const doc = markdownToIR(SAMPLE).document;
    const calls: string[] = [];
    const custom: Publisher = {
      kind: "custom",
      stage(payload, ctx) {
        calls.push(`stage:${ctx.platformId}`);
        return { platformId: ctx.platformId, payload, deliverable: payload.content, instructions: [] };
      },
      async confirm(artifact, ctx): Promise<PublishReceipt> {
        calls.push(`confirm:${ctx.platformId}`);
        return { platformId: artifact.platformId, status: "submitted", message: "ok", at: ctx.now() };
      },
    };
    const results = await syncToPlatforms(doc, ["wechat"], { publishers: { wechat: custom }, now: fixedNow });
    expect(calls).toEqual(["stage:wechat", "confirm:wechat"]);
    expect(results[0]!.receipt?.status).toBe("submitted");
  });
});
