/**
 * 共享「纯文本 + #话题#」平台序列化(微博 / 抖音 / 快手 / 视频号)。
 *
 * 这些平台的正文模型与小红书一致:纯文本 + emoji + #话题#,无 Markdown/HTML。
 * preprocess 阶段的 flatten-to-plaintext 已把 IR 扁平化为单一 paragraph(带 emoji 引导行),
 * 本序列化负责:标题硬约束、正文长度约束(超出标记 overflow)、话题拼接、封面/图片收集。
 */
import type { Block, Document, PlatformOverride } from "../../ir/types.js";
import { inlinesToPlainText } from "../../ir/guards.js";
import { graphemeCount, graphemeTruncate } from "../../transforms/grapheme-count.js";
import type { SerializedPayload } from "../types.js";

/** 纯文本 + #话题# 平台的可配置参数。 */
export interface PlaintextTopicsOptions {
  /** 标题上限(字素簇)。 */
  readonly titleMax: number;
  /** 正文上限(含话题行,字素簇)。 */
  readonly bodyMax: number;
  /** 标签(话题)数量上限。 */
  readonly tagsMax: number;
  /** 发布类型(用于 extra.note)。 */
  readonly note: string;
}

/** 序列化:IR → 纯文本 + #话题#。 */
export function serializePlaintextTopics(
  doc: Document,
  override: PlatformOverride | undefined,
  opts: PlaintextTopicsOptions,
): SerializedPayload {
  // 正文:flatten-to-plaintext 已把全文塞进第一个 paragraph。
  const bodyRaw = doc.blocks
    .map((b) => (b.type === "paragraph" ? inlinesToPlainText(b.inlines) : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");

  const tags = (override?.tags ?? doc.meta.tags).slice(0, opts.tagsMax);
  const tagLine = tags.map((t) => `#${t}#`).join(" ");

  // 正文 + 话题行,总长 ≤ bodyMax;超出则截断正文并保留话题行。
  const reserve = tagLine ? graphemeCount(tagLine) + 2 : 0;
  const bodyBudget = Math.max(0, opts.bodyMax - reserve);
  const bodyCount = graphemeCount(bodyRaw);
  const overflow = bodyCount > bodyBudget;
  const body = overflow ? graphemeTruncate(bodyRaw, bodyBudget) : bodyRaw;
  const content = tagLine ? `${body}\n\n${tagLine}` : body;

  const title = graphemeTruncate(override?.title ?? doc.meta.title, opts.titleMax);

  return {
    content,
    mime: "text/plain",
    title,
    tags,
    imageAssetIds: collectImages(doc),
    coverAssetId: override?.coverAssetId ?? doc.meta.coverAssetId,
    extra: {
      bodyGraphemeCount: graphemeCount(content),
      overflow,
      overflowHint: overflow ? `正文超 ${opts.bodyMax} 字,已按平台上限截断;建议把冗余信息放入评论区置顶补充。` : undefined,
      note: opts.note,
    },
  };
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
