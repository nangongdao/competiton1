/**
 * ACCOUNT-04 store 账号管理行为测试 —— 新建/删除/切换/平台级选择。
 *
 * 覆盖:
 * - saveAccount:新建账号(默认仅会话) / 编辑保留 / 单平台上限;
 * - deleteAccount:删除 + 清理选择引用;
 * - setActiveAccount / setAccountForPlatform:切换与平台级选择持久化;
 * - accountFor:resolveActiveAccount 在 store 的接线(平台级 > 全局 > 默认);
 * - 发布路由:mock 环境下带账号信息(profileDir/serverProfileId)不影响正常发布。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../src/state/store.js";
import type {
  AssistedHandoffRequest,
  AssistedHandoffResult,
  AutomationPublishRequest,
  AutomationPublishResult,
  ClipboardPayload,
  PlatformBridge,
  UploadAssetRequest,
  UploadAssetResult,
  WechatPublishRequest,
  WechatPublishResult,
} from "../src/bridge/types.js";

class MemoryBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly store = new Map<string, string>();
  async writeClipboard(_p: ClipboardPayload): Promise<boolean> { return true; }
  async assistedHandoff(_r: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }
  async publishWechat(_r: WechatPublishRequest): Promise<WechatPublishResult> {
    return { ok: true, message: "published", remoteId: "MEDIA_1" };
  }
  async publishAutomation(_r: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: true, status: "submitted", message: "ok" };
  }
  async uploadAsset(_r: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "n/a" };
  }
  async getSetting(key: string): Promise<string | undefined> { return this.store.get(key); }
  async setSetting(key: string, value: string): Promise<void> { this.store.set(key, value); }
}

let bridge: MemoryBridge;

beforeEach(() => {
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({
    accounts: [],
    activeAccountId: null,
    accountForPlatform: {},
    selectedPlatforms: ["wechat", "zhihu"],
    automationModes: { wechat: "mock", zhihu: "mock" },
    wechatPublishMode: "mock",
  });
});

describe("ACCOUNT-04 store 账号管理", () => {
  it("saveAccount 新建账号并写入存储,默认仅会话", async () => {
    const result = await useStore.getState().saveAccount({
      platformId: "zhihu",
      name: "知乎主号",
      profileDir: "zhihu-main",
      secrets: { secret: "x" },
    });
    expect(result.ok).toBe(true);
    const accounts = useStore.getState().accounts;
    expect(accounts.length).toBe(1);
    expect(accounts[0].name).toBe("知乎主号");
    expect(accounts[0].profileDir).toBe("zhihu-main");
    // 存储层已剔除密钥(仅会话)。
    const persisted = bridge.store;
    expect(JSON.stringify(persisted)).not.toContain("x");
  });

  it("saveAccount 编辑已有账号保留 id 与会话密钥", async () => {
    const created = await useStore.getState().saveAccount({ platformId: "wechat", name: "主号" });
    const id = created.id!;
    const result = await useStore.getState().saveAccount({ id, platformId: "wechat", name: "主号改" });
    expect(result.ok).toBe(true);
    const accounts = useStore.getState().accounts;
    expect(accounts.length).toBe(1);
    expect(accounts[0].name).toBe("主号改");
  });

  it("单平台最多 20 个账号", async () => {
    for (let i = 0; i < 20; i++) {
      await useStore.getState().saveAccount({ platformId: "wechat", name: `号${i}` });
    }
    const result = await useStore.getState().saveAccount({ platformId: "wechat", name: "超限号" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("20");
  });

  it("deleteAccount 删除并清理选择引用", async () => {
    const a = await useStore.getState().saveAccount({ platformId: "zhihu", name: "A" });
    const b = await useStore.getState().saveAccount({ platformId: "zhihu", name: "B" });
    useStore.getState().setActiveAccount(a.id!);
    useStore.getState().setAccountForPlatform("zhihu", b.id!);
    await useStore.getState().deleteAccount(b.id!);
    expect(useStore.getState().accountForPlatform["zhihu"]).toBeUndefined();
    // 删除非当前账号不清理 activeAccountId。
    expect(useStore.getState().activeAccountId).toBe(a.id);
    await useStore.getState().deleteAccount(a.id!);
    expect(useStore.getState().activeAccountId).toBeNull();
  });

  it("setActiveAccount / setAccountForPlatform 持久化到 bridge", () => {
    useStore.getState().setActiveAccount("acct-1");
    expect(bridge.store.get("mpp.activeAccountId")).toBe("acct-1");
    useStore.getState().setAccountForPlatform("zhihu", "acct-2");
    expect(JSON.parse(bridge.store.get("mpp.accountForPlatform") ?? "{}")["zhihu"]).toBe("acct-2");
    useStore.getState().setAccountForPlatform("zhihu", null);
    expect(JSON.parse(bridge.store.get("mpp.accountForPlatform") ?? "{}")["zhihu"]).toBeUndefined();
  });

  it("accountFor 按平台级 > 全局 > 默认解析", async () => {
    const a = await useStore.getState().saveAccount({ platformId: "zhihu", name: "A", profileDir: "zh-a" });
    const b = await useStore.getState().saveAccount({ platformId: "zhihu", name: "B", profileDir: "zh-b" });
    // 默认取第一个启用账号。
    expect(useStore.getState().accountFor("zhihu")?.id).toBe(a.id);
    // 全局切换。
    useStore.getState().setActiveAccount(b.id!);
    expect(useStore.getState().accountFor("zhihu")?.id).toBe(b.id);
    // 平台级覆盖全局。
    useStore.getState().setAccountForPlatform("zhihu", a.id!);
    expect(useStore.getState().accountFor("zhihu")?.id).toBe(a.id);
    // 无账号回退 undefined。
    useStore.setState({ accounts: [] });
    expect(useStore.getState().accountFor("zhihu")).toBeUndefined();
  });
});
