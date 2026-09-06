import { useShallow } from "zustand/react/shallow";
import {
  RefreshCw,
  XCircle,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  HelpCircle,
  Clock,
  Inbox,
} from "lucide-react";
import { useStore } from "../state/store.js";
import { platformStageLabel } from "@mpp/core";
import type { PublishJob } from "@mpp/core";

const STAGE_COLOR: Record<string, string> = {
  queued: "muted",
  adapting: "active",
  validating: "active",
  uploading: "active",
  staging: "active",
  "awaiting-confirmation": "active",
  submitting: "active",
  verifying: "active",
  succeeded: "ok",
  "needs-user-action": "warn",
  failed: "bad",
  unknown: "warn",
  cancelled: "muted",
};

function statusLabel(stage: string): string {
  return platformStageLabel(stage as Parameters<typeof platformStageLabel>[0]) ?? stage;
}

function elapsed(from: string, to?: string): string {
  const end = to ? Date.parse(to) : Date.now();
  const start = Date.parse(from);
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function TaskPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const jobs = useStore((s) => s.jobs);
  const activeJobId = useStore((s) => s.activeJobId);
  const actions = useStore(
    useShallow((s) => ({
      retryJobPlatform: s.retryJobPlatform,
      cancelJob: s.cancelJob,
      loadJobs: s.loadJobs,
    })),
  );

  if (!open) return null;

  return (
    <div className="drawer-scrim" onClick={() => onOpenChange(false)}>
      <div className="drawer task-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="发布任务面板">
        <div className="drawer-header">
          <span className="drawer-title">发布任务</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void actions.loadJobs()} aria-label="刷新任务">
            <RefreshCw size={14} />
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="panel-empty">
            <span className="panel-empty-icon" aria-hidden>
              <Inbox size={28} />
            </span>
            <span className="panel-empty-title">暂无发布任务</span>
            <span className="panel-empty-hint">点击「真实发布」后,这里会显示每个平台的阶段、耗时与诊断入口。</span>
          </div>
        ) : (
          <div className="task-list">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} isActive={job.id === activeJobId} actions={actions} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobCard({
  job,
  isActive,
  actions,
}: {
  job: PublishJob;
  isActive: boolean;
  actions: { retryJobPlatform: (j: string, p: string) => Promise<void>; cancelJob: (j: string) => Promise<void> };
}) {
  return (
    <div className={`task-card ${isActive ? "active" : ""}`}>
      <div className="task-card-head">
        <div className="task-title">
          <span className={`stage-dot ${STAGE_COLOR[job.stage] ?? "muted"}`} aria-hidden />
          <span className="task-id">#{job.id.slice(0, 8)}</span>
          <span className="task-status">{statusLabel(job.stage)}</span>
          {isActive && <Loader2 size={13} className="spinner" aria-hidden />}
        </div>
        <div className="task-meta">
          <span className="task-time">
            <Clock size={12} aria-hidden />
            {elapsed(job.createdAt)}
          </span>
          {job.stage !== "cancelled" && job.stage !== "succeeded" && (
            <button className="btn btn-ghost btn-sm" onClick={() => void actions.cancelJob(job.id)} aria-label="取消任务">
              <XCircle size={13} />
            </button>
          )}
        </div>
      </div>

      {job.error && <div className="task-error">{job.error}</div>}

      <div className="task-platforms">
        {job.platformJobs.map((pj) => (
          <div key={pj.platformId} className="task-platform">
            <div className="task-platform-head">
              <span className="task-platform-name">{pj.platformId}</span>
              <span className={`task-platform-status ${STAGE_COLOR[pj.stage] ?? "muted"}`}>
                {statusLabel(pj.stage)}
                {pj.attemptCount > 1 ? ` ×${pj.attemptCount}` : ""}
              </span>
            </div>
            {pj.error && <div className="task-platform-error">{pj.error}</div>}
            {pj.receipt?.message && <div className="task-platform-msg">{pj.receipt.message}</div>}
            <div className="task-platform-actions">
              {pj.stage === "failed" && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void actions.retryJobPlatform(job.id, pj.platformId)}
                >
                  <RefreshCw size={12} />
                  重试
                </button>
              )}
              {pj.stage === "unknown" && (
                <span className="task-unknown-hint">
                  <HelpCircle size={12} aria-hidden />
                  状态未知,请人工核对
                </span>
              )}
              {pj.diagnosticsPath && (
                <a
                  className="btn btn-ghost btn-sm"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    // 本地路径无法直接打开,提示用户(仅展示诊断目录引用)。
                    window.alert(`诊断工件目录: ${pj.diagnosticsPath}`);
                  }}
                >
                  <FolderOpen size={12} />
                  诊断
                </a>
              )}
              {pj.stage === "succeeded" && (
                <span className="task-ok">
                  <CheckCircle2 size={12} aria-hidden />
                  已成功
                </span>
              )}
              {pj.stage === "needs-user-action" && (
                <span className="task-warn">
                  <AlertTriangle size={12} aria-hidden />
                  需人工处理
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
