/**
 * runner 平台 API 集成 —— 把 core 的会话式 provider 与 runner 的真实浏览器连接检查绑定。
 *
 * 入口:`registerRunnerPlatformApi(opener, http)` 为 core 注册表里的会话 provider 注入
 * 一键连接检查器(知乎/B站/小红书/掘金/博客园走浏览器登录态,CSDN 走官方接口)。
 *
 * 说明:公众号(wechat)的官方 API 由 server 持有密钥并中转(见 server /platform-api/connect),
 * runner 侧不重复注册公众号连接。
 */
import {
  bilibiliSessionProvider,
  cnblogsSessionProvider,
  juejinSessionProvider,
  xiaohongshuSessionProvider,
  zhihuSessionProvider,
  CsdnPlatformApiProvider,
  registerPlatformApi,
  type PlatformHttpClient,
} from "@mpp/core";
import { makeCsdnConnectionChecker, makeSessionConnectionChecker, type SessionOpener } from "./connect.js";

export interface RunnerPlatformApiOptions {
  /** 浏览器会话打开器(复用 runner 的 BrowserSessionManager)。 */
  readonly opener: SessionOpener;
  /** HTTP 客户端(CSDN 官方接口用)。 */
  readonly http: PlatformHttpClient;
}

/** 已注册标记,避免重复注入。 */
let registered = false;

/**
 * 注册 runner 侧的一键连接能力。
 *
 * 幂等:重复调用不重复注册(同一 opener/http 覆盖同一 provider)。
 */
export function registerRunnerPlatformApi(options: RunnerPlatformApiOptions): void {
  const { opener, http } = options;
  const checker = makeSessionConnectionChecker(opener);

  // 会话平台:注入浏览器登录态连接检查器。
  registerPlatformApi(zhihuSessionProvider({ checker }));
  registerPlatformApi(bilibiliSessionProvider({ checker }));
  registerPlatformApi(xiaohongshuSessionProvider({ checker }));
  registerPlatformApi(juejinSessionProvider({ checker }));
  registerPlatformApi(cnblogsSessionProvider({ checker }));

  // CSDN:官方接口 + Cookie 解析。
  registerPlatformApi(new CsdnPlatformApiProvider({ checker: makeCsdnConnectionChecker(http) }));

  registered = true;
}

/** 是否已注入 runner 侧能力(供 server 判断是否需要转发)。 */
export function isRunnerPlatformApiRegistered(): boolean {
  return registered;
}
