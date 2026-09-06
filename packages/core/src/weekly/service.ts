/**
 * v4 Phase 2 · WEEKLY-02 内容智能周报 —— 服务(生命周期 + 生成编排)。
 *
 * 职责:
 * - `create/update/pause/resume/remove`:周报任务生命周期(状态机守卫);
 * - `generate(job)`:执行一次周报生成 —— 窗口裁剪 → (可选 LLM 总结,失败回退规则)
 *   → `buildWeeklyReport` → 按渠道投递(注入 `WeeklyDeliverer`)→ 记录执行历史;
 * - 与 FLOW-03 计划任务解耦:周报任务独立存储,由 WEEKLY-02 的 `weekly-report`
 *   动作在计划任务到点时调用 `runDue` 触达;也支持「手动立即生成」。
 *
 * 纯 TS、零 DOM;app/桌面端注入 deliverer(文件 / server 转发)。
 */
import type { WeeklyReportJob, WeeklyReportRun, WeeklyReportStore, WeeklyDelivery, NewWeeklyReportJob, WeeklyDeliveryKind } from "./types.js";
import { MemoryWeeklyStore, WEEKLY_JOBS_MAX, appendWeeklyRun } from "./store.js";
import { buildWeeklyReport, generateWeeklySummary } from "./build.js";
import type { PerformanceRecord } from "../analytics/types.js";
import type { LlmAdapter } from "../llm/types.js";

/** 一次投递的结果。 */
export interface WeeklyDeliveryResult {
  readonly kind: WeeklyDeliveryKind;
  readonly ok: boolean;
  readonly message?: string;
}

/** 投递器:把生成的周报 Markdown 按渠道投递(由接线方注入;文件 / server 转发)。 */
export interface WeeklyDeliverer {
  deliver(job: WeeklyReportJob, delivery: WeeklyDelivery, report: string): Promise<WeeklyDeliveryResult>;
}

/** 服务选项。 */
export interface WeeklyServiceOptions {
  readonly store?: WeeklyReportStore;
  /** 效果记录源(由 app 注入;调度/手动生成时读取)。 */
  readonly recordsProvider?: () => Promise<readonly PerformanceRecord[]>;
  /** LLM 适配器(可选;未配置时周报总结走规则兜底)。 */
  readonly llm?: LlmAdapter;
  /** 投递器(可选;未注入时投递渠道返回 skipped)。 */
  readonly deliverer?: WeeklyDeliverer;
  readonly now?: () => string;
}

export class WeeklyReportService {
  private readonly store: WeeklyReportStore;
  private readonly now: () => string;
  private readonly recordsProvider: () => Promise<readonly PerformanceRecord[]>;
  private llm?: LlmAdapter;
  private readonly deliverer?: WeeklyDeliverer;

  constructor(options: WeeklyServiceOptions = {}) {
    this.store = options.store ?? new MemoryWeeklyStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.recordsProvider = options.recordsProvider ?? (async () => []);
    this.llm = options.llm;
    this.deliverer = options.deliverer;
  }

  get schemaVersion(): number {
    return this.store.schemaVersion ?? 1;
  }

  async list(): Promise<readonly WeeklyReportJob[]> {
    return this.store.list();
  }

  async get(id: string): Promise<WeeklyReportJob | undefined> {
    return this.store.get(id);
  }

  /** 创建周报任务(默认 enabled)。 */
  async create(input: NewWeeklyReportJob = {}): Promise<WeeklyReportJob> {
    const existing = await this.store.list();
    if (existing.length >= WEEKLY_JOBS_MAX) {
      throw new Error(`周报任务数量已达上限(${WEEKLY_JOBS_MAX})`);
    }
    const ts = this.now();
    const job: WeeklyReportJob = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name?.trim() || "内容周报",
      template: input.template ?? "weekly",
      windowDays: input.windowDays ?? 7,
      deliveries: [...(input.deliveries ?? [])],
      useLlm: input.useLlm ?? true,
      windowOffsetDays: input.windowOffsetDays ?? 0,
      status: "enabled",
      runs: [],
      createdAt: ts,
      updatedAt: ts,
    };
    await this.store.put(job);
    return job;
  }

  /** 更新周报任务的可变字段。 */
  async update(
    id: string,
    patch: Partial<Pick<WeeklyReportJob, "name" | "template" | "windowDays" | "deliveries" | "useLlm" | "windowOffsetDays">>,
  ): Promise<WeeklyReportJob> {
    const job = await this.requireJob(id);
    if (job.status === "removed") throw new Error("周报任务已删除");
    const next: WeeklyReportJob = {
      ...job,
      ...patch,
      deliveries: patch.deliveries ? [...patch.deliveries] : job.deliveries,
      updatedAt: this.now(),
    };
    await this.store.put(next);
    return next;
  }

  async pause(id: string): Promise<WeeklyReportJob> {
    return this.setStatus(id, "paused");
  }

  async resume(id: string): Promise<WeeklyReportJob> {
    return this.setStatus(id, "enabled");
  }

  async remove(id: string): Promise<void> {
    const job = await this.requireJob(id);
    const next: WeeklyReportJob = { ...job, status: "removed", updatedAt: this.now() };
    await this.store.put(next);
  }

  /** 更新/注入 LLM 适配器(供 app 每次生成时读取当前生效配置)。 */
  updateLlm(llm: LlmAdapter | undefined): void {
    this.llm = llm;
  }

  /** 手动触发一次指定周报任务的生成。 */
  async generate(id: string): Promise<WeeklyReportRun> {
    const job = await this.requireJob(id);
    if (job.status !== "enabled") {
      return { seq: job.runs.length + 1, startedAt: this.now(), outcome: "skipped", error: "周报任务未启用" };
    }
    const seq = job.runs.length + 1;
    const startedAt = this.now();
    try {
      // 1. 读取效果记录(近窗口)。
      const records = await this.recordsProvider();
      // 2. 周窗口裁剪(近 windowDays 天,含起始偏移)。
      const window = filterByWindowDays(records, job.windowDays, job.windowOffsetDays, () => startedAt);
      // 3. 可选 LLM 周报总结(失败回退规则)。
      let llmSummary: string | undefined;
      let usedLlm = false;
      if (job.useLlm && this.llm?.available) {
        const summary = await generateWeeklySummary(this.llm, window);
        usedLlm = summary.usedLlm;
        if (usedLlm && summary.items.length > 0) {
          llmSummary = summary.items.map((i) => i.text).join("\n");
        }
      }
      // 4. 构建周报 Markdown。
      const report = buildWeeklyReport({
        records: window,
        template: job.template,
        windowDays: job.windowDays,
        llmSummary,
        now: () => startedAt,
      });
      // 5. 逐渠道投递(未注入投递器时渠道返回 skipped)。
      const deliveryResults: WeeklyDeliveryResult[] = [];
      for (const delivery of job.deliveries) {
        if (!this.deliverer) {
          deliveryResults.push({ kind: delivery.kind, ok: false, message: "未配置周报投递器" });
          continue;
        }
        const res = await this.deliverer.deliver(job, delivery, report);
        deliveryResults.push(res);
      }
      const run: WeeklyReportRun = {
        seq,
        startedAt,
        endedAt: this.now(),
        outcome: "succeeded",
        reportTitle: job.template === "weekly" ? "内容周报" : job.template,
        reportLength: report.length,
        recordsUsed: window.length,
        usedLlm,
        deliveryResults,
      };
      await this.recordRun(job, run);
      return run;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const run: WeeklyReportRun = {
        seq,
        startedAt,
        endedAt: this.now(),
        outcome: "failed",
        error: message,
      };
      await this.recordRun(job, run);
      return run;
    }
  }

  private async recordRun(job: WeeklyReportJob, run: WeeklyReportRun): Promise<void> {
    const updated = appendWeeklyRun(job, run);
    await this.store.put(updated);
  }

  private async setStatus(id: string, status: WeeklyReportJob["status"]): Promise<WeeklyReportJob> {
    const job = await this.requireJob(id);
    if (job.status === "removed") throw new Error("周报任务已删除");
    const next: WeeklyReportJob = { ...job, status, updatedAt: this.now() };
    await this.store.put(next);
    return next;
  }

  private async requireJob(id: string): Promise<WeeklyReportJob> {
    const job = await this.store.get(id);
    if (!job) throw new Error(`周报任务不存在: ${id}`);
    return job;
  }
}

/** 按窗口天数 + 起始偏移裁剪记录(近 N 天,offset=0 表示到今天)。 */
export function filterByWindowDays(
  records: readonly PerformanceRecord[],
  days: number,
  offsetDays = 0,
  now: () => string = () => new Date().toISOString(),
): readonly PerformanceRecord[] {
  const cutoff = new Date(now());
  cutoff.setDate(cutoff.getDate() - (days + offsetDays));
  const end = new Date(now());
  end.setDate(end.getDate() - offsetDays);
  const cutoffIso = cutoff.toISOString();
  const endIso = end.toISOString();
  return records.filter((r) => {
    const at = r.publishedAt ?? r.collectedAt;
    return at >= cutoffIso && at < endIso;
  });
}

export { buildWeeklyReport, generateWeeklySummary, ruleWeeklySummary, parseWeeklySummary, weeklySummaryRequest } from "./build.js";
