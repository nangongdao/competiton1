/**
 * 平台官方/开放 API 契约层 —— 统一"一键连接 + 一键解析 + 真实发布"的平台接口描述。
 *
 * 设计动机(对齐用户诉求:把每个平台的接口做好、一键自动连接每个平台的 API、一键解析):
 * - 每个平台声明自己的**凭据字段**(appid/secret/cookie/token)、**端点清单**、**能力集**;
 * - 「一键连接」= 按凭据字段收集用户输入 → 调平台的连通性端点 → 返回解析后的账号信息;
 * - 「一键解析」= 把平台响应 JSON 按统一 schema 解析为可读结构(账号 id/名称/头像、过期时间等);
 * - 「真实发布」= 声明了 `publish` 能力的平台,调用方(server/runner)按端点构造真实请求。
 *
 * 网络边界(与项目一致):core 是纯逻辑层,不直接发请求;所有网络通过注入的
 * `PlatformHttpClient` 完成(server/runner 各自注入真实 fetch 实现)。
 */
import type { SerializedPayload } from "../adapters/types.js";

/** 注入的网络客户端(server/runner 实现真实 fetch;core 不直接发请求)。 */
export interface PlatformHttpClient {
  request(req: PlatformHttpRequest): Promise<PlatformHttpResponse>;
}

/** 平台 API 请求选项。 */
export interface PlatformHttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

/** 平台 API 响应(HTTP 层)。 */
export interface PlatformHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}
/** 凭据字段类型(前端收集;密钥类字段永远不回显、不落盘到提交文件)。 */
export type PlatformCredentialKind = "secret" | "text" | "url";

export interface PlatformCredentialField {
  readonly kind: PlatformCredentialKind;
  /** 字段 key(与 provider 读取逻辑一致)。 */
  readonly key: string;
  /** 中文 label(UI 展示)。 */
  readonly label: string;
  readonly placeholder?: string;
  /** 是否必填。 */
  readonly required?: boolean;
  readonly hint?: string;
}

/** 平台 API 端点描述(供一键解析文档/连接检查/UI 展示)。 */
export interface PlatformEndpointSpec {
  readonly name: string;
  readonly label: string;
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** URL 模板,支持 {access_token} / {token} 占位。 */
  readonly urlTemplate: string;
  readonly description: string;
  readonly needsAuth: boolean;
  /** 请求体 JSON schema 说明(人类可读)。 */
  readonly bodyExample?: unknown;
}

/** 平台 API 能力:check=一键连接检查,publish=真实发布,metrics=效果指标同步。 */
export type PlatformApiCapability = "check" | "publish" | "metrics";

/** 平台 API 描述(注册表条目)。 */
export interface PlatformApiDescriptor {
  readonly platformId: string;
  readonly name: string;
  /** 官方/社区 API 文档地址(提示用)。 */
  readonly docsUrl?: string;
  readonly credentials: readonly PlatformCredentialField[];
  readonly capabilities: readonly PlatformApiCapability[];
  readonly endpoints: readonly PlatformEndpointSpec[];
}

/** 统一的一键连接检查结果。 */
export interface ConnectionCheckResult {
  readonly ok: boolean;
  readonly platformId: string;
  readonly message: string;
  /** 解析出的账号信息(脱敏)。 */
  readonly account?: { id?: string; name?: string; avatar?: string; url?: string };
  /** 解析出的其它字段(已脱敏,供 UI 展示)。 */
  readonly parsed?: Readonly<Record<string, unknown>>;
  readonly errorKind?:
    | "invalid-credentials"
    | "network"
    | "unauthorized"
    | "api-error"
    | "rate-limited"
    | "unsupported";
  readonly latencyMs?: number;
  readonly at: string;
}

/** 统一解析后的平台 API 响应。 */
export interface ParsedApiResponse<T = unknown> {
  readonly ok: boolean;
  readonly platformId: string;
  /** 原始响应(可能含敏感字段,调用方负责脱敏后再展示/落盘)。 */
  readonly raw: unknown;
  readonly data?: T;
  readonly error?: string;
  readonly errorKind?: string;
}

/** 统一平台 API 调用结果(真实发布/指标同步复用)。 */
export interface ApiCallResult<T = unknown> {
  readonly ok: boolean;
  readonly platformId: string;
  readonly action: string;
  readonly data?: T;
  readonly remoteId?: string;
  readonly message: string;
  readonly at: string;
}

/** 平台凭据(运行时结构;web 端只在内存/会话中持有,绝不写入提交文件)。 */
export type PlatformCredentials = Readonly<Record<string, string>>;

/** 真实发布请求(由 app → server/runner → 平台 API)。 */
export interface PlatformPublishRequest {
  readonly platformId: string;
  readonly credentials: PlatformCredentials;
  /** core 序列化产物(内容/标题/摘要/标签/封面)。 */
  readonly payload: SerializedPayload;
  /** draft=仅创建草稿,publish=直接发布。 */
  readonly mode: "draft" | "publish";
}

/** 一键连接检查请求。 */
export interface ConnectionCheckRequest {
  readonly platformId: string;
  readonly credentials: PlatformCredentials;
  /** ACCOUNT-03:会话平台账号的浏览器登录 profile 目录名。 */
  readonly profileDir?: string;
}

/** 平台 API 提供者:把 descriptor 与具体连接/发布逻辑绑定。 */
export interface PlatformApiProvider {
  readonly descriptor: PlatformApiDescriptor;
  /** 一键连接:校验凭据并解析账号信息(网络经注入的 client)。 */
  checkConnection(req: ConnectionCheckRequest, http: PlatformHttpClient, now?: () => string): Promise<ConnectionCheckResult>;
  /** 真实发布(实现了 publish 能力)。未实现时抛 unsupported。 */
  publish?(req: PlatformPublishRequest, http: PlatformHttpClient, now?: () => string): Promise<ApiCallResult>;
}
