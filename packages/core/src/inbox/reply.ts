/**
 * INBOX-04/06 AI 自动回复真实回发 —— 评论回复引擎。
 *
 * 在 INBOX-03「把平台评论同步进收件箱」之上补齐**回发闭环**:
 * - 对收件箱里的评论/私信,经评论营销引擎(CRM-01)决定「是否值得自动回复 + 回复什么」;
 * - 由注入的「平台评论回复适配器」把回复**真实回发到平台**(runner 网页自动化 / server 官方 API);
 * - 回发成功后在本地收件箱落地状态(handling=auto-replied / replied),避免重复回发。
 *
 * 设计原则(与项目网络边界一致):
 * - core 是纯逻辑层,不直接发请求;平台差异由「评论回复适配器」封装;
 * - 策略默认**保守**:只自动回复高意向(问价 / 求购)与好评,负面/紧急评论绝不自动回复
 *   (转人工跟进),杜绝「AI 怼用户」事故;
 * - 回发是幂等的:同一条消息重复调用时,若已回发则跳过。
 *
 * INBOX-06 扩展(更多定时回复策略):
 * - `strategy` 策略预设:conservative(保守)/ balanced(均衡)/ proactive(积极);
 * - `replyQuestion`:是否自动回复一般提问(proactive 默认开启);
 * - `template`:自定义回复模板(问价/求购/好评/提问分别可配);
 * - `dedupeByAuthor + dailyPerAuthorCap`:同一作者去重与每日回复上限(防骚扰);
 * - `recencyWindowMs`:时效窗口,只回复最近 N ms 内到达的消息(避免对老评论批量回复)。
 */
import type { InboxMessage } from "./types.js";
import { analyzeCommentRule, type CommentInsight } from "../crm/crm.js";

/** 平台评论回复适配器(由 runner/server 注入真实实现)。 */
export interface CommentReplyAdapter {
  readonly platformId: string;
  /**
   * 把一条回复真实回发到平台。
   * 返回 ok:true 表示平台侧已接受;error 表示失败(调用方可降级为人工)。
   */
  reply(req: CommentReplyRequest): Promise<{ ok: boolean; error?: string; remoteReplyId?: string }>;
}

/** 评论回复请求(与同步适配器的 RemoteInboxItem 互补,含回发所需平台引用)。 */
export interface CommentReplyRequest {
  readonly platformId: string;
  /** 本地收件箱消息(承载 remoteId / 作者 / 文本等)。 */
  readonly message: InboxMessage;
  /** 要回发的回复内容。 */
  readonly text: string;
  /** 平台侧账号引用:会话平台 = 浏览器登录 profile 目录名。 */
  readonly profileDir?: string;
  /** 平台侧账号引用:公众号 = server profile 引用。 */
  readonly serverProfileId?: string;
  /** 平台侧内容引用(评论所属文章/笔记;如公众号 msg_data_id / 页面 URL)。 */
  readonly contentRef?: string;
  /** 平台侧账号引用(公众号 server profile 引用 / 会话平台 profile 目录,与同步侧对齐)。 */
  readonly accountId?: string;
}

/** 单条评论回发结果。 */
export interface CommentReplyResult {
  readonly ok: boolean;
  readonly platformId: string;
  readonly messageId: string;
  readonly text: string;
  /** 是否实际发出(true=平台侧已接受;false=跳过或失败)。 */
  readonly sent: boolean;
  readonly remoteReplyId?: string;
  readonly error?: string;
  readonly at: string;
}

/** 自动回复策略预设(INBOX-06 更多定时回复策略)。 */
export type AutoReplyStrategy = "conservative" | "balanced" | "proactive";

/** 策略预设描述(供 UI 展示)。 */
export const AUTO_REPLY_STRATEGIES: Readonly<
  Record<AutoReplyStrategy, { readonly label: string; readonly note: string }>
> = {
  conservative: { label: "保守", note: "只自动回复问价/求购与好评,负面一律转人工" },
  balanced: { label: "均衡", note: "问价/求购/好评/一般提问均自动回复,负面转人工" },
  proactive: { label: "积极", note: "尽量多自动回复(含一般提问),负面也尝试安抚后转人工" },
};

/** 回复模板(自定义文案,缺省用默认文案)。 */
export interface ReplyTemplate {
  readonly priceInquiry?: string;
  readonly howToBuy?: string;
  readonly praise?: string;
  readonly question?: string;
}

/** 批量自动回复策略。 */
export interface AutoReplyPolicy {
  /** 策略预设(缺省 conservative)。预设决定下方开关的默认组合。 */
  readonly strategy?: AutoReplyStrategy;
  /** 是否只自动回复高意向(问价/求购)。默认 true。 */
  readonly highIntentOnly?: boolean;
  /** 是否自动回复好评/感谢类。默认 true(低成本增强互动)。 */
  readonly replyPraise?: boolean;
  /** 是否自动回复一般提问(balanced/proactive 开启)。默认 false。 */
  readonly replyQuestion?: boolean;
  /** 负面/紧急评论是否跳过自动回复(默认 true,绝不自动回复负评)。 */
  readonly skipNegative?: boolean;
  /** 是否跳过已回复/已归档/已关闭的消息(默认 true,幂等)。 */
  readonly skipHandled?: boolean;
  /** 单批最大回发数(防止一次把限流打爆)。默认 20。 */
  readonly limit?: number;
  /** 同作者去重:同一作者在 dedupeWindowMs 内已安排过回复则跳过(默认 false)。 */
  readonly dedupeByAuthor?: boolean;
  /** 同作者去重窗口(ms)。默认 24h。 */
  readonly dedupeWindowMs?: number;
  /** 时效窗口(ms):只回复 receivedAt 落在窗口内的消息;0=不限(默认)。 */
  readonly recencyWindowMs?: number;
  /** 每个作者单批内自动回复上限(防骚扰;0=不限)。 */
  readonly dailyPerAuthorCap?: number;
  /** 自定义回复模板(缺省用默认文案)。 */
  readonly template?: ReplyTemplate;
}

/** 一条待回复消息的决策结果。 */
export interface AutoReplyDecision {
  readonly message: InboxMessage;
  /** 是否应当自动回复。 */
  readonly shouldReply: boolean;
  /** 回复文案(shouldReply 时存在)。 */
  readonly text?: string;
  /** 跳过原因(shouldReply 为 false 时)。 */
  readonly reason?: string;
  /** 评论营销引擎洞察(供 UI 展示)。 */
  readonly insight: CommentInsight;
}

export const DEFAULT_AUTO_REPLY_POLICY: Required<AutoReplyPolicy> = {
  strategy: "conservative",
  highIntentOnly: true,
  replyPraise: true,
  replyQuestion: false,
  skipNegative: true,
  skipHandled: true,
  limit: 20,
  dedupeByAuthor: false,
  dedupeWindowMs: 24 * 60 * 60 * 1000,
  recencyWindowMs: 0,
  dailyPerAuthorCap: 0,
  template: {},
};

/** 各策略预设的开关默认组合。 */
const STRATEGY_DEFAULTS: Readonly<
  Record<AutoReplyStrategy, Partial<AutoReplyPolicy>>
> = {
  conservative: {
    highIntentOnly: true,
    replyPraise: true,
    replyQuestion: false,
    skipNegative: true,
    skipHandled: true,
  },
  balanced: {
    highIntentOnly: false,
    replyPraise: true,
    replyQuestion: true,
    skipNegative: true,
    skipHandled: true,
  },
  proactive: {
    highIntentOnly: false,
    replyPraise: true,
    replyQuestion: true,
    skipNegative: false,
    skipHandled: true,
  },
};

/** 解析策略:预设默认值 → 用户显式覆盖。 */
export function resolveAutoReplyPolicy(
  policy: AutoReplyPolicy = DEFAULT_AUTO_REPLY_POLICY,
): Required<AutoReplyPolicy> {
  const strategy = policy.strategy ?? DEFAULT_AUTO_REPLY_POLICY.strategy;
  const presets = STRATEGY_DEFAULTS[strategy] ?? {};
  return {
    ...DEFAULT_AUTO_REPLY_POLICY,
    ...presets,
    ...policy,
    strategy,
    template: { ...DEFAULT_AUTO_REPLY_POLICY.template, ...presets.template, ...policy.template },
  };
}

function isHandled(message: InboxMessage): boolean {
  return message.status === "replied" || message.status === "closed" || message.handling === "auto-replied" || message.handling === "human-replied" || message.handling === "archived";
}

/** 从模板取回复文案(缺省用内置默认)。 */
function replyTextFor(
  insight: CommentInsight,
  template: ReplyTemplate,
): string {
  if (insight.intent === "price-inquiry" && template.priceInquiry) return template.priceInquiry;
  if (insight.intent === "how-to-buy" && template.howToBuy) return template.howToBuy;
  if (insight.intent === "praise" && template.praise) return template.praise;
  if (insight.intent === "question" && template.question) return template.question;
  if (insight.highIntent) return defaultReplyFor(insight);
  if (insight.intent === "praise") return "谢谢支持!如果觉得有用,欢迎分享给需要的朋友~";
  if (insight.intent === "question") return "感谢您的提问!已私信为您详细解答,请查收~";
  return defaultReplyFor(insight);
}

/**
 * 判断单条消息是否应自动回复(纯函数,可单测)。
 * @param now 注入当前时间(默认取系统时间),用于时效窗口判断。
 */
export function decideAutoReply(
  message: InboxMessage,
  policy: AutoReplyPolicy = DEFAULT_AUTO_REPLY_POLICY,
  insight: CommentInsight = analyzeCommentRule(message.text),
  now: () => string = () => new Date().toISOString(),
): AutoReplyDecision {
  const p = resolveAutoReplyPolicy(policy);
  const skipHandled = p.skipHandled;
  const skipNegative = p.skipNegative;

  if (skipHandled && isHandled(message)) {
    return { message, shouldReply: false, reason: "已回复/已归档/已关闭,跳过", insight };
  }
  if (message.direction !== "inbound") {
    return { message, shouldReply: false, reason: "非入站消息,跳过", insight };
  }
  // 时效窗口:只回复最近 recencyWindowMs 内到达的消息,防止对存量老评论批量回复。
  if (p.recencyWindowMs > 0) {
    const at = Date.parse(message.receivedAt);
    const cutoff = Date.parse(now()) - p.recencyWindowMs;
    if (!Number.isFinite(at) || at < cutoff) {
      return { message, shouldReply: false, reason: `超出时效窗口(仅回复最近 ${Math.round(p.recencyWindowMs / 60000)} 分钟内消息)`, insight };
    }
  }
  if (skipNegative && insight.needsAttention) {
    return { message, shouldReply: false, reason: "负面/紧急评论不自动回复,转人工", insight };
  }
  // 高意向:始终自动回复(引导私信)。
  if (insight.highIntent) {
    const text = replyTextFor(insight, p.template);
    return { message, shouldReply: true, text, insight };
  }
  // 好评:按策略决定。
  if (insight.intent === "praise" && p.replyPraise) {
    const text = replyTextFor(insight, p.template);
    return { message, shouldReply: true, text, insight };
  }
  // 一般提问:按策略决定(balanced/proactive 默认开启)。
  if (insight.intent === "question" && p.replyQuestion) {
    const text = replyTextFor(insight, p.template);
    return { message, shouldReply: true, text, insight };
  }
  // 其余:不自动回复,转人工。
  return {
    message,
    shouldReply: false,
    reason: p.highIntentOnly ? "非高意向评论,转人工跟进" : "该类型评论需人工答复",
    insight,
  };
}

/** 兜底回复文案(洞察未给出 autoReply 时)。 */
function defaultReplyFor(insight: CommentInsight): string {
  if (insight.intent === "how-to-buy") {
    return "感谢您的关注!购买方式已私信发送,有任何问题随时找我~";
  }
  if (insight.intent === "price-inquiry") {
    return "谢谢关注!价格信息已私信给您,方便的话可以聊聊您的具体需求~";
  }
  return `感谢你的评论!已私信回复你,有问题随时联系~`;
}

/**
 * 批量决策:从收件箱消息里筛出应自动回复的候选(纯函数)。
 * 支持同作者去重与每作者单批上限(INBOX-06)。
 * @param now 注入当前时间(默认取系统时间),用于时效窗口判断。
 */
export function planAutoReplies(
  messages: readonly InboxMessage[],
  policy: AutoReplyPolicy = DEFAULT_AUTO_REPLY_POLICY,
  now: () => string = () => new Date().toISOString(),
): readonly AutoReplyDecision[] {
  const p = resolveAutoReplyPolicy(policy);
  const limit = p.limit;
  const out: AutoReplyDecision[] = [];
  const scheduledByAuthor = new Map<string, number>();

  for (const m of messages) {
    if (out.length >= limit) break;
    // 同作者去重:同一作者在本批内已安排过回复则跳过(防骚扰)。
    if (p.dedupeByAuthor && m.author && (scheduledByAuthor.get(m.author) ?? 0) > 0) {
      continue;
    }
    const decision = decideAutoReply(m, p, undefined, now);
    if (decision.shouldReply && decision.text) {
      if (m.author) {
        const count = (scheduledByAuthor.get(m.author) ?? 0) + 1;
        if (p.dailyPerAuthorCap > 0 && count > p.dailyPerAuthorCap) {
          continue;
        }
        scheduledByAuthor.set(m.author, count);
      }
      out.push(decision);
    }
  }
  return out;
}

/** 批量自动回复结果汇总。 */
export interface AutoReplySummary {
  readonly ok: boolean;
  readonly planned: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: readonly { messageId: string; error: string }[];
  readonly results: readonly CommentReplyResult[];
  readonly at: string;
}

/**
 * 批量自动回复执行器:对候选消息逐条调用适配器真实回发。
 * - 单条失败不阻断整批(记录 failed,调用方决定是否人工兜底);
 * - 结果含 sent 计数与失败明细,供 UI toast / 通知。
 */
export async function sendAutoReplies(
  messages: readonly InboxMessage[],
  adapter: CommentReplyAdapter,
  policy: AutoReplyPolicy = DEFAULT_AUTO_REPLY_POLICY,
  now: () => string = () => new Date().toISOString(),
): Promise<AutoReplySummary> {
  const planned = planAutoReplies(messages, policy);
  const at = now();
  const results: CommentReplyResult[] = [];
  const failed: { messageId: string; error: string }[] = [];
  let sent = 0;

  for (const decision of planned) {
    const text = decision.text!;
    try {
      const outcome = await adapter.reply({
        platformId: adapter.platformId,
        message: decision.message,
        text,
        ...(decision.message.accountId ? { accountId: decision.message.accountId } : {}),
      });
      if (outcome.ok) {
        sent++;
        results.push({
          ok: true,
          platformId: adapter.platformId,
          messageId: decision.message.id,
          text,
          sent: true,
          ...(outcome.remoteReplyId ? { remoteReplyId: outcome.remoteReplyId } : {}),
          at,
        });
      } else {
        failed.push({ messageId: decision.message.id, error: outcome.error ?? "回发失败" });
        results.push({
          ok: false,
          platformId: adapter.platformId,
          messageId: decision.message.id,
          text,
          sent: false,
          error: outcome.error ?? "回发失败",
          at,
        });
      }
    } catch (err) {
      failed.push({ messageId: decision.message.id, error: err instanceof Error ? err.message : String(err) });
      results.push({
        ok: false,
        platformId: adapter.platformId,
        messageId: decision.message.id,
        text,
        sent: false,
        error: err instanceof Error ? err.message : String(err),
        at,
      });
    }
  }

  return {
    ok: failed.length === 0,
    planned: planned.length,
    sent,
    skipped: planned.length - sent - failed.length,
    failed,
    results,
    at,
  };
}

/** 把回发成功结果落到本地收件箱(handling=auto-replied,status=replied,reply=text)。 */
export function applyAutoReplyResult(message: InboxMessage, text: string): InboxMessage {
  return {
    ...message,
    reply: text,
    status: "replied",
    handling: "auto-replied",
    updatedAt: new Date().toISOString(),
  };
}
