/**
 * BRAND-01 账号矩阵分组管理。
 *
 * 在「多账号平台管理(ACCOUNT-01)」之上补齐**分组维度**:
 * - 支持按品牌 / 业务线给账号分组(一个账号可属于多个分组);
 * - 分组视图展示账号状态 / 粉丝数 / 近期表现;
 * - 账号表现数据来自效果回收(PerformanceRecord),分组合计聚合。
 *
 * 设计原则:纯 TS 零 DOM,存储由 app 侧接线;分组不持有密钥。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import type { AccountProfile } from "../accounts/types.js";

/** 账号分组。 */
export interface AccountGroup {
  readonly id: string;
  /** 分组名(如「品牌 A」/「业务线 B」)。 */
  readonly name: string;
  /** 分组描述(可选)。 */
  readonly description?: string;
  /** 成员账号 id 列表。 */
  readonly memberIds: readonly string[];
  /** 品牌/业务线颜色标记(UI 用,可选)。 */
  readonly color?: string;
  /** 分组展示排序序号(拖动排序用,越小越靠前;缺省按更新时间倒序)。 */
  readonly sortOrder?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 新建分组输入。 */
export interface NewAccountGroup {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly memberIds?: readonly string[];
  readonly color?: string;
  readonly sortOrder?: number;
}

export const GROUP_SCHEMA_VERSION = 1;
export const GROUPS_MAX = 50;

/** 创建分组。 */
export function createAccountGroup(input: NewAccountGroup, now: () => string = () => new Date().toISOString()): AccountGroup {
  const at = now();
  return {
    id: input.id ?? `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim(),
    ...(input.description ? { description: input.description } : {}),
    memberIds: input.memberIds ? [...new Set(input.memberIds)] : [],
    ...(input.color ? { color: input.color } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    createdAt: at,
    updatedAt: at,
  };
}

/** 按展示顺序排序分组(优先 sortOrder,缺省按更新时间倒序)。 */
export function sortGroups(groups: readonly AccountGroup[]): readonly AccountGroup[] {
  return [...groups].sort((a, b) => {
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** 把分组重排为目标 id 顺序,返回每个分组的新 sortOrder(拖动排序落盘)。 */
export function reorderGroups(
  groups: readonly AccountGroup[],
  orderedIds: readonly string[],
): readonly AccountGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const at = new Date().toISOString();
  const next: AccountGroup[] = [];
  orderedIds.forEach((id, index) => {
    const g = byId.get(id);
    if (g) next.push({ ...g, sortOrder: index, updatedAt: at });
  });
  // 未出现在 orderedIds 的分组补在后面(不丢数据)。
  for (const g of groups) {
    if (!orderedIds.includes(g.id)) next.push(g);
  }
  return next;
}

/** 分组存储(版本化)。 */
export interface AccountGroupStore {
  readonly schemaVersion: number;
  list(): Promise<readonly AccountGroup[]>;
  get(id: string): Promise<AccountGroup | undefined>;
  put(group: AccountGroup): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 把账号加入分组(去重)。 */
export function addMember(group: AccountGroup, accountId: string): AccountGroup {
  if (group.memberIds.includes(accountId)) return group;
  return { ...group, memberIds: [...group.memberIds, accountId], updatedAt: new Date().toISOString() };
}

/** 从分组移除账号。 */
export function removeMember(group: AccountGroup, accountId: string): AccountGroup {
  if (!group.memberIds.includes(accountId)) return group;
  return { ...group, memberIds: group.memberIds.filter((id) => id !== accountId), updatedAt: new Date().toISOString() };
}

/** 分组内的账号表现(聚合近期效果数据)。 */
export interface GroupAccountSnapshot {
  readonly accountId: string;
  readonly name: string;
  readonly platformId: string;
  readonly status: "enabled" | "disabled";
  /** 最近一次连接成功的账号昵称(若有)。 */
  readonly lastAccountName?: string;
  /** 粉丝数(来自 lastAccountName 关联?实际粉丝数需平台 API,此处用效果聚合的近似值)。 */
  readonly followers?: number;
  /** 近期表现聚合。 */
  readonly performance?: {
    readonly records: number;
    readonly totalViews: number;
    readonly totalLikes: number;
  };
}

/** 分组合计视图。 */
export interface GroupSummary {
  readonly group: AccountGroup;
  readonly memberCount: number;
  readonly enabledCount: number;
  readonly accounts: readonly GroupAccountSnapshot[];
  /** 分组整体表现(来自成员效果记录)。 */
  readonly performance: {
    readonly records: number;
    readonly totalViews: number;
    readonly totalLikes: number;
    readonly bestPlatform?: string;
  };
}

/** 构建分组内账号快照。 */
export function buildGroupSnapshot(
  group: AccountGroup,
  accounts: readonly AccountProfile[],
  records: readonly PerformanceRecord[],
): GroupSummary {
  const members = accounts.filter((a) => group.memberIds.includes(a.id));
  const snapshots: GroupAccountSnapshot[] = members.map((a) => {
    const accRecords = records.filter((r) => r.platformId === a.platformId);
    const totalViews = accRecords.reduce((s, r) => s + (r.metrics.views ?? 0), 0);
    const totalLikes = accRecords.reduce((s, r) => s + (r.metrics.likes ?? 0), 0);
    return {
      accountId: a.id,
      name: a.name,
      platformId: a.platformId,
      status: a.status,
      ...(a.lastAccountName ? { lastAccountName: a.lastAccountName } : {}),
      ...(accRecords.length > 0
        ? { performance: { records: accRecords.length, totalViews, totalLikes } }
        : {}),
    };
  });

  const totalViews = snapshots.reduce((s, a) => s + (a.performance?.totalViews ?? 0), 0);
  const totalLikes = snapshots.reduce((s, a) => s + (a.performance?.totalLikes ?? 0), 0);
  const bestPlatform = [...new Set(snapshots.map((a) => a.platformId))].sort(
    (a, b) =>
      records.filter((r) => r.platformId === b).reduce((s, r) => s + (r.metrics.views ?? 0), 0) -
      records.filter((r) => r.platformId === a).reduce((s, r) => s + (r.metrics.views ?? 0), 0),
  )[0];

  return {
    group,
    memberCount: members.length,
    enabledCount: members.filter((a) => a.status === "enabled").length,
    accounts: snapshots,
    performance: {
      records: snapshots.reduce((s, a) => s + (a.performance?.records ?? 0), 0),
      totalViews,
      totalLikes,
      ...(bestPlatform ? { bestPlatform } : {}),
    },
  };
}

/** 按业务线/品牌聚合所有分组的矩阵总览(按 sortOrder 排序展示)。 */
export function buildGroupMatrix(
  groups: readonly AccountGroup[],
  accounts: readonly AccountProfile[],
  records: readonly PerformanceRecord[],
): readonly GroupSummary[] {
  return sortGroups(groups).map((g) => buildGroupSnapshot(g, accounts, records));
}

/** 校验分组 schema。 */
export function assertAccountGroup(value: unknown): value is AccountGroup {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.memberIds) &&
    v.memberIds.every((m) => typeof m === "string")
  );
}
