/**
 * ToastHost —— 全局 Toast 挂载点。
 *
 * 订阅 toast.ts 的 emitter,自动消失(3.5s),支持 info/success/error 三种样式。
 * 挂载在 App 顶层,pointer-events 关闭,不遮挡交互。
 */
// @vitest-environment jsdom
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Info, AlertTriangle, X } from "lucide-react";
import { subscribeToasts, type ToastMessage, type ToastKind } from "./toast.js";

const TOAST_DURATION_MS = 3500;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timersRef = timers.current;
    const unsubscribe = subscribeToasts((item) => {
      // 同内容去重:同一条消息只保留最新实例。
      setToasts((prev) => {
        const next = prev.filter((t) => t.message !== item.message);
        return [...next, item].slice(-3);
      });
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
        timersRef.delete(item.id);
      }, TOAST_DURATION_MS);
      timersRef.set(item.id, timer);
    });
    return () => {
      unsubscribe();
      for (const t of timersRef.values()) clearTimeout(t);
      timersRef.clear();
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="alert">
          <ToastIcon kind={t.kind} />
          <span className="toast-msg">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => {
              setToasts((prev) => prev.filter((x) => x.id !== t.id));
              const timer = timers.current.get(t.id);
              if (timer) clearTimeout(timer);
              timers.current.delete(t.id);
            }}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") return <CheckCircle2 size={15} aria-hidden />;
  if (kind === "error") return <AlertTriangle size={15} aria-hidden />;
  return <Info size={15} aria-hidden />;
}
