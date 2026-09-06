/** 微博(Weibo)适配器装配。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { weiboCapabilities } from "./capabilities.js";
import { serializeWeibo } from "./serialize.js";

export class WeiboAdapter extends BaseAdapter {
  readonly id = "weibo";
  readonly name = "微博";
  readonly capabilities: Capabilities = weiboCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeWeibo(doc, override);
  }
}
