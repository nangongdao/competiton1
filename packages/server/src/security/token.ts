/**
 * server/runner capability token —— 本机特权服务的请求鉴权。
 *
 * 为什么需要:CORS 只是浏览器兼容策略,不是鉴权。server 与 runner 都是
 * 具有真实发布副作用的本机特权服务,任意本机页面/扩展都可以向它们发起
 * 请求。本模块为每次启动生成高熵随机 token,客户端必须携带才能调用
 * 副作用路由,否则 401/403。
 *
 * 安全要求:
 * - token 只保存在本机设置,绝不进入 URL、错误信息或日志;
 * - 比较使用常量时间,避免时序侧信道;
 * - /health 只返回非敏感摘要(不返回 token、不返回路径细节)。
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** 启动时生成的令牌。 */
export interface CapabilityToken {
  readonly value: string;
}

/** 生成新令牌:32 字节高熵随机,hex 编码(64 字符)。 */
export function generateToken(): CapabilityToken {
  return { value: randomBytes(32).toString("hex") };
}

/** 常量时间比较:长度不同直接失败,长度相同逐字节异或比较。 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 从请求头提取 bearer token。 */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1];
}
