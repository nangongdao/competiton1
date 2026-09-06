/**
 * v4 Phase 2 · WEEKLY-03 周报投递渠道 —— server 侧投递器。
 *
 * 设计约束(ROADMAP_V4 §5):
 * - **凭据不落盘**:邮件 SMTP / Webhook 凭据只从环境变量读取,不进代码/请求体;
 * - **无凭据时明确提示不假装成功**:未配置 SMTP → 邮件渠道返回未配置;Webhook
 *   未配置 → 同样明确;
 * - **Webhook 白名单**:只允许投递到配置的白名单主机,防止周报被误发到任意 URL
 *   (SEC 基线延续);
 * - **邮件投递**:用 Node 内置 `net` 实现 SMTP 直发(不引入额外依赖),支持
 *   `MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS/MAIL_FROM/MAIL_TO`;若主机为空则
 *   视为未配置。
 *
 * 纯 Node(server 侧),不依赖浏览器 API;可被 `/weekly/send` 路由复用。
 */
import { createConnection } from "node:net";
import type { WeeklyDeliveryKind } from "@mpp/core";

/** 一次投递请求(与 core WeeklyDelivery 对齐,密钥字段不入请求体)。 */
export interface WeeklySendRequest {
  /** 报告 Markdown 全文。 */
  readonly report: string;
  /** 报告标题。 */
  readonly title: string;
  /** 投递渠道列表(目标如邮箱 / Webhook URL;密钥由 server 侧持有)。 */
  readonly deliveries: readonly {
    readonly kind: WeeklyDeliveryKind;
    readonly target?: string;
    readonly label?: string;
  }[];
}

/** 单渠道投递结果。 */
export interface WeeklySendResultItem {
  readonly kind: WeeklyDeliveryKind;
  readonly ok: boolean;
  readonly message: string;
}

/** 批量投递结果。 */
export interface WeeklySendResult {
  readonly ok: boolean;
  readonly results: readonly WeeklySendResultItem[];
  /** 全部渠道成功才算整体成功。 */
  readonly allDelivered: boolean;
}

/** 周报投递配置(从环境变量读取,凭据不落盘)。 */
export interface WeeklyDeliveryConfig {
  /** SMTP 服务器地址(未配置 → 邮件渠道不可用)。 */
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpUser: string;
  readonly smtpPass: string;
  /** 发件人地址(缺省用 user)。 */
  readonly smtpFrom: string;
  /** 允许投递的 Webhook 主机白名单(逗号分隔;空 = 禁止 Webhook 投递)。 */
  readonly webhookAllowHosts: readonly string[];
}

/** 从环境变量读取周报投递配置(凭据不落盘)。 */
export function loadWeeklyDeliveryConfig(env: Record<string, string | undefined> = process.env): WeeklyDeliveryConfig {
  return {
    smtpHost: env["MAIL_HOST"]?.trim() ?? "",
    smtpPort: Number(env["MAIL_PORT"] ?? 465),
    smtpUser: env["MAIL_USER"]?.trim() ?? "",
    smtpPass: env["MAIL_PASS"] ?? "",
    smtpFrom: env["MAIL_FROM"]?.trim() ?? "",
    webhookAllowHosts: (env["WEEKLY_WEBHOOK_HOSTS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** 判断邮件渠道是否已配置。 */
export function smtpConfigured(cfg: WeeklyDeliveryConfig): boolean {
  return !!(cfg.smtpHost && cfg.smtpUser && cfg.smtpPass);
}

/** 判断 Webhook 目标是否在白名单内。 */
export function isWebhookAllowed(cfg: WeeklyDeliveryConfig, target: string): boolean {
  if (cfg.webhookAllowHosts.length === 0) return false;
  try {
    const host = new URL(target).hostname;
    return cfg.webhookAllowHosts.some((allowed) => allowed === host || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/** 通过 SMTP 发送一封纯文本邮件(Node net 直连,无外部依赖)。 */
export async function sendEmailViaSmtp(
  cfg: WeeklyDeliveryConfig,
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; message: string }> {
  if (!smtpConfigured(cfg)) {
    return { ok: false, message: "未配置 SMTP 凭据(MAIL_HOST/MAIL_USER/MAIL_PASS);请先在 server .env 配置。" };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, message: `无效的收件邮箱: ${to}` };
  }
  return new Promise((resolve) => {
    const from = cfg.smtpFrom || cfg.smtpUser;
    const host = cfg.smtpHost;
    const port = cfg.smtpPort;
    let socket: ReturnType<typeof createConnection> | null = null;
    let buffer = "";
    let step = 0;
    let ok = false;
    let errorMsg = "";

    const fail = (msg: string) => {
      ok = false;
      errorMsg = msg;
      try {
        socket?.end();
      } catch {
        /* ignore */
      }
    };

    const sendLine = (line: string) => {
      try {
        socket?.write(`${line}\r\n`);
      } catch {
        fail("socket 写入失败");
      }
    };

    const buildBody = (): string => {
      const plain = body.replace(/\r?\n/g, "\r\n");
      // 用 7bit + quoted-printable 简化:直接逐行包 base64 太复杂,这里用简单 UTF-8
      // base64 编码整封正文以保证中文正确。
      const encoded = Buffer.from(plain, "utf8").toString("base64");
      const lines = encoded.match(/.{1,76}/g) ?? [encoded];
      const header = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
      ].join("\r\n");
      return `${header}\r\n${lines.join("\r\n")}\r\n.\r\n`;
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // 简单处理:等待带响应码的行(处理多行响应时取最后一个数字码)。
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^(\d{3})(?:[ -])/.exec(line);
        if (!match) continue;
        const code = Number(match[1]);
        if (code >= 400) {
          fail(`SMTP 服务器返回错误: ${code} ${line}`);
          return;
        }
        step += 1;
        switch (step) {
          case 1:
            // 220 greeting → EHLO
            sendLine(`EHLO ${host}`);
            break;
          case 2:
            // 250 EHLO → AUTH LOGIN
            sendLine("AUTH LOGIN");
            break;
          case 3:
            // 334 → username
            sendLine(Buffer.from(cfg.smtpUser, "utf8").toString("base64"));
            break;
          case 4:
            // 334 → password
            sendLine(Buffer.from(cfg.smtpPass, "utf8").toString("base64"));
            break;
          case 5:
            // 235 auth ok → MAIL FROM
            sendLine(`MAIL FROM:<${from}>`);
            break;
          case 6:
            // 250 MAIL FROM → RCPT TO
            sendLine(`RCPT TO:<${to}>`);
            break;
          case 7:
            // 250 RCPT TO → DATA
            sendLine("DATA");
            break;
          case 8:
            // 354 → body
            sendLine(buildBody());
            break;
          case 9:
            // 250 queued → QUIT
            ok = true;
            sendLine("QUIT");
            break;
          default:
            break;
        }
      }
    };

    const onError = (err: Error) => {
      fail(`SMTP 连接失败: ${err.message}`);
    };

    const onClose = () => {
      resolve(ok ? { ok: true, message: "邮件已发送" } : { ok: false, message: errorMsg || "SMTP 连接关闭" });
    };

    socket = createConnection({ host, port, timeout: 15000 });
    socket.setTimeout(15000);
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.on("timeout", () => {
      fail("SMTP 连接超时");
      socket?.destroy();
    });
  });
}

/** 投递一份周报到单个渠道。 */
export async function deliverWeekly(
  cfg: WeeklyDeliveryConfig,
  delivery: WeeklySendRequest["deliveries"][number],
  report: string,
  title: string,
): Promise<WeeklySendResultItem> {
  if (delivery.kind === "email") {
    const target = delivery.target;
    if (!target) return { kind: "email", ok: false, message: "未指定收件邮箱" };
    const res = await sendEmailViaSmtp(cfg, target, title, report);
    return { kind: "email", ok: res.ok, message: res.message };
  }
  if (delivery.kind === "webhook") {
    const target = delivery.target;
    if (!target) return { kind: "webhook", ok: false, message: "未指定 Webhook URL" };
    if (!isWebhookAllowed(cfg, target)) {
      return {
        kind: "webhook",
        ok: false,
        message: `Webhook 目标不在白名单(WEEKLY_WEBHOOK_HOSTS): ${target}`,
      };
    }
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, report, sentAt: new Date().toISOString() }),
      });
      if (!res.ok) {
        return { kind: "webhook", ok: false, message: `Webhook 返回 ${res.status}` };
      }
      return { kind: "webhook", ok: true, message: `Webhook 已送达(${res.status})` };
    } catch (err) {
      return { kind: "webhook", ok: false, message: `Webhook 投递失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  // file 渠道在 server 侧无意义(由 app 导出),返回明确提示。
  return { kind: "file", ok: false, message: "文件渠道由客户端导出,无需 server 投递" };
}

/** 批量投递一份周报(多渠道)。 */
export async function sendWeeklyReport(
  cfg: WeeklyDeliveryConfig,
  request: WeeklySendRequest,
): Promise<WeeklySendResult> {
  const results: WeeklySendResultItem[] = [];
  for (const delivery of request.deliveries) {
    results.push(await deliverWeekly(cfg, delivery, request.report, request.title));
  }
  const allDelivered = results.length > 0 && results.every((r) => r.ok);
  return {
    ok: allDelivered,
    results,
    allDelivered,
  };
}
