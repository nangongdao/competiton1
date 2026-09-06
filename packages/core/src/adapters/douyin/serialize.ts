/** 抖音(Douyin)序列化:IR → 纯文本 + #话题#。 */
import type { Document, PlatformOverride } from "../../ir/types.js";
import { serializePlaintextTopics } from "../shared/plaintext-topics.js";
import type { SerializedPayload } from "../types.js";

export function serializeDouyin(doc: Document, override?: PlatformOverride): SerializedPayload {
  return serializePlaintextTopics(doc, override, {
    titleMax: 55,
    bodyMax: 1000,
    tagsMax: 5,
    note: "抖音文案纯文本 + 话题;必须有封面(视频封面/图文首图);发布走网页(cookie/assisted),无官方 API。",
  });
}
