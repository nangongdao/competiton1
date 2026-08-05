/**
 * 应用状态(zustand)。
 *
 * 单向数据流:markdown 输入 → 解析为 IR → 对所选平台 syncToPlatforms(stageOnly)→ 结果。
 * 发布动作单独触发(confirm)。bridge 通过 setBridge 注入(web/扩展不同实现)。
 */
import { create } from "zustand";
import {
  type AssetTable,
  markdownToIR,
  syncToPlatforms,
  listAdapters,
  OpenAiCompatLlm,
  type PlatformResult,
  type RehostContext,
  type EnhanceOptions,
  type SerializedPayload,
} from "@mpp/core";
import type { AutomationPublishMode, PlatformBridge } from "../bridge/types.js";
import { createDraftStore, type Draft, type DraftStore, type HistoryEntry } from "../storage/draft-store.js";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type WechatPublishMode = "mock" | "draft" | "publish";
export type PlatformAutomationModes = Record<string, AutomationPublishMode>;

export interface AppState {
  markdown: string;
  authorName: string;
  tags: string[];
  selectedPlatforms: string[];
  results: PlatformResult[];
  publishing: boolean;
  receipts: Record<string, string>;
  bridge: PlatformBridge | null;
  /** server 地址(图片上传/公众号发布用)。 */
  serverUrl: string;
  /** Playwright runner 地址(真实网页端自动化发布用)。 */
  runnerUrl: string;
  /** 上传图床后的 URL 映射:原始(dataURL/URL)→ 图床 URL。 */
  uploadedAssets: Record<string, string>;
  /** LLM 设置(apiKey 仅存本地)。 */
  llm: LlmSettings;
  /** 启用的 AI 增强项。 */
  enhance: EnhanceOptions;
  /** 公众号发布模式:mock=模拟,draft=创建草稿,publish=提交发布。 */
  wechatPublishMode: WechatPublishMode;
  /** 每个平台的网页自动化发布模式。 */
  automationModes: PlatformAutomationModes;
  /** 已保存草稿(按更新时间倒序)。 */
  drafts: Draft[];
  /** 当前编辑中的草稿 id(null = 尚未落库)。 */
  currentDraftId: string | null;
  /** 发布历史(最近在前)。 */
  history: HistoryEntry[];

  setBridge: (b: PlatformBridge) => void;
  setMarkdown: (md: string) => void;
  setAuthorName: (name: string) => void;
  setTags: (tags: string[]) => void;
  setServerUrl: (url: string) => void;
  setRunnerUrl: (url: string) => void;
  setLlm: (patch: Partial<LlmSettings>) => void;
  setEnhance: (patch: Partial<EnhanceOptions>) => void;
  setWechatPublishMode: (mode: WechatPublishMode) => void;
  setAutomationMode: (platformId: string, mode: AutomationPublishMode) => void;
  togglePlatform: (id: string) => void;
  /** 插入一张本地图片(以 dataURL 形式追加到 markdown)。 */
  insertLocalImage: (dataUrl: string, alt: string) => void;
  /** 是否配置了可用 LLM。 */
  llmReady: () => boolean;
  adapt: () => void;
  publishAll: () => Promise<void>;
  /** 从存储加载草稿列表与发布历史(挂载时调用)。 */
  loadDrafts: () => Promise<void>;
  /** 新建空白草稿(清空编辑区并落一条新记录)。 */
  newDraft: () => Promise<void>;
  /** 加载指定草稿到编辑区。 */
  loadDraft: (id: string) => Promise<void>;
  /** 保存当前编辑内容为草稿(无 currentDraftId 时新建)。 */
  saveDraft: () => Promise<void>;
  /** 删除草稿。 */
  deleteDraft: (id: string) => Promise<void>;
}

const DEFAULT_MD = `# 我用这款效率工具,每天省下两小时

最近发现一个时间管理方法,分享给大家。

## 三个核心方法

1. **时间块**:把一天切成若干 90 分钟专注块
2. **单任务**:每个块只做一件事
3. **复盘**:每天结束花 5 分钟记录

> 专注不是天赋,而是可以训练的能力。

参考这篇[研究报告](https://example.com/research)。

![示意图](https://images.example.com/timeblock.png)
`;

const ALL_PLATFORMS = listAdapters().map((a) => a.id);

/** 草稿存储单例:首次访问时按 bridge 环境惰性创建(web=IndexedDB / 扩展=chrome.storage)。 */
let draftStore: DraftStore | null = null;
function getDraftStore(bridge: PlatformBridge | null): DraftStore {
  if (!draftStore) draftStore = createDraftStore(bridge?.env ?? "web");
  return draftStore;
}

/** 预览更新防抖(UPGRADE §3.3):连续输入时只在停顿后触发一次适配,避免每次按键全量重算。 */
const PREVIEW_DEBOUNCE_MS = 250;
/** 适配序号:过期结果守卫,防止慢的旧请求覆盖新结果。 */
let adaptTimer: ReturnType<typeof setTimeout> | null = null;
let adaptSeq = 0;

/** 从首行 # 标题或正文首句提取草稿标题。 */
function deriveTitle(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 30) : "未命名草稿";
}

export const useStore = create<AppState>((set, get) => ({
  markdown: DEFAULT_MD,
  authorName: "效率君",
  tags: ["效率", "时间管理", "科技"],
  selectedPlatforms: [...ALL_PLATFORMS],
  results: [],
  publishing: false,
  receipts: {},
  bridge: null,
  serverUrl: "http://127.0.0.1:8787",
  runnerUrl: "http://127.0.0.1:8790",
  uploadedAssets: {},
  llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
  enhance: {},
  wechatPublishMode: "mock",
  automationModes: Object.fromEntries(ALL_PLATFORMS.map((id) => [id, "mock"])) as PlatformAutomationModes,
  drafts: [],
  currentDraftId: null,
  history: [],

  setBridge: (b) => set({ bridge: b }),
  setMarkdown: (md) => {
    set({ markdown: md });
    get().adapt();
  },
  setAuthorName: (name) => {
    set({ authorName: name });
    get().adapt();
  },
  setTags: (tags) => {
    set({ tags });
    get().adapt();
  },
  setServerUrl: (url) => {
    set({ serverUrl: url });
    void get().bridge?.setSetting("mpp.serverUrl", url);
  },
  setRunnerUrl: (url) => {
    set({ runnerUrl: url });
    void get().bridge?.setSetting("mpp.runnerUrl", url);
  },
  setLlm: (patch) => {
    const llm = { ...get().llm, ...patch };
    set({ llm });
    // apiKey 等只存本地(localStorage/chrome.storage),绝不入库。
    void get().bridge?.setSetting("mpp.llm", JSON.stringify(llm));
  },
  setEnhance: (patch) => {
    const merged = { ...get().enhance, ...patch };
    set({ enhance: merged });
    void get().bridge?.setSetting("mpp.enhance", JSON.stringify(merged));
  },
  setWechatPublishMode: (mode) => {
    set({ wechatPublishMode: mode });
    void get().bridge?.setSetting("mpp.wechatPublishMode", mode);
  },
  setAutomationMode: (platformId, mode) => {
    const automationModes = { ...get().automationModes, [platformId]: mode };
    set({ automationModes });
    void get().bridge?.setSetting("mpp.automationModes", JSON.stringify(automationModes));
  },
  llmReady: () => {
    const { baseUrl, apiKey, model } = get().llm;
    return !!baseUrl && !!apiKey && !!model;
  },
  togglePlatform: (id) => {
    const cur = get().selectedPlatforms;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ selectedPlatforms: next });
    get().adapt();
  },
  insertLocalImage: (dataUrl, alt) => {
    // 以 dataURL 形式追加图片引用,复用 md-to-ir 的图片解析与 rehost 链路。
    const md = `${get().markdown}\n\n![${alt}](${dataUrl})\n`;
    set({ markdown: md });
    get().adapt();
  },

  adapt: () => {
    // 防抖:连续编辑(敲字/改标签/切平台)只在停顿 PREVIEW_DEBOUNCE_MS 后触发一次适配。
    const seq = ++adaptSeq;
    if (adaptTimer) clearTimeout(adaptTimer);
    adaptTimer = setTimeout(() => {
      const { markdown, authorName, tags, selectedPlatforms } = get();
      const { document, assetTable } = markdownToIR(markdown, {
        meta: { authorName, tags, canonicalUrl: "https://example.com/post" },
      });
      // stageOnly:只产出暂存产物用于预览,不模拟发布。
      void syncToPlatforms(document, selectedPlatforms, {
        stageOnly: true,
        assetTable,
        now: () => new Date().toISOString(),
      }).then((results) => {
        // 过期结果守卫:只接受最新一次适配的结果,防止乱序覆盖(慢请求晚到不回写)。
        if (seq === adaptSeq) set({ results });
      });
    }, PREVIEW_DEBOUNCE_MS);
  },

  publishAll: async () => {
    const {
      markdown,
      authorName,
      tags,
      selectedPlatforms,
      bridge,
      serverUrl,
      runnerUrl,
      wechatPublishMode,
      automationModes,
    } = get();
    set({ publishing: true, receipts: {} });
    const { document, assetTable } = markdownToIR(markdown, {
      meta: { authorName, tags, canonicalUrl: "https://example.com/post" },
    });

    // 图片重托管:若有 bridge(可连 server),为每个平台构造 RehostContext,
    // 把本地/外链图上传到图床,产物 <img> 指向图床 URL。无 bridge 时跳过(保留原始引用)。
    let rehost: Record<string, RehostContext> | undefined;
    if (bridge) {
      const makeCtx = (platformId: string): RehostContext => ({
        platformId,
        upload: async (asset) => {
          const src = asset.source.dataUrl ?? asset.source.url ?? "";
          if (!src) return {};
          // 已上传过则复用。
          const cached = get().uploadedAssets[src];
          if (cached) return { url: cached };
          const decoded = await fetchAssetBytes(src);
          if (!decoded) return {};
          const result = await bridge.uploadAsset({
            serverUrl,
            bytes: decoded.bytes,
            filename: `${asset.id}.${extFromMime(decoded.mime)}`,
            mime: decoded.mime,
          });
          if (result.ok && result.url) {
            set({ uploadedAssets: { ...get().uploadedAssets, [src]: result.url } });
            return { url: result.url, mediaId: result.mediaId };
          }
          return {};
        },
      });
      rehost = Object.fromEntries(selectedPlatforms.map((id) => [id, makeCtx(id)]));
    }

    const results = await syncToPlatforms(document, selectedPlatforms, {
      now: () => new Date().toISOString(),
      rehost,
      assetTable,
      ...buildLlmOptions(get()),
    });
    if (bridge && wechatPublishMode !== "mock") {
      const idx = results.findIndex((r) => r.platformId === "wechat");
      const wechat = idx >= 0 ? results[idx] : undefined;
      if (wechat?.artifact && !wechat.report?.hasError) {
        const outcome = await bridge.publishWechat({
          serverUrl,
          payload: buildWechatPublishPayload(wechat.artifact.payload, assetTable, wechatPublishMode),
        });
        results[idx] = {
          ...wechat,
          ok: outcome.ok,
          receipt: outcome.ok
            ? {
                platformId: "wechat",
                status: wechatPublishMode === "publish" ? "submitted" : "staged",
                message: outcome.message,
                remoteId: outcome.remoteId,
                at: new Date().toISOString(),
              }
            : undefined,
          error: outcome.ok ? undefined : outcome.message,
        };
      }
    }
    if (bridge) {
      await Promise.all(
        results.map(async (result, idx) => {
          const mode = automationModes[result.platformId] ?? "mock";
          if (mode !== "draft" && mode !== "full-auto") return;
          if (!result.artifact || result.report?.hasError) return;

          const outcome = await bridge.publishAutomation({
            runnerUrl,
            platformId: result.platformId,
            mode,
            payload: result.artifact.payload,
          });
          results[idx] = {
            ...result,
            ok: outcome.ok,
            receipt: outcome.ok
              ? {
                  platformId: result.platformId,
                  status: outcome.status === "published" ? "submitted" : "staged",
                  message: outcome.message,
                  previewUrl: outcome.remoteUrl,
                  at: new Date().toISOString(),
                }
              : undefined,
            error: outcome.ok ? undefined : outcome.message,
          };
        }),
      );
    }
    const receipts: Record<string, string> = {};
    for (const r of results) {
      const failNote =
        (r.rehostFailures ?? []).length > 0 ? `(${r.rehostFailures!.length} 张图重托管失败)` : "";
      receipts[r.platformId] = (r.receipt?.message ?? r.error ?? "未发布") + failNote;
    }
    set({ results, receipts, publishing: false });

    // 记录发布历史(失败也记,便于排查)。
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      draftTitle: deriveTitle(markdown),
      at: new Date().toISOString(),
      platforms: results.map((r) => ({
        platformId: r.platformId,
        ok: !!r.receipt,
        message: r.receipt?.message ?? r.error ?? "未发布",
      })),
    };
    try {
      await getDraftStore(bridge).addHistory(entry);
      set({ history: [entry, ...get().history].slice(0, 50) });
    } catch {
      /* 历史记录失败不阻断发布 */
    }
  },

  loadDrafts: async () => {
    const store = getDraftStore(get().bridge);
    try {
      const [drafts, history] = await Promise.all([store.listDrafts(), store.listHistory()]);
      set({ drafts, history });
    } catch {
      /* 存储不可用时静默(内存仍可用) */
    }
  },

  newDraft: () => {
    set({ markdown: "", currentDraftId: null, results: [], receipts: {} });
    get().adapt();
    return Promise.resolve();
  },

  loadDraft: async (id) => {
    const draft = await getDraftStore(get().bridge).getDraft(id);
    if (!draft) return;
    set({
      markdown: draft.markdown,
      authorName: draft.authorName,
      tags: [...draft.tags],
      currentDraftId: draft.id,
      results: [],
      receipts: {},
    });
    get().adapt();
  },

  saveDraft: async () => {
    const { markdown, authorName, tags, currentDraftId } = get();
    const draft: Draft = {
      id: currentDraftId ?? crypto.randomUUID(),
      title: deriveTitle(markdown),
      markdown,
      authorName,
      tags: [...tags],
      updatedAt: new Date().toISOString(),
    };
    await getDraftStore(get().bridge).saveDraft(draft);
    const others = get().drafts.filter((d) => d.id !== draft.id);
    set({ currentDraftId: draft.id, drafts: [draft, ...others] });
  },

  deleteDraft: async (id) => {
    await getDraftStore(get().bridge).removeDraft(id);
    const drafts = get().drafts.filter((d) => d.id !== id);
    const currentDraftId = get().currentDraftId === id ? null : get().currentDraftId;
    set({ drafts, currentDraftId });
  },
}));

/** 构造 LLM 增强选项:llmReady 且启用了增强项时,注入 OpenAiCompatLlm。 */
function buildLlmOptions(state: AppState): { llm?: OpenAiCompatLlm; enhance?: EnhanceOptions } {
  const enhanceEnabled = state.enhance.title || state.enhance.summary || state.enhance.colloquialize || state.enhance.rewrite;
  if (!state.llmReady() || !enhanceEnabled) return {};
  return {
    llm: new OpenAiCompatLlm(state.llm),
    enhance: state.enhance,
  };
}

function buildWechatPublishPayload(
  payload: SerializedPayload,
  assetTable: AssetTable,
  mode: WechatPublishMode,
): {
  title: string;
  content: string;
  summary?: string;
  author?: string;
  contentSourceUrl?: string;
  coverImageUrl?: string;
  bodyImageUrls: readonly string[];
  publish: boolean;
} {
  const bodyImageUrls = payload.imageAssetIds
    .map((id) => assetTable.get(id))
    .filter((asset): asset is NonNullable<typeof asset> => !!asset)
    .map((asset) => asset.rehosted.wechat?.url ?? asset.source.url ?? asset.source.dataUrl)
    .filter((url): url is string => !!url);
  const cover = payload.coverAssetId ? assetTable.get(payload.coverAssetId) : undefined;
  const fallbackCover = payload.imageAssetIds[0] ? assetTable.get(payload.imageAssetIds[0]) : undefined;
  const coverAsset = cover ?? fallbackCover;

  return {
    title: payload.title,
    content: payload.content,
    summary: payload.summary,
    author: typeof payload.extra?.author === "string" ? payload.extra.author : undefined,
    contentSourceUrl:
      typeof payload.extra?.contentSourceUrl === "string" ? payload.extra.contentSourceUrl : undefined,
    coverImageUrl:
      coverAsset?.rehosted.wechat?.url ?? coverAsset?.source.url ?? coverAsset?.source.dataUrl,
    bodyImageUrls,
    publish: mode === "publish",
  };
}

/** 取资产字节:dataURL 直接解码;http(s) URL 则 fetch。 */
async function fetchAssetBytes(src: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    if (src.startsWith("data:")) {
      const res = await fetch(src);
      const blob = await res.blob();
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/png" };
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/png" };
  } catch {
    return null;
  }
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "png";
}
