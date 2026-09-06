/** 视频号(Shipinhao)适配器装配。 */
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import { BaseAdapter } from "../base-adapter.js";
import type { SerializedPayload } from "../types.js";
import type { ResolvedPlatformConfig } from "../../config/platform-config.js";
import { shipinhaoCapabilities } from "./capabilities.js";
import { serializeShipinhao } from "./serialize.js";

export class ShipinhaoAdapter extends BaseAdapter {
  readonly id = "shipinhao";
  readonly name = "视频号";
  readonly capabilities: Capabilities = shipinhaoCapabilities;

  protected serializeRaw(
    doc: Document,
    override?: PlatformOverride,
    _config?: ResolvedPlatformConfig,
  ): SerializedPayload {
    return serializeShipinhao(doc, override);
  }
}
