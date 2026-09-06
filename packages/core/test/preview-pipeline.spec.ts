/**
 * PreviewPipeline 单元测试(PERF-01)。
 *
 * 核心断言:
 * - 相同输入全命中缓存(parse + platform),结果引用不变(零拷贝);
 * - 源文本变化只重解析(平台链路重算),其余不变;
 * - 仅单平台配置/覆盖变化,只重跑该平台,其它平台命中缓存;
 * - 缓存统计可观测(供性能预算测试断言)。
 */
import { describe, it, expect } from "vitest";
import { PreviewPipeline } from "../src/preview/pipeline.js";

const MD = "# 测试标题\n\n正文内容,用于预览管线缓存测试。\n\n## 小节\n\n另一段正文。";
const PLATFORMS = ["wechat", "zhihu", "bilibili", "xiaohongshu"];

function input(overrides?: Parameters<PreviewPipeline["adapt"]>[0]) {
  return {
    markdown: MD,
    selectedPlatforms: PLATFORMS,
    ...overrides,
  };
}

describe("PreviewPipeline — 分层缓存", () => {
  it("相同输入重复调用全部命中缓存,产物引用不变(零拷贝)", () => {
    const pipe = new PreviewPipeline();
    const first = pipe.adapt(input());
    const second = pipe.adapt(input());
    expect(first).toHaveLength(PLATFORMS.length);
    for (let i = 0; i < first.length; i++) {
      expect(second[i]!.trace.cacheLayer).toBe("platform");
      expect(second[i]!.artifact?.payload).toBe(first[i]!.artifact?.payload);
      expect(second[i]!.quality).toBe(first[i]!.quality);
    }
    // parse 命中,平台链路全部命中。
    const s = pipe.cacheStats;
    expect(s.parseHits).toBe(1);
    expect(s.parseMisses).toBe(1);
    expect(s.platformHits).toBe(PLATFORMS.length);
  });

  it("源文本变化时重解析并清空平台缓存,全部重算", () => {
    const pipe = new PreviewPipeline();
    pipe.adapt(input());
    const next = pipe.adapt(input({ markdown: `${MD}\n\n新增一段。` }));
    for (const r of next) {
      expect(r.trace.cacheLayer).toBe("none");
    }
    const s = pipe.cacheStats;
    expect(s.parseMisses).toBe(2);
    expect(s.platformMisses).toBe(PLATFORMS.length * 2);
  });

  it("仅单平台配置变化时,只重跑该平台,其余平台命中缓存", () => {
    const pipe = new PreviewPipeline();
    const first = pipe.adapt(input());
    const wechatFirst = first.find((r) => r.platformId === "wechat")!.artifact!.payload;

    const second = pipe.adapt(
      input({ config: { wechat: { bannedWords: ["旧词"] } } }),
    );
    for (const r of second) {
      if (r.platformId === "wechat") {
        expect(r.trace.cacheLayer).toBe("none");
      } else {
        expect(r.trace.cacheLayer).toBe("platform");
        expect(r.artifact!.payload).toBe(first.find((x) => x.platformId === r.platformId)!.artifact!.payload);
      }
    }
    expect(second.find((r) => r.platformId === "wechat")!.artifact!.payload).not.toBe(wechatFirst);
  });

  it("仅单个平台覆盖层变化也按平台粒度失效", () => {
    const pipe = new PreviewPipeline();
    pipe.adapt(input({ overrides: { wechat: { title: "原标题" } } }));
    const second = pipe.adapt(input({ overrides: { wechat: { title: "新标题" } } }));
    expect(second.find((r) => r.platformId === "wechat")!.trace.cacheLayer).toBe("none");
    expect(second.find((r) => r.platformId === "zhihu")!.trace.cacheLayer).toBe("platform");
  });

  it("未注册平台被跳过并给出错误结果,不抛异常", () => {
    const pipe = new PreviewPipeline();
    const results = pipe.adapt(input({ selectedPlatforms: ["nonexistent"] }));
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("未注册");
  });

  it("clear() 强制下次全量重算并清零统计", () => {
    const pipe = new PreviewPipeline();
    pipe.adapt(input());
    pipe.clear();
    expect(pipe.cacheStats.parseHits).toBe(0);
    expect(pipe.cacheStats.platformHits).toBe(0);
    const next = pipe.adapt(input());
    expect(next[0]!.trace.cacheLayer).toBe("none");
  });

  it("产物内容与 syncToPlatforms(stageOnly) 一致(可消费)", () => {
    const pipe = new PreviewPipeline();
    const results = pipe.adapt(input());
    const wechat = results.find((r) => r.platformId === "wechat")!;
    expect(wechat.artifact?.payload.title).toBe("测试标题");
    expect(wechat.report).toBeDefined();
    expect(wechat.quality?.overall).toBeGreaterThanOrEqual(0);
    expect(wechat.ok).toBe(true);
  });
});
