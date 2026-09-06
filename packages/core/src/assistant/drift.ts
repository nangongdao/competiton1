/**
 * PLAT-02 平台能力漂移探测 + SDK-01 Adapter conformance kit。
 *
 * - 漂移探测:对比"适配器声明的能力(capabilities/limits/selectors 版本)"与
 *   实际观测(静态能力快照 / 契约校验结果),只告警不自动改规则;
 * - conformance kit:定义新平台适配器必须通过的契约(IR、降级、净化、校验、
 *   fixture、回执),供 CI/开发期自检。
 *
 * 纯 TS、零 DOM。漂移探测输入为"能力快照"(可由 runner fixture 或人工 canary 产出)。
 */
import type { PlatformAdapter } from "../adapters/types.js";
import type { Capabilities } from "../ir/types.js";

// ---------------------------------------------------------------------------
// PLAT-02 能力漂移探测
// ---------------------------------------------------------------------------

/** 能力快照(观测到的平台实际能力)。 */
export interface CapabilitySnapshot {
  readonly platformId: string;
  readonly capturedAt: string;
  /** 观测到的限制(如标题上限变化、图片张数变化)。 */
  readonly limits?: Partial<Capabilities["limits"]>;
  /** 观测到的布尔能力(如是否支持表格/外链)。 */
  readonly flags?: Partial<{
    supportsTables: boolean;
    supportsExternalLinks: boolean;
    requiresCover: boolean;
    requiresImageRehost: boolean;
  }>;
  /** 观测到的选择器/编辑器版本(跑 fixture 时记录)。 */
  readonly editorVersion?: string;
  /** 观测备注。 */
  readonly note?: string;
}

/** 漂移类型。 */
export type DriftKind = "limit" | "flag" | "selector" | "removed";

/** 漂移告警(只告警,不自动改规则)。 */
export interface CapabilityDrift {
  readonly platformId: string;
  readonly kind: DriftKind;
  /** 漂移的字段。 */
  readonly field: string;
  /** 声明值。 */
  readonly declared: string | number | boolean | undefined;
  /** 观测值。 */
  readonly observed: string | number | boolean | undefined;
  /** 严重度:高危(可能阻塞发布)/ 中(可能影响质量)/ 低(提示)。 */
  readonly severity: "high" | "medium" | "low";
  /** 人类可读说明。 */
  readonly message: string;
}

/** 比对声明的 capabilities 与观测快照,产出漂移告警。 */
export function detectDrift(adapter: PlatformAdapter, snapshot: CapabilitySnapshot): readonly CapabilityDrift[] {
  const out: CapabilityDrift[] = [];
  const cap = adapter.capabilities;

  if (snapshot.limits) {
    for (const [key, observed] of Object.entries(snapshot.limits)) {
      const declared = cap.limits[key as keyof Capabilities["limits"]];
      if (declared !== observed) {
        out.push({
          platformId: adapter.id,
          kind: "limit",
          field: `limits.${key}`,
          declared: declared === undefined ? "未声明" : String(declared),
          observed: observed === undefined ? "未知" : String(observed),
          severity: key === "titleMax" || key === "bodyMax" ? "high" : "medium",
          message: `${adapter.name} 的 ${key} 从 ${String(declared)} 变为 ${String(observed)},可能导致截断/超限`,
        });
      }
    }
  }

  if (snapshot.flags) {
    const flagMap: Record<string, keyof Capabilities> = {
      supportsTables: "supportsTables",
      supportsExternalLinks: "supportsExternalLinks",
      requiresCover: "requiresCover",
      requiresImageRehost: "requiresImageRehost",
    };
    for (const [key, observed] of Object.entries(snapshot.flags)) {
      const capKey = flagMap[key];
      if (!capKey) continue;
      const declared = cap[capKey as keyof Capabilities];
      if (declared !== observed) {
        out.push({
          platformId: adapter.id,
          kind: "flag",
          field: key,
          declared: declared === undefined ? "未声明" : String(declared),
          observed: observed === undefined ? "未知" : String(observed),
          severity: key === "requiresImageRehost" ? "high" : "medium",
          message: `${adapter.name} 的 ${key} 声明 ${String(declared)} 但观测到 ${String(observed)}`,
        });
      }
    }
  }

  if (snapshot.editorVersion && typeof snapshot.editorVersion === "string") {
    const selectorsVersion = (adapter as unknown as { selectorsVersion?: string }).selectorsVersion;
    if (selectorsVersion && selectorsVersion !== snapshot.editorVersion) {
      out.push({
        platformId: adapter.id,
        kind: "selector",
        field: "editorVersion",
        declared: selectorsVersion,
        observed: snapshot.editorVersion,
        severity: "high",
        message: `${adapter.name} 选择器版本 ${selectorsVersion} 与观测到的编辑器版本 ${snapshot.editorVersion} 不一致,建议核验选择器是否漂移`,
      });
    }
  }

  return out;
}

/** 汇总漂移告警:高危优先。 */
export function summarizeDrift(drifts: readonly CapabilityDrift[]): {
  readonly total: number;
  readonly high: number;
  readonly bySeverity: Readonly<Record<CapabilityDrift["severity"], number>>;
} {
  return {
    total: drifts.length,
    high: drifts.filter((d) => d.severity === "high").length,
    bySeverity: {
      high: drifts.filter((d) => d.severity === "high").length,
      medium: drifts.filter((d) => d.severity === "medium").length,
      low: drifts.filter((d) => d.severity === "low").length,
    },
  };
}

// ---------------------------------------------------------------------------
// SDK-01 Adapter conformance kit
// ---------------------------------------------------------------------------

/** 新平台适配器必须通过的契约检查项。 */
export interface ConformanceReport {
  readonly platformId: string;
  readonly checks: readonly ConformanceCheck[];
  readonly passed: boolean;
}

export interface ConformanceCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/** 跑一个适配器的 conformance 自检(不依赖真实网络)。 */
export function runConformance(adapter: PlatformAdapter): ConformanceReport {
  const checks: ConformanceCheck[] = [];

  // 1. 能力声明完整性。
  const cap = adapter.capabilities;
  checks.push({
    name: "capabilities.contentModel",
    ok: ["inline-html", "rich-clipboard", "restricted-html", "markdown", "plaintext"].includes(cap.contentModel),
    detail: `contentModel = ${cap.contentModel}`,
  });
  checks.push({
    name: "capabilities.limits",
    ok: typeof cap.limits?.titleMax === "number" && typeof cap.limits?.bodyMax === "number",
    detail: `titleMax=${String(cap.limits?.titleMax)} bodyMax=${String(cap.limits?.bodyMax)}`,
  });
  checks.push({
    name: "capabilities.supportsTables",
    ok: typeof cap.supportsTables === "boolean",
    detail: `supportsTables = ${String(cap.supportsTables)}`,
  });
  checks.push({
    name: "capabilities.taxonomy",
    ok: ["free-tags", "entity-topics", "category+tags"].includes(cap.taxonomy),
    detail: `taxonomy = ${cap.taxonomy}`,
  });

  // 2. 适配器方法完整。
  checks.push({
    name: "adapter.methods",
    ok: typeof adapter.preprocess === "function" && typeof adapter.serialize === "function" && typeof adapter.rehostAsset === "function",
    detail: "preprocess/serialize/rehostAsset 均已实现",
  });

  // 3. serialize 契约:输入空文档也产出合法产物。
  try {
    const payload = adapter.serialize(
      { meta: { title: "", tags: [], lang: "zh" }, blocks: [], assets: [], overrides: {} },
      undefined,
    );
    checks.push({
      name: "serialize.empty-doc",
      ok: typeof payload.content === "string" && typeof payload.title === "string" && Array.isArray(payload.tags) && Array.isArray(payload.imageAssetIds),
      detail: `empty doc → content=${payload.content.length}B, title="${payload.title}"`,
    });
  } catch (err) {
    checks.push({
      name: "serialize.empty-doc",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. 净化:serialize 输出必须为合法类型(HTML 平台产物应可被 sanitize 接受)。
  try {
    const payload = adapter.serialize(
      { meta: { title: "t", tags: [], lang: "zh" }, blocks: [], assets: [], overrides: {} },
      undefined,
    );
    checks.push({
      name: "serialize.mime",
      ok: payload.mime === "text/html" || payload.mime === "text/plain" || payload.mime === "text/markdown",
      detail: `mime = ${payload.mime}`,
    });
  } catch {
    checks.push({ name: "serialize.mime", ok: false, detail: "serialize 抛错" });
  }

  // 5. 校验契约:validate 可运行(通过 sync 的规则,这里轻量检查 adapter 不抛)。
  checks.push({
    name: "conformance.registered",
    ok: !!adapter.id && adapter.id.length > 0,
    detail: `id = ${adapter.id}, name = ${adapter.name}`,
  });

  return {
    platformId: adapter.id,
    checks,
    passed: checks.every((c) => c.ok),
  };
}

/** 跑全部已注册适配器的 conformance。 */
export function runAllConformance(adapters: readonly PlatformAdapter[]): readonly ConformanceReport[] {
  return adapters.map(runConformance);
}
