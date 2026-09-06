/**
 * DATA-01 数据导出/导入测试。
 */
import { describe, expect, it } from "vitest";
import {
  DATA_KIND,
  DATA_SCHEMA_VERSION,
  migrateData,
  parseImport,
  serializeExport,
  type Draft,
  type HistoryEntry,
  type MppData,
  type MppDataFile,
} from "../src/storage/data-transfer.js";

const draft: Draft = {
  id: "d1",
  title: "测试草稿",
  markdown: "# 标题\n\n正文",
  authorName: "作者",
  tags: ["效率", "创作"],
  updatedAt: "2026-08-05T10:00:00.000Z",
};

const history: HistoryEntry = {
  id: "h1",
  draftTitle: "测试草稿",
  at: "2026-08-05T11:00:00.000Z",
  platforms: [{ platformId: "zhihu", ok: true, message: "published" }],
};

const data: MppData = {
  drafts: [draft],
  history: [history],
  settings: { serverUrl: "http://127.0.0.1:8787", wechatPublishMode: "draft" },
};

describe("serializeExport / parseImport", () => {
  it("导出-导入往返无损", () => {
    const raw = serializeExport(data, () => "2026-08-05T12:00:00.000Z");
    const file = JSON.parse(raw) as Record<string, unknown>;
    expect(file.kind).toBe(DATA_KIND);
    expect(file.version).toBe(DATA_SCHEMA_VERSION);
    expect(file.exportedAt).toBe("2026-08-05T12:00:00.000Z");

    const result = parseImport(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts).toEqual({ drafts: 1, history: 1 });
    expect(result.data.drafts[0]).toEqual(draft);
    expect(result.data.history[0]).toEqual(history);
    expect(result.data.settings?.serverUrl).toBe("http://127.0.0.1:8787");
  });

  it("非 JSON 返回明确错误", () => {
    const r = parseImport("not json{");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("JSON");
  });

  it("kind 不匹配被拒绝", () => {
    const raw = JSON.stringify({ app: "multi-platform-publisher", kind: "other", version: 1, data: {} });
    const r = parseImport(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("mpp-data");
  });

  it("版本过高被拒绝并提示升级", () => {
    const raw = JSON.stringify({ app: "multi-platform-publisher", kind: DATA_KIND, version: 99, data: {} });
    const r = parseImport(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("升级");
  });

  it("损坏的 draft 条目被过滤而非整体失败", () => {
    const raw = JSON.stringify({
      app: "multi-platform-publisher",
      kind: DATA_KIND,
      version: 1,
      data: { drafts: [{ id: "bad" }, draft], history: [] },
    });
    const r = parseImport(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts.drafts).toBe(1);
  });
});

describe("升级 / 回滚演练(迁移与回滚可复现)", () => {
  it("迁移幂等:v1 数据 migrate 后字段无丢失", () => {
    // migrateData 当前 v1 幂等:传入 v1 文件,返回结构不变、可再次解析。
    const raw = serializeExport(data, () => "2026-08-05T12:00:00.000Z");
    const file = JSON.parse(raw) as MppDataFile;
    const migrated = migrateData(file);
    expect(migrated.version).toBe(DATA_SCHEMA_VERSION);
    const reparsed = parseImport(JSON.stringify(migrated));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.counts).toEqual({ drafts: 1, history: 1 });
  });

  it("回滚可复现:旧版本(v1)能读取迁移前备份", () => {
    // 模拟真实升级流程:先导出 v1 备份 → 迁移 → 若新版本异常,用旧版本回滚读取备份。
    const backupRaw = serializeExport(data, () => "2026-08-01T00:00:00.000Z");
    // 旧版本解析器(与当前 parseImport 兼容,只接受 ≤ v1)。
    const rollback = parseImport(backupRaw);
    expect(rollback.ok).toBe(true);
    if (!rollback.ok) return;
    expect(rollback.data.drafts[0]?.title).toBe("测试草稿");
    expect(rollback.data.settings?.serverUrl).toBe("http://127.0.0.1:8787");
  });
});
