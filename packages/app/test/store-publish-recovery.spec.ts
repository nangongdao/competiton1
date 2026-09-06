/**
 * publishAll 错误恢复测试(REL-03):任一 bridge 抛错后 busy 状态必须复位,UI 可继续重试。
 */
import { beforeEach, describe, expect, test } from "vitest";
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

class ThrowingBridge implements PlatformBridge {
  readonly env = "web" as const;

  async writeClipboard(_payload: ClipboardPayload): Promise<boolean> {
    return true;
  }

  async assistedHandoff(_req: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }

  async publishWechat(_req: WechatPublishRequest): Promise<WechatPublishResult> {
    throw new Error("server 不可达");
  }

  async publishAutomation(_req: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: false, status: "failed", message: "not used" };
  }

  async uploadAsset(_req: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "not used" };
  }

  async getSetting(_key: string): Promise<string | undefined> {
    return undefined;
  }

  async setSetting(_key: string, _value: string): Promise<void> {
    return undefined;
  }
}

describe("store publishAll — 异常恢复", () => {
  beforeEach(() => {
    useStore.setState({
      markdown: "# 标题\n\n正文内容。",
      authorName: "作者",
      tags: [],
      selectedPlatforms: ["wechat"],
      results: [],
      receipts: {},
      publishing: false,
      bridge: null,
      serverUrl: "http://127.0.0.1:8787",
      runnerUrl: "http://127.0.0.1:8790",
      serverToken: "server-token",
      runnerToken: "runner-token",
      uploadedAssets: {},
      llm: { baseUrl: "", apiKey: "", model: "" },
      enhance: {},
      wechatPublishMode: "publish",
      automationModes: {},
      drafts: [],
      currentDraftId: null,
      history: [],
    } as Partial<ReturnType<typeof useStore.getState>>);
  });

  test("bridge 抛错后 publishing 状态复位为 false", async () => {
    const bridge = new ThrowingBridge();
    useStore.setState({ bridge } as Partial<ReturnType<typeof useStore.getState>>);

    // 发布过程中 bridge.publishWechat 抛错,publishAll 不应让 UI 永久 loading。
    await useStore.getState().publishAll();
    expect(useStore.getState().publishing).toBe(false);
  });

  test("bridge 抛错后仍保留各平台结果(不丢失预览)", async () => {
    const bridge = new ThrowingBridge();
    useStore.setState({ bridge } as Partial<ReturnType<typeof useStore.getState>>);

    await useStore.getState().publishAll();
    // 即使发布环节抛错,results 仍包含 wechat 的 stage 结果(预览不丢失)。
    const results = useStore.getState().results;
    expect(results.some((r) => r.platformId === "wechat")).toBe(true);
    expect(useStore.getState().publishing).toBe(false);
  });
});
