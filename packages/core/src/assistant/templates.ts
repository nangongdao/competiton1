/**
 * FLOW-01 平台模板与可复用配置。
 *
 * 模板 = 平台覆盖层(PlatformOverride) + 运行时配置(PlatformConfig) + 元数据。
 * - 版本化:每个模板带 version(递增),升级不破坏旧草稿(旧模板引用仍可解析);
 * - 影响面声明:模板记录它影响哪些缓存/幂等键字段,便于预览缓存失效与幂等键派生;
 * - 模板只存"差异",缺省字段回退平台默认 —— 升级模板不会悄悄改变未覆盖字段。
 *
 * 纯 TS、零 DOM,可被 app 的草稿/任务存储复用。
 */
import type { PlatformOverride } from "../ir/types.js";
import type { PlatformConfig } from "../config/platform-config.js";

export const PLATFORM_TEMPLATE_SCHEMA_VERSION = 1;

/** 模板影响面:声明该模板覆盖的字段(用于缓存/幂等键派生)。 */
export interface TemplateTouchSet {
  readonly title: boolean;
  readonly summary: boolean;
  readonly tags: boolean;
  readonly category: boolean;
  readonly cover: boolean;
  readonly theme: boolean;
  readonly bannedWords: boolean;
  readonly limits: boolean;
}

/** 平台模板:可复用的覆盖层 + 配置 + 元数据。 */
export interface PlatformTemplate {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** 目标平台。 */
  readonly platformId: string;
  /** 版本(递增;升级时+1,旧草稿引用旧版本仍可解析)。 */
  readonly version: number;
  readonly schemaVersion: number;
  /** 覆盖层(可空字段省略)。 */
  readonly override?: PlatformOverride;
  /** 运行时配置(可空字段省略)。 */
  readonly config?: PlatformConfig;
  /** 影响面(供缓存/幂等键派生,缺省自动从 override/config 推导)。 */
  readonly touches: TemplateTouchSet;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 模板库:按 (platformId, id) 索引,支持版本化存取。 */
export interface TemplateStore {
  list(platformId: string): Promise<readonly PlatformTemplate[]>;
  get(platformId: string, id: string): Promise<PlatformTemplate | undefined>;
  save(template: PlatformTemplate): Promise<void>;
  remove(platformId: string, id: string): Promise<void>;
}

/** 从 override/config 推导影响面。 */
export function deriveTouches(override?: PlatformOverride, config?: PlatformConfig): TemplateTouchSet {
  return {
    title: !!override?.title,
    summary: !!override?.summary,
    tags: !!override?.tags && override.tags.length > 0,
    category: !!override?.category,
    cover: !!override?.coverAssetId,
    theme: !!override?.themeId || !!config?.themeId,
    bannedWords: !!config?.bannedWords,
    limits: !!config?.limits,
  };
}

/** 创建一个新模板(version 从 1 开始)。 */
export function createTemplate(
  input: Omit<PlatformTemplate, "version" | "schemaVersion" | "touches" | "createdAt" | "updatedAt">,
  now: () => string = () => new Date().toISOString(),
): PlatformTemplate {
  const ts = now();
  return {
    ...input,
    version: 1,
    schemaVersion: PLATFORM_TEMPLATE_SCHEMA_VERSION,
    touches: deriveTouches(input.override, input.config),
    createdAt: ts,
    updatedAt: ts,
  };
}

/** 升级模板(version+1,保留 id/platformId/createdAt)。 */
export function bumpTemplateVersion(
  template: PlatformTemplate,
  patch: Partial<Pick<PlatformTemplate, "name" | "description" | "override" | "config">>,
  now: () => string = () => new Date().toISOString(),
): PlatformTemplate {
  const nextOverride = patch.override ?? template.override;
  const nextConfig = patch.config ?? template.config;
  return {
    ...template,
    ...patch,
    override: nextOverride,
    config: nextConfig,
    version: template.version + 1,
    touches: deriveTouches(nextOverride, nextConfig),
    updatedAt: now(),
  };
}

/** 校验模板结构合法性(供存储层/导入使用)。 */
export function assertValidTemplate(template: PlatformTemplate): void {
  if (!template.id || typeof template.id !== "string") throw new Error("模板缺少 id");
  if (!template.platformId || typeof template.platformId !== "string") throw new Error("模板缺少 platformId");
  if (typeof template.version !== "number" || template.version < 1) throw new Error("模板 version 非法");
  if (template.schemaVersion > PLATFORM_TEMPLATE_SCHEMA_VERSION) {
    throw new Error(`模板 schema 版本 ${template.schemaVersion} 高于当前支持 ${PLATFORM_TEMPLATE_SCHEMA_VERSION}`);
  }
}

/** 内存模板库(默认实现;app 可换 IndexedDB/chrome.storage)。 */
export class MemoryTemplateStore implements TemplateStore {
  private readonly items = new Map<string, PlatformTemplate>();

  async list(platformId: string): Promise<readonly PlatformTemplate[]> {
    return [...this.items.values()]
      .filter((t) => t.platformId === platformId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(platformId: string, id: string): Promise<PlatformTemplate | undefined> {
    return this.items.get(`${platformId}:${id}`);
  }
  async save(template: PlatformTemplate): Promise<void> {
    assertValidTemplate(template);
    this.items.set(`${template.platformId}:${template.id}`, template);
  }
  async remove(platformId: string, id: string): Promise<void> {
    this.items.delete(`${platformId}:${id}`);
  }
}

/** 把模板应用到"当前覆盖层 + 当前配置"上(合并,缺省保留用户现值)。 */
export function applyTemplate(
  template: PlatformTemplate,
  currentOverride?: PlatformOverride,
  currentConfig?: PlatformConfig,
): { override: PlatformOverride; config: PlatformConfig } {
  return {
    override: { ...(currentOverride ?? {}), ...(template.override ?? {}) },
    config: {
      ...(currentConfig ?? {}),
      ...(template.config ?? {}),
      limits: { ...(currentConfig?.limits ?? {}), ...(template.config?.limits ?? {}) },
    },
  };
}

/** 模板影响面 → 缓存键后缀(供预览缓存失效:模板升级但影响字段未变时命中缓存)。 */
export function touchKey(touches: TemplateTouchSet): string {
  return ["title", "summary", "tags", "category", "cover", "theme", "bannedWords", "limits"]
    .filter((k) => touches[k as keyof TemplateTouchSet])
    .join(",");
}
