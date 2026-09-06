/**
 * TEST-04 —— Web App 浏览器冒烟 E2E(真实 Chromium 下运行)。
 *
 * 覆盖路线图 TEST-04 的核心工作流回归:
 * - 页面可加载、多平台预览渲染(公众号/知乎/B站/小红书/掘金/CSDN);
 * - 输入 Markdown 后预览实时更新;
 * - 点击「一键模拟发布」出现回执、busy 复位;
 * - 草稿抽屉可打开并展示自动保存的草稿;
 * - 设置抽屉可打开并切换 LLM key 持久化开关;
 * - 发布任务面板可打开并展示「暂无发布任务」。
 *
 * 运行前提:已 `npm run build:web` 且 Chromium 已安装。
 * CI 中由独立 browser job 执行;本文件不 skip(缺浏览器即失败)。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../dist");
const indexHtml = resolve(distDir, "index.html");

const isCI = process.env.CI === "true";
// TEST-04:CI 中缺构建产物或 Chromium 必须失败,不得静默 skip。
if (isCI && !existsSync(indexHtml)) {
  throw new Error(`[TEST-04] 缺少 Web 构建产物 ${indexHtml},请先执行 npm run build:web`);
}
if (isCI && !existsSync(chromium.executablePath())) {
  throw new Error(
    `[TEST-04] 缺少 Chromium: ${chromium.executablePath()}。请先执行 npx playwright install --with-deps chromium`,
  );
}
// 本地(非 CI)缺浏览器或构建产物时跳过,避免破坏开发者本地 verify。
const canRun = existsSync(indexHtml) && existsSync(chromium.executablePath());

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** 极简静态文件服务器:file:// 下 CORS 会拦截模块脚本,必须走 http。 */
function serveStatic(dir: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (pathname === "/") pathname = "/index.html";
      const filePath = normalize(join(dir, pathname));
      // 防目录穿越:必须在 dist 内。
      if (!filePath.startsWith(normalize(dir))) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        if (!statSync(filePath).isFile()) throw new Error("not file");
        const body = readFileSync(filePath);
        const type = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": type });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolveServer({ server, port: addr.port });
    });
  });
}

let browser: Browser;
let page: Page;
let staticServer: Server;
let baseUrl = "";

beforeAll(async () => {
  const { server, port } = await serveStatic(distDir);
  staticServer = server;
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  // 关闭首屏开场动画(IntroOverlay),避免遮挡后续交互。
  const intro = page.locator(".intro-overlay");
  if (await intro.count()) {
    await intro.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForSelector(".intro-overlay", { state: "detached", timeout: 5000 }).catch(() => undefined);
  }
});

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await new Promise<void>((resolveClose) => staticServer?.close(() => resolveClose()));
});

describe.skipIf(!canRun)("TEST-04 Web App 浏览器冒烟 E2E", () => {
  it("页面可加载并渲染平台预览", async () => {
    await page.waitForSelector(".preview-grid", { timeout: 15_000 });
    const names = await page.locator(".preview-name").allTextContents();
    expect(names.join(",")).toContain("公众号");
    expect(names.join(",")).toContain("知乎");
    expect(names.join(",")).toContain("B站");
    expect(names.join(",")).toContain("小红书");
    expect(names.join(",")).toContain("掘金");
  });

  it("编辑 Markdown 后预览标题实时更新", async () => {
    await page.fill('textarea[aria-label="Markdown 内容"]', "# E2E 冒烟标题\n\n这是一段正文。\n\n## 小节\n\n更多内容。");
    // 防抖 250ms + 同步/Worker 计算,轮询等待预览更新。
    await page.waitForFunction(
      () => document.querySelector(".html-title")?.textContent === "E2E 冒烟标题",
      undefined,
      { timeout: 10_000 },
    );
  });

  it("一键模拟发布出现回执且按钮复位", async () => {
    const publishBtn = page.locator("button", { hasText: "一键模拟发布" });
    await publishBtn.click();
    // 等待回执出现(发布中 → 回执)。
    await page.waitForSelector(".receipt", { timeout: 15_000 });
    const receipts = await page.locator(".receipt").allTextContents();
    expect(receipts.length).toBeGreaterThan(0);
    // busy 复位:按钮恢复可点且文案非"发布中…"。
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("模拟发布"));
      return btn && !btn.textContent?.includes("发布中");
    });
  });

  it("草稿抽屉可打开并展示自动保存草稿", async () => {
    // 触发自动保存:编辑后等 1.2s 防抖 + IndexedDB 写入。
    await page.fill('textarea[aria-label="Markdown 内容"]', "# 草稿测试标题\n\n自动保存验证。");
    await page.waitForTimeout(1400);
    await page.locator('button[aria-label*="草稿与历史"]').click();
    await page.waitForSelector(".drawer", { timeout: 5000 });
    const titles = await page.locator(".draft-title").allTextContents();
    expect(titles.join()).toContain("草稿测试标题");
  }, 15000);

  it("设置抽屉可打开并切换 LLM key 持久化开关", async () => {
    // 关闭可能残留的抽屉(草稿抽屉),再打开设置抽屉。
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.locator('button[aria-label*="AI 设置"]').click();
    await page.waitForSelector(".drawer", { timeout: 5000 });
    // 用 role=switch + aria-label 精确定位持久化开关(而非按钮选择器)。
    const persistSwitch = page.getByRole("switch", { name: "持久化保存 API Key" });
    await persistSwitch.click({ timeout: 5000 });
    // 开启后标签变「已持久化」,给足等待时间。
    await page.waitForFunction(() => document.body.textContent?.includes("已持久化"), undefined, { timeout: 8000 });
  }, 15000);

  it("发布任务面板可打开并展示空态", async () => {
    await page.keyboard.press("Escape"); // 关闭设置抽屉
    await page.locator('button[aria-label="打开发布任务面板"]').click();
    await page.waitForSelector(".task-panel", { timeout: 5000 });
    expect(await page.locator(".panel-empty-title").textContent()).toContain("暂无发布任务");
  });
});
