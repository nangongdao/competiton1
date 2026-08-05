/**
 * 图片外链安全校验 —— SSRF 防护(内网、回环、云元数据地址)。
 *
 * 场景:用户 Markdown 中的图片 URL 会被服务端主动拉取并重新上传(rehost)。
 * 若不过滤,攻击者可构造 http://169.254.169.254/latest/...、http://127.0.0.1:6379/
 * 使服务端向内网/云元数据服务发起请求,探测内网拓扑或窃取云凭据。
 */

/** 禁止访问的 IPv4 段(CIDR 起止,转 32 位整数比较)。 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, string]> = [
  ["0.0.0.0", "0.255.255.255"], // 本网络
  ["10.0.0.0", "10.255.255.255"], // 私有 A
  ["100.64.0.0", "100.127.255.255"], // CGNAT
  ["127.0.0.0", "127.255.255.255"], // 回环
  ["169.254.0.0", "169.254.255.255"], // 链路本地(含云元数据 169.254.169.254)
  ["172.16.0.0", "172.31.255.255"], // 私有 B
  ["192.168.0.0", "192.168.255.255"], // 私有 C
  ["224.0.0.0", "255.255.255.255"], // 组播 + 保留
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

/**
 * 判断图片外链是否可安全拉取。
 *
 * @param rawUrl 待校验的 URL
 * @returns 校验结果;不安全时附带原因
 */
export function isSafeImageUrl(rawUrl: string): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "URL 格式非法" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `不支持的协议 ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 显式回环主机名。
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { safe: false, reason: "禁止访问回环地址" };
  }

  // IPv6 回环与内网([::1]、[fc00::/7] ULA、[fe80::/10] 链路本地)。
  if (hostname.startsWith("[")) {
    const v6 = hostname.slice(1, -1);
    if (v6 === "::1" || /^f[cd]/i.test(v6) || /^fe[89ab]/i.test(v6)) {
      return { safe: false, reason: "禁止访问 IPv6 内网地址" };
    }
  }

  // IPv4 字面量。
  const ipInt = ipv4ToInt(hostname);
  if (ipInt !== null) {
    for (const [start, end] of BLOCKED_IPV4_RANGES) {
      const s = ipv4ToInt(start)!;
      const e = ipv4ToInt(end)!;
      if (ipInt >= s && ipInt <= e) {
        return { safe: false, reason: `禁止访问内网地址 ${hostname}` };
      }
    }
  }

  return { safe: true };
}
