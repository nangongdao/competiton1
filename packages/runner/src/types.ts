import type { SerializedPayload } from "@mpp/core";

export const automationModes = ["draft", "full-auto"] as const;
export type AutomationMode = (typeof automationModes)[number];

export const automationPlatformIds = [
  "wechat",
  "zhihu",
  "bilibili",
  "xiaohongshu",
  "juejin",
  "csdn",
  "cnblogs",
  "weibo",
  "toutiao",
  "douyin",
  "kuaishou",
  "shipinhao",
] as const;
export type AutomationPlatformId = (typeof automationPlatformIds)[number];

/**
 * 自动化发布状态(RUN-02):
 * - `drafted`:已找到保存草稿按钮并点击,存在可审查的"草稿已保存"证据;
 * - `submitted`:点击了发布但尚无平台侧成功证据(仅提交,未核验);
 * - `published`:具备平台成功证据(远端 ID/URL/页面状态);
 * - `unknown`:请求可能已生效但没有可信回执,禁止自动重试;
 * - `needs-user-action`:登录/验证码/风控;
 * - `failed`:平台明确拒绝或安全地确认未提交。
 */
export const automationStatuses = [
  "drafted",
  "submitted",
  "published",
  "unknown",
  "needs-user-action",
  "failed",
] as const;
export type AutomationStatus = (typeof automationStatuses)[number];

export interface AutomationOptions {
  readonly headless?: boolean;
  readonly slowMoMs?: number;
  readonly timeoutMs?: number;
  readonly profileDir?: string;
}

export interface AutomationPublishRequest {
  readonly platformId: AutomationPlatformId;
  readonly mode: AutomationMode;
  readonly payload: SerializedPayload;
  readonly options?: AutomationOptions;
  /** full-auto 二次确认绑定内容摘要(RUN-01):确认内容与请求内容不一致时拒绝。 */
  readonly contentDigest?: string;
  /** 用户/调用方对"将真实发布该内容"的显式确认(RUN-01)。 */
  readonly confirmed?: boolean;
}

export interface AutomationPublishReceipt {
  readonly ok: boolean;
  readonly status: AutomationStatus;
  readonly message: string;
  readonly remoteUrl?: string;
  readonly remoteId?: string;
  readonly screenshotPath?: string;
  readonly tracePath?: string;
  readonly diagnosticsPath?: string;
  /** 成功证据(RUN-02):保存按钮可见/远端 URL/页面状态等。 */
  readonly evidence?: readonly string[];
  /** 分步耗时观测(§6.2):各阶段耗时,用于定位启动/选择器/事件等待瓶颈。 */
  readonly timing?: {
    /** 总耗时(ms)。 */
    readonly totalMs: number;
    /** 分步耗时样本。 */
    readonly samples: ReadonlyArray<{ step: string; label: string; elapsedMs: number; exceeded?: boolean }>;
  };
}

export function isAutomationMode(value: unknown): value is AutomationMode {
  return typeof value === "string" && automationModes.includes(value as AutomationMode);
}

export function isAutomationPlatformId(value: unknown): value is AutomationPlatformId {
  return typeof value === "string" && automationPlatformIds.includes(value as AutomationPlatformId);
}

export function isAutomationStatus(value: unknown): value is AutomationStatus {
  return typeof value === "string" && automationStatuses.includes(value as AutomationStatus);
}

export function parseAutomationPublishRequest(value: unknown): AutomationPublishRequest {
  if (!isRecord(value)) {
    throw new Error("request body must be an object");
  }
  if (!isAutomationPlatformId(value.platformId)) {
    throw new Error("unsupported platformId");
  }
  if (!isAutomationMode(value.mode)) {
    throw new Error("unsupported automation mode");
  }
  if (!isRecord(value.payload)) {
    throw new Error("payload must be an object");
  }

  const options = value.options === undefined ? undefined : parseAutomationOptions(value.options);
  return {
    platformId: value.platformId,
    mode: value.mode,
    payload: value.payload as unknown as SerializedPayload,
    ...(options ? { options } : {}),
    ...(value.contentDigest !== undefined
      ? { contentDigest: mustString(value.contentDigest, "contentDigest") }
      : {}),
    ...(value.confirmed !== undefined
      ? { confirmed: mustBoolean(value.confirmed, "confirmed") }
      : {}),
  };
}

export function isAutomationPublishReceipt(value: unknown): value is AutomationPublishReceipt {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    isAutomationStatus(value.status) &&
    typeof value.message === "string" &&
    optionalString(value.remoteUrl) &&
    optionalString(value.remoteId) &&
    optionalString(value.screenshotPath) &&
    optionalString(value.tracePath) &&
    optionalString(value.diagnosticsPath) &&
    optionalStringArray(value.evidence) &&
    optionalTiming(value.timing)
  );
}

function optionalTiming(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || typeof value.totalMs !== "number") return false;
  if (!Array.isArray(value.samples)) return false;
  return value.samples.every(
    (s) =>
      isRecord(s) &&
      typeof s.step === "string" &&
      typeof s.label === "string" &&
      typeof s.elapsedMs === "number",
  );
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((x) => typeof x === "string"))
  );
}

function parseAutomationOptions(value: unknown): AutomationOptions {
  if (!isRecord(value)) {
    throw new Error("options must be an object");
  }

  const out: AutomationOptions = {
    ...(value.headless === undefined ? {} : { headless: mustBoolean(value.headless, "options.headless") }),
    ...(value.slowMoMs === undefined ? {} : { slowMoMs: mustNumber(value.slowMoMs, "options.slowMoMs") }),
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: mustNumber(value.timeoutMs, "options.timeoutMs") }),
    ...(value.profileDir === undefined ? {} : { profileDir: mustString(value.profileDir, "options.profileDir") }),
  };
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function mustString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function mustBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function mustNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}
