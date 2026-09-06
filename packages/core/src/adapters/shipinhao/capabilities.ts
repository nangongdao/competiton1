/** 视频号(WeChat Channels / Shipinhao)能力声明。
 *
 * 视频号是微信生态的短视频/图文平台:
 * - 文案纯文本 + emoji + #话题#(话题可多);
 * - 必须有封面(视频封面 / 图文首图);
 * - 外链不可用;风控严格;
 * - 发布走网页/草稿(cookie/assisted)或微信 App 内人工发布,无开放内容发布 API。
 */
import type { Capabilities } from "../../ir/types.js";

export const shipinhaoCapabilities: Capabilities = {
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
  publishers: ["assisted", "cookie", "mock"], // 网页/App 发布,无官方 API
};
