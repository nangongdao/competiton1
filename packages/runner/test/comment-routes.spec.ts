/**
 * INBOX-04 runner 评论同步/自动回复路由测试 —— /inbox/sync、/inbox/reply、/inbox/auto-reply。
 *
 * 无浏览器环境:注入 mock opener(返回空 context),验证路由契约与错误路径;
 * 选择器契约/归一化在 comment-automation.spec.ts 覆盖。
 */
import { describe, expect, it } from "vitest";
import { buildRunnerApp } from "../src/server.js";
import { loadRunnerConfig } from "../src/config.js";
import type { RunnerConfig } from "../src/config.js";

function testConfig(): RunnerConfig {
  return { ...loadRunnerConfig({}), token: "test-token", authEnabled: false };
}

/** mock opener:返回空 BrowserContext(mock pages),不启动真实浏览器。 */
function mockOpener() {
  return async () => ({ pages: () => [] }) as never;
}

describe("runner INBOX-04 评论路由", () => {
  it("/inbox/sync 拒绝公众号平台(走 server)", async () => {
    const app = await buildRunnerApp({ config: testConfig(), platformApiSessionOpener: mockOpener() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/sync",
      payload: { platformId: "wechat" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("公众号请走 server");
  });

  it("/inbox/sync 未知平台 400", async () => {
    const app = await buildRunnerApp({ config: testConfig(), platformApiSessionOpener: mockOpener() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/sync",
      payload: { platformId: "unknown-foo" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("/inbox/sync 会话平台走浏览器路径(无浏览器 → 失败但路径正确)", async () => {
    const app = await buildRunnerApp({ config: testConfig(), platformApiSessionOpener: mockOpener() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/sync",
      payload: { platformId: "zhihu" },
    });
    const json = res.json() as { ok: boolean; platformId: string };
    expect(json.platformId).toBe("zhihu");
    expect(json.ok).toBe(false); // 无真实浏览器/登录态 → 失败,但说明走对了 opener 路径
  });

  it("/inbox/reply 拒绝公众号平台", async () => {
    const app = await buildRunnerApp({ config: testConfig(), platformApiSessionOpener: mockOpener() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/reply",
      payload: { platformId: "wechat", message: { id: "m1" }, text: "hi" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("/inbox/reply 缺少 text → 400", async () => {
    const app = await buildRunnerApp({ config: testConfig(), platformApiSessionOpener: mockOpener() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/reply",
      payload: { platformId: "zhihu", message: { id: "m1" }, text: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("/inbox/auto-reply 空消息 → 直接返回(计划 0)", async () => {
    const app = await buildRunnerApp({ config: testConfig(), platformApiSessionOpener: mockOpener() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/auto-reply",
      payload: { platformId: "zhihu", messages: [] },
    });
    const json = res.json() as { planned: number };
    expect(json.planned).toBe(0);
  });
});
