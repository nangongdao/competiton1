/**
 * 服务依赖状态检测(UX-01)。
 *
 * 检测 server / runner 等本地服务的可达性与配置状态,UI 据此给出可执行提示。
 * 纯 TS 零 DOM,可在 Node 测试环境验证;不暴露任何敏感信息(token/key 不参与展示)。
 */

export type ServiceStatus = "checking" | "online" | "offline" | "unknown";

export interface ServiceProbe {
  /** 服务唯一标识。 */
  readonly id: "server" | "runner";
  /** 展示名。 */
  readonly name: string;
  /** 健康检查地址(完整 URL)。 */
  readonly healthUrl: string;
}

export interface ServiceHealth {
  readonly id: ServiceProbe["id"];
  readonly status: ServiceStatus;
  /** 附加信息(如版本/配置摘要),已脱敏。 */
  readonly detail: string;
  /** 给用户的可执行建议。 */
  readonly hint: string;
}

export interface CheckOptions {
  /** 探测超时(默认 3000ms)。 */
  readonly timeoutMs?: number;
  /** 可注入 fetch(测试用);默认全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT = 3000;

/** 探测单个服务;超时/网络错误归为 offline,返回体非法归为 unknown。 */
export async function probeService(
  probe: ServiceProbe,
  opts: CheckOptions = {},
): Promise<ServiceHealth> {
  const { timeoutMs = DEFAULT_TIMEOUT, fetchImpl = fetch } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(probe.healthUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        id: probe.id,
        status: "offline",
        detail: `HTTP ${res.status}`,
        hint: `${probe.name} 返回异常状态码 ${res.status}。请确认服务已启动且地址正确。`,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (body.ok === true) {
      return {
        id: probe.id,
        status: "online",
        detail: summarizeBody(probe.id, body),
        hint: `${probe.name} 运行正常。`,
      };
    }
    return {
      id: probe.id,
      status: "unknown",
      detail: "响应缺少 ok 标记",
      hint: `${probe.name} 响应异常,请检查服务版本。`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      id: probe.id,
      status: "offline",
      detail: aborted ? "连接超时" : "无法连接",
      hint: `${probe.name} 未检测到。请先启动本地服务(server: npm run server / runner: npm run runner)。`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 从健康检查响应中提取非敏感摘要。 */
function summarizeBody(id: ServiceProbe["id"], body: Record<string, unknown>): string {
  if (id === "server") {
    const wechatConfigured = body.wechatConfigured;
    return typeof wechatConfigured === "boolean"
      ? wechatConfigured
        ? "公众号凭据已配置"
        : "未配置公众号凭据(仅模拟)"
      : "服务正常";
  }
  const browser = body.browser as { installed?: boolean } | undefined;
  if (browser?.installed === false) return "服务正常,但浏览器不可用";
  return "服务正常";
}

/** 构造默认探测目标(server/runner)。 */
export function buildDefaultProbes(serverUrl: string, runnerUrl: string): ServiceProbe[] {
  const trim = (u: string) => u.replace(/\/+$/, "");
  return [
    { id: "server", name: "上传/公众号服务", healthUrl: `${trim(serverUrl)}/health` },
    { id: "runner", name: "Playwright Runner", healthUrl: `${trim(runnerUrl)}/health` },
  ];
}

/** 并发检测全部服务。 */
export async function checkAllServices(
  probes: readonly ServiceProbe[],
  opts: CheckOptions = {},
): Promise<Record<string, ServiceHealth>> {
  const results = await Promise.all(probes.map((p) => probeService(p, opts)));
  return Object.fromEntries(results.map((r) => [r.id, r]));
}
