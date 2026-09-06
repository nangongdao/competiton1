/**
 * 掘金序列化:IR → Markdown(原生)。
 *
 * 掘金编辑器原生支持 Markdown,直接输出 IR 对应的 Markdown 文本:
 * - 标题 #/##/###、段落、列表、引用、代码块、表格、公式、分割线;
 * - 图片引用原始 URL(掘金自动抓取,无需重托管);
 * - 外链保留(平台允许);
 * - 标签 ≤3。
 */
import type { Asset, Block, Document, Inline, PlatformOverride } from "../../ir/types.js";
import { inlinesToPlainText } from "../../ir/guards.js";
import { graphemeTruncate } from "../../transforms/grapheme-count.js";
import type { SerializedPayload } from "../types.js";
import { buildAssetMap } from "../shared/html-render.js";

const JUJIN = "juejin";

export function serializeJuejin(doc: Document, override?: PlatformOverride): SerializedPayload {
  const assetMap = buildAssetMap(doc);
  const content = doc.blocks.map((b) => renderBlock(b, assetMap)).filter((s) => s.length > 0).join("\n\n");
  const title = graphemeTruncate(override?.title ?? doc.meta.title, 64);
  const tags = (override?.tags ?? doc.meta.tags).slice(0, 3);

  return {
    content,
    mime: "text/markdown",
    title,
    summary: override?.summary ?? doc.meta.summary ?? deriveSummary(doc),
    tags,
    imageAssetIds: collectImages(doc),
    coverAssetId: override?.coverAssetId ?? doc.meta.coverAssetId,
    extra: {
      note: "掘金原生 Markdown,直接粘贴到编辑器;标签 ≤3,发布走网页(assisted/cookie)。",
    },
  };
}

function deriveSummary(doc: Document): string {
  const firstText = doc.blocks.map(blockToText).find((t) => t.trim().length > 0) ?? "";
  return firstText.slice(0, 120);
}

function blockToText(b: Block): string {
  switch (b.type) {
    case "paragraph":
    case "heading":
      return inlinesToPlainText(b.inlines);
    case "quote":
      return b.blocks.map(blockToText).join(" ");
    default:
      return "";
  }
}

function renderBlock(block: Block, assets: ReadonlyMap<string, Asset>): string {
  switch (block.type) {
    case "heading": {
      const prefix = "#".repeat(block.level);
      return `${prefix} ${renderInlines(block.inlines)}`;
    }
    case "paragraph":
      return renderInlines(block.inlines);
    case "list": {
      const marker = block.ordered ? "1. " : "- ";
      return block.items
        .map((item) => item.map((b) => renderBlock(b, assets)).join("\n"))
        .map((s) => indentList(s, marker))
        .join("\n");
    }
    case "quote":
      return block.blocks.map((b) => `> ${renderBlock(b, assets)}`).join("\n");
    case "codeBlock":
      return `\`\`\`${block.lang ?? ""}\n${block.text}\n\`\`\``;
    case "image": {
      const asset = assets.get(block.assetId);
      const src = asset?.rehosted[JUJIN]?.url ?? asset?.source.url ?? asset?.source.dataUrl ?? "";
      const alt = block.alt ?? block.caption ?? "";
      return `![${alt}](${src})`;
    }
    case "table":
      return renderTable(block);
    case "math":
      return `$$${block.tex}$$`;
    case "divider":
      return "---";
    case "embed":
      return block.src ? `[${block.src}](${block.src})` : "";
    case "footnote":
      return `[${block.label}]: ${block.href}`;
    default:
      return "";
  }
}

function renderInlines(inlines: readonly Inline[]): string {
  return inlines
    .map((i) => {
      switch (i.type) {
        case "text":
        case "emoji":
          return i.value;
        case "strong":
          return `**${renderInlines(i.children)}**`;
        case "em":
          return `*${renderInlines(i.children)}*`;
        case "code":
          return `\`${i.value}\``;
        case "link":
          return `[${renderInlines(i.children)}](${i.href})`;
        case "inlineMath":
          return `$${i.tex}$`;
        case "lineBreak":
          return "\n";
      }
    })
    .join("");
}

function indentList(s: string, marker: string): string {
  const lines = s.split("\n");
  return lines
    .map((ln, idx) => (idx === 0 ? `${marker}${ln}` : `  ${ln}`))
    .join("\n");
}

function renderTable(block: Extract<Block, { type: "table" }>): string {
  const header = block.header.map((cell) => renderInlines(cell)).join(" | ");
  const sep = block.header.map(() => "---").join(" | ");
  const rows = block.rows.map((row) => row.map((cell) => renderInlines(cell)).join(" | "));
  return [`| ${header} |`, `| ${sep} |`, ...rows.map((r) => `| ${r} |`)].join("\n");
}

function collectImages(doc: Document): string[] {
  const ids: string[] = [];
  for (const b of doc.blocks) if (b.type === "image") ids.push(b.assetId);
  return ids;
}
