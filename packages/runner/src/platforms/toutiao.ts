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

// 头条号(第九平台):原生 Markdown 风格,标题 ≤64、标签 ≤5、必须有封面。
// 无官方开放内容发布 API,走网页登录态(cookie/assisted)发布。
const selectors: EditorSelectors = {
  version: "2026-08",
  title: ['[data-mpp-field="title"]', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
  body: ['[data-mpp-field="body"]', '.ProseMirror', 'div[contenteditable="true"]', 'textarea'],
  tags: ['[data-mpp-field="tags"]', 'input[placeholder*="标签"]', 'input[placeholder*="话题"]'],
  publish: ['[data-mpp-action="publish"]', 'button:has-text("发布")', 'button:has-text("发表")'],
  draft: ['[data-mpp-action="save-draft"]', 'button:has-text("存草稿")', 'button:has-text("草稿")'],
};

// PLAT-01:选择器契约校验(版本/字段完整性),非法配置在加载期即失败。
assertValidSelectors("toutiao", selectors);

export class ToutiaoAutomationAdapter implements AutomationPlatformAdapter {
  readonly platformId = "toutiao" as const;
  readonly editorUrl = "https://mp.toutiao.com/profile_v4/graphic/publish";

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
