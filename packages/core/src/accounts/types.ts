/**
 * ACCOUNT-01 账号配置模型 —— 多账号平台管理。
 *
 * v4 Phase 1 的核心契约:
 * - 每个平台可保存多套账号配置(公众号多账号 / 知乎多号 / B站多号 …);
 * - **凭据引用与密钥分离**:公众号账号只保存对 server 持凭据的 `profileId` 引用,
 *   不存 appid/secret;会话平台保存本地浏览器 profile 目录名(非密钥);
 * - **密钥安全分级(ACCOUNT-02)**:密钥字段默认仅会话保存(session,不落盘),
 *   显式开启 `persistSecrets` 才写入本地存储;共享/导出永远剔除密钥;
 * - 账号级隔离:发布 / 一键连接 / 指标同步时按账号路由(server/runner 带 accountId)。
 *
 * 纯 TS、零 DOM,可被 app(IndexedDB/chrome.storage)、server(多公众号凭据)、
 * runner(多浏览器 profile)复用。
 */

/** 密钥安全分级(ACCOUNT-02):凭据可被谁读取/落盘。 */
export type AccountSecurityLevel = "session" | "persistent" | "shared";

/** 账号启停状态。 */
export type AccountStatus = "enabled" | "disabled";

/**
 * 账号配置。
 *
 * 注意: `secrets` 字段只存在于**内存中的账号对象**;
 * 经 `stripAccountSecrets()` 持久化/导出时会剔除(置空)。
 */
export interface AccountProfile {
  readonly id: string;
  readonly platformId: string;
  /** 用户可读名称(如「主号」「副号」)。 */
  readonly name: string;
  /** 对 server 持凭据的公众号 profile 引用(仅 wechat 使用;凭据引用与密钥分离)。 */
  readonly serverProfileId?: string;
  /** 会话平台的浏览器登录 profile 目录名(仅 runner 平台使用;本地非密钥)。 */
  readonly profileDir?: string;
  /**
   * 平台密钥字段(仅内存;csdn cookie / 自定义密钥等)。
   * 默认仅会话保存;`persistSecrets` 为 true 时才写入本地存储。
   */
  readonly secrets: Readonly<Record<string, string>>;
  /** 是否把 secrets 持久化到本地存储(默认 false,对齐 SEC-04 默认仅会话)。 */
  readonly persistSecrets: boolean;
  /** 账号是否启用(禁用的账号不出现在发布/连接候选)。 */
  readonly status: AccountStatus;
  /** 最近一次一键连接成功的账号昵称(脱敏缓存,便于列表展示)。 */
  readonly lastAccountName?: string;
  readonly lastConnectedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 新建账号输入(secrets 可选,缺省为空)。 */
export interface NewAccountProfile {
  readonly id?: string;
  readonly platformId: string;
  readonly name: string;
  readonly serverProfileId?: string;
  readonly profileDir?: string;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly persistSecrets?: boolean;
  readonly status?: AccountStatus;
  readonly lastAccountName?: string;
  readonly lastConnectedAt?: string;
}

/** 账号存储(版本化;web=IndexedDB / 扩展=chrome.storage / 内存=MemoryAccountStore)。 */
export interface AccountStore {
  readonly schemaVersion: number;
  list(): Promise<readonly AccountProfile[]>;
  listByPlatform(platformId: string): Promise<readonly AccountProfile[]>;
  get(id: string): Promise<AccountProfile | undefined>;
  put(profile: AccountProfile): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 账号 schema 版本(升级需写迁移)。 */
export const ACCOUNT_SCHEMA_VERSION = 1;
/** 单平台最大账号数(防止本地存储无限增长)。 */
export const ACCOUNTS_PER_PLATFORM_MAX = 20;
/** 账号总数上限。 */
export const ACCOUNTS_TOTAL_MAX = 100;

/** 校验账号是否满足 schema(损坏/旧版本检测)。 */
export function assertAccountSchema(value: unknown): value is AccountProfile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.platformId === "string" &&
    typeof v.name === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    (v.serverProfileId === undefined || typeof v.serverProfileId === "string") &&
    (v.profileDir === undefined || typeof v.profileDir === "string") &&
    (v.secrets === undefined || (typeof v.secrets === "object" && v.secrets !== null)) &&
    (v.status === undefined || v.status === "enabled" || v.status === "disabled")
  );
}

/** 校验会话平台 profile 目录名:仅允许安全字符,拒绝路径穿越。 */
export function sanitizeProfileDir(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 120) return undefined;
  if (/[\\/]/.test(trimmed)) return undefined;
  if (/^\.\.?$/.test(trimmed)) return undefined;
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * 剔除密钥字段,得到可安全持久化/导出的账号形态。
 * 非密钥元数据(名称/profileDir/serverProfileId)保留。
 */
export function stripAccountSecrets(profile: AccountProfile): AccountProfile {
  if (!profile.persistSecrets) {
    return { ...profile, secrets: {} };
  }
  return { ...profile, secrets: { ...profile.secrets } };
}

/** 账号安全分级(供 UI 展示)。 */
export function accountSecurityLevel(profile: AccountProfile): AccountSecurityLevel {
  return profile.persistSecrets ? "persistent" : "session";
}

/** 新建账号(带默认值 + 确定性 id)。 */
export function createAccountProfile(input: NewAccountProfile, now: () => string = () => new Date().toISOString()): AccountProfile {
  const at = now();
  return {
    id: input.id ?? `acct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    platformId: input.platformId,
    name: input.name.trim() || input.platformId,
    ...(input.serverProfileId ? { serverProfileId: input.serverProfileId } : {}),
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    secrets: input.secrets ? { ...input.secrets } : {},
    persistSecrets: input.persistSecrets ?? false,
    status: input.status ?? "enabled",
    ...(input.lastAccountName ? { lastAccountName: input.lastAccountName } : {}),
    ...(input.lastConnectedAt ? { lastConnectedAt: input.lastConnectedAt } : {}),
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * 为某平台挑选当前生效账号。
 *
 * 优先级:platformId 的账号级选择(accountForPlatform)→ 全局 activeAccountId(若属于该平台)
 * → 该平台第一个启用账号 → 无账号返回 undefined(回退单账号默认行为)。
 */
export function resolveActiveAccount(
  platformId: string,
  accounts: readonly AccountProfile[],
  accountForPlatform: Readonly<Record<string, string>>,
  activeAccountId: string | null,
): AccountProfile | undefined {
  const byPlatform = accounts.filter((a) => a.platformId === platformId && a.status === "enabled");
  if (byPlatform.length === 0) return undefined;

  const pick = (id: string | undefined): AccountProfile | undefined => {
    if (!id) return undefined;
    return byPlatform.find((a) => a.id === id);
  };

  const perPlatform = pick(accountForPlatform[platformId]);
  if (perPlatform) return perPlatform;
  const global = pick(activeAccountId ?? undefined);
  if (global) return global;
  return byPlatform[0];
}

/** 判断平台是否使用 server 侧凭据(公众号官方 API 由 server 持有密钥)。 */
export function platformUsesServerCredentials(platformId: string): boolean {
  return platformId === "wechat";
}
