/**
 * server 发布任务 REST API —— 把持久化的公众号发布任务暴露给客户端。
 *
 * 鉴权:所有 /jobs/* 均为副作用/敏感路由,经 registerAuth 强制 X-MPP-Token。
 *
 * 路由:
 * - GET  /jobs                任务列表(不含 payload 正文,只给元信息)
 * - GET  /jobs/:id            任务详情(含持久化 payload 摘要与诊断引用)
 * - POST /jobs                创建并运行公众号发布任务(请求体 = 发布请求 + publish 意图)
 * - POST /jobs/:id/retry      重试指定平台
 * - POST /jobs/:id/cancel     取消任务
 * - POST /jobs/:id/resume     恢复(进程重启后从 checkpoint 续跑)
 */
import type { FastifyInstance } from "fastify";
import type { ServerJobService } from "../jobs/service.js";
import { toSerializedPayload } from "../jobs/wechat-executor.js";

/** 创建任务的请求体(SEC-03 schema:进入副作用前稳定拒绝畸形请求)。 */
const createJobSchema = {
  type: "object",
  required: ["title", "content"],
  additionalProperties: true,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    content: { type: "string", minLength: 1, maxLength: 2_000_000 },
    summary: { type: "string", maxLength: 2000 },
    author: { type: "string", maxLength: 100 },
    contentSourceUrl: { type: "string", maxLength: 2000 },
    coverImageUrl: { type: "string", maxLength: 5000 },
    bodyImageUrls: {
      type: "array",
      items: { type: "string", maxLength: 5000 },
      maxItems: 200,
    },
    /** true=草稿+发布,false/缺省=仅草稿。 */
    publish: { type: "boolean" },
  },
} as const;

export interface RegisterJobRoutesOptions {
  readonly jobs: ServerJobService;
  /** 是否允许创建新任务(未配置公众号凭据时禁用创建,但可查历史)。 */
  readonly canCreate: boolean;
}

export function registerJobRoutes(app: FastifyInstance, options: RegisterJobRoutesOptions): void {
  const { jobs, canCreate } = options;

  app.get("/jobs", async () => {
    const all = await jobs.list();
    // 只返回元信息,不返回正文 payload(正文可能在列表场景泄漏大体积内容)。
    return {
      ok: true,
      jobs: all.map(summarize),
    };
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = await jobs.get(request.params.id);
    if (!job) {
      return reply.code(404).send({ ok: false, error: "任务不存在", statusCode: 404 });
    }
    const payload = await jobs.platformPayload(job.id, job.platformJobs[0]?.platformId ?? "wechat").catch(
      () => undefined,
    );
    return {
      ok: true,
      job: {
        ...summarize(job),
        payloadPreview: payload
          ? {
              title: payload.title,
              contentLength: payload.content.length,
              mime: payload.mime,
              imageCount: payload.imageAssetIds.length,
            }
          : undefined,
      },
    };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/jobs",
    { schema: { body: createJobSchema } },
    async (request, reply) => {
      if (!canCreate) {
        return reply.code(400).send({
          ok: false,
          message: "server 未配置公众号凭据(.env 的 WECHAT_APPID/WECHAT_SECRET);仅可查看历史任务。",
        });
      }
      const b = request.body;
      const payload = toSerializedPayload({
        title: String(b.title),
        content: String(b.content),
        summary: typeof b.summary === "string" ? b.summary : undefined,
        author: typeof b.author === "string" ? b.author : undefined,
        contentSourceUrl: typeof b.contentSourceUrl === "string" ? b.contentSourceUrl : undefined,
        coverImageUrl: typeof b.coverImageUrl === "string" ? b.coverImageUrl : undefined,
        bodyImageUrls: Array.isArray(b.bodyImageUrls)
          ? b.bodyImageUrls.filter((x): x is string => typeof x === "string")
          : undefined,
      });
      try {
        const job = await jobs.createAndRun({
          payload,
          platformId: "wechat",
        });
        return reply.code(201).send({ ok: true, job: summarize(job) });
      } catch (err) {
        return reply.code(502).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          statusCode: 502,
        });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { platformId?: string } }>(
    "/jobs/:id/retry",
    async (request, reply) => {
      try {
        const job = await jobs.retryPlatform(request.params.id, request.body?.platformId ?? "wechat");
        return { ok: true, job: summarize(job) };
      } catch (err) {
        return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err), statusCode: 404 });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/jobs/:id/cancel",
    async (request, reply) => {
      try {
        const job = await jobs.cancel(request.params.id, request.body?.reason ?? "用户取消");
        return { ok: true, job: summarize(job) };
      } catch (err) {
        return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err), statusCode: 404 });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/jobs/:id/resume", async (request, reply) => {
    try {
      const job = await jobs.run(request.params.id);
      return { ok: true, job: summarize(job) };
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err), statusCode: 404 });
    }
  });
}

/** 任务元信息(不含正文 payload)。 */
export function summarize(job: import("@mpp/core").PublishJob): {
  id: string;
  stage: import("@mpp/core").PublishJob["stage"];
  contentDigest: string;
  platforms: { platformId: string; stage: string; attemptCount: number; error?: string; remoteId?: string }[];
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: job.id,
    stage: job.stage,
    contentDigest: job.contentDigest,
    platforms: job.platformJobs.map((p) => ({
      platformId: p.platformId,
      stage: p.stage,
      attemptCount: p.attemptCount,
      error: p.error,
      remoteId: p.receipt?.remoteId,
    })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
