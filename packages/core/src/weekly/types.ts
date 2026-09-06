/**
 * v4 Phase 2 · WEEKLY-01 内容智能周报自动化 —— 契约。
 *
 * 在既有「复盘报告」(v3 REP)之上,把周报做成可调度、可投递、可回溯的一等公民:
 * - `WeeklyReportJob`:一次「定时生成并投递周报」的完整描述(模板/周窗口/投递渠道);
 * - `WeeklyReportRun`:一次执行的记录(生成内容摘要 + 投递结果 + 耗时);
 * - `WeeklyDelivery`:投递渠道(文件 / server 邮件 / 通用 Webhook,凭据不落盘)。
 *
 * 设计原则(延续 ROADMAP_V4 §5):
 * - 纯 TS、零 DOM;`buildWeeklyReport` 为纯函数,可单测;
 * - LLM 周报总结只是建议段,数字事实以回收数据为准;LLM 失败回退规则总结;
 * - 投递凭据不在 core 出现(邮件/Webhook 凭据由 server 持有),core 只表达意图。
 */
import type { PerformanceRecord } from "../analytics/types.js";
import type { ReportTemplate } from "../report/report.js";

/** 周报投递渠道(kind + 目标,凭据由 server 持有)。 */
export type WeeklyDeliveryKind = "file" | "email" | "webhook";

/** 一条投递渠道配置(core 只表达意图,密钥不进 core/前端持久化)。 */
export interface WeeklyDelivery {
  /** 渠道类型。 */
  readonly kind: WeeklyDeliveryKind;
  /** 目标(邮箱地址 / Webhook URL / 空=导出文件)。 */
  readonly target?: string;
  /** 渠道说明(如「主编邮箱」),便于 UI 展示。 */
  readonly label?: string;
}

/** 周报任务状态。 */
export type WeeklyJobStatus = "enabled" | "paused" | "removed";

/** 周报任务 —— 一次「定时生成并投递周报」的编排描述。 */
export interface WeeklyReportJob {
  readonly id: string;
  /** 任务名称(默认「内容周报」)。 */
  readonly name: string;
  /** 报告模板(默认 weekly,即近 7 天窗口)。 */
  readonly template: ReportTemplate;
  /** 模板裁剪天数(默认 7;monthly=30)。 */
  readonly windowDays: number;
  /** 投递渠道列表(空 = 仅生成本地/导出文件)。 */
  readonly deliveries: readonly WeeklyDelivery[];
  /** 是否启用 LLM 周报总结(默认 true;失败自动回退规则)。 */
  readonly useLlm: boolean;
  /** 周窗口起始偏移(0=今天;1=昨天;……;默认 0)。 */
  readonly windowOffsetDays: number;
  readonly status: WeeklyJobStatus;
  /** 保留最近 N 次执行记录(最近在前)。 */
  readonly runs: readonly WeeklyReportRun[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 一次周报生成的执行记录。 */
export interface WeeklyReportRun {
  /** 触发序号(递增)。 */
  readonly seq: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outcome: "succeeded" | "failed" | "skipped" | "cancelled";
  /** 生成的报告摘要(脱敏:仅标题/长度/记录数)。 */
  readonly reportTitle?: string;
  readonly reportLength?: number;
  /** 生成覆盖的记录数(近窗口)。 */
  readonly recordsUsed?: number;
  /** 是否使用了 LLM 总结(否则规则兜底)。 */
  readonly usedLlm?: boolean;
  /** 投递结果摘要(逐渠道)。 */
  readonly deliveryResults?: readonly { kind: WeeklyDeliveryKind; ok: boolean; message?: string }[];
  readonly error?: string;
}

/** 新建周报任务输入。 */
export interface NewWeeklyReportJob {
  readonly id?: string;
  readonly name?: string;
  readonly template?: ReportTemplate;
  readonly windowDays?: number;
  readonly deliveries?: readonly WeeklyDelivery[];
  readonly useLlm?: boolean;
  readonly windowOffsetDays?: number;
}

/** 周报任务存储(版本化)。 */
export interface WeeklyReportStore {
  readonly schemaVersion: number;
  list(): Promise<readonly WeeklyReportJob[]>;
  get(id: string): Promise<WeeklyReportJob | undefined>;
  put(job: WeeklyReportJob): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 生成周报的输入(纯函数)。 */
export interface BuildWeeklyReportOptions {
  /** 效果记录(空时输出空态周报)。 */
  readonly records: readonly PerformanceRecord[];
  /** LLM 生成的周报总结(可选;缺省/失败用规则总结)。 */
  readonly llmSummary?: string;
  /** 报告模板(默认 weekly)。 */
  readonly template?: ReportTemplate;
  /** 窗口天数(默认 7)。 */
  readonly windowDays?: number;
  /** 报告标题(默认「内容周报」)。 */
  readonly title?: string;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}
