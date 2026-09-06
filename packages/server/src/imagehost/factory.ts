/** 图床工厂 —— 按 server 配置选择图床实现。 */
import type { ImageHost } from "@mpp/core";
import type { ServerConfig } from "../config.js";
import { LocalImageHost } from "./local-host.js";
import { S3ImageHost } from "./s3-host.js";

/**
 * 按配置创建图床。优先级:显式 kind > 可用性回退。
 * - s3:需 S3_* 齐全,否则回退 local 并告警。
 * - wechat:正文图重托管在发布链路单独处理,这里仅供 /upload 通用上传(回退 local)。
 * - local:零配置兜底(落盘 + 静态服务,带配额/保留策略)。
 */
export function createImageHost(config: ServerConfig, log: (msg: string) => void): ImageHost {
  const { kind, localDir, localBaseUrl, s3 } = config.imageHost;

  if (kind === "s3") {
    if (s3.configured) return new S3ImageHost(s3);
    log("IMAGE_HOST=s3 但 S3_* 配置不全,回退 local 图床");
  }

  return new LocalImageHost(localDir, localBaseUrl, config.localStore, log);
}
