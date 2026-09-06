import { describe, expect, it } from "vitest";
import {
  createTemplate,
  bumpTemplateVersion,
  applyTemplate,
  deriveTouches,
  touchKey,
  MemoryTemplateStore,
  assertValidTemplate,
  PLATFORM_TEMPLATE_SCHEMA_VERSION,
} from "../src/assistant/templates.js";
import { batchGenerate, buildApprovalManifest, confirmApprovalItem, canProceed } from "../src/assistant/batch.js";
import { detectDrift, runConformance, summarizeDrift } from "../src/assistant/drift.js";
import { getAdapter, listAdapters } from "../src/adapters/registry.js";

describe("FLOW-01 平台模板", () => {
  it("createTemplate 从覆盖层推导影响面", () => {
    const t = createTemplate({
      id: "t1",
      name: "公众号干货风",
      platformId: "wechat",
      override: { title: "标题", themeId: "theme-a" },
    });
    expect(t.version).toBe(1);
    expect(t.schemaVersion).toBe(PLATFORM_TEMPLATE_SCHEMA_VERSION);
    expect(t.touches.title).toBe(true);
    expect(t.touches.theme).toBe(true);
    expect(t.touches.summary).toBe(false);
  });

  it("bumpTemplateVersion 升级版本且保留 id/platformId", () => {
    const t = createTemplate({ id: "t1", name: "n", platformId: "wechat" });
    const v2 = bumpTemplateVersion(t, { override: { title: "新" } });
    expect(v2.version).toBe(2);
    expect(v2.id).toBe("t1");
    expect(v2.platformId).toBe("wechat");
    expect(v2.touches.title).toBe(true);
  });

  it("applyTemplate 合并当前值与模板(缺省保留现值)", () => {
    const t = createTemplate({
      id: "t1",
      name: "n",
      platformId: "wechat",
      override: { title: "模板标题" },
      config: { limits: { bodyMax: 5000 } },
    });
    const { override, config } = applyTemplate(t, { title: "现值", summary: "s" }, { limits: { bodyMax: 999 } });
    expect(override.title).toBe("模板标题");
    expect(override.summary).toBe("s");
    expect(config.limits?.bodyMax).toBe(5000);
  });

  it("MemoryTemplateStore 支持增删查", async () => {
    const store = new MemoryTemplateStore();
    const t = createTemplate({ id: "a", name: "A", platformId: "zhihu" });
    await store.save(t);
    expect(await store.get("zhihu", "a")).toBeDefined();
    expect((await store.list("zhihu")).length).toBe(1);
    await store.remove("zhihu", "a");
    expect(await store.get("zhihu", "a")).toBeUndefined();
  });

  it("assertValidTemplate 拒绝非法模板", () => {
    expect(() =>
      assertValidTemplate({
        id: "x",
        platformId: "wechat",
        version: 1,
        schemaVersion: 99,
        touches: deriveTouches(),
        createdAt: "",
        updatedAt: "",
      }),
    ).toThrow();
    expect(touchKey(deriveTouches(undefined, { limits: { bodyMax: 1 } }))).toBe("limits");
  });
});

describe("FLOW-02 批量校验/生成 + FLOW-04 审批清单", () => {
  it("batchGenerate 对多草稿产出各平台产物与摘要", async () => {
    const items = [
      { id: "d1", title: "草稿一", markdown: "# 草稿一\n\n正文内容", tags: ["a"] },
      { id: "d2", title: "草稿二", markdown: "# 草稿二\n\n更多内容", tags: ["b"] },
    ];
    const results = await batchGenerate(items, { platformIds: ["wechat", "zhihu", "bilibili", "xiaohongshu"] });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.platforms).toHaveLength(4);
      expect(r.contentDigest).toMatch(/^[a-f0-9]+$/);
      expect(r.summary.total).toBe(4);
    }
  });

  it("buildApprovalManifest + confirmApprovalItem 全确认后可 proceed", async () => {
    const [result] = await batchGenerate(
      [{ id: "d1", title: "t", markdown: "# t\n\n正文" }],
      { platformIds: ["wechat", "zhihu"] },
    );
    const manifest = await buildApprovalManifest(result, { wechat: "draft", zhihu: "draft" });
    expect(manifest.allConfirmed).toBe(false);
    expect(canProceed(manifest).ok).toBe(false);

    let next = manifest;
    for (const item of manifest.items) {
      next = confirmApprovalItem(next, item.platformId, result.contentDigest);
    }
    expect(next.allConfirmed).toBe(true);
    expect(canProceed(next).ok).toBe(true);
  });

  it("confirmApprovalItem 摘要不一致时拒绝确认", async () => {
    const [result] = await batchGenerate([{ id: "d1", title: "t", markdown: "# t\n\n正文" }], {
      platformIds: ["wechat"],
    });
    const manifest = await buildApprovalManifest(result, { wechat: "publish" });
    const next = confirmApprovalItem(manifest, "wechat", "wrong-digest");
    expect(next.items[0]!.confirmed).toBe(false);
    expect(canProceed(next).ok).toBe(false);
  });
});

describe("PLAT-02 能力漂移 + SDK-01 conformance", () => {
  it("detectDrift 发现 limits/flags 不一致并只告警", () => {
    const wechat = getAdapter("wechat");
    if (!wechat) throw new Error("wechat adapter missing");
    const drifts = detectDrift(wechat, {
      platformId: "wechat",
      capturedAt: "2026-08-05T00:00:00Z",
      limits: { titleMax: 30 },
      flags: { requiresCover: false },
    });
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts.some((d) => d.kind === "limit" && d.field === "limits.titleMax")).toBe(true);
    expect(drifts.some((d) => d.kind === "flag" && d.field === "requiresCover")).toBe(true);
    const sum = summarizeDrift(drifts);
    expect(sum.total).toBe(drifts.length);
    expect(sum.high).toBeGreaterThanOrEqual(0);
  });

  it("runConformance 对全部内置适配器通过", () => {
    const reports = listAdapters().map((a) => runConformance(a));
    expect(reports.length).toBeGreaterThanOrEqual(7);
    for (const r of reports) {
      expect(r.passed, `${r.platformId} conformance failed: ${JSON.stringify(r.checks.filter((c) => !c.ok))}`).toBe(true);
    }
  });
});
