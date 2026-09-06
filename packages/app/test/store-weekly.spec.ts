/**
 * v4 Phase 2 · WEEKLY-01/02 store 周报行为测试。
 *
 * 覆盖:
 * - loadWeeklyJobs:从存储加载周报任务;
 * - createWeeklyJob:创建周报任务(默认 weekly 模板 / 近 7 天);
 * - setWeeklyJobStatus:暂停/恢复;
 * - removeWeeklyJob:删除(标记 removed);
 * - generateWeeklyReport:手动立即生成,结果写入 weeklyReportPreview;
 * - previewWeeklyReport:生成预览(不落任务);
 * - 计划任务 weekly-report 动作:创建带 weeklyReport 关联的调度任务,到点触发生成周报。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../src/state/store.js";
import type {
  AssistedHandoffRequest,
  AssistedHandoffResult,
  AutomationPublishRequest,
  AutomationPublishResult,
  ClipboardPayload,
  PlatformBridge,
  UploadAssetRequest,
  UploadAssetResult,
  WechatPublishRequest,
  WechatPublishResult,
} from "../src/bridge/types.js";

class MemoryBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly store = new Map<string, string>();
  async writeClipboard(_p: ClipboardPayload): Promise<boolean> { return true; }
  async assistedHandoff(_r: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }
  async publishWechat(_r: WechatPublishRequest): Promise<WechatPublishResult> {
    return { ok: true, message: "published", remoteId: "MEDIA_1" };
  }
  async publishAutomation(_r: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: true, status: "submitted", message: "ok" };
  }
  async uploadAsset(_r: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "n/a" };
  }
  async getSetting(key: string): Promise<string | undefined> { return this.store.get(key); }
  async setSetting(key: string, value: string): Promise<void> { this.store.set(key, value); }
}

let bridge: MemoryBridge;

beforeEach(() => {
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({
    weeklyJobs: [],
    weeklyReportPreview: "",
    weeklyGenerating: false,
    performanceRecords: [
      {
        id: "p1",
        platformId: "wechat",
        title: "A 文章",
        publishedAt: "2026-08-06T10:00:00Z",
        collectedAt: "2026-08-06T10:00:00Z",
        metrics: { views: 1000, likes: 50 },
        source: "manual",
      },
    ],
    llm: { baseUrl: "", apiKey: "", model: "" },
    llmConfigs: [],
    activeLlmConfigId: null,
  });
});

describe("WEEKLY store 周报任务", () => {
  it("createWeeklyJob 创建周报任务(默认 weekly/近 7 天)", async () => {
    const res = await useStore.getState().createWeeklyJob({ name: "主编周报" });
    expect(res.ok).toBe(true);
    const jobs = useStore.getState().weeklyJobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe("主编周报");
    expect(jobs[0]?.template).toBe("weekly");
    expect(jobs[0]?.windowDays).toBe(7);
    expect(jobs[0]?.deliveries).toEqual([]);
  });

  it("createWeeklyJob 支持投递渠道与 LLM 开关", async () => {
    const res = await useStore.getState().createWeeklyJob({
      name: "带投递",
      template: "weekly",
      windowDays: 7,
      deliveries: [{ kind: "email", target: "boss@example.com" }],
      useLlm: false,
    });
    expect(res.ok).toBe(true);
    const job = useStore.getState().weeklyJobs[0];
    expect(job?.deliveries).toHaveLength(1);
    expect(job?.deliveries[0]?.kind).toBe("email");
    expect(job?.useLlm).toBe(false);
  });

  it("setWeeklyJobStatus 暂停/恢复", async () => {
    await useStore.getState().createWeeklyJob({ name: "A" });
    const id = useStore.getState().weeklyJobs[0]!.id;
    await useStore.getState().setWeeklyJobStatus(id, "paused");
    expect(useStore.getState().weeklyJobs[0]?.status).toBe("paused");
    await useStore.getState().setWeeklyJobStatus(id, "enabled");
    expect(useStore.getState().weeklyJobs[0]?.status).toBe("enabled");
  });

  it("removeWeeklyJob 删除(标记 removed)", async () => {
    await useStore.getState().createWeeklyJob({ name: "A" });
    const id = useStore.getState().weeklyJobs[0]!.id;
    await useStore.getState().removeWeeklyJob(id);
    const jobs = useStore.getState().weeklyJobs;
    expect(jobs).toHaveLength(0);
  });

  it("generateWeeklyReport 手动生成并写入预览", async () => {
    await useStore.getState().createWeeklyJob({ name: "周报" });
    const id = useStore.getState().weeklyJobs[0]!.id;
    const res = await useStore.getState().generateWeeklyReport(id);
    expect(res.ok).toBe(true);
    expect(res.report).toContain("# 内容周报");
    expect(useStore.getState().weeklyReportPreview).toContain("# 内容周报");
    // 运行历史已记录。
    expect(useStore.getState().weeklyJobs[0]?.runs[0]?.outcome).toBe("succeeded");
  });

  it("generateWeeklyReport 未启用任务返回失败", async () => {
    await useStore.getState().createWeeklyJob({ name: "暂停" });
    const id = useStore.getState().weeklyJobs[0]!.id;
    await useStore.getState().setWeeklyJobStatus(id, "paused");
    const res = await useStore.getState().generateWeeklyReport(id);
    expect(res.ok).toBe(false);
  });

  it("previewWeeklyReport 生成预览不落任务", async () => {
    const res = await useStore.getState().previewWeeklyReport("weekly", 7);
    expect(res.ok).toBe(true);
    expect(res.report).toContain("# 内容周报");
    expect(res.report).toContain("A 文章");
    // 未创建任何周报任务。
    expect(useStore.getState().weeklyJobs).toHaveLength(0);
  });
});

describe("WEEKLY-02 计划任务 weekly-report 动作", () => {
  it("创建带 weeklyReport 关联的调度任务", async () => {
    const weekly = await useStore.getState().createWeeklyJob({ name: "周五周报" });
    const weeklyId = weekly.id!;
    const taskRes = await useStore.getState().createScheduledTask({
      name: "每周五周报",
      cron: { minute: [0], hour: [18], dayOfWeek: [5] },
      actionKind: "weekly-report",
      platformIds: [],
      draftId: "",
      weeklyJobId: weeklyId,
    });
    expect(taskRes.ok).toBe(true);
    const task = useStore.getState().scheduledTasks[0];
    expect(task?.action.kind).toBe("weekly-report");
    expect(task?.weeklyReport?.weeklyJobId).toBe(weeklyId);
  });

  it("triggerScheduledTask 触发生成周报并记录运行", async () => {
    const weekly = await useStore.getState().createWeeklyJob({ name: "周报" });
    const weeklyId = weekly.id!;
    await useStore.getState().createScheduledTask({
      name: "周报调度",
      cron: { minute: [0], hour: [18], dayOfWeek: [5] },
      actionKind: "weekly-report",
      platformIds: [],
      draftId: "",
      weeklyJobId: weeklyId,
    });
    const taskId = useStore.getState().scheduledTasks[0]!.id;
    await useStore.getState().triggerScheduledTask(taskId);
    const task = useStore.getState().scheduledTasks[0];
    expect(task?.runs[0]?.outcome).toBe("succeeded");
    expect(task?.runs[0]?.batchSummary).toContain("已生成周报");
  });
});
