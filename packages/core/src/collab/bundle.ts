/**
 * v4 Phase 3 · COLLAB-02 共享包导出/导入 —— 纯函数实现。
 *
 * 能力:
 * - `buildShareBundle`:把一组共享条目打包为带 schema 版本 + 元数据 + 可选签名的 JSON;
 * - `computeShareDigest`:对整个 bundle 内容做 SHA-256(WebCrypto;Node 下用
 *   `crypto` 兼容兜底),用于传输完整性/篡改检测;
 * - `parseShareBundle`:解析并校验包结构(版本 / 应用标识 / kind 匹配 / 条目 schema);
 *   版本不兼容或结构损坏返回**明确错误**,绝不静默丢弃;
 * - `importShareBundle`:把包内条目合并进共享库(已存在 id 覆盖、新增追加),返回
 *   导入/跳过计数。
 *
 * 设计原则(ROADMAP_V4 §5):
 * - 纯 TS、零 DOM;WebCrypto 不可用(如老环境)时用 FNV 摘要兜底(仍可检测基础篡改);
 * - 密钥安全延续:共享条目本身不含密钥(草稿/模板/报告均脱敏);
 * - 导入不覆盖不存在的其它字段(仅合并本次包内条目)。
 */
import type { SharedItem, SharedContentKind, ShareBundleFile, ShareBundleParseResult, ShareBundleImportResult, SharedStore } from "./types.js";
import { SHARE_BUNDLE_SCHEMA_VERSION, SHARE_BUNDLE_APP_ID, SHARE_BUNDLE_KIND } from "./types.js";

const ALL_KINDS: readonly SharedContentKind[] = ["draft", "template", "report"];

/** 序列化共享包为 JSON 字符串(可导出 .json 文件)。 */
export function serializeShareBundle(
  items: readonly SharedItem[],
  options: { sourceName?: string; now?: () => string } = {},
): Promise<string> {
  return buildShareBundle(items, options).then((bundle) => JSON.stringify(bundle, null, 2));
}

/** 构建共享包对象(带可选签名摘要)。 */
export async function buildShareBundle(
  items: readonly SharedItem[],
  options: { sourceName?: string; now?: () => string; sign?: boolean } = {},
): Promise<ShareBundleFile> {
  const now = options.now ?? (() => new Date().toISOString());
  const sourceName = options.sourceName ?? "本地";
  const base: Omit<ShareBundleFile, "digest"> = {
    app: SHARE_BUNDLE_APP_ID,
    kind: SHARE_BUNDLE_KIND,
    version: SHARE_BUNDLE_SCHEMA_VERSION,
    exportedAt: now(),
    sourceName,
    items: [...items],
  };
  const sign = options.sign !== false;
  if (sign) {
    const digest = await computeShareDigest(base);
    return { ...base, digest };
  }
  return base;
}

/**
 * 计算共享包内容摘要。
 *
 * 用 WebCrypto SHA-256(异步);不可用(如极端环境)时回退 FNV-1a(同步,确定性),
 * 仍可检测绝大多数传输损坏/篡改。摘要覆盖 `kind/version/items`(不含 exportedAt/sourceName,
 * 便于同一批内容多次导出得到一致摘要)。
 */
export async function computeShareDigest(
  bundle: Pick<ShareBundleFile, "kind" | "version" | "items">,
): Promise<string> {
  const canonical = JSON.stringify({ kind: bundle.kind, version: bundle.version, items: bundle.items });
  try {
    if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fall through to fnv
  }
  return fnv1aHex(canonical);
}

/** FNV-1a 32 位摘要(十六进制)——WebCrypto 不可用时的确定性兜底。 */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `fnv-${h.toString(16).padStart(8, "0")}`;
}

/** 解析并校验共享包;版本/结构损坏返回明确错误。 */
export function parseShareBundle(raw: string): ShareBundleParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "共享包不是合法 JSON" };
  }
  if (!isRecord(parsed)) return { ok: false, error: "共享包结构损坏:顶层应为对象" };
  if (parsed.kind !== SHARE_BUNDLE_KIND) {
    return { ok: false, error: `不是 ${SHARE_BUNDLE_KIND} 共享包文件` };
  }
  if (parsed.app !== SHARE_BUNDLE_APP_ID) {
    return { ok: false, error: `应用标识不匹配:${String(parsed.app)}` };
  }
  const version = parsed.version;
  if (typeof version !== "number" || version < 1 || version > SHARE_BUNDLE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `共享包版本 ${String(version)} 不受支持(当前支持 ≤ ${SHARE_BUNDLE_SCHEMA_VERSION}),请升级应用后导入`,
    };
  }
  if (!Array.isArray(parsed.items)) return { ok: false, error: "共享包缺少 items 数组" };

  const items: SharedItem[] = [];
  for (const rawItem of parsed.items) {
    const item = normalizeSharedItem(rawItem);
    if (!item) {
      return { ok: false, error: "共享包包含损坏条目(结构不满足共享条目契约),已中止导入" };
    }
    items.push(item);
  }

  const bundle: ShareBundleFile = {
    app: SHARE_BUNDLE_APP_ID,
    kind: SHARE_BUNDLE_KIND,
    version,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    sourceName: typeof parsed.sourceName === "string" ? parsed.sourceName : "未知来源",
    ...(typeof parsed.digest === "string" ? { digest: parsed.digest } : {}),
    items,
  };

  const counts = countByKind(items);
  return { ok: true, bundle, counts };
}

/** 把包内条目合并进共享库(已存在覆盖、新增追加),返回导入/跳过计数。 */
export async function importShareBundle(store: SharedStore, raw: string): Promise<ShareBundleImportResult> {
  const parsed = parseShareBundle(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { bundle } = parsed;
  // 摘要校验(可选):包带 digest 且本地可重算时,校验失败直接拒绝(防篡改)。
  if (bundle.digest) {
    const expected = await computeShareDigest(bundle);
    if (expected !== bundle.digest) {
      return { ok: false, error: "共享包完整性校验失败(内容与摘要不符,可能已被篡改或损坏)" };
    }
  }

  let imported = 0;
  let skipped = 0;
  for (const item of bundle.items) {
    const existing = await store.get(item.meta.kind, item.meta.id);
    if (existing && existing.meta.updatedAt >= item.meta.updatedAt) {
      skipped++;
      continue;
    }
    // 版本化写入:同 id 并发覆盖时 store 内部保留双版本(conflict),均计入导入。
    const result = await store.put(item);
    if (result.mode !== "unchanged") imported++;
  }
  return { ok: true, imported, skipped };
}

/** 统计按 kind 的条目数。 */
export function countByKind(items: readonly SharedItem[]): Record<SharedContentKind, number> {
  const counts: Record<SharedContentKind, number> = { draft: 0, template: 0, report: 0 };
  for (const item of items) counts[item.meta.kind]++;
  return counts;
}

/** 从草稿/模板/报告构建共享条目(纯函数,脱敏)。
 *  @param now 注入时钟(测试用),缺省用真实时间。 */
export function sharedItemFrom(
  kind: SharedContentKind,
  id: string,
  sourceName: string,
  payload: SharedItem["payload"],
  now: () => string = () => new Date().toISOString(),
): SharedItem {
  const current = now();
  return {
    meta: {
      kind,
      id,
      sourceName,
      author: payload.kind === "draft" ? payload.draft.authorName : undefined,
      title: titleOf(payload),
      createdAt: payload.kind === "report" ? payload.report.generatedAt : current,
      updatedAt: current,
      version: 1,
    },
    payload,
  };
}

function titleOf(payload: SharedItem["payload"]): string {
  if (payload.kind === "draft") return payload.draft.title;
  if (payload.kind === "template") return payload.template.name;
  return payload.report.title;
}

/** 规范化并校验单个条目(非法返回 undefined)。 */
export function normalizeSharedItem(raw: unknown): SharedItem | undefined {
  if (!isRecord(raw)) return undefined;
  const metaRaw = raw.meta;
  if (!isRecord(metaRaw)) return undefined;
  const kind = metaRaw.kind as SharedContentKind | undefined;
  if (!kind || !ALL_KINDS.includes(kind)) return undefined;
  const meta = {
    kind,
    id: typeof metaRaw.id === "string" ? metaRaw.id : "",
    sourceName: typeof metaRaw.sourceName === "string" ? metaRaw.sourceName : "未知来源",
    author: typeof metaRaw.author === "string" ? metaRaw.author : undefined,
    title: typeof metaRaw.title === "string" ? metaRaw.title : "",
    createdAt: typeof metaRaw.createdAt === "string" ? metaRaw.createdAt : new Date().toISOString(),
    updatedAt: typeof metaRaw.updatedAt === "string" ? metaRaw.updatedAt : new Date().toISOString(),
    version: typeof metaRaw.version === "number" && metaRaw.version >= 1 ? metaRaw.version : 1,
  };
  if (!meta.id || !meta.title) return undefined;

  const payload = normalizePayload(kind, raw.payload);
  if (!payload) return undefined;
  return { meta, payload };
}

function normalizePayload(kind: SharedContentKind, raw: unknown): SharedItem["payload"] | undefined {
  if (!isRecord(raw)) return undefined;
  if (kind === "draft") {
    const d = raw.draft;
    if (!isRecord(d)) return undefined;
    if (typeof d.title !== "string" || typeof d.markdown !== "string" || typeof d.authorName !== "string") return undefined;
    return {
      kind: "draft",
      draft: {
        title: d.title,
        markdown: d.markdown,
        authorName: d.authorName,
        tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : [],
        updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : new Date().toISOString(),
      },
    };
  }
  if (kind === "template") {
    const t = raw.template;
    if (!isRecord(t)) return undefined;
    if (typeof t.name !== "string" || typeof t.platformId !== "string") return undefined;
    return {
      kind: "template",
      template: {
        name: t.name,
        description: typeof t.description === "string" ? t.description : undefined,
        platformId: t.platformId,
        version: typeof t.version === "number" ? t.version : 1,
        schemaVersion: typeof t.schemaVersion === "number" ? t.schemaVersion : 1,
        override: isRecord(t.override) ? (t.override as Readonly<Record<string, unknown>>) : undefined,
        config: isRecord(t.config) ? (t.config as Readonly<Record<string, unknown>>) : undefined,
        touches: isRecord(t.touches) ? (t.touches as Readonly<Record<string, boolean>>) : undefined,
      },
    };
  }
  // report
  const r = raw.report;
  if (!isRecord(r)) return undefined;
  if (typeof r.title !== "string" || typeof r.markdown !== "string") return undefined;
  return {
    kind: "report",
    report: {
      title: r.title,
      markdown: r.markdown,
      template: typeof r.template === "string" ? r.template : undefined,
      windowDays: typeof r.windowDays === "number" ? r.windowDays : undefined,
      generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : new Date().toISOString(),
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
