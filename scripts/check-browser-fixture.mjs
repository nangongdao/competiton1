#!/usr/bin/env node
/**
 * TEST-04 —— 浏览器 fixture 前置检查。
 *
 * 在运行浏览器 fixture / Web E2E 前,确认:
 * 1. Chromium 已安装(否则直接失败,不等到 vitest 静默 skip);
 * 2. fixture 用例数量 >= 7(路线图要求“CI 明确显示实际执行 7+ 浏览器用例”)。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));

// 1) Chromium 必须已安装。
const exe = chromium.executablePath();
if (!existsSync(exe)) {
  console.error(`[TEST-04] Chromium 未安装: ${exe}`);
  console.error("[TEST-04] 请先执行: npx playwright install --with-deps chromium");
  process.exit(1);
}

// 2) fixture 用例数必须 >= 7。
const fixturePath = resolve(here, "../packages/runner/test/platform-fixtures.spec.ts");
const src = readFileSync(fixturePath, "utf8");
const caseCount = (src.match(/\bit\(/g) ?? []).length;
const required = 7;
if (caseCount < required) {
  console.error(`[TEST-04] fixture 用例数 ${caseCount} < ${required},不满足路线图“实际执行 7+ 浏览器用例”`);
  process.exit(1);
}

console.log(`[TEST-04] Chromium OK: ${exe}`);
console.log(`[TEST-04] fixture 用例数: ${caseCount} (>= ${required})`);
console.log("[TEST-04] 浏览器前置检查通过 ✓");
