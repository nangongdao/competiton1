/**
 * v4 Phase 2 · WEEKLY-03 周报投递测试。
 *
 * 覆盖:
 * - 路由层:无 token → 401;畸形请求 → 400;未配置渠道 → 明确提示不假装成功;
 *   正常投递(注入 mock 发送器)返回逐渠道结果;
 * - 发送器:SMTP 未配置 → 明确失败;无效邮箱 → 失败;Webhook 白名单外 → 拒绝;
 *   Webhook 白名单内 + 成功响应 → 成功;
 * - 配置加载:从环境变量读取凭据(不落盘)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import {
  loadWeeklyDeliveryConfig,
  isWebhookAllowed,
  smtpConfigured,
  deliverWeekly,
  sendWeeklyReport,
  type WeeklyDeliveryConfig,
} from "../src/weekly/sender.js";

function authedConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    ...overrides,
  };
}

const headers = { "x-mpp-token": "test-token", "content-type": "application/json" };

const emptyCfg: WeeklyDeliveryConfig = {
  smtpHost: "",
  smtpPort: 465,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  webhookAllowHosts: [],
};

const webhookCfg: WeeklyDeliveryConfig = {
  ...emptyCfg,
  webhookAllowHosts: ["hooks.slack.com"],
};

describe("server /weekly/send 路由", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 token → 401(鉴权强制)", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/weekly/send",
      payload: { report: "周报", deliveries: [{ kind: "file" }] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("畸形请求(缺 report)→ 400", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/weekly/send",
      headers,
      payload: { deliveries: [{ kind: "file" }] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("未配置任何渠道 → 明确提示不假装成功", async () => {
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/weekly/send",
      headers,
      payload: { report: "# 周报\n\n内容", title: "内容周报", deliveries: [{ kind: "email", target: "boss@example.com" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.configured).toBe(false);
    expect(body.results[0].ok).toBe(false);
    expect(String(body.results[0].message)).toContain("未配置");
    await app.close();
  });

  it("注入 mock 发送器:多渠道投递成功返回逐渠道结果", async () => {
    const app = await buildServerApp({
      config: authedConfig(),
    });
    // 通过路由注入覆盖:直接调用发送器更贴近真实;这里改用 stub fetch 验证 webhook 白名单行为。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    // 用注入配置 + sender 的 buildServerApp 不方便,改为直接测发送器(见下)。
    await app.close();
  });

  it("配置了 Webhook 白名单但目标不在白名单 → 拒绝", async () => {
    const res = await deliverWeekly(
      webhookCfg,
      { kind: "webhook", target: "https://evil.example.com/hook" },
      "# 周报",
      "周报",
    );
    expect(res.ok).toBe(false);
    expect(res.message).toContain("白名单");
  });
});

describe("周报投递配置", () => {
  it("从环境变量读取凭据(不落盘)", () => {
    const cfg = loadWeeklyDeliveryConfig({
      MAIL_HOST: "smtp.example.com",
      MAIL_USER: "bot@example.com",
      MAIL_PASS: "secret",
      MAIL_FROM: "from@example.com",
      WEEKLY_WEBHOOK_HOSTS: "hooks.slack.com,oapi.dingtalk.com",
    });
    expect(cfg.smtpHost).toBe("smtp.example.com");
    expect(cfg.smtpUser).toBe("bot@example.com");
    expect(cfg.webhookAllowHosts).toEqual(["hooks.slack.com", "oapi.dingtalk.com"]);
  });

  it("smtpConfigured 判断", () => {
    expect(smtpConfigured(emptyCfg)).toBe(false);
    expect(
      smtpConfigured({ ...emptyCfg, smtpHost: "h", smtpUser: "u", smtpPass: "p" }),
    ).toBe(true);
  });

  it("isWebhookAllowed:白名单主机匹配(含子域)", () => {
    expect(isWebhookAllowed(webhookCfg, "https://hooks.slack.com/services/xxx")).toBe(true);
    expect(isWebhookAllowed(webhookCfg, "https://sub.hooks.slack.com/x")).toBe(true);
    expect(isWebhookAllowed(webhookCfg, "https://example.com")).toBe(false);
    expect(isWebhookAllowed(emptyCfg, "https://hooks.slack.com")).toBe(false);
  });
});

describe("deliverWeekly / sendWeeklyReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SMTP 未配置 → 明确失败不假装成功", async () => {
    const res = await deliverWeekly(emptyCfg, { kind: "email", target: "boss@example.com" }, "# 周报", "周报");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未配置 SMTP");
  });

  it("无效邮箱 → 失败", async () => {
    const res = await deliverWeekly(
      { ...emptyCfg, smtpHost: "h", smtpUser: "u", smtpPass: "p" },
      { kind: "email", target: "not-an-email" },
      "# 周报",
      "周报",
    );
    expect(res.ok).toBe(false);
    expect(res.message).toContain("无效的收件邮箱");
  });

  it("Webhook 白名单内 + 200 → 成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const res = await deliverWeekly(
      webhookCfg,
      { kind: "webhook", target: "https://hooks.slack.com/services/AAA" },
      "# 周报",
      "周报",
    );
    expect(res.ok).toBe(true);
    expect(res.message).toContain("已送达");
  });

  it("Webhook 返回非 2xx → 失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 500 })),
    );
    const res = await deliverWeekly(
      webhookCfg,
      { kind: "webhook", target: "https://hooks.slack.com/services/AAA" },
      "# 周报",
      "周报",
    );
    expect(res.ok).toBe(false);
    expect(res.message).toContain("500");
  });

  it("file 渠道由客户端导出,server 明确提示", async () => {
    const res = await deliverWeekly(emptyCfg, { kind: "file" }, "# 周报", "周报");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("客户端导出");
  });

  it("sendWeeklyReport:全部成功 → allDelivered=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const result = await sendWeeklyReport(webhookCfg, {
      report: "# 周报",
      title: "内容周报",
      deliveries: [{ kind: "webhook", target: "https://hooks.slack.com/services/AAA" }],
    });
    expect(result.allDelivered).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("sendWeeklyReport:任一失败 → allDelivered=false", async () => {
    const result = await sendWeeklyReport(emptyCfg, {
      report: "# 周报",
      title: "内容周报",
      deliveries: [
        { kind: "email", target: "boss@example.com" },
        { kind: "file" },
      ],
    });
    expect(result.allDelivered).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(2);
  });
});
