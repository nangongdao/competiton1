/** server 配置 —— 从环境变量读取公众号凭据 + 图床配置,校验存在性。 */
import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(packageRoot, ".env") });

/** 图床后端类型:local=落盘静态服务,s3=对象存储,wechat=微信永久素材。 */
export type ImageHostKind = "local" | "s3" | "wechat";

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** 公开访问基址(CDN/自定义域),最终 URL = publicBaseUrl + "/" + key。 */
  readonly publicBaseUrl: string;
  readonly configured: boolean;
}

/** 服务端拉取远程图片的安全限制(SSRF / 资源耗尽边界)。 */
export interface ImageFetchConfig {
  /** 单次请求超时(ms)。 */
  readonly timeoutMs: number;
  /** 最大响应字节数(超限直接拒绝)。 */
  readonly maxBytes: number;
  /** 最大重定向跳数。 */
  readonly maxRedirects: number;
  /** 允许的图片 MIME 白名单(image/* 之外的子类型也会被拒绝)。 */
  readonly allowedMimeTypes: readonly string[];
}

/** local 图床配额与保留策略。 */
export interface LocalImageStoreConfig {
  /** 总容量上限(字节),达到后拒绝新上传。 */
  readonly maxTotalBytes: number;
  /** 单文件上限(字节)。 */
  readonly maxFileBytes: number;
  /** 文件保留周期(ms),过期文件在清理时删除。 */
  readonly retentionMs: number;
  /** 是否在启动/上传时执行过期清理。 */
  readonly cleanupEnabled: boolean;
}

export interface ServerConfig {
  readonly port: number;
  /** 每次启动生成的本机 capability token(请求头 X-MPP-Token 携带)。 */
  readonly token: string;
  /** 是否启用鉴权(默认 true;仅在测试/无副作用场景可关闭)。 */
  readonly authEnabled: boolean;
  /** 数据目录(任务持久化等落盘位置,相对 server 包根)。 */
  readonly dataDir: string;
  /** COLLAB-04:可选远程同步服务器地址(SYNC_URL;空 = 纯本地共享)。 */
  readonly syncUrl: string;
  readonly wechat: {
    readonly appId: string;
    readonly secret: string;
    /** 凭据是否齐全(否则真实发布不可用,回退提示)。 */
    readonly configured: boolean;
    /** ACCOUNT-03:多公众号账号配置(server 侧多套凭据,按 profile 引用路由)。 */
    readonly profiles: ReadonlyArray<{ id: string; appId: string; secret: string; name?: string }>;
  };
  readonly imageHost: {
    /** 默认图床后端(本机开发用 local)。 */
    readonly kind: ImageHostKind;
    /** local 图床落盘目录(相对 server 包根)。 */
    readonly localDir: string;
    /** local 图床公开基址(部署公网时改为对外域名)。 */
    readonly localBaseUrl: string;
    readonly s3: S3Config;
  };
  /** 远程图片抓取安全限制。 */
  readonly imageFetch: ImageFetchConfig;
  /** local 图床配额与保留策略。 */
  readonly localStore: LocalImageStoreConfig;
}

export function loadConfig(): ServerConfig {
  const appId = process.env["WECHAT_APPID"]?.trim() ?? "";
  const secret = process.env["WECHAT_SECRET"]?.trim() ?? "";
  const port = Number(process.env["PORT"] ?? 8787);

  // ACCOUNT-03:多公众号账号(MP_PROFILES 环境变量,JSON 数组)。
  const profiles = parseWechatProfiles(process.env["MP_PROFILES"]);

  const s3 = {
    endpoint: process.env["S3_ENDPOINT"]?.trim() ?? "",
    region: process.env["S3_REGION"]?.trim() ?? "auto",
    bucket: process.env["S3_BUCKET"]?.trim() ?? "",
    accessKeyId: process.env["S3_ACCESS_KEY_ID"]?.trim() ?? "",
    secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"]?.trim() ?? "",
    publicBaseUrl: (process.env["S3_PUBLIC_BASE_URL"]?.trim() ?? "").replace(/\/$/, ""),
  };
  const s3Configured = !!(s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey && s3.publicBaseUrl);

  const kind = (process.env["IMAGE_HOST"]?.trim() as ImageHostKind) || "local";

  return {
    port,
    // 启动时生成高熵 token;测试可通过 MP_SERVER_TOKEN 注入确定性 token。
    token: process.env["MP_SERVER_TOKEN"]?.trim() || requireToken(),
    authEnabled: (process.env["MP_AUTH_DISABLED"] ?? "").trim().toLowerCase() !== "true",
    dataDir: resolve(packageRoot, process.env["MP_DATA_DIR"]?.trim() ?? "data"),
    syncUrl: (process.env["SYNC_URL"]?.trim() ?? "").replace(/\/+$/, ""),
    wechat: {
      appId,
      secret,
      configured: appId.length > 0 && secret.length > 0,
      profiles,
    },
    imageHost: {
      kind,
      // 相对路径基于 server 包根解析为绝对路径(不依赖 cwd)。
      localDir: resolve(packageRoot, process.env["IMAGE_LOCAL_DIR"]?.trim() ?? "data/uploads"),
      localBaseUrl: (process.env["IMAGE_LOCAL_BASE_URL"]?.trim() ?? `http://127.0.0.1:${port}`).replace(/\/$/, ""),
      s3: { ...s3, configured: s3Configured },
    },
    imageFetch: {
      timeoutMs: Number(process.env["IMAGE_FETCH_TIMEOUT_MS"] ?? 10_000),
      maxBytes: Number(process.env["IMAGE_FETCH_MAX_BYTES"] ?? 10 * 1024 * 1024),
      maxRedirects: Number(process.env["IMAGE_FETCH_MAX_REDIRECTS"] ?? 3),
      allowedMimeTypes: (process.env["IMAGE_FETCH_ALLOWED_MIME"] ?? "image/png,image/jpeg,image/gif,image/webp")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    localStore: {
      maxTotalBytes: Number(process.env["IMAGE_STORE_MAX_TOTAL_BYTES"] ?? 200 * 1024 * 1024),
      maxFileBytes: Number(process.env["IMAGE_STORE_MAX_FILE_BYTES"] ?? 10 * 1024 * 1024),
      // 默认保留 7 天。
      retentionMs: Number(process.env["IMAGE_STORE_RETENTION_MS"] ?? 7 * 24 * 60 * 60 * 1000),
      cleanupEnabled: (process.env["IMAGE_STORE_CLEANUP_DISABLED"] ?? "").trim().toLowerCase() !== "true",
    },
  };
}

/** 未配置 token 时生成一个(每次启动不同,客户端需重新配对)。 */
function requireToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 解析 MP_PROFILES 环境变量(JSON 数组,ACCOUNT-03 多公众号凭据)。
 * 例: `[{"id":"profile-main","appId":"wx1","secret":"s1","name":"主号"},...]`
 * 非法条目直接跳过;整体非法时回退空数组(不抛错,保证服务可启动)。
 */
export function parseWechatProfiles(raw: string | undefined): Array<{ id: string; appId: string; secret: string; name?: string }> {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Array<{ id: string; appId: string; secret: string; name?: string }> = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const id = typeof item["id"] === "string" ? item["id"].trim() : "";
      const profileAppId = typeof item["appId"] === "string" ? item["appId"].trim() : "";
      const profileSecret = typeof item["secret"] === "string" ? item["secret"].trim() : "";
      if (!id || !profileAppId || !profileSecret) continue;
      out.push({
        id,
        appId: profileAppId,
        secret: profileSecret,
        name: typeof item["name"] === "string" ? item["name"].trim() : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 按 profile 引用取公众号凭据(默认取主配置)。 */
export function resolveWechatCredentials(
  config: ServerConfig["wechat"],
  serverProfileId: string | undefined,
): { appId: string; secret: string; name?: string } | undefined {
  if (serverProfileId) {
    const found = config.profiles.find((p) => p.id === serverProfileId);
    if (found) return { appId: found.appId, secret: found.secret, name: found.name };
  }
  if (config.appId && config.secret) {
    return { appId: config.appId, secret: config.secret };
  }
  return undefined;
}
