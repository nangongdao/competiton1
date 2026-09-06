/**
 * ACCOUNT-01 内存账号存储 —— 默认/测试实现。
 *
 * 与 JOB-02 / FLOW-03 的 MemoryStore 同构:存储层只做"读写 + 版本化 + 保留上限",
 * 不掺业务逻辑。应用侧 IndexedDB / chrome.storage 可实现同一接口
 * (app/src/storage/account-store.ts)。
 */
import type { AccountProfile, AccountStore } from "./types.js";
import { ACCOUNTS_PER_PLATFORM_MAX, ACCOUNTS_TOTAL_MAX, assertAccountSchema } from "./types.js";

/** 内存实现(默认/测试用)。 */
export class MemoryAccountStore implements AccountStore {
  readonly schemaVersion = 1;
  private readonly accounts = new Map<string, AccountProfile>();

  async list(): Promise<readonly AccountProfile[]> {
    return [...this.accounts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listByPlatform(platformId: string): Promise<readonly AccountProfile[]> {
    return (await this.list()).filter((a) => a.platformId === platformId);
  }
  async get(id: string): Promise<AccountProfile | undefined> {
    return this.accounts.get(id);
  }
  async put(profile: AccountProfile): Promise<void> {
    this.accounts.set(profile.id, profile);
  }
  async remove(id: string): Promise<void> {
    this.accounts.delete(id);
  }
}

/** 校验单个账号记录,损坏/版本不符返回明确错误(不静默丢弃)。 */
export function parseAccountRecord(value: unknown): { ok: true; profile: AccountProfile } | { ok: false; error: string } {
  if (!assertAccountSchema(value)) {
    return { ok: false, error: "账号记录不符合 schema(可能损坏或来自旧版本)" };
  }
  return { ok: true, profile: value };
}

/** 单平台账号数量上限校验(创建/导入时使用)。 */
export function canAddAccount(
  accounts: readonly AccountProfile[],
  platformId: string,
): { ok: true } | { ok: false; error: string } {
  const byPlatform = accounts.filter((a) => a.platformId === platformId).length;
  if (byPlatform >= ACCOUNTS_PER_PLATFORM_MAX) {
    return { ok: false, error: `单平台最多保存 ${ACCOUNTS_PER_PLATFORM_MAX} 个账号` };
  }
  if (accounts.length >= ACCOUNTS_TOTAL_MAX) {
    return { ok: false, error: `账号总数已达上限 ${ACCOUNTS_TOTAL_MAX}` };
  }
  return { ok: true };
}

export { ACCOUNTS_PER_PLATFORM_MAX, ACCOUNTS_TOTAL_MAX } from "./types.js";
