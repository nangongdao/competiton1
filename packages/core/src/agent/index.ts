/**
 * AI 自动完成 Agent 模块统一导出。
 */
export * from "./types.js";
export { runAutoAgent } from "./agent.js";
export {
  rewriteParagraphsWithLlm,
  findProseParagraphs,
  type ParagraphRewriteOptions,
  type ParagraphRewriteResult,
  type ProseParagraph,
  type RewrittenParagraph,
} from "./paragraph-rewrite.js";
