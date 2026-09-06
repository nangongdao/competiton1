/** 掘金(Juejin)能力声明 —— SDK-02 第五平台试点。
 *
 * 掘金 Markdown 原生支持:
 * - 原生 Markdown 编辑器(标题/列表/引用/代码块/表格/公式均原生渲染);
 * - 外链保留(可放行);
 * - 无需强制封面(可自定义封面,但非必需);
 * - 无需重托管(掘金 CDN 自动抓取图片);
 * - 发布走网页(assisted/cookie),无官方开放 API(截至 2026-08)。
 */
import type { Capabilities } from "../../ir/types.js";

export const juejinCapabilities: Capabilities = {
  contentModel: "markdown", // 原生 Markdown 编辑器
  supportsExternalLinks: true, // 外链保留
  supportsTables: true, // 原生表格
  supportsMath: "native", // 原生 LaTeX 渲染
  supportsCodeBlocks: "native", // 原生代码块(高亮)
  requiresCover: false, // 封面可选
  requiresImageRehost: false, // 掘金自动抓取图片
  countByGrapheme: true, // 中文字数按字素簇
  bannedWordFilter: false,
  taxonomy: "free-tags", // 自定义标签 ≤3
  limits: {
    titleMax: 64, // 保守上限
    bodyMax: 200000,
    tagsMax: 3,
  },
  publishers: ["assisted", "cookie", "mock"], // 无官方 API,网页发布
};
