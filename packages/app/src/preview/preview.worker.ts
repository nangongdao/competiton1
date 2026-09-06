/**
 * 预览 Web Worker 主体(PERF-02)。
 *
 * 在独立线程持有 PreviewPipeline 实例,跨请求复用缓存;
 * 通过请求序号丢弃过期输入(慢输入不重算)。
 */
/// <reference lib="webworker" />
import { PreviewPipeline } from "@mpp/core";
import type { PreviewWorkerRequest, PreviewWorkerResponse } from "./worker-host.js";

const pipeline = new PreviewPipeline();

self.onmessage = (event: MessageEvent<PreviewWorkerRequest>) => {
  const { seq, input } = event.data;
  // 直接同步计算;主线程侧已有防抖 + 序号过滤,Worker 内无需额外异步。
  const results = pipeline.adapt(input);
  const response: PreviewWorkerResponse = { seq, results };
  (self as unknown as Worker).postMessage(response);
};
