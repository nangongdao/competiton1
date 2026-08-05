# competition1 性能与能力升级方案

> 配套文档：`UPGRADE_PLAN.md`（安全与工程质量）
> 本文档专注**性能提升**与**能力进阶**。
> 审计日期：2026-08-01

---

## 0. 为什么需要这份文档

`UPGRADE_PLAN.md` 覆盖的是漏洞与工程规范 —— 那是"不扣分"。
本文档覆盖的是"拿高分"：让工具跑得更快、支持的场景更多、架构更有说服力。

本项目的架构底子（IR + 能力声明式适配器）是三个项目中最好的，
**正因如此，性能与能力上的短板才更值得补** —— 好架构应该配得上好性能。

---

## 1. 【P0】图片重托管串行化 —— 最大的性能瓶颈

### 1.1 问题

`packages/core/src/assets/rehost-engine.ts:44-58`（以及 `:64-81` 的退化路径）
使用 `for await` **逐张串行上传**：

```ts
for (const asset of imageAssets) {
  if (asset.rehosted[ctx.platformId]) continue;
  try {
    const result = await adapter.rehostAsset(asset, ctx);   // ← 一张传完才传下一张
    // ...
  } catch {
    // 单图失败不阻断
  }
}
```

对比之下，**平台层是并行的**（`sync-engine.ts:63-76` 用 concurrency 3 的 worker 池）
—— 说明作者理解并发，只是漏了资产层这一环。

### 1.2 量化影响

典型场景：4 平台 × 每篇 12 张图，单图上传 300ms（含网络往返）：

| 方案 | 耗时 | 说明 |
|---|---|---|
| **当前实现** | **7.2 秒** | 平台并发 3，但平台内 12 张图串行 |
| 平台内并发 6 | **1.2 秒** | **提速 6 倍** |

图片多的长文（30 张图）差距更大：当前 18 秒 → 优化后 3 秒。

**这是用户能直接感知的等待时间** —— 点了"发布"之后干等 7 秒 vs 1 秒，
在评委现场演示时的观感差异极大。

### 1.3 改造方案

```ts
// packages/core/src/assets/rehost-engine.ts

/** 单平台内并发上传图片的数量上限（过高会触发平台图床限流）。 */
const DEFAULT_ASSET_CONCURRENCY = 6;

/**
 * 以受控并发执行异步任务，保持结果顺序。
 *
 * @param items 待处理项
 * @param limit 并发上限
 * @param worker 处理单项的异步函数
 * @returns 与输入等长、顺序一致的结果数组
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]!, index);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

export async function rehostDocumentAssets(
  adapter: PlatformAdapter,
  doc: Document,
  ctx: RehostContext,
  assetTable?: AssetTable,
): Promise<RehostResult> {
  const imageAssets = doc.assets.filter((a) => a.kind === "image" && isRehostable(a));
  if (imageAssets.length === 0) return { doc, failures: [] };

  const pending = imageAssets.filter((a) => !a.rehosted[ctx.platformId]);
  const failures: RehostFailure[] = [];

  const outcomes = await mapWithConcurrency(
    pending,
    ctx.concurrency ?? DEFAULT_ASSET_CONCURRENCY,
    async (asset) => {
      try {
        const result = await adapter.rehostAsset(asset, ctx);
        return { asset, result, error: null };
      } catch (err) {
        // 单图失败不阻断整篇，但记录明细（配合 UPGRADE_PLAN 的 ARCH-01）
        return { asset, result: null, error: err };
      }
    },
  );

  for (const outcome of outcomes) {
    if (outcome.error || !outcome.result) {
      failures.push({
        assetId: outcome.asset.id,
        sourceUrl: outcome.asset.source.url ?? "(dataUrl)",
        platformId: ctx.platformId,
        reason: outcome.error instanceof Error ? outcome.error.message : "上传返回空结果",
      });
      continue;
    }
    if (outcome.result.url || outcome.result.mediaId) {
      assetTable?.recordRehost(outcome.asset.id, ctx.platformId, {
        url: outcome.result.url,
        mediaId: outcome.result.mediaId,
      });
    }
  }

  return { doc: { ...doc, assets: assetTable?.all() ?? doc.assets }, failures };
}
```

**注意事项**：并发数不宜过高。微信公众号素材接口有频率限制，
建议 `wechat` 平台用 3，其余用 6，通过 `ctx.concurrency` 按平台配置。

---

## 2. 【P0】跨平台图片去重 —— 省掉 75% 的重复上传

### 2.1 问题

当前 `rehosted` 是**按平台**记录的（`asset.rehosted[platformId]`），
这本身没错（不同平台图床 URL 不同）。但存在两处浪费：

1. **同一篇文档内重复引用的图片**（如反复出现的 logo）会被多次上传
2. **同一张图发到 4 个平台**时，需要 4 次上传 —— 这是必需的，但
   **图片的预处理（压缩、格式转换、尺寸调整）被重复做了 4 次**

### 2.2 改造：内容寻址 + 预处理缓存

```ts
// packages/core/src/assets/content-hash.ts

/**
 * 计算图片内容哈希，用于去重与缓存键。
 *
 * 使用 SHA-256 前 16 位十六进制，碰撞概率可忽略。
 *
 * @param bytes 图片二进制数据
 * @returns 十六进制哈希前缀
 */
export async function computeContentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

```ts
// packages/core/src/assets/preprocess-cache.ts

/**
 * 图片预处理结果缓存。
 *
 * 同一张图发往多个平台时，压缩/格式转换只做一次；
 * 平台特定的处理（如尺寸）单独缓存。
 */
export class PreprocessCache {
  private readonly cache = new Map<string, Uint8Array>();

  /**
   * 获取或计算预处理结果。
   *
   * @param contentHash 原图内容哈希
   * @param variant 变体标识（如 "webp-1080" / "jpeg-800"）
   * @param compute 缓存未命中时的计算函数
   */
  async getOrCompute(
    contentHash: string,
    variant: string,
    compute: () => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    const key = `${contentHash}:${variant}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const computed = await compute();
    this.cache.set(key, computed);
    return computed;
  }
}
```

**收益**：文档内重复图片零重复上传；预处理开销从 O(平台数 × 图片数)
降到 O(图片数)。

---

## 3. 【P1】增量适配 —— 编辑时不重跑全量管线

### 3.1 问题

当前每次内容变化都会走完整的
`parse → preprocess → rehost → serialize → validate` 管线。
Web UI 的实时预览场景下，用户每敲一个字都可能触发全量重算。

### 3.2 改造：分层缓存 + 脏标记

```ts
// packages/core/src/pipeline/incremental.ts

/** 管线各阶段的缓存条目。 */
type StageCache = {
  /** 源 Markdown 的哈希，变化则整条失效 */
  sourceHash: string;
  ir: Document | null;
  /** 按平台缓存的预处理结果 */
  preprocessed: Map<string, Document>;
  /** 按平台缓存的序列化产物 */
  serialized: Map<string, SerializedOutput>;
};

/**
 * 增量适配引擎。
 *
 * 只重算受影响的阶段：
 *   - 正文变化 → 全量重算
 *   - 仅平台配置变化 → 复用 IR，只重跑该平台的 preprocess/serialize
 *   - 仅标题/标签变化 → 复用 IR 与图片重托管结果
 */
export class IncrementalAdapter {
  private cache: StageCache | null = null;

  async adapt(
    source: string,
    platformIds: readonly string[],
    options: SyncOptions,
  ): Promise<PlatformResult[]> {
    const sourceHash = await hashString(source);

    // 源变化：整条失效
    if (this.cache?.sourceHash !== sourceHash) {
      this.cache = {
        sourceHash,
        ir: parseMarkdownToIR(source),
        preprocessed: new Map(),
        serialized: new Map(),
      };
    }

    const ir = this.cache.ir!;

    return Promise.all(
      platformIds.map(async (platformId) => {
        const configHash = hashConfig(options.config?.[platformId]);
        const cacheKey = `${platformId}:${configHash}`;

        let output = this.cache!.serialized.get(cacheKey);
        if (!output) {
          const adapter = getAdapter(platformId)!;
          const processed = adapter.preprocess(ir, options.overrides?.[platformId]);
          output = adapter.serialize(processed);
          this.cache!.serialized.set(cacheKey, output);
        }

        return { platformId, output };
      }),
    );
  }
}
```

**收益**：预览响应从"全量重算"（数百毫秒）降到"命中缓存直出"（<10ms），
输入体验从卡顿变流畅。

### 3.3 前端配合：防抖 + Web Worker

```ts
// packages/app/src/state/store.ts

/**
 * 预览更新防抖。
 *
 * 用户连续输入时只在停顿 250ms 后触发适配，
 * 避免每次按键都跑管线。
 */
const PREVIEW_DEBOUNCE_MS = 250;
```

进一步可把 core 的适配逻辑放进 Web Worker，彻底不阻塞输入：

```ts
// packages/app/src/workers/adapt-worker.ts
import { syncToPlatforms } from "@mpp/core";

self.onmessage = async (event: MessageEvent<AdaptRequest>) => {
  const results = await syncToPlatforms(event.data.doc, event.data.platformIds);
  self.postMessage(results);
};
```

core 是**零 DOM 依赖的纯 TS**（README 明确说明）—— 这个设计
让它天然可以跑在 Worker 里，**是架构红利，应该兑现**。

---

## 4. 【P1】发布可靠性：断点续传与并发控制

### 4.1 分阶段发布状态机

当前发布是"一把梭"，中途失败需要全部重来。改为可恢复的状态机：

```ts
/** 发布任务的持久化状态。 */
export type PublishState = {
  readonly taskId: string;
  readonly platformId: string;
  /** 各阶段完成情况，支持从断点继续 */
  readonly stages: {
    readonly preprocessed: boolean;
    readonly assetsRehosted: readonly string[];   // 已完成的 assetId
    readonly serialized: boolean;
    readonly staged: boolean;
    readonly published: boolean;
  };
  readonly idempotencyKey: string;
  readonly lastError?: string;
};
```

失败重试时跳过已完成阶段 —— 尤其是**已上传的图片不再重传**，
这在图多的长文中能省下大量时间。

### 4.2 自适应并发

不同平台的限流策略不同，固定 concurrency 3 不是最优：

```ts
/** 按平台的并发与重试策略。 */
export const PLATFORM_RATE_POLICY: Record<string, RatePolicy> = {
  wechat: { assetConcurrency: 3, retryBaseMs: 1000, maxRetries: 3 },
  zhihu: { assetConcurrency: 6, retryBaseMs: 500, maxRetries: 3 },
  bilibili: { assetConcurrency: 4, retryBaseMs: 800, maxRetries: 3 },
  xiaohongshu: { assetConcurrency: 6, retryBaseMs: 500, maxRetries: 2 },
};
```

配合遇到 429 时自动降低并发的自适应逻辑：

```ts
/**
 * 自适应并发控制器。
 *
 * 遇到限流响应时减半并发，连续成功则缓慢恢复 —— AIMD 策略。
 */
export class AdaptiveConcurrency {
  private current: number;

  onRateLimited(): void {
    this.current = Math.max(1, Math.floor(this.current / 2));
  }

  onSuccess(): void {
    if (++this.successStreak >= 10) {
      this.current = Math.min(this.max, this.current + 1);
      this.successStreak = 0;
    }
  }
}
```

---

## 5. 【P2】能力进阶：提升项目竞争力

### 5.1 平台能力自动探测 ★★★★☆

当前 `capabilities.ts` 是**手写的静态声明**。平台改版后需要人工更新。

**改进：能力探测 + 降级建议**

```ts
/**
 * 校验产物是否符合平台当前实际限制。
 *
 * 与静态 capabilities 声明比对，发现不一致时提示用户更新，
 * 而不是发布失败后才发现。
 */
export async function probeplatformLimits(
  platformId: string,
  probe: PlatformProbe,
): Promise<CapabilityDrift[]> {
  const declared = getCapabilities(platformId);
  const actual = await probe.fetchCurrentLimits();

  const drifts: CapabilityDrift[] = [];
  if (actual.maxTitleLength !== declared.maxTitleLength) {
    drifts.push({
      field: "maxTitleLength",
      declared: declared.maxTitleLength,
      actual: actual.maxTitleLength,
    });
  }
  return drifts;
}
```

### 5.2 排版质量评分 ★★★★★

这是**最有答辩价值**的功能：不只是"能发布"，而是"发得好"。

```ts
/** 排版质量评分维度。 */
export type TypographyScore = {
  /** 段落长度分布是否适合移动端阅读（过长段落扣分） */
  readonly paragraphRhythm: number;
  /** 图文比例是否均衡 */
  readonly imageBalance: number;
  /** 标题层级是否规范（跳级扣分） */
  readonly headingStructure: number;
  /** 是否有过长的无分隔文本块 */
  readonly readability: number;
  readonly overall: number;
  readonly suggestions: readonly string[];
};

/**
 * 为平台产物打排版质量分。
 *
 * 不同平台的最佳实践不同：公众号偏好短段落 + 频繁配图，
 * 知乎容忍长段落，小红书要求高图文比。
 */
export function scoreTypography(
  doc: Document,
  platformId: string,
): TypographyScore {
  const prefs = TYPOGRAPHY_PREFERENCES[platformId];
  const paragraphs = doc.blocks.filter((b) => b.type === "paragraph");

  const avgLength =
    paragraphs.reduce((sum, p) => sum + countGraphemes(p.text), 0) /
    Math.max(1, paragraphs.length);

  const suggestions: string[] = [];
  if (avgLength > prefs.idealParagraphLength * 1.5) {
    suggestions.push(
      `段落偏长（平均 ${Math.round(avgLength)} 字），` +
      `${prefs.name} 建议控制在 ${prefs.idealParagraphLength} 字以内以适配移动端阅读`,
    );
  }
  // ...
  return { /* ... */ suggestions };
}
```

在 UI 中显示"公众号排版分 82/100，建议拆分第 3 段"——
**这是从"工具"升级到"助手"的关键一步**，评委会明显感知到产品思维。

### 5.3 A/B 标题与摘要生成 ★★★☆☆

已有 LLM 接线（`llm/enhance.ts`），可扩展为多方案生成 + 平台适配：

```ts
/**
 * 为每个平台生成风格适配的标题候选。
 *
 * 公众号偏好悬念式，知乎偏好专业性，
 * 小红书需要 emoji + 话题标签，B站偏好口语化。
 */
export async function generateTitleVariants(
  doc: Document,
  platformId: string,
  llm: LLMClient,
  count = 3,
): Promise<readonly string[]> {
  const style = PLATFORM_TITLE_STYLE[platformId];
  // ...
}
```

### 5.4 发布效果回收 ★★★☆☆

发布后拉取各平台的阅读量/点赞数，形成闭环：

```ts
/** 发布效果数据。 */
export type PublishMetrics = {
  readonly platformId: string;
  readonly publishedAt: string;
  readonly views?: number;
  readonly likes?: number;
  readonly comments?: number;
};
```

有了数据回收，才能验证 §5.2 的排版评分是否真的有效 ——
**这是让项目从"演示品"变成"产品"的关键**。

---

## 6. 【P2】前端性能

### 6.1 预览渲染优化

`PlatformPreview.tsx` 若为每个平台渲染完整 HTML，切换时会有明显卡顿。

```tsx
/**
 * 平台预览：只渲染当前激活的平台，其余保持卸载。
 *
 * 4 个平台的完整 HTML 同时挂载会导致 DOM 节点数翻 4 倍。
 */
const activePreview = useMemo(
  () => renderPreview(results[activePlatformId]),
  [results, activePlatformId],
);
```

### 6.2 封面渲染用 OffscreenCanvas

`render/cover-canvas-renderer.ts` 在主线程渲染封面会阻塞 UI：

```ts
/**
 * 在 Worker 中渲染封面，不阻塞主线程。
 *
 * OffscreenCanvas 可在 Worker 中操作，渲染完成后
 * 通过 transferToImageBitmap 零拷贝回传。
 */
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: offscreen, spec }, [offscreen]);
```

---

## 7. 性能基线与验收

| 指标 | 当前 | 目标 | 验证方式 |
|---|---|---|---|
| 4 平台 × 12 图 发布耗时 | 7.2s | **≤ 1.5s** | 打点计时 |
| 4 平台 × 30 图 发布耗时 | ~18s | ≤ 3.5s | 同上 |
| 预览更新延迟（缓存命中） | 全量重算 | **≤ 10ms** | Performance 面板 |
| 输入到预览的感知延迟 | 卡顿 | ≤ 300ms（含防抖） | 用户测试 |
| 重复图片上传次数 | N 次 | 1 次 | 上传计数 |
| 失败重试的重复上传 | 全部重传 | 0（断点续传） | 计数 |

建议新增 `packages/core/test/perf.spec.ts` 做性能回归：

```ts
it("4 平台 12 图重托管应在 2 秒内完成（模拟 300ms/图）", async () => {
  const slowUpload = async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { url: "https://cdn.example.com/x.png" };
  };

  const start = performance.now();
  await syncToPlatforms(docWith12Images, FOUR_PLATFORMS, {
    rehost: buildRehostContexts(slowUpload),
  });
  const elapsed = performance.now() - start;

  expect(elapsed).toBeLessThan(2000);   // 串行实现会是 7200ms
});
```

---

## 8. 实施优先级

| 优先级 | 任务 | 工期 | 收益 |
|---|---|---|---|
| **P0** | §1 重托管并发化 | 半天 | **发布提速 6 倍，用户直接感知** |
| P0 | §2 内容寻址去重 | 1 天 | 消除重复上传 |
| P1 | §3 增量适配 + Worker | 2 天 | 预览从卡顿到流畅 |
| P1 | §4.1 断点续传 | 1–2 天 | 失败重试不重传图片 |
| **P2** | §5.2 排版质量评分 | 2–3 天 | **答辩亮点，产品思维体现** |
| P2 | §4.2 自适应并发 | 1 天 | 避免触发平台限流 |
| P3 | §5.3 A/B 标题 | 1 天 | 锦上添花 |
| P3 | §5.4 效果回收 | 3 天 | 产品闭环 |

**如果只做两件事**：§1（半天，提速 6 倍）+ §5.2（排版评分，答辩加分）。
前者是硬性能，后者是产品高度 —— 一个让评委觉得"快"，一个让评委觉得"想得深"。

---

## 附录：性能数据的推导方式

§1.2 的耗时数据来自对 `rehost-engine.ts:44-58` 与 `sync-engine.ts:63-76`
控制流的分析与计算：

```
当前：ceil(4 平台 / 3 并发) × (12 图 × 300ms) = 2 × 3600ms = 7200ms
优化：ceil(4 平台 / 3 并发) × ceil(12 图 / 6 并发) × 300ms = 2 × 600ms = 1200ms
```

单图 300ms 是含网络往返的保守估计（局域网会更快，弱网会更慢），
但**串行 vs 并发的倍数关系与单图耗时无关** —— 提速比例恒为
`min(图片数, 并发数)`，本例为 6 倍。

实际数值应在接入真实图床后用 §7 的性能测试校准。

*本方案基于 2026-08-01 的代码状态。*
