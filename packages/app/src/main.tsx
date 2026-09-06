import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { MockBridge } from "./bridge/mock-bridge.js";
import { ChromeBridge } from "./bridge/chrome-bridge.js";
import type { AutomationPublishMode, PlatformBridge } from "./bridge/types.js";
import { useStore } from "./state/store.js";
import { applyTheme } from "./styles/use-theme.js";
import "./styles/index.css";

// 首屏前应用持久化主题(避免亮暗闪烁)。system 模式由 CSS 媒体查询兜底。
try {
  const saved = localStorage.getItem("mpp.theme");
  if (saved === "light" || saved === "dark") applyTheme(saved);
} catch {
  /* localStorage 不可用时走 system 默认 */
}

/**
 * 运行时检测环境并选择 bridge:
 * - 扩展环境(chrome.runtime.id 存在)→ ChromeBridge;
 * - Tauri 桌面环境(__TAURI_INTERNALS__)→ TauriBridge(动态加载,避免桌面代码进入浏览器主包);
 * - 其余 → MockBridge(浏览器原生)。
 *
 * TauriBridge 依赖 @tauri-apps/api 且体积较大,仅在桌面运行时才动态 import,
 * 浏览器路径零成本(这是"浏览器启动"与"桌面启动"共存的关键)。
 */
async function detectBridge(): Promise<PlatformBridge> {
  const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
  if (isExtension) return new ChromeBridge();
  const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isDesktop) {
    const { TauriBridge } = await import("./bridge/tauri-bridge.js");
    return new TauriBridge();
  }
  return new MockBridge();
}

/** 恢复本机持久化设置(不含敏感 key,key 由 SEC-04 单独处理)。 */
// 模块级 bridge 引用:boot() 检测后赋值,restoreSetting 读取。
let bridge: PlatformBridge = new MockBridge();
function restoreSetting(key: string, apply: (raw: string) => void): void {
  void bridge.getSetting(key).then((raw) => {
    if (raw) apply(raw);
  });
}

async function boot(): Promise<void> {
  const selected = await detectBridge();
  bridge = selected;
  useStore.getState().setBridge(selected);

  // 从本地存储恢复普通设置(仅存本地)。
  restoreSetting("mpp.serverUrl", (raw) => useStore.setState({ serverUrl: raw }));
  restoreSetting("mpp.runnerUrl", (raw) => useStore.setState({ runnerUrl: raw }));
  restoreSetting("mpp.serverToken", (raw) => useStore.setState({ serverToken: raw }));
  restoreSetting("mpp.runnerToken", (raw) => useStore.setState({ runnerToken: raw }));
  restoreSetting("mpp.enhance", (raw) => {
    try {
      const saved = JSON.parse(raw) as Partial<{ title?: boolean; summary?: boolean; colloquialize?: boolean; rewrite?: boolean }>;
      useStore.setState((s) => ({ enhance: { ...s.enhance, ...saved } }));
    } catch {
      /* 忽略损坏的设置 */
    }
  });
  restoreSetting("mpp.wechatPublishMode", (raw) => {
    if (raw === "mock" || raw === "draft" || raw === "publish") {
      useStore.setState({ wechatPublishMode: raw });
    }
  });
  // 编辑器偏好:字数目标 / 打字机模式。
  restoreSetting("mpp.wordGoal", (raw) => {
    const v = Number.parseInt(raw, 10);
    if (Number.isFinite(v) && v >= 0) useStore.setState({ wordGoal: v });
  });
  restoreSetting("mpp.typewriterMode", (raw) => {
    if (raw === "1") useStore.setState({ typewriterMode: true });
  });
  restoreSetting("mpp.automationModes", (raw) => {
    try {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const valid: Record<string, AutomationPublishMode> = {};
      for (const [key, value] of Object.entries(saved)) {
        if (isAutomationPublishMode(value)) valid[key] = value;
      }
      useStore.setState((s) => ({ automationModes: { ...s.automationModes, ...valid } }));
    } catch {
      /* 忽略损坏的自动化发布设置 */
    }
  });

  // ACCOUNT-04:恢复账号选择引用(账号本体由 loadAccounts 从 IndexedDB/chrome.storage 读取)。
  restoreSetting("mpp.activeAccountId", (raw) => {
    if (raw) useStore.setState({ activeAccountId: raw });
  });
  restoreSetting("mpp.accountForPlatform", (raw) => {
    try {
      const saved = JSON.parse(raw) as Record<string, string>;
      const valid: Record<string, string> = {};
      for (const [k, v] of Object.entries(saved)) {
        if (typeof v === "string") valid[k] = v;
      }
      useStore.setState({ accountForPlatform: valid });
    } catch {
      /* 忽略损坏的账号选择设置 */
    }
  });

  // v10 FOLLOWUP-NOTIFY:恢复待跟进提醒开关(开启时启动后即检查一次)。
  restoreSetting("mpp.followUpReminderEnabled", (raw) => {
    if (raw === "1") {
      useStore.setState({ followUpReminderEnabled: true });
      void useStore.getState().runFollowUpReminder(false);
    }
  });

  // v11 INBOX-07:恢复置顶评论跟进提醒开关(开启时启动后即检查一次)。
  restoreSetting("mpp.pinnedFollowUpEnabled", (raw) => {
    if (raw === "1") {
      useStore.setState({ pinnedFollowUpEnabled: true });
      void useStore.getState().runPinnedFollowUpReminder(false);
    }
  });

  // v11 INBOX-03:恢复各平台收件箱同步游标(增量拉取位置)。
  restoreSetting("mpp.inboxSyncCursors", (raw) => {
    try {
      const saved = JSON.parse(raw) as Record<string, string>;
      const valid: Record<string, string> = {};
      for (const [k, v] of Object.entries(saved)) {
        if (typeof v === "string") valid[k] = v;
      }
      useStore.setState({ inboxSyncCursors: valid });
    } catch {
      /* 忽略损坏的游标设置 */
    }
  });

  // v11 深化 GOAL-NOTIFY-01:恢复目标达成提醒开关(开启时启动后即检查一次)。
  restoreSetting("mpp.goalReminderEnabled", (raw) => {
    if (raw === "1") {
      useStore.setState({ goalReminderEnabled: true });
      void useStore.getState().runGoalReminder(false);
    }
  });

  // v11 深化 REFRESH-TRACK-CLOSED-01:恢复翻新入队自动打标记录(供效果回收自动配对,跨会话闭环)。
  restoreSetting("mpp.refreshMarks", (raw) => {
    try {
      const saved = JSON.parse(raw) as { originalTitle: string; refreshedTitle: string }[];
      if (Array.isArray(saved)) {
        useStore.setState({
          refreshMarks: saved.filter((m) => m && typeof m.originalTitle === "string" && typeof m.refreshedTitle === "string"),
        });
      }
    } catch {
      /* 忽略损坏的翻新标记 */
    }
  });

  // SEC-04:apiKey 默认仅会话保存(不落盘);只有用户显式开启“持久化 LLM key”时,
  // 才从 mpp.llm 恢复 key,否则只从 sessionStorage 的会话缓存恢复。
  let saved: Partial<{ baseUrl: string; apiKey: string; model: string }> | undefined;
  try {
    const raw = await bridge.getSetting("mpp.llm");
    if (raw) saved = JSON.parse(raw) as typeof saved;
  } catch {
    /* 忽略损坏的设置 */
  }

  let persist = false;
  let apiKey = "";
  const persistRaw = await bridge.getSetting("mpp.persistLlmKey");
  if (persistRaw === "1") {
    persist = true;
    // 显式选择持久化才从磁盘恢复 key(兼容旧版本遗留存储)。
    apiKey = saved?.apiKey ?? "";
  } else {
    // 未开启持久化:只从会话缓存恢复 key,即使 mpp.llm 里残留历史 key 也绝不读取。
    try {
      apiKey = sessionStorage.getItem("mpp.llm.sessionApiKey") ?? "";
    } catch {
      /* sessionStorage 不可用时忽略 */
    }
  }

  useStore.setState((s) => ({
    llm: { ...s.llm, ...(saved ?? {}), apiKey },
    persistLlmKey: persist,
  }));

  // AI 连接中心:恢复已保存的多套 LLM 配置(apiKey 已由 stripApiKey 剔除,
  // 仅作为模板;实际 apiKey 从当前生效配置 mpp.llm + 会话缓存恢复)。
  try {
    const rawConfigs = await bridge.getSetting("mpp.llmConfigs");
    if (rawConfigs) {
      const parsed = JSON.parse(rawConfigs) as Array<Record<string, unknown>>;
      const valid: Array<{
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        model: string;
        temperature: number;
        maxTokens: number;
        timeoutMs: number;
        isLocal?: boolean;
        presetId?: string;
      }> = parsed
        .filter((c) => c && typeof c === "object" && typeof c.id === "string" && typeof c.baseUrl === "string")
        .map((c) => ({
          ...c,
          id: String(c.id),
          name: typeof c.name === "string" ? c.name : "未命名配置",
          baseUrl: String(c.baseUrl),
          apiKey: "", // 安全:持久化的配置不含 key,仅模板;key 从 mpp.llm/会话缓存恢复
          model: typeof c.model === "string" ? c.model : "",
          temperature: typeof c.temperature === "number" ? c.temperature : 0.7,
          maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : 1024,
          timeoutMs: typeof c.timeoutMs === "number" ? c.timeoutMs : 30000,
          isLocal: c.isLocal === true ? true : undefined,
          presetId: typeof c.presetId === "string" ? c.presetId : undefined,
        }));
      useStore.setState((s) => ({ llmConfigs: [...s.llmConfigs, ...valid] }));
    }
    const activeRaw = await bridge.getSetting("mpp.activeLlmConfigId");
    if (activeRaw) useStore.setState({ activeLlmConfigId: activeRaw });
  } catch {
    /* 忽略损坏的配置 */
  }
}

// 首帧渲染:boot 异步完成(bridge 检测 + 设置恢复)后再挂载,避免首帧使用旧 bridge。
void boot().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

function isAutomationPublishMode(value: unknown): value is AutomationPublishMode {
  return value === "mock" || value === "assist" || value === "draft" || value === "full-auto";
}
