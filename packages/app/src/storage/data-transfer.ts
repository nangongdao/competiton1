/**
 * DATA-01 数据导出/导入。
 *
 * 把草稿、发布历史与关键设置导出为单一 JSON 文件(带 schema 版本与元数据),
 * 可无损导入恢复。纯 TS 零 DOM,可在 Node 环境验证。
 *
 * 导出格式(version 1):
 * ```json
 * {
 *   "app": "multi-platform-publisher",
 *   "kind": "mpp-data",
 *   "version": 1,
 *   "exportedAt": "ISO",
 *   "data": { "drafts": [...], "history": [...], "settings": {...} }
 * }
 * ```
 */
import type { Draft, HistoryEntry } from "./draft-store.js";

export const DATA_SCHEMA_VERSION = 1;
export const DATA_KIND = "mpp-data";
export const APP_ID = "multi-platform-publisher";

export interface DataSettings {
  readonly serverUrl?: string;
  readonly runnerUrl?: string;
  readonly wechatPublishMode?: string;
  readonly automationModes?: Record<string, string>;
  readonly enhance?: Record<string, boolean>;
}

export interface MppData {
  readonly drafts: readonly Draft[];
  readonly history: readonly HistoryEntry[];
  readonly settings?: DataSettings;
}

export interface MppDataFile {
  readonly app: string;
  readonly kind: string;
  readonly version: number;
  readonly exportedAt: string;
  readonly data: MppData;
}

export type ImportResult =
  | { readonly ok: true; readonly data: MppData; readonly counts: { drafts: number; history: number } }
  | { readonly ok: false; readonly error: string };

/** 序列化导出文件(JSON 字符串)。 */
export function serializeExport(data: MppData, now: () => string = () => new Date().toISOString()): string {
  const file: MppDataFile = {
    app: APP_ID,
    kind: DATA_KIND,
    version: DATA_SCHEMA_VERSION,
    exportedAt: now(),
    data,
  };
  return JSON.stringify(file, null, 2);
}

/** 解析并校验导入文件;版本不兼容或结构损坏返回明确错误。 */
export function parseImport(raw: string): ImportResult {
  let file: unknown;
  try {
    file = JSON.parse(raw);
  } catch {
    return { ok: false, error: "文件不是合法 JSON" };
  }
  if (!isRecord(file)) return { ok: false, error: "文件结构损坏:顶层应为对象" };
  if (file.kind !== DATA_KIND) return { ok: false, error: `不是 ${DATA_KIND} 数据文件` };
  if (file.app !== APP_ID) return { ok: false, error: `应用标识不匹配:${String(file.app)}` };
  const version = file.version;
  if (typeof version !== "number" || version < 1 || version > DATA_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `数据版本 ${String(version)} 不受支持(当前支持 ≤ ${DATA_SCHEMA_VERSION}),请升级应用后导入`,
    };
  }
  const data = file.data;
  if (!isRecord(data)) return { ok: false, error: "数据区损坏:缺少 data 对象" };

  const drafts = Array.isArray(data.drafts) ? data.drafts.filter(isValidDraft) : [];
  const history = Array.isArray(data.history) ? data.history.filter(isValidHistory) : [];
  const settings = isRecord(data.settings) ? (data.settings as DataSettings) : undefined;

  return { ok: true, data: { drafts, history, settings }, counts: { drafts: drafts.length, history: history.length } };
}

/** 兼容旧版本(未来版本迁移入口):当前仅 v1,返回原数据。 */
export function migrateData(file: MppDataFile): MppDataFile {
  return file;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidDraft(v: unknown): v is Draft {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.markdown === "string" &&
    typeof v.authorName === "string" &&
    Array.isArray(v.tags) &&
    typeof v.updatedAt === "string"
  );
}

function isValidHistory(v: unknown): v is HistoryEntry {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.draftTitle === "string" &&
    typeof v.at === "string" &&
    Array.isArray(v.platforms)
  );
}
