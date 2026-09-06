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

const selectors: EditorSelectors = {
  version: "2026-08",
  title: ['[data-mpp-field="title"]', 'input[id*="Title" i]', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
  body: ['[data-mpp-field="body"]', 'div[contenteditable="true"]', 'textarea[class*="editor"]', 'textarea'],
  tags: ['[data-mpp-field="tags"]', 'input[placeholder*="标签"]'],
  publish: ['[data-mpp-action="publish"]', 'button:has-text("发布")'],
  draft: ['[data-mpp-action="save-draft"]', 'button:has-text("保存草稿")', 'button:has-text("存草稿")', 'button:has-text("草稿")'],
};

// PLAT-01:选择器契约校验(版本/字段完整性),非法配置在加载期即失败。
assertValidSelectors("cnblogs", selectors);

/** 博客园(第七平台试点)自动化适配器 —— 原生 Markdown 随笔编辑器。 */
export class CnblogsAutomationAdapter implements AutomationPlatformAdapter {
  readonly platformId = "cnblogs" as const;
  readonly editorUrl = "https://i.cnblogs.com/posts/edit";

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
