/**
 * SEC-04 —— LLM key 默认仅会话保存测试。
 *
 * 验证:
 * - 默认 persistLlmKey=false 时,setLlm 不把 apiKey 写入持久化设置(mpp.llm),
 *   key 只进 sessionStorage(sessionStorage 不可用时仅内存)。
 * - 显式开启持久化后,key 写入持久化设置,会话缓存清空。
 * - 关闭持久化时,key 从持久化设置移除,回落到会话缓存。
 * - clearLlmKey 一键清除内存/持久化/会话三处 key。
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

/** Node 测试环境无 sessionStorage,用内存 Map 模拟。 */
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

/** 记录 setSetting 写入的存储桥(模拟 localStorage/chrome.storage)。 */
class MemoryBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly store = new Map<string, string>();

  async writeClipboard(_payload: ClipboardPayload): Promise<boolean> {
    return true;
  }

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

  async getSetting(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function resetState() {
  useStore.setState({
    llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
    persistLlmKey: false,
  } as Partial<ReturnType<typeof useStore.getState>>);
}

describe("SEC-04 LLM key 会话保存策略", () => {
  let bridge: MemoryBridge;

  beforeEach(() => {
    bridge = new MemoryBridge();
    useStore.setState({ bridge } as Partial<ReturnType<typeof useStore.getState>>);
    resetState();
    mockSessionStorage();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  test("默认不持久化:key 不进持久化设置,只进会话缓存", () => {
    useStore.getState().setLlm({ apiKey: "sk-session-only" });

    // 持久化设置中不含 key。
    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey ?? "").toBe("");
    expect(persisted.baseUrl).toBe("https://api.deepseek.com/v1");

    // key 落在 sessionStorage。
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("sk-session-only");
    // 内存中有 key(llmReady 可用)。
    expect(useStore.getState().llm.apiKey).toBe("sk-session-only");
  });

  test("开启持久化后 key 落盘,会话缓存清空", () => {
    useStore.getState().setLlm({ apiKey: "sk-persist-me" });
    useStore.getState().setPersistLlmKey(true);

    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey).toBe("sk-persist-me");
    expect(bridge.store.get("mpp.persistLlmKey")).toBe("1");
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(useStore.getState().persistLlmKey).toBe(true);
  });

  test("关闭持久化:key 从磁盘移除,回落到会话缓存", () => {
    useStore.getState().setLlm({ apiKey: "sk-persist-me" });
    useStore.getState().setPersistLlmKey(true);
    useStore.getState().setPersistLlmKey(false);

    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey ?? "").toBe("");
    expect(bridge.store.get("mpp.persistLlmKey")).toBe("0");
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("sk-persist-me");
    expect(useStore.getState().persistLlmKey).toBe(false);
  });

  test("clearLlmKey 一键清除内存/持久化/会话三处 key", () => {
    useStore.getState().setLlm({ apiKey: "sk-clear-me" });
    useStore.getState().setPersistLlmKey(true);
    expect(bridge.store.get("mpp.llm") ?? "").toContain("sk-clear-me");

    useStore.getState().clearLlmKey();

    expect(useStore.getState().llm.apiKey).toBe("");
    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey ?? "").toBe("");
    expect(bridge.store.get("mpp.persistLlmKey")).toBe("0");
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(useStore.getState().persistLlmKey).toBe(false);
  });

  test("持久化开启状态下继续 setLlm 仍写入 key", () => {
    useStore.getState().setPersistLlmKey(true);
    useStore.getState().setLlm({ apiKey: "sk-while-persist" });

    const persisted = JSON.parse(bridge.store.get("mpp.llm") ?? "{}") as Record<string, string>;
    expect(persisted.apiKey).toBe("sk-while-persist");
    // 会话缓存不应再出现 key。
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
