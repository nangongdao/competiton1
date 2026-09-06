/**
 * ROADMAP_V5 Phase 3 · 资产库 store 行为测试。
 *
 * 覆盖:
 * - loadAssetLibrary:从存储加载资产记录;
 * - rebuildAssetIndex:从草稿 / 队列 / 批次增量构建索引(封面/图床/产物);
 * - searchAssets:本地检索;
 * - addAsset / removeAsset:手动录入与删除。
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
    assetLibrary: [],
    assetLibraryReady: false,
    lastAssetIndex: null,
    drafts: [],
    publishQueue: [],
    publishBatches: [],
  });
});

const SAMPLE_MD = `# 测试文章

![图A](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

![图B](https://img.example.com/cover.png)
`;

function draft(id: string, title: string, markdown: string) {
  return { id, title, markdown, authorName: "作者", tags: [], updatedAt: new Date().toISOString() };
}

describe("资产库 store", () => {
  it("loadAssetLibrary 从空存储加载为空", async () => {
    await useStore.getState().loadAssetLibrary();
    expect(useStore.getState().assetLibrary).toEqual([]);
    expect(useStore.getState().assetLibraryReady).toBe(true);
  });

  it("rebuildAssetIndex 从草稿构建封面与图床索引", async () => {
    useStore.setState({ drafts: [draft("d1", "测试文章", SAMPLE_MD)] });
    const result = await useStore.getState().rebuildAssetIndex();
    expect(result.ok).toBe(true);
    const lib = useStore.getState().assetLibrary;
    // 封面 1 条 + 图床 2 条(dataURL 短哈希 + 外链)。
    expect(lib.filter((r) => r.kind === "cover").length).toBe(1);
    expect(lib.filter((r) => r.kind === "rehost").length).toBe(2);
    expect(useStore.getState().lastAssetIndex?.added).toBeGreaterThan(0);
  });

  it("rebuildAssetIndex 重复构建幂等(不再新增)", async () => {
    useStore.setState({ drafts: [draft("d1", "测试文章", SAMPLE_MD)] });
    await useStore.getState().rebuildAssetIndex();
    const before = useStore.getState().assetLibrary.length;
    await useStore.getState().rebuildAssetIndex();
    expect(useStore.getState().assetLibrary.length).toBe(before);
    expect(useStore.getState().lastAssetIndex?.added).toBe(0);
  });

  it("searchAssets 本地检索命中标题与平台", async () => {
    useStore.setState({ drafts: [draft("d1", "AI 写作指南", SAMPLE_MD)] });
    await useStore.getState().rebuildAssetIndex();
    const hits = useStore.getState().searchAssets("写作");
    expect(hits.length).toBeGreaterThan(0);
    // 按类型过滤。
    const rehostOnly = useStore.getState().searchAssets("", "rehost");
    expect(rehostOnly.length).toBe(2);
  });

  it("addAsset 手动录入 + removeAsset 删除", async () => {
    const add = await useStore.getState().addAsset({
      kind: "rehost",
      title: "外链封面",
      platformId: "wechat",
      reference: "https://img.example.com/manual.png",
    });
    expect(add.ok).toBe(true);
    expect(useStore.getState().assetLibrary.length).toBe(1);
    const record = useStore.getState().assetLibrary[0]!;
    expect(record.kind).toBe("rehost");
    expect(record.source.from).toBe("manual");

    await useStore.getState().removeAsset(record.id);
    expect(useStore.getState().assetLibrary.length).toBe(0);
  });
});
