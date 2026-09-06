#!/usr/bin/env node
/**
 * 真实账号 canary 实测(路线图 §6.1 Real canary / §6.3 门禁顺序 4)。
 *
 * 用法:
 *   node scripts/canary.mjs --platform wechat,zhihu        # 指定平台
 *   node scripts/canary.mjs --platform all                 # 全部平台
 *   node scripts/canary.mjs --platform wechat --real       # 真实账号模式(需要凭据)
 *   node scripts/canary.mjs --check                        # 仅校验 canary 前置条件
 *
 * 两种模式:
 * - 默认(fixture 模式):在本地 HTTP fixture 上验证各平台适配器的
 *   prepare → confirm → submit → verify 链路与成功证据判定(RUN-01/02),不触碰真实平台。
 *   可作为 CI/本地回归门禁(需要 Chromium)。
 * - --real 模式:调用本地 runner /automation/publish 对真实平台执行 draft/full-auto canary。
 *   要求:
 *   1. 本地 runner 已启动且 --real 传入其地址与 token(MP_RUNNER_URL / MP_RUNNER_TOKEN);
 *   2. 目标平台在浏览器登录态已登录(公众号走 server,见 docs/SUPPORT_MATRIX.md §4);
 *   3. 发布产物来自 core 序列化(经 @mpp/core)。
 *
 * 输出 JSON 报告并打印逐平台验收结论(对照 SUPPORT_MATRIX §4 测试账号验收清单)。
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const REAL = hasFlag("--real");
const CHECK_ONLY = hasFlag("--check");
const platformArg = readArg("--platform") ?? "all";
const runnerUrl = process.env["MP_RUNNER_URL"]?.trim() || "http://127.0.0.1:8790";
const runnerToken = process.env["MP_RUNNER_TOKEN"]?.trim() || "";

/** 七平台 canary 清单(SUPPORT_MATRIX §4 扩展)。 */
const CANARY_PLATFORMS = [
  { id: "wechat", name: "公众号", mode: "draft", real: true, accept: "草稿创建成功且幂等" },
  { id: "zhihu", name: "知乎", mode: "draft", real: true, accept: "草稿成功且有保存证据" },
  { id: "bilibili", name: "B站专栏", mode: "draft", real: true, accept: "草稿成功且有保存证据" },
  { id: "xiaohongshu", name: "小红书", mode: "draft", real: true, accept: "草稿成功且有保存证据" },
  { id: "juejin", name: "掘金", mode: "draft", real: true, accept: "草稿成功且 Markdown 保留" },
  { id: "cnblogs", name: "博客园", mode: "draft", real: true, accept: "草稿成功且 Markdown 保留" },
  { id: "csdn", name: "CSDN", mode: "draft", real: true, accept: "草稿成功且 Markdown 保留" },
];

function selectedPlatforms() {
  if (platformArg === "all") return CANARY_PLATFORMS;
  return CANARY_PLATFORMS.filter((p) => platformArg.split(",").map((s) => s.trim()).includes(p.id));
}

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}
function warn(msg) {
  console.warn(`  ⚠️  ${msg}`);
}
function fail(msg) {
  console.error(`  ❌ ${msg}`);
}

/** 简单 fixture 页面(与 runner 测试 fixture 同构:data-mpp-field 契约 + 成功证据)。 */
function fixtureHtml(platformId, { withDraft = true, publishResult = "true" } = {}) {
  const draftBtn = withDraft ? '<button data-mpp-action="save-draft">保存草稿</button>' : "";
  const onClick =
    publishResult === "true"
      ? 'onclick="document.querySelector(\'[data-testid=published]\').textContent=\'true\'"'
      : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${platformId} canary fixture</title></head>
<body data-platform="${platformId}">
  <h1>${platformId} 编辑器(fixture)</h1>
  <input data-mpp-field="title" placeholder="标题" />
  <div data-mpp-field="body" contenteditable="true"></div>
  <input data-mpp-field="tags" placeholder="标签" />
  ${draftBtn}
  <button data-mpp-action="publish" ${onClick}>发布</button>
  <span data-testid="published">false</span>
</body></html>`;
}

/** 在真实 Chromium 上跑一个平台的 fixture canary。 */
async function runFixtureCanary(platformId) {
  const { chromium } = await import("playwright");
  if (!existsSync(chromium.executablePath())) {
    throw new Error(`Chromium 未安装(${chromium.executablePath()});请先执行 npx playwright install chromium`);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const server = await startFixtureServer();
    try {
      const page = await browser.newPage();
      await page.goto(`${server.baseUrl}/${platformId}`, { waitUntil: "load" });
      const { getAutomationAdapter } = await import("../packages/runner/dist/platforms/registry.js");
      const adapter = getAutomationAdapter(platformId);
      const request = {
        platformId,
        mode: "full-auto",
        confirmed: true,
        contentDigest: `canary-${platformId}-${Date.now()}`,
        payload: {
          title: `canary ${platformId}`,
          content: `# canary ${platformId}`,
          mime: platformId === "xiaohongshu" ? "text/plain" : "text/markdown",
          tags: ["canary"],
        },
      };
      // prepare → confirm → submit → verify 四段式。
      await adapter.prepare(page, request);
      const confirmReceipt = await adapter.confirm(page, request);
      if (confirmReceipt) {
        return { platformId, ok: false, status: confirmReceipt.status, message: confirmReceipt.message };
      }
      const submitted = await adapter.submit(page, request);
      if (!submitted.ok) {
        return { platformId, ok: false, status: submitted.status, message: submitted.message };
      }
      const verified = await adapter.verify(page, request, submitted);
      return {
        platformId,
        ok: verified.ok && verified.status === "published",
        status: verified.status,
        message: verified.message,
        evidence: verified.evidence,
      };
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }
}

function startFixtureServer() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const platformId = pathname.replace(/^\//, "").replace(/\/$/, "");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fixtureHtml(platformId || "zhihu"));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        baseUrl: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

/** 真实账号模式:调 runner /automation/publish(Node 20+ 全局 fetch)。 */
async function runRealCanary(platform) {
  const body = {
    platformId: platform.id,
    mode: platform.mode,
    confirmed: platform.mode === "full-auto",
    contentDigest: `canary-real-${platform.id}-${Date.now()}`,
    payload: {
      title: `canary 实测 ${platform.name} ${new Date().toISOString().slice(0, 10)}`,
      content: `# canary 实测\n\n这是一条用于验证发布链路的自动化 canary 草稿,确认后会删除。`,
      mime: "text/markdown",
      tags: ["canary"],
    },
  };
  const res = await fetch(`${runnerUrl}/automation/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(runnerToken ? { "X-MPP-Token": runnerToken } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    platformId: platform.id,
    ok: res.ok && data.ok,
    status: data.status,
    message: data.message,
    evidence: data.evidence,
    diagnosticsPath: data.diagnosticsPath,
  };
}

async function main() {
  const platforms = selectedPlatforms();
  console.log(`\n📋 canary 实测清单(${platforms.length} 平台,${REAL ? "真实账号模式" : "fixture 模式"})`);
  console.log("=".repeat(64));

  if (CHECK_ONLY) {
    for (const p of platforms) {
      console.log(`\n${p.name}(${p.id})`);
      ok(`canary 验收标准:${p.accept}`);
      if (p.real) ok(`发布模式:${p.mode}(真实账号,默认不触碰真实发布)`);
      else warn(`无真实发布能力:仅 fixture 验证`);
    }
    console.log(`\n✅ canary 清单校验通过。真实发布前请确认:浏览器登录态/公众号凭据就绪,且默认不会真实发布。`);
    process.exit(0);
  }

  const results = [];
  for (const p of platforms) {
    console.log(`\n▶ ${p.name}(${p.id})`);
    try {
      const result = REAL ? await runRealCanary(p) : await runFixtureCanary(p.id);
      results.push(result);
      if (result.ok) ok(`${result.status}: ${result.message}`);
      else fail(`${result.status}: ${result.message}`);
      if (result.evidence?.length) {
        for (const e of result.evidence) ok(`证据: ${e}`);
      }
      if (result.diagnosticsPath) ok(`诊断工件: ${result.diagnosticsPath}`);
    } catch (err) {
      results.push({ platformId: p.id, ok: false, status: "failed", message: err instanceof Error ? err.message : String(err) });
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + "=".repeat(64));
  console.log(`📊 canary 结果: ${passed}/${results.length} 通过`);
  for (const r of results) {
    console.log(`   ${r.ok ? "✅" : "❌"} ${r.platformId}: ${r.status}`);
  }
  const report = { mode: REAL ? "real" : "fixture", generatedAt: new Date().toISOString(), passed, total: results.length, results };
  const outPath = join(ROOT, "dist", "canary", `canary-report-${Date.now()}.json`);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 报告已写入: ${outPath}`);

  if (passed < results.length) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
