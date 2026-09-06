/** LLM 任务的 prompt 模板 —— 供真实 LLM 适配器使用。 */
import type { LlmRequest } from "./types.js";

const TEMPLATES: Record<string, (req: LlmRequest) => string> = {
  colloquialize: (req) =>
    `把下面的正式文章改写成小红书口语化风格:第一人称、亲切如和朋友聊天(姐妹们/宝子们),` +
    `短句短段、每段以相关 emoji 起头(约每 100 字 1-2 个),结尾加自然的行动号召。保持信息准确。\n\n原文:\n${req.input}`,
  title: (req) => {
    const max = (req.constraints?.["maxChars"] as number) ?? 20;
    return (
      `为以下内容生成一个${req.platformId === "xiaohongshu" ? "小红书爆款" : ""}标题,` +
      `≤${max} 字,前 10 字埋钩子,可用 1-2 个爆款关键词(如 绝绝子/神器/划重点)与 emoji。只输出标题。\n\n内容:\n${req.input}`
    );
  },
  summary: (req) => {
    const max = (req.constraints?.["maxChars"] as number) ?? 120;
    return `为以下内容写一段 ≤${max} 字的摘要/推荐语,概括核心价值,语气自然。只输出摘要。\n\n内容:\n${req.input}`;
  },
  rewrite: (req) => `按目标平台 ${req.platformId} 的风格改写以下内容,保持信息准确:\n\n${req.input}`,
  "paragraph-rewrite": (req) =>
    `你是新媒体内容编辑,对下面的单个段落做风格润色。要求:\n` +
    `1. 保持原意与全部事实、数字、专名、链接不变,不增删信息;\n` +
    `2. 只输出改写后的段落文本(纯文本),不要输出标题、列表、引用或 Markdown 标记;\n` +
    `3. 改写成适合目标平台 ${req.platformId} 的阅读风格,语气自然、段落通顺;\n` +
    `4. 长度与原文相当(±30%),不超过 ${(req.constraints?.["maxChars"] as number) ?? 800} 字。\n\n段落:\n${req.input}`,
};

export function buildPrompt(req: LlmRequest): string {
  const builder = TEMPLATES[req.task];
  return builder ? builder(req) : req.input;
}
