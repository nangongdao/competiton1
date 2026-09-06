/**
 * server 侧发布任务服务 —— 组合 `FileJobStore` + `PublishJobService` + `WechatJobExecutor`,
 * 让公众号真实发布任务具备**文件持久化 + 进程重启恢复**能力(JOB-02 在 server 的落地)。
 *
 * 设计:
 * - 任务存 `{dataDir}/jobs/publish-jobs.json`,原子写 + 版本化 + 损坏检测;
 * - 进程重启后重建 FileJobStore → 从最近 checkpoint 续跑,不重复已成功资产/平台;
 * - 每个任务一个 AbortController,取消贯穿 submit/verify。
 */
import { join } from "node:path";
import {
  PublishJobService,
  type PlatformExecutor,
  type PublishJob,
  contentHashOfPayload,
} from "@mpp/core";
import { FileJobStore } from "@mpp/core/jobs/file-store";
import type { SerializedPayload } from "@mpp/core";
import type { WechatPublisher } from "../wechat/rehost.js";
import { WechatJobExecutor } from "./wechat-executor.js";

/** server 任务目录名。 */
export const SERVER_JOBS_DIR = "jobs";

export interface ServerJobServiceOptions {
  /** 数据目录(默认取 server 包 data)。 */
  readonly dataDir?: string;
  readonly publisher: WechatPublisher;
  /** 是否 publish(true=草稿+发布,false=仅草稿)。 */
  readonly publish?: boolean;
  /** 注入执行器(测试可替换)。 */
  readonly executor?: PlatformExecutor;
}

export interface CreateServerJobInput {
  /** 发布请求(已含真实 URL,持久化到任务)。 */
  readonly payload: SerializedPayload;
  /** 平台 id(默认 wechat)。 */
  readonly platformId?: string;
}

export class ServerJobService {
  private readonly store: FileJobStore;
  readonly service: PublishJobService;
  private readonly executor: PlatformExecutor;
  private readonly aborts = new Map<string, AbortController>();

  constructor(options: ServerJobServiceOptions) {
    const dataDir = options.dataDir ?? join(process.cwd(), "data");
    this.store = new FileJobStore({ dir: join(dataDir, SERVER_JOBS_DIR) });
    this.service = new PublishJobService({ store: this.store });
    this.executor =
      options.executor ??
      new WechatJobExecutor({
        publisher: options.publisher,
        publish: options.publish ?? false,
      });
    this.service.registerExecutor("wechat", this.executor);
  }

  /** 启动时加载(从磁盘恢复任务)。损坏时抛出明确错误,不静默清空。 */
  async load(): Promise<void> {
    await this.store.load();
  }

  /** 数据目录(测试可断言落盘位置)。 */
  get dir(): string {
    return this.store.directory;
  }

  async list(): Promise<PublishJob[]> {
    await this.service.list();
    return this.service.list();
  }

  async get(id: string): Promise<PublishJob | undefined> {
    return this.service.get(id);
  }

  /**
   * 创建并启动公众号发布任务。
   * payload 已持久化,进程重启后可恢复。
   */
  async createAndRun(input: CreateServerJobInput): Promise<PublishJob> {
    const platformId = input.platformId ?? "wechat";
    const digest = await contentHashOfPayload(input.payload, false);
    const job = await this.service.create({
      contentDigest: digest,
      platforms: [platformId],
    });
    // 预写 payload(比等待 prepare 更早持久化,供极端崩溃恢复)。
    await this.service.updatePlatformPayload(job.id, platformId, input.payload);

    await this.run(job.id);
    return this.requireJob(job.id);
  }

  /** 启动/续跑任务(进程重启恢复入口)。 */
  async run(jobId: string): Promise<PublishJob> {
    const abort = new AbortController();
    this.aborts.set(jobId, abort);
    try {
      await this.service.run(jobId, abort.signal);
    } finally {
      this.aborts.delete(jobId);
    }
    return this.requireJob(jobId);
  }

  /** 重试指定平台(从最后可安全恢复阶段继续)。 */
  async retryPlatform(jobId: string, platformId: string): Promise<PublishJob> {
    await this.service.retryPlatform(jobId, platformId);
    return this.run(jobId);
  }

  /** 取消任务(贯穿 AbortSignal)。 */
  async cancel(jobId: string, reason = "用户取消"): Promise<PublishJob> {
    this.aborts.get(jobId)?.abort();
    await this.service.cancel(jobId, reason);
    return this.requireJob(jobId);
  }

  /** 读取任务持久化 payload(供恢复/诊断)。 */
  async platformPayload(jobId: string, platformId: string): Promise<SerializedPayload | undefined> {
    return this.service.getPlatformPayload(jobId, platformId);
  }

  private async requireJob(id: string): Promise<PublishJob> {
    const job = await this.service.get(id);
    if (!job) throw new Error(`任务不存在: ${id}`);
    return job;
  }
}
