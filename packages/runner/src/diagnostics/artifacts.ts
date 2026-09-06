import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import type { AutomationPlatformId } from "../types.js";

export interface RunArtifacts {
  readonly dir: string;
  readonly requestPath: string;
  readonly receiptPath: string;
  readonly finalScreenshotPath: string;
  readonly failureScreenshotPath: string;
  readonly tracePath: string;
  readonly domPath: string;
  writeJson(kind: "request" | "receipt", value: unknown): Promise<void>;
  /** 捕获截图 + DOM(OBS-01:失败可定位到工件)。 */
  capture(page: Page, kind: "final" | "failure"): Promise<void>;
}

const secretKeyPattern = /(secret|token|password|cookie|apikey|api_key|appsecret|accessToken)/i;

export async function createRunArtifacts(
  root: string,
  platformId: AutomationPlatformId,
  now: Date = new Date(),
): Promise<RunArtifacts> {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dir = join(root, `${stamp}-${platformId}`);
  await mkdir(dir, { recursive: true });

  const requestPath = join(dir, "request.json");
  const receiptPath = join(dir, "receipt.json");
  return {
    dir,
    requestPath,
    receiptPath,
    finalScreenshotPath: join(dir, "final.png"),
    failureScreenshotPath: join(dir, "failure.png"),
    tracePath: join(dir, "trace.zip"),
    domPath: join(dir, "dom.html"),
    async writeJson(kind, value) {
      const path = kind === "request" ? requestPath : receiptPath;
      await writeFile(path, `${JSON.stringify(redactForArtifact(value), null, 2)}\n`, "utf8");
    },
    async capture(page, kind) {
      try {
        if (kind === "final") {
          await page.screenshot({ path: join(dir, "final.png"), fullPage: true });
        } else {
          await page.screenshot({ path: join(dir, "failure.png"), fullPage: true });
        }
        await writeFile(join(dir, "dom.html"), await page.content(), "utf8");
      } catch {
        /* 截图失败不阻断发布流程 */
      }
    },
  };
}

export function redactForArtifact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactForArtifact(item));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = secretKeyPattern.test(key) ? "[redacted]" : redactForArtifact(entry);
  }
  return out;
}

/** 运行目录保留策略(OBS-01):最多保留的目录数。 */
export const RUN_ARTIFACTS_MAX_DIRS = 50;
/** 运行目录保留时长(ms),默认 7 天。 */
export const RUN_ARTIFACTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 清理过期/超量运行目录(OBS-01 自动清理)。
 * 按目录名的 ISO 时间戳排序,保留最新 maxDirs 个,并删除超过 TTL 的旧目录。
 * @returns 清理的目录数
 */
export async function pruneRunArtifacts(
  root: string,
  now: number = Date.now(),
  maxDirs: number = RUN_ARTIFACTS_MAX_DIRS,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return 0; // 目录不存在
  }

  const dirs = entries;
  // 目录名格式:YYYY-MM-DDTHH-MM-SS-mmmZ-platform
  const withTs = dirs
    .map((name) => {
      const parsed = parseArtifactTimestamp(name);
      return { name, ts: parsed ?? Number.NaN };
    })
    .sort((a, b) => (Number.isNaN(a.ts) ? 1 : Number.isNaN(b.ts) ? -1 : b.ts - a.ts));

  const toRemove = new Set<string>();
  // 超 TTL
  for (const d of withTs) {
    if (!Number.isNaN(d.ts) && now - d.ts > RUN_ARTIFACTS_TTL_MS) toRemove.add(d.name);
  }
  // 超数量
  const keep = withTs.filter((d) => !toRemove.has(d.name)).slice(0, maxDirs);
  const keepSet = new Set(keep.map((d) => d.name));
  for (const d of withTs) {
    if (!keepSet.has(d.name)) toRemove.add(d.name);
  }

  let removed = 0;
  for (const name of toRemove) {
    try {
      await rm(join(root, name), { recursive: true, force: true });
      removed++;
    } catch {
      /* 单目录删除失败不影响其它 */
    }
  }
  return removed;
}

/** 解析运行目录名中的 ISO 时间戳(2026-05-31T10-20-30-000Z → ms)。 */
export function parseArtifactTimestamp(name: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, ms] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
