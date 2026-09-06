/**
 * 自动保存状态 emitter(与 store 解耦的轻量事件通道)。
 *
 * store 在 saveDraft 前后发布 saving/saved/error 状态,SaveStatus 订阅展示。
 * 保存失败时由 store 同时弹 Toast,此处只负责状态广播。
 */
export type SaveStatus = "saved" | "saving" | "dirty" | "error";

type SaveListener = (status: SaveStatus, detail?: string) => void;

let current: SaveStatus = "saved";
const listeners = new Set<SaveListener>();

export function setSaveStatus(status: SaveStatus, detail?: string): void {
  current = status;
  for (const cb of listeners) cb(status, detail);
}

export function getSaveStatus(): SaveStatus {
  return current;
}

export function subscribeSaveStatus(cb: SaveListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
