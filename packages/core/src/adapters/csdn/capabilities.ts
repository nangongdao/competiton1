/** CSDN 博客能力声明。
 *
 * CSDN 原生支持 Markdown 写作(与掘金类似):
 * - Markdown 编辑器,标题/列表/引用/代码块/表格/公式均原生支持;
 * - 外链保留;封面可选;图片可自动抓取(可不重托管);
 * - 发布走官方 API(Cookie 会话)或网页 assisted。
 */
import type { Capabilities } from "../../ir/types.js";

export const csdnCapabilities: Capabilities = {
  contentModel: "markdown", // 原生 Markdown
  supportsExternalLinks: true,
  supportsTables: true,
  supportsMath: "native",
  supportsCodeBlocks: "native",
  requiresCover: false,
  requiresImageRehost: false,
  countByGrapheme: true,
  bannedWordFilter: false,
  taxonomy: "category+tags", // 分类 + 标签
  limits: {
    titleMax: 200,
    bodyMax: 200000,
    tagsMax: 5,
  },
  publishers: ["assisted", "cookie", "mock"], // 官方 API(cookie)或网页
};
