/**
 * 预览同步计算(PERF-02 兜底)。
 *
 * Worker 不可用(测试/极旧环境/受限 CSP)时,在主线程用 PreviewPipeline 同步计算。
 * 与 Worker 内同一代码路径,保证结果一致。
 */
import { PreviewPipeline } from "@mpp/core";
import type { PreviewInput, PreviewResult } from "@mpp/core";

const pipeline = new PreviewPipeline();

export function computePreviewSync(input: PreviewInput): readonly PreviewResult[] {
  return pipeline.adapt(input);
}
