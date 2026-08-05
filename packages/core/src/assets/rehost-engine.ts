/**
 * 资产重托管编排 —— 把"遍历文档图片资产 → 调适配器 rehostAsset → 回填 IR"串起来。
 *
 * 为什么需要:公众号正文外链图被过滤、B站图片防盗链 403、小红书须本地图,
 * 都要求把图片重托管到目标平台/图床。重托管结果按 (assetId, platformId) 写回
 * Asset.rehosted,使后续 serialize 的 resolveImageSrc 取到平台 URL。
 *
 * 性能(UPGRADE §1/§2):
 * - 单平台内图片以受控并发上传(默认 6,公众号限流严格用 3),结果按输入顺序稳定回填。
 *   图片多的长文从"逐张串行"提速约 min(图数, 并发) 倍。
 * - 同源去重:同一文档内同 source(URL/dataURL/本地路径)只上传一次,结果共享给同源所有资产。
 *
 * 纯编排 + 网络注入:core 不直接发请求,upload 由 server/app 注入(RehostContext)。
 */
import type { Asset, Document } from "../ir/types.js";
import type { PlatformAdapter, RehostContext, RehostResult } from "../adapters/types.js";
import { AssetTable } from "./asset-table.js";
import { isSafeImageUrl } from "./url-guard.js";
import { ratePolicyFor } from "./rate-policy.js";

/** 单张图片重托管失败的明细,供用户/UI 在发布前感知。 */
export type RehostFailure = {
  readonly assetId: string;
  /** 原始图片来源(URL 或 dataUrl 占位)。 */
  readonly sourceUrl: string;
  readonly platformId: string;
  readonly reason: string;
};

/** 重托管失败回调:逐条上报失败明细(单图失败不阻断整篇,但必须让调用方知晓)。 */
export type RehostFailureHandler = (failure: RehostFailure) => void;

/**
 * 以受控并发执行异步任务,保持结果顺序(结果数组与 items 一一对应)。
 *
 * 实现:固定数量 worker 竞争共享游标,先完成的 worker 不抢占其它 worker 的槽位;
 * 每项结果按 index 落位,最终顺序与输入一致 —— 并发提速,但回填确定性不受影响。
 *
 * @param items 待处理项
 * @param limit 并发上限(自动夹到 [1, items.length])
 * @param worker 处理单项的异步函数
 * @returns 与输入等长、顺序一致的结果数组
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** 判断资产是否为可重托管的真实图片(排除变换生成的占位/平台原生资产)。 */
function isRehostable(asset: Asset): boolean {
  // 变换生成的表格图/公式图是平台原生或待 app 渲染,不走图床。
  if (asset.source.generated) return false;
  const url = asset.source.url ?? "";
  const dataUrl = asset.source.dataUrl ?? "";
  // 真实图片:http(s) 外链,或标准 data:image dataURL。
  if (/^https?:\/\//.test(url)) {
    // SSRF 防护:内网/回环/云元数据地址一律不拉取。
    return isSafeImageUrl(url).safe;
  }
  if (/^data:image\//.test(dataUrl)) return true;
  return false;
}

/** 同源去重键:URL > dataURL > 本地路径 > assetId(后两者本质唯一)。 */
function sourceKey(asset: Asset): string {
  return asset.source.url ?? asset.source.dataUrl ?? asset.source.localPath ?? asset.id;
}

/**
 * 对文档内所有可重托管图片资产执行平台重托管,返回回填后的新文档(不可变)。
 *
 * 并发:单平台内图片按 ctx.concurrency ?? 平台限流策略并发上传(UPGRADE §1);
 * 同源图片去重只传一次,结果共享(UPGRADE §2)。
 *
 * @param adapter 目标平台适配器(提供 rehostAsset 策略)
 * @param doc 已 preprocess 的文档
 * @param ctx 重托管上下文(含注入的 upload 与可选并发上限)
 * @param assetTable 可选;传入时经 AssetTable.recordRehost 回填,未传入时退化为不可变 spread
 * @param onFailure 可选;单图重托管失败时回调失败明细(透出给 UI/report,不阻断整篇)
 * @returns 资产已回填 rehosted[platformId] 的新文档
 */
export async function rehostDocumentAssets(
  adapter: PlatformAdapter,
  doc: Document,
  ctx: RehostContext,
  assetTable?: AssetTable,
  onFailure?: RehostFailureHandler,
): Promise<Document> {
  const imageAssets = doc.assets.filter((a) => a.kind === "image" && isRehostable(a));
  if (imageAssets.length === 0) return doc;

  const report = (asset: Asset, reason: string): void => {
    onFailure?.({
      assetId: asset.id,
      sourceUrl: asset.source.url ?? "(dataUrl)",
      platformId: ctx.platformId,
      reason,
    });
  };

  const pending = imageAssets.filter((a) => !a.rehosted[ctx.platformId]);
  if (pending.length === 0) return doc;

  // 同源去重:同一 source 只保留一个待上传项,结果在回填时共享给同源所有资产。
  const unique = new Map<string, Asset>();
  for (const a of pending) unique.set(sourceKey(a), a);
  const items = [...unique.values()];

  const concurrency = ctx.concurrency ?? ratePolicyFor(ctx.platformId).assetConcurrency;
  const outcomes = await mapWithConcurrency(items, concurrency, async (asset): Promise<{ asset: Asset; result: RehostResult | null; error: unknown }> => {
    try {
      return { asset, result: await adapter.rehostAsset(asset, ctx), error: null };
    } catch (err) {
      // 单图失败不阻断:保留原始引用,由校验/序列化层决定降级;但透出失败明细。
      return { asset, result: null, error: err };
    }
  });
  const outcomeBySource = new Map(outcomes.map((o) => [sourceKey(o.asset), o]));

  const updates = new Map<string, Asset>();
  for (const asset of pending) {
    const outcome = outcomeBySource.get(sourceKey(asset));
    if (!outcome) continue;
    if (outcome.error || !outcome.result) {
      report(asset, outcome.error instanceof Error ? outcome.error.message : "图床返回空结果");
      continue;
    }
    const { url, mediaId } = outcome.result;
    if (!url && !mediaId) {
      report(asset, "图床返回空结果");
      continue;
    }
    const record = { url, mediaId };
    assetTable?.recordRehost(asset.id, ctx.platformId, record);
    updates.set(asset.id, {
      ...asset,
      rehosted: { ...asset.rehosted, [ctx.platformId]: record },
    });
  }

  if (updates.size === 0) return doc;
  // 传入了 assetTable:以表为准回填(表感知所有重托管记录);否则退化为不可变 spread。
  return { ...doc, assets: assetTable ? assetTable.all() : doc.assets.map((a) => updates.get(a.id) ?? a) };
}
