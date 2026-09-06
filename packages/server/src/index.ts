/**
 * server 入口 —— Fastify,仅 localhost,CORS 限扩展/本地来源,capability token 鉴权。
 *
 * 默认不需要它(全平台模拟发布);仅当配置公众号凭据并需真实发布时启动。
 * 启动:在 packages/server 复制 .env.example 为 .env 填入凭据,然后 npm run server。
 *
 * 安全基线(SEC-01/03):
 * - capability token:副作用路由(/upload、/wechat/publish)必须携带 X-MPP-Token;
 * - /health 只返回非敏感摘要;
 * - JSON Schema 校验 + body limit + 统一错误 envelope;
 * - 图片拉取经 SecureImageFetcher(SSRF 权威边界)。
 */
import Fastify from "fastify";
import type { FastifyError, FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadConfig, type ServerConfig } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWechatRoutes } from "./routes/wechat.js";
import { registerPlatformApiRoutes } from "./routes/platform-api.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerInboxRoutes } from "./routes/inbox.js";
import { registerUploadRoutes } from "./routes/upload.js";
import { registerWeeklyRoutes } from "./routes/weekly.js";
import { registerShareRoutes } from "./routes/share.js";
import { createImageHost } from "./imagehost/factory.js";
import { LocalImageHost } from "./imagehost/local-host.js";
import { registerAuth } from "./security/auth.js";
import { WechatPublisher, type ImageFetcher } from "./wechat/rehost.js";
import { WechatAccountRegistry } from "./wechat/accounts.js";
import { ServerJobService } from "./jobs/service.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { FileSharedStore } from "./shared/store.js";

export interface ServerAppOptions {
  readonly config?: ServerConfig;
  /** 注入公众号发布器(默认按配置创建单例,生命周期复用)。 */
  readonly wechatPublisher?: WechatPublisher;
  /** 注入任务服务(默认按配置 + publisher 创建,数据落 data/jobs)。 */
  readonly jobService?: ServerJobService;
  /** ACCOUNT-03:注入图片抓取器(默认 SecureImageFetcher;测试可替换)。 */
  readonly imageFetcher?: ImageFetcher;
  /** COLLAB-01:注入共享内容存储(默认 FileSharedStore,dataDir 派生)。 */
  readonly sharedStore?: import("@mpp/core").SharedStore;
}

/**
 * 构建 Fastify 应用(可测试基座)。
 *
 * 与 main() 分离:所有路由可经 app.inject() 做集成测试;测试可注入 config/publisher,
 * 不必真正监听端口。
 */
export async function buildServerApp(options: ServerAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    // 每个请求分配 reqId(优先用上游 x-request-id),贯穿该请求所有日志行。
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return (Array.isArray(header) ? header[0] : header) ?? crypto.randomUUID();
    },
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      // 请求级结构化日志:记录方法/路径/状态/耗时(绝不记录 token/凭据)。
      serializers: {
        req(req) {
          return { method: req.method, url: req.url };
        },
      },
    },
  });

  // 请求完成时记录耗时(结构化:reqId 由 Fastify 自动附加)。
  app.addHook("onResponse", (req, reply, done) => {
    req.log.info({ statusCode: reply.statusCode, ms: Math.round(reply.elapsedTime) }, "请求完成");
    done();
  });

  // 限流:防止本地 server 被异常高频调用打满(默认每分钟 120 次/IP)。
  await app.register(rateLimit, {
    max: Number(process.env["RATE_LIMIT_MAX"] ?? 120),
    timeWindow: "1 minute",
  });

  // CORS:允许扩展(chrome-extension://)与本地开发页面调用。
  await app.register(cors, {
    origin: [/^chrome-extension:\/\//, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
  });

  // multipart:接收图片上传(限制单文件 10MB,与 localStore.maxFileBytes 一致)。
  await app.register(multipart, { limits: { fileSize: config.localStore.maxFileBytes } });

  // 静态服务:暴露 local 图床落盘目录为 /uploads/*。
  const uploadsDir = resolve(config.imageHost.localDir);
  await mkdir(uploadsDir, { recursive: true });
  await app.register(fastifyStatic, { root: uploadsDir, prefix: "/uploads/" });

  // capability token 鉴权(副作用路由强制)。
  registerAuth(app, { token: config.token, enabled: config.authEnabled });

  // 图床(按配置选择 local/s3)。
  const imageHost = createImageHost(config, (msg) => app.log.warn(msg));
  // 启动时清理过期图片(配额保留策略)。
  if (imageHost instanceof LocalImageHost) {
    void imageHost.cleanup();
  }

  // 统一错误 envelope:所有未捕获异常返回 { ok:false, error, statusCode },避免泄露堆栈。
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const statusCode = err.statusCode ?? 500;
    // 5xx 记完整错误(含堆栈)便于排查;4xx 只记简要信息。
    if (statusCode >= 500) req.log.error({ err }, "请求处理失败");
    else req.log.warn({ msg: err.message }, "请求被拒绝");
    void reply.status(statusCode).send({
      ok: false,
      error: err.message || "内部错误",
      statusCode,
    });
  });

  // 404 统一 envelope。
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ ok: false, error: `未找到路由 ${req.method} ${req.url}`, statusCode: 404 });
  });

  // 单例发布器:整个应用生命周期复用,幂等缓存跨请求生效(REL-01/REL-02)。
  const publisher =
    options.wechatPublisher ??
    new WechatPublisher(config.wechat.appId, config.wechat.secret, { imageFetch: config.imageFetch });

  // ACCOUNT-03:多公众号账号注册表(按 serverProfileId 路由发布/连接/指标)。
  const accountRegistry = new WechatAccountRegistry({
    appId: config.wechat.appId,
    secret: config.wechat.secret,
    profiles: config.wechat.profiles,
    imageFetch: config.imageFetch,
    defaultPublisher: publisher,
    ...(options.imageFetcher ? { imageFetcher: options.imageFetcher } : {}),
  });

  registerHealthRoutes(app, config);
  registerWechatRoutes(app, config, publisher, accountRegistry);
  registerPlatformApiRoutes(app, config, accountRegistry);
  registerMetricsRoutes(app, { config, accountRegistry });
  registerInboxRoutes(app, { config, accountRegistry });
  registerUploadRoutes(app, imageHost, config);
  registerWeeklyRoutes(app);

  // v4 Phase 3 · COLLAB-01/04 协作共享:共享内容 REST API(强制 X-MPP-Token 鉴权)。
  // 默认用 FileSharedStore 落盘 data/shared-items.json;支持 SYNC_URL 远程同步声明。
  const sharedStore =
    options.sharedStore ?? new FileSharedStore(resolve(config.dataDir));
  registerShareRoutes(app, { store: sharedStore, syncUrl: config.syncUrl });

  // 发布任务持久化服务(FileJobStore + PublishJobService + 公众号执行器)。
  // 进程重启后可从磁盘恢复未完成任务(checkpoint 续跑)。
  const jobService =
    options.jobService ??
    new ServerJobService({
      dataDir: resolve(config.dataDir),
      publisher,
      publish: false,
    });
  await jobService.load();
  registerJobRoutes(app, {
    jobs: jobService,
    canCreate: config.wechat.configured,
  });

  return app;
}

/** 纯启动入口:监听 127.0.0.1 并输出启动信息。 */
export async function startServer(config: ServerConfig): Promise<void> {
  const app = await buildServerApp({ config });
  try {
    await app.listen({ port: config.port, host: "127.0.0.1" });
    app.log.info(
      `多平台发布工具 server 已启动:http://127.0.0.1:${config.port}  ` +
        `公众号凭据:${config.wechat.configured ? "已配置" : "未配置(仅模拟)"}  ` +
        `鉴权:${config.authEnabled ? "启用" : "关闭(测试模式)"}`,
    );
    if (config.authEnabled) {
      // 配对提示(仅 stdout):用户把该 token 填入扩展设置的 Server 访问令牌。
      // eslint-disable-next-line no-console
      console.log(`[mpp-server] X-MPP-Token: ${config.token}`);
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await startServer(loadConfig());
}

// 仅在作为主入口执行时启动 server;被测试/其它模块 import 时不产生副作用。
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
