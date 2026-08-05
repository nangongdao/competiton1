/**
 * 各平台编辑器注入策略 —— best-effort,DOM 选择器易变,失败即降级。
 *
 * ⚠️ 风险声明:自动注入依赖各平台编辑器 DOM,平台改版即失效,且可能触及 ToS。
 * 因此每个注入器都"尽力而为":定位失败/抛错都返回 injected=false,由调用方降级到复制粘贴。
 * 选择器外置于 selectors.ts(可远程覆盖);此处只负责"如何填"。
 */
import { getSelectors } from "./selectors.js";

export interface InjectResult {
  readonly injected: boolean;
  readonly reason?: string;
  /** 结构化诊断:逐个选择器是否命中,便于定位平台改版导致的失效。 */
  readonly diagnostics?: ReadonlyArray<{ selector: string; matched: boolean }>;
}

/**
 * 安全地把 HTML 写入可编辑区 —— 不使用 innerHTML。
 *
 * 改为经 DOMParser 解析后逐节点导入,并在导入过程中剥离所有事件处理器属性。
 * innerHTML 赋值时 <script> 不会执行,但 <img onerror>/<svg onload>/<iframe srcdoc>
 * 这类事件处理器型载荷会立即执行,故此处作为净化器之外的最后一道防线。
 *
 * @param el 目标可编辑元素
 * @param html 已净化的 HTML 字符串
 */
function setEditableHtml(el: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 剥离所有 on* 事件属性(纵深防御,净化器之外的最后一道)。
  for (const node of doc.body.querySelectorAll("*")) {
    for (const attr of [...node.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) {
        node.removeAttribute(attr.name);
      }
    }
  }

  el.replaceChildren();
  for (const child of [...doc.body.childNodes]) {
    el.appendChild(document.importNode(child, true));
  }
}

/** 把 HTML 写入首个命中的 contenteditable 元素(知乎/B站/公众号富文本)。 */
function fillContentEditable(selectors: readonly string[], html: string): InjectResult {
  const diagnostics: Array<{ selector: string; matched: boolean }> = [];
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    diagnostics.push({ selector, matched: !!el });
    if (!el) continue;
    el.focus();
    setEditableHtml(el, html);
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return { injected: true, diagnostics };
  }
  return { injected: false, reason: "未找到富文本编辑器", diagnostics };
}

/** 把纯文本写入 textarea/可编辑区(小红书)。 */
function fillTextarea(selectors: readonly string[], text: string): InjectResult {
  const diagnostics: Array<{ selector: string; matched: boolean }> = [];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLTextAreaElement | HTMLElement>(sel);
    diagnostics.push({ selector: sel, matched: !!el });
    if (!el) continue;
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return { injected: true, diagnostics };
  }
  return { injected: false, reason: "未找到正文输入区", diagnostics };
}

export function injectForPlatform(platformId: string, html: string, text: string): InjectResult {
  const sel = getSelectors(platformId);
  if (!sel.editable && !sel.textarea) {
    return { injected: false, reason: `无 ${platformId} 选择器配置` };
  }
  try {
    // 纯文本平台(仅 textarea)用文本注入;其余走富文本。
    if (sel.textarea && !sel.editable) return fillTextarea(sel.textarea, text);
    return fillContentEditable(sel.editable ?? [], html);
  } catch (err) {
    return { injected: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
