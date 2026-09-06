import { describe, it, expect } from "vitest";
import { isSafeImageUrl, isBlockedIp } from "../src/assets/url-guard.js";

describe("isSafeImageUrl — SSRF 防护", () => {
  it("放行公网 https 图片", () => {
    expect(isSafeImageUrl("https://cdn.example.com/a.png")).toEqual({ safe: true });
  });

  it("放行公网 http 图片", () => {
    expect(isSafeImageUrl("http://images.example.com/a.jpg")).toEqual({ safe: true });
  });

  it("拦截云元数据地址(169.254.169.254)", () => {
    const r = isSafeImageUrl("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("内网");
  });

  it("拦截回环地址 http://127.0.0.1", () => {
    expect(isSafeImageUrl("http://127.0.0.1:6379/").safe).toBe(false);
    expect(isSafeImageUrl("http://0.0.0.0:80/").safe).toBe(false);
  });

  it("拦截 localhost 主机名", () => {
    expect(isSafeImageUrl("http://localhost:8787/x.png").safe).toBe(false);
    expect(isSafeImageUrl("http://api.localhost/x.png").safe).toBe(false);
  });

  it("拦截私有网段(10/172.16/192.168)", () => {
    expect(isSafeImageUrl("http://10.0.0.1/x.png").safe).toBe(false);
    expect(isSafeImageUrl("http://172.16.0.1/x.png").safe).toBe(false);
    expect(isSafeImageUrl("http://192.168.1.1/admin").safe).toBe(false);
  });

  it("拦截非 http(s) 协议", () => {
    expect(isSafeImageUrl("file:///etc/passwd").safe).toBe(false);
    expect(isSafeImageUrl("ftp://example.com/a.png").safe).toBe(false);
    expect(isSafeImageUrl("data:image/png;base64,x").safe).toBe(false);
  });

  it("拦截非法 URL", () => {
    expect(isSafeImageUrl("not a url").safe).toBe(false);
  });
});

describe("isBlockedIp — 服务端 DNS 解析后的 IP 校验", () => {
  it("拦截全部私网/回环/保留 IPv4", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.1.2.3")).toBe(true);
    expect(isBlockedIp("172.16.5.5")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("224.0.0.1")).toBe(true);
  });

  it("放行公网 IPv4", () => {
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("拦截 IPv6 回环与内网", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("放行公网 IPv6", () => {
    expect(isBlockedIp("2606:2800:220:1::1")).toBe(false);
  });

  it("IPv4-mapped IPv6 落到 IPv4 判断", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("非 IP 输入不误判为私网(交给 DNS 解析层)", () => {
    expect(isBlockedIp("example.com")).toBe(false);
  });
});
