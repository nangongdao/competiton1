/**
 * 内容寻址原语(UPGRADE §2)—— 为图片去重 / 幂等缓存 / 预处理缓存提供内容哈希。
 *
 * 优先用 WebCrypto SHA-256(浏览器与 Node 20+ 均可用),取 128 位前缀,碰撞概率可忽略;
 * 环境不支持 WebCrypto 时退化为 FNV-1a 32 位(纯同步、跨环境确定,与 publish/idempotency 一致)。
 */
import { fnv1a } from "../publish/idempotency.js";

/** 最小 WebCrypto 抽象:只用 digest,避免依赖 DOM lib(Node-only 构建也可用)。 */
interface SubtleLike {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

/**
 * 计算图片内容哈希,用于去重与缓存键。
 *
 * @param bytes 图片二进制数据
 * @returns 十六进制哈希(WebCrypto 时 16 位,SHA-256 前缀;退化时 8 位 FNV-1a)
 */
export async function computeContentHash(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return hexPrefix(new Uint8Array(digest), 8);
  }
  // 退化:字节折叠为码元后走 FNV-1a(超大图可分块拼接,避免超长字符串)。
  let s = "";
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    s += String.fromCharCode(...bytes.subarray(i, end));
  }
  return fnv1a(s);
}

/** 取前 n 字节的十六进制。 */
function hexPrefix(bytes: Uint8Array, n: number): string {
  return Array.from(bytes.slice(0, n))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
