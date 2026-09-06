/**
 * ROADMAP_V5 Phase 3 · 内容资产库 —— 契约。
 *
 * 把散落在各处的**内容资产**(封面 / 图床 URL / 历史产物 / 草稿快照)统一索引,
 * 提供**按类型浏览 / 检索 / 复制引用 / 删除**的一等公民能力:
 * - `AssetRecord`:一条资产记录(来源草稿/平台/类型/引用/时间),纯数据、可落盘;
 * - `AssetKind`:资产类型 —— cover(封面)/ rehost(图床 URL)/ artifact(平台产物)/
 *   snapshot(草稿快照)四类,对齐路线图 ASSET-01;
 * - `AssetLibraryStore`:版本化存储接口(与 QUEUE-03 / BATCH-03 同构);
 * - `indexAssetFromDraft` / `indexRehostRecord` / `indexArtifact` / `indexSnapshot`:
 *   从既有数据(草稿 markdown / 重托管记录 / 发布任务回执 / 版本快照)抽取资产;
 * - `searchAssetLibrary`:本地确定性检索(标题/平台/引用/类型加权评分,离线可用);
 * - `assertAssetRecord`:损坏检测(ASSET-01 验收:本地索引 + 损坏检测)。
 *
 * 设计原则(延续 ROADMAP_V5 §5):
 * - 纯 TS、零 DOM;不持有二进制内容,只存**引用**(dataURL 仅存短哈希+字节数);
 * - 索引不含密钥/凭据;`remoteUrl` 等敏感字段在记录中仅保留 host 摘要(脱敏);
 * - 去重:同 (draftId, kind, reference) 幂等,`buildAssetLibraryIndex` 增量合并。
 */
import type { PostMetrics } from "../analytics/types.js";

/** 资产类型(ASSET-01:封面 / 图床 URL / 历史产物 / 草稿快照)。 */
export type AssetLibraryKind = "cover" | "rehost" | "artifact" | "snapshot";

/** 资产来源(draft=草稿 / job=发布任务 / batch=发布批次 / queue=发布队列 / manual=手工录入)。 */
export type AssetSourceRef =
  | { readonly from: "draft"; readonly draftId: string }
  | { readonly from: "job"; readonly jobId: string }
  | { readonly from: "batch"; readonly batchId: string; readonly itemId?: string }
  | { readonly from: "queue"; readonly queueId: string }
  | { readonly from: "manual" };

/** 一条资产索引记录(纯数据、可 JSON 序列化)。 */
export interface AssetRecord {
  readonly id: string;
  readonly kind: AssetLibraryKind;
  /** 展示标题(草稿标题 / 平台产物名 / 快照说明)。 */
  readonly title: string;
  /** 目标平台(cover 缺省为 "*";artifact/rehost 必填)。 */
  readonly platformId?: string;
  /** 内容引用:图床 URL / 远端 URL / dataURL 短哈希 / 文本摘要。 */
  readonly reference: string;
  /** 引用类型(供 UI 复制/下载)。 */
  readonly refKind: "url" | "hash" | "text";
  /** 关联草稿 id(可为空:手工录入 / 批次复盘等无草稿来源)。 */
  readonly draftId?: string;
  /** 来源出处。 */
  readonly source: AssetSourceRef;
  /** 字节数(图片资产;文本资产可空)。 */
  readonly bytes?: number;
  /** 图片 MIME(dataURL 资产;其余可空)。 */
  readonly mime?: string;
  /** 版本快照 id(snapshot 类型)。 */
  readonly snapshotId?: string;
  /** 关联任务/条目 id(artifact 类型;queue/batch 来源)。 */
  readonly taskId?: string;
  /** 相关效果指标(封面/图床/快照可为空;仅当有回收数据时填充)。 */
  readonly metrics?: PostMetrics;
  /** 创建/索引时间。 */
  readonly createdAt: string;
  /** 最近更新时间。 */
  readonly updatedAt: string;
}

/** 新建资产输入。 */
export interface NewAssetRecord {
  readonly id?: string;
  readonly kind: AssetLibraryKind;
  readonly title: string;
  readonly platformId?: string;
  readonly reference: string;
  readonly refKind?: "url" | "hash" | "text";
  readonly draftId?: string;
  readonly source: AssetSourceRef;
  readonly bytes?: number;
  readonly mime?: string;
  readonly snapshotId?: string;
  readonly taskId?: string;
  readonly metrics?: PostMetrics;
}

/** 资产存储(版本化)。 */
export interface AssetLibraryStore {
  readonly schemaVersion: number;
  list(): Promise<readonly AssetRecord[]>;
  listByKind(kind: AssetLibraryKind): Promise<readonly AssetRecord[]>;
  get(id: string): Promise<AssetRecord | undefined>;
  put(record: AssetRecord): Promise<void>;
  /** 批量写入(去重,同 id 覆盖)。 */
  putMany(records: readonly AssetRecord[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** 清空某草稿的全部资产(删除草稿时调用)。 */
  removeAllByDraft(draftId: string): Promise<void>;
}

/** 检索命中。 */
export interface AssetHit {
  readonly record: AssetRecord;
  /** 相关性评分(0-1)。 */
  readonly score: number;
}

export interface SearchAssetOptions {
  /** 最大返回条数(默认 20)。 */
  readonly limit?: number;
  /** 按类型过滤。 */
  readonly kind?: AssetLibraryKind;
  /** 最低相关分(默认 0.1)。 */
  readonly minScore?: number;
}

/** 资产索引构建结果(增量合并统计)。 */
export interface AssetIndexResult {
  readonly total: number;
  readonly added: number;
  readonly updated: number;
  /** 损坏/忽略的条目数。 */
  readonly ignored: number;
}

export const ASSET_LIBRARY_SCHEMA_VERSION = 1;
/** 资产条数上限(防止本地索引无限增长;prune 自动裁剪)。 */
export const ASSET_LIBRARY_MAX = 2000;
/** 终态来源保留天数(仅对 job/batch/queue 来源,防止长期占用)。 */
export const ASSET_LIBRARY_RETENTION_DAYS = 180;

/** 资产类型中文标签(供 UI)。 */
export const ASSET_KIND_LABELS: Readonly<Record<AssetLibraryKind, string>> = {
  cover: "封面",
  rehost: "图床",
  artifact: "平台产物",
  snapshot: "草稿快照",
};

/** 判定一条资产记录是否符合 schema(损坏检测)。 */
export function assertAssetRecord(value: unknown): value is AssetRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.kind === "string" &&
    ["cover", "rehost", "artifact", "snapshot"].includes(r.kind as string) &&
    typeof r.title === "string" &&
    (r.platformId === undefined || typeof r.platformId === "string") &&
    typeof r.reference === "string" &&
    ["url", "hash", "text"].includes((r.refKind as string) ?? "url") &&
    (r.draftId === undefined || typeof r.draftId === "string") &&
    typeof r.createdAt === "string" &&
    typeof r.updatedAt === "string" &&
    r.source !== null &&
    typeof r.source === "object" &&
    typeof (r.source as Record<string, unknown>).from === "string"
  );
}
