/**
 * 发布幂等键 —— 让"内容没变的重试"被服务端识别为同一次操作。
 *
 * 为什么需要:多平台发布是有副作用且不可撤销的操作。若网络抖动导致客户端
 * 未收到成功响应而重试,同名同内容的请求可能产生重复草稿/重复发布。
 * 给每次发布算一个稳定 key,服务端命中即直接返回首次结果,不再二次提交平台。
 *
 * 纯同步实现(无依赖):core 同时被浏览器扩展与 Node server 使用,
 * 不能用 Node crypto / 异步 WebCrypto,故用确定性 FNV-1a 32 位哈希。
 */
import type { SerializedPayload } from "../adapters/types.js";

/** 发布意图:草稿(draft)与直接发布(publish)是两次不同的副作用,key 必须区分。 */
export type PublishIntent = "draft" | "publish";

/**
 * 为一次发布计算稳定的幂等键。
 *
 * 相同平台 + 相同内容 + 相同发布意图 → 相同 key,使重试可被服务端识别为同一次操作。
 *
 * @param platformId 目标平台
 * @param contentHash 序列化产物的内容哈希
 * @param intent 发布意图(draft / publish)
 * @returns 幂等键
 */
export function buildIdempotencyKey(
  platformId: string,
  contentHash: string,
  intent: PublishIntent,
): string {
  return `${platformId}:${intent}:${contentHash}`;
}

/**
 * 从序列化产物派生稳定内容哈希。
 *
 * 取"决定平台侧落库内容"的字段:正文、标题、摘要、发布意图(发布 vs 仅草稿)。
 * 用 JSON 序列化做字段编码,天然带引号转义,避免字段内容互相串接产生碰撞。
 *
 * @param payload 序列化产物
 * @param publish 是否直接发布(区别于仅存草稿)
 * @returns 8 位十六进制内容哈希
 */
export function contentHashOfPayload(payload: SerializedPayload, publish: boolean): string {
  const source = JSON.stringify([
    payload.content,
    payload.title,
    payload.summary ?? "",
    publish ? "publish" : "draft",
  ]);
  return fnv1a(source);
}

/** FNV-1a 32 位哈希 → 8 位十六进制(确定性、跨进程稳定)。 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
