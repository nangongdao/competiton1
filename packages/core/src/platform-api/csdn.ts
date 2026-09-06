/**
 * CSDN 开放 API provider —— 一键连接 + 账号解析(新平台)。
 *
 * CSDN 博客提供官方 API:
 * - GET /blog-console/api/v1/myself/info  当前账号信息(昵称/头像/主页)
 * - POST /blog-console/api/v1/article/edit 提交文章(草稿/发布)
 *
 * 凭据:通过 Cookie 鉴权。出于安全考虑,本 provider 只声明凭据字段与端点契约,
 * 真实的 Cookie 会话解析/账号信息解析由调用方(runner/server)注入 `checker` 实现
 * (与会话式 provider 相同模式:core 不直接持有/发送 Cookie)。
 *
 * 本 provider 同时提供**纯响应解析器** `parseCsdnAccountInfo`,供 runner 的
 * 一键连接检查器复用,保证解析行为与其它平台一致。
 */
import { strField } from "./http.js";
import type {
  ConnectionCheckRequest,
  ConnectionCheckResult,
  PlatformApiDescriptor,
  PlatformApiProvider,
  PlatformCredentialField,
  PlatformEndpointSpec,
  PlatformHttpClient,
} from "./types.js";

/** CSDN 一键连接检查器(runner 注入,用 Playwright Cookie 会话实现)。 */
export interface CsdnConnectionChecker {
  (req: ConnectionCheckRequest, now?: () => string): Promise<ConnectionCheckResult>;
}

/** CSDN 凭据字段(本机保存,绝不提交)。 */
const CSDN_CREDENTIALS: readonly PlatformCredentialField[] = [
  {
    key: "cookie",
    kind: "secret",
    label: "CSDN Cookie",
    placeholder: "粘贴登录后的 Cookie",
    required: true,
    hint: "在 CSDN 登录后从浏览器开发者工具复制 Cookie;仅保存在本机",
  },
];

/** CSDN 官方端点清单(供一键解析文档/UI 展示)。 */
export const csdnEndpoints: readonly PlatformEndpointSpec[] = [
  {
    name: "myself_info",
    label: "账号信息（一键连接解析）",
    method: "GET",
    urlTemplate: "https://blog.csdn.net/blog-console/api/v1/myself/info",
    description: "返回当前登录账号的昵称/头像/主页,用于连接检查与身份解析",
    needsAuth: true,
  },
  {
    name: "article_edit",
    label: "发布文章（草稿/发布）",
    method: "POST",
    urlTemplate: "https://blog.csdn.net/blog-console/api/v1/article/edit",
    description: "提交文章内容,支持草稿与直接发布",
    needsAuth: true,
    bodyExample: { title: "标题", content: "Markdown 正文", markdowncontent: "Markdown 正文", categories: "分类", tags: "标签", type: "original", status: 2 },
  },
];

export const csdnPlatformApiDescriptor: PlatformApiDescriptor = {
  platformId: "csdn",
  name: "CSDN 博客",
  docsUrl: "https://blog.csdn.net/blog-console/api-docs",
  credentials: CSDN_CREDENTIALS,
  capabilities: ["check", "publish"],
  endpoints: csdnEndpoints,
};

/** 解析 CSDN 账号信息响应(与其它平台解析器行为一致)。 */
export function parseCsdnAccountInfo(raw: unknown): { id?: string; name?: string; avatar?: string; url?: string } {
  // CSDN /myself/info 典型结构: { code:200, data:{ userName, avatar, url } }
  const obj = raw as Record<string, unknown>;
  const data = (obj["data"] ?? obj) as Record<string, unknown>;
  return {
    id: strField(data, "userName", "user_name", "id", "userId"),
    name: strField(data, "nickname", "nick_name", "userName", "user_name"),
    avatar: strField(data, "avatar", "avatarUrl", "headUrl"),
    url: strField(data, "url", "homePage", "blogUrl") ?? (strField(data, "userName") ? `https://blog.csdn.net/${strField(data, "userName")}` : undefined),
  };
}

/**
 * CSDN provider:官方开放 API,连接检查通过注入的 checker(真实 Cookie 会话由 runner 持有)。
 */
export class CsdnPlatformApiProvider implements PlatformApiProvider {
  readonly descriptor: PlatformApiDescriptor = csdnPlatformApiDescriptor;
  private readonly checker?: CsdnConnectionChecker;

  constructor(options: { checker?: CsdnConnectionChecker } = {}) {
    this.checker = options.checker;
  }

  async checkConnection(req: ConnectionCheckRequest, _http: PlatformHttpClient, now?: () => string): Promise<ConnectionCheckResult> {
    const at = (now ?? (() => new Date().toISOString()))();
    if (!this.checker) {
      return {
        ok: false,
        platformId: "csdn",
        message: "CSDN 连接需要 runner 提供 Cookie 会话解析器(runner 未注入 checker)",
        errorKind: "unsupported",
        at,
      };
    }
    return this.checker(req, now);
  }

  // CSDN 文章发布(cookie 会话)由 runner 的网页自动化/接口调用完成;
  // publish 能力在 runner 侧实现,core 不直接持有 Cookie。
}

/** 注册用的单例(在 index.ts 中注册)。 */
export const CSDN_PLATFORM_API = new CsdnPlatformApiProvider();
