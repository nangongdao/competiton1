/**
 * DATA-02 发布效果回收 + DATA-03 官方 API 指标同步。
 *
 * 设计原则(路线图 §5.3):
 * - 先支持可解释、低权限来源:手工录入 + CSV 导入,不抓取受限数据;
 * - 官方 API 平台单独评估:每个平台一个 `MetricsProvider`,数据经校验与归一化;
 * - 回收数据与发布历史解耦存储,可增量追加与按发布去重。
 *
 * 纯 TS、零 DOM,可被 app 服务层与桌面端复用。
 */

/** 阅读/互动效果指标(可选字段,按平台可得性填充)。 */
export interface PostMetrics {
  /** 阅读量/播放量。 */
  readonly views?: number;
  /** 点赞数。 */
  readonly likes?: number;
  /** 收藏/在看数。 */
  readonly favorites?: number;
  /** 评论数。 */
  readonly comments?: number;
  /** 分享/转发数。 */
  readonly shares?: number;
  /** 粉丝变化(可为负)。 */
  readonly followerDelta?: number;
}

/** 平台表现记录(一次发布的一条效果快照)。 */
export interface PerformanceRecord {
  readonly id: string;
  readonly platformId: string;
  /** 关联发布历史条目 id(可为空:手工录入未关联)。 */
  readonly historyId?: string;
  /** 内容/草稿标题(便于人读)。 */
  readonly title: string;
  /** 远端文章 id / URL(官方 API 同步或手工录入)。 */
  readonly remoteId?: string;
  readonly remoteUrl?: string;
  /** 发布时间。 */
  readonly publishedAt: string;
  /** 数据采集时间。 */
  readonly collectedAt: string;
  readonly metrics: PostMetrics;
  /** 数据来源:manual / csv / api:<providerId>。 */
  readonly source: string;
}

/** 效果记录存储(版本化)。 */
export interface PerformanceStore {
  readonly schemaVersion: number;
  list(): Promise<readonly PerformanceRecord[]>;
  listByPlatform(platformId: string): Promise<readonly PerformanceRecord[]>;
  get(id: string): Promise<PerformanceRecord | undefined>;
  put(record: PerformanceRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 官方 API 指标提供者(每个平台一个,单独评估权限与 ToS)。 */
export interface MetricsProvider {
  readonly platformId: string;
  /** 是否配置了凭据(未配置时同步跳过并给出提示)。 */
  isConfigured(): boolean;
  /** 拉取一篇发布的指标(不可得字段留空)。 */
  fetchMetrics(remoteId: string, signal?: AbortSignal): Promise<PostMetrics>;
}

/** 指标提供者注册表(加平台零改核心)。 */
export class MetricsProviderRegistry {
  private readonly providers = new Map<string, MetricsProvider>();
  register(provider: MetricsProvider): void {
    this.providers.set(provider.platformId, provider);
  }
  get(platformId: string): MetricsProvider | undefined {
    return this.providers.get(platformId);
  }
  list(): readonly MetricsProvider[] {
    return [...this.providers.values()];
  }
}

/** 全局注册表(默认空,接线方注册)。 */
export const metricsProviderRegistry = new MetricsProviderRegistry();
