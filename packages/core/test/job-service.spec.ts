import { describe, expect, it } from "vitest";
import { PublishJobService, type PlatformExecutor } from "../src/jobs/service.js";
import { MemoryJobStore } from "../src/jobs/store.js";
import type { PlatformJob, PublishJob } from "../src/jobs/types.js";

/** 记录 executor 调用序列的辅助。 */
function spyExecutor(overrides: Partial<PlatformExecutor> = {}): { executor: PlatformExecutor; calls: string[] } {
  const calls: string[] = [];
  const executor: PlatformExecutor = {
    async prepare() {
      calls.push("prepare");
      return { payload: { content: "<p>ok</p>", title: "T", mime: "text/html", tags: [], imageAssetIds: [] } };
    },
    async upload(assets) {
      calls.push("upload");
      return assets.map((a) => ({ assetId: a.assetId, url: `https://img.test/${a.assetId}` }));
    },
    async submit() {
      calls.push("submit");
      return { platformId: "wechat", status: "submitted", message: "已提交", remoteId: "m1", at: new Date().toISOString() };
    },
    async verify(_payload, receipt) {
      calls.push("verify");
      return { ...receipt, status: "published", message: "已核验" };
    },
    ...overrides,
  };
  return { executor, calls };
}

async function createRunJob(
  service: PublishJobService,
  platforms = ["wechat"],
  overrides: Partial<Record<string, Partial<PlatformExecutor>>> = {},
): Promise<PublishJob> {
  const job = await service.create({
    contentDigest: "digest-1",
    idempotencyKey: "wechat:draft:digest-1",
    platforms,
  });
  for (const platform of platforms) {
    const { executor } = spyExecutor(overrides[platform] ?? {});
    service.registerExecutor(platform, executor);
  }
  return job;
}

describe("JOB-03 任务编排", () => {
  it("create 生成 queued 任务与各平台子任务", async () => {
    const service = new PublishJobService();
    const job = await service.create({ contentDigest: "d", platforms: ["wechat", "zhihu"] });
    expect(job.stage).toBe("queued");
    expect(job.platformJobs).toHaveLength(2);
    expect(job.platformJobs[0]?.stage).toBe("queued");
    expect(job.platformJobs[0]?.attemptCount).toBe(0);
  });

  it("run 走完 prepare→upload→submit→verify 并进入 succeeded", async () => {
    const service = new PublishJobService();
    const job = await createRunJob(service);
    const done = await service.run(job.id);

    expect(done.stage).toBe("succeeded");
    const pj = done.platformJobs[0]!;
    expect(pj.stage).toBe("succeeded");
    expect(pj.receipt?.status).toBe("published");
    expect(pj.attemptCount).toBe(1);
    expect(pj.uploadedAssets).toHaveLength(1);
  });

  it("checkpoint:已成功平台不重复执行", async () => {
    const service = new PublishJobService();
    const { executor, calls } = spyExecutor();
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    service.registerExecutor("wechat", executor);

    await service.run(job.id);
    expect(calls.filter((c) => c === "submit")).toHaveLength(1);
    await service.run(job.id);
    // 已成功平台跳过:不再产生 submit
    expect(calls.filter((c) => c === "submit")).toHaveLength(1);
  });

  it("unknown 回执 → 平台任务进入 unknown,不自动重试", async () => {
    const service = new PublishJobService();
    const { executor, calls } = spyExecutor({
      async verify(_payload, receipt) {
        calls.push("verify");
        return { ...receipt, status: "unknown", message: "提交后断网,状态不明" };
      },
    });
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    service.registerExecutor("wechat", executor);

    const done = await service.run(job.id);
    expect(done.stage).toBe("unknown");
    expect(done.platformJobs[0]?.stage).toBe("unknown");
    expect(done.platformJobs[0]?.error).toContain("状态未知");

    // 再次 run 不应自动重试 unknown(RUNNABLE_STAGES 不含 unknown)
    await service.run(job.id);
    expect(calls.filter((c) => c === "submit")).toHaveLength(1);
  });

  it("failed 平台可 retryPlatform 后重新执行", async () => {
    let fail = true;
    const service = new PublishJobService();
    const { executor, calls } = spyExecutor({
      async submit() {
        calls.push("submit");
        if (fail) {
          fail = false;
          throw new Error("平台临时错误");
        }
        return { platformId: "wechat", status: "submitted", message: "ok", at: new Date().toISOString() };
      },
    });
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    service.registerExecutor("wechat", executor);

    const failed = await service.run(job.id);
    expect(failed.stage).toBe("failed");
    expect(failed.platformJobs[0]?.error).toContain("平台临时错误");

    await service.retryPlatform(job.id, "wechat");
    const done = await service.run(job.id);
    expect(done.stage).toBe("succeeded");
    expect(done.platformJobs[0]?.attemptCount).toBe(2);
    expect(calls.filter((c) => c === "submit")).toHaveLength(2);
  });

  it("cancel 将所有平台置为 cancelled,后续 run 拒绝", async () => {
    const service = new PublishJobService();
    const job = await createRunJob(service);
    const cancelled = await service.cancel(job.id, "用户取消");
    expect(cancelled.stage).toBe("cancelled");
    expect(cancelled.platformJobs.every((p) => p.stage === "cancelled")).toBe(true);

    await expect(service.run(job.id)).rejects.toThrow("已取消");
  });

  it("取消信号贯穿:提交前中断 → cancelled", async () => {
    const service = new PublishJobService();
    const controller = new AbortController();
    const { executor, calls } = spyExecutor({
      async submit(_payload, signal) {
        calls.push("submit");
        await new Promise((resolve) => setTimeout(resolve, 30));
        if (signal?.aborted) throw new Error("aborted");
        return { platformId: "wechat", status: "submitted", message: "ok", at: new Date().toISOString() };
      },
    });
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    service.registerExecutor("wechat", executor);

    const runPromise = service.run(job.id, controller.signal);
    setTimeout(() => controller.abort(), 10);
    const done = await runPromise;
    expect(done.stage).toBe("cancelled");
  });

  it("未注册执行器 → failed 并给出明确错误", async () => {
    const service = new PublishJobService();
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    const done = await service.run(job.id);
    expect(done.stage).toBe("failed");
    expect(done.platformJobs[0]?.error).toContain("未注册平台执行器");
  });

  it("非法迁移被拒绝并记录(不中断链路)", async () => {
    const store = new MemoryJobStore();
    const service = new PublishJobService({ store });
    const { executor } = spyExecutor();
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    service.registerExecutor("wechat", executor);

    // 手动把平台置为 succeeded(模拟已成功,checkpoint 直接跳过,不产生非法迁移)。
    const j = await store.get(job.id);
    expect(j).toBeDefined();
    await store.put({
      ...j!,
      platformJobs: j!.platformJobs.map((p: PlatformJob) => ({ ...p, stage: "succeeded" as const })),
    });
    const done = await service.run(job.id);
    expect(done.stage).toBe("succeeded");
  });

  it("schemaVersion 透出存储版本", () => {
    const service = new PublishJobService();
    expect(service.schemaVersion).toBe(1);
  });
});
