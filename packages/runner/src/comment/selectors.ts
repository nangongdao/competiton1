/**
 * INBOX-04 runner 网页自动化评论同步/回发 —— 选择器契约。
 *
 * 与发布适配器(PLAT-01)同模式:平台 DOM/规则易漂移,选择器**版本化 + 契约校验**,
 * 改版后递增 version 即可定位漂移;真实平台接入时按评论区实际 DOM 调整候选即可。
 *
 * 说明:本模块是**浏览器登录态网页自动化**(runner 打开真实页面爬取/回发评论),
 * 与 core 的 InboxSyncAdapter / CommentReplyAdapter 对接。
 */
export interface CommentSyncSelectors {
  /** 选择器版本(YYYY-MM)。 */
  readonly version: string;
  /** 评论区/消息通知页 URL(浏览器登录态,评论聚合页)。 */
  readonly pageUrl: string;
  /** 评论容器选择器(应匹配多条,用 page.locator 计数)。 */
  readonly items: string;
  /** 评论作者昵称(相对 item)。 */
  readonly author: string;
  /** 评论文本(相对 item)。 */
  readonly text: string;
  /** 评论远端 id 来源:相对 item 的属性名(如 data-comment-id);缺省用文本哈希派生。 */
  readonly remoteIdAttr?: string;
  /** 评论时间来源:相对 item 的属性名或文本(ISO 或时间戳;缺省用拉取时刻)。 */
  readonly timeAttr?: string;
  /** 评论类型推断:相对 item 是否命中私信/@提及/通知(可空)。 */
  readonly kindHint?: { readonly kind: string; readonly selector: string }[];
}

/** 评论回发选择器契约(回复输入框 / 提交 / 成功证据)。 */
export interface CommentReplySelectors {
  /** 选择器版本(YYYY-MM)。 */
  readonly version: string;
  /** 回复输入框(相对评论 item 或全局,多候选)。 */
  readonly input: readonly string[];
  /** 提交/发送按钮(多候选)。 */
  readonly submit: readonly string[];
  /** 回复成功证据文案(页面出现即视为成功)。 */
  readonly successText?: readonly string[];
}

/** 校验评论同步选择器契约(与 assertValidSelectors 对齐)。 */
export function assertValidCommentSyncSelectors(platformId: string, selectors: CommentSyncSelectors): void {
  if (!selectors.version || !/^\d{4}-\d{2}$/.test(selectors.version)) {
    throw new Error(`${platformId} comment sync selectors.version 应为 YYYY-MM,当前:${selectors.version}`);
  }
  for (const field of ["items", "author", "text"] as const) {
    if (typeof selectors[field] !== "string" || selectors[field].trim().length === 0) {
      throw new Error(`${platformId} comment sync selectors.${field} 缺少候选(INBOX-04)`);
    }
  }
  if (!/^https?:\/\//.test(selectors.pageUrl)) {
    throw new Error(`${platformId} comment sync pageUrl 应为 http(s) URL`);
  }
}

/** 校验评论回发选择器契约。 */
export function assertValidCommentReplySelectors(platformId: string, selectors: CommentReplySelectors): void {
  if (!selectors.version || !/^\d{4}-\d{2}$/.test(selectors.version)) {
    throw new Error(`${platformId} comment reply selectors.version 应为 YYYY-MM,当前:${selectors.version}`);
  }
  if (!Array.isArray(selectors.input) || selectors.input.length === 0 || selectors.input.some((s) => !s.trim())) {
    throw new Error(`${platformId} comment reply selectors.input 缺少候选(INBOX-04)`);
  }
  if (!Array.isArray(selectors.submit) || selectors.submit.length === 0 || selectors.submit.some((s) => !s.trim())) {
    throw new Error(`${platformId} comment reply selectors.submit 缺少候选(INBOX-04)`);
  }
}

/**
 * 各平台评论同步/回发选择器(2026-08 版本,真实平台评论区 DOM 随改版可能漂移)。
 * 注:候选已覆盖常见评论区结构;接入真实平台时按页面实际结构微调即可,零改核心。
 */
import type { AutomationPlatformId } from "../types.js";

export const COMMENT_SYNC_SELECTORS: Readonly<Record<string, CommentSyncSelectors>> = {
  zhihu: {
    version: "2026-08",
    pageUrl: "https://www.zhihu.com/notification",
    items: ".Notification, .CommentItem, [class*='notification-item']",
    author: ".AuthorInfo-name, .CommentItem-author, [class*='author']",
    text: ".RichText, .CommentItem-content, [class*='content']",
    remoteIdAttr: "data-comment-id",
    timeAttr: "data-tooltip",
  },
  bilibili: {
    version: "2026-08",
    pageUrl: "https://member.bilibili.com/platform/home",
    items: ".comment-item, [class*='comment-item'], .reply-item",
    author: ".user-name, [class*='user-name'], .name",
    text: ".content, [class*='content'], .text",
    remoteIdAttr: "data-comment-id",
  },
  xiaohongshu: {
    version: "2026-08",
    pageUrl: "https://creator.xiaohongshu.com/new/home",
    items: ".comment-item, [class*='comment-item'], [class*='comment-card']",
    author: ".user-name, [class*='user-name'], [class*='nickname']",
    text: ".content, [class*='content'], [class*='comment-text']",
    remoteIdAttr: "data-comment-id",
  },
  juejin: {
    version: "2026-08",
    pageUrl: "https://juejin.cn/notification",
    items: ".notification-item, [class*='notification-item'], .comment-item",
    author: ".user-name, [class*='user-name'], .author",
    text: ".content, [class*='content'], .comment-content",
    remoteIdAttr: "data-comment-id",
  },
  cnblogs: {
    version: "2026-08",
    pageUrl: "https://i.cnblogs.com/",
    items: ".feedbackItem, .comment_item, [class*='comment-item']",
    author: ".feedbackListSubitem-lt, [class*='author'], .user-name",
    text: ".feedbackCon, [class*='content'], .comment-text",
    remoteIdAttr: "data-comment-id",
  },
  weibo: {
    version: "2026-08",
    pageUrl: "https://weibo.com/",
    items: ".list_box .list_box, [class*='comment'], [class*='wbpro-feed']",
    author: ".name, [class*='name'], [class*='nickname']",
    text: ".text, [class*='text'], [class*='content']",
    remoteIdAttr: "data-comment-id",
  },
  douyin: {
    version: "2026-08",
    pageUrl: "https://creator.douyin.com/creator-micro/content/manage",
    items: ".comment-item, [class*='comment-item'], [class*='comment-card']",
    author: ".user-name, [class*='user-name'], [class*='nickname']",
    text: ".content, [class*='content'], [class*='comment-text']",
    remoteIdAttr: "data-comment-id",
  },
  kuaishou: {
    version: "2026-08",
    pageUrl: "https://cp.kuaishou.com/",
    items: ".comment-item, [class*='comment-item'], [class*='comment-card']",
    author: ".user-name, [class*='user-name'], [class*='nickname']",
    text: ".content, [class*='content'], [class*='comment-text']",
    remoteIdAttr: "data-comment-id",
  },
  shipinhao: {
    version: "2026-08",
    pageUrl: "https://channels.weixin.qq.com/platform",
    items: ".comment-item, [class*='comment-item'], [class*='comment-list']",
    author: ".user-name, [class*='user-name'], [class*='nickname']",
    text: ".content, [class*='content'], [class*='comment-text']",
    remoteIdAttr: "data-comment-id",
  },
  toutiao: {
    version: "2026-08",
    pageUrl: "https://mp.toutiao.com/profile_v4/graphic/comments",
    items: ".comment-item, [class*='comment-item'], [class*='comment-list']",
    author: ".user-name, [class*='user-name'], [class*='nickname']",
    text: ".content, [class*='content'], [class*='comment-text']",
    remoteIdAttr: "data-comment-id",
  },
};

export const COMMENT_REPLY_SELECTORS: Readonly<Record<string, CommentReplySelectors>> = {
  zhihu: {
    version: "2026-08",
    input: ['textarea[placeholder*="写下你的评论"]', 'div[contenteditable="true"][data-placeholder*="评论"]', 'textarea'],
    submit: ['button:has-text("发布评论")', 'button:has-text("评论")', 'button:has-text("发布")'],
    successText: ["评论成功", "发布成功"],
  },
  bilibili: {
    version: "2026-08",
    input: ['textarea[placeholder*="发一条友善的评论"]', 'textarea[placeholder*="评论"]', 'textarea'],
    submit: ['button:has-text("发布")', 'button:has-text("评论")'],
    successText: ["评论成功", "发布成功"],
  },
  xiaohongshu: {
    version: "2026-08",
    input: ['textarea[placeholder*="说点什么"]', 'textarea[placeholder*="评论"]', 'textarea'],
    submit: ['button:has-text("发送")', 'button:has-text("发布")'],
    successText: ["评论成功"],
  },
  juejin: {
    version: "2026-08",
    input: ['textarea[placeholder*="说点什么"]', 'textarea[placeholder*="评论"]', 'textarea'],
    submit: ['button:has-text("发布")', 'button:has-text("评论")'],
    successText: ["评论成功"],
  },
  cnblogs: {
    version: "2026-08",
    input: ['textarea[placeholder*="评论"]', 'textarea'],
    submit: ['button:has-text("提交评论")', 'button:has-text("评论")', 'button:has-text("提交")'],
    successText: ["评论成功"],
  },
  weibo: {
    version: "2026-08",
    input: ['textarea[placeholder*="评论"]', 'div[contenteditable="true"][data-placeholder*="评论"]', 'textarea'],
    submit: ['button:has-text("评论")', 'button:has-text("发布")'],
    successText: ["评论成功", "发布成功"],
  },
  douyin: {
    version: "2026-08",
    input: ['textarea[placeholder*="评论"]', 'textarea[placeholder*="说点什么"]', 'textarea'],
    submit: ['button:has-text("发布")', 'button:has-text("发送")'],
    successText: ["评论成功", "发布成功"],
  },
  kuaishou: {
    version: "2026-08",
    input: ['textarea[placeholder*="评论"]', 'textarea[placeholder*="说点什么"]', 'textarea'],
    submit: ['button:has-text("发布")', 'button:has-text("发送")'],
    successText: ["评论成功"],
  },
  shipinhao: {
    version: "2026-08",
    input: ['textarea[placeholder*="评论"]', 'textarea[placeholder*="说点什么"]', 'textarea'],
    submit: ['button:has-text("发布")', 'button:has-text("发送")'],
    successText: ["评论成功"],
  },
  toutiao: {
    version: "2026-08",
    input: ['textarea[placeholder*="评论"]', 'textarea[placeholder*="说点什么"]', 'textarea'],
    submit: ['button:has-text("发布")', 'button:has-text("评论")'],
    successText: ["评论成功"],
  },
};

/** 支持评论网页自动化的会话平台列表(与 COMMENT_*_SELECTORS 键对齐)。 */
const SESSION_PLATFORM_IDS = ["zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "weibo", "douyin", "kuaishou", "shipinhao", "toutiao"] as const;

/** 校验全部注册平台的选择器(加载期即失败,防漂移静默)。 */
export function assertAllCommentSelectors(): void {
  for (const platformId of SESSION_PLATFORM_IDS) {
    assertValidCommentSyncSelectors(platformId, COMMENT_SYNC_SELECTORS[platformId]!);
    assertValidCommentReplySelectors(platformId, COMMENT_REPLY_SELECTORS[platformId]!);
  }
}

/** 是否支持某平台的评论网页自动化。 */
export function isCommentAutomationPlatform(platformId: string): platformId is AutomationPlatformId {
  return (SESSION_PLATFORM_IDS as readonly string[]).includes(platformId);
}
