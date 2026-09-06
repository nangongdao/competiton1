import { describe, expect, it } from "vitest";
import { generateForPlatforms, batchGenerate } from "../src/assistant/batch.js";
import { detectDrift, summarizeDrift, runAllConformance } from "../src/assistant/drift.js";
import { listAdapters } from "../src/adapters/registry.js";
import { bumpTemplateVersion, applyTemplate } from "../src/assistant/templates.js";

describe("assistant batch — 补充边界", () => {
  it("generateForPlatforms 处理未注册平台", async () => {
    const r = await generateForPlatforms(
      { id: "d", title: "t", markdown: "# t\n\n正文" },
      { platformIds: ["not-a-platform"] },
    );
    expect(r.platforms[0]!.error).toContain("未注册的平台");
    expect(r.summary.errored).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("batchGenerate 并发空列表不报错", async () => {
    const results = await batchGenerate([], { platformIds: ["wechat"] });
    expect(results).toHaveLength(0);
  });

  it("batchGenerate 支持 overrides", async () => {
    const results = await batchGenerate(
      [{ id: "d", title: "t", markdown: "# t\n\n正文" }],
      { platformIds: ["wechat"], overrides: { wechat: { title: "覆盖标题" } } },
    );
    expect(results[0]!.platforms[0]!.payload?.title).toBe("覆盖标题");
  });

  it("contentDigest 是稳定哈希", async () => {
    const [a, b] = await Promise.all([
      generateForPlatforms({ id: "d", title: "t", markdown: "# t\n\n正文" }, { platformIds: ["wechat"] }),
      generateForPlatforms({ id: "d", title: "t", markdown: "# t\n\n正文" }, { platformIds: ["wechat"] }),
    ]);
    expect(a.contentDigest).toBe(b.contentDigest);
  });
});

describe("assistant drift — 补充边界", () => {
  it("detectDrift 无漂移时返回空", () => {
    const adapters = listAdapters();
    for (const a of adapters) {
      const snapshot = {
        platformId: a.id,
        capturedAt: "2026-08-05T00:00:00Z",
        limits: { titleMax: a.capabilities.limits.titleMax },
      };
      const drifts = detectDrift(a, snapshot);
      expect(drifts).toHaveLength(0);
    }
  });

  it("detectDrift 检测编辑器版本漂移(若适配器声明 selectorsVersion)", () => {
    const a = listAdapters()[0]!;
    const withSelector = { ...a, selectorsVersion: "2026-01" } as typeof a & { selectorsVersion: string };
    const drifts = detectDrift(withSelector, {
      platformId: a.id,
      capturedAt: "",
      editorVersion: "2026-07",
    });
    expect(drifts.some((d) => d.kind === "selector")).toBe(true);
  });

  it("summarizeDrift 统计各严重度", () => {
    const drifts = [
      { platformId: "w", kind: "limit" as const, field: "a", declared: "1", observed: "2", severity: "high" as const, message: "m" },
      { platformId: "w", kind: "flag" as const, field: "b", declared: "1", observed: "2", severity: "low" as const, message: "m" },
    ];
    const s = summarizeDrift(drifts);
    expect(s.total).toBe(2);
    expect(s.high).toBe(1);
    expect(s.bySeverity.low).toBe(1);
  });

  it("runAllConformance 对全部适配器返回报告", () => {
    const reports = runAllConformance(listAdapters());
    expect(reports.length).toBeGreaterThanOrEqual(7);
    for (const r of reports) expect(r.passed).toBe(true);
  });
});

describe("assistant templates — 升级与应用", () => {
  it("bumpTemplateVersion 保留 createdAt 且更新 touches", () => {
    const t = {
      id: "a",
      name: "n",
      platformId: "wechat",
      version: 1,
      schemaVersion: 1,
      touches: { title: false, summary: false, tags: false, category: false, cover: false, theme: false, bannedWords: false, limits: false },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const v2 = bumpTemplateVersion(t, { config: { limits: { bodyMax: 1000 } } });
    expect(v2.version).toBe(2);
    expect(v2.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(v2.touches.limits).toBe(true);
    expect(v2.updatedAt).not.toBe(t.updatedAt);
  });

  it("applyTemplate 合并 config.limits", () => {
    const { config } = applyTemplate(
      { override: {}, config: { limits: { bodyMax: 500 } } },
      {},
      { limits: { bodyMax: 999, titleMax: 30 } },
    );
    expect(config.limits?.bodyMax).toBe(500);
    expect(config.limits?.titleMax).toBe(30);
  });
});
