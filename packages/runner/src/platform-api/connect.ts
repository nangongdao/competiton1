/**
 * runner 平台 API 一键连接实现 —— 用 Playwright 浏览器登录态检查各平台连通性并解析账号。
 *
 * 「一键连接」= 打开平台编辑器(复用用户浏览器登录态) → 检测登录/验证码/风控 →
 * 解析页面上的账号昵称/头像/主页 → 返回脱敏连接结果。
 *
 * 已实现:
 * - wechat: runner 不持密钥,连接检查委托给 server 的公众号 API(见 server /platform-api/connect);
 * - zhihu/bilibili/xiaohongshu/juejin: 打开编辑器页,从页面元素解析账号;
 * - csdn: 若凭据携带 Cookie,则请求 CSDN 官方 /myself/info 接口解析账号(不走页面)。
 */
import type { BrowserContext, Page } from "playwright";
import type {
  ConnectionCheckRequest,
  ConnectionCheckResult,
  PlatformHttpClient,
} from "@mpp/core";

/** 浏览器会话打开器(复用 runner 的 BrowserSessionManager)。 */
export interface SessionOpener {
  open(platformId: string, headless?: boolean, profileDir?: string): Promise<BrowserContext>;
}

/** 平台 → 编辑器 URL(与 automation adapter 的 editorUrl 对齐)。 */
const EDITOR_URLS: Record<string, string> = {
  zhihu: "https://zhuanlan.zhihu.com/write",
  bilibili: "https://member.bilibili.com/platform/upload/text/apply",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/publish",
  juejin: "https://juejin.cn/editor/drafts/new",
  cnblogs: "https://i.cnblogs.com/posts/edit",
  weibo: "https://weibo.com/compose/post",
  toutiao: "https://mp.toutiao.com/profile_v4/graphic/publish",
  douyin: "https://creator.douyin.com/creator-micro/content/upload",
  kuaishou: "https://cp.kuaishou.com/article/publish/video",
  shipinhao: "https://channels.weixin.qq.com/platform/post/create",
};

/** 阻塞/拦截文案模式(登录/验证码/风控)。 */
const BLOCKER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/验证码|captcha/i, "验证码"],
  [/短信|sms/i, "短信验证"],
  [/扫码|二维码|登录|login/i, "登录"],
  [/风险|安全验证|人机/i, "风险验证"],
];

function detectBlocker(text: string): string | undefined {
  for (const [pattern, label] of BLOCKER_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return undefined;
}

/** 页面账号选择器候选(各平台 DOM 可能变化,多候选 + 首选中命中)。 */
const ACCOUNT_SELECTORS: Record<string, readonly string[]> = {
  zhihu: ['div.AppHeader-userInfo .css-1k0o0gd', '.AppHeader-profileEntry .Avatar', 'img.Avatar[src*="zhihu"]'],
  bilibili: ['.bili-avatar-img', '.header-entry-avatar', 'img[src*="i0.hdslb.com"]'],
  xiaohongshu: ['.user-info .avatar', '.account-header .avatar', 'img[src*="sns-webpic"]'],
  juejin: ['.user-info .avatar', '.avatar-img', 'img[src*="p3-juejin"]'],
  cnblogs: ['.user-info .avatar', 'img[src*="cnblogs"]'],
  weibo: ['.woo-box-flex img', 'img[src*="sinaimg.cn"]'],
  toutiao: ['.avatar', 'img[src*="byteimg.com"]'],
  douyin: ['.avatar', 'img[src*="douyinpic.com"]'],
  kuaishou: ['.avatar', 'img[src*="kuaishou.com"]'],
  shipinhao: ['.user-info .avatar', 'img[src*="wx" i]'],
};

async function parseAccountFromPage(page: Page, platformId: string): Promise<{ name?: string; avatar?: string; url?: string }> {
  // 从页面头部提取用户名(尽量贴近当前账号)。
  let name: string | undefined;
  const nameCandidates = [
    '.user-name',
    '.username',
    '.nickname',
    '.user-info-name',
    '.name',
    '[class*="user-name"]',
    '[class*="nickname"]',
  ];
  for (const sel of nameCandidates) {
    const text = await page.locator(sel).first().textContent({ timeout: 800 }).catch(() => null);
    if (text?.trim()) {
      name = text.trim().slice(0, 60);
      break;
    }
  }
  // 头像。
  let avatar: string | undefined;
  const avatarSels = ACCOUNT_SELECTORS[platformId] ?? [];
  for (const sel of avatarSels) {
    const src = await page.locator(sel).first().getAttribute("src", { timeout: 800 }).catch(() => null);
    if (src) {
      avatar = src;
      break;
    }
  }
  return { name, avatar, url: EDITOR_URLS[platformId] };
}

/**
 * 构造会话平台的一键连接检查器(runner 注入到 core provider)。
 */
export function makeSessionConnectionChecker(opener: SessionOpener) {
  return async (req: ConnectionCheckRequest, now?: () => string): Promise<ConnectionCheckResult> => {
    const started = Date.now();
    const at = (now ?? (() => new Date().toISOString()))();
    const platformId = req.platformId;
    const editorUrl = EDITOR_URLS[platformId];
    if (!editorUrl) {
      return { ok: false, platformId, message: `runner 不支持 ${platformId} 的会话连接检查`, errorKind: "unsupported", latencyMs: Date.now() - started, at };
    }
    let context: BrowserContext | undefined;
    try {
      context = await opener.open(platformId, req.credentials["headless"] === "1", req.profileDir);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

      const text = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
      const blocker = detectBlocker(text);
      if (blocker) {
        return {
          ok: false,
          platformId,
          message: `请先在 runner 浏览器中登录 ${platformId},当前页面要求人工处理: ${blocker}`,
          errorKind: "unauthorized",
          latencyMs: Date.now() - started,
          at,
        };
      }
      const account = await parseAccountFromPage(page, platformId);
      return {
        ok: true,
        platformId,
        message: `连接成功:已识别浏览器登录态${account.name ? `(${account.name})` : ""}`,
        account: account.name || account.avatar ? account : undefined,
        parsed: { method: "browser-session" },
        latencyMs: Date.now() - started,
        at,
      };
    } catch (err) {
      return {
        ok: false,
        platformId,
        message: `连接检查失败: ${err instanceof Error ? err.message : String(err)}`,
        errorKind: "network",
        latencyMs: Date.now() - started,
        at,
      };
    } finally {
      // 连接检查不关闭浏览器(复用登录态),但关闭多余页面避免泄漏。
      if (context) {
        for (const p of context.pages().slice(1)) await p.close().catch(() => undefined);
      }
    }
  };
}

/**
 * CSDN 一键连接检查器:用凭据中的 Cookie 调官方 /myself/info 接口解析账号。
 */
export function makeCsdnConnectionChecker(http: PlatformHttpClient) {
  return async (req: ConnectionCheckRequest, now?: () => string): Promise<ConnectionCheckResult> => {
    const started = Date.now();
    const at = (now ?? (() => new Date().toISOString()))();
    const cookie = req.credentials["cookie"]?.trim() ?? "";
    if (!cookie) {
      return { ok: false, platformId: "csdn", message: "缺少 CSDN Cookie", errorKind: "invalid-credentials", latencyMs: Date.now() - started, at };
    }
    try {
      const res = await http.request({
        method: "GET",
        url: "https://blog.csdn.net/blog-console/api/v1/myself/info",
        headers: { Cookie: cookie },
      });
      const parsed = JSON.parse(res.text) as { code?: number; data?: { userName?: string; nickname?: string; avatar?: string; url?: string } };
      const data = parsed.data;
      if (!data?.userName && !data?.nickname) {
        return {
          ok: false,
          platformId: "csdn",
          message: `CSDN 连接失败(HTTP ${res.status}):Cookie 可能已过期或无效`,
          errorKind: "unauthorized",
          latencyMs: Date.now() - started,
          at,
        };
      }
      const { parseCsdnAccountInfo } = await import("@mpp/core");
      const account = parseCsdnAccountInfo(parsed);
      return {
        ok: true,
        platformId: "csdn",
        message: `连接成功:已识别 CSDN 账号${account.name ? `(${account.name})` : ""}`,
        account,
        parsed: { method: "official-api" },
        latencyMs: Date.now() - started,
        at,
      };
    } catch (err) {
      return {
        ok: false,
        platformId: "csdn",
        message: `CSDN 连接异常: ${err instanceof Error ? err.message : String(err)}`,
        errorKind: "network",
        latencyMs: Date.now() - started,
        at,
      };
    }
  };
}
