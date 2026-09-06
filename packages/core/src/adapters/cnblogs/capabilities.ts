/**
 * 博客园(Cnblogs)能力声明 —— SDK-04 第七平台试点。
 *
 * 博客园 Markdown 编辑器原生支持:
 * - 原生 Markdown(标题/列表/引用/代码块/表格/公式均原生渲染);
 * - 外链保留(博客园允许引用外部链接);
 * - 需设置随笔分类(category,至少一个)与标签;
 * - 封面可选(未强制);
 * - 图片可直接引用外部 URL(无需重托管);
 * - 发布走网页(assisted/自动保存草稿),无官方开放内容发布 API(截至 2026-08)。
 */
import type { Capabilities } from "../../ir/types.js";

export const cnblogsCapabilities: Capabilities = {
  contentModel: "markdown", // 原生 Markdown 编辑器
  supportsExternalLinks: true, // 外链保留
  supportsTables: true, // 原生表格
  supportsMath: "native", // 原生 LaTeX 渲染(MathJax)
  supportsCodeBlocks: "native", // 原生代码块(高亮)
  requiresCover: false, // 封面可选
  requiresImageRehost: false, // 博客园可直接引用外链图片
  countByGrapheme: true, // 中文字数按字素簇
  bannedWordFilter: false,
  taxonomy: "category+tags", // 随笔分类 + 标签
  limits: {
    titleMax: 200, // 保守上限
    bodyMax: 200000,
    tagsMax: 5, // 常用标签数上限
  },
  publishers: ["assisted", "cookie", "mock"], // 网页发布,无官方 API
};
