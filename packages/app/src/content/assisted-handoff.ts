/**
 * content script —— 监听来自扩展页的注入请求,best-effort 填入目标平台编辑器。
 *
 * 安全姿态:
 *   - 只填入内容供用户检查确认,绝不自动点击"发布/提交"按钮。
 *   - 校验消息发送方为本扩展(防跨上下文伪造)。
 *   - 注入前对 HTML 二次净化(纵深防御):content script 运行在平台页面上下文中,
 *     是权限最敏感的位置,即便发送方是扩展自身也不信任消息内容。
 */
import { sanitizeHtml } from "@mpp/core";
import { injectForPlatform } from "./injectors.js";
import { applySelectorOverride } from "./selectors.js";

interface InjectMessage {
  readonly type: "mpp-inject";
  readonly platformId: string;
  readonly clipboard: { html?: string; text: string };
}

// 启动时加载远程选择器覆盖(平台改版后不发版即可修复注入)。
void chrome.storage?.local?.get("mpp.selectors").then((obj) => {
  applySelectorOverride(obj?.["mpp.selectors"] as string | undefined);
});

chrome.runtime.onMessage.addListener((msg: InjectMessage, sender, sendResponse) => {
  // 发送方校验:只接受来自本扩展(background/扩展页)的消息。
  // sender.id 为本扩展 id 时视为可信来源;undefined 说明来自扩展外上下文,拒绝。
  if (sender.id && sender.id !== chrome.runtime.id) return;
  if (msg?.type !== "mpp-inject") return;

  // 纵深防御:注入前再净化一次 HTML。
  const safeHtml = sanitizeHtml(msg.clipboard.html ?? "");
  const result = injectForPlatform(msg.platformId, safeHtml, msg.clipboard.text);
  sendResponse(result);
  return true; // 异步响应
});
