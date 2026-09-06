/**
 * CRM-01 AI 智能客服与评论营销。
 *
 * - 意图识别:识别评论区的高意向客户(如问「多少钱」「怎么买」),打上意图与 CRM 标签;
 * - 自动回复:对高意向评论自动生成引导私信的回复;
 * - 情绪分析:实时监控评论情绪,识别负面 / 紧急评论,供「负面舆论预警」与
 *   管理员报警使用(隐藏敏感评论需平台 API 支持,模块只输出建议动作);
 * - 设计原则:规则版确定性、离线可用;LLM 可用时增强,失败自动回退规则。
 */
import type { LlmAdapter, LlmRequest } from "../llm/types.js";

/** 评论意图。 */
export type CommentIntent =
  | "price-inquiry" // 问价格
  | "how-to-buy" // 怎么买
  | "praise" // 好评/认可
  | "question" // 一般提问
  | "criticism" // 批评/差评
  | "spam" // 广告/垃圾
  | "other";

/** 情绪。 */
export type CommentSentiment = "positive" | "neutral" | "negative" | "urgent";

/** 意图识别结果。 */
export interface CommentInsight {
  readonly intent: CommentIntent;
  readonly sentiment: CommentSentiment;
  /** 是否为高意向客户(price-inquiry / how-to-buy)。 */
  readonly highIntent: boolean;
  /** CRM 标签(如 "high-intent" / "needs-followup")。 */
  readonly crmTags: readonly string[];
  /** 是否建议管理员关注(负面/紧急)。 */
  readonly needsAttention: boolean;
  /** 建议动作:auto-reply(自动回复)/ notify(提醒人工)/ hide(建议隐藏,需平台API)/ none。 */
  readonly suggestedAction: "auto-reply" | "notify" | "hide" | "none";
  /** 自动回复文案(如 highIntent 且规则可回复)。 */
  readonly autoReply?: string;
  /** 来源:llm / rule。 */
  readonly source: "llm" | "rule";
  /** 置信度(0-1,规则启发式)。 */
  readonly confidence: number;
}

/** 意图关键词(规则)。 */
const INTENT_KEYWORDS: Readonly<Record<Exclude<CommentIntent, "other">, readonly string[]>> = {
  "price-inquiry": ["多少钱", "价格", "价位", "贵吗", "怎么收费", "费用", "报价", "多少钱一个", "cost", "price"],
  "how-to-buy": ["怎么买", "在哪买", "如何购买", "购买链接", "下单", "求链接", "哪里买", "buy", "purchase", "链接"],
  praise: ["太棒了", "真不错", "学到了", "干货", "很有用", "感谢分享", "牛", "厉害", "优秀", "赞", "支持", "收藏了"],
  question: ["为什么", "怎么", "如何", "请问", "想问", "吗?", "吗？", "呢?", "呢？", "什么意思", "解释"],
  criticism: ["垃圾", "差评", "没用", "骗人", "失望", "差劲", "浪费时间", "假的", "坑", "后悔"],
  spam: ["加微信", "加我", "私我", "兼职", "日赚", "稳赚", "扫码", "VX", "vx", "qq群", "代发"],
};

/** 负面/紧急关键词。 */
const NEGATIVE_KEYWORDS: readonly string[] = ["垃圾", "差评", "骗", "假", "坑", "投诉", "举报", "退款", "维权", "曝光", "失望", "愤怒", "垃圾产品", "不要买"];

/** 规则版评论意图识别。 */
export function analyzeCommentRule(text: string): CommentInsight {
  const t = text.trim().toLowerCase();
  const hits: CommentIntent[] = [];
  for (const [intent, kws] of Object.entries(INTENT_KEYWORDS)) {
    for (const k of kws) {
      if (t.includes(k.toLowerCase())) {
        hits.push(intent as CommentIntent);
        break;
      }
    }
  }
  const negativeHit = NEGATIVE_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
  const urgent = /退款|投诉|举报|曝光|愤怒|维权/.test(t);
  const intent: CommentIntent = hits[0] ?? (negativeHit ? "criticism" : t.length < 5 ? "other" : "question");
  const sentiment: CommentSentiment = urgent ? "urgent" : negativeHit ? "negative" : intent === "praise" ? "positive" : "neutral";
  const highIntent = intent === "price-inquiry" || intent === "how-to-buy";
  const crmTags: string[] = [];
  if (highIntent) crmTags.push("high-intent");
  if (negativeHit) crmTags.push("needs-followup");
  if (sentiment === "urgent") crmTags.push("urgent");

  const needsAttention = sentiment === "negative" || sentiment === "urgent";
  let suggestedAction: CommentInsight["suggestedAction"] = "none";
  let autoReply: string | undefined;
  if (sentiment === "urgent" || intent === "criticism") {
    suggestedAction = "notify";
  } else if (highIntent) {
    suggestedAction = "auto-reply";
    autoReply = intent === "price-inquiry" ? "谢谢关注!价格信息已私信给您,方便的话可以聊聊您的具体需求~" : "感谢您的关注!购买方式已私信发送,有任何问题随时找我~";
  } else if (intent === "praise") {
    suggestedAction = "auto-reply";
    autoReply = "谢谢支持!如果觉得有用,欢迎分享给需要的朋友~";
  }

  return {
    intent,
    sentiment,
    highIntent,
    crmTags,
    needsAttention,
    suggestedAction,
    ...(autoReply ? { autoReply } : {}),
    source: "rule",
    confidence: highIntent || negativeHit ? 0.8 : 0.5,
  };
}

/** LLM 意图识别请求。 */
export function commentInsightLlmRequest(text: string): LlmRequest {
  const prompt = `你是电商/内容运营客服助手。分析下面这条评论,只输出 JSON 对象,格式:
{"intent":"price-inquiry|how-to-buy|praise|question|criticism|spam|other","sentiment":"positive|neutral|negative|urgent","autoReply":"若适合自动回复则给出回复文案(引导私信),否则为空字符串","note":"一句话说明(可选)"}
不要输出 JSON 之外的任何文字。

评论:${text.slice(0, 300)}`;
  return {
    task: "rewrite",
    platformId: "wechat",
    input: prompt,
    constraints: { variantCount: 1 },
    systemPrompt: "你是客服意图识别助手,只输出结构化 JSON,不加解释。",
    temperature: 0.2,
    maxTokens: 400,
  };
}

/** 解析 LLM 意图结果(失败返回 null)。 */
export function parseCommentInsightJson(raw: string): {
  intent?: CommentIntent;
  sentiment?: CommentSentiment;
  autoReply?: string;
} | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const intents: readonly CommentIntent[] = ["price-inquiry", "how-to-buy", "praise", "question", "criticism", "spam", "other"];
    const sentiments: readonly CommentSentiment[] = ["positive", "neutral", "negative", "urgent"];
    const intent = typeof obj["intent"] === "string" && (intents as readonly string[]).includes(obj["intent"]) ? (obj["intent"] as CommentIntent) : undefined;
    const sentiment = typeof obj["sentiment"] === "string" && (sentiments as readonly string[]).includes(obj["sentiment"]) ? (obj["sentiment"] as CommentSentiment) : undefined;
    const autoReply = typeof obj["autoReply"] === "string" ? obj["autoReply"].trim() : undefined;
    if (!intent && !sentiment) return null;
    return {
      ...(intent ? { intent } : {}),
      ...(sentiment ? { sentiment } : {}),
      ...(autoReply ? { autoReply } : {}),
    };
  } catch {
    return null;
  }
}

/** 评论分析入口(LLM 失败自动回退规则)。 */
export async function analyzeComment(
  text: string,
  llm: LlmAdapter | undefined,
  options: { useLlm?: boolean } = {},
): Promise<CommentInsight> {
  const rule = analyzeCommentRule(text);
  if (options.useLlm === false || !llm?.available) return rule;
  try {
    const raw = await llm.run(commentInsightLlmRequest(text));
    const parsed = parseCommentInsightJson(raw);
    if (!parsed) throw new Error("LLM 意图为空");
    const intent = parsed.intent ?? rule.intent;
    const sentiment = parsed.sentiment ?? rule.sentiment;
    const highIntent = intent === "price-inquiry" || intent === "how-to-buy";
    const negativeHit = sentiment === "negative" || sentiment === "urgent";
    const crmTags: string[] = [];
    if (highIntent) crmTags.push("high-intent");
    if (negativeHit) crmTags.push("needs-followup");
    if (sentiment === "urgent") crmTags.push("urgent");
    const needsAttention = negativeHit;
    let suggestedAction: CommentInsight["suggestedAction"] = "none";
    let autoReply = parsed.autoReply;
    if (sentiment === "urgent" || intent === "criticism") {
      suggestedAction = "notify";
    } else if (highIntent) {
      suggestedAction = autoReply ? "auto-reply" : "notify";
    } else if (intent === "praise") {
      suggestedAction = "auto-reply";
      autoReply = autoReply ?? "谢谢支持!";
    }
    return {
      intent,
      sentiment,
      highIntent,
      crmTags,
      needsAttention,
      suggestedAction,
      ...(autoReply ? { autoReply } : {}),
      source: "llm",
      confidence: 0.9,
    };
  } catch {
    return rule;
  }
}

/** 负面舆论预警摘要。 */
export interface NegativeDigest {
  readonly alerts: readonly { message: string; sentiment: CommentSentiment; action: string }[];
  readonly total: number;
}

/** 对一批评论做负面预警摘要(规则版,离线可用)。 */
export function digestNegativeComments(comments: readonly string[]): NegativeDigest {
  const alerts: { message: string; sentiment: CommentSentiment; action: string }[] = [];
  for (const c of comments) {
    const insight = analyzeCommentRule(c);
    if (insight.needsAttention) {
      alerts.push({
        message: c.slice(0, 120),
        sentiment: insight.sentiment,
        action: insight.sentiment === "urgent" ? "立即通知管理员并评估是否隐藏(需平台API)" : "通知管理员跟进处理",
      });
    }
  }
  return { alerts, total: alerts.length };
}
