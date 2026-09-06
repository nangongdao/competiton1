/** 图片上传路由 —— 接收 multipart 文件,经配置图床上传,返回公开 URL/mediaId。 */
import type { FastifyInstance } from "fastify";
import type { ImageHost } from "@mpp/core";
import type { ServerConfig } from "../config.js";

/** 允许的图片 MIME 白名单(与 SecureImageFetcher 一致;SVG 默认拒绝,可携带脚本)。 */
const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

export function registerUploadRoutes(app: FastifyInstance, host: ImageHost, config: ServerConfig): void {
  app.post("/upload", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ ok: false, message: "未收到文件(需 multipart/form-data)" });
    }
    const mime = data.mimetype || "application/octet-stream";
    if (!ALLOWED_IMAGE_MIME.has(mime.toLowerCase())) {
      return reply.code(400).send({ ok: false, message: `仅支持白名单图片类型,收到 ${mime}` });
    }
    try {
      const buffer = await data.toBuffer();
      if (buffer.byteLength > config.localStore.maxFileBytes) {
        return reply.code(413).send({
          ok: false,
          message: `单文件超过上限(${config.localStore.maxFileBytes} 字节)`,
        });
      }
      const bytes = new Uint8Array(buffer);
      const result = await host.upload(bytes, data.filename || "upload.png", mime);
      return reply.send({ ok: true, ...result, host: host.id });
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        message: `上传失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
