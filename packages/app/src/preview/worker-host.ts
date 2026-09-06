/**
 * 预览 Web Worker 封装(PERF-02)。
 *
 * 把 PreviewPipeline(纯 TS、零 DOM)放到独立线程执行,避免长文输入卡住主线程。
 * 特性:
 * - 请求序号:Worker 内只回传"最新一次"请求结果,慢的旧请求晚到不覆盖新结果;
 * - 取消:主线程可在新输入到达时中止前一次(Worker 内部不重算过期请求);
 * - 防抖:由 store 的 PREVIEW_DEBOUNCE_MS(250ms)驱动,本模块只管 worker 通信。
 *
 * 使用 Worker 构造器 + `?worker` 后缀(Vite 原生支持),web/扩展双构建均可用。
 */
import type { PreviewInput, PreviewResult } from "@mpp/core";
import { computePreviewSync } from "./preview-sync.js";

export interface PreviewWorkerRequest {
  readonly seq: number;
  readonly input: PreviewInput;
}

export interface PreviewWorkerResponse {
  readonly seq: number;
  readonly results: readonly PreviewResult[];
}

export type PreviewWorker = {
  /** 提交预览请求;seq 单调递增,旧请求自动被忽略。 */
  post(input: PreviewInput): number;
  /** 回调:仅收到"最新 seq"的结果。 */
  onResult(cb: (results: readonly PreviewResult[]) => void): void;
  /** 终止 worker。 */
  dispose(): void;
};

/** Vite 约定:`new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })`。 */
export function createPreviewWorker(): PreviewWorker {
  let worker: Worker | null = null;
  let seq = 0;
  let latestSeq = 0;
  const listeners = new Set<(results: readonly PreviewResult[]) => void>();

  // 显式能力检测:Worker 未定义(测试/node)时直接走同步兑底,不抛错。
  const hasWorker = typeof Worker !== "undefined";
  if (hasWorker) {
    try {
      worker = new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
  }

  const handleMessage = (event: MessageEvent<PreviewWorkerResponse>) => {
    const { seq: respSeq, results } = event.data;
    // 只接受最新一次请求的结果(过期结果丢弃)。
    if (respSeq < latestSeq) return;
    for (const cb of listeners) cb(results);
  };

  worker?.addEventListener("message", handleMessage);

  return {
    post(input) {
      const current = ++seq;
      latestSeq = current;
      if (worker) {
        const req: PreviewWorkerRequest = { seq: current, input };
        worker.postMessage(req);
      } else {
        // Worker 不可用(测试/极旧环境):退化为同步计算(与 Worker 同一代码路径)。
        // 同步路径无乱序风险,但仍按 latestSeq 过滤,保证语义一致。
        const results = computePreviewSync(input);
        if (current === latestSeq) {
          for (const cb of listeners) cb(results);
        }
      }
      return current;
    },
    onResult(cb) {
      listeners.add(cb);
    },
    dispose() {
      listeners.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
