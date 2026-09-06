/**
 * SaveStatus —— 自动保存状态指示器。
 *
 * 监听 store 的草稿保存状态,展示「已保存 / 保存中 / 未保存」与失败提示。
 * 通过订阅模块级 emitter 解耦,无需改 store 签名。
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, CloudOff, CloudUpload } from "lucide-react";
import { subscribeSaveStatus, type SaveStatus } from "./save-status.js";

export function SaveStatus() {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [msg, setMsg] = useState<string | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeSaveStatus((next, detail) => {
      setStatus(next);
      if (detail) {
        setMsg(detail);
        if (msgTimer.current) clearTimeout(msgTimer.current);
        msgTimer.current = setTimeout(() => setMsg(null), 4000);
      }
    });
    return () => {
      unsubscribe();
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  const label = status === "saving" ? "保存中…" : status === "dirty" ? "未保存" : status === "error" ? "保存失败" : "已保存";

  return (
    <span
      className={`save-status save-status-${status}`}
      title={msg ?? label}
      aria-live="polite"
      role="status"
    >
      {status === "saving" ? (
        <Loader2 size={12} className="spinner" aria-hidden />
      ) : status === "dirty" ? (
        <CloudUpload size={12} aria-hidden />
      ) : status === "error" ? (
        <CloudOff size={12} aria-hidden />
      ) : (
        <Check size={12} aria-hidden />
      )}
      {label}
    </span>
  );
}
