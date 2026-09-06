import { describe, it, expect } from "vitest";
import { markdownToIR } from "../src/parse/md-to-ir.js";
import { getAdapter, listAdapters, listPlatformIds } from "../src/adapters/registry.js";
import { createMinimalTheme } from "../src/adapters/wechat/theme.js";
import { instructionsFor } from "../src/publish/instructions.js";

const SAMPLE = `# 一篇关于效率工具的分享

这是正文第一段,包含一个 [外部链接](https://example.com)。

## 小标题

- 要点一
- 要点二

| 平台 | 格式 |
| --- | --- |
| 公众号 | HTML |

\`\`\`ts
const x = 1;
\`\`\`

行内公式 $a^2+b^2=c^2$ 与块级:

$$\\int_0^1 x\\,dx$$

![配图](https://img.example.com/cover.png)
`;

function parse() {
  return markdownToIR(SAMPLE).document;
}

describe("适配器注册表", () => {
  it("注册了十二个内置平台(五平台 + CSDN/博客园 + 微博/头条/抖音/快手/视频号)", () => {
    expect(listPlatformIds().sort()).toEqual([
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
    expect(listAdapters()).toHaveLength(12);
  });
});

describe("公众号适配器", () => {
  it("产出全内联样式 HTML,无 class/无 style 块", () => {
    const a = getAdapter("wechat")!;
    const doc = a.preprocess(parse());
    const payload = a.serialize(doc);
    expect(payload.mime).toBe("text/html");
    expect(payload.content).toContain("style=");
    expect(payload.content).not.toContain("<style");
    expect(payload.content).not.toContain('class="');
  });

  it("外链已转脚注", () => {
    const a = getAdapter("wechat")!;
    const doc = a.preprocess(parse());
    const payload = a.serialize(doc);
    expect(payload.content).toContain("[1]");
    expect(payload.content).toContain("example.com");
  });

  it("标题截断到 64 字以内并保留", () => {
    const a = getAdapter("wechat")!;
    const payload = a.serialize(a.preprocess(parse()));
    expect(payload.title).toBe("一篇关于效率工具的分享");
  });
});

describe("知乎适配器", () => {
  it("公式转 equation 图片,保留外链", () => {
    const a = getAdapter("zhihu")!;
    const payload = a.serialize(a.preprocess(parse()));
    expect(payload.content).toContain("zhihu.com/equation");
    expect(payload.content).toContain("example.com"); // 外链保留
  });

  it("话题截断到 ≤3", () => {
    const a = getAdapter("zhihu")!;
    const doc = markdownToIR("# t\n\n正文").document;
    const payload = a.serialize(a.preprocess(doc), { tags: ["a", "b", "c", "d", "e"] });
    expect(payload.tags).toHaveLength(3);
  });
});

describe("B站适配器", () => {
  it("表格转图片,派生 category/tid/words", () => {
    const a = getAdapter("bilibili")!;
    const payload = a.serialize(a.preprocess(parse()), { tags: ["科技"] });
    expect(payload.content).not.toContain("<table"); // 表格已转图
    expect(payload.extra?.["category"]).toBe("科技");
    expect(payload.extra?.["tid"]).toBe(201);
    expect(typeof payload.extra?.["words"]).toBe("number");
  });
});

describe("小红书适配器", () => {
  it("产出纯文本 + #话题#,标题 ≤20 字", () => {
    const a = getAdapter("xiaohongshu")!;
    const payload = a.serialize(a.preprocess(parse()), { tags: ["效率", "工具"] });
    expect(payload.mime).toBe("text/plain");
    expect(payload.content).not.toContain("<");
    expect(payload.content).toContain("#效率#");
    expect([...payload.title].length).toBeLessThanOrEqual(20);
  });

  it("emoji 引导行存在", () => {
    const a = getAdapter("xiaohongshu")!;
    const payload = a.serialize(a.preprocess(parse()));
    expect(payload.content).toMatch(/[✨📌🔸]/u);
  });

  it("正文超 1000 字时标记 overflow", () => {
    const a = getAdapter("xiaohongshu")!;
    const long = "# 标题\n\n" + "内容很长。".repeat(300); // 远超 1000 字
    const doc = markdownToIR(long).document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.extra?.["overflow"]).toBe(true);
    expect([...payload.content].length).toBeLessThanOrEqual(1000);
  });
});

describe("掘金适配器(SDK-02 第五平台试点)", () => {
  it("产出原生 Markdown,标题/标签符合约束", () => {
    const a = getAdapter("juejin")!;
    const payload = a.serialize(a.preprocess(parse()));
    expect(payload.mime).toBe("text/markdown");
    expect(payload.content).toContain("# ");
    expect(payload.content).toContain("## ");
    expect(payload.content).toContain("- ");
    expect([...payload.title].length).toBeLessThanOrEqual(64);
    expect(payload.tags.length).toBeLessThanOrEqual(3);
  });

  it("代码块与表格保留原生 Markdown 语法", () => {
    const a = getAdapter("juejin")!;
    const doc = markdownToIR(`# 标题

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |`).document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.content).toContain("```ts");
    expect(payload.content).toContain("| A | B |");
  });

  it("公式保留 LaTeX 语法(原生支持)", () => {
    const a = getAdapter("juejin")!;
    const doc = markdownToIR("# 标题\n\n行内公式 $a^2$ 与块级 $$\\int x\\,dx$$").document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.content).toContain("$a^2$");
    // 块级公式被解析为 inlineMath,序列化输出单 $ 包裹(掘金编辑器可正常渲染 LaTeX)。
    expect(payload.content).toContain("$\\int x");
  });
});


describe("CSDN 适配器(官方 API 平台)", () => {
  it("产出原生 Markdown,分类/标签保留在 extra", () => {
    const a = getAdapter("csdn")!;
    const payload = a.serialize(a.preprocess(parse()), { category: "后端" });
    expect(payload.mime).toBe("text/markdown");
    expect(payload.content).toContain("# ");
    expect(payload.extra?.category).toBe("后端");
    expect(payload.tags.length).toBeLessThanOrEqual(5);
  });

  it("代码块与表格保留原生 Markdown 语法", () => {
    const a = getAdapter("csdn")!;
    const doc = markdownToIR(`# 标题

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |`).document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.content).toContain("```ts");
    expect(payload.content).toContain("| A | B |");
  });
});

describe("公众号主题", () => {
  it("未知标签返回空字符串", () => {
    const theme = createMinimalTheme();
    expect(theme.styleFor("nonexistent-tag")).toBe("");
  });
});

describe("instructionsFor", () => {
  it("已知平台返回指引", () => {
    expect(instructionsFor("wechat")).toHaveLength(4);
    expect(instructionsFor("wechat")[0]).toContain("模拟发布");
  });

  it("未知平台返回默认指引", () => {
    const result = instructionsFor("unknown-platform");
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("默认走模拟发布");
  });
});

describe("微博适配器(纯文本 + 话题)", () => {
  it("产出纯文本 + #话题#,标题 ≤30 字", () => {
    const a = getAdapter("weibo")!;
    const payload = a.serialize(a.preprocess(parse()), { tags: ["效率", "工具"] });
    expect(payload.mime).toBe("text/plain");
    expect(payload.content).toContain("#效率#");
    expect([...payload.title].length).toBeLessThanOrEqual(30);
    expect(payload.tags.length).toBeLessThanOrEqual(2);
  });

  it("正文超 2000 字时标记 overflow", () => {
    const a = getAdapter("weibo")!;
    const long = "# 标题\n\n" + "内容很长。".repeat(600);
    const doc = markdownToIR(long).document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.extra?.["overflow"]).toBe(true);
    expect([...payload.content].length).toBeLessThanOrEqual(2000);
  });
});

describe("头条号适配器(Markdown 原生)", () => {
  it("产出原生 Markdown,分类/标签保留在 extra", () => {
    const a = getAdapter("toutiao")!;
    const payload = a.serialize(a.preprocess(parse()), { category: "科技" });
    expect(payload.mime).toBe("text/markdown");
    expect(payload.content).toContain("# ");
    expect(payload.extra?.category).toBe("科技");
    expect(payload.tags.length).toBeLessThanOrEqual(5);
    expect([...payload.title].length).toBeLessThanOrEqual(64);
  });

  it("代码块与表格保留 Markdown 语法", () => {
    const a = getAdapter("toutiao")!;
    const doc = markdownToIR(`# 标题

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |`).document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.content).toContain("```ts");
    expect(payload.content).toContain("| A | B |");
  });
});

describe("短视频平台适配器(抖音/快手/视频号)", () => {
  const VIDEO_IDS = ["douyin", "kuaishou", "shipinhao"] as const;
  it.each(VIDEO_IDS)("%s 产出纯文本 + #话题#,标题/正文受限", (pid) => {
    const a = getAdapter(pid)!;
    const payload = a.serialize(a.preprocess(parse()), { tags: ["效率", "工具", "学习"] });
    expect(payload.mime).toBe("text/plain");
    expect(payload.content).toContain("#效率#");
    expect([...payload.title].length).toBeLessThanOrEqual(55);
    expect(payload.tags.length).toBeLessThanOrEqual(5);
  });

  it.each(VIDEO_IDS)("%s 超长正文被截断并标记 overflow", (pid) => {
    const a = getAdapter(pid)!;
    const long = "# 标题\n\n" + "内容很长。".repeat(400);
    const doc = markdownToIR(long).document;
    const payload = a.serialize(a.preprocess(doc));
    expect(payload.extra?.["overflow"]).toBe(true);
    expect([...payload.content].length).toBeLessThanOrEqual(1000);
  });
});
