/** 博客园(Cnblogs)适配器装配 —— 原生 Markdown 序列化(与掘金/CSDN 一致,复用 markdown 渲染)。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { cnblogsCapabilities } from "./capabilities.js";
import { serializeCnblogs } from "./serialize.js";

export class CnblogsAdapter extends BaseAdapter {
  readonly id = "cnblogs";
  readonly name = "博客园";
  readonly capabilities: Capabilities = cnblogsCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeCnblogs(doc, override);
  }
}
