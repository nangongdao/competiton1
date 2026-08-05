/**
 * HTML 净化器 —— allowlist 模型,作为所有 HTML 序列化产物的统一最终出口。
 *
 * core 的 html-render 本身只构造白名单标签 + 全程 escapeHtml,产物已受控;
 * 但 LLM 增强、未来原始 HTML 透传等场景可能引入不受信内容,故在序列化末端统一净化:
 *   - 只保留白名单标签,其余标签策略性处理(脱壳保留文本)
 *   - 只保留白名单属性,剥离所有 on* 事件、javascript:/vbscript:/data:(非图片) 协议
 *   - style 属性只放行白名单样式属性及其合法取值,其余整条剥离
 *
 * 实现基于 sanitize-html(htmlparser2 真实 HTML 解析),而非正则。
 * 正则无法解析 HTML 语法树:协议变形(内嵌 Tab/换行)、实体编码(&#58;/&colon;)、
 * 属性边界错位等一整类绕过无法穷举拦截,故不再使用正则作安全边界。
 */
import sanitizeHtmlLib from "sanitize-html";

/** 允许的标签(公众号/知乎/B站富文本所需的排版子集)。 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "del", "code", "pre",
  "blockquote", "ul", "ol", "li",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
  "section", "span", "div",
];

/** 允许保留的属性(class 在知乎/B站用于 mpp-* 语义类;href/src 的协议另有限制)。 */
const ALLOWED_ATTRS = {
  "*": ["style", "title", "class"],
  a: ["href", "target", "rel"],
  img: ["src", "alt"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
};

/** style 属性的合法取值正则。 */
const STYLE_VALUES = {
  "font-size": [/^\d+(\.\d+)?(px|em|rem|%)$/],
  "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
  "line-height": [/^\d+(\.\d+)?(px|em|rem|%)?$/],
  "letter-spacing": [/^-?\d+(\.\d+)?(px|em|rem)?$/],
  "color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+)?\s*\)$/i, /^[a-z]+$/i],
  "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+)?\s*\)$/i, /^[a-z]+$/i],
  "margin": [/^[\d\s.]+(px|em|rem|%)?$/],
  "padding": [/^[\d\s.]+(px|em|rem|%)?$/],
  "padding-left": [/^[\d\s.]+(px|em|rem|%)?$/],
  "padding-right": [/^[\d\s.]+(px|em|rem|%)?$/],
  "padding-top": [/^[\d\s.]+(px|em|rem|%)?$/],
  "padding-bottom": [/^[\d\s.]+(px|em|rem|%)?$/],
  "max-width": [/^\d+(\.\d+)?%$/],
  "width": [/^\d+(\.\d+)?(px|%)?$/],
  "border": [/^[\w#\s]+(px|em|rem)?$/],
  "border-left": [/^[\w#\s]+(px|em|rem)?$/],
  "border-top": [/^[\w#\s]+(px|em|rem)?$/],
  "border-right": [/^[\w#\s]+(px|em|rem)?$/],
  "border-bottom": [/^[\w#\s]+(px|em|rem)?$/],
  "border-radius": [/^\d+(\.\d+)?(px|em|rem|%)?$/],
  "border-collapse": [/^(collapse|separate)$/],
  "display": [/^(block|inline-block|inline|none|table|flex)$/],
  "text-align": [/^(left|right|center|justify)$/],
  "text-decoration": [/^(none|underline|line-through)$/],
  "font-style": [/^(normal|italic|oblique)$/],
  "overflow-x": [/^(auto|hidden|scroll|visible)$/],
  "vertical-align": [/^(top|middle|bottom|baseline)$/],
};

/**
 * style 属性放行清单 —— 覆盖公众号主题(theme.ts)实际产出的全部样式属性。
 * 仅放行白名单 style 属性及合法取值,其余整条剥离。
 * 说明:文档(UPGRADE_PLAN)给出的原始白名单过窄,会误删公众号正文的
 * letter-spacing / border / padding-left / border-radius 等核心排版,这里按实际产物补齐。
 */
const ALLOWED_STYLES: Record<string, typeof STYLE_VALUES> = {
  "*": STYLE_VALUES,
};

/**
 * img src 的 data URL 收严主体函数:sanitize-html 对 img 放行 data: 协议,
 * 但这里再收紧到标准图片格式,排除 data:text/html、SVG(可携带脚本)等危险 data URL。
 */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * 净化 HTML 字符串。
 *
 * @param html 待净化的 HTML(text/html 产物)
 * @returns 净化后的 HTML
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";

  // 先处理 img 的 data URL:若是 data: 但非标准图片格式,清空 src(排除 SVG/data:text/html)。
  // (此处仅作兜底;真正的协议判定由 sanitize-html 的 allowedSchemes 完成。)
  let out = html.replace(/<img\s[^>]*?>/gi, (tag) => {
    const m = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!m) return tag;
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    if (!/^data:/i.test(raw.trim())) return tag;
    return SAFE_DATA_IMAGE.test(raw.trim()) ? tag : tag.replace(m[0], 'src=""');
  });

  out = sanitizeHtmlLib(out, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    // 白名单协议:只允许 https/http/mailto,彻底排除 data:/javascript:/vbscript:/file:。
    allowedSchemes: ["http", "https", "mailto"],
    // img 额外放行 data:image(图片内联刚需;真正执行面已由上方 data URL 兜底收严)。
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowedStyles: ALLOWED_STYLES,
    // 非白名单标签:脱壳保留文本(script/style 内容亦被剥离)。
    disallowedTagsMode: "discard",
  });

  return out;
}

/** 判断某 MIME 是否需要净化(仅 text/html)。 */
export function shouldSanitize(mime: string): boolean {
  return mime === "text/html";
}
