/**
 * 发布批次与批量复盘(ROADMAP_V5 Phase 2)。
 *
 * 在 Phase 1「发布队列(单篇定时发布)」之上,提供**一次排队多篇草稿、到点逐篇发布、
 * 批量回收效果、一键生成批次复盘**的一等公民能力:
 * - `PublishBatch`:一次「批量发布」意图(多篇草稿,每篇独立账号/平台/时间);
 * - 到点由调度心跳逐篇触发(复用 `PublishJobService` 可信回执链路),单篇失败不阻断其余;
 * - 每篇执行后保留 receipts(remoteId/remoteUrl),供 BATCH-02 批量效果回收;
 * - 全部条目终态后自动汇总 `BatchRetro`(成功率 / 平台表现 / 建议),供 BATCH-03 复盘。
 *
 * 设计原则(延续 ROADMAP_V5 §5):
 * - 纯 TS、零 DOM;存储层与 QUEUE-03 同构(版本化 + 保留清理);
 * - 机器与登录态必须在线:到点只触发执行器,失败/跳过如实记录,不假装成功;
 * - 每篇独立调度:条目标记自己的 scheduledAt(缺省继承批次时间);
 * - 密钥/凭据不进 core:账号引用只存 id / serverProfileId / profileDir(非密钥)。
 */
import type { QueueAccountRef } from "../publish-queue/types.js";

export type { QueueAccountRef } from "../publish-queue/types.js";

/** 批次内单篇发布的状态。 */
export type PublishBatchItemStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

/** 批次整体状态(由条目状态聚合)。 */
export type PublishBatchStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** 批次内一条发布意图(每篇独立账号/平台/时间)。 */
export interface PublishBatchItem {
  /** 批次内唯一 id(不依赖草稿 id,草稿可能被删除)。 */
  readonly itemId: string;
  /** 关联草稿 id(到点执行时读取草稿内容)。 */
  readonly draftId: string;
  /** 草稿标题快照(展示/复盘用,草稿删除后仍可读)。 */
  readonly draftTitle: string;
  /** 目标平台(为空 = 全部已选平台)。 */
  readonly platformIds: readonly string[];
  /** 该篇锁定的账号引用(缺省继承批次账号引用)。 */
  readonly accountRefs: readonly QueueAccountRef[];
  /** 是否真实发布(否则仅模拟 staged)。 */
  readonly realPublish: boolean;
  /** 期望发布时间(ISO;缺省继承批次 scheduledAt)。 */
  readonly scheduledAt?: string;
  /** 单篇状态。 */
  readonly status: PublishBatchItemStatus;
  /** 生成的发布任务 id(运行后填充)。 */
  readonly jobId?: string;
  /** 执行后收集的平台回执摘要(remoteId/remoteUrl,供效果回收)。 */
  readonly receipts?: readonly {
    readonly platformId: string;
    readonly status: string;
    readonly remoteId?: string;
    readonly remoteUrl?: string;
    readonly at: string;
  }[];
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** 执行结果摘要(脱敏)。 */
  readonly resultMessage?: string;
  readonly error?: string;
}

/** 批次复盘汇总(成功率 / 平台表现 / 建议)。 */
export interface BatchRetro {
  /** 批次内条目总数。 */
  readonly total: number;
  /** 成功条数。 */
  readonly succeeded: number;
  /** 失败条数。 */
  readonly failed: number;
  /** 跳过条数。 */
  readonly skipped: number;
  /** 成功率(0~1;无条目为 0)。 */
  readonly successRate: number;
  /** 覆盖平台数。 */
  readonly platformCount: number;
  /** 按平台汇总(成功数 / 总次数)。 */
  readonly byPlatform: readonly { readonly platformId: string; readonly ok: number; readonly total: number }[];
  /** 复盘建议(确定性规则,离线可用)。 */
  readonly suggestions: readonly string[];
  /** 各平台成功回执的 remoteId 数(供效果回收链路)。 */
  readonly collectibleRemoteIds: number;
}

/** 发布批次。 */
export interface PublishBatch {
  readonly id: string;
  /** 批次名称。 */
  readonly name: string;
  /** 批次内条目(按创建顺序)。 */
  readonly items: readonly PublishBatchItem[];
  /** 批次整体状态。 */
  readonly status: PublishBatchStatus;
  /** 批次默认发布时间(ISO;条目未指定时继承)。 */
  readonly scheduledAt: string;
  /** 批次默认账号引用(条目可覆盖)。 */
  readonly accountRefs: readonly QueueAccountRef[];
  /** 批次默认真实发布开关(条目可覆盖)。 */
  readonly realPublish: boolean;
  /** 批次开始时间。 */
  readonly startedAt?: string;
  /** 批次结束时间(全部条目终态)。 */
  readonly endedAt?: string;
  /** 复盘汇总(全部条目终态后生成)。 */
  readonly retro?: BatchRetro;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 新建批次输入。 */
export interface NewPublishBatch {
  readonly id?: string;
  readonly name?: string;
  /** 条目列表(每篇草稿 + 平台 + 可选时间)。 */
  readonly items: readonly {
    readonly draftId: string;
    readonly draftTitle?: string;
    readonly platformIds?: readonly string[];
    readonly accountRefs?: readonly QueueAccountRef[];
    readonly realPublish?: boolean;
    readonly scheduledAt?: string;
  }[];
  readonly scheduledAt?: string;
  readonly accountRefs?: readonly QueueAccountRef[];
  readonly realPublish?: boolean;
}

/** 批次存储(版本化)。 */
export interface PublishBatchStore {
  readonly schemaVersion: number;
  list(): Promise<readonly PublishBatch[]>;
  get(id: string): Promise<PublishBatch | undefined>;
  put(batch: PublishBatch): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 执行批次内一条的结果。 */
export interface BatchItemRunResult {
  readonly batchId: string;
  readonly itemId: string;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly error?: string;
  readonly jobId?: string;
}

/** 批量回收效果的输入(一次回收汇总)。 */
export interface BatchMetricsCollectResult {
  /** 新增/更新的效果记录数。 */
  readonly imported: number;
  /** 被去重跳过的记录数(同一平台 + remoteId 已存在)。 */
  readonly skipped: number;
  readonly errors: readonly string[];
}

/** 批次存储 schema 版本(升级需写迁移)。 */
export const PUBLISH_BATCH_SCHEMA_VERSION = 1;
/** 批次上限(防止本地存储无限增长)。 */
export const PUBLISH_BATCH_MAX = 100;
/** 终态批次保留天数(到期由 prune 清理)。 */
export const PUBLISH_BATCH_RETENTION_DAYS = 30;

/** 校验批次是否满足 schema(损坏/旧版本检测)。 */
export function assertPublishBatch(value: unknown): value is PublishBatch {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    Array.isArray(b.items) &&
    typeof b.scheduledAt === "string" &&
    typeof b.status === "string" &&
    typeof b.createdAt === "string" &&
    typeof b.updatedAt === "string"
  );
}

/** 内存实现(默认/测试用)。 */
export class MemoryPublishBatchStore implements PublishBatchStore {
  readonly schemaVersion = PUBLISH_BATCH_SCHEMA_VERSION;
  private readonly batches = new Map<string, PublishBatch>();

  async list(): Promise<readonly PublishBatch[]> {
    return [...this.batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<PublishBatch | undefined> {
    return this.batches.get(id);
  }
  async put(batch: PublishBatch): Promise<void> {
    this.batches.set(batch.id, batch);
  }
  async remove(id: string): Promise<void> {
    this.batches.delete(id);
  }
}
