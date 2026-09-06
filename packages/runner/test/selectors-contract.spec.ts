/**
 * PLAT-01 选择器版本化与契约测试。
 *
 * 平台 DOM/规则频繁变化是最高风险(见路线图 §8)。本测试校验:
 * - 每个平台适配器已注册且编辑器 URL 合法;
 * - `assertValidSelectors` 契约校验本身:合法配置通过、缺失版本/字段/空选择器被拒绝;
 * - 各平台模块在加载期已调用 assertValidSelectors(import 即触发,非法配置直接抛错)。
 */
import { describe, expect, it } from "vitest";
import { listAutomationAdapters } from "../src/platforms/registry.js";
import { assertValidSelectors, type EditorSelectors } from "../src/platforms/common.js";

describe("PLAT-01 平台适配器注册契约", () => {
  const adapters = listAutomationAdapters();

  it("十二个平台适配器均已注册", () => {
    const ids = adapters.map((a) => a.platformId).sort();
    expect(ids).toEqual([
      "bilibili",
      "cnblogs",
      "csdn",
      "douyin",
      "juejin",
      "kuaishou",
      "shipinhao",
      "toutiao",
      "wechat",
      "weibo",
      "xiaohongshu",
      "zhihu",
    ]);
  });

  it("每个适配器暴露平台标识与合法编辑器 URL", () => {
    for (const adapter of adapters) {
      expect(adapter.platformId).toMatch(/^[a-z]+$/);
      expect(adapter.editorUrl).toMatch(/^https?:\/\//);
    }
  });

  it("每个平台编辑器 URL 唯一", () => {
    const urls = new Set(adapters.map((a) => a.editorUrl));
    expect(urls.size).toBe(adapters.length);
  });
});

describe("PLAT-01 assertValidSelectors 契约校验", () => {
  const valid: EditorSelectors = {
    version: "2026-08",
    title: ['[data-mpp-field="title"]', 'input[placeholder*="标题"]'],
    body: ['[data-mpp-field="body"]', '[contenteditable="true"]'],
    tags: ['[data-mpp-field="tags"]'],
    publish: ['[data-mpp-action="publish"]'],
    draft: ['[data-mpp-action="save-draft"]'],
  };

  it("合法配置通过", () => {
    expect(() => assertValidSelectors("test", valid)).not.toThrow();
  });

  it("缺失 version 被拒绝", () => {
    const { version: _v, ...rest } = valid;
    expect(() => assertValidSelectors("test", rest as EditorSelectors)).toThrow(/version/);
  });

  it("version 格式错误被拒绝", () => {
    expect(() => assertValidSelectors("test", { ...valid, version: "v1" })).toThrow(/YYYY-MM/);
  });

  it("缺失字段被拒绝", () => {
    const { draft: _d, ...rest } = valid;
    expect(() => assertValidSelectors("test", rest as EditorSelectors)).toThrow(/draft/);
  });

  it("空选择器被拒绝", () => {
    expect(() =>
      assertValidSelectors("test", { ...valid, tags: ['[data-mpp-field="tags"]', "  "] }),
    ).toThrow(/空选择器/);
  });

  it("title 首选非契约选择器被拒绝", () => {
    expect(() =>
      assertValidSelectors("test", { ...valid, title: ['input[placeholder*="标题"]'] }),
    ).toThrow(/data-mpp-field/);
  });
});
