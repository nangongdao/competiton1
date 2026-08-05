import { describe, it, expect } from "vitest";
import { IncrementalAdapter } from "../src/pipeline/incremental.js";

const MD = "# 测试标题\n\n正文内容,用于增量适配缓存测试。\n\n## 小节\n\n另一段正文。";
const PLATFORMS = ["wechat", "zhihu", "bilibili", "xiaohongshu"];

describe("IncrementalAdapter — 增量适配缓存", () => {
  it("相同源重复调用全部命中缓存,产物引用不变(零拷贝)", () => {
    const inc = new IncrementalAdapter();
    const first = inc.adapt(MD, PLATFORMS);
    const second = inc.adapt(MD, PLATFORMS);
    expect(first).toHaveLength(PLATFORMS.length);
    for (let i = 0; i < first.length; i++) {
      expect(second[i]!.cached).toBe(true);
      expect(second[i]!.output).toBe(first[i]!.output);
    }
  });

  it("源变化时全部重算(解析 + 序列化失效)", () => {
    const inc = new IncrementalAdapter();
    inc.adapt(MD, ["wechat"]);
    const next = inc.adapt(`${MD}\n\n新增一段。`, ["wechat"]);
    expect(next[0]!.cached).toBe(false);
  });

  it("仅单个平台配置变化时,只重算该平台,其余命中缓存", () => {
    const inc = new IncrementalAdapter();
    const first = inc.adapt(MD, PLATFORMS, { config: { wechat: { bannedWords: ["旧词"] } } });
    const wechatOutput = first.find((r) => r.platformId === "wechat")!.output;

    const second = inc.adapt(MD, PLATFORMS, { config: { wechat: { bannedWords: ["新词"] } } });
    for (const r of second) {
      if (r.platformId === "wechat") {
        expect(r.cached).toBe(false);
      } else {
        expect(r.cached).toBe(true);
        expect(r.output).toBe(first.find((x) => x.platformId === r.platformId)!.output);
      }
    }
    // 其它平台产物引用未被破坏。
    expect(second.find((r) => r.platformId === "zhihu")!.output).toBe(
      first.find((r) => r.platformId === "zhihu")!.output,
    );
    // wechat 因配置变化重算,产物引用变化(旧引用仍独立)。
    expect(second.find((r) => r.platformId === "wechat")!.output).not.toBe(wechatOutput);
  });

  it("only 覆盖层变化也按平台粒度失效", () => {
    const inc = new IncrementalAdapter();
    inc.adapt(MD, ["wechat", "zhihu"], { overrides: { wechat: { title: "原标题" } } });
    const second = inc.adapt(MD, ["wechat", "zhihu"], { overrides: { wechat: { title: "新标题" } } });
    expect(second.find((r) => r.platformId === "wechat")!.cached).toBe(false);
    expect(second.find((r) => r.platformId === "zhihu")!.cached).toBe(true);
  });

  it("未注册平台被跳过,不抛异常", () => {
    const inc = new IncrementalAdapter();
    expect(inc.adapt(MD, ["nonexistent"])).toEqual([]);
  });

  it("clear() 强制下次全量重算", () => {
    const inc = new IncrementalAdapter();
    inc.adapt(MD, ["wechat"]);
    inc.clear();
    const next = inc.adapt(MD, ["wechat"]);
    expect(next[0]!.cached).toBe(false);
  });
});
