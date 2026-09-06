/**
 * 夜间门禁脚本 —— 故障注入 + 性能重复样本 + 安全 payload(路线图 §6.3 门禁顺序 3)。
 *
 * 用法:
 *   node scripts/nightly-gate.mjs [--fault] [--perf] [--security]
 *   (不带参数时全部执行)
 *
 * 内容:
 * 1. --fault:   跑故障注入 + 进程重启恢复测试(Phase 2 退出条件)与 runner/route 安全相关单测。
 * 2. --perf:    跑 preview 性能预算与 bundle 门禁(多次样本,验证无明显抖动)。
 * 3. --security:跑 SSRF/鉴权/净化等安全回归(server/core 相关 spec)。
 */
import { execSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;
const fault = runAll || args.has("--fault");
const perf = runAll || args.has("--perf");
const security = runAll || args.has("--security");

function step(name, cmd) {
  console.log(`\n===== ${name} =====`);
  execSync(cmd, { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
}

if (fault) {
  step("故障注入 + 进程重启恢复(core + server 持久化)", [
    "npx vitest run",
    "packages/core/test/fault-injection.spec.ts",
    "packages/core/test/job-restart-recovery.spec.ts",
    "packages/core/test/job-service.spec.ts",
    "packages/core/test/job-store.spec.ts",
    "packages/core/test/job-state-machine.spec.ts",
    "packages/server/test/jobs.spec.ts",
  ].join(" "));
}

if (perf) {
  // 性能重复样本:preview 预算跑 3 次,检查无明显抖动;随后 bundle 门禁。
  for (let i = 1; i <= 3; i++) {
    step(`性能重复样本 ${i}/3(preview + bundle)`, [
      "npx vitest run packages/core/test/perf.spec.ts",
      "&&",
      "npm run build:web",
      "&&",
      "node scripts/check-bundle.mjs",
    ].join(" "));
  }
}

if (security) {
  step("安全回归(server SSRF/鉴权 + 共享路由鉴权 + core 净化/URL 守卫)", [
    "npx vitest run",
    "packages/server/test/image-fetcher.spec.ts",
    "packages/server/test/security.spec.ts",
    "packages/server/test/route-integration.spec.ts",
    "packages/server/test/upload.spec.ts",
    "packages/server/test/share.spec.ts",
    "packages/core/test/url-guard.spec.ts",
    "packages/core/test/sanitize.spec.ts",
    "packages/core/test/image-host.spec.ts",
  ].join(" "));
}

console.log("\n✅ nightly-gate 全部通过");
