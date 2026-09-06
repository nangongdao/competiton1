/**
 * v4 Phase 3 · COLLAB-01/02/04 协作共享 —— 契约。
 *
 * 在 v4「多账号矩阵运营 + 智能自动化」之上,把内容变成**可共享**的一等公民:
 * - 共享内容(草稿 / 平台模板 / 复盘报告)带统一元数据(来源、作者、版本、更新时间);
 * - **本地 server 共享**:`/share/*` 路由(局域网内多台设备读写共享内容),强制
 *   X-MPP-Token 鉴权;共享内容只读写列表与单条,不做任意文件读写(越权边界);
 * - **共享包(COLLAB-02)**:导出/导入单一 JSON 文件,跨机器无损搬运,带 schema
 *   版本与**可选签名校验**(防止传输中被篡改);版本不匹配明确报错;
 * - **可选远程同步(COLLAB-04)**:自托管同步服务器(SYNC_URL)与本地 server 同协议,
 *   无同步源时优雅降级为纯本地。
 *
 * 设计原则(延续 ROADMAP_V4 §5):
 * - 纯 TS、零 DOM;`buildShareBundle` / `parseShareBundle` 为纯函数,可单测;
 * - 密钥安全延续:共享内容/共享包永远不含密钥(草稿/模板经 strip 处理),
 *   报告本身已脱敏(不含 remoteUrl / 凭据);
 * - 共享内容只读版本化(本地覆盖 = 显式 push,不自动覆盖远端)。
 */

/** 共享内容类型:草稿 / 平台模板 / 复盘报告。 */
export type SharedContentKind = "draft" | "template" | "report";

/** 共享内容的元信息(不含正文)。 */
export interface SharedItemMeta {
  readonly kind: SharedContentKind;
  readonly id: string;
  /** 共享方展示名(用户昵称/设备名)。 */
  readonly sourceName: string;
  /** 作者(草稿的 authorName;模板/报告可空)。 */
  readonly author?: string;
  /** 标题(草稿/报告标题;模板名)。 */
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 版本号(本地每次覆盖 +1;从 1 开始)。 */
  readonly version: number;
}

/** 共享条目 —— 元信息 + 内容载体(纯数据,便于 server 落盘/局域网传输)。 */
export interface SharedItem {
  readonly meta: SharedItemMeta;
  /** 内容载体:草稿/模板/报告的具体数据(见下方各 kind 的 payload 类型)。 */
  readonly payload: SharedPayload;
}

/** 共享内容载体(kind 判别联合)。 */
export type SharedPayload =
  | { readonly kind: "draft"; readonly draft: SharedDraftPayload }
  | { readonly kind: "template"; readonly template: SharedTemplatePayload }
  | { readonly kind: "report"; readonly report: SharedReportPayload };

/** 草稿共享载体(与 app Draft 对齐,不含密钥)。 */
export interface SharedDraftPayload {
  readonly title: string;
  readonly markdown: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}

/** 平台模板共享载体(与 assistant PlatformTemplate 对齐,只含覆盖层/配置/影响面)。 */
export interface SharedTemplatePayload {
  readonly name: string;
  readonly description?: string;
  readonly platformId: string;
  readonly version: number;
  readonly schemaVersion: number;
  readonly override?: Readonly<Record<string, unknown>>;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly touches?: Readonly<Record<string, boolean>>;
}

/** 复盘报告共享载体(脱敏:只有 Markdown 文本 + 模板 + 窗口信息,无 remoteUrl/凭据)。 */
export interface SharedReportPayload {
  readonly title: string;
  readonly markdown: string;
  readonly template?: string;
  readonly windowDays?: number;
  readonly generatedAt: string;
}

/** 写入结果模式:created=新建 / updated=顺序覆盖 / conflict=并发冲突(保留双版本) / unchanged=内容一致(空操作)。 */
export type SharedItemPutMode = "created" | "updated" | "conflict" | "unchanged";

/** 版本化写入结果(conflict 时新版本以 `id#v{n}` 后缀写入,旧版本保留在原 id 下)。 */
export interface SharedItemPutResult {
  readonly mode: SharedItemPutMode;
  /** 实际写入(conflict 时 id 带后缀、版本号已递增)。 */
  readonly item: SharedItem;
  /** conflict/updated 模式下被替换或并存的旧版本。 */
  readonly existing?: SharedItem;
}

/** 本地共享库(按 kind + id 索引)。 */
export interface SharedStore {
  readonly schemaVersion: number;
  list(): Promise<readonly SharedItem[]>;
  listByKind(kind: SharedContentKind): Promise<readonly SharedItem[]>;
  get(kind: SharedContentKind, id: string): Promise<SharedItem | undefined>;
  /** 版本化写入:同 id 并发覆盖时保留双版本(见 mergeSharedItem)。 */
  put(item: SharedItem): Promise<SharedItemPutResult>;
  remove(kind: SharedContentKind, id: string): Promise<void>;
}

/** 共享库 schema 版本(升级需写迁移)。 */
export const SHARED_SCHEMA_VERSION = 1;
/** 每类共享内容的最大条数(防止本地共享库无限增长)。 */
export const SHARED_ITEMS_PER_KIND_MAX = 200;
/** 共享包 schema 版本(COLLAB-02)。 */
export const SHARE_BUNDLE_SCHEMA_VERSION = 1;
/** 共享包应用标识(与 DATA-01 对齐)。 */
export const SHARE_BUNDLE_APP_ID = "multi-platform-publisher";
export const SHARE_BUNDLE_KIND = "mpp-share-bundle";

/** 共享包文件(带 schema 版本 + 可选签名)。 */
export interface ShareBundleFile {
  readonly app: string;
  readonly kind: string;
  readonly version: number;
  readonly exportedAt: string;
  readonly sourceName: string;
  /** 可选:内容的 SHA-256 摘要(用于传输完整性/篡改检测)。 */
  readonly digest?: string;
  readonly items: readonly SharedItem[];
}

/** 解析共享包结果。 */
export type ShareBundleParseResult =
  | { readonly ok: true; readonly bundle: ShareBundleFile; readonly counts: Record<SharedContentKind, number> }
  | { readonly ok: false; readonly error: string };

/** 导入共享包结果(把包内条目合并进共享库)。 */
export type ShareBundleImportResult =
  | { readonly ok: true; readonly imported: number; readonly skipped: number }
  | { readonly ok: false; readonly error: string };
