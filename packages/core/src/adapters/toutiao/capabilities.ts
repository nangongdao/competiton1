/** 头条号(Toutiao)能力声明。
 *
 * 头条号是今日头条的内容创作平台:
 * - 正文支持 Markdown 风格(标题/列表/引用/代码块/表格基本支持),以富文本为主;
 * - 封面必填(至少 1 张,推荐 3:2);
 * - 标题硬上限 64 字;标签 ≤5;
 * - 图片可自动抓取(外链图可不重托管,但建议使用自有图床);
 * - 发布走网页(cookie/assisted)或草稿,无官方开放内容发布 API(截至 2026-08)。
 */
import type { Capabilities } from "../../ir/types.js";

export const toutiaoCapabilities: Capabilities = {
  contentModel: "markdown", // 富文本/Markdown 风格
  supportsExternalLinks: true,
  supportsTables: true,
  supportsMath: "text", // 无 LaTeX,降级文字
  supportsCodeBlocks: "text", // 代码块以文本呈现
  requiresCover: true, // 必须有封面(头条强校验)
  requiresImageRehost: false, // 图片可自动抓取
  countByGrapheme: true,
  bannedWordFilter: true, // 头条风控严格
  taxonomy: "category+tags", // 分类 + 标签
  limits: {
    titleMax: 64,
    bodyMax: 100000,
    tagsMax: 5,
  },
  publishers: ["assisted", "cookie", "mock"], // 网页发布,无官方 API
};
