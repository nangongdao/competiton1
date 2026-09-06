/**
 * v11 Part 2 · 视觉与多媒体 AI 纯函数测试(MEDIA-01)。
 */
import { describe, expect, it } from "vitest";
import {
  COVER_RATIOS,
  COVER_STYLES,
  suggestCoversRule,
  suggestCovers,
  coverHeadlineRule,
  coverSublineRule,
  parseCoverJson,
  adaptVideoRule,
  buildAnchorStoryboardRule,
  buildAnchorStoryboard,
  parseAnchorJson,
} from "../src/media-ai/media-ai.js";
import { NoopLlm } from "../src/llm/noop-llm.js";

const TITLE = "如何用 AI 提升内容团队 10 倍产出效率";
const MD = `# 如何用 AI 提升内容团队 10 倍产出效率

## 三个核心方法
用 AI 做选题、改写与复盘,能显著提升效率。`;

describe("media-ai — MEDIA-01 封面生成", () => {
  it("规则封面建议:比例/标题/风格", () => {
    const covers = suggestCoversRule(TITLE, MD, ["xiaohongshu", "wechat", "video"]);
    expect(covers.length).toBe(3);
    const xhs = covers[0]!;
    expect(xhs.platformId).toBe("xiaohongshu");
    expect(xhs.ratio).toBe("3:4");
    expect(xhs.headline.length).toBeLessThanOrEqual(12);
    expect(xhs.notes.length).toBeGreaterThan(0);
    expect(COVER_STYLES).toContain(xhs.style);
  });

  it("平台比例映射", () => {
    expect(COVER_RATIOS["wechat"]).toBe("2.35:1");
    expect(COVER_RATIOS["video"]).toBe("1:1");
    expect(COVER_RATIOS["bilibili"]).toBe("16:9");
  });

  it("封面标题/副标题派生", () => {
    expect(coverHeadlineRule(TITLE, MD).length).toBeLessThanOrEqual(12);
    expect(coverSublineRule(MD).length).toBeGreaterThan(0);
  });

  it("LLM 失败回退规则", async () => {
    const r = await suggestCovers(TITLE, MD, new NoopLlm());
    expect(r.usedLlm).toBe(false);
    expect(r.covers.length).toBe(3);
  });

  it("parseCoverJson 解析", () => {
    const parsed = parseCoverJson(
      '[{"platformId":"xiaohongshu","headline":"标题","style":"极简","notes":["a"]}]',
    );
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.headline).toBe("标题");
    expect(parseCoverJson("bad")).toEqual([]);
  });
});

describe("media-ai — MEDIA-01 视频重构与数字人", () => {
  it("横屏转竖屏建议", () => {
    const v = adaptVideoRule("landscape", 300, "douyin");
    expect(v.targetOrientation).toBe("portrait");
    expect(v.resolution).toBe("1080x1920");
    expect(v.splitCount).toBeGreaterThan(1);
    expect(v.autoSubtitle).toBe(true);
    expect(v.cropStrategy).toContain("横屏转竖屏");
  });

  it("竖屏视频不改裁切方向", () => {
    const v = adaptVideoRule("portrait", 60, "shipinhao");
    expect(v.cropStrategy).toContain("已是竖屏");
  });

  it("数字人分镜规则版", () => {
    const s = buildAnchorStoryboardRule(TITLE, MD);
    expect(s.durationSeconds).toBe(60);
    expect(s.script.length).toBeGreaterThan(10);
    expect(s.shots.length).toBeGreaterThanOrEqual(3);
    expect(s.source).toBe("rule");
  });

  it("数字人分镜 LLM 失败回退规则", async () => {
    const s = await buildAnchorStoryboard(TITLE, MD, new NoopLlm());
    expect(s.source).toBe("rule");
  });

  it("parseAnchorJson 解析", () => {
    const parsed = parseAnchorJson(
      '{"title":"T","script":"口播","shots":[{"time":"0:00","scene":"开场","action":"打招呼"}]}',
    );
    expect(parsed?.script).toBe("口播");
    expect(parsed?.shots.length).toBe(1);
    expect(parseAnchorJson("bad")).toBeNull();
  });
});
