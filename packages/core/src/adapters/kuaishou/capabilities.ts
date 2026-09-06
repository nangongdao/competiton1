/** 快手(Kuaishou)能力声明。
 *
 * 快手是短视频平台(与抖音类似):
 * - 文案纯文本 + emoji + #话题#;
 * - 必须有封面(视频封面 / 图文首图);
 * - 外链不可用;风控严格(违禁词过滤);
 * - 发布走网页/草稿(cookie/assisted),无官方内容发布 API。
 */
import type { Capabilities } from "../../ir/types.js";

export const kuaishouCapabilities: Capabilities = {
  contentModel: "plaintext", // 纯文本 + emoji + #话题#
  supportsExternalLinks: false,
  supportsTables: false,
  supportsMath: "text",
  supportsCodeBlocks: "text",
  requiresCover: true,
  requiresImageRehost: false,
  countByGrapheme: true,
  bannedWordFilter: true,
  taxonomy: "free-tags", // #话题#
  limits: {
    titleMax: 55,
    bodyMax: 1000,
    tagsMax: 5,
    maxImages: 9,
  },
  publishers: ["assisted", "cookie", "mock"], // 网页发布,无官方 API
};
