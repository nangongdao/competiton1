import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_PATH = resolve("packages/server/.env");

describe("server config", () => {
  const originalCwd = process.cwd();
  const originalAppId = process.env["WECHAT_APPID"];
  const originalSecret = process.env["WECHAT_SECRET"];

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv("WECHAT_APPID", originalAppId);
    restoreEnv("WECHAT_SECRET", originalSecret);
    vi.resetModules();
  });

  it.runIf(existsSync(ENV_PATH))("loads packages/server/.env when started from repo root", async () => {
    const envText = readFileSync(ENV_PATH, "utf8");
    const hasWechatCredentials = /^WECHAT_APPID=.+$/m.test(envText) && /^WECHAT_SECRET=.+$/m.test(envText);
    expect(hasWechatCredentials).toBe(true);

    process.chdir(resolve("."));
    delete process.env["WECHAT_APPID"];
    delete process.env["WECHAT_SECRET"];
    vi.resetModules();

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.wechat.configured).toBe(true);
  });
});

function restoreEnv(key: "WECHAT_APPID" | "WECHAT_SECRET", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("server config — 安全与配额字段", () => {
  it("默认生成高熵 token 并启用鉴权", async () => {
    delete process.env["MP_SERVER_TOKEN"];
    delete process.env["MP_AUTH_DISABLED"];
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.token).toMatch(/^[0-9a-f]{64}$/);
    expect(config.authEnabled).toBe(true);
  });

  it("可显式指定 token 与关闭鉴权", async () => {
    process.env["MP_SERVER_TOKEN"] = "fixed-token";
    process.env["MP_AUTH_DISABLED"] = "true";
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.token).toBe("fixed-token");
    expect(config.authEnabled).toBe(false);
    delete process.env["MP_SERVER_TOKEN"];
    delete process.env["MP_AUTH_DISABLED"];
  });

  it("图片抓取与图床配额有默认值", async () => {
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.imageFetch.maxBytes).toBeGreaterThan(0);
    expect(config.imageFetch.allowedMimeTypes).toContain("image/png");
    expect(config.localStore.maxTotalBytes).toBeGreaterThan(0);
    expect(config.localStore.retentionMs).toBeGreaterThan(0);
  });
});
