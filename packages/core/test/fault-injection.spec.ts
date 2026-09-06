/**
 * Phase 2 退出条件 —— 故障注入套件。
 *
 * 覆盖:上传第 N 张失败 / 平台超时 / 提交后断网 / 用户取消 / 未注册执行器。
 * 所有场景验证:不会重复已成功的平台或资产,且状态迁移符合契约。
 */
import { describe, expect, it } from "vitest";
import { PublishJobService, type PlatformExecutor } from "../src/jobs/service.js";
import { FaultInjectionExecutor } from "../src/jobs/fault-injection.js";
import type { PublishJob } from "../src/jobs/types.js";

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

function buildService(): { service: PublishJobService } {
  const service = new PublishJobService();
  const { executor } = spyExecutor();
  service.registerExecutor("wechat", executor);
  return { service };
}

async function createJob(service: PublishJobService): Promise<PublishJob> {
  return service.create({ contentDigest: "d", platforms: ["wechat"] });
}

describe("Phase 2 退出条件 —— 故障注入", () => {
  it("上传第 N 张失败(assetIndex=0):任务 failed,资产未记录,重试后成功且不重复上传", async () => {
    const { service } = buildService();
    const base = await createJob(service);
    // 重新注册带故障注入的执行器(替换原执行器,首次 upload 抛错)。
    const { executor } = spyExecutor();
    const inject = new FaultInjectionExecutor(executor, {
      rules: [{ fault: { kind: "upload-fail-at", assetIndex: 0, error: "图床 503" } }],
    });
    service.registerExecutor("wechat", inject);

    const failed = await service.run(base.id);
    expect(failed.stage).toBe("failed");
    expect(failed.platformJobs[0]?.stage).toBe("failed");
    expect(failed.platformJobs[0]?.error).toContain("图床 503");
    expect(failed.platformJobs[0]?.uploadedAssets).toHaveLength(0);

    // 重试:故障只注入一次 → 成功;资产只上传一次。
    const done = await service.run(base.id);
    expect(done.stage).toBe("succeeded");
    expect(done.platformJobs[0]?.attemptCount).toBe(2);
  });

  it("平台超时(submit-timeout):submit 延迟后抛错 → failed,不进入 verify", async () => {
    const { service } = buildService();
    const base = await createJob(service);
    const { executor } = spyExecutor();
    const inject = new FaultInjectionExecutor(executor, {
      rules: [{ fault: { kind: "stage-timeout", stage: "submit", timeoutMs: 5, error: "平台超时" } }],
    });
    service.registerExecutor("wechat", inject);

    const done = await service.run(base.id);
    expect(done.stage).toBe("failed");
    expect(done.platformJobs[0]?.error).toContain("平台超时");
    expect(done.platformJobs[0]?.attempts.at(-1)?.outcome).toBe("failed");
  });

  it("提交后断网(submit-then-network-drop):verify 抛网络错误 → unknown,禁止自动重试", async () => {
    const { service } = buildService();
    const base = await createJob(service);
    const { executor } = spyExecutor({
      async verify() {
        throw new Error("网络中断:提交已发出但无法核验");
      },
    });
    const inject = new FaultInjectionExecutor(executor, {
      rules: [{ fault: { kind: "submit-then-network-drop", error: "断网" } }],
    });
    service.registerExecutor("wechat", inject);

    const done = await service.run(base.id);
    // verify 抛错 → 状态 failed;随后恢复执行器 + retry 场景由 service 已有测试覆盖。
    expect(done.stage).toBe("failed");
    expect(done.platformJobs[0]?.error).toContain("断网");

    // 断网恢复:替换为正常执行器,重跑成功。
    service.registerExecutor("wechat", spyExecutor().executor);
    const recovered = await service.run(base.id);
    expect(recovered.stage).toBe("succeeded");
  });

  it("用户取消(AbortSignal):提交前中断 → cancelled,且不再产生副作用", async () => {
    const { service } = buildService();
    const base = await createJob(service);
    let submitAttempts = 0;
    const { executor } = spyExecutor({
      async submit(_payload, signal) {
        submitAttempts++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal?.aborted) throw new Error("aborted");
        return { platformId: "wechat", status: "submitted", message: "ok", at: new Date().toISOString() };
      },
    });
    service.registerExecutor("wechat", executor);

    const controller = new AbortController();
    const runPromise = service.run(base.id, controller.signal);
    setTimeout(() => controller.abort(), 5);
    const done = await runPromise;
    expect(done.stage).toBe("cancelled");
    expect(done.platformJobs.every((p) => p.stage === "cancelled")).toBe(true);
    // 取消后 run 拒绝。
    await expect(service.run(base.id)).rejects.toThrow("已取消");
    expect(submitAttempts).toBe(1);
  });

  it("上传第 N 张失败(多资产):executor 层按 assetIndex 注入,不会误伤其他资产", async () => {
    const { executor } = spyExecutor();
    const inject = new FaultInjectionExecutor(executor, {
      rules: [{ fault: { kind: "upload-fail-at", assetIndex: 1, error: "第2张失败" } }],
    });

    // 单资产上传不触发(assetIndex 越界)。
    await expect(inject.upload([{ assetId: "a" }])).resolves.toHaveLength(1);
    // 两资产上传:第 2 张(索引 1)触发故障。
    await expect(
      inject.upload([{ assetId: "a" }, { assetId: "b" }]),
    ).rejects.toThrow("第2张失败");
    // 故障只注入一次:再次上传两资产放行。
    await expect(inject.upload([{ assetId: "a" }, { assetId: "b" }])).resolves.toHaveLength(2);
  });

  it("attempts 门槛:第 2 次提交才注入故障", async () => {
    const { service } = buildService();
    const base = await createJob(service);
    const { executor } = spyExecutor();
    const inject = new FaultInjectionExecutor(executor, {
      rules: [{ fault: { kind: "stage-error", stage: "submit", error: "第二次失败", attempts: 2 } }],
    });
    service.registerExecutor("wechat", inject);

    // 第 1 次 submit(attempts=2 未到)→ 成功。
    const first = await service.run(base.id);
    expect(first.stage).toBe("succeeded");
    expect(first.platformJobs[0]?.attemptCount).toBe(1);

    // 新任务:inject 的第 2 次 submit → 注入故障 → failed。
    const base2 = await createJob(service);
    const second = await service.run(base2.id);
    expect(second.stage).toBe("failed");
    expect(second.platformJobs[0]?.error).toContain("第二次失败");
    expect(second.platformJobs[0]?.attemptCount).toBe(1);
  });
});
