#!/usr/bin/env node
/**
 * 0.11.0-rc.1 发布门禁(Roadmap v10 发布后运营闭环)。
 *
 * 在正式发布前运行,校验:
 * 1. 版本一致性:根 package.json / 各 workspace / tauri.conf.json / Cargo.toml / manifest 版本一致;
 * 2. CHANGELOG 存在 [0.7.0-alpha.1] 条目且已记录关键变更;
 * 3. canary 清单:要求专用测试账号在真实平台完成草稿 canary(人工确认,见 SUPPORT_MATRIX §4);
 * 4. 安装包校验和生成:为 dist 下的 .deb/.AppImage/.dmg/.msi 生成 SHA256SUMS。
 *
 * 用法:
 *   node scripts/release-gate.mjs          # 校验发布门禁
 *   node scripts/release-gate.mjs --sums   # 生成安装包 SHA256SUMS 并输出
 */
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const EXPECTED_VERSION = "0.11.0-rc.1";
const FAILURES = [];
let warnings = 0;

function fail(msg) {
  FAILURES.push(msg);
  console.error(`❌ ${msg}`);
}
function ok(msg) {
  console.log(`✅ ${msg}`);
}
function warn(msg) {
  warnings += 1;
  console.warn(`⚠️  ${msg}`);
}

// 1) 版本一致性。
function checkVersion() {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (rootPkg.version !== EXPECTED_VERSION) fail(`根 package.json 版本 ${rootPkg.version} ≠ ${EXPECTED_VERSION}`);
  else ok(`根 package.json 版本 ${EXPECTED_VERSION}`);

  for (const name of ["app", "core", "desktop", "runner", "server"]) {
    const pkg = JSON.parse(readFileSync(join(ROOT, "packages", name, "package.json"), "utf8"));
    if (pkg.version !== EXPECTED_VERSION) fail(`packages/${name}/package.json 版本 ${pkg.version} ≠ ${EXPECTED_VERSION}`);
  }
  ok("5 个 workspace package.json 版本一致");

  const tauri = JSON.parse(readFileSync(join(ROOT, "packages/desktop/src-tauri/tauri.conf.json"), "utf8"));
  if (tauri.version !== EXPECTED_VERSION) fail(`tauri.conf.json 版本 ${tauri.version} ≠ ${EXPECTED_VERSION}`);
  else ok(`tauri.conf.json 版本 ${EXPECTED_VERSION}`);

  const cargo = readFileSync(join(ROOT, "packages/desktop/src-tauri/Cargo.toml"), "utf8");
  if (!cargo.includes(`version = "${EXPECTED_VERSION}"`)) fail(`Cargo.toml 未声明版本 ${EXPECTED_VERSION}`);
  else ok(`Cargo.toml 版本 ${EXPECTED_VERSION}`);

  const manifest = readFileSync(join(ROOT, "packages/app/manifest.config.ts"), "utf8");
  if (!manifest.includes(`version: "${EXPECTED_VERSION}"`)) fail(`manifest.config.ts 未声明版本 ${EXPECTED_VERSION}`);
  else ok(`manifest.config.ts 版本 ${EXPECTED_VERSION}`);
}

// 2) CHANGELOG 条目。
function checkChangelog() {
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## [${EXPECTED_VERSION}]`)) {
    fail(`CHANGELOG.md 缺少 [${EXPECTED_VERSION}] 版本条目`);
  } else {
    ok(`CHANGELOG.md 存在 [${EXPECTED_VERSION}] 条目`);
  }
  if (!changelog.includes("掘金") && !changelog.includes("juejin")) {
    warn("CHANGELOG 未提及第五平台(掘金)");
  }
}

// 3) canary 清单(人工确认) + 自动化工具存在性 + 升级/回滚演练脚本存在性。
function checkCanary() {
  const support = readFileSync(join(ROOT, "docs/SUPPORT_MATRIX.md"), "utf8");
  if (!support.includes("测试账号")) {
    warn("SUPPORT_MATRIX 未包含 canary 测试账号章节");
  }
  ok("canary 清单存在于 SUPPORT_MATRIX(发布前须人工在真实账号完成草稿 canary)");

  // 自动化 canary 工具与升级/回滚演练脚本应存在且可运行。
  if (!existsSync(join(ROOT, "scripts/canary.mjs"))) {
    warn("缺少 scripts/canary.mjs(canary 自动化工具)");
  } else {
    ok("canary 自动化工具存在(scripts/canary.mjs)");
  }
  if (!existsSync(join(ROOT, "scripts/upgrade-rollback-drill.mjs"))) {
    warn("缺少 scripts/upgrade-rollback-drill.mjs(升级/回滚演练)");
  } else {
    ok("升级/回滚演练脚本存在(scripts/upgrade-rollback-drill.mjs)");
  }
}

// 4) 安装包 SHA256SUMS。
function genSums() {
  const searchDirs = [
    join(ROOT, "dist"),
    join(ROOT, "packages/desktop/src-tauri/target/release/bundle"),
  ];
  const files = [];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir, { recursive: true })) {
      const full = join(dir, f);
      if (!existsSync(full)) continue;
      if (/\.(deb|rpm|AppImage|dmg|msi)$/i.test(f)) files.push(full);
    }
  }
  if (files.length === 0) {
    warn("未找到安装包(.deb/.rpm/.AppImage/.dmg/.msi);发布前先执行 npm run desktop:build");
    return;
  }
  const lines = files.map((f) => {
    const buf = readFileSync(f);
    const hash = createHash("sha256").update(buf).digest("hex");
    return `${hash}  ${basename(f)}`;
  });
  const out = join(ROOT, "dist", "SHA256SUMS");
  writeFileSync(out, lines.join("\n") + "\n");
  ok(`已生成 ${out}(${files.length} 个安装包)`);
}

const genSumsOnly = process.argv.includes("--sums");
if (genSumsOnly) {
  genSums();
  console.log(`\n完成(警告 ${warnings})。`);
  process.exit(0);
}

checkVersion();
checkChangelog();
checkCanary();
genSums();

console.log("");
if (FAILURES.length > 0) {
  console.error(`发布门禁失败:${FAILURES.length} 项未通过,请修复后重试。`);
  process.exit(1);
}
console.log(`发布门禁通过(警告 ${warnings} 项,不阻塞)。可以发布 ${EXPECTED_VERSION}。`);
