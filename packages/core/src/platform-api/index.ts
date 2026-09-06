/**
 * 平台 API 契约层汇总 —— 注册全部 provider。
 *
 * - wechat:官方 API(stable_token / draft / freepublish / datacube),支持一键连接 + 真实发布;
 * - zhihu/bilibili/xiaohongshu/juejin/cnblogs:会话式 provider(runner 浏览器登录态一键连接 + 网页自动化发布);
 * - csdn:官方开放 API(凭据字段 + 端点契约 + 一键连接解析框架,runner 提供解析实现)。
 */
import { CSDN_PLATFORM_API } from "./csdn.js";
import { registerPlatformApi } from "./registry.js";
import {
  bilibiliSessionProvider,
  cnblogsSessionProvider,
  juejinSessionProvider,
  xiaohongshuSessionProvider,
  zhihuSessionProvider,
} from "./session.js";
import type { PlatformApiProvider } from "./types.js";
import { WechatPlatformApiProvider } from "./wechat.js";

const providers: readonly PlatformApiProvider[] = [
  new WechatPlatformApiProvider(),
  zhihuSessionProvider(),
  bilibiliSessionProvider(),
  xiaohongshuSessionProvider(),
  juejinSessionProvider(),
  cnblogsSessionProvider(),
  CSDN_PLATFORM_API,
];

for (const p of providers) registerPlatformApi(p);

export * from "./http.js";
export * from "./registry.js";
export * from "./types.js";
export { WechatPlatformApiProvider, wechatPlatformApiDescriptor, parseWechatAccountInfo, classifyWechatError } from "./wechat.js";
export {
  SessionPlatformApiProvider,
  zhihuSessionProvider,
  bilibiliSessionProvider,
  xiaohongshuSessionProvider,
  juejinSessionProvider,
  cnblogsSessionProvider,
} from "./session.js";
export type { SessionConnectionChecker, SessionConnectionOptions, SessionPublishDelegate } from "./session.js";
export { CSDN_PLATFORM_API, CsdnPlatformApiProvider, csdnPlatformApiDescriptor, parseCsdnAccountInfo } from "./csdn.js";
export type { CsdnConnectionChecker } from "./csdn.js";
