/**
 * ROADMAP_V5 Phase 1 · 发布队列服务 —— 条目生命周期 + 到期触发 + 清理。
 *
 * 职责:
 * - `enqueue`:把"稍后发布"意图写入队列(状态 queued);
 * - `dueEntries(now)`:找出到点应执行的条目(按 scheduledAt,去重窗口防重复);
 * - `runDue`:到点执行,把条目交给注入的 executor(读取草稿 → 创建发布任务),
 *   成功/失败如实记录,不假装成功;
 * - `cancel / remove`:取消待执行条目 / 删除任意条目;
 * - `prune`:清理完成/失败条目(TTL + 条数上限)。
 *
 * 纯 TS、零 DOM;executor 由 app/桌面端注入(经 store 创建发布任务,走可信回执)。
 */
import type { PublishQueueEntry, PublishQueueStore, PublishQueueStatus, QueueRunResult, NewPublishQueueEntry } from "./types.js";
import { PUBLISH_QUEUE_MAX, PUBLISH_QUEUE_RETENTION_DAYS, PUBLISH_QUEUE_SCHEMA_VERSION, MemoryPublishQueueStore } from "./types.js";

/** 条目到点执行器(由接线方注入):读草稿 → 创建发布任务 → 返回结果摘要。 */
export interface PublishQueueExecutor {
  run(entry: PublishQueueEntry, signal?: AbortSignal): Promise<{ ok: boolean; jobId?: string; message?: string; error?: string }>;
}

export interface PublishQueueServiceOptions {
  readonly store?: PublishQueueStore;
  readonly now?: () => string;
  /** 到点后重试窗口(ms):同一条目到点后在该窗口内不重复触发。默认 2 分钟。 */
  readonly dedupeWindowMs?: number;
  readonly executor?: PublishQueueExecutor | null;
}

export class PublishQueueService {
  private readonly store: PublishQueueStore;
  private readonly now: () => string;
  private readonly dedupeWindowMs: number;
  private readonly executor: PublishQueueExecutor | null;
  /** 上次触发时间索引:entryId → ISO(防重复触发)。 */
  private readonly lastTriggered = new Map<string, string>();

  constructor(options: PublishQueueServiceOptions = {}) {
    this.store = options.store ?? new MemoryPublishQueueStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.dedupeWindowMs = options.dedupeWindowMs ?? 120_000;
    this.executor = options.executor ?? null;
  }

  get schemaVersion(): number {
    return this.store.schemaVersion ?? PUBLISH_QUEUE_SCHEMA_VERSION;
  }

  async list(): Promise<readonly PublishQueueEntry[]> {
    return this.store.list();
  }

  async get(id: string): Promise<PublishQueueEntry | undefined> {
    return this.store.get(id);
  }

  /** 把一条"稍后发布"排入队列。 */
  async enqueue(input: NewPublishQueueEntry): Promise<PublishQueueEntry> {
    if (!input.draftId.trim()) throw new Error("必须关联一个草稿");
    const at = this.now();
    const entry: PublishQueueEntry = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name?.trim() || "待发布",
      draftId: input.draftId,
      platformIds: [...input.platformIds],
      scheduledAt: input.scheduledAt,
      accountRefs: input.accountRefs ? [...input.accountRefs] : [],
      realPublish: input.realPublish ?? true,
      status: "queued",
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put(entry);
    return entry;
  }

  /** 找出到点应执行的条目(queued 且 scheduledAt ≤ now 且不在去重窗口内)。 */
  async dueEntries(now: Date = new Date()): Promise<readonly PublishQueueEntry[]> {
    const all = await this.store.list();
    const due: PublishQueueEntry[] = [];
    for (const entry of all) {
      if (entry.status !== "queued") continue;
      if (Date.parse(entry.scheduledAt) > now.getTime()) continue;
      const last = this.lastTriggered.get(entry.id);
      if (last && now.getTime() - Date.parse(last) < this.dedupeWindowMs) continue;
      due.push(entry);
    }
    return due;
  }

  /** 执行所有到期条目。返回逐条结果。 */
  async runDue(now: Date = new Date()): Promise<readonly QueueRunResult[]> {
    const due = await this.dueEntries(now);
    const results: QueueRunResult[] = [];
    for (const entry of due) {
      this.lastTriggered.set(entry.id, now.toISOString());
      results.push(await this.runEntry(entry, now));
    }
    return results;
  }

  /** 手动立即执行某条目(忽略 scheduledAt 与去重窗口)。 */
  async trigger(id: string): Promise<QueueRunResult> {
    const entry = await this.requireEntry(id);
    if (entry.status === "running") return { entryId: id, ok: false, skipped: true, error: "条目正在执行" };
    if (entry.status === "succeeded" || entry.status === "cancelled") {
      return { entryId: id, ok: false, skipped: true, error: `条目已${entry.status === "succeeded" ? "完成" : "取消"}` };
    }
    if (entry.status === "failed") {
      // 失败条目允许重新入队执行。
      await this.updateStatus(id, "queued");
    }
    this.lastTriggered.set(id, this.now());
    return this.runEntry(await this.requireEntry(id), new Date());
  }

  /** 重新排队(改时间并回到 queued)。 */
  async reschedule(id: string, scheduledAt: string): Promise<PublishQueueEntry> {
    const entry = await this.requireEntry(id);
    if (entry.status === "running") throw new Error("条目正在执行,无法改期");
    const next: PublishQueueEntry = { ...entry, scheduledAt, status: "queued", error: undefined, updatedAt: this.now() };
    await this.store.put(next);
    return next;
  }

  /** 取消待执行条目(仅 queued/running 可取消)。 */
  async cancel(id: string, reason = "用户取消"): Promise<PublishQueueEntry> {
    const entry = await this.requireEntry(id);
    if (entry.status === "succeeded") throw new Error("已完成条目不可取消");
    if (entry.status === "cancelled") return entry;
    const next: PublishQueueEntry = {
      ...entry,
      status: "cancelled",
      error: reason,
      updatedAt: this.now(),
    };
    await this.store.put(next);
    return next;
  }

  /** 删除任意条目(含历史)。 */
  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }

  /** 清理完成/失败/取消条目(超过保留天数),并裁剪队列到上限。 */
  async prune(now: Date = new Date()): Promise<number> {
    const all = await this.store.list();
    const cutoff = now.getTime() - PUBLISH_QUEUE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const terminal = new Set(["succeeded", "failed", "cancelled"]);
    let removed = 0;
    // 第一步:过期终态条目直接删除。
    let keep = all.filter((e) => {
      if (terminal.has(e.status) && Date.parse(e.updatedAt) < cutoff) {
        removed++;
        this.lastTriggered.delete(e.id);
        return false;
      }
      return true;
    });
    // 第二步:超过条数上限时,优先保留排队/运行中,从最旧的终态开始裁剪。
    let dropIds = new Set<string>();
    if (keep.length > PUBLISH_QUEUE_MAX) {
      const active = keep.filter((e) => e.status === "queued" || e.status === "running");
      const inactive = keep
        .filter((e) => e.status !== "queued" && e.status !== "running")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const dropCount = keep.length - PUBLISH_QUEUE_MAX;
      dropIds = new Set(inactive.slice(-dropCount).map((e) => e.id));
      removed += dropIds.size;
      for (const id of dropIds) this.lastTriggered.delete(id);
      keep = [...active, ...inactive.slice(0, Math.max(0, inactive.length - dropCount))];
    }
    if (removed > 0) {
      // 从底层存储删除被裁剪的条目。
      const removeAll = new Set([...dropIds, ...all.filter((e) => !keep.some((k) => k.id === e.id)).map((e) => e.id)]);
      for (const id of removeAll) await this.store.remove(id);
    }
    return removed;
  }

  private async runEntry(entry: PublishQueueEntry, _at: Date): Promise<QueueRunResult> {
    if (!this.executor) {
      await this.updateStatus(entry.id, "failed", undefined, "未注入发布队列执行器");
      return { entryId: entry.id, ok: false, skipped: true, error: "未注入发布队列执行器" };
    }
    await this.updateStatus(entry.id, "running");
    try {
      const result = await this.executor.run(entry);
      await this.updateStatus(entry.id, result.ok ? "succeeded" : "failed", result.jobId, result.message ?? result.error);
      return {
        entryId: entry.id,
        ok: result.ok,
        skipped: false,
        error: result.error,
        jobId: result.jobId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.updateStatus(entry.id, "failed", undefined, message);
      return { entryId: entry.id, ok: false, skipped: false, error: message };
    }
  }

  private async updateStatus(
    id: string,
    status: PublishQueueStatus,
    jobId?: string,
    error?: string,
  ): Promise<void> {
    const entry = await this.store.get(id);
    if (!entry) return;
    const next: PublishQueueEntry = {
      ...entry,
      status,
      ...(jobId ? { jobId } : {}),
      ...(error ? { error } : { error: undefined }),
      resultMessage: error ?? entry.resultMessage,
      updatedAt: this.now(),
    };
    await this.store.put(next);
  }

  private async requireEntry(id: string): Promise<PublishQueueEntry> {
    const entry = await this.store.get(id);
    if (!entry) throw new Error(`队列条目不存在: ${id}`);
    return entry;
  }
}
