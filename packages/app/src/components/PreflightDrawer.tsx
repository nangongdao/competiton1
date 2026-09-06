/**
 * PreflightDrawer —— 发布前健康检查(v7 创作工作流 PREFLIGHT)。
 *
 * 在「一键发布」前对当前内容做跨平台体检:
 * - 整体状态(ready / blocked)+ 严重度计数;
 * - 问题列表(按严重度,error/warning/info);
 * - 按平台汇总(平台名 + error/warning 数);
 * - 可执行建议列表;
 * - v7 Phase 3:可自动修复问题一键修复(image-no-alt 等,确定性修复)。
 *
 * 纯展示组件:输入来自 store 的 preflightReport,按钮回调由 App 注入
 * (「去修复」跳回编辑器 /「一键发布」触发 publishAll)。全 Lucide 图标。
 */
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, XCircle, X, ShieldCheck, ListChecks, Rocket, Wrench } from "lucide-react";
import type { PreflightReport } from "@mpp/core";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 健康检查报告(由 App/store 计算)。 */
  report: PreflightReport | null;
  /** 计算中。 */
  computing?: boolean;
  /** 点击「重新检查」。 */
  onRecheck: () => void;
  /** 点击「一键发布」(模拟发布;disabled when !report.ready)。 */
  onPublish: () => void;
  /** 点击「真实发布」(v7 Phase 2 强制体检后确认;disabled when !report.ready)。 */
  onRealPublish?: () => void;
  /** v7 Phase 3:一键自动修复可自动化问题(缺 alt 等)。 */
  onAutoFix?: () => void;
  /** 当前已选平台数(空态提示)。 */
  selectedCount: number;
  /** 是否由「真实发布」触发(展示对应按钮文案)。 */
  realMode?: boolean;
}

function SeverityIcon({ sev }: { sev: "error" | "warning" | "info" }) {
  if (sev === "error") return <XCircle size={14} aria-hidden />;
  if (sev === "warning") return <AlertTriangle size={14} aria-hidden />;
  return <Info size={14} aria-hidden />;
}

export function PreflightDrawer({ open, onOpenChange, report, computing = false, onRecheck, onPublish, onRealPublish, onAutoFix, selectedCount, realMode = false }: Props) {
  if (!open) return null;
  return (
    <div className="drawer-overlay" onClick={() => onOpenChange(false)}>
      <div className="drawer preflight-drawer" role="dialog" aria-modal="true" aria-label="发布前健康检查" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span className="drawer-title">
            <ShieldCheck size={16} aria-hidden />
            发布前健康检查
          </span>
          <button type="button" className="drawer-close" aria-label="关闭" onClick={() => onOpenChange(false)}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="drawer-body">
          {selectedCount === 0 ? (
            <div className="preflight-empty">
              <ListChecks size={28} aria-hidden />
              <p>请先在左侧选择至少一个发布平台，再进行健康检查。</p>
            </div>
          ) : computing ? (
            <div className="preflight-computing">
              <span className="spinner" aria-hidden />
              正在检查…
            </div>
          ) : !report ? (
            <div className="preflight-empty">
              <ShieldAlert size={28} aria-hidden />
              <p>点击下方「重新检查」生成体检报告。</p>
            </div>
          ) : (
            <>
              {/* 整体状态 */}
              <div className={`preflight-hero ${report.ready ? "ready" : "blocked"}`}>
                {report.ready ? <CheckCircle2 size={22} aria-hidden /> : <XCircle size={22} aria-hidden />}
                <div className="preflight-hero-text">
                  <span className="preflight-hero-title">{report.ready ? "可以发布" : "存在阻塞问题"}</span>
                  <span className="preflight-hero-sub">
                    {report.counts.errors} 错误 · {report.counts.warnings} 警告 · {report.counts.infos} 提示
                  </span>
                </div>
              </div>

              {/* 平台汇总 */}
              {report.perPlatform.length > 0 && (
                <div className="preflight-platforms">
                  <span className="preflight-section-label">平台状态</span>
                  <div className="preflight-platform-list">
                    {report.perPlatform.map((p) => (
                      <span key={p.platformId} className={`preflight-platform ${p.errors > 0 ? "has-error" : p.warnings > 0 ? "has-warn" : "ok"}`}>
                        {p.platformName}
                        {p.errors > 0 ? ` · ${p.errors} 错误` : p.warnings > 0 ? ` · ${p.warnings} 警告` : " · 通过"}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 可自动修复提示(v7 Phase 3) */}
              {onAutoFix && report.issues.some((i) => i.code === "image-no-alt") && (
                <div className="preflight-autofix">
                  <Wrench size={15} aria-hidden />
                  <span>检测到 {report.issues.filter((i) => i.code === "image-no-alt").length} 张图片缺少描述，可一键自动补充。</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onAutoFix}>
                    自动修复
                  </button>
                </div>
              )}

              {/* 问题列表 */}
              {report.issues.length > 0 ? (
                <div className="preflight-issues">
                  <span className="preflight-section-label">问题清单</span>
                  <ul className="preflight-issue-list">
                    {report.issues.map((issue, i) => (
                      <li key={i} className={`preflight-issue preflight-issue-${issue.severity}`}>
                        <SeverityIcon sev={issue.severity} />
                        <span className="preflight-issue-msg">{issue.message}</span>
                        {issue.platformId && <span className="preflight-issue-platform">{issue.platformId}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="preflight-no-issues">
                  <CheckCircle2 size={16} aria-hidden />
                  未发现问题，可以直接发布。
                </div>
              )}

              {/* 建议 */}
              {report.suggestions.length > 0 && (
                <div className="preflight-suggestions">
                  <span className="preflight-section-label">行动建议</span>
                  <ol className="preflight-suggestion-list">
                    {report.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>

        <div className="drawer-footer">
          <button type="button" className="btn btn-secondary" onClick={onRecheck}>
            重新检查
          </button>
          <button type="button" className="btn btn-secondary" disabled={!report?.ready} onClick={onPublish}>
            <SendIcon />
            {report?.ready ? "一键模拟发布" : "修复后再发布"}
          </button>
          {onRealPublish && (
            <button type="button" className="btn btn-primary" disabled={!report?.ready} onClick={onRealPublish}>
              <RocketIcon />
              {report?.ready ? (realMode ? "确认真实发布" : "真实发布") : "修复后再发布"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SendIcon() {
  // 内联发送图标(避免额外 import 冲突)。
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function RocketIcon() {
  return <Rocket size={15} aria-hidden />;
}
