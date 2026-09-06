/** 头条号(Toutiao)序列化:IR → Markdown(原生,含分类/标签 extra)。 */
import type { Asset, Block, Document, Inline, PlatformOverride } from "../../ir/types.js";
import { inlinesToPlainText } from "../../ir/guards.js";
import { graphemeTruncate } from "../../transforms/grapheme-count.js";
import type { SerializedPayload } from "../types.js";
import { buildAssetMap } from "../shared/html-render.js";

export function serializeToutiao(doc: Document, override?: PlatformOverride): SerializedPayload {
  const assetMap = buildAssetMap(doc);
  const content = doc.blocks.map((b) => renderBlock(b, assetMap)).filter((s) => s.length > 0).join("\n\n");
  const title = graphemeTruncate(override?.title ?? doc.meta.title, 64);
  const tags = (override?.tags ?? doc.meta.tags).slice(0, 5);
  const category = override?.category ?? "";

  return {
    content,
    mime: "text/markdown",
    title,
    summary: override?.summary ?? doc.meta.summary ?? deriveSummary(doc),
    tags,
    imageAssetIds: collectImages(doc),
    coverAssetId: override?.coverAssetId ?? doc.meta.coverAssetId,
    extra: {
      category,
      note: "头条号 Markdown 风格;分类 + 标签 ≤5;必须有封面(≥1 张,推荐 3:2)。",
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
    case "paragraph": {
      const text = renderInlines(block.inlines);
      return text || "";
    }
    case "list":
      return block.items
        .map((item, idx) => {
          const prefix = block.ordered ? `${idx + 1}.` : "-";
          return `${prefix} ${item.map((b) => blockToText(b)).join(" ")}`;
        })
        .join("\n");
    case "quote":
      return block.blocks.map((b) => `> ${blockToText(b)}`).join("\n");
    case "codeBlock":
      return `\`\`\`${block.lang ?? ""}\n${block.text}\n\`\`\``;
    case "image": {
      const asset = assets.get(block.assetId);
      const href = asset?.source.url ?? asset?.source.localPath ?? asset?.source.dataUrl ?? block.assetId;
      return asset ? `![${block.alt ?? href}](${href})` : "";
    }
    case "table":
      return renderTable(block);
    case "divider":
      return "---";
    case "math":
      return block.tex;
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
        case "code":
        case "emoji":
          return i.value;
        case "strong":
          return `**${renderInlines(i.children)}**`;
        case "em":
          return `*${renderInlines(i.children)}*`;
        case "link":
          return `[${renderInlines(i.children)}](${i.href})`;
        case "inlineMath":
          return i.tex;
        case "lineBreak":
          return "\n";
      }
    })
    .join("");
}

function renderTable(block: Extract<Block, { type: "table" }>): string {
  const header = block.header.map((c) => renderInlines(c)).join(" | ");
  const sep = block.header.map(() => "---").join(" | ");
  const rows = block.rows.map((r) => r.map((c) => renderInlines(c)).join(" | "));
  return [`| ${header} |`, `| ${sep} |`, ...rows.map((r) => `| ${r} |`)].join("\n");
}

function collectImages(doc: Document): string[] {
  const ids: string[] = [];
  const walk = (blocks: readonly Block[]): void => {
    for (const b of blocks) {
      if (b.type === "image") ids.push(b.assetId);
      else if (b.type === "quote") walk(b.blocks);
      else if (b.type === "list") b.items.forEach(walk);
    }
  };
  walk(doc.blocks);
  return ids;
}
