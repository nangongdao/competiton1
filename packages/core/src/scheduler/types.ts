/**
 * FLOW-03 本机计划任务契约。
 *
 * 设计要点(路线图 §5.2):
 * - 计划任务 = 定时/周期触发一次"批量发布/校验生成"意图的本地任务;
 * - 前置条件:任务持久化(JOB-02)、鉴权(SEC-01)、回执可信(RUN-01)已就绪;
 * - 机器与登录态必须在线:调度器不假装离线可发布,只在到点触发执行器,失败记录并等待下一次。
 *
 * 纯 TS、零 DOM,可被 app 服务层(浏览器/扩展)与桌面端复用。
 */

/** 计划任务触发表达式(cron 风格子集)。 */
export interface CronExpression {
  /** 分钟 0-59,支持 * 与逗号列表。 */
  readonly minute: readonly number[] | "*";
  /** 小时 0-23,支持 * 与逗号列表。 */
  readonly hour: readonly number[] | "*";
  /** 星期 0-6(0=周日),支持 * 与逗号列表。 */
  readonly dayOfWeek: readonly number[] | "*";
}

/** 计划任务动作:到点后执行的操作。 */
export type ScheduledAction =
  | { readonly kind: "validate-generate" }
  | { readonly kind: "publish-job" }
  | { readonly kind: "metrics-sync" }
  | { readonly kind: "ai-auto-complete" }
  | { readonly kind: "weekly-report" }
  | { readonly kind: "inbox-auto-reply"; readonly policy?: import("../inbox/reply.js").AutoReplyPolicy };

/** 计划任务中与「周报」动作关联的配置(到点生成的周报任务引用)。 */
export interface WeeklyReportActionConfig {
  /** 周报任务 id(生成哪份周报)。 */
  readonly weeklyJobId: string;
}

/** 计划任务状态机:enabled → paused → enabled;终态 removed。 */
export type ScheduledTaskStatus = "enabled" | "paused" | "removed";

/** 一次触发的执行记录。 */
export interface ScheduledRun {
  /** 触发序号(递增)。 */
  readonly seq: number;
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly outcome?: "succeeded" | "failed" | "skipped" | "cancelled";
  readonly error?: string;
  /** 关联的 PublishJob id(若动作是发布任务)。 */
  readonly jobId?: string;
  /** 关联的批量校验结果摘要(若动作是校验生成)。 */
  readonly batchSummary?: string;
}

/** 本机计划任务。 */
export interface ScheduledTask {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** 触发表达式(每周/每日/每小时或自定义)。 */
  readonly cron: CronExpression;
  /** 到点要执行的动作。 */
  readonly action: ScheduledAction;
  /** 周报动作的关联配置(仅 action.kind === "weekly-report" 时使用)。 */
  readonly weeklyReport?: WeeklyReportActionConfig;
  /** 目标平台(为空 = 全部平台)。 */
  readonly platformIds: readonly string[];
  /** 关联草稿 id(执行时取草稿内容)。 */
  readonly draftId: string;
  readonly status: ScheduledTaskStatus;
  /** 保留最近 N 次执行记录。 */
  readonly runs: readonly ScheduledRun[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 创建计划任务的输入。 */
export interface NewScheduledTask {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly cron: CronExpression;
  readonly action: ScheduledAction;
  readonly platformIds: readonly string[];
  readonly draftId: string;
  /** 周报动作配置(可选)。 */
  readonly weeklyReport?: WeeklyReportActionConfig;
}

/** 调度执行上下文(由接线方注入):到点执行动作。 */
export interface ScheduledTaskRunner {
  /** 执行动作,返回可脱敏的结果摘要。 */
  run(
    task: ScheduledTask,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; summary?: string; jobId?: string; error?: string }>;
}

/** 计划任务存储(版本化)。 */
export interface ScheduledTaskStore {
  readonly schemaVersion: number;
  list(): Promise<readonly ScheduledTask[]>;
  get(id: string): Promise<ScheduledTask | undefined>;
  put(task: ScheduledTask): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 校验 cron 表达式的合法性。 */
export function isValidCron(cron: CronExpression): boolean {
  if (!Array.isArray(cron.minute) && cron.minute !== "*") return false;
  if (!Array.isArray(cron.hour) && cron.hour !== "*") return false;
  if (!Array.isArray(cron.dayOfWeek) && cron.dayOfWeek !== "*") return false;
  if (Array.isArray(cron.minute) && cron.minute.some((m) => !Number.isInteger(m) || m < 0 || m > 59)) return false;
  if (Array.isArray(cron.hour) && cron.hour.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) return false;
  if (Array.isArray(cron.dayOfWeek) && cron.dayOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  return true;
}

/** 判断某个时间点是否匹配 cron(本地时区)。 */
export function matchesCron(cron: CronExpression, at: Date): boolean {
  if (!isValidCron(cron)) return false;
  const minuteOk = cron.minute === "*" || cron.minute.includes(at.getMinutes());
  const hourOk = cron.hour === "*" || cron.hour.includes(at.getHours());
  const dowOk = cron.dayOfWeek === "*" || cron.dayOfWeek.includes(at.getDay());
  return minuteOk && hourOk && dowOk;
}

/** 构造常用的"每天 HH:MM"表达式。 */
export function dailyAt(hour: number, minute = 0): CronExpression {
  return { minute: [minute], hour: [hour], dayOfWeek: "*" };
}

/** 构造常用的"每周 DOW HH:MM"表达式。 */
export function weeklyAt(dayOfWeek: number, hour: number, minute = 0): CronExpression {
  return { minute: [minute], hour: [hour], dayOfWeek: [dayOfWeek] };
}

/** 构造"每小时整点"表达式。 */
export function hourly(): CronExpression {
  return { minute: [0], hour: "*", dayOfWeek: "*" };
}
