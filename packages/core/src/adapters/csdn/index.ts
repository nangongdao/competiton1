/** CSDN 适配器装配 —— 原生 Markdown 序列化(与掘金一致,复用 markdown 渲染)。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { csdnCapabilities } from "./capabilities.js";
import { serializeCsdn } from "./serialize.js";

export class CsdnAdapter extends BaseAdapter {
  readonly id = "csdn";
  readonly name = "CSDN 博客";
  readonly capabilities: Capabilities = csdnCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeCsdn(doc, override);
  }
}
