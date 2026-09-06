/**
 * SecureImageFetcher 测试 —— SSRF 防护权威边界。
 *
 * 覆盖:私网字面量拒绝、DNS rebinding(域名解析到内网)、重定向到内网拒绝、
 * 超大响应、伪造 MIME、超时、合法抓取。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSecureImage,
  resolveSafeAddress,
  SecureImageFetchError,
} from "../src/security/image-fetcher.js";
import type { ImageFetchConfig } from "../src/config.js";

const CONFIG: ImageFetchConfig = {
  timeoutMs: 2000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 当前 DNS 解析返回的地址(可动态改)。 */
let dnsAddresses: string[] = ["93.184.216.34"];

// 必须在模块顶部 hoist:mock node:dns/promises,用闭包变量控制解析结果。
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () =>
    dnsAddresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  ),
}));

/** 设置 DNS 解析返回的地址。 */
function stubDns(addresses: string | string[]): void {
  dnsAddresses = Array.isArray(addresses) ? addresses : [addresses];
}

/** mock 全局 fetch:按 URL 返回预设响应。 */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      return handler(String(input), init);
    }),
  );
}

function okPng(): Response {
  return new Response(PNG_BYTES, { status: 200, headers: { "Content-Type": "image/png" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs?.();
});

describe("fetchSecureImage — 字面量私网地址", () => {
  it("拒绝 127.0.0.1(回环)", async () => {
    stubFetch(() => okPng());
    await expect(fetchSecureImage("http://127.0.0.1:6379/x.png", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });

  it("拒绝 169.254.169.254(云元数据)", async () => {
    stubFetch(() => okPng());
    await expect(
      fetchSecureImage("http://169.254.169.254/latest/meta-data/iam/security-credentials/", CONFIG),
    ).rejects.toThrow(SecureImageFetchError);
  });

  it("拒绝 192.168.1.1(私有 C)", async () => {
    stubFetch(() => okPng());
    await expect(fetchSecureImage("http://192.168.1.1/admin", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });

  it("拒绝 localhost 主机名", async () => {
    stubFetch(() => okPng());
    await expect(fetchSecureImage("http://localhost:8787/x.png", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });
});

describe("fetchSecureImage — DNS 解析校验(DNS rebinding)", () => {
  it("域名解析到内网 IP 被拒绝(直接测 resolveSafeAddress)", async () => {
    // 全局 fetch 被 mock 后 undici lookup 回调不会触发,故直接单测 resolveSafeAddress。
    stubDns("127.0.0.1");
    await expect(resolveSafeAddress("cdn.evil.example.com")).rejects.toThrow(SecureImageFetchError);
  });

  it("域名解析到公网 IP 正常返回", async () => {
    stubDns("93.184.216.34");
    await expect(resolveSafeAddress("example.com")).resolves.toBe("93.184.216.34");
  });

  it("多个解析结果含私网时选公网地址", async () => {
    stubDns(["10.0.0.1", "93.184.216.34"]);
    await expect(resolveSafeAddress("cdn.example.com")).resolves.toBe("93.184.216.34");
  });
});

describe("fetchSecureImage — 重定向校验", () => {
  it("重定向到内网地址被拒绝", async () => {
    stubDns("93.184.216.34");
    let first = true;
    stubFetch((_url) => {
      if (first) {
        first = false;
        return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/secret" } });
      }
      return okPng();
    });
    await expect(fetchSecureImage("https://example.com/a.png", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });

  it("正常重定向后继续抓取并返回最终 URL", async () => {
    stubDns("93.184.216.34");
    let first = true;
    stubFetch((_url) => {
      if (first) {
        first = false;
        return new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/b.png" } });
      }
      return okPng();
    });
    const result = await fetchSecureImage("https://example.com/a.png", CONFIG);
    expect(result.finalUrl).toBe("https://cdn.example.com/b.png");
    expect(result.mime).toBe("image/png");
  });

  it("重定向次数超限被拒绝", async () => {
    stubDns("93.184.216.34");
    stubFetch(() => new Response(null, { status: 302, headers: { Location: "https://loop.example.com/x.png" } }));
    const cfg = { ...CONFIG, maxRedirects: 2 };
    await expect(fetchSecureImage("https://example.com/a.png", cfg)).rejects.toThrow(SecureImageFetchError);
  });
});

describe("fetchSecureImage — 资源与 MIME 限制", () => {
  it("超大响应被流式拒绝", async () => {
    stubDns("93.184.216.34");
    stubFetch(() => new Response(new Uint8Array(2 * 1024 * 1024), { status: 200, headers: { "Content-Type": "image/png" } }));
    const cfg = { ...CONFIG, maxBytes: 1024 * 1024 };
    await expect(fetchSecureImage("https://example.com/big.png", cfg)).rejects.toThrow(SecureImageFetchError);
  });

  it("非白名单 MIME(伪造)被拒绝", async () => {
    stubDns("93.184.216.34");
    stubFetch(() => new Response(PNG_BYTES, { status: 200, headers: { "Content-Type": "text/html" } }));
    await expect(fetchSecureImage("https://example.com/fake.png", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });

  it("SVG 被拒绝(可携带脚本)", async () => {
    stubDns("93.184.216.34");
    stubFetch(() => new Response("<svg/>", { status: 200, headers: { "Content-Type": "image/svg+xml" } }));
    await expect(fetchSecureImage("https://example.com/x.svg", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });

  it("非 http(s) 协议被拒绝", async () => {
    stubFetch(() => okPng());
    await expect(fetchSecureImage("file:///etc/passwd", CONFIG)).rejects.toThrow(SecureImageFetchError);
  });
});
