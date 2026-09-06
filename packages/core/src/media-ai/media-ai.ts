/**
 * MEDIA-01 视觉与多媒体 AI 处理。
 *
 * - AI 封面生成:根据文章内容,生成多风格封面建议;支持对接 Midjourney / DALL-E
 *   (OpenAI 兼容)API 生成封面图,或从视频自动抽取高光帧作为封面;
 * - 视频横竖屏转换:长视频(B站/YouTube 横屏)重构为短视频(抖音/视频号竖屏)的
 *   处理建议(裁切窗口 / 安全区 / 字幕 / 分段);
 * - AI 数字人播报:输入图文,生成数字人讲解视频的脚本与分镜建议。
 *
 * 设计原则:
 * - 规则版确定性、离线可用(封面文案 / 裁切建议 / 分镜脚本);
 * - LLM 可用时增强封面文案与分镜;图片/视频处理本身需要外部工具链,
 *   本模块输出**结构化建议与占位指令**,不直接调媒体处理库;
 * - 纯 TS 零 DOM,可单测。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";
import { plainTextOf } from "../fission/fission.js";

/** 平台封面比例规范。 */
export const COVER_RATIOS: Readonly<Record<string, string>> = {
  xiaohongshu: "3:4",
  wechat: "2.35:1",
  video: "1:1",
  bilibili: "16:9",
  weibo: "3:4",
  zhihu: "16:9",
};

/** 封面风格预设。 */
export const COVER_STYLES = ["极简留白", "高饱和撞色", "杂志排版", "插画手绘", "科技渐变", "复古胶片"] as const;

/** 封面建议。 */
export interface CoverSuggestion {
  /** 目标平台。 */
  readonly platformId: string;
  /** 建议比例(如 "3:4")。 */
  readonly ratio: string;
  /** 封面主标题(≤12 字,放大突出)。 */
  readonly headline: string;
  /** 封面副标题/装饰文案。 */
  readonly subline: string;
  /** 建议风格。 */
  readonly style: string;
  /** 视觉要点(构图/配色建议)。 */
  readonly notes: readonly string[];
  /** 生成指令(供 Midjourney / DALL-E prompt 使用;LLM 增强时由 LLM 生成)。 */
  readonly prompt?: string;
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
}

/** 从标题/正文生成封面标题(规则版)。 */
export function coverHeadlineRule(title: string, text: string): string {
  const clean = plainTextOf(title).trim() || plainTextOf(text).slice(0, 24) || "内容精选";
  if (clean.length <= 12) return clean;
  // 截断到 12 字,尽量在标点/空格处断开。
  const cut = clean.slice(0, 12);
  const lastPunct = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"), cut.lastIndexOf(" "));
  return lastPunct > 4 ? cut.slice(0, lastPunct) : cut;
}

/** 从正文派生封面副标题(规则版)。 */
export function coverSublineRule(text: string): string {
  const t = plainTextOf(text);
  if (t.length > 0) return t.slice(0, 18);
  return "一次讲透 · 值得收藏";
}

/** 规则版封面建议。 */
export function suggestCoversRule(
  title: string,
  markdown: string,
  platforms: readonly string[] = ["xiaohongshu", "wechat", "video"],
): readonly CoverSuggestion[] {
  const text = plainTextOf(markdown);
  const headline = coverHeadlineRule(title, text);
  const subline = coverSublineRule(text);
  return platforms.map((platformId, i) => {
    const ratio = COVER_RATIOS[platformId] ?? "1:1";
    const style = COVER_STYLES[i % COVER_STYLES.length]!;
    return {
      platformId,
      ratio,
      headline,
      subline,
      style,
      notes: [
        `按 ${ratio} 比例构图,主体居中偏左(封面右侧留给正文)`,
        `主标题用${style}风格,保证小图可读`,
        `配色与正文首图一致,避免多图割裂`,
      ],
      source: "rule",
    };
  });
}

/** 封面 LLM 请求。 */
export function coverLlmRequest(
  title: string,
  markdown: string,
  platforms: readonly string[],
): LlmRequest {
  const text = plainTextOf(markdown).slice(0, 800);
  const prompt = `你是资深封面设计师。请为下面这篇文章,为平台 ${platforms.join("/")} 生成封面设计建议。只输出 JSON 数组,每个元素形如:
{"platformId":"平台id","headline":"封面主标题(≤12字)","subline":"副标题(≤18字)","style":"风格(如:极简留白/高饱和撞色)","prompt":"用于 Midjourney/DALL-E 的英文图片生成提示词","notes":["视觉要点1","视觉要点2"]}
不要输出 JSON 之外的任何文字。

标题:${title.trim() || "(未命名)"}
正文:${text}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: platforms.length },
    systemPrompt: "你是封面设计助手,只输出结构化 JSON 数组,不加解释。",
    temperature: 0.7,
    maxTokens: 1500,
  };
}

/** 解析 LLM 封面结果(失败返回空数组)。 */
export function parseCoverJson(raw: string): readonly Omit<CoverSuggestion, "ratio" | "source">[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x): Omit<CoverSuggestion, "ratio" | "source"> | null => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const platformId = typeof o["platformId"] === "string" ? o["platformId"].trim() : "";
        const headline = typeof o["headline"] === "string" ? o["headline"].trim() : "";
        const style = typeof o["style"] === "string" ? o["style"].trim() : "";
        if (!platformId || !headline) return null;
        const subline = typeof o["subline"] === "string" ? o["subline"].trim() : "";
        const prompt = typeof o["prompt"] === "string" ? o["prompt"].trim() : undefined;
        const notes = Array.isArray(o["notes"])
          ? (o["notes"] as unknown[]).map((n) => String(n).trim()).filter((n) => n.length > 0).slice(0, 6)
          : [];
        return {
          platformId,
          headline: headline.slice(0, 12),
          subline: (subline || "点击查看全文").slice(0, 18),
          style: style || "极简留白",
          ...(prompt ? { prompt } : {}),
          notes: notes.length > 0 ? notes : ["已按平台比例生成封面建议"],
        };
      })
      .filter((x): x is Omit<CoverSuggestion, "ratio" | "source"> => x !== null);
  } catch {
    return [];
  }
}

/** 封面建议入口(LLM 失败自动回退规则)。 */
export async function suggestCovers(
  title: string,
  markdown: string,
  llm: LlmAdapter | undefined,
  options: { platforms?: readonly string[]; useLlm?: boolean } = {},
): Promise<{ covers: readonly CoverSuggestion[]; usedLlm: boolean }> {
  const platforms = options.platforms ?? ["xiaohongshu", "wechat", "video"];
  const rule = suggestCoversRule(title, markdown, platforms);
  if (options.useLlm === false || !llm?.available) return { covers: rule, usedLlm: false };
  try {
    const raw = await llm.run(coverLlmRequest(title, markdown, platforms));
    const parsed = parseCoverJson(raw);
    if (parsed.length === 0) throw new Error("LLM 封面为空");
    const covers = platforms.map((pid, i) => {
      const found = parsed.find((p) => p.platformId === pid) ?? parsed[i];
      if (!found) return rule[i]!;
      return {
        ...found,
        ratio: COVER_RATIOS[pid] ?? "1:1",
        source: "llm",
      } as CoverSuggestion;
    });
    return { covers, usedLlm: true };
  } catch {
    return { covers: rule, usedLlm: false };
  }
}

/** 视频方向。 */
export type VideoOrientation = "landscape" | "portrait";

/** 视频截取/重构建议。 */
export interface VideoAdaptSuggestion {
  readonly sourceOrientation: VideoOrientation;
  readonly targetOrientation: VideoOrientation;
  /** 目标平台。 */
  readonly platformId: string;
  /** 建议目标分辨率(如 1080x1920)。 */
  readonly resolution: string;
  /** 裁切策略(横屏转竖屏时的安全区说明)。 */
  readonly cropStrategy: string;
  /** 是否建议自动加字幕。 */
  readonly autoSubtitle: boolean;
  /** 字幕位置。 */
  readonly subtitlePosition: string;
  /** 建议拆分为几条短视频(长视频重构)。 */
  readonly splitCount: number;
  /** 分段脚本(每段的标题与时间段建议)。 */
  readonly segments: readonly { start: string; end: string; title: string }[];
  /** 是否建议抽取高光帧作封面。 */
  readonly highlightFrameCover: boolean;
}

/** 规则版视频重构建议。 */
export function adaptVideoRule(
  sourceOrientation: VideoOrientation,
  durationSeconds: number,
  target: "douyin" | "shipinhao" = "douyin",
): VideoAdaptSuggestion {
  const portrait = sourceOrientation === "landscape";
  const resolution = target === "douyin" ? "1080x1920" : "1080x1920";
  const splitCount = Math.max(1, Math.min(6, Math.ceil(durationSeconds / 90)));
  const segments = Array.from({ length: splitCount }, (_, i) => {
    const start = Math.floor((durationSeconds / splitCount) * i);
    const end = Math.floor((durationSeconds / splitCount) * (i + 1));
    return {
      start: `${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")}`,
      end: `${Math.floor(end / 60)}:${String(end % 60).padStart(2, "0")}`,
      title: `第 ${i + 1} 段:核心观点 ${i + 1}`,
    };
  });
  return {
    sourceOrientation,
    targetOrientation: "portrait",
    platformId: target === "douyin" ? "douyin" : "shipinhao",
    resolution,
    cropStrategy: portrait
      ? "横屏转竖屏:以主体为中心裁切中央 9:16 区域;若主体频繁移动,建议开启「智能追踪裁切」"
      : "已是竖屏,直接适配抖音/视频号;避免顶部/底部信息被遮挡",
    autoSubtitle: true,
    subtitlePosition: "下方 1/4 安全区,字号 ≥4% 屏高",
    splitCount,
    segments,
    highlightFrameCover: true,
  };
}

/** 数字人播报分镜。 */
export interface AnchorStoryboard {
  /** 视频标题。 */
  readonly title: string;
  /** 总时长建议(秒)。 */
  readonly durationSeconds: number;
  /** 口播文案。 */
  readonly script: string;
  /** 分镜列表。 */
  readonly shots: readonly { time: string; scene: string; action: string }[];
  /** 建议字幕/BGM 提示。 */
  readonly notes: readonly string[];
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
}

/** 规则版数字人播报分镜。 */
export function buildAnchorStoryboardRule(title: string, markdown: string): AnchorStoryboard {
  const text = plainTextOf(markdown);
  const intro = text.slice(0, 60);
  const points = text.slice(60, 200) || "具体要点";
  const script = `大家好,今天来聊一聊「${title.trim().slice(0, 20) || "这个话题"}」。${intro}。我们把它拆成三个要点来说:第一,${points.slice(0, 30)};第二,${points.slice(30, 60)};第三,${points.slice(60, 90)}。如果对你有帮助,欢迎点赞关注。`;
  const shots = [
    { time: "0:00-0:05", scene: "开场正面近景", action: "打招呼 + 抛出主题" },
    { time: "0:05-0:20", scene: "中景 + 关键词字幕", action: "讲第一个要点" },
    { time: "0:20-0:40", scene: "侧面/资料画面", action: "讲第二、三要点" },
    { time: "0:40-0:60", scene: "正面近景 + 结尾字幕", action: "总结 + 行动号召" },
  ];
  return {
    title: title.trim() || "数字人播报",
    durationSeconds: 60,
    script,
    shots,
    notes: ["建议语速 200-240 字/分钟", "字幕开关键盘词", "BGM 音量低于人声 10dB"],
    source: "rule",
  };
}

/** 数字人分镜 LLM 请求。 */
export function anchorLlmRequest(title: string, markdown: string): LlmRequest {
  const text = plainTextOf(markdown).slice(0, 900);
  const prompt = `你是短视频导演。请把下面的图文内容改写成一段 60 秒左右的数字人播报视频分镜脚本。只输出 JSON 对象,格式:
{"title":"视频标题","script":"完整口播文案(≤300字)","shots":[{"time":"0:00-0:05","scene":"画面描述","action":"动作/口播内容"}],"notes":["制作提示1","制作提示2"]}
不要输出 JSON 之外的任何文字。

标题:${title.trim() || "(未命名)"}
内容:${text}`;
  return {
    task: "rewrite",
    platformId: "douyin",
    input: prompt,
    constraints: { variantCount: 1, maxChars: 300 },
    systemPrompt: "你是短视频导演,只输出结构化 JSON,不加解释。",
    temperature: 0.7,
    maxTokens: 1500,
  };
}

/** 解析 LLM 分镜结果(失败返回 null)。 */
export function parseAnchorJson(raw: string): Omit<AnchorStoryboard, "source"> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const title = typeof obj["title"] === "string" ? obj["title"].trim() : "";
    const script = typeof obj["script"] === "string" ? obj["script"].trim() : "";
    if (!script) return null;
    const shots = Array.isArray(obj["shots"])
      ? (obj["shots"] as unknown[])
          .map((s): { time: string; scene: string; action: string } | null => {
            if (!s || typeof s !== "object") return null;
            const o = s as Record<string, unknown>;
            const time = typeof o["time"] === "string" ? o["time"].trim() : "";
            const scene = typeof o["scene"] === "string" ? o["scene"].trim() : "";
            const action = typeof o["action"] === "string" ? o["action"].trim() : "";
            return time ? { time, scene: scene || "画面", action: action || "口播" } : null;
          })
          .filter((x): x is { time: string; scene: string; action: string } => x !== null)
      : [];
    const notes = Array.isArray(obj["notes"])
      ? (obj["notes"] as unknown[]).map((n) => String(n).trim()).filter((n) => n.length > 0)
      : [];
    return {
      title: title || "数字人播报",
      durationSeconds: 60,
      script,
      shots: shots.length > 0 ? shots : [{ time: "0:00-1:00", scene: "数字人播报", action: script.slice(0, 40) }],
      notes: notes.length > 0 ? notes : ["LLM 生成分镜建议"],
    };
  } catch {
    return null;
  }
}

/** 数字人分镜入口(LLM 失败自动回退规则)。 */
export async function buildAnchorStoryboard(
  title: string,
  markdown: string,
  llm: LlmAdapter | undefined,
  options: { useLlm?: boolean } = {},
): Promise<AnchorStoryboard> {
  const rule = buildAnchorStoryboardRule(title, markdown);
  if (options.useLlm === false || !llm?.available) return rule;
  try {
    const raw = await llm.run(anchorLlmRequest(title, markdown));
    const parsed = parseAnchorJson(raw);
    if (!parsed) throw new Error("LLM 分镜为空");
    return { ...parsed, source: "llm" };
  } catch {
    return rule;
  }
}
