import { describe, it, expect } from "vitest";
import { isSafeImageUrl } from "../src/assets/url-guard.js";

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
