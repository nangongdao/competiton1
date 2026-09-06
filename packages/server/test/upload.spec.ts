import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { ImageHost } from "@mpp/core";
import { registerUploadRoutes } from "../src/routes/upload.js";
import type { LocalImageStoreConfig } from "../src/config.js";

/** 测试用 localStore 配置(不触发配额)。 */
const STORE: LocalImageStoreConfig = {
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  cleanupEnabled: false,
};

/** 构造注入了 mock 图床的测试 server。 */
async function buildApp(host: ImageHost) {
  const app = Fastify();
  await app.register(multipart);
  registerUploadRoutes(app, host, { localStore: STORE } as never);
  await app.ready();
  return app;
}

/** 构造一个 multipart 请求体。 */
function multipartBody(filename: string, mime: string, content: string) {
  const boundary = "----testboundary123";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("POST /upload", () => {
  it("成功上传图片,返回图床 URL", async () => {
    const calls: Array<{ filename: string; mime: string }> = [];
    const mockHost: ImageHost = {
      id: "mock",
      async upload(_bytes, filename, mime) {
        calls.push({ filename, mime });
        return { url: "https://cdn.example.com/uploaded.png" };
      },
    };
    const app = await buildApp(mockHost);
    const { body, headers } = multipartBody("photo.png", "image/png", "FAKE_PNG_BYTES");
    const res = await app.inject({ method: "POST", url: "/upload", payload: body, headers });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.url).toBe("https://cdn.example.com/uploaded.png");
    expect(json.host).toBe("mock");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.mime).toBe("image/png");
    await app.close();
  });

  it("拒绝非图片 MIME", async () => {
    const mockHost: ImageHost = { id: "mock", async upload() { return { url: "x" }; } };
    const app = await buildApp(mockHost);
    const { body, headers } = multipartBody("a.txt", "text/plain", "hello");
    const res = await app.inject({ method: "POST", url: "/upload", payload: body, headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("仅支持");
    await app.close();
  });

  it("拒绝 SVG(可携带脚本,默认排除)", async () => {
    const mockHost: ImageHost = { id: "mock", async upload() { return { url: "x" }; } };
    const app = await buildApp(mockHost);
    const { body, headers } = multipartBody("a.svg", "image/svg+xml", "<svg/>");
    const res = await app.inject({ method: "POST", url: "/upload", payload: body, headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("仅支持");
    await app.close();
  });

  it("图床抛错时返回 502", async () => {
    const mockHost: ImageHost = {
      id: "mock",
      async upload() {
        throw new Error("对象存储不可达");
      },
    };
    const app = await buildApp(mockHost);
    const { body, headers } = multipartBody("photo.png", "image/png", "BYTES");
    const res = await app.inject({ method: "POST", url: "/upload", payload: body, headers });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain("对象存储不可达");
    await app.close();
  });
});
