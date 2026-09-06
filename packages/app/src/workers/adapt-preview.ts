/**
 * 预览适配纯逻辑 —— 供 Web Worker 与主线程回退共用。
 *
 * 输入与 store 的 adapt() 等价;输出 PlatformResult[](stageOnly,不触网)。
 * 纯 TS 零 DOM,可同时运行在 Worker 与 Node 测试环境。
 */
import { markdownToIR, syncToPlatforms, type PlatformResult } from "@mpp/core";

export interface AdaptPreviewInput {
  readonly markdown: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  readonly selectedPlatforms: readonly string[];
}

/** 对一组平台执行 stageOnly 适配(解析 → 序列化 → 校验 → 排版评分)。 */
export async function adaptPreview(input: AdaptPreviewInput): Promise<PlatformResult[]> {
  const { document, assetTable } = markdownToIR(input.markdown, {
    meta: { authorName: input.authorName, tags: input.tags, canonicalUrl: "https://example.com/post" },
  });
  return syncToPlatforms(document, [...input.selectedPlatforms], {
    stageOnly: true,
    assetTable,
    now: () => new Date().toISOString(),
  });
}
