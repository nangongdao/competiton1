/** 抖音(Douyin)能力声明。
 *
 * 抖音是短视频平台,图文内容以「文案 + #话题# + 封面」为主:
 * - 正文纯文本 + emoji + #话题#(话题常 ≤5 个);
 * - 标题/文案上限约 1000 字(实际发布建议 100-200 字),此处按保守上限处理;
 * - 必须有封面(视频封面 / 图文首图);
 * - 外链不可用(转文字);发布走网页/草稿(cookie/assisted),无官方内容发布 API。
 */
import type { Capabilities } from "../../ir/types.js";

export const douyinCapabilities: Capabilities = {
  contentModel: "plaintext", // 纯文本 + emoji + #话题#
  supportsExternalLinks: false, // 外链不可用
  supportsTables: false,
  supportsMath: "text",
  supportsCodeBlocks: "text",
  requiresCover: true, // 必须有封面/视频首帧
  requiresImageRehost: false,
  countByGrapheme: true,
  bannedWordFilter: true, // 抖音风控严格
  taxonomy: "free-tags", // #话题#
  limits: {
    titleMax: 55, // 文案标题上限
    bodyMax: 1000, // 文案上限
    tagsMax: 5,
    maxImages: 9, // 图文笔记最多 9 图
  },
  publishers: ["assisted", "cookie", "mock"], // 网页发布,无官方 API
};
