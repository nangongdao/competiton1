import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { loadRunnerConfig, type RunnerConfig } from "./config.js";
import { registerRunnerAuth } from "./auth.js";
import {
  isAutomationPlatformId,
  parseAutomationPublishRequest,
  type AutomationPlatformId,
  type AutomationPublishReceipt,
  type AutomationPublishRequest,
} from "./types.js";
import { BrowserSessionManager } from "./browser/session.js";
import { getAutomationAdapter } from "./platforms/registry.js";
import { createRunArtifacts, pruneRunArtifacts } from "./diagnostics/artifacts.js";
import { StepTimer, type PublishStep } from "./diagnostics/step-timer.js";
import { registerPlatformApiConnectRoute, type PlatformApiConnectOptions } from "./platform-api/routes.js";
import { registerRunnerInboxRoutes } from "./comment/routes.js";
import { assertAllCommentSelectors } from "./comment/selectors.js";

export type AutomationPublisher = (request: AutomationPublishRequest) => Promise<AutomationPublishReceipt>;

export interface RunnerAppOptions {
  readonly config?: RunnerConfig;
  readonly publisher?: AutomationPublisher;
  readonly openSession?: (platformId: AutomationPlatformId) => Promise<AutomationPublishReceipt>;
  readonly closeSession?: (platformId?: AutomationPlatformId) => Promise<{ ok: boolean; message: string }>;
  /** 平台 API 连接检查的 HTTP 客户端(CSDN 官方接口;测试可注入 mock)。 */
  readonly platformApiHttp?: PlatformApiConnectOptions["http"];
  /** 平台 API 连接检查的浏览器会话打开器(测试可注入 mock)。 */
  readonly platformApiSessionOpener?: PlatformApiConnectOptions["opener"];
}

export async function buildRunnerApp(options: RunnerAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadRunnerConfig();
  const app = Fastify({ logger: false });
  const sessionManager = new BrowserSessionManager();
  const publisher = options.publisher ?? ((request) => defaultPublisher(request, config, sessionManager));

  await app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^chrome-extension:\/\//],
  });

  // capability token 鉴权:所有副作用路由(/automation/*)必须携带 X-MPP-Token。
  registerRunnerAuth(app, { token: config.token, enabled: config.authEnabled });

  // 平台 API 一键连接(会话平台走浏览器登录态,CSDN 走官方接口)。
  registerPlatformApiConnectRoute(app, {
    opener: options.platformApiSessionOpener ?? {
      open: (platformId, headless, profileDir) =>
        sessionManager.open({
          profilesRoot: config.profilesDir,
          platformId: platformId as AutomationPlatformId,
          headless,
          ...(profileDir ? { profileDir } : {}),
        }),
    },
    http: options.platformApiHttp,
  });

  // INBOX-04:网页自动化评论同步 / 自动回复回发(会话平台;公众号走 server)。
  assertAllCommentSelectors();
  registerRunnerInboxRoutes(app, {
    opener: options.platformApiSessionOpener ?? {
      open: (platformId, headless, profileDir) =>
        sessionManager.open({
          profilesRoot: config.profilesDir,
          platformId: platformId as AutomationPlatformId,
          headless,
          ...(profileDir ? { profileDir } : {}),
        }),
    },
  });

  app.get("/health", async () => ({
    ok: true,
    runner: "playwright",
    browser: { installed: await isPlaywrightAvailable() },
    profilesDir: config.profilesDir,
    runsDir: config.runsDir,
  }));

  app.post("/automation/publish", async (request, reply) => {
    let parsed: AutomationPublishRequest;
    try {
      parsed = parseAutomationPublishRequest(request.body);
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return publisher(parsed);
  });

  app.post("/automation/session/open", async (request, reply) => {
    const platformId = readOptionalPlatformId(request.body);
    if (!platformId) return reply.code(400).send({ ok: false, error: "unsupported platformId" });
    if (options.openSession) return options.openSession(platformId);
    return {
      ok: false,
      status: "needs-user-action",
      message: "Playwright browser session is not initialized yet; start the runner with browser support.",
    } satisfies AutomationPublishReceipt;
  });

  app.post("/automation/session/close", async (request, reply) => {
    const platformId = readOptionalPlatformId(request.body);
    if (request.body !== undefined && platformId === undefined) {
      return reply.code(400).send({ ok: false, error: "unsupported platformId" });
    }
    if (options.closeSession) return options.closeSession(platformId);
    return { ok: true, message: "no active browser session" };
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({ ok: false, error: `route not found: ${request.method} ${request.url}` });
  });

  return app;
}

async function defaultPublisher(
  request: AutomationPublishRequest,
  config: RunnerConfig,
  sessionManager: BrowserSessionManager,
): Promise<AutomationPublishReceipt> {
  // 诊断工件:记录脱敏 request/receipt,失败可定位到具体运行目录(OBS-01)。
  const artifacts = await createRunArtifacts(config.runsDir, request.platformId);
  await artifacts.writeJson("request", request);

  // §6.2:分步耗时观测,定位启动/选择器/事件等待瓶颈。
  const timer = new StepTimer();
  const stepBudgets: Partial<Record<PublishStep, number>> = {
    "open-session": 5_000,
    "goto-editor": 15_000,
    prepare: 5_000,
    confirm: 2_000,
    submit: 10_000,
    verify: 5_000,
  };
  const withTiming = (receipt: AutomationPublishReceipt): AutomationPublishReceipt => {
    const summary = timer.summarize(stepBudgets);
    return { ...receipt, timing: { totalMs: summary.totalMs, samples: summary.samples } };
  };

  const adapter = getAutomationAdapter(request.platformId);
  try {
    const endOpen = timer.begin("open-session", "打开浏览器会话", stepBudgets["open-session"]);
    const context = await sessionManager.open({
      profilesRoot: config.profilesDir,
      platformId: request.platformId,
      profileDir: request.options?.profileDir,
      headless: request.options?.headless,
      slowMoMs: request.options?.slowMoMs,
    });
    endOpen();
    const page = context.pages()[0] ?? (await context.newPage());
    const endGoto = timer.begin("goto-editor", "打开平台编辑器", stepBudgets["goto-editor"]);
    await page.goto(adapter.editorUrl, { waitUntil: "domcontentloaded", timeout: request.options?.timeoutMs ?? 60_000 });
    endGoto();

    // RUN-01:prepare → confirm → submit → verify 四段式。
    const endPrepare = timer.begin("prepare", "检测登录/风控与页面就绪", stepBudgets.prepare);
    await adapter.prepare(page, request);
    endPrepare();

    // confirm:full-auto 二次确认绑定内容摘要,篡改拒绝。
    const endConfirm = timer.begin("confirm", "二次确认绑定内容摘要", stepBudgets.confirm);
    const confirmReceipt = await adapter.confirm(page, request);
    endConfirm();
    if (confirmReceipt) {
      const final = withTiming({ ...confirmReceipt, diagnosticsPath: artifacts.dir });
      await artifacts.writeJson("receipt", final);
      await artifacts.capture(page, "failure");
      return final;
    }

    // submit:点击保存/发布(先返回 submitted,不宣称 published)。
    const endSubmit = timer.begin("submit", "填写并点击保存/发布", stepBudgets.submit);
    const submitReceipt = await adapter.submit(page, request);
    endSubmit();
    if (!submitReceipt.ok) {
      const final = withTiming({ ...submitReceipt, diagnosticsPath: artifacts.dir });
      await artifacts.writeJson("receipt", final);
      await artifacts.capture(page, "failure");
      return final;
    }
    await artifacts.writeJson("receipt", { ...submitReceipt, diagnosticsPath: artifacts.dir });

    // verify:核验平台侧成功证据,升级 published/drafted/unknown。
    const endVerify = timer.begin("verify", "核验平台侧成功证据", stepBudgets.verify);
    const verifyReceipt = await adapter.verify(page, request, submitReceipt);
    endVerify();
    const finalVerified = withTiming({ ...verifyReceipt, diagnosticsPath: artifacts.dir });
    await artifacts.writeJson("receipt", finalVerified);
    await artifacts.capture(page, verifyReceipt.status === "published" ? "final" : "failure");
    return finalVerified;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("人工处理") ? "needs-user-action" : "failed";
    const receipt: AutomationPublishReceipt = {
      ok: false,
      status,
      message: `自动化发布失败: ${message}`,
      diagnosticsPath: artifacts.dir,
    };
    const final = withTiming(receipt);
    await artifacts.writeJson("receipt", { ...final, error: message });
    return final;
  } finally {
    // OBS-01:每次运行后清理过期/超量诊断工件。
    await pruneRunArtifacts(config.runsDir).catch(() => undefined);
  }
}

async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

function readOptionalPlatformId(body: unknown): AutomationPlatformId | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as { platformId?: unknown }).platformId;
  return isAutomationPlatformId(value) ? value : undefined;
}
