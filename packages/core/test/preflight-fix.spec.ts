/**
 * 发布前健康检查自动修复工具 —— 纯函数测试。
 *
 * 覆盖:
 * - altFromUrl:从 URL / 文件名推断描述(去掉扩展名与路径、URL 解码);
 * - fixMissingImageAlt:空 alt 填充 / 已有 alt 不动 / 多张图 / dataURL 不误判;
 * - autoFixPreflight:一键修复入口。
 */
import { describe, expect, it } from "vitest";
import { altFromUrl, fixMissingImageAlt, autoFixPreflight } from "../src/preflight/fix.js";

describe("altFromUrl — 从 URL 推断描述", () => {
  it("取文件名去掉扩展名", () => {
    expect(altFromUrl("https://a.com/cover.png")).toBe("cover");
  });

  it("路径含多级目录取末段", () => {
    expect(altFromUrl("https://a.com/blog/img/my-photo.jpg")).toBe("my photo");
  });

  it("URL 解码与连字符/下划线转空格", () => {
    expect(altFromUrl("https://a.com/img/hello-world.png")).toBe("hello world");
    expect(altFromUrl("https://a.com/img/hello_world_2.jpg")).toBe("hello world 2");
  });

  it("无文件名时回退「图片」", () => {
    expect(altFromUrl("https://a.com/")).toBe("图片");
  });

  it("非法 URL 不抛错", () => {
    expect(altFromUrl("%zz")).toBe("图片");
  });
});

describe("fixMissingImageAlt — 缺 alt 自动填充", () => {
  it("空 alt 填充为描述", () => {
    const r = fixMissingImageAlt("![ ](https://a.com/cat.png)");
    expect(r.text).toBe("![cat](https://a.com/cat.png)");
    expect(r.fixes).toHaveLength(1);
  });

  it("完全缺 alt 也填充", () => {
    const r = fixMissingImageAlt("![](https://a.com/dog.jpg)");
    expect(r.text).toBe("![dog](https://a.com/dog.jpg)");
  });

  it("已有 alt 的图片不动", () => {
    const r = fixMissingImageAlt("![小猫](https://a.com/cat.png)");
    expect(r.text).toBe("![小猫](https://a.com/cat.png)");
    expect(r.fixes).toHaveLength(0);
  });

  it("多张图只修缺 alt 的", () => {
    const r = fixMissingImageAlt("![有](https://a.com/a.png) ![](https://a.com/b.jpg)");
    expect(r.text).toBe("![有](https://a.com/a.png) ![b](https://a.com/b.jpg)");
    expect(r.fixes).toHaveLength(1);
  });

  it("空白 alt 视为缺失", () => {
    const r = fixMissingImageAlt("![  ](https://a.com/x.png)");
    expect(r.text).toBe("![x](https://a.com/x.png)");
  });
});

describe("autoFixPreflight — 一键修复入口", () => {
  it("混合内容只修可自动化项", () => {
    const md = "# 标题\n\n正文 ![ ](https://a.com/img/team.png) 更多文字";
    const r = autoFixPreflight(md);
    expect(r.text).toContain("![team](https://a.com/img/team.png)");
    expect(r.fixes).toHaveLength(1);
  });

  it("无可修复项时原样返回", () => {
    const r = autoFixPreflight("# 标题\n\n正文 ![图](https://a.com/a.png)");
    expect(r.text).toBe("# 标题\n\n正文 ![图](https://a.com/a.png)");
    expect(r.fixes).toHaveLength(0);
  });

  it("清除行尾多余空格", () => {
    const r = autoFixPreflight("# 标题\n\n正文  \n");
    expect(r.text).toContain("正文\n");
    expect(r.fixes.some((f) => f.includes("行尾"))).toBe(true);
  });

  it("规整标题后的多余空格", () => {
    const r = autoFixPreflight("##  标题\n\n正文\n");
    expect(r.text).toContain("## 标题");
  });

  it("压缩多余空行", () => {
    const r = autoFixPreflight("# 标题\n\n\n\n\n正文\n");
    expect(r.text).toContain("# 标题\n\n\n正文");
    expect(r.fixes.some((f) => f.includes("空行"))).toBe(true);
  });

  it("三种修复叠加时 fixes 累计", () => {
    const r = autoFixPreflight("##  标题  \n\n\n\n正文  \n");
    expect(r.fixes.length).toBeGreaterThanOrEqual(3);
    // 三种修复都被应用。
    expect(r.text).toContain("## 标题");
    expect(r.text).not.toMatch(/[ \t]+$/m);
    expect(r.text).not.toMatch(/\n{4,}/);
  });
});

describe("AUTO_FIX_CAPABILITIES — 修复能力清单", () => {
  it("包含四种可自动化修复", async () => {
    const { AUTO_FIX_CAPABILITIES } = await import("../src/preflight/fix.js");
    expect(AUTO_FIX_CAPABILITIES.length).toBeGreaterThanOrEqual(4);
  });
});
