/**
 * 服务依赖状态面板(UX-01)。
 *
 * 展示 server / runner 本地服务的可达性与配置摘要,给出可执行提示。
 * 点击「重新检测」可手动刷新;不展示任何敏感信息。
 */
import { useEffect, useState } from "react";
import { Activity, RefreshCw, Server, TerminalSquare } from "lucide-react";
import {
  buildDefaultProbes,
  checkAllServices,
  type ServiceHealth,
} from "../services/service-status.js";

interface Props {
  serverUrl: string;
  runnerUrl: string;
}

const ID_META: Record<string, { name: string; icon: typeof Server }> = {
  server: { name: "上传/公众号服务", icon: Server },
  runner: { name: "Playwright Runner", icon: TerminalSquare },
};

const STATUS_LABEL: Record<ServiceHealth["status"], string> = {
  checking: "检测中",
  online: "在线",
  offline: "离线",
  unknown: "未知",
};

export function ServiceStatusPanel({ serverUrl, runnerUrl }: Props) {
  const [healths, setHealths] = useState<Record<string, ServiceHealth>>({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    // 先把未检测的服务标记为 checking。
    setHealths((prev) => {
      const next = { ...prev };
      for (const id of ["server", "runner"]) {
        if (!next[id]) next[id] = { id, status: "checking", detail: "", hint: "" } as ServiceHealth;
      }
      return next;
    });
    try {
      const probes = buildDefaultProbes(serverUrl, runnerUrl);
      const result = await checkAllServices(probes);
      setHealths(result);
    } catch {
      /* 检测失败时保持 checking 状态,避免空白 */
    } finally {
      setRefreshing(false);
    }
  };

  // 打开时自动检测一次;地址变化后自动刷新。
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, runnerUrl]);

  const rows = ["server", "runner"]
    .map((id) => healths[id])
    .filter((h): h is ServiceHealth => !!h);

  return (
    <div className="service-status">
      <div className="service-status-header">
        <span className="service-status-title">
          <Activity size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
          服务依赖状态
        </span>
        <button
          type="button"
          className="btn-icon"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label="重新检测服务状态"
          title="重新检测"
        >
          <RefreshCw size={14} aria-hidden className={refreshing ? "spinner" : undefined} />
        </button>
      </div>
      <div className="service-status-list">
        {rows.length === 0 && <div className="service-status-empty">正在检测…</div>}
        {rows.map((h) => {
          const meta = ID_META[h.id] ?? { name: h.id, icon: Server };
          const Icon = meta.icon;
          return (
            <div className={`service-row service-row-${h.status}`} key={h.id}>
              <Icon size={15} aria-hidden className="service-row-icon" />
              <div className="service-row-main">
                <span className="service-row-name">{meta.name}</span>
                <span className="service-row-detail">{h.detail || "—"}</span>
              </div>
              <span className={`tag tag-${statusTag(h.status)}`}>{STATUS_LABEL[h.status]}</span>
            </div>
          );
        })}
      </div>
      {rows.some((h) => h.status === "offline" || h.status === "unknown") && (
        <div className="service-status-hints">
          {rows
            .filter((h) => h.status === "offline" || h.status === "unknown")
            .map((h) => (
              <div className="service-hint" key={h.id}>
                <strong>{ID_META[h.id]?.name ?? h.id}</strong>: {h.hint}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function statusTag(status: ServiceHealth["status"]): "ok" | "warn" | "err" | "neutral" {
  switch (status) {
    case "online":
      return "ok";
    case "offline":
      return "err";
    case "unknown":
      return "warn";
    default:
      return "neutral";
  }
}
