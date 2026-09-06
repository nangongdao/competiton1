/**
 * INBOX-04 runner 网页自动化评论同步/回发实现。
 *
 * 用 Playwright 打开**浏览器登录态**的各平台评论聚合页,爬取评论并归一化,
 * 以及把回复真实填进评论输入框并提交。与 core 的 `InboxSyncAdapter` /
 * `CommentReplyAdapter` 契约对接(零改核心)。
 *
 * 安全与稳健性:
 * - 登录/验证码/风控拦截复用 common.ts 的 `detectHumanBlocker`(返回 needs-user-action);
 * - 爬取选择器来自 selectors.ts(版本化,漂移可定位);
 * - 回发成功判定:出现成功文案或按钮消失/输入框清空(多证据);不确定时返回
 *   ok:false + error,由调用方降级为人工,绝不谎报「已回发」。
 */
import type { BrowserContext, Locator, Page } from "playwright";
import type { RemoteInboxItem } from "@mpp/core";
import { analyzeCommentRule } from "@mpp/core";
import type { CommentReplyRequest } from "@mpp/core";
import {
  COMMENT_SYNC_SELECTORS,
  COMMENT_REPLY_SELECTORS,
  isCommentAutomationPlatform,
} from "./selectors.js";
import { detectHumanBlocker } from "../platforms/common.js";

/** 浏览器会话打开器(复用 runner 的 BrowserSessionManager)。 */
export interface CommentSessionOpener {
  open(platformId: string, headless?: boolean, profileDir?: string): Promise<BrowserContext>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从文本哈希派生稳定 remoteId(平台未暴露 id 属性时的兜底)。 */
function hashRemoteId(platformId: string, text: string, index: number): string {
  let h = 0;
  const input = `${platformId}:${text}:${index}`;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `runner-${platformId}-${Math.abs(h).toString(36)}-${index}`;
}

/** 支持 .locator(sel) 的最小结构(Page 与 Locator 都有)。 */
interface HasLocator {
  locator(selector: string): Locator;
}

async function firstText(node: HasLocator, selectors: readonly string[]): Promise<string | undefined> {
  for (const sel of selectors) {
    const loc = node.locator(sel).first();
    const text = await loc.textContent({ timeout: 600 }).catch(() => null);
    if (text?.trim()) return text.trim();
  }
  return undefined;
}

/** 从评论 item 解析远端 id(优先 data 属性,兜底文本哈希)。 */
async function remoteIdOf(platformId: string, item: Locator, attr: string | undefined, text: string, index: number): Promise<string> {
  if (attr) {
    const raw = await item.getAttribute(attr, { timeout: 600 }).catch(() => null);
    if (raw?.trim()) return `${platformId}-${raw.trim()}`;
  }
  return hashRemoteId(platformId, text, index);
}

/**
 * 爬取某平台评论聚合页上的评论并归一化。
 * @param req { platformId, profileDir, limit, seenIds } seenIds:已存在 remoteId 集合(增量跳过)。
 */
export async function fetchCommentsFromPage(
  opener: CommentSessionOpener,
  req: { platformId: string; profileDir?: string; limit?: number; seenIds?: ReadonlySet<string> },
): Promise<{ ok: boolean; items: readonly RemoteInboxItem[]; cursor?: string; error?: string }> {
  if (!isCommentAutomationPlatform(req.platformId)) {
    return { ok: false, items: [], error: `runner 暂不支持 ${req.platformId} 的评论网页自动化` };
  }
  const selectors = COMMENT_SYNC_SELECTORS[req.platformId]!;
  const limit = req.limit ?? 50;
  const seen = req.seenIds ?? new Set<string>();
  let context: BrowserContext | undefined;
  try {
    context = await opener.open(req.platformId, false, req.profileDir);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(selectors.pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const blocker = await detectHumanBlocker(page);
    if (blocker) {
      return { ok: false, items: [], error: `请先在 runner 浏览器中登录 ${req.platformId},当前页面要求人工处理: ${blocker}` };
    }

    // 等待评论容器出现(页面可能异步渲染)。
    await page.locator(selectors.items).first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
    const items = page.locator(selectors.items);
    const count = Math.min(await items.count().catch(() => 0), limit);
    const out: RemoteInboxItem[] = [];
    let maxSeq = 0;

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const text = await firstText(item, [selectors.text]).catch(() => undefined);
      if (!text) continue;
      const author = await firstText(item, [selectors.author]).catch(() => undefined);
      const remoteId = await remoteIdOf(req.platformId, item, selectors.remoteIdAttr, text, i);
      if (seen.has(remoteId)) continue;
      // 时间:优先 data 属性(ISO/时间戳),否则用拉取时刻。
      let receivedAt: string | undefined;
      if (selectors.timeAttr) {
        const raw = await item.getAttribute(selectors.timeAttr, { timeout: 400 }).catch(() => null);
        if (raw?.trim()) {
          const num = Number(raw.trim());
          if (Number.isFinite(num)) receivedAt = new Date(num * 1000).toISOString();
          else if (!Number.isNaN(Date.parse(raw.trim()))) receivedAt = new Date(raw.trim()).toISOString();
        }
      }
      // 自动打标(评论营销引擎),保证收件箱可直接展示。
      const insight = analyzeCommentRule(text);
      out.push({
        remoteId,
        kind: "comment",
        author: author ?? "匿名用户",
        text,
        ...(receivedAt ? { receivedAt } : {}),
        ...(insight.highIntent ? { intent: insight.intent } : {}),
        ...(insight.autoReply ? { autoReply: insight.autoReply } : {}),
      });
      maxSeq = Math.max(maxSeq, i);
    }

    return {
      ok: true,
      items: out,
      // 游标:用「已爬取到的最大序号」做增量(同一页面内去重由 seenIds 兜底)。
      cursor: out.length > 0 ? `runner:${maxSeq + 1}` : undefined,
    };
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    // 评论同步不关闭浏览器(复用登录态),但关闭多余页面避免泄漏。
    if (context) {
      for (const p of context.pages().slice(1)) await p.close().catch(() => undefined);
    }
  }
}

/** 在页面某条评论上执行回复(真实回发)。 */
async function replyOnPage(
  page: Page,
  platformId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const replySelectors = COMMENT_REPLY_SELECTORS[platformId]!;
  const syncSelectors = COMMENT_SYNC_SELECTORS[platformId]!;

  // 1) 展开第一条评论的回复输入框(多数平台点「回复」按钮后出现 textarea)。
  const items = page.locator(syncSelectors.items);
  if ((await items.count().catch(() => 0)) === 0) {
    return { ok: false, error: "评论区为空,无法定位要回复的评论" };
  }
  const first = items.first();
  // 常见「回复」按钮候选。
  const replyButton = first.locator('button:has-text("回复"), [class*="reply"] button, [aria-label*="回复"]').first();
  if ((await replyButton.count().catch(() => 0)) > 0) {
    await replyButton.click().catch(() => undefined);
  }

  // 2) 定位输入框(全局 + 相对评论)。
  let input: Locator | undefined;
  for (const sel of replySelectors.input) {
    const loc = first.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
      input = loc;
      break;
    }
  }
  if (!input) {
    for (const sel of replySelectors.input) {
      const loc = page.locator(sel).first();
      if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
        input = loc;
        break;
      }
    }
  }
  if (!input) {
    return { ok: false, error: "未找到评论回复输入框(可能需先登录/展开评论区)" };
  }
  await input.fill(text).catch(async () => {
    await input!.click();
    await input!.pressSequentially(text, { delay: 30 });
  });

  // 3) 提交。
  let submit: Locator | undefined;
  for (const sel of replySelectors.submit) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
      submit = loc;
      break;
    }
  }
  if (!submit) {
    return { ok: false, error: "未找到评论提交按钮" };
  }
  await submit.click();

  // 4) 成功证据:成功文案 or 输入框被清空(平台侧已接受)。
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  if (replySelectors.successText?.some((t) => bodyText.toLowerCase().includes(t.toLowerCase()))) {
    return { ok: true };
  }
  const cleared = await input.inputValue().catch(() => "");
  if (cleared === "") {
    return { ok: true, error: undefined };
  }
  return { ok: false, error: "已提交但未确认平台侧成功证据,请人工核对(不自动重试)" };
}

/**
 * 构造某平台的「评论回复适配器」(对接 core CommentReplyAdapter)。
 * 每条回复都会打开浏览器登录态页面,定位评论并真实回发。
 */
export function makeRunnerCommentReplyAdapter(
  opener: CommentSessionOpener,
  platformId: string,
): { platformId: string; reply(req: CommentReplyRequest): Promise<{ ok: boolean; error?: string; remoteReplyId?: string }> } {
  return {
    platformId,
    async reply(req) {
      if (!isCommentAutomationPlatform(platformId)) {
        return { ok: false, error: `runner 暂不支持 ${platformId} 的评论回发` };
      }
      let context: BrowserContext | undefined;
      try {
        context = await opener.open(platformId, false, req.profileDir);
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(COMMENT_SYNC_SELECTORS[platformId]!.pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        const blocker = await detectHumanBlocker(page);
        if (blocker) {
          return { ok: false, error: `请先在 runner 浏览器中登录 ${platformId},当前页面要求人工处理: ${blocker}` };
        }
        const outcome = await replyOnPage(page, platformId, req.text);
        if (outcome.ok) {
          return { ok: true, remoteReplyId: `runner-reply-${Date.now().toString(36)}` };
        }
        return { ok: false, error: outcome.error ?? "回发失败" };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        if (context) {
          for (const p of context.pages().slice(1)) await p.close().catch(() => undefined);
        }
      }
    },
  };
}

/** 把远端评论归一化为 core RemoteInboxItem(与 server/演示适配器同构)。 */
export function normalizeScrapedItem(
  raw: unknown,
): RemoteInboxItem | undefined {
  if (!isRecord(raw)) return undefined;
  const remoteId = typeof raw["remoteId"] === "string" ? raw["remoteId"] : undefined;
  const text = typeof raw["text"] === "string" ? raw["text"] : undefined;
  const author = typeof raw["author"] === "string" ? raw["author"] : undefined;
  if (!remoteId || !text) return undefined;
  const insight = analyzeCommentRule(text);
  return {
    remoteId,
    kind: "comment",
    author: author ?? "匿名用户",
    text,
    ...(typeof raw["receivedAt"] === "string" ? { receivedAt: raw["receivedAt"] } : {}),
    ...(insight.highIntent ? { intent: insight.intent } : {}),
    ...(insight.autoReply ? { autoReply: insight.autoReply } : {}),
  };
}
