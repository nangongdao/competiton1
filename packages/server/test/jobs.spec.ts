/**
 * server 发布任务持久化集成测试 —— 任务 REST API + FileJobStore 落盘 + 进程重启恢复。
 *
 * 覆盖:
 * - POST /jobs 创建并运行(公众号 draft/add 调用一次,任务持久化落盘);
 * - GET /jobs 列表只返回元信息(不含正文 payload);
 * - 鉴权:/jobs/* 无 token → 401;
 * - 未配置凭据时禁止创建但可查历史;
 * - 进程重启恢复:同一数据目录重建 app → 从 checkpoint 续跑,不重复已成功平台。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { WechatPublisher, type ImageFetcher } from "../src/wechat/rehost.js";
import { ServerJobService } from "../src/jobs/service.js";
import { FILE_JOBS_FILE } from "@mpp/core/jobs/file-store";

let tmpDirs: string[] = [];
let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mpp-server-jobs-"));
  tmpDirs.push(dataDir);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

/** 测试用图片抓取器:任何 URL 都返回一张假 PNG。 */
function mockFetcher(): ImageFetcher {
  return async (url) => ({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/png",
    finalUrl: url,
  });
}

function testPublisher(): WechatPublisher {
  return new WechatPublisher("appid", "secret", { imageFetcher: mockFetcher() });
}

function authedConfig(): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    dataDir,
    wechat: { appId: "appid", secret: "secret", configured: true },
    localStore: { maxTotalBytes: 1024 * 1024, maxFileBytes: 1024, retentionMs: 0, cleanupEnabled: false },
  };
}

function unconfiguredConfig(): ServerConfig {
  return { ...authedConfig(), wechat: { appId: "", secret: "", configured: false } };
}

/** stub 微信 API:记录 draft/add 调用次数。 */
function stubWechatApi() {
  let draftAddCalls = 0;
  let publishCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
      if (url.includes("/cgi-bin/stable_token")) body.access_token = "TOKEN";
      if (url.includes("/draft/add")) {
        draftAddCalls++;
        body.media_id = "MEDIA_1";
      }
      if (url.includes("/material/add_material")) body.media_id = "THUMB_1";
      if (url.includes("/freepublish/submit")) {
        publishCalls++;
        body.publish_id = "PUB_1";
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { draftAddCalls: () => draftAddCalls, publishCalls: () => publishCalls };
}

const headers = { "x-mpp-token": "test-token", "content-type": "application/json" };
const samplePayload = {
  title: "标题",
  content: "<p>正文</p>",
  coverImageUrl: "https://example.com/c.png",
  bodyImageUrls: ["https://example.com/1.png", "https://example.com/2.png"],
};

describe("server 任务 REST API —— 创建/查询/持久化", () => {
  it("POST /jobs 创建并运行公众号任务,任务落盘持久化", async () => {
    const { draftAddCalls } = stubWechatApi();
    const app = await buildServerApp({
      config: authedConfig(),
      wechatPublisher: testPublisher(),
    });

    const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: samplePayload });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.job.id).toBeTruthy();
    expect(body.job.platforms[0].platformId).toBe("wechat");
    // 公众号 draft/add 被调用一次。
    expect(draftAddCalls()).toBe(1);

    // 任务持久化到磁盘。
    const file = join(dataDir, "jobs", FILE_JOBS_FILE);
    const raw = await readFile(file, "utf8");
    expect(raw).toContain(body.job.id);
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBeDefined();

    // 详情接口返回 payload 摘要。
    const detail = await app.inject({ method: "GET", url: `/jobs/${body.job.id}`, headers });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json();
    expect(detailBody.job.payloadPreview).toBeTruthy();
    expect(detailBody.job.payloadPreview.title).toBe("标题");
    expect(detailBody.job.payloadPreview.contentLength).toBe(samplePayload.content.length);

    // 列表接口只返回元信息,不含 payload 正文。
    const list = await app.inject({ method: "GET", url: "/jobs", headers });
    expect(list.statusCode).toBe(200);
    const listBody = list.json();
    expect(listBody.jobs).toHaveLength(1);
    expect(listBody.jobs[0].contentDigest).toBeTruthy();
    expect(JSON.stringify(listBody)).not.toContain("<p>正文</p>");

    await app.close();
  });

  it("/jobs/* 无 token → 401(鉴权强制)", async () => {
    stubWechatApi();
    const app = await buildServerApp({
      config: authedConfig(),
      wechatPublisher: testPublisher(),
    });
    const res = await app.inject({ method: "GET", url: "/jobs" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("未配置凭据时禁止创建任务,但可查历史", async () => {
    stubWechatApi();
    const app = await buildServerApp({
      config: unconfiguredConfig(),
      wechatPublisher: testPublisher(),
    });
    const create = await app.inject({ method: "POST", url: "/jobs", headers, payload: samplePayload });
    expect(create.statusCode).toBe(400);
    expect(String(create.json().message)).toContain("未配置公众号凭据");

    const list = await app.inject({ method: "GET", url: "/jobs", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs).toHaveLength(0);
    await app.close();
  });

  it("畸形请求体被 schema 拒绝(进入副作用前)", async () => {
    stubWechatApi();
    const app = await buildServerApp({
      config: authedConfig(),
      wechatPublisher: testPublisher(),
    });
    const bad = await app.inject({ method: "POST", url: "/jobs", headers, payload: { content: 123 } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe("server 任务 —— 进程重启恢复(checkpoint 续跑)", () => {
  it("同一数据目录重建 app → 未完成任务恢复,不重复已成功平台", async () => {
    const { draftAddCalls } = stubWechatApi();
    // 第一次:创建并运行成功任务。
    const app1 = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher() });
    const res = await app1.inject({ method: "POST", url: "/jobs", headers, payload: samplePayload });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().job.id;
    await app1.close();
    expect(draftAddCalls()).toBe(1);

    // 模拟"进程重启":同一数据目录重建新 app。
    const app2 = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher() });
    const list = await app2.inject({ method: "GET", url: "/jobs", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs).toHaveLength(1);
    expect(list.json().jobs[0].id).toBe(jobId);

    // resume 已成功任务 → checkpoint 跳过,不重复平台副作用。
    const resume = await app2.inject({ method: "POST", url: `/jobs/${jobId}/resume`, headers, payload: {} });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().job.platforms[0].stage).toBe("succeeded");
    // draft/add 仍只调用 1 次(重启后恢复不重复提交)。
    expect(draftAddCalls()).toBe(1);
    await app2.close();
  });

  it("cancel 后任务进入 cancelled 终态", async () => {
    const { draftAddCalls } = stubWechatApi();
    const app = await buildServerApp({ config: authedConfig(), wechatPublisher: testPublisher() });
    const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: samplePayload });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().job.id;

    const cancel = await app.inject({ method: "POST", url: `/jobs/${jobId}/cancel`, headers, payload: {} });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().job.stage).toBe("cancelled");
    expect(draftAddCalls()).toBe(1);
    await app.close();
  });
});

describe("ServerJobService —— 直接单元测试(注入 mock executor)", () => {
  it("payload 预写 + createAndRun 完成发布,payload 可从磁盘恢复", async () => {
    const publisher = testPublisher();
    const service = new ServerJobService({
      dataDir,
      publisher,
      publish: false,
    });
    await service.load();

    const job = await service.createAndRun({
      payload: {
        title: "T",
        content: "<p>c</p>",
        mime: "text/html",
        tags: [],
        imageAssetIds: [],
        extra: { coverImageUrl: "https://example.com/c.png" },
      },
      platformId: "wechat",
    });
    expect(job.stage).toBe("succeeded");
    expect(job.platformJobs[0]?.stage).toBe("succeeded");

    // payload 随任务持久化。
    const payload = await service.platformPayload(job.id, "wechat");
    expect(payload?.title).toBe("T");
    expect(payload?.extra?.coverImageUrl).toBe("https://example.com/c.png");

    // 重建服务 → 从磁盘恢复任务 + payload。
    const service2 = new ServerJobService({ dataDir, publisher, publish: false });
    await service2.load();
    const restored = await service2.get(job.id);
    expect(restored?.id).toBe(job.id);
    const restoredPayload = await service2.platformPayload(job.id, "wechat");
    expect(restoredPayload?.title).toBe("T");
  });
});
