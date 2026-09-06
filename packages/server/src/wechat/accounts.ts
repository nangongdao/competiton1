/**
 * ACCOUNT-03 server 侧公众号多账号注册表。
 *
 * 默认行为(单公众号):server 只用 WECHAT_APPID/WECHAT_SECRET 配置一个 WechatPublisher。
 * 多账号:MP_PROFILES 环境变量可声明多套凭据,每条 `{id, appId, secret, name}`;
 * 客户端发布/连接/指标同步时携带 `serverProfileId`,server 按引用路由到对应 Publisher,
 * 密钥只在 server 进程内,绝不落盘到前端/诊断工件。
 */
import type { ImageFetchConfig } from "../config.js";
import { resolveWechatCredentials } from "../config.js";
import { WechatPublisher, type ImageFetcher } from "./rehost.js";

export interface WechatAccountRegistryOptions {
  readonly appId: string;
  readonly secret: string;
  readonly profiles: ReadonlyArray<{ id: string; appId: string; secret: string; name?: string }>;
  readonly imageFetch: ImageFetchConfig;
  /** 注入图片抓取器(默认 SecureImageFetcher;测试可替换)。 */
  readonly imageFetcher?: ImageFetcher;
  /** 注入默认公众号发布器(单例注入;未指定 profile 时优先使用)。 */
  readonly defaultPublisher?: WechatPublisher;
}

/** 按 profile 引用路由公众号发布器。 */
export class WechatAccountRegistry {
  private readonly defaults: { appId: string; secret: string } | undefined;
  private readonly byProfile = new Map<string, { appId: string; secret: string; name?: string }>();
  private readonly publishers = new Map<string, WechatPublisher>();
  private readonly imageFetch: ImageFetchConfig;
  private readonly imageFetcher: ImageFetcher | undefined;
  private readonly defaultPublisher: WechatPublisher | undefined;

  constructor(options: WechatAccountRegistryOptions) {
    this.imageFetch = options.imageFetch;
    this.imageFetcher = options.imageFetcher;
    this.defaultPublisher = options.defaultPublisher;
    if (options.appId && options.secret) {
      this.defaults = { appId: options.appId, secret: options.secret };
    }
    for (const p of options.profiles ?? []) {
      if (p.id && p.appId && p.secret) {
        this.byProfile.set(p.id, { appId: p.appId, secret: p.secret, name: p.name });
      }
    }
  }

  /** 是否配置了任一公众号凭据(可用于发布/连接)。 */
  get configured(): boolean {
    return !!this.defaults || this.byProfile.size > 0;
  }

  /** 已声明的账号(脱敏元信息,不含密钥)。 */
  listProfiles(): ReadonlyArray<{ id: string; name?: string }> {
    const out: Array<{ id: string; name?: string }> = [];
    if (this.defaults) out.push({ id: "default" });
    for (const [id, p] of this.byProfile) out.push({ id, name: p.name });
    return out;
  }

  /** 按 serverProfileId 取公众号发布器;缺省用默认配置;都没有返回 undefined。 */
  publisherFor(serverProfileId: string | undefined): WechatPublisher | undefined {
    if (serverProfileId && this.byProfile.has(serverProfileId)) {
      return this.publisher(this.byProfile.get(serverProfileId)!);
    }
    // 未指定 profile(或引用不存在):优先使用注入的默认发布器(单例注入/幂等缓存),
    // 否则回退到默认配置创建。
    if (this.defaultPublisher) return this.defaultPublisher;
    if (!this.defaults) return undefined;
    return this.publisher(this.defaults);
  }

  /** 按 serverProfileId 取凭据(供 metrics/connect 复用)。 */
  credentialsFor(serverProfileId: string | undefined): { appId: string; secret: string; name?: string } | undefined {
    return resolveWechatCredentials(
      {
        appId: this.defaults?.appId ?? "",
        secret: this.defaults?.secret ?? "",
        configured: this.configured,
        profiles: [...this.byProfile].map(([id, p]) => ({ id, appId: p.appId, secret: p.secret, name: p.name })),
      },
      serverProfileId,
    );
  }

  private publisher(creds: { appId: string; secret: string; name?: string }): WechatPublisher {
    let pub = this.publishers.get(creds.appId);
    if (!pub) {
      pub = new WechatPublisher(creds.appId, creds.secret, {
        imageFetch: this.imageFetch,
        ...(this.imageFetcher ? { imageFetcher: this.imageFetcher } : {}),
      });
      this.publishers.set(creds.appId, pub);
    }
    return pub;
  }
}
