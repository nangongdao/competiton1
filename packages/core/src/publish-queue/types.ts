/**
 * 发布队列与定时发布(ROADMAP_V5 Phase 1)。
 *
 * 在既有「本机计划任务」(cron 到点执行)之上,提供**把当前草稿/已保存草稿排入发布队列,
 * 按指定时间自动触发真实发布**的一等公民能力:
 * - `PublishQueueEntry`:一次"稍后发布"意图(关联草稿 + 目标平台 + 期望发布时间 + 账号引用);
 * - 到点由调度心跳把条目转为真实发布任务(复用 `PublishJobService` 可信回执链路);
 * - 支持立即执行 / 重新排队 / 取消 / 完成留存;
 * - **账号级路由**:条目标记每个平台的账号引用(server profile / 浏览器 profile),
 *   到点执行时按该账号发布,而非当时"当前账号"(防止排队期间切换账号导致发错账号)。
 *
 * 设计原则(延续 ROADMAP_V4 §5):
 * - 纯 TS、零 DOM;存储层与 JOB-02 / FLOW-03 同构(版本化 + 保留清理);
 * - 机器与登录态必须在线:到点只触发执行器,失败/跳过如实记录,不假装成功;
 * - 排队不是绕过确认:默认仍走与"立即真实发布"相同的鉴权与可信回执;
 *   未启用真实发布的平台(mock/assist)到点也如实标记 staged(模拟)。
 * - 密钥/凭据不进 core:账号引用只存 id / serverProfileId / profileDir(非密钥)。
 */

/** 条目状态机。 */
export type PublishQueueStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** 单平台账号引用(排队时锁定,到点按此账号发布)。 */
export interface QueueAccountRef {
  readonly platformId: string;
  /** 公众号 server 侧 profile 引用(与 AccountProfile.serverProfileId 一致)。 */
  readonly serverProfileId?: string;
  /** 会话平台浏览器登录 profile 目录(与 AccountProfile.profileDir 一致)。 */
  readonly profileDir?: string;
}

/** 发布队列条目。 */
export interface PublishQueueEntry {
  readonly id: string;
  /** 显示名称(默认取草稿标题)。 */
  readonly name: string;
  /** 关联草稿 id(到点执行时读取草稿内容)。 */
  readonly draftId: string;
  /** 目标平台(为空 = 全部已选平台)。 */
  readonly platformIds: readonly string[];
  /** 期望发布时间(ISO)。 */
  readonly scheduledAt: string;
  /** 排队时锁定的账号引用(按平台,可选)。 */
  readonly accountRefs: readonly QueueAccountRef[];
  /** 是否在到点执行时进行真实发布(否则仅模拟 staged)。 */
  readonly realPublish: boolean;
  /** 队列内展示排序序号(拖动排序用;缺省按 scheduledAt 倒序)。 */
  readonly sortOrder?: number;
  readonly status: PublishQueueStatus;
  /** 生成的发布任务 id(运行后填充)。 */
  readonly jobId?: string;
  /** 执行结果摘要(成功/失败信息,脱敏)。 */
  readonly resultMessage?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 新建条目输入。 */
export interface NewPublishQueueEntry {
  readonly id?: string;
  readonly name?: string;
  readonly draftId: string;
  readonly platformIds: readonly string[];
  readonly scheduledAt: string;
  readonly accountRefs?: readonly QueueAccountRef[];
  readonly realPublish?: boolean;
  readonly sortOrder?: number;
}

/** 队列存储(版本化)。 */
export interface PublishQueueStore {
  readonly schemaVersion: number;
  list(): Promise<readonly PublishQueueEntry[]>;
  get(id: string): Promise<PublishQueueEntry | undefined>;
  put(entry: PublishQueueEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 到点执行条目的结果。 */
export interface QueueRunResult {
  readonly entryId: string;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly error?: string;
  readonly jobId?: string;
}

/** 队列存储 schema 版本(升级需写迁移)。 */
export const PUBLISH_QUEUE_SCHEMA_VERSION = 1;
/** 队列条目上限(防止本地存储无限增长)。 */
export const PUBLISH_QUEUE_MAX = 100;
/** 完成/失败条目保留天数(到期由 prune 清理)。 */
export const PUBLISH_QUEUE_RETENTION_DAYS = 30;

/** 校验条目是否满足 schema(损坏/旧版本检测)。 */
export function assertPublishQueueEntry(value: unknown): value is PublishQueueEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    typeof e.draftId === "string" &&
    Array.isArray(e.platformIds) &&
    e.platformIds.every((x) => typeof x === "string") &&
    typeof e.scheduledAt === "string" &&
    typeof e.status === "string" &&
    typeof e.createdAt === "string" &&
    typeof e.updatedAt === "string" &&
    (e.realPublish === undefined || typeof e.realPublish === "boolean")
  );
}

/** 按展示顺序排序队列(优先 sortOrder,缺省按 scheduledAt 倒序)。 */
export function sortQueueEntries(entries: readonly PublishQueueEntry[]): readonly PublishQueueEntry[] {
  return [...entries].sort((a, b) => {
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return b.scheduledAt.localeCompare(a.scheduledAt);
  });
}

/** 把队列重排为目标 id 顺序,返回每个条目的新 sortOrder(拖动排序落盘)。 */
export function reorderQueueEntries(
  entries: readonly PublishQueueEntry[],
  orderedIds: readonly string[],
): readonly PublishQueueEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const at = new Date().toISOString();
  const next: PublishQueueEntry[] = [];
  orderedIds.forEach((id, index) => {
    const e = byId.get(id);
    if (e) next.push({ ...e, sortOrder: index, updatedAt: at });
  });
  for (const e of entries) {
    if (!orderedIds.includes(e.id)) next.push(e);
  }
  return next;
}

/** 内存实现(默认/测试用)。 */
export class MemoryPublishQueueStore implements PublishQueueStore {
  readonly schemaVersion = PUBLISH_QUEUE_SCHEMA_VERSION;
  private readonly entries = new Map<string, PublishQueueEntry>();

  async list(): Promise<readonly PublishQueueEntry[]> {
    return sortQueueEntries([...this.entries.values()]);
  }
  async get(id: string): Promise<PublishQueueEntry | undefined> {
    return this.entries.get(id);
  }
  async put(entry: PublishQueueEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }
  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }
}
