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

// 微博(第八平台):纯文本 + emoji + #话题#,正文上限 2000 字、标题 ≤30、话题 ≤2。
// 无官方发布 API,走网页登录态(cookie/assisted)发布。
const selectors: EditorSelectors = {
  version: "2026-08",
  title: ['[data-mpp-field="title"]', 'textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
  body: ['[data-mpp-field="body"]', 'textarea[placeholder*="分享"]', '[contenteditable="true"]'],
  tags: ['[data-mpp-field="tags"]', 'input[placeholder*="话题"]'],
  publish: ['[data-mpp-action="publish"]', 'button:has-text("发布")'],
  draft: ['[data-mpp-action="save-draft"]', 'button:has-text("存草稿")', 'button:has-text("草稿")'],
};

// PLAT-01:选择器契约校验(版本/字段完整性),非法配置在加载期即失败。
assertValidSelectors("weibo", selectors);

export class WeiboAutomationAdapter implements AutomationPlatformAdapter {
  readonly platformId = "weibo" as const;
  readonly editorUrl = "https://weibo.com/compose/post";

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
