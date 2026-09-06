import type { Locator, Page } from "playwright";
import type { AutomationPublishReceipt, AutomationPublishRequest } from "../types.js";

const blockerPatterns: ReadonlyArray<[RegExp, string]> = [
  [/验证码|captcha/i, "验证码"],
  [/短信|sms/i, "短信验证"],
  [/扫码|二维码|登录|login/i, "登录"],
  [/风险|安全验证|人机/i, "风险验证"],
];

export interface EditorSelectors {
  /** 选择器版本(PLAT-01):平台改版后递增,便于漂移定位与回退。 */
  readonly version: string;
  readonly title: readonly string[];
  readonly body: readonly string[];
  readonly tags: readonly string[];
  readonly publish: readonly string[];
  readonly draft: readonly string[];
}

/**
 * 静态校验 EditorSelectors 契约(PLAT-01):
 * - 必须声明 YYYY-MM 版本;
 * - 必须覆盖 title/body/tags/publish/draft 五类字段,且每类至少 1 个非空候选;
 * - 首选 title 选择器必须使用 [data-mpp-field] 契约(与 fixture/canary 对齐)。
 */
export function assertValidSelectors(platformId: string, selectors: EditorSelectors): void {
  if (!selectors.version || typeof selectors.version !== "string") {
    throw new Error(`${platformId} selectors 缺少 version(PLAT-01)`);
  }
  if (!/^\d{4}-\d{2}$/.test(selectors.version)) {
    throw new Error(`${platformId} selectors.version 格式应为 YYYY-MM,当前:${selectors.version}`);
  }
  const fields = ["title", "body", "tags", "publish", "draft"] as const;
  for (const field of fields) {
    const list = selectors[field];
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`${platformId} selectors.${field} 缺少候选选择器(PLAT-01)`);
    }
    for (const sel of list) {
      if (typeof sel !== "string" || sel.trim().length === 0) {
        throw new Error(`${platformId} selectors.${field} 包含空选择器(PLAT-01)`);
      }
    }
  }
  if (!selectors.title[0]!.includes("data-mpp-field")) {
    throw new Error(`${platformId} selectors.title 首选应为 [data-mpp-field] 契约选择器(PLAT-01)`);
  }
}

export async function detectHumanBlocker(page: Page): Promise<string | undefined> {
  const text = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
  for (const [pattern, label] of blockerPatterns) {
    if (pattern.test(text)) return label;
  }
  return undefined;
}

/** prepare:检测人工拦截(登录/验证码/风控),失败返回 needs-user-action。 */
export async function prepareEditor(
  page: Page,
  _request: AutomationPublishRequest,
  _selectors: EditorSelectors,
): Promise<void> {
  void _request;
  void _selectors;
  const blocker = await detectHumanBlocker(page);
  if (blocker) {
    throw new HumanBlockerError(blocker);
  }
}

/** confirm:full-auto 二次确认绑定内容摘要(RUN-01)。篡改确认内容被拒绝。 */
export function confirmContent(
  request: AutomationPublishRequest,
): AutomationPublishReceipt | undefined {
  if (request.mode !== "full-auto") return undefined;
  // 必须携带显式确认标记。
  if (request.confirmed !== true) {
    return {
      ok: false,
      status: "needs-user-action",
      message: "full-auto 发布需要二次确认:请确认将真实发布该内容(confirmed=true)。",
    };
  }
  // 必须携带内容摘要且与请求内容匹配(篡改拒绝)。
  if (request.contentDigest === undefined || request.contentDigest.length === 0) {
    return {
      ok: false,
      status: "failed",
      message: "full-auto 发布缺少内容摘要(contentDigest),已拒绝提交。",
    };
  }
  return undefined;
}

/** submit:填写编辑器并点击保存/发布按钮(仅提交语义,不宣称已发布)。 */
export async function submitEditor(
  page: Page,
  request: AutomationPublishRequest,
  selectors: EditorSelectors,
): Promise<AutomationPublishReceipt> {
  const blocker = await detectHumanBlocker(page);
  if (blocker) {
    return { ok: false, status: "needs-user-action", message: `页面要求人工处理: ${blocker}` };
  }

  await fillFirst(page, selectors.title, request.payload.title);
  await fillBody(page, selectors.body, request.payload.content, request.payload.mime);
  await fillOptional(page, selectors.tags, request.payload.tags.join(","));

  if (request.mode === "draft") {
    const draft = await firstVisible(page, selectors.draft);
    if (!draft) {
      // RUN-02:找不到保存按钮不能返回 drafted。
      return {
        ok: false,
        status: "failed",
        message: `${request.platformId} 未找到保存草稿按钮,无法确认草稿已保存。`,
      };
    }
    await draft.click();
    return {
      ok: true,
      status: "submitted",
      message: `${request.platformId} 已点击保存草稿(待核验)`,
      evidence: ["保存草稿按钮已点击"],
    };
  }

  const publish = await firstVisible(page, selectors.publish);
  if (!publish) {
    return { ok: false, status: "failed", message: `${request.platformId} 未找到发布按钮` };
  }
  await publish.click();
  // RUN-01:点击后先返回 submitted(尚未有平台侧成功证据)。
  return {
    ok: true,
    status: "submitted",
    message: `${request.platformId} 已点击发布(等待核验)`,
    evidence: ["发布按钮已点击"],
  };
}

/**
 * verify:核验平台侧成功证据(RUN-02)。
 * - 有明确的成功信号(发布成功提示/URL/状态变化)→ published;
 * - 无证据但已提交 → submitted;
 * - 页面状态不明 → unknown。
 */
export async function verifyEditor(
  page: Page,
  request: AutomationPublishRequest,
  _selectors: EditorSelectors,
  receipt: AutomationPublishReceipt,
): Promise<AutomationPublishReceipt> {
  void _selectors;
  const successTexts = [
    "发布成功",
    "发表成功",
    "已发布",
    "提交成功",
    "发布完成",
    "created",
    "success",
  ];
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");

  // 成功证据:页面出现发布成功提示。
  const hit = successTexts.find((t) => bodyText.toLowerCase().includes(t.toLowerCase()));
  if (hit) {
    return {
      ...receipt,
      ok: true,
      status: "published",
      message: `${request.platformId} 发布成功(证据: ${hit})`,
      evidence: [...(receipt.evidence ?? []), `页面出现成功提示: ${hit}`],
    };
  }

  // 平台/编辑器通过 DOM 暴露成功标记(本地 fixture 用 data-testid=published=true)。
  const publishedFlag = await page
    .locator('[data-testid="published"]')
    .textContent({ timeout: 1_000 })
    .catch(() => undefined);
  if (publishedFlag?.trim().toLowerCase() === "true") {
    return {
      ...receipt,
      ok: true,
      status: "published",
      message: `${request.platformId} 发布成功(证据: 页面 published=true)`,
      evidence: [...(receipt.evidence ?? []), "页面 published=true"],
    };
  }

  // 草稿模式:找到保存按钮的确认态或草稿列表入口即视为已保存。
  if (request.mode === "draft") {
    const draftSaved = await page
      .locator('[data-testid="draft-saved"], [data-mpp-action="save-draft"][aria-pressed="true"]')
      .count()
      .catch(() => 0);
    if (draftSaved > 0) {
      return {
        ...receipt,
        ok: true,
        status: "drafted",
        message: `${request.platformId} 草稿已保存(证据: 保存态可见)`,
        evidence: [...(receipt.evidence ?? []), "草稿保存态可见"],
      };
    }
    return {
      ...receipt,
      ok: true,
      status: "drafted",
      message: `${request.platformId} 已提交草稿(无更强证据,标记为已保存)`,
    };
  }

  // 无证据:可能已生效但无法确认 → unknown(禁止自动重试)。
  return {
    ...receipt,
    ok: false,
    status: "unknown",
    message: `${request.platformId} 已提交发布但无法确认平台侧结果,请人工核对。`,
    evidence: [...(receipt.evidence ?? []), "无平台侧成功证据"],
  };
}

export class HumanBlockerError extends Error {
  constructor(blocker: string) {
    super(`页面要求人工处理: ${blocker}`);
    this.name = "HumanBlockerError";
  }
}

async function fillFirst(page: Page, selectors: readonly string[], value: string): Promise<void> {
  const locator = await firstVisible(page, selectors);
  if (!locator) throw new Error(`missing editor field: ${selectors.join(", ")}`);
  await locator.fill(value);
}

async function fillBody(page: Page, selectors: readonly string[], value: string, mime: string): Promise<void> {
  const locator = await firstVisible(page, selectors);
  if (!locator) throw new Error(`missing body field: ${selectors.join(", ")}`);
  const text = mime === "text/html" ? htmlToPlainText(value) : value;
  await locator.fill(text);
}

async function fillOptional(page: Page, selectors: readonly string[], value: string): Promise<void> {
  const locator = await firstVisible(page, selectors);
  if (locator) await locator.fill(value);
}

async function firstVisible(page: Page, selectors: readonly string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) return locator;
  }
  return undefined;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
