/**
 * 服务器任务面板 —— 展示 server 侧持久化的公众号发布任务(REST /jobs)。
 *
 * 价值:server 用 FileJobStore 把任务落盘,进程重启后仍可从此面板恢复/续跑,
 * 与 app 本地 TaskPanel(内存/IndexedDB 任务)互补。
 *
 * 能力:
 * - 拉取 GET /jobs 任务列表(仅元信息,不含正文 payload);
 * - 对非终态任务「恢复」(resume,checkpoint 续跑);
 * - 取消 / 重试平台。
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Server, Play, XCircle, RotateCw, Inbox, Loader2 } from "lucide-react";
import type { ServerJobSummary } from "../bridge/types.js";

interface Props {
  serverUrl: string;
  serverToken: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 实际调用方(web/扩展/桌面共用同一接口)。 */
  api: {
    list: (req: { serverUrl: string; token?: string }) => Promise<import("../bridge/types.js").ServerJobApiResult>;
    resume: (req: { serverUrl: string; token?: string; jobId: string }) => Promise<import("../bridge/types.js").ServerJobApiResult>;
    cancel: (req: { serverUrl: string; token?: string; jobId: string }) => Promise<import("../bridge/types.js").ServerJobApiResult>;
    retry: (req: { serverUrl: string; token?: string; jobId: string; platformId?: string }) => Promise<import("../bridge/types.js").ServerJobApiResult>;
  };
}

const STAGE_LABEL: Record<string, string> = {
  queued: "排队中",
  adapting: "适配中",
  validating: "校验中",
  uploading: "上传中",
  staging: "暂存中",
  "awaiting-confirmation": "等待确认",
  submitting: "提交中",
  verifying: "核验中",
  succeeded: "已成功",
  "needs-user-action": "需人工处理",
  failed: "失败",
  unknown: "状态未知",
  cancelled: "已取消",
};

const STAGE_CLASS: Record<string, string> = {
  succeeded: "ok",
  "needs-user-action": "warn",
  failed: "bad",
  unknown: "warn",
  cancelled: "muted",
};

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

function isTerminal(stage: string): boolean {
  return stage === "succeeded" || stage === "failed" || stage === "unknown" || stage === "cancelled";
}

export function ServerJobsPanel({ serverUrl, serverToken, open, onOpenChange, api }: Props) {
  const [jobs, setJobs] = useState<ServerJobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.list({ serverUrl, token: serverToken || undefined });
      if (!result.ok) {
        setError(result.error ?? "无法获取服务器任务");
        setJobs([]);
      } else {
        setJobs(result.jobs ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [serverUrl, serverToken, api]);

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const action = async (
    jobId: string,
    kind: "resume" | "cancel" | "retry",
    platformId?: string,
  ) => {
    setBusyId(jobId);
    setError(null);
    try {
      if (kind === "resume") {
        await api.resume({ serverUrl, token: serverToken || undefined, jobId });
      } else if (kind === "cancel") {
        await api.cancel({ serverUrl, token: serverToken || undefined, jobId });
      } else {
        await api.retry({ serverUrl, token: serverToken || undefined, jobId, platformId });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="drawer-scrim" onClick={() => onOpenChange(false)}>
      <div className="drawer server-jobs-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="服务器任务面板">
        <div className="drawer-header">
          <span className="drawer-title">
            <Server size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            服务器任务(持久化)
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void refresh()} aria-label="刷新服务器任务" disabled={loading}>
            {loading ? <Loader2 size={14} className="spinner" aria-hidden /> : <RefreshCw size={14} />}
          </button>
        </div>

        <div className="server-jobs-hint">
          这些任务由本地 server 以文件方式持久化(FileJobStore)。server 重启后可在「恢复」续跑,不重复已成功平台。
        </div>

        {error && <div className="task-error">{error}</div>}

        {!loading && jobs.length === 0 && !error ? (
          <div className="panel-empty">
            <span className="panel-empty-icon" aria-hidden>
              <Inbox size={28} />
            </span>
            <span className="panel-empty-title">暂无服务器任务</span>
            <span className="panel-empty-hint">
              需要启动 server(npm run server)并配置公众号凭据后,真实发布任务才会在这里持久化。
            </span>
          </div>
        ) : (
          <div className="task-list">
            {jobs.map((job) => (
              <div key={job.id} className="task-card">
                <div className="task-card-head">
                  <div className="task-title">
                    <span className={`stage-dot ${STAGE_CLASS[job.stage] ?? "muted"}`} aria-hidden />
                    <span className="task-id">#{job.id.slice(0, 8)}</span>
                    <span className="task-status">{stageLabel(job.stage)}</span>
                  </div>
                  <div className="task-meta">
                    {!isTerminal(job.stage) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void action(job.id, "resume")}
                        disabled={busyId === job.id}
                        aria-label="恢复任务"
                      >
                        {busyId === job.id ? <Loader2 size={13} className="spinner" aria-hidden /> : <Play size={13} />}
                        恢复
                      </button>
                    )}
                    {!isTerminal(job.stage) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void action(job.id, "cancel")}
                        disabled={busyId === job.id}
                        aria-label="取消任务"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="task-platforms">
                  {job.platforms.map((p) => (
                    <div key={p.platformId} className="task-platform">
                      <div className="task-platform-head">
                        <span className="task-platform-name">{p.platformId}</span>
                        <span className={`task-platform-status ${STAGE_CLASS[p.stage] ?? "muted"}`}>
                          {stageLabel(p.stage)}
                          {p.attemptCount > 1 ? ` ×${p.attemptCount}` : ""}
                        </span>
                      </div>
                      {p.error && <div className="task-platform-error">{p.error}</div>}
                      {p.remoteId && <div className="task-platform-msg">远端 ID:{p.remoteId}</div>}
                      {p.stage === "failed" && (
                        <div className="task-platform-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => void action(job.id, "retry", p.platformId)}
                            disabled={busyId === job.id}
                          >
                            <RotateCw size={12} />
                            重试
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
