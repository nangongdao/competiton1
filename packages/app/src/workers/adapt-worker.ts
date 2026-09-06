/**
 * 预览适配 Web Worker —— 把"Markdown → IR → 多平台序列化/校验/评分"从主线程搬走。
 *
 * 背景:core 是零 DOM 纯 TS,天然可放进 Worker(架构红利)。
 * 收益:用户输入时主线程不再做解析/序列化/校验,长任务不阻塞;配合 store 的
 * 250ms 防抖 + 序号守卫 + 本 Worker 内按内容哈希的缓存,预览 p95 明显下降。
 *
 * 协议:
 *   in : { seq, markdown, authorName, tags, selectedPlatforms }
 *   out: { seq, ok, cached?, results?, error? }
 */
/// <reference lib="webworker" />
import type { PlatformResult } from "@mpp/core";
import { adaptPreview } from "./adapt-preview.js";

declare const self: DedicatedWorkerGlobalScope;

interface AdaptRequest {
  readonly seq: number;
  readonly markdown: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  readonly selectedPlatforms: readonly string[];
}

interface AdaptResponse {
  readonly seq: number;
  readonly ok: boolean;
  readonly cached?: boolean;
  readonly results?: PlatformResult[];
  readonly error?: string;
}

/** 上次计算结果缓存:源+元数据+平台选择不变时零重算。 */
let lastKey = "";
let lastResults: PlatformResult[] = [];

function keyOf(req: AdaptRequest): string {
  return [req.markdown, req.authorName, req.tags.join("\u0000"), req.selectedPlatforms.join(",")].join("\u0001");
}

self.onmessage = async (ev: MessageEvent<AdaptRequest>) => {
  const req = ev.data;
  const key = keyOf(req);
  if (key === lastKey) {
    self.postMessage({ seq: req.seq, ok: true, cached: true, results: lastResults } satisfies AdaptResponse);
    return;
  }
  try {
    const results = await adaptPreview(req);
    lastKey = key;
    lastResults = results;
    self.postMessage({ seq: req.seq, ok: true, cached: false, results } satisfies AdaptResponse);
  } catch (err) {
    self.postMessage({
      seq: req.seq,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies AdaptResponse);
  }
};
