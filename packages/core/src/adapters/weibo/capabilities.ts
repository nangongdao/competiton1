/** 微博(Weibo)能力声明。
 *
 * 微博是短文本社交平台:
 * - 正文纯文本 + emoji + #话题#(最多约 2 个话题);
 * - 单条微博硬上限 2000 字(长微博分段),封面/配图最多 9 张(九宫格);
 * - 外链可保留但会被降权,转为「网页链接」展示;
 * - 发布走网页(cookie/assisted),无官方开放内容发布 API(截至 2026-08)。
 */
import type { Capabilities } from "../../ir/types.js";

export const weiboCapabilities: Capabilities = {
  contentModel: "plaintext", // 纯文本 + emoji + #话题#
  supportsExternalLinks: false, // 外链被降权,转文字
  supportsTables: false, // 无表格
  supportsMath: "text", // 无公式,降级文字
  supportsCodeBlocks: "text",
  requiresCover: false, // 封面可选(配图可无)
  requiresImageRehost: false,
  countByGrapheme: true, // 中文按字素簇
  bannedWordFilter: true, // 敏感词过滤(微博风控严格)
  taxonomy: "free-tags", // #话题#
  limits: {
    titleMax: 30, // 微博无独立标题,取首句摘要
    bodyMax: 2000, // 单条微博上限(长微博)
    tagsMax: 2,
    maxImages: 9, // 九宫格
  },
  publishers: ["assisted", "cookie", "mock"], // 网页发布,无官方 API
};
