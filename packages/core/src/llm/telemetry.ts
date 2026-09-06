/**
 * LLM 成本/响应观测(Roadmap v2 · AI-ROBUST-03)。
 *
 * 记录每次 LLM 调用的关键信息:
 * - 任务类型(task)、模型(model)、基址(baseUrl 仅 host,不含 key/查询串);
 * - 耗时(ms)、是否成功、错误类别、HTTP 状态;
 * - 输入/输出 token 估算(按字符数/4 粗估,无精确 usage 时兜底);
 * - 是否发生回退(usedFallback)、命中适配器。
 *
 * 安全:不记录 apiKey、不记录完整 body/输出内容;基址只保留 origin(host),
 * 剔除凭据与路径细节。记录数量有上限(默认保留最近 200 条)。
 */
import type { LlmTask } from "./types.js";

/** 单条 LLM 调用记录(脱敏)。 */
export interface LlmCallRecord {
  /** 自增序号(便于 UI 排序)。 */
  readonly seq: number;
  /** 任务类型。 */
  readonly task: LlmTask;
  /** 模型名(如 deepseek-chat)。 */
  readonly model: string;
  /** 基址的 host 部分(不含 key / 查询串 / 路径细节)。 */
  readonly host: string;
  /** 开始时间 ISO 字符串。 */
  readonly startedAt: string;
  /** 耗时 ms。 */
  readonly durationMs: number;
  /** 是否成功。 */
  readonly ok: boolean;
  /** 错误类别(ok=false 时)。 */
  readonly errorKind?: "timeout" | "http" | "network" | "other";
  /** HTTP 状态码(有响应时)。 */
  readonly status?: number;
  /** 输入 token 估算。 */
  readonly inputTokens: number;
  /** 输出 token 估算。 */
  readonly outputTokens: number;
  /** 是否发生了模型回退。 */
  readonly usedFallback: boolean;
  /** 实际命中的适配器 id。 */
  readonly adapterId: string;
  /** 失败原因摘要(脱敏,不含 key/URL 细节)。 */
  readonly errorMessage?: string;
}

/** 观测汇总。 */
export interface LlmTelemetrySummary {
  /** 总调用次数。 */
  readonly totalCalls: number;
  /** 成功次数。 */
  readonly successCalls: number;
  /** 失败次数。 */
  readonly failedCalls: number;
  /** 成功率(0-1)。 */
  readonly successRate: number;
  /** 平均耗时 ms。 */
  readonly avgDurationMs: number;
  /** p95 耗时 ms。 */
  readonly p95DurationMs: number;
  /** 输入 token 估算累计。 */
  readonly totalInputTokens: number;
  /** 输出 token 估算累计。 */
  readonly totalOutputTokens: number;
  /** 按任务类型统计。 */
  readonly byTask: Record<string, { calls: number; ok: number; avgDurationMs: number }>;
}

/** 观测选项。 */
export interface LlmTelemetryOptions {
  /** 最多保留记录条数(默认 200)。 */
  readonly maxRecords?: number;
}

/** 粗估 token 数:中文按字符数计,ASCII 按 4 字符/ token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1;
    else ascii += 1;
  }
  return Math.ceil(cjk + ascii / 4);
}

/** 从基址提取脱敏 host(仅保留协议 + host[:port],剔除路径/凭据)。 */
export function hostOfBaseUrl(baseUrl: string): string {
  if (!baseUrl) return "";
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    // 非 URL 时截断脱敏(去掉可能的内嵌 key 片段)。
    return baseUrl.replace(/^https?:\/\//i, "").split(/[/?#]/)[0]?.slice(0, 80) ?? "";
  }
}

/** 判定错误类别。 */
export function classifyLlmError(err: unknown): { kind: "timeout" | "http" | "network" | "other"; status?: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("超时") || msg.includes("abort")) return { kind: "timeout", message: msg.slice(0, 160) };
  const statusMatch = msg.match(/HTTP\s+(\d{3})/i);
  if (statusMatch) {
    return { kind: "http", status: Number(statusMatch[1]), message: msg.slice(0, 160) };
  }
  if (/fetch failed|failed to fetch|网络|network/i.test(msg)) return { kind: "network", message: msg.slice(0, 160) };
  return { kind: "other", message: msg.slice(0, 160) };
}

/** LLM 调用观测器(线程安全,可注入时钟)。 */
export class LlmTelemetry {
  private readonly records: LlmCallRecord[] = [];
  private seq = 0;
  private readonly maxRecords: number;
  private readonly now: () => number;

  constructor(opts: LlmTelemetryOptions = {}, now?: () => number) {
    this.maxRecords = opts.maxRecords ?? 200;
    this.now = now ?? (() => Date.now());
  }

  /** 记录一次调用(由适配器/工厂在 run 前后调用)。 */
  record(input: {
    task: LlmTask;
    model: string;
    baseUrl: string;
    durationMs: number;
    ok: boolean;
    inputText: string;
    outputText?: string;
    error?: unknown;
    usedFallback?: boolean;
    adapterId?: string;
    status?: number;
  }): LlmCallRecord {
    this.seq += 1;
    const classified = input.ok ? undefined : classifyLlmError(input.error);
    const rec: LlmCallRecord = {
      seq: this.seq,
      task: input.task,
      model: input.model || "unknown",
      host: hostOfBaseUrl(input.baseUrl),
      startedAt: new Date(this.now() - input.durationMs).toISOString(),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      ok: input.ok,
      errorKind: classified?.kind,
      status: input.status ?? classified?.status,
      inputTokens: estimateTokens(input.inputText),
      outputTokens: input.ok ? estimateTokens(input.outputText ?? "") : 0,
      usedFallback: input.usedFallback ?? false,
      adapterId: input.adapterId ?? "unknown",
      errorMessage: input.ok ? undefined : classified?.message,
    };
    this.records.push(rec);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return rec;
  }

  /** 最近调用记录(最新在前)。 */
  recent(limit = 50): readonly LlmCallRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** 全部记录(按时间正序)。 */
  all(): readonly LlmCallRecord[] {
    return [...this.records];
  }

  /** 清空记录。 */
  clear(): void {
    this.records.length = 0;
    this.seq = 0;
  }

  /** 汇总统计。 */
  summary(): LlmTelemetrySummary {
    const total = this.records.length;
    const okCount = this.records.filter((r) => r.ok).length;
    const failed = total - okCount;
    const durations = this.records.map((r) => r.durationMs).sort((a, b) => a - b);
    const avg = total === 0 ? 0 : durations.reduce((s, d) => s + d, 0) / total;
    const p95 = total === 0 ? 0 : durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
    const byTask: Record<string, { calls: number; ok: number; avgDurationMs: number }> = {};
    for (const r of this.records) {
      const key = r.task;
      byTask[key] ??= { calls: 0, ok: 0, avgDurationMs: 0 };
      byTask[key].calls += 1;
      byTask[key].ok += r.ok ? 1 : 0;
    }
    for (const key of Object.keys(byTask)) {
      byTask[key].avgDurationMs = Math.round(
        this.records.filter((r) => r.task === key).reduce((s, r) => s + r.durationMs, 0) / byTask[key].calls,
      );
    }
    return {
      totalCalls: total,
      successCalls: okCount,
      failedCalls: failed,
      successRate: total === 0 ? 0 : okCount / total,
      avgDurationMs: Math.round(avg),
      p95DurationMs: p95,
      totalInputTokens: this.records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: this.records.reduce((s, r) => s + r.outputTokens, 0),
      byTask,
    };
  }
}

/** 全局共享观测器(供 factory 默认接线;可替换便于测试)。 */
export const llmTelemetry = new LlmTelemetry();
