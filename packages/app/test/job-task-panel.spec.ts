/**
 * 发布任务面板与任务服务接线测试(UI-01)。
 * 验证:createPublishJob 创建任务、run 后更新状态、retry/cancel 语义。
 */
import { beforeEach, describe, expect, test } from "vitest";
import { PublishJobService, type PlatformExecutor } from "@mpp/core";
import { MemoryJobStore } from "@mpp/core";

function spyExecutor(overrides: Partial<PlatformExecutor> = {}): PlatformExecutor {
  const executor: PlatformExecutor = {
    async prepare(payload) {
      return { payload };
    },
    async upload(assets) {
      return assets.map((a) => ({ assetId: a.assetId, url: `https://img.test/${a.assetId}` }));
    },
    async submit() {
      return { platformId: "wechat", status: "submitted", message: "已提交", remoteId: "m1", at: new Date().toISOString() };
    },
    async verify(_p, receipt) {
      return { ...receipt, status: "published", message: "已核验" };
    },
    ...overrides,
  };
  return executor;
}

describe("UI-01 发布任务服务", () => {
  let store: MemoryJobStore;
  let service: PublishJobService;

  beforeEach(() => {
    store = new MemoryJobStore();
    service = new PublishJobService({ store });
  });

  test("创建任务并运行后进入 succeeded,平台子任务带证据", async () => {
    service.registerExecutor("wechat", spyExecutor());
    const job = await service.create({ contentDigest: "d1", platforms: ["wechat", "zhihu"] });
    service.registerExecutor("zhihu", spyExecutor());

    const done = await service.run(job.id);
    expect(done.stage).toBe("succeeded");
    expect(done.platformJobs.every((p) => p.stage === "succeeded")).toBe(true);
  });

  test("checkpoint:已成功平台重跑不重复提交", async () => {
    const executor = spyExecutor();
    service.registerExecutor("wechat", executor);
    const job = await service.create({ contentDigest: "d2", platforms: ["wechat"] });

    await service.run(job.id);
    await service.run(job.id);
    const final = await service.get(job.id);
    expect(final?.platformJobs[0]?.attemptCount).toBe(1);
  });

  test("retryPlatform 重置失败平台后成功", async () => {
    let fail = true;
    service.registerExecutor(
      "wechat",
      spyExecutor({
        async submit() {
          if (fail) {
            fail = false;
            throw new Error("网络抖动");
          }
          return { platformId: "wechat", status: "submitted", message: "ok", at: new Date().toISOString() };
        },
      }),
    );
    const job = await service.create({ contentDigest: "d3", platforms: ["wechat"] });

    const failed = await service.run(job.id);
    expect(failed.stage).toBe("failed");

    await service.retryPlatform(job.id, "wechat");
    const done = await service.run(job.id);
    expect(done.stage).toBe("succeeded");
    expect(done.platformJobs[0]?.attemptCount).toBe(2);
  });

  test("cancel 后任务不可再 run", async () => {
    service.registerExecutor("wechat", spyExecutor());
    const job = await service.create({ contentDigest: "d4", platforms: ["wechat"] });

    await service.cancel(job.id, "测试取消");
    await expect(service.run(job.id)).rejects.toThrow("已取消");
  });

  test("unknown 状态不自动重试", async () => {
    service.registerExecutor(
      "wechat",
      spyExecutor({
        async verify(_p, receipt) {
          return { ...receipt, status: "unknown", message: "状态不明" };
        },
      }),
    );
    const job = await service.create({ contentDigest: "d5", platforms: ["wechat"] });

    const done = await service.run(job.id);
    expect(done.stage).toBe("unknown");
    // 再次 run 不自动重试
    await service.run(job.id);
    const final = await service.get(job.id);
    expect(final?.platformJobs[0]?.attemptCount).toBe(1);
  });
});
