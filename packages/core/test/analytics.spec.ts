import { describe, expect, it } from "vitest";
import { MemoryPerformanceStore } from "../src/analytics/store.js";
import {
  parsePerformanceCsv,
  importPerformanceRecords,
  createManualPerformanceRecord,
  summarizePerformance,
  syncMetricsFromProviders,
} from "../src/analytics/import.js";
import {
  MockMetricsProvider,
  WechatOfficialApiMetricsProvider,
  parseWechatArticleSummary,
} from "../src/analytics/providers.js";
import {
  metricsProviderRegistry,
  MetricsProviderRegistry,
  type MetricsProvider,
} from "../src/analytics/types.js";
import { WechatApi } from "../src/index.js";

const CSV_SAMPLE = `platform,title,remote_id,remote_url,published_at,views,likes,favorites,comments,shares,follower_delta
wechat,我的文章,100001,https://mp.weixin.qq.com/s/1,2026-08-05T10:00:00Z,1200,80,30,12,5,3
zhihu,知乎回答,200001,,2026-08-04T09:00:00Z,800,50,0,6,2,-1
wechat,第二篇,100002,,2026-08-03T08:00:00Z,300,20,5,1,0,0
`;

describe("DATA-02 效果回收", () => {
  it("解析 CSV 生成记录(指标可选字段留空)", () => {
    const { records, errors } = parsePerformanceCsv(CSV_SAMPLE);
    expect(errors).toEqual([]);
    expect(records).toHaveLength(3);
    expect(records[0]!.platformId).toBe("wechat");
    expect(records[0]!.metrics.views).toBe(1200);
    expect(records[0]!.metrics.followerDelta).toBe(3);
    expect(records[0]!.remoteId).toBe("100001");
    expect(records[0]!.remoteUrl).toBe("https://mp.weixin.qq.com/s/1");
    expect(records[1]!.metrics.followerDelta).toBe(-1);
    expect(records[1]!.remoteUrl).toBeUndefined();
  });

  it("CSV 缺少必需列时返回错误", () => {
    const { records, errors } = parsePerformanceCsv("platform,views\nwechat,10\n");
    expect(records).toEqual([]);
    expect(errors.some((e) => e.includes("platform / title"))).toBe(true);
  });

  it("CSV 坏行跳过并收集错误,不阻断整体", () => {
    const raw = `platform,title,views\nwechat,第一篇,10\n,缺平台,20\nzhihu,第二篇,30\n`;
    const { records, errors } = parsePerformanceCsv(raw);
    expect(records).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("第 3 行");
  });

  it("导入存储并支持按 remoteId 去重更新", async () => {
    const store = new MemoryPerformanceStore();
    const { records } = parsePerformanceCsv(CSV_SAMPLE);
    const first = await importPerformanceRecords(store, records);
    expect(first.imported).toBe(3);
    expect(first.updated).toBe(0);

    // 同一 remoteId 再次导入:去重更新
    const { records: records2 } = parsePerformanceCsv(
      `platform,title,remote_id,views\nwechat,我的文章,100001,1500\n`,
    );
    const second = await importPerformanceRecords(store, records2, { dedupeByRemoteId: true });
    expect(second.updated).toBe(1);
    expect(second.imported).toBe(0);
    const all = await store.list();
    expect(all).toHaveLength(3);
    const updated = all.find((r) => r.remoteId === "100001");
    expect(updated?.metrics.views).toBe(1500);
  });

  it("手工录入一条记录并打标 source=manual", () => {
    const record = createManualPerformanceRecord({
      platformId: "bilibili",
      title: "视频",
      publishedAt: "2026-08-05T00:00:00Z",
      metrics: { views: 5000, likes: 300 },
    });
    expect(record.source).toBe("manual");
    expect(record.id).toBeTruthy();
    expect(record.collectedAt).toBeTruthy();
  });

  it("按平台汇总效果", async () => {
    const store = new MemoryPerformanceStore();
    const { records } = parsePerformanceCsv(CSV_SAMPLE);
    await importPerformanceRecords(store, records);
    const all = await store.list();
    const summary = summarizePerformance(all);
    expect(summary).toHaveLength(2);
    const wechat = summary.find((s) => s.platformId === "wechat")!;
    expect(wechat.count).toBe(2);
    expect(wechat.totalViews).toBe(1500);
    expect(wechat.avgViews).toBe(750);
  });
});

describe("DATA-03 官方 API 指标同步", () => {
  it("metricsProviderRegistry 注册与查询", () => {
    const local = new MetricsProviderRegistry();
    local.register(new MockMetricsProvider("wechat"));
    expect(local.get("wechat")).toBeDefined();
    expect(local.get("nonexistent")).toBeUndefined();
    // 全局注册表同样可用
    metricsProviderRegistry.register(new MockMetricsProvider("bilibili"));
    expect(metricsProviderRegistry.get("bilibili")).toBeDefined();
  });

  it("syncMetricsFromProviders 拉取指标并写回", async () => {
    const store = new MemoryPerformanceStore();
    const { records } = parsePerformanceCsv(
      `platform,title,remote_id\nwechat,文章,100001\nzhihu,回答,200001\n`,
    );
    await importPerformanceRecords(store, records);

    const wechatProvider = new MockMetricsProvider("wechat", { views: 999, likes: 88 });
    const result = await syncMetricsFromProviders(
      store,
      [wechatProvider],
      await store.list(),
    );
    expect(result.updated).toBe(1); // zhihu 无 provider 被跳过
    expect(result.skipped).toBe(1);
    const updated = (await store.list()).find((r) => r.platformId === "wechat");
    expect(updated?.metrics.views).toBe(999);
    expect(updated?.source).toBe("csv");
  });

  it("未配置凭据的 provider 跳过并提示", async () => {
    const store = new MemoryPerformanceStore();
    const { records } = parsePerformanceCsv(`platform,title,remote_id\nwechat,文章,100001\n`);
    await importPerformanceRecords(store, records);
    const provider = new WechatOfficialApiMetricsProvider({ serverUrl: "http://127.0.0.1:8787" });
    const result = await syncMetricsFromProviders(store, [provider], await store.list());
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors.some((e) => e.includes("未配置凭据"))).toBe(true);
  });

  it("已配置的公众号 provider 经注入 fetch 拉取", async () => {
    const store = new MemoryPerformanceStore();
    const { records } = parsePerformanceCsv(`platform,title,remote_id\nwechat,文章,100001\n`);
    await importPerformanceRecords(store, records);

    const provider = new WechatOfficialApiMetricsProvider({
      serverUrl: "http://127.0.0.1:8787",
      token: "tok",
      fetcher: async ({ serverUrl, token, remoteId }) => {
        expect(serverUrl).toBe("http://127.0.0.1:8787");
        expect(token).toBe("tok");
        expect(remoteId).toBe("100001");
        return { views: 2000, likes: 150 };
      },
    });
    expect(provider.isConfigured()).toBe(true);
    const result = await syncMetricsFromProviders(store, [provider], await store.list());
    expect(result.updated).toBe(1);
    const updated = (await store.list())[0]!;
    expect(updated.metrics.views).toBe(2000);
  });

  it("provider 抛错记入 errors 不影响其他记录", async () => {
    const store = new MemoryPerformanceStore();
    const { records } = parsePerformanceCsv(
      `platform,title,remote_id\nwechat,文章,100001\nwechat,第二篇,100002\n`,
    );
    await importPerformanceRecords(store, records);
    const provider: MetricsProvider = {
      platformId: "wechat",
      isConfigured: () => true,
      async fetchMetrics(remoteId) {
        if (remoteId === "100001") throw new Error("接口超时");
        return { views: 1 };
      },
    };
    const result = await syncMetricsFromProviders(store, [provider], await store.list());
    expect(result.updated).toBe(1);
    expect(result.errors.some((e) => e.includes("接口超时"))).toBe(true);
  });
});

describe("DATA-03 公众号 datacube 响应解析", () => {
  it("解析 list 数组并映射统一指标字段", () => {
    const m = parseWechatArticleSummary({
      list: [
        { ref_date: "2026-08-04", int_page_read_count: 1200, add_to_fav_count: 30, share_count: 5, comment_count: 3, add_to_fav_user: 7 },
      ],
    });
    expect(m.views).toBe(1200);
    expect(m.likes).toBe(30);
    expect(m.favorites).toBe(7);
    expect(m.shares).toBe(5);
    expect(m.comments).toBe(3);
  });

  it("兼容单对象响应与数字字符串", () => {
    const m = parseWechatArticleSummary({ int_page_read_count: "500", add_to_fav_count: 9 });
    expect(m.views).toBe(500);
    expect(m.likes).toBe(9);
  });

  it("无任何数字字段返回空指标", () => {
    expect(parseWechatArticleSummary({ list: [] })).toEqual({});
    expect(parseWechatArticleSummary({})).toEqual({});
  });

  it("core 导出 articleSummary 请求构造(URL 指向 datacube)", () => {
    const req = WechatApi.buildArticleSummaryRequest("TOKEN", "2026-08-01", "2026-08-05");
    expect(req.url).toContain("/datacube/getarticlesummary");
    expect(req.url).toContain("access_token=TOKEN");
    expect(req.body).toEqual({ begin_date: "2026-08-01", end_date: "2026-08-05" });
  });
});
