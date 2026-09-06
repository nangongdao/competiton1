import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createRunArtifacts, redactForArtifact } from "../src/diagnostics/artifacts.js";

describe("automation run artifacts", () => {
  it("creates platform-specific run directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "mpp-runs-"));
    const artifacts = await createRunArtifacts(root, "zhihu", new Date("2026-05-31T10:20:30.000Z"));

    expect(artifacts.dir).toContain("2026-05-31T10-20-30-000Z-zhihu");
    expect(artifacts.requestPath).toBe(join(artifacts.dir, "request.json"));
    expect(artifacts.receiptPath).toBe(join(artifacts.dir, "receipt.json"));
    expect(artifacts.finalScreenshotPath).toBe(join(artifacts.dir, "final.png"));
    expect(artifacts.failureScreenshotPath).toBe(join(artifacts.dir, "failure.png"));
    expect(artifacts.tracePath).toBe(join(artifacts.dir, "trace.zip"));
    expect(artifacts.domPath).toBe(join(artifacts.dir, "dom.html"));
  });

  it("writes redacted request JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "mpp-runs-"));
    const artifacts = await createRunArtifacts(root, "zhihu", new Date("2026-05-31T10:20:30.000Z"));

    await artifacts.writeJson("request", {
      platformId: "zhihu",
      token: "SECRET_TOKEN",
      nested: { password: "SECRET_PASSWORD", title: "Visible" },
      cookie: "SECRET_COOKIE",
    });

    const json = await readFile(artifacts.requestPath, "utf8");
    expect(json).toContain('"token": "[redacted]"');
    expect(json).toContain('"password": "[redacted]"');
    expect(json).toContain('"cookie": "[redacted]"');
    expect(json).toContain('"title": "Visible"');
  });

  it("redacts secret-like keys without changing normal payload text", () => {
    expect(
      redactForArtifact({
        apiKey: "key",
        appSecret: "secret",
        content: "article text",
        items: [{ accessToken: "token" }, { value: 1 }],
      }),
    ).toEqual({
      apiKey: "[redacted]",
      appSecret: "[redacted]",
      content: "article text",
      items: [{ accessToken: "[redacted]" }, { value: 1 }],
    });
  });
});

describe("OBS-01 诊断工件清理", () => {
  it("parseArtifactTimestamp 解析 ISO 目录名", async () => {
    const { parseArtifactTimestamp } = await import("../src/diagnostics/artifacts.js");
    const ts = parseArtifactTimestamp("2026-05-31T10-20-30-000Z-zhihu");
    expect(ts).toBe(Date.UTC(2026, 4, 31, 10, 20, 30, 0));
    expect(parseArtifactTimestamp("random-dir")).toBeUndefined();
  });

  it("pruneRunArtifacts 清理超过保留数量的旧目录", async () => {
    const { createRunArtifacts, pruneRunArtifacts } = await import("../src/diagnostics/artifacts.js");
    const root = await mkdtemp(join(tmpdir(), "mpp-runs-"));
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getTime() - i * 1000);
      await createRunArtifacts(root, "zhihu", d);
    }
    // 最多保留 2 个
    const removed = await pruneRunArtifacts(root, now.getTime(), 2);
    expect(removed).toBe(1);
    const left = await import("node:fs/promises").then((fs) => fs.readdir(root));
    expect(left).toHaveLength(2);
  });

  it("pruneRunArtifacts 清理超过 TTL 的旧目录", async () => {
    const { createRunArtifacts, pruneRunArtifacts, RUN_ARTIFACTS_TTL_MS } = await import("../src/diagnostics/artifacts.js");
    const root = await mkdtemp(join(tmpdir(), "mpp-runs-"));
    const now = Date.now();
    await createRunArtifacts(root, "zhihu", new Date(now - RUN_ARTIFACTS_TTL_MS - 60_000));
    await createRunArtifacts(root, "zhihu", new Date(now - 60_000));
    const removed = await pruneRunArtifacts(root, now);
    expect(removed).toBe(1);
  });

  it("pruneRunArtifacts 目录不存在时返回 0", async () => {
    const { pruneRunArtifacts } = await import("../src/diagnostics/artifacts.js");
    const removed = await pruneRunArtifacts(join(tmpdir(), "does-not-exist-mpp-runs"));
    expect(removed).toBe(0);
  });
});
