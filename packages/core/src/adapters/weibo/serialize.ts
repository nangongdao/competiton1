/** 微博(Weibo)序列化:IR → 纯文本 + #话题#。 */
import type { Document, PlatformOverride } from "../../ir/types.js";
import { serializePlaintextTopics } from "../shared/plaintext-topics.js";
import type { SerializedPayload } from "../types.js";

export function serializeWeibo(doc: Document, override?: PlatformOverride): SerializedPayload {
  return serializePlaintextTopics(doc, override, {
    titleMax: 30,
    bodyMax: 2000,
    tagsMax: 2,
    note: "微博纯文本 + 话题;单条上限 2000 字,超出已按上限截断;发布走网页(cookie/assisted),无官方 API。",
  });
}
