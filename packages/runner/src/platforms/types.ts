import type { Page } from "playwright";
import type { AutomationPlatformId, AutomationPublishReceipt, AutomationPublishRequest } from "../types.js";

/**
 * 平台自动化适配器契约(RUN-01):
 * - `prepare`:打开编辑器、登录检测、页面就绪(可安全重试);
 * - `confirm`:full-auto 二次确认绑定内容摘要,篡改拒绝(RUN-01);
 * - `submit`:填写并提交(点击发布/保存),只产生"提交中"语义;
 * - `verify`:核验平台侧成功证据,给出 published/submitted/unknown(RUN-02)。
 */
export interface AutomationPlatformAdapter {
  readonly platformId: AutomationPlatformId;
  readonly editorUrl: string;
  /** 打开并准备编辑器页面(可安全重试)。 */
  prepare(page: Page, request: AutomationPublishRequest): Promise<void>;
  /** 二次确认:校验内容摘要与确认标记。 */
  confirm(page: Page, request: AutomationPublishRequest): Promise<AutomationPublishReceipt | undefined>;
  /** 提交:填写并点击保存/发布按钮。返回带证据的回执(不宣称 published)。 */
  submit(page: Page, request: AutomationPublishRequest): Promise<AutomationPublishReceipt>;
  /** 核验:检查平台侧成功证据,升级为 published/submitted/unknown。 */
  verify(page: Page, request: AutomationPublishRequest, receipt: AutomationPublishReceipt): Promise<AutomationPublishReceipt>;
}
