/**
 * PreviewWorkerClient —— 预览适配 Worker 的轻量封装。
 *
 * 提供:
 * - 单例 Worker 惰性创建(Vite `?worker` 导入,浏览器/桌面均可);
 * - 请求序号(seq)守卫:只回传最新一次请求的结果;
 * - Worker 不可用(SSR/受限环境)时返回 null,store 自动回退主线程同步适配。
 */
import AdaptWorker from "./adapt-worker.js?worker";
import type { PlatformResult } from "@mpp/core";

export interface PreviewAdaptRequest {
  readonly seq: number;
  readonly markdown: string;
  readonly authorName: string;
  readonly tags: readonly string[];
  readonly selectedPlatforms: readonly string[];
}

export interface PreviewAdaptResponse {
  readonly seq: number;
  readonly ok: boolean;
  readonly cached?: boolean;
  readonly results?: PlatformResult[];
  readonly error?: string;
}

let worker: Worker | null = null;
let seq = 0;

/** 创建 Worker 单例;失败返回 null。 */
export function getPreviewWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new AdaptWorker();
  } catch {
    worker = null;
  }
  return worker;
}

/** 请求一次 Worker 适配。若 Worker 不可用返回 null(调用方回退主线程)。 */
export function requestPreviewAdapt(
  req: Omit<PreviewAdaptRequest, "seq">,
): Promise<PreviewAdaptResponse> | null {
  const w = getPreviewWorker();
  if (!w) return null;
  const mySeq = ++seq;
  return new Promise((resolve) => {
    const onMsg = (ev: MessageEvent<PreviewAdaptResponse>) => {
      if (ev.data.seq !== mySeq) return; // 过期结果,丢弃。
      w.removeEventListener("message", onMsg);
      resolve(ev.data);
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ ...req, seq: mySeq });
  });
}

/** 供 store 使用的纯请求序号(与 Worker 内部 seq 解耦)。 */
export function nextPreviewSeq(): number {
  return ++seq;
}
