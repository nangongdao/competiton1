/**
 * ROADMAP_V5 Phase 2 · 发布批次服务 —— 批次生命周期 + 逐篇触发 + 复盘汇总 + 批量效果回收。
 *
 * 职责:
 * - `create`:一次排队多篇草稿(每篇独立账号/平台/时间),生成批次;
 * - `dueItems(now)`:找出到点应执行的条目(批内逐篇,单篇失败不阻断其余);
 * - `runDue`:到点执行,把条目交给注入的 executor(读取草稿 → 创建发布任务),
 *   成功/失败/跳过如实记录,不假装成功;全部条目终态后自动汇总 `BatchRetro`;
 * - `triggerItem / retryItem`:手动立即执行 / 重试失败条目;
 * - `cancel`:取消批次(仅 queued/running 可取消,已终态条目保留);
 * - `collectMetrics`:按条目 receipts 的 remoteId 批量回收效果(去重,同一平台+remoteId 已存在则跳过);
 * - `buildBatchRetro`:从批次聚合成功率 / 平台表现 / 建议(纯函数);
 * - `prune`:清理终态批次(TTL + 条数上限)。
 *
 * 纯 TS、零 DOM;executor 由 app/桌面端注入(经 store 创建发布任务,走可信回执)。
 */
import type { PublishBatch, PublishBatchItem, PublishBatchItemStatus, PublishBatchStatus, PublishBatchStore, BatchItemRunResult, NewPublishBatch, QueueAccountRef } from "./types.js";
import {
  PUBLISH_BATCH_MAX,
  PUBLISH_BATCH_RETENTION_DAYS,
  PUBLISH_BATCH_SCHEMA_VERSION,
  MemoryPublishBatchStore,
} from "./types.js";
import type { PerformanceStore, PerformanceRecord } from "../analytics/types.js";
import { createManualPerformanceRecord } from "../analytics/import.js";

/** 批次内条目执行器(由接线方注入):读草稿 → 创建发布任务 → 返回结果与回执。 */
export interface PublishBatchItemExecutor {
  run(
    item: PublishBatchItem,
    batch: PublishBatch,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    jobId?: string;
    message?: string;
    error?: string;
    /** 执行后收集的平台回执(remoteId/remoteUrl,供批量效果回收)。 */
    receipts?: PublishBatchItem["receipts"];
  }>;
}

export interface PublishBatchServiceOptions {
  readonly store?: PublishBatchStore;
  readonly now?: () => string;
  /** 到点后重试窗口(ms):同一条目到点后在该窗口内不重复触发。默认 2 分钟。 */
  readonly dedupeWindowMs?: number;
  readonly executor?: PublishBatchItemExecutor | null;
}

/** 聚合批次整体状态(纯函数,供 UI 与服务复用)。 */
export function aggregateBatchStatus(items: readonly PublishBatchItem[]): PublishBatchStatus {
  if (items.length === 0) return "queued";
  const terminal = new Set<PublishBatchItemStatus>(["succeeded", "failed", "skipped"]);
  if (items.every((i) => i.status === "succeeded")) return "succeeded";
  if (items.every((i) => terminal.has(i.status))) return "failed";
  if (items.some((i) => i.status === "running")) return "running";
  if (items.some((i) => i.status === "queued")) return "queued";
  return "failed";
}

/**
 * 生成批次复盘汇总(纯函数)。
 * - 成功率 = 成功条数 / 总条数;
 * - 平台表现:按平台聚合成功/总次数;
 * - 建议:确定性规则(离线可用,不依赖 LLM)。
 */
export function buildBatchRetro(items: readonly PublishBatchItem[]): import("./types.js").BatchRetro {
  const total = items.length;
  const succeeded = items.filter((i) => i.status === "succeeded").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const byPlatform = new Map<string, { ok: number; total: number }>();
  for (const item of items) {
    const platforms = item.platformIds.length > 0 ? item.platformIds : ["*"];
    for (const pid of platforms) {
      const cur = byPlatform.get(pid) ?? { ok: 0, total: 0 };
      cur.total++;
      if (item.status === "succeeded") cur.ok++;
      byPlatform.set(pid, cur);
    }
  }
  const platformList = [...byPlatform.entries()]
    .map(([platformId, v]) => ({ platformId, ok: v.ok, total: v.total }))
    .sort((a, b) => b.ok - a.ok || b.total - a.total);

  const collectibleRemoteIds = items.reduce(
    (n, i) => n + (i.receipts?.filter((r) => r.remoteId).length ?? 0),
    0,
  );

  const suggestions: string[] = [];
  if (total === 0) {
    suggestions.push("批次内没有条目,请先添加草稿后再发布。");
  } else {
    if (succeeded === total) {
      suggestions.push(`全部 ${total} 篇发布成功,保持当前账号与平台组合即可。`);
    } else if (failed > 0) {
      suggestions.push(`${failed} 篇发布失败,建议检查对应平台登录态与凭据后重试。`);
      const failedItems = items.filter((i) => i.status === "failed");
      for (const item of failedItems.slice(0, 3)) {
        suggestions.push(`- 失败条目「${item.draftTitle}」:${item.error ?? "未知原因"}`);
      }
    }
    if (skipped > 0) {
      suggestions.push(`${skipped} 篇被跳过(未到点或执行器不可用),可手动立即执行。`);
    }
    const lowest = platformList[platformList.length - 1];
    if (platformList.length > 1 && lowest && lowest.ok === 0 && lowest.total > 0) {
      suggestions.push(`平台 ${lowest.platformId} 全部失败,建议单独排查后再纳入批量发布。`);
    }
    const noRemote = items.filter(
      (i) => i.status === "succeeded" && !i.receipts?.some((r) => r.remoteId),
    );
    if (noRemote.length > 0) {
      suggestions.push(`${noRemote.length} 篇成功但未取得远端 ID,效果回收将依赖手工录入或官方指标同步。`);
    }
    if (suggestions.length === 0) {
      suggestions.push("建议结合「发布效果回收」补充阅读/互动数据,获取更完整的复盘。");
    }
  }
  return {
    total,
    succeeded,
    failed,
    skipped,
    successRate: total > 0 ? succeeded / total : 0,
    platformCount: platformList.length,
    byPlatform: platformList,
    suggestions,
    collectibleRemoteIds,
  };
}

export class PublishBatchService {
  private readonly store: PublishBatchStore;
  private readonly now: () => string;
  private readonly dedupeWindowMs: number;
  private readonly executor: PublishBatchItemExecutor | null;
  /** 上次触发时间索引:itemId → ISO(防重复触发)。 */
  private readonly lastTriggered = new Map<string, string>();

  constructor(options: PublishBatchServiceOptions = {}) {
    this.store = options.store ?? new MemoryPublishBatchStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.dedupeWindowMs = options.dedupeWindowMs ?? 120_000;
    this.executor = options.executor ?? null;
  }

  get schemaVersion(): number {
    return this.store.schemaVersion ?? PUBLISH_BATCH_SCHEMA_VERSION;
  }

  async list(): Promise<readonly PublishBatch[]> {
    return this.store.list();
  }

  async get(id: string): Promise<PublishBatch | undefined> {
    return this.store.get(id);
  }

  /** 一次排队多篇草稿,生成批次。 */
  async create(input: NewPublishBatch): Promise<PublishBatch> {
    if (input.items.length === 0) throw new Error("批次至少需要一篇草稿");
    if (input.items.length > PUBLISH_BATCH_MAX) {
      throw new Error(`单批最多 ${PUBLISH_BATCH_MAX} 篇`);
    }
    const at = this.now();
    const batchRefs: readonly QueueAccountRef[] = input.accountRefs ? [...input.accountRefs] : [];
    const items: PublishBatchItem[] = input.items.map((item, idx) => ({
      itemId: item.draftId ? `${input.id ?? crypto.randomUUID()}-${item.draftId}` : `item-${idx}`,
      draftId: item.draftId,
      draftTitle: item.draftTitle?.trim() || `草稿 ${idx + 1}`,
      platformIds: item.platformIds ? [...item.platformIds] : [],
      accountRefs: item.accountRefs && item.accountRefs.length > 0 ? [...item.accountRefs] : batchRefs,
      realPublish: item.realPublish ?? input.realPublish ?? true,
      scheduledAt: item.scheduledAt,
      status: "queued",
      createdAt: at,
      updatedAt: at,
    }));
    const batch: PublishBatch = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name?.trim() || `发布批次 ${items.length} 篇`,
      items,
      status: "queued",
      scheduledAt: input.scheduledAt ?? at,
      accountRefs: batchRefs,
      realPublish: input.realPublish ?? true,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put(batch);
    return batch;
  }

  /** 找出批次内到点应执行的条目(queued 且 scheduledAt ≤ now 且不在去重窗口内)。 */
  async dueItems(now: Date = new Date()): Promise<readonly { batch: PublishBatch; item: PublishBatchItem }[]> {
    const all = await this.store.list();
    const due: { batch: PublishBatch; item: PublishBatchItem }[] = [];
    for (const batch of all) {
      if (batch.status === "cancelled") continue;
      for (const item of batch.items) {
        if (item.status !== "queued") continue;
        const scheduledAt = item.scheduledAt ?? batch.scheduledAt;
        if (Date.parse(scheduledAt) > now.getTime()) continue;
        const last = this.lastTriggered.get(item.itemId);
        if (last && now.getTime() - Date.parse(last) < this.dedupeWindowMs) continue;
        due.push({ batch, item });
      }
    }
    return due;
  }

  /** 执行所有到期条目。返回逐条结果。 */
  async runDue(now: Date = new Date()): Promise<readonly BatchItemRunResult[]> {
    const due = await this.dueItems(now);
    const results: BatchItemRunResult[] = [];
    for (const { batch, item } of due) {
      this.lastTriggered.set(item.itemId, now.toISOString());
      results.push(await this.runItem(batch.id, item.itemId, now));
    }
    return results;
  }

  /** 手动立即执行某条目(忽略 scheduledAt 与去重窗口)。 */
  async triggerItem(batchId: string, itemId: string): Promise<BatchItemRunResult> {
    const batch = await this.requireBatch(batchId);
    const item = this.requireItem(batch, itemId);
    if (item.status === "running") {
      return { batchId, itemId, ok: false, skipped: true, error: "该篇正在执行" };
    }
    if (item.status === "succeeded") {
      return { batchId, itemId, ok: false, skipped: true, error: "该篇已发布成功" };
    }
    if (item.status === "failed") {
      // 失败条目允许重试。
      await this.patchItem(batchId, itemId, { status: "queued", error: undefined });
    }
    this.lastTriggered.set(itemId, this.now());
    return this.runItem(batchId, itemId, new Date());
  }

  /** 重试全部失败条目(批量一键重试)。 */
  async retryFailed(batchId: string): Promise<readonly BatchItemRunResult[]> {
    const batch = await this.requireBatch(batchId);
    const results: BatchItemRunResult[] = [];
    for (const item of batch.items) {
      if (item.status !== "failed") continue;
      results.push(await this.triggerItem(batchId, item.itemId));
    }
    return results;
  }

  /**
   * v6 CAL-04:改期批次内某条目(日历拖拽改期)。
   * - 仅 queued/running 可改期;已终态条目拒绝;
   * - 只改该条的 scheduledAt,其余条目不受影响。
   */
  async rescheduleItem(batchId: string, itemId: string, scheduledAt: string): Promise<PublishBatch> {
    const batch = await this.requireBatch(batchId);
    const item = this.requireItem(batch, itemId);
    if (item.status === "succeeded" || item.status === "skipped") {
      throw new Error("已终态条目不可改期");
    }
    if (item.status === "running") {
      throw new Error("该篇正在执行,无法改期");
    }
    if (!Number.isFinite(Date.parse(scheduledAt))) {
      throw new Error("发布时间格式无效");
    }
    return this.patchItem(batchId, itemId, {
      scheduledAt,
      status: "queued",
      error: undefined,
    });
  }

  /**
   * v6 Phase 2 · 批次整体改期 —— 把批次内全部「可改期」条目统一迁移到新时间。
   *
   * 语义(与 rescheduleItem 一致):
   * - queued / failed / running 均可改期(含未单独指定时间、继承批次 scheduledAt 的条目);
   *   failed 条目随整体改期回到 queued(可重试),running 条目仅更新 scheduledAt(不打断执行);
   * - succeeded / skipped 已终态条目保持原样,不动其发布时间;
   * - 非法时间直接拒绝;
   * - 返回 { batch, rescheduled, skipped } —— skipped 为因已终态而未改的条数。
   */
  async rescheduleAll(batchId: string, scheduledAt: string): Promise<{ batch: PublishBatch; rescheduled: number; skipped: number }> {
    if (!Number.isFinite(Date.parse(scheduledAt))) {
      throw new Error("发布时间格式无效");
    }
    const batch = await this.requireBatch(batchId);
    const terminal = new Set<PublishBatchItemStatus>(["succeeded", "skipped"]);
    let rescheduled = 0;
    let skipped = 0;
    const items: PublishBatchItem[] = batch.items.map((item) => {
      if (terminal.has(item.status)) {
        skipped++;
        return item;
      }
      rescheduled++;
      return {
        ...item,
        scheduledAt,
        status: (item.status === "running" ? "running" : "queued") as PublishBatchItemStatus,
        error: undefined,
        updatedAt: this.now(),
      };
    });
    const updated = await this.persist({ ...batch, items, scheduledAt });
    return { batch: updated, rescheduled, skipped };
  }

  /** 取消批次(仅 queued/running 可取消;已终态条目保留,后续到点不再触发)。 */
  async cancel(id: string, _reason = "用户取消"): Promise<PublishBatch> {
    const batch = await this.requireBatch(id);
    if (batch.status === "succeeded") throw new Error("已完成批次不可取消");
    if (batch.status === "cancelled") return batch;
    const next: PublishBatch = {
      ...batch,
      status: "cancelled",
      updatedAt: this.now(),
    };
    await this.store.put(next);
    return next;
  }

  /** 删除任意批次(含历史)。 */
  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }

  /**
   * BATCH-02:批量效果回收 —— 按条目 receipts 的 remoteId 汇总写回效果库。
   * - 仅对带 remoteId 且平台可识别的回执生成记录;
   * - 同一平台 + 同一 remoteId 已存在 → 去重跳过(不重复录入);
   * - 未取得 remoteId 的发布如实跳过(依赖手工/官方指标同步)。
   */
  async collectMetrics(
    batchId: string,
    performanceStore: PerformanceStore,
    options: { now?: () => string } = {},
  ): Promise<import("./types.js").BatchMetricsCollectResult> {
    const batch = await this.requireBatch(batchId);
    const existing = await performanceStore.list();
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    for (const item of batch.items) {
      if (item.status !== "succeeded") continue;
      for (const receipt of item.receipts ?? []) {
        if (!receipt.remoteId) continue;
        const platformId = receipt.platformId;
        const dedupe = existing.find(
          (r) => r.platformId === platformId && r.remoteId === receipt.remoteId,
        );
        if (dedupe) {
          skipped++;
          continue;
        }
        const record: PerformanceRecord = createManualPerformanceRecord(
          {
            platformId,
            title: item.draftTitle,
            remoteId: receipt.remoteId,
            remoteUrl: receipt.remoteUrl,
            publishedAt: receipt.at,
            metrics: {},
          },
          options.now ?? this.now,
        );
        await performanceStore.put(record);
        imported++;
      }
    }
    if (imported === 0 && skipped === 0) {
      errors.push("批次内没有可回收的 remoteId(成功篇可能未取得远端 ID)");
    }
    return { imported, skipped, errors };
  }

  /** 清理终态批次(超过保留天数),并裁剪到条数上限。 */
  async prune(now: Date = new Date()): Promise<number> {
    const all = await this.store.list();
    const cutoff = now.getTime() - PUBLISH_BATCH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const terminal = new Set<PublishBatchStatus>(["succeeded", "failed", "cancelled"]);
    let removed = 0;
    let keep = all.filter((b) => {
      if (terminal.has(b.status) && Date.parse(b.updatedAt) < cutoff) {
        removed++;
        for (const item of b.items) this.lastTriggered.delete(item.itemId);
        return false;
      }
      return true;
    });
    if (keep.length > PUBLISH_BATCH_MAX) {
      const active = keep.filter((b) => b.status === "queued" || b.status === "running");
      const inactive = keep
        .filter((b) => b.status !== "queued" && b.status !== "running")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const dropCount = keep.length - PUBLISH_BATCH_MAX;
      for (const b of inactive.slice(-dropCount)) {
        for (const item of b.items) this.lastTriggered.delete(item.itemId);
      }
      removed += dropCount;
      keep = [...active, ...inactive.slice(0, Math.max(0, inactive.length - dropCount))];
    }
    if (removed > 0) {
      const keepIds = new Set(keep.map((b) => b.id));
      for (const b of all) {
        if (!keepIds.has(b.id)) await this.store.remove(b.id);
      }
    }
    return removed;
  }

  private async runItem(batchId: string, itemId: string, _at: Date): Promise<BatchItemRunResult> {
    const batch = await this.requireBatch(batchId);
    const item = this.requireItem(batch, itemId);
    if (!this.executor) {
      await this.patchItem(batchId, itemId, { status: "failed", error: "未注入发布批次执行器" });
      return { batchId, itemId, ok: false, skipped: true, error: "未注入发布批次执行器" };
    }
    await this.patchItem(batchId, itemId, { status: "running", startedAt: this.now(), error: undefined });
    try {
      const result = await this.executor.run(item, batch);
      const status: PublishBatchItemStatus = result.ok ? "succeeded" : "failed";
      await this.patchItem(batchId, itemId, {
        status,
        jobId: result.jobId,
        receipts: result.receipts,
        resultMessage: result.message ?? result.error,
        error: result.ok ? undefined : result.error,
        endedAt: this.now(),
      });
      return { batchId, itemId, ok: result.ok, skipped: false, error: result.error, jobId: result.jobId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.patchItem(batchId, itemId, { status: "failed", error: message, endedAt: this.now() });
      return { batchId, itemId, ok: false, skipped: false, error: message };
    }
  }

  private async patchItem(
    batchId: string,
    itemId: string,
    patch: Partial<PublishBatchItem>,
  ): Promise<PublishBatch> {
    const batch = await this.requireBatch(batchId);
    const items = batch.items.map((i) =>
      i.itemId === itemId ? { ...i, ...patch, updatedAt: this.now() } : i,
    );
    return this.persist({ ...batch, items });
  }

  /** 写入批次,并在全部条目终态时生成复盘汇总。 */
  private async persist(next: PublishBatch): Promise<PublishBatch> {
    const terminal = new Set<PublishBatchItemStatus>(["succeeded", "failed", "skipped"]);
    const allTerminal = next.items.length > 0 && next.items.every((i) => terminal.has(i.status));
    const startedAt = next.items.some((i) => i.status !== "queued") ? next.startedAt ?? this.now() : undefined;
    const endedAt = allTerminal ? this.now() : next.endedAt;
    const status = next.status === "cancelled" ? next.status : aggregateBatchStatus(next.items);
    const retro = allTerminal ? buildBatchRetro(next.items) : next.retro;
    const updated: PublishBatch = {
      ...next,
      status,
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(retro ? { retro } : {}),
      updatedAt: this.now(),
    };
    await this.store.put(updated);
    return updated;
  }

  private async requireBatch(id: string): Promise<PublishBatch> {
    const batch = await this.store.get(id);
    if (!batch) throw new Error(`批次不存在: ${id}`);
    return batch;
  }

  private requireItem(batch: PublishBatch, itemId: string): PublishBatchItem {
    const item = batch.items.find((i) => i.itemId === itemId);
    if (!item) throw new Error(`批次条目不存在: ${itemId}`);
    return item;
  }
}
