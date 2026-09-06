import type { AutomationPlatformId } from "../types.js";
import { BilibiliAutomationAdapter } from "./bilibili.js";
import type { AutomationPlatformAdapter } from "./types.js";
import { WechatAutomationAdapter } from "./wechat.js";
import { XiaohongshuAutomationAdapter } from "./xiaohongshu.js";
import { ZhihuAutomationAdapter } from "./zhihu.js";
import { JuejinAutomationAdapter } from "./juejin.js";
import { CsdnAutomationAdapter } from "./csdn.js";
import { CnblogsAutomationAdapter } from "./cnblogs.js";
import { WeiboAutomationAdapter } from "./weibo.js";
import { ToutiaoAutomationAdapter } from "./toutiao.js";
import { DouyinAutomationAdapter } from "./douyin.js";
import { KuaishouAutomationAdapter } from "./kuaishou.js";
import { ShipinhaoAutomationAdapter } from "./shipinhao.js";

const adapters = new Map<AutomationPlatformId, AutomationPlatformAdapter>();

registerAutomationAdapter(new WechatAutomationAdapter());
registerAutomationAdapter(new ZhihuAutomationAdapter());
registerAutomationAdapter(new BilibiliAutomationAdapter());
registerAutomationAdapter(new XiaohongshuAutomationAdapter());
registerAutomationAdapter(new JuejinAutomationAdapter());
registerAutomationAdapter(new CsdnAutomationAdapter());
registerAutomationAdapter(new CnblogsAutomationAdapter());
registerAutomationAdapter(new WeiboAutomationAdapter());
registerAutomationAdapter(new ToutiaoAutomationAdapter());
registerAutomationAdapter(new DouyinAutomationAdapter());
registerAutomationAdapter(new KuaishouAutomationAdapter());
registerAutomationAdapter(new ShipinhaoAutomationAdapter());

export function registerAutomationAdapter(adapter: AutomationPlatformAdapter): void {
  adapters.set(adapter.platformId, adapter);
}

export function getAutomationAdapter(platformId: AutomationPlatformId): AutomationPlatformAdapter {
  const adapter = adapters.get(platformId);
  if (!adapter) throw new Error(`No automation adapter registered for ${platformId}`);
  return adapter;
}

export function listAutomationAdapters(): readonly AutomationPlatformAdapter[] {
  return [...adapters.values()];
}
