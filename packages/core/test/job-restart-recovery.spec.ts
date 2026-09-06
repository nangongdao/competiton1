/**
 * Phase 2 退出条件 —— 进程重启恢复 E2E。
 *
 * 场景:任务在 submit 成功后、verify 前"进程崩溃" → 重建 FileJobStore + PublishJobService
 * → 注入执行器 → resume → 从 checkpoint 续跑,且不重复已成功资产/平台。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PublishJobService, type PlatformExecutor } from "../src/index.js";
import { FileJobStore } from "../src/jobs/file-store.js";
import type { JobStore } from "../src/jobs/store.js";
import type { PublishJob } from "../src/jobs/types.js";

/** 测试用临时目录。 */
let tmpDirs: string[] = [];
async function makeStore(): Promise<{ store: FileJobStore }> {
  const dir = await mkdtemp(join(tmpdir(), "mpp-jobstore-"));
  tmpDirs.push(dir);
  const store = new FileJobStore({ dir });
  await store.load();
  return { store };
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

function executor(calls: string[] = []): PlatformExecutor {
  return {
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
  };
}

/** 模拟"进程重启":丢弃旧 store/service,用同一目录重建。 */
async function reboot(store: JobStore): Promise<{ store: FileJobStore }> {
  const dir = (store as FileJobStore & { file: string }).file.split("/").slice(0, -1).join("/");
  const fresh = new FileJobStore({ dir });
  await fresh.load();
  return { store: fresh };
}

describe("Phase 2 退出条件 —— 进程重启恢复", () => {
  it("重启前 submit 成功(已上传资产) → 重启后从 uploading 续跑,不重复 submit 已成功资产", async () => {
    const { store } = await makeStore();
    const service = new PublishJobService({ store });
    const calls1: string[] = [];
    service.registerExecutor("wechat", executor(calls1));

    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    // 模拟崩溃点:submit 成功后 verify 前崩溃 —— 先手动把平台推到"已上传+submitting"。
    const crashed: PublishJob = {
      ...job,
      stage: "submitting",
      platformJobs: [
        {
          ...job.platformJobs[0]!,
          stage: "submitting",
          attemptCount: 1,
          uploadedAssets: [{ assetId: "default", url: "https://img.test/default" }],
        },
      ],
    };
    await store.put(crashed);

    // 模拟重启:同一目录新 store + 新 service + 新执行器。
    const { store: freshStore } = await reboot(store);
    const service2 = new PublishJobService({ store: freshStore });
    const calls2: string[] = [];
    service2.registerExecutor("wechat", executor(calls2));

    // 从 checkpoint 续跑:有已上传资产 → 跳过 upload 重新上传,从 submitting 继续。
    const recovered = await service2.run(job.id);
    expect(recovered.stage).toBe("succeeded");
    expect(recovered.platformJobs[0]?.stage).toBe("succeeded");
    // 重启后的执行器应执行 prepare(service 内部仍会 prepare)→ upload 因已有资产被跳过。
    expect(calls2.includes("upload")).toBe(false);
    expect(calls2.includes("submit")).toBe(true);
    expect(calls2.includes("verify")).toBe(true);
  });

  it("重启前全部 succeeded → 重启后 checkpoint 跳过,不重复任何副作用", async () => {
    const { store } = await makeStore();
    const service = new PublishJobService({ store });
    const calls1: string[] = [];
    service.registerExecutor("wechat", executor(calls1));
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    const done = await service.run(job.id);
    expect(done.stage).toBe("succeeded");

    const { store: freshStore } = await reboot(store);
    const service2 = new PublishJobService({ store: freshStore });
    const calls2: string[] = [];
    service2.registerExecutor("wechat", executor(calls2));
    const recovered = await service2.run(job.id);
    expect(recovered.stage).toBe("succeeded");
    // 已成功平台不重复执行。
    expect(calls2.filter((c) => c === "submit")).toHaveLength(0);
  });

  it("损坏的存储文件 → 明确报错,不静默清空", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mpp-jobstore-corrupt-"));
    tmpDirs.push(dir);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "publish-jobs.json"), "{ not valid json", "utf8");
    const store = new FileJobStore({ dir });
    await expect(store.load()).rejects.toThrow(/损坏/);

    // fallbackOnCorrupt 时回退为空。
    const fallback = new FileJobStore({ dir, fallbackOnCorrupt: true });
    await fallback.load();
    expect(await fallback.list()).toHaveLength(0);
  });

  it("FileJobStore 原子写 + 持久化往返", async () => {
    const { store } = await makeStore();
    const job = await new PublishJobService({ store }).create({ contentDigest: "d", platforms: ["wechat"] });
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(await store.get(job.id)).toBeDefined();
    // 落盘后可被新实例读取。
    const { store: freshStore } = await reboot(store);
    expect(await freshStore.get(job.id)).toBeDefined();
  });

  it("prune 保留策略:终态过期清理", async () => {
    const { store } = await makeStore();
    const service = new PublishJobService({ store });
    const old = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    // 把任务改成终态且已过期。
    await store.put({
      ...old,
      stage: "failed",
      updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const removed = await store.prune();
    expect(removed).toBe(1);
    expect(await store.get(old.id)).toBeUndefined();
  });

  it("prepare 产物随任务持久化 → 重启后可从存储恢复 payload", async () => {
    const { store } = await makeStore();
    const service = new PublishJobService({ store });
    const calls: string[] = [];
    service.registerExecutor("wechat", executor(calls));

    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    // 模拟崩溃点:submit 前已 prepare 且已上传资产 → 磁盘已有 payload。
    const crashed: PublishJob = {
      ...job,
      stage: "uploading",
      platformJobs: [
        {
          ...job.platformJobs[0]!,
          stage: "uploading",
          attemptCount: 1,
          uploadedAssets: [{ assetId: "default", url: "https://img.test/default" }],
          payload: { content: "<p>ok</p>", title: "T", mime: "text/html", tags: [], imageAssetIds: [] },
        },
      ],
    };
    await store.put(crashed);

    // 重启:同目录新 store + service,先读取持久化 payload。
    const { store: freshStore } = await reboot(store);
    const service2 = new PublishJobService({ store: freshStore });
    const recoveredPayload = await service2.getPlatformPayload(job.id, "wechat");
    expect(recoveredPayload?.title).toBe("T");
    expect(recoveredPayload?.content).toBe("<p>ok</p>");

    // 重启后执行器即使不重新 prepare,submit 也能拿到持久化 payload。
    const submitSeen: Array<string | undefined> = [];
    const executor2: PlatformExecutor = {
      async prepare(p) {
        // 模拟“闭包丢失”:prepare 直接返回空,不覆盖已持久化 payload。
        return { payload: p };
      },
      async upload(assets) {
        return assets.map((a) => ({ assetId: a.assetId, url: `https://img.test/${a.assetId}` }));
      },
      async submit(payload) {
        submitSeen.push(payload?.title);
        return { platformId: "wechat", status: "submitted", message: "已提交", remoteId: "m2", at: new Date().toISOString() };
      },
      async verify(_p, receipt) {
        return { ...receipt, status: "published", message: "已核验" };
      },
    };
    service2.registerExecutor("wechat", executor2);
    const recovered = await service2.run(job.id);
    expect(recovered.stage).toBe("succeeded");
    // submit 拿到的 payload 来自持久化存储(title 为 T),而非空占位。
    expect(submitSeen[0]).toBe("T");
    // 已上传资产不重复上传。
    expect((await service2.get(job.id))?.platformJobs[0]?.uploadedAssets).toHaveLength(1);
  });

  it("updatePlatformPayload 预写 payload(首次运行前落盘)", async () => {
    const { store } = await makeStore();
    const service = new PublishJobService({ store });
    const job = await service.create({ contentDigest: "d", platforms: ["wechat"] });
    await service.updatePlatformPayload(job.id, "wechat", {
      content: "<p>pre</p>",
      title: "PreT",
      mime: "text/html",
      tags: [],
      imageAssetIds: [],
    });
    const payload = await service.getPlatformPayload(job.id, "wechat");
    expect(payload?.title).toBe("PreT");
    // 落盘后可被新实例读取。
    const { store: freshStore } = await reboot(store);
    const service2 = new PublishJobService({ store: freshStore });
    expect((await service2.getPlatformPayload(job.id, "wechat"))?.title).toBe("PreT");
  });
});
