/**
 * DATA-02 效果回收:CSV 导入与手工录入 + DATA-03 官方 API 指标同步。
 *
 * CSV 格式(无 BOM,UTF-8,首行表头):
 * ```
 * platform,title,remote_id,remote_url,published_at,views,likes,favorites,comments,shares,follower_delta
 * wechat,我的文章,100001,https://...,2026-08-05T10:00:00Z,1200,80,30,12,5,3
 * ```
 * - `platform` 必填;`title` 必填;其余可选。
 * - 行损坏或平台未知:整行跳过并收集错误(不阻断整体导入)。
 */
import type { PerformanceRecord, PostMetrics, PerformanceStore, MetricsProvider } from "./types.js";

export const PERFORMANCE_DATA_SCHEMA_VERSION = 1;

export interface CsvImportOptions {
  /** 数据来源标记(默认 "csv")。 */
  readonly source?: string;
  /** 采集时间(默认 now)。 */
  readonly collectedAt?: string;
  /** 已存在的 remoteId 去重:同一平台 + 同一 remoteId 的记录更新而非新增。 */
  readonly dedupeByRemoteId?: boolean;
}

export interface CsvImportResult {
  readonly ok: boolean;
  readonly imported: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

/** 解析一行 CSV(处理简单引号包裹)。 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 解析 CSV 文本为效果记录(不写存储,供调用方决定)。
 */
export function parsePerformanceCsv(
  raw: string,
  options: CsvImportOptions = {},
): { records: PerformanceRecord[]; errors: string[] } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const records: PerformanceRecord[] = [];
  const errors: string[] = [];

  if (lines.length === 0) {
    return { records, errors: ["CSV 为空"] };
  }
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const indexOf = (name: string): number => header.indexOf(name);
  // 校验表头:platform 与 title 必须存在。
  if (indexOf("platform") < 0 || indexOf("title") < 0) {
    return { records, errors: ["CSV 缺少必需列:platform / title"] };
  }

  const collectedAt = options.collectedAt ?? new Date().toISOString();
  const source = options.source ?? "csv";

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const at = (name: string): string | undefined => {
      const idx = indexOf(name);
      return idx >= 0 ? cells[idx]?.trim() : undefined;
    };
    const platformId = at("platform");
    const title = at("title");
    if (!platformId || !title) {
      errors.push(`第 ${i + 1} 行:缺少 platform 或 title,已跳过`);
      continue;
    }
    const publishedAt = at("published_at") ?? collectedAt;
    const metrics: Record<string, number> = {};
    const views = toNumber(at("views"));
    const likes = toNumber(at("likes"));
    const favorites = toNumber(at("favorites"));
    const comments = toNumber(at("comments"));
    const shares = toNumber(at("shares"));
    const followerDelta = toNumber(at("follower_delta"));
    if (views !== undefined) metrics.views = views;
    if (likes !== undefined) metrics.likes = likes;
    if (favorites !== undefined) metrics.favorites = favorites;
    if (comments !== undefined) metrics.comments = comments;
    if (shares !== undefined) metrics.shares = shares;
    if (followerDelta !== undefined) metrics.followerDelta = followerDelta;

    records.push({
      id: crypto.randomUUID(),
      platformId,
      title,
      remoteId: at("remote_id") || undefined,
      remoteUrl: at("remote_url") || undefined,
      publishedAt,
      collectedAt,
      metrics: metrics as unknown as PostMetrics,
      source,
    });
  }

  return { records, errors };
}

/**
 * 把解析出的记录写入存储(可选按 remoteId 去重更新)。
 */
export async function importPerformanceRecords(
  store: PerformanceStore,
  records: readonly PerformanceRecord[],
  options: CsvImportOptions = {},
): Promise<CsvImportResult> {
  const existing = await store.list();
  const result = { ok: true as boolean, imported: 0, updated: 0, skipped: 0, errors: [] as string[] };

  for (const record of records) {
    if (options.dedupeByRemoteId && record.remoteId) {
      const same = existing.find(
        (r) => r.platformId === record.platformId && r.remoteId === record.remoteId,
      );
      if (same) {
        await store.put({ ...same, ...record, id: same.id });
        result.updated++;
        continue;
      }
    }
    await store.put(record);
    result.imported++;
  }
  return result;
}

/** 手工录入一条效果记录。 */
export function createManualPerformanceRecord(
  input: Omit<PerformanceRecord, "id" | "collectedAt" | "source">,
  now: () => string = () => new Date().toISOString(),
): PerformanceRecord {
  return { ...input, id: crypto.randomUUID(), collectedAt: now(), source: "manual" };
}

/** 汇总一组记录(每平台聚合)。 */
export interface PlatformPerformanceSummary {
  readonly platformId: string;
  readonly count: number;
  readonly totalViews: number;
  readonly totalLikes: number;
  readonly totalComments: number;
  readonly totalShares: number;
  /** 平均阅读量。 */
  readonly avgViews: number;
}

/** 按平台汇总效果记录(空指标按 0 计)。 */
export function summarizePerformance(
  records: readonly PerformanceRecord[],
): readonly PlatformPerformanceSummary[] {
  const byPlatform = new Map<string, PerformanceRecord[]>();
  for (const r of records) {
    const arr = byPlatform.get(r.platformId) ?? [];
    arr.push(r);
    byPlatform.set(r.platformId, arr);
  }
  const summaries: PlatformPerformanceSummary[] = [];
  for (const [platformId, list] of byPlatform) {
    const totalViews = list.reduce((s, r) => s + (r.metrics.views ?? 0), 0);
    const totalLikes = list.reduce((s, r) => s + (r.metrics.likes ?? 0), 0);
    const totalComments = list.reduce((s, r) => s + (r.metrics.comments ?? 0), 0);
    const totalShares = list.reduce((s, r) => s + (r.metrics.shares ?? 0), 0);
    summaries.push({
      platformId,
      count: list.length,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      avgViews: list.length > 0 ? totalViews / list.length : 0,
    });
  }
  return summaries.sort((a, b) => b.totalViews - a.totalViews);
}

/**
 * DATA-03 官方 API 指标同步:为一批发布记录拉取指标并写回存储。
 * - 仅对配置了对应 provider 且记录带 remoteId 的平台执行;
 * - 未配置 provider / 无 remoteId:跳过并给出原因(不静默);
 * - 并发受控(默认 2)。
 */
export async function syncMetricsFromProviders(
  store: PerformanceStore,
  providers: readonly MetricsProvider[],
  records: readonly PerformanceRecord[],
  signal?: AbortSignal,
  concurrency = 2,
): Promise<{ updated: number; skipped: number; errors: readonly string[] }> {
  const providerMap = new Map(providers.map((p) => [p.platformId, p]));
  const errors: string[] = [];
  const state = { updated: 0, skipped: 0 };

  const work = records.filter((r) => {
    if (!r.remoteId) {
      state.skipped++;
      return false;
    }
    const provider = providerMap.get(r.platformId);
    if (!provider) {
      state.skipped++;
      errors.push(`${r.platformId}: 未注册指标提供者,已跳过`);
      return false;
    }
    if (!provider.isConfigured()) {
      state.skipped++;
      errors.push(`${r.platformId}: 未配置凭据,已跳过`);
      return false;
    }
    return true;
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (cursor < work.length) {
      if (signal?.aborted) return;
      const record = work[cursor++]!;
      const provider = providerMap.get(record.platformId)!;
      try {
        const metrics = await provider.fetchMetrics(record.remoteId!, signal);
        await store.put({ ...record, metrics, collectedAt: new Date().toISOString() });
        state.updated++;
      } catch (err) {
        errors.push(`${record.platformId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  await Promise.all(workers);

  return { updated: state.updated, skipped: state.skipped, errors };
}
