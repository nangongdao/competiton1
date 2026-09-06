/**
 * 轻量 Toast 消息系统(模块级 emitter)。
 *
 * 任何组件(复制/导出/导入/保存/发布等)都可直接 `toast(msg, kind)` 弹出一条
 * 短暂提示,无需层层传递回调;App 顶层挂载 <ToastHost/> 统一渲染。
 * 极简实现:单条队列、自动消失、无第三方依赖。
 */
export type ToastKind = "info" | "success" | "error";

export interface ToastMessage {
  readonly id: number;
  readonly message: string;
  readonly kind: ToastKind;
}

type ToastListener = (toast: ToastMessage) => void;

let seq = 0;
const listeners = new Set<ToastListener>();

/** 弹出一条 Toast(线程安全,任意环境可调用)。 */
export function toast(message: string, kind: ToastKind = "info"): void {
  const item: ToastMessage = { id: ++seq, message, kind };
  for (const cb of listeners) cb(item);
}

/** 订阅新的 Toast(返回取消函数)。 */
export function subscribeToasts(cb: ToastListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
