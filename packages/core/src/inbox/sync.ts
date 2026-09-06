/**
 * INBOX-03 真实平台消息同步 —— 增量拉取 / 去重合并 / 归一化。
 *
 * 解决「收件箱只能手工录入模拟消息」的缺口:把各平台的评论 / 私信 / @提及 / 通知
 * 通过注入的适配器批量拉取,再按 `platformId + remoteId` 幂等去重合并进本地收件箱。
 *
 * 设计原则(与项目网络边界一致):
 * - core 是纯逻辑层,不直接发请求;平台差异由「同步适配器」封装(server/runner/本地演示实现);
 * - 同步是**增量 + 去重**的:只拉取「远端游标之后」的消息,已存在的 remoteId 自动跳过;
 * - 同步结果可量化(新增 / 更新 / 跳过),供 UI 展示与通知;
 * - 同步适配器可同时返回「游标」,把拉取位置推进到最新,避免重复全量拉取。
 */
import type { InboxMessageKind, NewInboxMessage } from "./types.js";
import { createInboxMessage } from "./types.js";
import { analyzeCommentRule } from "../crm/crm.js";
import type { InboxStore } from "./types.js";

/** 远端消息的最小结构(适配器归一化输出)。 */
export interface RemoteInboxItem {
  /** 平台侧消息 id(去重键)。 */
  readonly remoteId: string;
  readonly kind: InboxMessageKind;
  /** 发送者昵称。 */
  readonly author: string;
  /** 发送者平台侧 id(可选)。 */
  readonly authorId?: string;
  /** 消息正文。 */
  readonly text: string;
  /** 关联账号(accountId,可选)。 */
  readonly accountId?: string;
  /** 关联内容(historyId,可选)。 */
  readonly historyId?: string;
  /** 消息时间(ISO;缺省用同步时刻)。 */
  readonly receivedAt?: string;
  /** 意图标签(由评论营销引擎打标,可选)。 */
  readonly intent?: string;
  /** CRM 标签(可选)。 */
  readonly crmTags?: readonly string[];
  /** 自动回复建议(可选)。 */
  readonly autoReply?: string;
}

/** 一次同步请求。 */
export interface InboxSyncRequest {
  /** 目标平台 id。 */
  readonly platformId: string;
  /** 平台侧同步游标(如评论最大 id / 时间戳;首次为空)。 */
  readonly cursor?: string;
  /** 关联账号 id(多账号路由,可选)。 */
  readonly accountId?: string;
  /** 单次拉取上限(缺省 100)。 */
  readonly limit?: number;
}

/** 一次同步结果。 */
export interface InboxSyncResult {
  readonly ok: boolean;
  readonly platformId: string;
  /** 拉取到的远端消息数。 */
  readonly fetched: number;
  /** 合并进本地的新增消息数。 */
  readonly added: number;
  /** 已存在被跳过的消息数(幂等去重)。 */
  readonly skipped: number;
  /** 同步后的最新游标(可持久化,下次增量拉取)。 */
  readonly cursor?: string;
  /** 同步时间。 */
  readonly at: string;
  readonly error?: string;
}

/** 平台同步适配器(由接线方注入真实实现;规则版演示/测试用)。 */
export interface InboxSyncAdapter {
  readonly platformId: string;
  /** 拉取该平台增量消息(按游标/limit)。失败时返回 ok:false + error。 */
  fetch(req: InboxSyncRequest): Promise<{
    ok: boolean;
    items: readonly RemoteInboxItem[];
    cursor?: string;
    error?: string;
  }>;
}

/** 同步适配器注册表(加平台零改核心,与 platform-api 同模式)。 */
const ADAPTERS = new Map<string, InboxSyncAdapter>();

export function registerInboxSyncAdapter(adapter: InboxSyncAdapter): void {
  ADAPTERS.set(adapter.platformId, adapter);
}

export function getInboxSyncAdapter(platformId: string): InboxSyncAdapter | undefined {
  return ADAPTERS.get(platformId);
}

export function listInboxSyncAdapters(): readonly InboxSyncAdapter[] {
  return [...ADAPTERS.values()];
}

/** 是否已注册某平台的同步适配器(演示适配器幂等注册用)。 */
export function isInboxSyncAdapterRegistered(platformId: string): boolean {
  return ADAPTERS.has(platformId);
}

/**
 * 把远端消息归一化为本地 NewInboxMessage。
 * 未打标的消息自动跑规则版评论营销引擎(意图/情绪/自动回复),保证收件箱可直接展示。
 */
export function normalizeRemoteItem(
  item: RemoteInboxItem,
  platformId: string,
  accountId?: string,
  now: () => string = () => new Date().toISOString(),
): NewInboxMessage {
  // 未打标的消息自动跑规则版评论营销引擎(意图/情绪/自动回复),保证收件箱可直接展示。
  const insight =
    item.intent || item.autoReply
      ? undefined
      : analyzeCommentRule(item.text);
  const sensitivity =
    !item.crmTags && insight && (insight.sentiment === "negative" || insight.sentiment === "urgent")
      ? (insight.sentiment === "urgent" ? "urgent" : ("negative" as const))
      : undefined;
  return {
    platformId,
    remoteId: item.remoteId,
    kind: item.kind,
    author: item.author,
    text: item.text,
    direction: "inbound",
    receivedAt: item.receivedAt ?? now(),
    ...(item.authorId ? { authorId: item.authorId } : {}),
    ...(item.accountId || accountId ? { accountId: item.accountId ?? accountId } : {}),
    ...(item.historyId ? { historyId: item.historyId } : {}),
    ...(item.intent ? { intent: item.intent } : {}),
    // 规则引擎补充:意图 / 敏感度(负面/紧急) / 自动回复建议。
    ...(!item.intent && insight && insight.intent !== "other" ? { intent: insight.intent } : {}),
    ...(item.crmTags && item.crmTags.length > 0
      ? { crmTags: [...item.crmTags] }
      : insight && insight.crmTags.length > 0
        ? { crmTags: [...insight.crmTags] }
        : {}),
    ...(item.autoReply
      ? { autoReply: item.autoReply }
      : insight?.autoReply
        ? { autoReply: insight.autoReply }
        : {}),
    ...(sensitivity ? { sensitivity } : {}),
  };
}

/**
 * 同步引擎:拉取 → 归一化 → 幂等去重合并。
 *
 * @param store 收件箱存储(读取已有消息用于去重,写入新增消息)。
 * @param adapter 平台同步适配器(注入真实实现)。
 * @param req 同步请求(平台 / 游标 / 账号 / 上限)。
 * @param now 时间戳注入。
 */
export async function syncInboxFromPlatform(
  store: InboxStore,
  adapter: InboxSyncAdapter,
  req: InboxSyncRequest,
  now: () => string = () => new Date().toISOString(),
): Promise<InboxSyncResult> {
  const at = now();
  const remote = await adapter.fetch(req);
  if (!remote.ok) {
    return {
      ok: false,
      platformId: req.platformId,
      fetched: 0,
      added: 0,
      skipped: 0,
      at,
      error: remote.error ?? "同步失败",
    };
  }
  // 读取本地已有消息(按平台),建立 remoteId 索引做幂等去重。
  const existing = await store.listByPlatform(req.platformId);
  const seen = new Set(existing.map((m) => m.remoteId));
  let added = 0;
  let skipped = 0;
  for (const item of remote.items) {
    if (seen.has(item.remoteId)) {
      skipped++;
      continue;
    }
    const message = createInboxMessage(
      normalizeRemoteItem(item, req.platformId, req.accountId, now),
      now,
    );
    await store.put(message);
    seen.add(item.remoteId);
    added++;
  }
  return {
    ok: true,
    platformId: req.platformId,
    fetched: remote.items.length,
    added,
    skipped,
    ...(remote.cursor ? { cursor: remote.cursor } : {}),
    at,
  };
}

/**
 * 把多个平台的同步结果聚合成一条汇总消息(供 UI toast / 通知)。
 */
export function summarizeSyncResults(results: readonly InboxSyncResult[]): {
  ok: boolean;
  total: number;
  added: number;
  skipped: number;
  errors: readonly string[];
} {
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const r of results) {
    added += r.added;
    skipped += r.skipped;
    if (!r.ok && r.error) errors.push(`${r.platformId}: ${r.error}`);
  }
  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    total: results.length,
    added,
    skipped,
    errors,
  };
}

