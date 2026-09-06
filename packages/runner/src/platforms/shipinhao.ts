import type { Page } from "playwright";
import type { AutomationPublishReceipt, AutomationPublishRequest } from "../types.js";
import {
  confirmContent,
  prepareEditor,
  submitEditor,
  verifyEditor,
  type EditorSelectors,
  assertValidSelectors,
} from "./common.js";
import type { AutomationPlatformAdapter } from "./types.js";

// 视频号(第十二平台):文案纯文本 + emoji + #话题#,标题 ≤55、文案 ≤1000、话题 ≤5、必须有封面。
// 无官方开放内容发布 API,走网页登录态(cookie/assisted)发布。
const selectors: EditorSelectors = {
  version: "2026-08",
  title: ['[data-mpp-field="title"]', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
  body: ['[data-mpp-field="body"]', 'textarea[placeholder*="说点什么"]', 'textarea', '[contenteditable="true"]'],
  tags: ['[data-mpp-field="tags"]', 'input[placeholder*="话题"]'],
  publish: ['[data-mpp-action="publish"]', 'button:has-text("发布")', 'button:has-text("发表")'],
  draft: ['[data-mpp-action="save-draft"]', 'button:has-text("存草稿")', 'button:has-text("草稿")'],
};

// PLAT-01:选择器契约校验(版本/字段完整性),非法配置在加载期即失败。
assertValidSelectors("shipinhao", selectors);

export class ShipinhaoAutomationAdapter implements AutomationPlatformAdapter {
  readonly platformId = "shipinhao" as const;
  readonly editorUrl = "https://channels.weixin.qq.com/platform/post/create";

  async prepare(page: Page, request: AutomationPublishRequest): Promise<void> {
    await prepareEditor(page, request, selectors);
  }

  confirm(_page: Page, request: AutomationPublishRequest): Promise<AutomationPublishReceipt | undefined> {
    return Promise.resolve(confirmContent(request));
  }

  submit(page: Page, request: AutomationPublishRequest): Promise<AutomationPublishReceipt> {
    return submitEditor(page, request, selectors);
  }

  verify(page: Page, request: AutomationPublishRequest, receipt: AutomationPublishReceipt): Promise<AutomationPublishReceipt> {
    return verifyEditor(page, request, selectors, receipt);
  }
}
