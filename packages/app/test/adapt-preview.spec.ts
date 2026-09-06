import { describe, it, expect } from "vitest";
import { adaptPreview } from "../src/workers/adapt-preview.js";

const MD = "# 测试标题\n\n这是一段用于验证预览适配的正文。\n\n## 小节\n\n更多内容。";

describe("adaptPreview — 预览适配(Worker 与主线程共用逻辑)", () => {
  it("对所选平台产出 stageOnly 结果(不触网、无回执)", async () => {
    const results = await adaptPreview({
      markdown: MD,
      authorName: "测试作者",
      tags: ["测试"],
      selectedPlatforms: ["wechat", "zhihu"],
    });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.platformId).toMatch(/^(wechat|zhihu)$/);
      expect(r.ok).toBe(true);
      expect(r.report?.hasError).toBe(false);
      // stageOnly:无 confirm 回执。
      expect(r.receipt).toBeUndefined();
      // 有序列化产物可预览。
      expect(r.artifact?.payload.title).toBe("测试标题");
    }
  });

  it("小红书纯文本平台仍产出 payload", async () => {
    const results = await adaptPreview({
      markdown: "# 小红书标题\n\n正文内容,带 #话题# 标签。",
      authorName: "作者",
      tags: ["话题"],
      selectedPlatforms: ["xiaohongshu"],
    });
    expect(results[0]!.artifact?.payload.mime).toBe("text/plain");
  });

  it("未注册平台返回 error 结果而非抛异常", async () => {
    const results = await adaptPreview({
      markdown: MD,
      authorName: "",
      tags: [],
      selectedPlatforms: ["nonexistent"],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("未注册");
  });
});
