/**
 * v11 Part 2 · 合规与安全审查纯函数测试(COMPLIANCE-01)。
 */
import { describe, expect, it } from "vitest";
import {
  scanCompliance,
  scanComplianceText,
  HIGH_RISK_WORDS,
  MEDIUM_RISK_WORDS,
} from "../src/compliance/compliance.js";

describe("compliance — COMPLIANCE-01 发布前合规审查", () => {
  it("命中极限词为 high 并给出替换建议", () => {
    const issues = scanComplianceText("这是全国最好的产品,100% 有效");
    const best = issues.find((i) => i.match === "最好");
    expect(best?.severity).toBe("high");
    expect(best?.suggestion).toBeTruthy();
    const pct = issues.find((i) => i.match === "100%");
    expect(pct?.severity).toBe("high");
  });

  it("命中敏感话题词为 medium", () => {
    const issues = scanComplianceText("这款理财稳赚不赔,收益率超高");
    expect(issues.some((i) => i.severity === "medium")).toBe(true);
  });

  it("检测风险链接", () => {
    const issues = scanComplianceText("详情见 http://t.cn/abc 或 http://192.168.1.1/x");
    expect(issues.some((i) => i.kind === "risky-link")).toBe(true);
  });

  it("长文缺来源声明给出版权提示", () => {
    const long = "这是很长的一段二次创作内容,超过两百字会触发版权声明检查,它包含了足够的长度来触发这个低风险提示,请确认是否需要补充。".repeat(4);
    const issues = scanComplianceText(long);
    expect(issues.some((i) => i.kind === "copyright")).toBe(true);
  });

  it("整体报告 blocked/verdict 判定", () => {
    const r = scanCompliance("国家级第一产品", "正文没有任何问题");
    expect(r.blocked).toBe(true);
    expect(r.verdict).toBe("blocked");
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("图片缺 alt 提示", () => {
    const r = scanCompliance("正常标题", "正文 ![alt](https://a.b/c.png) 和 ![](https://a.b/d.png)");
    const img = r.issues.find((i) => i.kind === "image-risk");
    expect(img).toBeTruthy();
    expect(img?.match).toContain("缺 alt");
  });

  it("干净内容为 ok", () => {
    const r = scanCompliance("今天天气不错", "我们去公园散步,感受自然。");
    expect(r.verdict).toBe("ok");
    expect(r.blocked).toBe(false);
  });

  it("词表非空且可扩展", () => {
    expect(HIGH_RISK_WORDS.length).toBeGreaterThan(0);
    expect(MEDIUM_RISK_WORDS.length).toBeGreaterThan(0);
    const issues = scanComplianceText("自定义违规词", { extraBannedWords: ["自定义违规词"] });
    expect(issues.some((i) => i.match === "自定义违规词")).toBe(true);
  });
});
