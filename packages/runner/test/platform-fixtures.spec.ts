import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { getAutomationAdapter } from "../src/platforms/registry.js";
import type { AutomationMode, AutomationPlatformId, AutomationPublishRequest } from "../src/types.js";
import { createFixtureServer, type FixtureServerHandle } from "./fixture-server.js";

let browser: Browser | undefined;
let fixtureServer: FixtureServerHandle | undefined;
const hasChromium = existsSync(chromium.executablePath());

// TEST-04:CI 中 Chromium 缺失必须失败,不得静默 skip。
const isCI = process.env.CI === "true";
if (isCI && !hasChromium) {
  throw new Error(
    `CI 环境必须安装 Chromium 才能运行浏览器 fixture 测试,但找不到浏览器: ${chromium.executablePath()}` +
      "。请先执行 `npx playwright install --with-deps chromium`。",
  );
}

beforeAll(async () => {
  if (!hasChromium) return;
  browser = await chromium.launch({ headless: true });
  fixtureServer = await createFixtureServer().start();
});

afterAll(async () => {
  await fixtureServer?.close();
  await browser?.close();
});

describe.skipIf(!hasChromium)("platform automation adapters on fixture pages (RUN-01/RUN-02)", () => {
  for (const platformId of [
    "zhihu",
    "bilibili",
    "xiaohongshu",
    "juejin",
    "cnblogs",
    "csdn",
    "weibo",
    "toutiao",
    "douyin",
    "kuaishou",
    "shipinhao",
  ] as const) {
    it(`${platformId} 草稿模式:submit 返回 submitted,verify 无证据时保持 drafted`, async () => {
      const page = await newFixturePage(platformId);
      const adapter = getAutomationAdapter(platformId);
      const req = request(platformId, "draft");

      await adapter.prepare(page, req);
      const submitted = await adapter.submit(page, req);
      // RUN-02:找不到保存按钮不能返回 drafted;fixture 有保存按钮,先返回 submitted。
      expect(submitted).toMatchObject({ ok: true, status: "submitted" });
      await expectFilled(page, platformId);
      expect(await page.locator('[data-testid="published"]').textContent()).toBe("false");

      const verified = await adapter.verify(page, req, submitted);
      // fixture 无成功证据 → 保持 drafted(草稿语义),不宣称 published。
      expect(verified.status).toBe("drafted");
      expect(verified.ok).toBe(true);
    });

    it(`${platformId} full-auto:confirm 拒绝缺失 confirmed 标记`, async () => {
      const page = await newFixturePage(platformId);
      const adapter = getAutomationAdapter(platformId);
      const req = request(platformId, "full-auto");

      await adapter.prepare(page, req);
      const rejected = await adapter.confirm(page, req);
      expect(rejected).toMatchObject({
        ok: false,
        status: "needs-user-action",
      });
    });

    it(`${platformId} full-auto:confirm 拒绝缺失 contentDigest`, async () => {
      const page = await newFixturePage(platformId);
      const adapter = getAutomationAdapter(platformId);
      const req: AutomationPublishRequest = {
        ...request(platformId, "full-auto"),
        confirmed: true,
      };

      await adapter.prepare(page, req);
      const rejected = await adapter.confirm(page, req);
      expect(rejected).toMatchObject({ ok: false, status: "failed" });
      expect(rejected?.message).toContain("内容摘要");
    });

    it(`${platformId} full-auto 带确认与摘要:submit 点击发布返回 submitted,verify 发现证据升级 published`, async () => {
      const page = await newFixturePage(platformId);
      const adapter = getAutomationAdapter(platformId);
      const req: AutomationPublishRequest = {
        ...request(platformId, "full-auto"),
        confirmed: true,
        contentDigest: "digest-abc",
      };

      await adapter.prepare(page, req);
      const confirmRes = await adapter.confirm(page, req);
      expect(confirmRes).toBeUndefined(); // 确认通过

      const submitted = await adapter.submit(page, req);
      expect(submitted).toMatchObject({ ok: true, status: "submitted" });
      await expectFilled(page, platformId);
      expect(await page.locator('[data-testid="published"]').textContent()).toBe("true");

      const verified = await adapter.verify(page, req, submitted);
      expect(verified.status).toBe("published");
      expect(verified.ok).toBe(true);
      expect(verified.evidence?.some((e) => e.includes("published=true"))).toBe(true);
    });
  }

  it("提交后断网/页面无证据 → verify 返回 unknown,禁止自动重试", async () => {
    const page = await newFixturePage("zhihu", { publishResult: "unknown" });
    const adapter = getAutomationAdapter("zhihu");
    const req: AutomationPublishRequest = {
      ...request("zhihu", "full-auto"),
      confirmed: true,
      contentDigest: "digest-abc",
    };

    await adapter.prepare(page, req);
    const submitted = await adapter.submit(page, req);
    expect(submitted.status).toBe("submitted");

    const verified = await adapter.verify(page, req, submitted);
    expect(verified.status).toBe("unknown");
    expect(verified.ok).toBe(false);
    expect(verified.message).toContain("无法确认");
  });

  it("找不到保存按钮时 submit 返回 failed(不谎报 drafted)", async () => {
    const page = await newFixturePage("zhihu", { withDraftButton: false });
    const adapter = getAutomationAdapter("zhihu");
    const req = request("zhihu", "draft");

    await adapter.prepare(page, req);
    const submitted = await adapter.submit(page, req);
    expect(submitted).toMatchObject({ ok: false, status: "failed" });
    expect(submitted.message).toContain("未找到保存草稿按钮");
  });

  it("stops when a human verification blocker is visible", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <main data-platform="zhihu">
        <div>请完成验证码验证</div>
        <input data-mpp-field="title" />
        <div data-mpp-field="body" contenteditable="true"></div>
        <button data-mpp-action="publish">发布</button>
      </main>
    `);

    const req = request("zhihu", "full-auto");
    const adapter = getAutomationAdapter("zhihu");
    await expect(adapter.prepare(page, req)).rejects.toThrow("人工处理");
  });
});

// ===== §6.2:本地 HTTP fixture(真实导航 / CSP / 页面生命周期)=====
describe.skipIf(!hasChromium)("platform adapters on local HTTP fixture pages (§6.2)", () => {
  const platformIds: Array<Exclude<AutomationPlatformId, "wechat">> = [
    "zhihu",
    "bilibili",
    "xiaohongshu",
    "juejin",
    "cnblogs",
    "csdn",
    "weibo",
    "toutiao",
    "douyin",
    "kuaishou",
    "shipinhao",
  ];

  for (const platformId of platformIds) {
    it(`${platformId} 通过真实导航加载本地页面并完成提交/核验`, async () => {
      if (!browser || !fixtureServer) throw new Error("Chromium/fixture server 未初始化");
      const page = await browser.newPage();
      const url = `${fixtureServer.baseUrl}/${platformId}`;
      await page.goto(url, { waitUntil: "load" });
      // 真实导航:文档已加载、标题正确。
      expect(await page.title()).toContain(platformId);

      const adapter = getAutomationAdapter(platformId);
      const req: AutomationPublishRequest = {
        ...request(platformId, "full-auto"),
        confirmed: true,
        contentDigest: `digest-${platformId}`,
      };
      await adapter.prepare(page, req);
      await adapter.confirm(page, req);
      const submitted = await adapter.submit(page, req);
      expect(submitted).toMatchObject({ ok: true, status: "submitted" });
      await expectFilled(page, platformId);

      const verified = await adapter.verify(page, req, submitted);
      expect(verified.status).toBe("published");
      expect(verified.evidence?.some((e) => e.includes("published=true"))).toBe(true);
      await page.close();
    });

    it(`${platformId} CSP 受限页面仍可正常提交(不因导航/脚本受限而失败)`, async () => {
      if (!browser || !fixtureServer) throw new Error("Chromium/fixture server 未初始化");
      const page = await browser.newPage();
      const url = `${fixtureServer.baseUrl}/${platformId}/csp`;
      await page.goto(url, { waitUntil: "load" });
      // CSP 响应头已注入。
      const csp = await page
        .context()
        .request.get(`${fixtureServer.baseUrl}/${platformId}/csp`)
        .then((r) => r.headers()["content-security-policy"])
        .catch(() => undefined);
      expect(csp).toBe("default-src 'self'");

      const adapter = getAutomationAdapter(platformId);
      const req: AutomationPublishRequest = {
        ...request(platformId, "full-auto"),
        confirmed: true,
        contentDigest: `digest-csp-${platformId}`,
      };
      await adapter.prepare(page, req);
      await adapter.confirm(page, req);
      const submitted = await adapter.submit(page, req);
      expect(submitted.ok).toBe(true);
      // CSP default-src 'self' 禁止内联脚本,发布按钮 onclick 不执行,
      // 页面无成功证据 → 适配器诚实返回 unknown(不谎报 published)。
      const verified = await adapter.verify(page, req, submitted);
      expect(verified.status).toBe("unknown");
      await expectFilled(page, platformId);
      await page.close();
    });
  }

  it("本地 HTTP 页面支持 no-draft 变体:找不到保存按钮返回 failed", async () => {
    if (!browser || !fixtureServer) throw new Error("Chromium/fixture server 未初始化");
    const page = await browser.newPage();
    await page.goto(`${fixtureServer.baseUrl}/zhihu/no-draft`, { waitUntil: "load" });
    const adapter = getAutomationAdapter("zhihu");
    const req = request("zhihu", "draft");
    await adapter.prepare(page, req);
    const submitted = await adapter.submit(page, req);
    expect(submitted).toMatchObject({ ok: false, status: "failed" });
    expect(submitted.message).toContain("未找到保存草稿按钮");
    await page.close();
  });

  it("本地 HTTP 页面支持 unknown 变体:提交后无证据返回 unknown", async () => {
    if (!browser || !fixtureServer) throw new Error("Chromium/fixture server 未初始化");
    const page = await browser.newPage();
    await page.goto(`${fixtureServer.baseUrl}/zhihu/unknown`, { waitUntil: "load" });
    const adapter = getAutomationAdapter("zhihu");
    const req: AutomationPublishRequest = {
      ...request("zhihu", "full-auto"),
      confirmed: true,
      contentDigest: "digest-abc",
    };
    await adapter.prepare(page, req);
    await adapter.confirm(page, req);
    const submitted = await adapter.submit(page, req);
    expect(submitted.status).toBe("submitted");
    const verified = await adapter.verify(page, req, submitted);
    expect(verified.status).toBe("unknown");
    expect(verified.ok).toBe(false);
    await page.close();
  });

  it("本地 HTTP 页面等待异步渲染后仍能填写(页面生命周期覆盖)", async () => {
    if (!browser || !fixtureServer) throw new Error("Chromium/fixture server 未初始化");
    const page = await browser.newPage();
    await page.goto(`${fixtureServer.baseUrl}/juejin`, { waitUntil: "load" });
    const adapter = getAutomationAdapter("juejin");
    const req = request("juejin", "draft");
    await adapter.prepare(page, req);
    const submitted = await adapter.submit(page, req);
    expect(submitted.ok).toBe(true);
    await expectFilled(page, "juejin");
    await page.close();
  });
});

async function newFixturePage(
  platformId: Exclude<AutomationPlatformId, "wechat">,
  options: { withDraftButton?: boolean; publishResult?: "true" | "unknown" } = {},
): Promise<Page> {
  if (!browser) throw new Error("Playwright Chromium is unavailable for fixture tests");
  const page = await browser.newPage();
  const draftButton = options.withDraftButton === false ? "" : `<button data-mpp-action="save-draft">保存草稿</button>`;
  const publishOnClick =
    options.publishResult === "unknown"
      ? ``
      : `onclick="document.querySelector('[data-testid=published]').textContent='true'"`;
  await page.setContent(`
    <main data-platform="${platformId}">
      <input data-mpp-field="title" />
      <div data-mpp-field="body" contenteditable="true"></div>
      <input data-mpp-field="tags" />
      <input data-mpp-field="cover" type="file" />
      ${draftButton}
      <button data-mpp-action="publish" ${publishOnClick}>发布</button>
      <span data-testid="published">false</span>
    </main>
  `);
  return page;
}

function request(platformId: AutomationPlatformId, mode: AutomationMode): AutomationPublishRequest {
  return {
    platformId,
    mode,
    payload: {
      title: `${platformId} 标题`,
      content:
        platformId === "xiaohongshu"
          ? "小红书正文\n#效率工具"
          : platformId === "juejin" || platformId === "cnblogs"
            ? `# ${platformId} 正文`
            : `<p>${platformId} 正文</p>`,
      mime: platformId === "xiaohongshu" ? "text/plain" : platformId === "juejin" || platformId === "cnblogs" ? "text/markdown" : "text/html",
      tags: ["效率", "创作"],
    },
  };
}

async function expectFilled(page: Page, platformId: AutomationPlatformId): Promise<void> {
  expect(await page.locator('[data-mpp-field="title"]').inputValue()).toBe(`${platformId} 标题`);
  const body = await page.locator('[data-mpp-field="body"]').textContent();
  expect(body).toContain(platformId === "xiaohongshu" ? "小红书正文" : `${platformId} 正文`);
  expect(await page.locator('[data-mpp-field="tags"]').inputValue()).toBe("效率,创作");
}
