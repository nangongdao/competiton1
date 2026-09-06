/**
 * v10 Phase 1 · REFRESH-QUEUE-01 老化内容批量翻新入队。
 *
 * 把老化检测结果(LC-01)中的「翻新」条目一键转成「翻新草稿 + 排队输入」计划,
 * 一次勾选多条,逐条独立(失败不阻断其余),来源可溯源。
 *
 * 设计原则:
 * - 纯 TS 零 DOM;复用 `aging.ts`(老化条目) + `refresh.ts`(翻新草稿骨架)
 *   + `forecast.ts`(预期效果) + `publish-queue/types.ts`(排队输入契约);
 * - 生成结果只是**计划**(不执行排队/保存),由 app store 执行落地;
 * - 每条翻新草稿为**新草稿**(不动原文),排队可取消;
 * - 数据脱敏:不含 remoteUrl / token 等敏感字段。
 */
import type { AgingContent } from "./aging.js";
import { buildRefreshDraft, type RefreshDraftResult } from "./refresh.js";
import { forecastPerformance, type ForecastResult } from "../forecast/forecast.js";
import type { PerformanceRecord } from "../analytics/types.js";
import type { NewPublishQueueEntry } from "../publish-queue/types.js";

/** 一条「翻新入队」计划(翻新草稿骨架 + 排队输入)。 */
export interface RefreshQueuePlanItem {
  /** 老化内容引用。 */
  readonly source: Readonly<AgingContent>;
  /** 翻新草稿骨架(由 refresh.ts 生成,新草稿,不动原文)。 */
  readonly refreshed: RefreshDraftResult;
  /** 排队输入(时间/平台/账号引用由调用方补全;此处给默认建议)。 */
  readonly queueInput: NewPublishQueueEntry;
  /** 效果预测(基于历史,用于排期参考;缺数据 safeFallback)。 */
  readonly forecast: ForecastResult;
  /** 是否可安全排队(翻新草稿内容非空)。 */
  readonly ok: boolean;
  /** 失败原因(ok=false 时)。 */
  readonly error?: string;
  /** 翻新闭环标记(供效果回收自动配对;原版标题 → 翻新标题)。 */
  readonly refreshMark?: {
    /** 原版标题(翻新前)。 */
    readonly originalTitle: string;
    /** 翻新后标题(含日期后缀)。 */
    readonly refreshedTitle: string;
  };
}

/** 批量翻新入队结果。 */
export interface RefreshQueuePlan {
  readonly generatedAt: string;
  readonly items: readonly RefreshQueuePlanItem[];
  /** 成功计划数。 */
  readonly planned: number;
  /** 失败条数(如无正文可翻新)。 */
  readonly failed: number;
  /** 人类可读摘要。 */
  readonly summary: string;
}

/** 批量翻新入队选项。 */
export interface RefreshQueueOptions {
  /** 效果记录(供预测,可选)。 */
  readonly performanceRecords?: readonly PerformanceRecord[];
  /** 翻新说明(插入翻新草稿头部,可选)。 */
  readonly refreshNote?: string;
  /** 是否把当前日期追加到翻新草稿标题(默认 true)。 */
  readonly appendDateToTitle?: boolean;
  /** 排队默认平台(为空则交由调用方/用户选择)。 */
  readonly defaultPlatformIds?: readonly string[];
  /** 排队期望时间(ISO;默认由调用方/用户选择,此处给 now+1h 建议)。 */
  readonly defaultScheduledAt?: string;
  /** 注入时钟(测试用)。 */
  readonly now?: () => string;
}

/** 提取某老化条目对应草稿正文(由调用方提供草稿表;找不到返回空)。 */
export type DraftLookup = (
  draftId: string | undefined,
  title: string,
) => { readonly title: string; readonly markdown: string } | undefined;

/**
 * REFRESH-QUEUE-01 生成批量翻新入队计划。
 *
 * - 只处理 `action === "refresh"` 的老化条目;
 * - 每条用 `buildRefreshDraft` 生成翻新草稿骨架(需调用方提供原文正文);
 * - 附带 `forecastPerformance` 预期效果供排期参考;
 * - 排队输入给出默认建议(时间=默认/now+1h,平台=默认平台),调用方可覆盖。
 */
export function planRefreshQueue(
  agingItems: readonly Readonly<AgingContent>[],
  lookupDraft: DraftLookup,
  options: RefreshQueueOptions = {},
): RefreshQueuePlan {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const records = options.performanceRecords ?? [];
  const defaultPlatforms = (options.defaultPlatformIds ?? []).filter((x) => typeof x === "string" && x.length > 0);
  const defaultAt = options.defaultScheduledAt && Number.isFinite(Date.parse(options.defaultScheduledAt))
    ? options.defaultScheduledAt
    : new Date(new Date(generatedAt).getTime() + 3_600_000).toISOString();

  const items: RefreshQueuePlanItem[] = [];
  let failed = 0;

  for (const aging of agingItems) {
    if (aging.action !== "refresh") continue;
    // 跨平台聚合的老化条目 draftId 常为空,退回到按标题查找草稿。
    const draft = lookupDraft(aging.draftId, aging.title);
    if (!draft || !draft.markdown.trim()) {
      failed++;
      continue;
    }

    // 翻新草稿骨架(不动原文,生成新草稿)。
    const refreshed = buildRefreshDraft({
      title: draft.title || aging.title,
      markdown: draft.markdown,
      refreshNote: options.refreshNote,
      reason: (aging.reasons ?? []).join("；") || aging.suggestion || "翻新重发",
      appendDateToTitle: options.appendDateToTitle,
      now,
    });

    if (!refreshed.markdown.trim()) {
      failed++;
      continue;
    }

    const forecast = forecastPerformance(records, {
      title: refreshed.title,
      contentText: refreshed.markdown,
      topN: 3,
      now,
    });

    const queueInput: NewPublishQueueEntry = {
      name: refreshed.title,
      draftId: aging.draftId ?? "",
      platformIds: [...defaultPlatforms],
      scheduledAt: defaultAt,
      realPublish: true,
    };

    items.push({
      source: aging,
      refreshed,
      queueInput,
      forecast,
      ok: true,
      refreshMark: {
        originalTitle: draft.title || aging.title,
        refreshedTitle: refreshed.title,
      },
    });
  }

  return {
    generatedAt,
    items,
    planned: items.length,
    failed,
    summary:
      items.length > 0
        ? `已生成 ${items.length} 条翻新入队计划${failed > 0 ? `,${failed} 条因无正文跳过` : ""}。`
        : `没有可翻新的老化内容${failed > 0 ? `(${failed} 条因无正文跳过)` : ""}。`,
  };
}

/**
 * 便捷:从老化检测结果里取 action=refresh 的条目。
 */
export function refreshableAgingItems(items: readonly Readonly<AgingContent>[]): readonly AgingContent[] {
  return items.filter((i) => i.action === "refresh");
}
