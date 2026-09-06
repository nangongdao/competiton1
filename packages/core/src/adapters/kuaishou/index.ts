/** 快手(Kuaishou)适配器装配。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { kuaishouCapabilities } from "./capabilities.js";
import { serializeKuaishou } from "./serialize.js";

export class KuaishouAdapter extends BaseAdapter {
  readonly id = "kuaishou";
  readonly name = "快手";
  readonly capabilities: Capabilities = kuaishouCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeKuaishou(doc, override);
  }
}
