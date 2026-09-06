/**
 * 无官方开放 API 平台的"会话式连接" provider —— 知乎/B站/小红书/掘金。
 *
 * 这些平台截至 2026-08 均无自助内容发布开放 API(仅网页/客户端登录态),
 * 因此"一键连接 + 一键解析"通过 **本机 Playwright 持久化浏览器会话** 完成:
 * - 复用用户已登录的浏览器 profile,打开平台编辑器;
 * - 检测登录/验证码/风控 → 未登录返回 needs-user-action;
 * - 从页面解析账号昵称/头像/主页 → 返回脱敏连接结果;
 * - 真实发布走 runner 的 draft/full-auto 自动化链路。
 *
 * 网络边界:core 不直接开浏览器;`SessionConnectionChecker` 由 runner 注入
 * (runner 才有 Playwright + 用户浏览器登录态)。
 */
import type {
  ApiCallResult,
  ConnectionCheckRequest,
  ConnectionCheckResult,
  PlatformApiDescriptor,
  PlatformApiProvider,
  PlatformCredentialField,
  PlatformEndpointSpec,
  PlatformHttpClient,
  PlatformPublishRequest,
} from "./types.js";

/** 会话平台的一键连接检查回调(runner 注入)。 */
export interface SessionConnectionChecker {
  (req: ConnectionCheckRequest, now?: () => string): Promise<ConnectionCheckResult>;
}

/** 会话平台的一键连接检查(未注入时返回 unsupported 提示)。 */
export interface SessionConnectionOptions {
  readonly platformId: string;
  readonly name: string;
  readonly editorUrl: string;
  readonly docsUrl?: string;
  /** 会话平台无需密钥字段,只提示"请先在浏览器登录"。 */
  readonly credentialsHint: string;
  readonly endpoints?: readonly PlatformEndpointSpec[];
  /** runner 注入的连接检查器。 */
  readonly checker?: SessionConnectionChecker;
}

/** 会话平台发布(真实网页自动化)由 runner 完成,core 侧只做契约与路由。 */
export interface SessionPublishDelegate {
  (req: PlatformPublishRequest): Promise<ApiCallResult>;
}

const SESSION_CREDENTIALS: readonly PlatformCredentialField[] = [
  {
    key: "session",
    kind: "text",
    label: "浏览器登录态",
    required: false,
    hint: "无需填写密钥:请先在 runner 打开的浏览器中登录该平台,连接检查会复用你的登录态",
  },
];

/** 会话平台 provider:连接走 runner 浏览器,发布走网页自动化。 */
export class SessionPlatformApiProvider implements PlatformApiProvider {
  readonly descriptor: PlatformApiDescriptor;
  private readonly checker?: SessionConnectionChecker;
  private readonly publishDelegate?: SessionPublishDelegate;

  constructor(options: SessionConnectionOptions & { publishDelegate?: SessionPublishDelegate }) {
    this.checker = options.checker;
    this.publishDelegate = options.publishDelegate;
    this.descriptor = {
      platformId: options.platformId,
      name: options.name,
      docsUrl: options.docsUrl,
      credentials: SESSION_CREDENTIALS,
      capabilities: ["check", "publish"],
      endpoints:
        options.endpoints ??
        [
          {
            name: "editor",
            label: "网页编辑器(连接检查 + 真实发布)",
            method: "GET",
            urlTemplate: options.editorUrl,
            description: "用已登录的浏览器会话打开编辑器,解析账号并支持 draft/full-auto 发布",
            needsAuth: true,
          },
        ],
    };
  }

  async checkConnection(req: ConnectionCheckRequest, _http: PlatformHttpClient, now?: () => string): Promise<ConnectionCheckResult> {
    if (!this.checker) {
      return {
        ok: false,
        platformId: req.platformId,
        message: `${this.descriptor.name} 无官方开放 API,请启动 runner 后用浏览器登录态一键连接(runner 未注入连接检查器)`,
        errorKind: "unsupported",
        at: (now ?? (() => new Date().toISOString()))(),
      };
    }
    return this.checker(req, now);
  }

  async publish(req: PlatformPublishRequest, _http: PlatformHttpClient, now?: () => string): Promise<ApiCallResult> {
    const at = (now ?? (() => new Date().toISOString()))();
    if (!this.publishDelegate) {
      return {
        ok: false,
        platformId: req.platformId,
        action: "publish",
        message: `${this.descriptor.name} 发布需 runner 网页自动化(runner 未注入发布委托)`,
        at,
      };
    }
    return this.publishDelegate(req);
  }
}

/** 构造知乎会话 provider。 */
export function zhihuSessionProvider(opts: { checker?: SessionConnectionChecker; publishDelegate?: SessionPublishDelegate } = {}): SessionPlatformApiProvider {
  return new SessionPlatformApiProvider({
    platformId: "zhihu",
    name: "知乎",
    editorUrl: "https://zhuanlan.zhihu.com/write",
    docsUrl: "https://www.zhihu.com/",
    credentialsHint: "知乎无公开内容发布 API;请在浏览器登录后一键连接",
    ...opts,
  });
}

/** 构造 B站会话 provider。 */
export function bilibiliSessionProvider(opts: { checker?: SessionConnectionChecker; publishDelegate?: SessionPublishDelegate } = {}): SessionPlatformApiProvider {
  return new SessionPlatformApiProvider({
    platformId: "bilibili",
    name: "B站专栏",
    editorUrl: "https://member.bilibili.com/platform/upload/text/apply",
    docsUrl: "https://openhome.bilibili.com/",
    credentialsHint: "B站开放平台未开放专栏自助发布;请在浏览器登录后一键连接",
    ...opts,
  });
}

/** 构造小红书会话 provider。 */
export function xiaohongshuSessionProvider(opts: { checker?: SessionConnectionChecker; publishDelegate?: SessionPublishDelegate } = {}): SessionPlatformApiProvider {
  return new SessionPlatformApiProvider({
    platformId: "xiaohongshu",
    name: "小红书",
    editorUrl: "https://creator.xiaohongshu.com/publish/publish",
    docsUrl: "https://creator.xiaohongshu.com/",
    credentialsHint: "小红书无公开内容发布 API;请在浏览器登录后一键连接",
    ...opts,
  });
}

/** 构造博客园会话 provider(SDK-04 第七平台试点)。 */
export function cnblogsSessionProvider(opts: { checker?: SessionConnectionChecker; publishDelegate?: SessionPublishDelegate } = {}): SessionPlatformApiProvider {
  return new SessionPlatformApiProvider({
    platformId: "cnblogs",
    name: "博客园",
    editorUrl: "https://i.cnblogs.com/posts/edit",
    docsUrl: "https://www.cnblogs.com/",
    credentialsHint: "博客园无公开内容发布 API;请在浏览器登录后一键连接(随笔编辑页)",
    ...opts,
  });
}

/** 构造掘金会话 provider。 */
export function juejinSessionProvider(opts: { checker?: SessionConnectionChecker; publishDelegate?: SessionPublishDelegate } = {}): SessionPlatformApiProvider {
  return new SessionPlatformApiProvider({
    platformId: "juejin",
    name: "掘金",
    editorUrl: "https://juejin.cn/editor/drafts/new",
    docsUrl: "https://juejin.cn/",
    credentialsHint: "掘金无公开内容发布 API;请在浏览器登录后一键连接",
    ...opts,
  });
}
