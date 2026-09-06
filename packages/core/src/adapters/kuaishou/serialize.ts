/** 快手(Kuaishou)序列化:IR → 纯文本 + #话题#。 */
import type { Document, PlatformOverride } from "../../ir/types.js";
import { serializePlaintextTopics } from "../shared/plaintext-topics.js";
import type { SerializedPayload } from "../types.js";

export function serializeKuaishou(doc: Document, override?: PlatformOverride): SerializedPayload {
  return serializePlaintextTopics(doc, override, {
    titleMax: 55,
    bodyMax: 1000,
    tagsMax: 5,
    note: "快手文案纯文本 + 话题;必须有封面;发布走网页(cookie/assisted),无官方 API。",
  });
}
