/** 掘金适配器装配 —— SDK-02 第五平台试点。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { juejinCapabilities } from "./capabilities.js";
import { serializeJuejin } from "./serialize.js";

export class JuejinAdapter extends BaseAdapter {
  readonly id = "juejin";
  readonly name = "掘金";
  readonly capabilities: Capabilities = juejinCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeJuejin(doc, override);
  }
}
