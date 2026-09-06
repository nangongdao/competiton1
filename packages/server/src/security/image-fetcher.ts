/**
 * SecureImageFetcher —— 服务端拉取远程图片的安全边界(SSRF / 资源耗尽防护)。
 *
 * core 的 isSafeImageUrl 只做 URL 字面量检查(用户早期反馈);本模块才是权威边界:
 * 在**实际连接的 DNS lookup 上**逐跳校验,覆盖 DNS rebinding、域名解析到内网、
 * 重定向到内网等字面量检查够不到的场景。
 *
 * 防护项:
 * - URL 语法 + 协议(仅 http/https);
 * - DNS 解析,拒绝全部私网/回环/保留/云元数据地址(IPv4 + IPv6);
 * - 每次重定向重新解析、重新校验;
 * - 请求超时 + 流式读取字节上限(不能先 arrayBuffer 再判断);
 * - 响应 MIME 白名单(拒绝非图片、伪造 MIME)。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isBlockedIp, isSafeImageUrl } from "@mpp/core";
import type { ImageFetchConfig } from "../config.js";

/** 抓取结果:字节 + MIME + 最终 URL(重定向后)。 */
export interface SecureImageResult {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly finalUrl: string;
}

/** 抓取失败类型,便于上层分类提示。 */
export type FetchErrorKind =
  | "invalid-url"
  | "blocked-ip"
  | "blocked-host"
  | "timeout"
  | "too-large"
  | "bad-mime"
  | "network"
  | "redirect-loop";

export class SecureImageFetchError extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SecureImageFetchError";
  }
}

/**
 * 解析主机名为地址列表,并对每一跳 DNS 结果执行私网/回环/保留地址校验。
 *
 * @param hostname 主机名(不含端口/协议)
 * @returns 第一个安全的 IP;全部被拒或解析失败时抛错
 */
export async function resolveSafeAddress(hostname: string): Promise<string> {
  let addresses: string[];
  try {
    // verbatim: false = IPv4 优先(多数图片 CDN 走 IPv4,减少握手延迟)。
    const result = await dnsLookup(hostname, { all: true, verbatim: false });
    addresses = result.map((r) => r.address);
  } catch (err) {
    throw new SecureImageFetchError("network", `DNS 解析失败: ${hostname}(${err instanceof Error ? err.message : String(err)})`);
  }
  if (addresses.length === 0) {
    throw new SecureImageFetchError("network", `DNS 未返回任何地址: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      // 记录后继续尝试其它地址;若全部被拒则报 blocked-ip。
      continue;
    }
    return addr;
  }
  throw new SecureImageFetchError("blocked-ip", `禁止访问内网/回环地址: ${hostname}`);
}

/**
 * 以自定义 DNS lookup 发起 fetch:Node fetch 会把我们解析出的 IP 直接作为连接目标,
 * 避免"先解析校验、再让普通 fetch 重新解析"造成的 rebinding 窗口。
 */
function fetchWithPinnedIp(
  url: string,
  timeoutMs: number,
  redirect: "follow" | "manual",
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { hostname } = new URL(url);

  const lookup = async (_hostname: string, _options: { family?: number }, callback: (err: Error | null, address: string, family: number) => void): Promise<void> => {
    try {
      const ip = await resolveSafeAddress(hostname);
      callback(null, ip, ip.includes(":") ? 6 : 4);
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)), "", 4);
    }
  };

  return fetch(url, {
    signal: controller.signal,
    redirect,
    // @ts-expect-error undici 支持自定义 lookup,TS 类型未暴露。
    lookup,
  })
    .then((res) => {
      clearTimeout(timer);
      return res;
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err instanceof SecureImageFetchError) throw err;
      if (err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "AbortError") {
        throw new SecureImageFetchError("timeout", `拉取超时(>${timeoutMs}ms): ${url}`);
      }
      throw new SecureImageFetchError("network", `拉取失败: ${url}(${err instanceof Error ? err.message : String(err)})`);
    });
}

/**
 * 拉取并校验一张图片。
 *
 * @param rawUrl 图片 URL(http/https)
 * @param config 抓取安全配置
 * @returns 校验通过的图片字节、MIME 与最终 URL
 */
export async function fetchSecureImage(rawUrl: string, config: ImageFetchConfig): Promise<SecureImageResult> {
  // 1. URL 语法 + 协议校验。
  const urlCheck = isSafeImageUrl(rawUrl);
  if (!urlCheck.safe) {
    throw new SecureImageFetchError("invalid-url", urlCheck.reason ?? "URL 校验失败");
  }

  let current = rawUrl;
  let redirects = 0;

  while (true) {
    const res = await fetchWithPinnedIp(current, config.timeoutMs, "manual");

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (++redirects > config.maxRedirects) {
        throw new SecureImageFetchError("redirect-loop", `重定向次数超限(>${config.maxRedirects})`);
      }
      const next = new URL(res.headers.get("location")!, current).toString();
      const nextCheck = isSafeImageUrl(next);
      if (!nextCheck.safe) {
        throw new SecureImageFetchError("blocked-host", nextCheck.reason ?? "重定向目标被拒绝");
      }
      current = next;
      continue;
    }

    if (!res.ok) {
      throw new SecureImageFetchError("network", `远端返回 ${res.status} ${res.statusText}`);
    }

    // MIME 白名单:用 content-type 的主类型,伪造 MIME 也会被拒。
    const rawMime = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!config.allowedMimeTypes.includes(rawMime)) {
      // 流式读取前先拒绝,避免为恶意类型消耗带宽。
      await res.body?.cancel().catch(() => undefined);
      throw new SecureImageFetchError("bad-mime", `不支持的 MIME: ${rawMime || "(缺失)"}`);
    }

    // 流式读取 + 实时字节上限。
    if (!res.body) {
      throw new SecureImageFetchError("network", "响应无 body");
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > config.maxBytes) {
            throw new SecureImageFetchError("too-large", `响应超过上限(${config.maxBytes} 字节)`);
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      await reader.cancel().catch(() => undefined);
      throw err;
    }

    const bytes = concatBytes(chunks);
    return { bytes, mime: rawMime, finalUrl: current };
  }
}

/** 合并分块为单一 Uint8Array。 */
function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
