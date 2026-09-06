/**
 * AI 连接中心 —— store 多配置管理测试(Roadmap v2)。
 *
 * 验证:
 * - saveLlmConfig 新增配置并设为当前,同步全局 llm,持久化剔除 apiKey;
 * - 编辑已有配置不新增;
 * - 切换配置全局 llm 同步;
 * - 删除配置移除列表,删除当前配置回退空 llm;
 * - 预设应用创建配置;
 * - apiKey 遵循 SEC-04:默认不落盘,仅会话缓存。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

const SESSION_KEY = "mpp.llm.sessionApiKey";

const sessionMap = new Map<string, string>();
function mockSessionStorage() {
  const storage = {
    getItem: (k: string) => sessionMap.get(k) ?? null,
    setItem: (k: string, v: string) => void sessionMap.set(k, v),
    removeItem: (k: string) => void sessionMap.delete(k),
    clear: () => sessionMap.clear(),
  };
  vi.stubGlobal("sessionStorage", storage);
}

class MemoryBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly store = new Map<string, string>();
  async writeClipboard(_payload: ClipboardPayload): Promise<boolean> { return true; }
  async assistedHandoff(_req: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }
  async publishWechat(_req: WechatPublishRequest): Promise<WechatPublishResult> {
    return { ok: false, message: "not used" };
  }
  async publishAutomation(_req: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: false, status: "failed", message: "not used" };
  }
  async uploadAsset(_req: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "not used" };
  }
  async getSetting(key: string) { return this.store.get(key); }
  async setSetting(key: string, value: string) { this.store.set(key, value); }
}

let bridge: MemoryBridge;

beforeEach(() => {
  sessionMap.clear();
  mockSessionStorage();
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({
    llmConfigs: [],
    activeLlmConfigId: null,
    llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
    persistLlmKey: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI 连接中心 store — 多配置管理", () => {
  test("saveLlmConfig 新增配置并设为当前,持久化不含 apiKey", () => {
    const id = useStore.getState().saveLlmConfig({
      name: "我的 DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-abc",
      model: "deepseek-chat",
    });
    const state = useStore.getState();
    expect(state.llmConfigs.length).toBe(1);
    expect(state.llmConfigs[0].id).toBe(id);
    expect(state.activeLlmConfigId).toBe(id);
    // 全局 llm 同步。
    expect(state.llm.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(state.llm.apiKey).toBe("sk-abc");
    // 持久化剔除 key。
    const persisted = JSON.parse(bridge.store.get("mpp.llmConfigs") ?? "[]") as Array<Record<string, unknown>>;
    expect(persisted.length).toBe(1);
    expect(persisted[0].apiKey).toBeUndefined();
    // 会话缓存保存 key(SEC-04)。
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("sk-abc");
  });

  test("编辑已有配置不新增,且 apiKey 未填时保留原 key", () => {
    const id = useStore.getState().saveLlmConfig({
      name: "A", baseUrl: "https://api.a.com/v1", apiKey: "ka", model: "ma",
    });
    useStore.getState().saveLlmConfig({ id, name: "A 改", baseUrl: "https://api.a2.com/v1", model: "ma2" });
    const state = useStore.getState();
    expect(state.llmConfigs.length).toBe(1);
    expect(state.llmConfigs[0].name).toBe("A 改");
    expect(state.llmConfigs[0].baseUrl).toBe("https://api.a2.com/v1");
    expect(state.llmConfigs[0].apiKey).toBe("ka"); // 保留原 key
    expect(state.llm.baseUrl).toBe("https://api.a2.com/v1");
  });

  test("切换配置 → 全局 llm 同步", () => {
    useStore.getState().saveLlmConfig({ name: "A", baseUrl: "https://api.a.com/v1", apiKey: "ka", model: "ma" });
    const bId = useStore.getState().saveLlmConfig({ name: "B", baseUrl: "https://api.b.com/v1", apiKey: "kb", model: "mb" });
    useStore.getState().activateLlmConfig(useStore.getState().llmConfigs[0].id);
    const state = useStore.getState();
    expect(state.activeLlmConfigId).not.toBe(bId);
    expect(state.llm.baseUrl).toBe("https://api.a.com/v1");
    expect(state.llm.apiKey).toBe("ka");
    // 持久化标记当前生效。
    expect(bridge.store.get("mpp.activeLlmConfigId")).toBe(state.llmConfigs[0].id);
  });

  test("删除配置移除列表;删除当前配置回退空 llm", () => {
    const id = useStore.getState().saveLlmConfig({ name: "D", baseUrl: "https://api.d.com/v1", apiKey: "kd", model: "md" });
    useStore.getState().deleteLlmConfig(id);
    const state = useStore.getState();
    expect(state.llmConfigs.length).toBe(0);
    expect(state.llm.apiKey).toBe("");
    expect(state.activeLlmConfigId).toBeNull();
  });

  test("删除非当前配置不影响当前 llm", () => {
    useStore.getState().saveLlmConfig({ name: "A", baseUrl: "https://api.a.com/v1", apiKey: "ka", model: "ma" });
    const bId = useStore.getState().saveLlmConfig({ name: "B", baseUrl: "https://api.b.com/v1", apiKey: "kb", model: "mb" });
    useStore.getState().deleteLlmConfig(useStore.getState().llmConfigs[0].id); // 删 A(非当前)
    const state = useStore.getState();
    expect(state.llmConfigs.length).toBe(1);
    expect(state.activeLlmConfigId).toBe(bId);
    expect(state.llm.baseUrl).toBe("https://api.b.com/v1");
  });

  test("applyLlmPreset 创建预设配置并设为当前", () => {
    useStore.getState().applyLlmPreset("deepseek");
    const state = useStore.getState();
    expect(state.llmConfigs.length).toBe(1);
    expect(state.llmConfigs[0].presetId).toBe("deepseek");
    expect(state.llmConfigs[0].baseUrl).toBe("https://api.deepseek.com/v1");
    expect(state.activeLlmConfigId).toBe(state.llmConfigs[0].id);
    expect(state.llm.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  test("默认不持久化 key:saveLlmConfig 后 mpp.llm 不含 key", () => {
    useStore.getState().saveLlmConfig({ name: "X", baseUrl: "https://api.x.com/v1", apiKey: "sk-x", model: "mx" });
    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey ?? "").toBe("");
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("sk-x");
  });

  test("开启持久化后 saveLlmConfig 的 key 落盘", () => {
    useStore.getState().setPersistLlmKey(true);
    useStore.getState().saveLlmConfig({ name: "P", baseUrl: "https://api.p.com/v1", apiKey: "sk-p", model: "mp" });
    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey).toBe("sk-p");
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
