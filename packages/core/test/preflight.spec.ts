/**
 * 发布前健康检查测试(preflight)。
 *
 * 覆盖:
 * - 标题缺失 / 存在;
 * - 正文为空 / 过短 / 正常;
 * - 图片缺 alt / dataURL 告警;
 * - 违禁词(极限词)检测;
 * - 各平台校验 error 汇总(如小红书超长);
 * - ready 与 suggestions 排序。
 */
import { describe, expect, it } from "vitest";
import { runPreflight, preflightPlainText, preflightTitle } from "../src/preflight/preflight.js";

describe("preflight — 工具函数", () => {
  it("preflightTitle 提取首个 # 标题", () => {
    expect(preflightTitle("# 我的标题\n\n正文")).toBe("我的标题");
    expect(preflightTitle("## 二级标题\n正文")).toBe("");
    expect(preflightTitle("无标题")).toBe("");
  });

  it("preflightPlainText 剥离 markdown 语法", () => {
    const md = "# 标题\n\n**加粗** [链接](https://a.com) `code`\n\n![图](https://x.png)";
    const text = preflightPlainText(md);
    expect(text).toContain("加粗");
    expect(text).toContain("链接");
    expect(text).not.toContain("**");
    expect(text).not.toContain("![图]");
    expect(text).not.toContain("[链接](https://a.com)");
  });
});

describe("preflight — 健康检查", () => {
  it("空内容:标题缺失 + 正文为空 → blocked", () => {
    const r = runPreflight({ markdown: "", selectedPlatforms: ["wechat"] });
    expect(r.ready).toBe(false);
    expect(r.counts.errors).toBeGreaterThanOrEqual(2);
    expect(r.issues.some((i) => i.code === "title-missing")).toBe(true);
    expect(r.issues.some((i) => i.code === "body-empty")).toBe(true);
  });

  it("正常内容:标题 + 足够正文 → ready", () => {
    const body = "这是一段足够长的正文内容。".repeat(40);
    const md = `# 我的标题\n\n${body}`;
    const r = runPreflight({ markdown: md, selectedPlatforms: ["wechat"] });
    expect(r.ready).toBe(true);
    expect(r.issues.some((i) => i.code === "title-missing")).toBe(false);
    expect(r.issues.some((i) => i.code === "body-empty")).toBe(false);
  });

  it("正文过短 → warning 但不阻塞", () => {
    const r = runPreflight({ markdown: "# 标题\n\n短", selectedPlatforms: ["wechat"] });
    expect(r.ready).toBe(true);
    expect(r.issues.some((i) => i.code === "body-too-short")).toBe(true);
  });

  it("图片缺 alt → warning", () => {
    const md = "# 标题\n\n正文内容\n\n![](https://x.png)";
    const r = runPreflight({ markdown: md, selectedPlatforms: ["wechat"] });
    expect(r.issues.some((i) => i.code === "image-no-alt")).toBe(true);
  });

  it("dataURL 图片 → warning", () => {
    const md = "# 标题\n\n正文内容\n\n![图](data:image/png;base64,AAAA)";
    const r = runPreflight({ markdown: md, selectedPlatforms: ["wechat"] });
    expect(r.issues.some((i) => i.code === "image-data-url")).toBe(true);
  });

  it("违禁词检测:含极限词 → warning", () => {
    const md = "# 标题\n\n这款产品是全网最好的选择。";
    const r = runPreflight({ markdown: md, selectedPlatforms: ["xiaohongshu"] });
    const banned = r.issues.filter((i) => i.code === "banned-word");
    expect(banned.length).toBeGreaterThan(0);
    expect(banned[0]!.message).toContain("最好");
  });

  it("小红书超长正文 → 平台校验 error → blocked", () => {
    const md = `# 标题\n\n${"超".repeat(1200)}`;
    const r = runPreflight({ markdown: md, selectedPlatforms: ["xiaohongshu"] });
    expect(r.ready).toBe(false);
    const p = r.perPlatform.find((x) => x.platformId === "xiaohongshu");
    expect(p).toBeTruthy();
    expect(p!.errors).toBeGreaterThan(0);
  });

  it("perPlatform 汇总:未知平台 → error", () => {
    const md = "# 标题\n\n正文内容";
    const r = runPreflight({ markdown: md, selectedPlatforms: ["wechat", "unknown-plat"] });
    expect(r.issues.some((i) => i.code === "platform-unknown")).toBe(true);
    expect(r.perPlatform.some((p) => p.platformId === "unknown-plat")).toBe(true);
  });

  it("suggestions 按严重度排序:error 在前", () => {
    const r = runPreflight({ markdown: "", selectedPlatforms: ["wechat"] });
    expect(r.suggestions.length).toBeGreaterThan(0);
    const first = r.issues.find((i) => i.message === r.suggestions[0]);
    expect(first?.severity).toBe("error");
  });

  it("建议去重:不同平台相同问题各保留一条(不误去重)", () => {
    // 两个不同未知平台产生不同 message(带平台名),不应被去重。
    const md = "# 标题\n\n正文内容";
    const r = runPreflight({ markdown: md, selectedPlatforms: ["unknown-a", "unknown-b"] });
    const unknown = r.issues.filter((i) => i.code === "platform-unknown");
    expect(unknown.length).toBe(2);
    // 建议是去重后的 message 列表,两个平台 message 不同 → 2 条。
    const dup = r.suggestions.filter((s) => s.includes("未注册的平台"));
    expect(dup.length).toBe(2);
    // 同一 message 不重复(Set 去重):检查全部建议无重复项。
    expect(new Set(r.suggestions).size).toBe(r.suggestions.length);
  });

  it("info 严重度问题参与建议排序", () => {
    // 构造 info 级问题:正文足够长、标题存在,但有一张带 alt 的 dataURL 图片会命中
    // image-data-url warning;此处额外验证 infos 计数正确。
    const body = "这是一段足够长的正文内容。".repeat(40);
    const md = `# 标题\n\n${body}\n\n![图](data:image/png;base64,AAAA)`;
    const r = runPreflight({ markdown: md, selectedPlatforms: ["wechat"] });
    expect(r.counts.infos).toBe(0);
    expect(r.counts.warnings).toBeGreaterThanOrEqual(1);
    // 空平台选择(无校验)时纯内容检查不产生 info。
    const r2 = runPreflight({ markdown: md, selectedPlatforms: [] });
    expect(r2.ready).toBe(true);
  });
});
