/** 图片上传到 server /upload 的共享实现(mock 与 chrome bridge 复用)。 */
import type { UploadAssetRequest, UploadAssetResult } from "./types.js";

export async function uploadAssetViaServer(req: UploadAssetRequest): Promise<UploadAssetResult> {
  try {
    const form = new FormData();
    // TS 5.7 收窄 Uint8Array 泛型,显式转为 BlobPart 兼容类型。
    const blob = new Blob([req.bytes as BlobPart], { type: req.mime });
    form.append("file", blob, req.filename);
    const headers: Record<string, string> = {};
    if (req.token) headers["X-MPP-Token"] = req.token;
    const res = await fetch(`${req.serverUrl}/upload`, { method: "POST", body: form, headers });
    const data = (await res.json()) as { ok: boolean; url?: string; mediaId?: string; message?: string };
    return data;
  } catch (err) {
    return {
      ok: false,
      message: `无法连接 server(${req.serverUrl}):${err instanceof Error ? err.message : String(err)}。请先启动 server 包。`,
    };
  }
}
