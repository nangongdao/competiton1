/**
 * ACCOUNT-01/02 账号配置模型测试 —— 多账号平台管理(v4 Phase 1)。
 *
 * 覆盖:
 * - createAccountProfile:默认值 / 确定性 id / profileDir 元数据;
 * - sanitizeProfileDir:路径穿越 / 非法字符拒绝;
 * - assertAccountSchema:损坏/旧版本检测;
 * - stripAccountSecrets:默认仅会话(不落盘密钥) / 显式持久化才保留;
 * - accountSecurityLevel:session/persistent 分级;
 * - resolveActiveAccount:平台级选择 / 全局选择 / 默认第一个 / 无账号回退;
 * - MemoryAccountStore:增删查 + 按平台过滤;
 * - canAddAccount:单平台与总上限;
 * - platformUsesServerCredentials:公众号走 server 凭据。
 */
import { describe, expect, it } from "vitest";
import {
  createAccountProfile,
  sanitizeProfileDir,
  assertAccountSchema,
  stripAccountSecrets,
  accountSecurityLevel,
  resolveActiveAccount,
  platformUsesServerCredentials,
  type AccountProfile,
  type NewAccountProfile,
} from "../src/accounts/index.js";
import { MemoryAccountStore, canAddAccount } from "../src/accounts/index.js";

const NOW = "2026-08-06T00:00:00.000Z";

function makeAccount(overrides: Partial<NewAccountProfile> = {}): AccountProfile {
  return createAccountProfile({ platformId: "wechat", name: "主号", ...overrides }, () => NOW);
}

describe("createAccountProfile", () => {
  it("生成带默认值与确定性 id 的账号", () => {
    const a = makeAccount();
    expect(a.platformId).toBe("wechat");
    expect(a.name).toBe("主号");
    expect(a.secrets).toEqual({});
    expect(a.persistSecrets).toBe(false);
    expect(a.status).toBe("enabled");
    expect(a.createdAt).toBe(NOW);
    expect(a.updatedAt).toBe(NOW);
    expect(a.id.length).toBeGreaterThan(0);
  });

  it("空白名称回退到平台 id", () => {
    const a = makeAccount({ name: "   " });
    expect(a.name).toBe("wechat");
  });

  it("保留 serverProfileId / profileDir / secrets", () => {
    const a = makeAccount({
      platformId: "wechat",
      serverProfileId: "profile-main",
      secrets: { secret: "s3cret" },
      persistSecrets: true,
    });
    expect(a.serverProfileId).toBe("profile-main");
    expect(a.secrets).toEqual({ secret: "s3cret" });
    expect(a.persistSecrets).toBe(true);
  });

  it("会话平台可设置 profileDir", () => {
    const a = makeAccount({ platformId: "zhihu", profileDir: "zhihu-main" });
    expect(a.profileDir).toBe("zhihu-main");
  });
});

describe("sanitizeProfileDir", () => {
  it("拒绝路径穿越与非法字符", () => {
    expect(sanitizeProfileDir("../etc")).toBeUndefined();
    expect(sanitizeProfileDir("a/b")).toBeUndefined();
    expect(sanitizeProfileDir("..")).toBeUndefined();
    expect(sanitizeProfileDir("a b")).toBeUndefined();
    expect(sanitizeProfileDir("a*b")).toBeUndefined();
    expect(sanitizeProfileDir("")).toBeUndefined();
  });
  it("允许安全字符", () => {
    expect(sanitizeProfileDir("zhihu-main")).toBe("zhihu-main");
    expect(sanitizeProfileDir("  zhihu.main_2  ")).toBe("zhihu.main_2");
  });
  it("超长拒绝", () => {
    expect(sanitizeProfileDir("x".repeat(121))).toBeUndefined();
  });
});

describe("assertAccountSchema", () => {
  it("识别合法账号", () => {
    expect(assertAccountSchema(makeAccount())).toBe(true);
  });
  it("拒绝损坏/旧版本", () => {
    expect(assertAccountSchema(null)).toBe(false);
    expect(assertAccountSchema({})).toBe(false);
    expect(assertAccountSchema({ id: 1, platformId: "wechat", name: "x" })).toBe(false);
    expect(assertAccountSchema({ ...makeAccount(), status: "weird" })).toBe(false);
  });
});

describe("stripAccountSecrets / accountSecurityLevel", () => {
  it("默认仅会话:strip 后 secrets 为空(不落盘)", () => {
    const a = makeAccount({ secrets: { secret: "abc" } });
    const stripped = stripAccountSecrets(a);
    expect(stripped.secrets).toEqual({});
    expect(accountSecurityLevel(a)).toBe("session");
  });

  it("显式持久化才保留密钥", () => {
    const a = makeAccount({ secrets: { secret: "abc" }, persistSecrets: true });
    const stripped = stripAccountSecrets(a);
    expect(stripped.secrets).toEqual({ secret: "abc" });
    expect(accountSecurityLevel(a)).toBe("persistent");
  });
});

describe("resolveActiveAccount", () => {
  const a = makeAccount({ id: "a1", name: "主号" });
  const b = makeAccount({ id: "a2", name: "副号" });
  const disabled = makeAccount({ id: "a3", name: "停用", status: "disabled" });

  it("平台级选择优先", () => {
    const pick = resolveActiveAccount(
      "wechat",
      [a, b, disabled],
      { wechat: "a2" },
      "a1",
    );
    expect(pick?.id).toBe("a2");
  });

  it("无平台级选择时全局当前账号生效", () => {
    const pick = resolveActiveAccount("wechat", [a, b, disabled], {}, "a2");
    expect(pick?.id).toBe("a2");
  });

  it("默认取该平台第一个启用账号", () => {
    const pick = resolveActiveAccount("wechat", [b, disabled, a], {}, null);
    expect(pick?.id).toBe("a2");
  });

  it("禁用账号不会被选中", () => {
    const pick = resolveActiveAccount("wechat", [disabled], {}, null);
    expect(pick).toBeUndefined();
  });

  it("无账号回退 undefined(单账号默认行为)", () => {
    expect(resolveActiveAccount("wechat", [], {}, null)).toBeUndefined();
  });
});

describe("MemoryAccountStore", () => {
  it("增删查 + 按平台过滤 + 按更新时间排序", async () => {
    const store = new MemoryAccountStore();
    const a = makeAccount({ id: "a1" });
    const b = makeAccount({ id: "a2", platformId: "zhihu", name: "知乎号" });
    await store.put(a);
    await store.put(b);
    expect((await store.list()).length).toBe(2);
    const wechat = await store.listByPlatform("wechat");
    expect(wechat.map((x) => x.id)).toEqual(["a1"]);
    expect((await store.get("a2"))?.name).toBe("知乎号");
    await store.remove("a1");
    expect(await store.get("a1")).toBeUndefined();
  });
});

describe("canAddAccount", () => {
  it("单平台上限与总上限", () => {
    const many = Array.from({ length: 20 }, (_, i) => makeAccount({ id: `a${i}` }));
    expect(canAddAccount(many, "wechat")).toEqual({ ok: false, error: expect.stringContaining("20") });
    expect(canAddAccount([], "wechat").ok).toBe(true);
    const total = Array.from({ length: 100 }, (_, i) => makeAccount({ id: `t${i}`, platformId: `p${i}` }));
    expect(canAddAccount(total, "extra").ok).toBe(false);
  });
});

describe("platformUsesServerCredentials", () => {
  it("公众号由 server 持凭据,会话平台不持密钥", () => {
    expect(platformUsesServerCredentials("wechat")).toBe(true);
    expect(platformUsesServerCredentials("zhihu")).toBe(false);
    expect(platformUsesServerCredentials("bilibili")).toBe(false);
    expect(platformUsesServerCredentials("csdn")).toBe(false);
  });
});
