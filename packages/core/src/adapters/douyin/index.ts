/** 抖音(Douyin)适配器装配。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { douyinCapabilities } from "./capabilities.js";
import { serializeDouyin } from "./serialize.js";

export class DouyinAdapter extends BaseAdapter {
  readonly id = "douyin";
  readonly name = "抖音";
  readonly capabilities: Capabilities = douyinCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeDouyin(doc, override);
  }
}
