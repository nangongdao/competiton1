import { describe, it, expect, beforeEach } from "vitest";
import { getSelectors, applySelectorOverride, resetSelectors, DEFAULT_SELECTORS } from "../src/content/selectors.js";

describe("平台选择器外置 + 远程覆盖", () => {
  beforeEach(() => resetSelectors());

  it("默认返回内置选择器", () => {
    expect(getSelectors("wechat").editable).toEqual(DEFAULT_SELECTORS.wechat!.editable);
    expect(getSelectors("xiaohongshu").textarea).toEqual(DEFAULT_SELECTORS.xiaohongshu!.textarea);
  });

  it("掘金/CSDN 已接入内容脚本注入", () => {
    expect(getSelectors("juejin").textarea).toEqual(DEFAULT_SELECTORS.juejin!.textarea);
    expect(getSelectors("csdn").textarea).toEqual(DEFAULT_SELECTORS.csdn!.textarea);
  });

  it("未知平台返回空配置", () => {
    expect(getSelectors("unknown")).toEqual({});
  });

  it("override 覆盖指定平台,其余保持默认", () => {
    applySelectorOverride(JSON.stringify({ zhihu: { editable: [".new-zhihu-editor"] } }));
    expect(getSelectors("zhihu").editable).toEqual([".new-zhihu-editor"]);
    // 未覆盖的平台保持默认。
    expect(getSelectors("wechat").editable).toEqual(DEFAULT_SELECTORS.wechat!.editable);
  });

  it("损坏的 override 被忽略,保持默认", () => {
    applySelectorOverride("不是合法 JSON {");
    expect(getSelectors("wechat").editable).toEqual(DEFAULT_SELECTORS.wechat!.editable);
  });

  it("空 override 不改变现有配置", () => {
    applySelectorOverride(undefined);
    expect(getSelectors("bilibili").editable).toEqual(DEFAULT_SELECTORS.bilibili!.editable);
  });
});
