/** 头条号(Toutiao)适配器装配。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { toutiaoCapabilities } from "./capabilities.js";
import { serializeToutiao } from "./serialize.js";

export class ToutiaoAdapter extends BaseAdapter {
  readonly id = "toutiao";
  readonly name = "头条号";
  readonly capabilities: Capabilities = toutiaoCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeToutiao(doc, override);
  }
}
