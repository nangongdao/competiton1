import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RunnerConfig {
  readonly port: number;
  readonly profilesDir: string;
  readonly runsDir: string;
  /** 每次启动生成的本机 capability token(请求头 X-MPP-Token 携带)。 */
  readonly token: string;
  /** 是否启用鉴权(默认 true;测试可关闭)。 */
  readonly authEnabled: boolean;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");

export function loadRunnerConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  return {
    port: parsePort(env["RUNNER_PORT"] ?? env["PORT"]),
    profilesDir: resolve(env["PLAYWRIGHT_PROFILE_DIR"] ?? resolve(repoRoot, "data/playwright-profiles")),
    runsDir: resolve(env["AUTOMATION_RUNS_DIR"] ?? resolve(repoRoot, "data/automation-runs")),
    token: env["MP_RUNNER_TOKEN"]?.trim() || randomBytes(32).toString("hex"),
    authEnabled: (env["MP_RUNNER_AUTH_DISABLED"] ?? "").trim().toLowerCase() !== "true",
  };
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 8790;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid runner port: ${raw}`);
  }
  return port;
}
