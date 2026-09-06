/**
 * 能力漂移探测面板 —— Phase 5 PLAT-02。
 *
 * 对比"适配器声明能力"与"观测快照"(内置基线),只告警不自动改规则。
 * 声明值来自各平台 capabilities;观测值来自内置快照(可被 runner fixture / canary 更新)。
 */
import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Radar, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  detectDrift,
  summarizeDrift,
  runConformance,
  listAdapters,
  type CapabilitySnapshot,
} from "@mpp/core";
import { platformColor } from "./platform-meta.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 内置观测快照(基线):与各平台声明一致时无告警。
 * 真实运行时可由 runner fixture / canary 更新此快照,驱动漂移告警。
 */
const OBSERVED_SNAPSHOTS: Record<string, CapabilitySnapshot> = {
  wechat: { platformId: "wechat", capturedAt: new Date().toISOString(), limits: { titleMax: 64 } },
  zhihu: { platformId: "zhihu", capturedAt: new Date().toISOString(), limits: { titleMax: 64 } },
  bilibili: { platformId: "bilibili", capturedAt: new Date().toISOString(), limits: { titleMax: 40 } },
  xiaohongshu: { platformId: "xiaohongshu", capturedAt: new Date().toISOString(), limits: { titleMax: 20 } },
};

export function DriftPanel({ open, onOpenChange }: Props) {
  const adapters = useMemo(() => listAdapters(), []);
  const reports = useMemo(() => {
    return adapters.map((a) => ({
      adapter: a,
      drifts: detectDrift(a, OBSERVED_SNAPSHOTS[a.id] ?? { platformId: a.id, capturedAt: "" }),
      conformance: runConformance(a),
    }));
  }, [adapters]);

  const totalDrifts = useMemo(
    () => reports.reduce((n, r) => n + summarizeDrift(r.drifts).total, 0),
    [reports],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer assistant-drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Radar size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
              平台能力健康
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            <div className="assistant-fact-summary">
              共 {reports.length} 个平台，{totalDrifts} 项能力漂移告警。
              漂移只告警不自动改规则，需人工核验后更新声明或快照。
            </div>

            {reports.map(({ adapter, drifts, conformance }) => {
              const color = platformColor(adapter.id);
              const sum = summarizeDrift(drifts);
              return (
                <div key={adapter.id} className="drift-platform" style={{ ["--chip-color" as string]: color }}>
                  <div className="drift-platform-head">
                    <span className="assistant-platform" style={{ color }}>
                      {adapter.name}
                    </span>
                    <span className={drifts.length === 0 && conformance.passed ? "drift-ok" : "drift-warn"}>
                      {drifts.length === 0 && conformance.passed ? (
                        <CheckCircle2 size={13} aria-hidden />
                      ) : (
                        <AlertTriangle size={13} aria-hidden />
                      )}
                      {drifts.length === 0 && conformance.passed ? "健康" : `${sum.high} 高危 / ${sum.total} 漂移`}
                    </span>
                  </div>

                  {/* conformance 契约检查 */}
                  <div className="drift-section">
                    <div className="drift-section-label">Conformance（SDK-01）</div>
                    <div className={conformance.passed ? "drift-ok-text" : "drift-err-text"}>
                      {conformance.passed ? "全部契约检查通过" : "存在未通过的契约检查"}
                    </div>
                  </div>

                  {/* 漂移明细 */}
                  {drifts.length > 0 && (
                    <div className="drift-section">
                      <div className="drift-section-label">漂移明细（PLAT-02）</div>
                      {drifts.map((d, i) => (
                        <div key={i} className="drift-item">
                          <span className="drift-field">{d.field}</span>
                          <span className="drift-diff">
                            声明 {String(d.declared)} → 观测 {String(d.observed)}
                          </span>
                          <span className="drift-msg">{d.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
