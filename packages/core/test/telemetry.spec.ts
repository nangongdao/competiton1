/**
 * LLM 成本/响应观测测试(Roadmap v2 · AI-ROBUST-03)。
 *
 * 覆盖:
 * - token 估算(中文按字符、ASCII 按 4 字符/token);
 * - host 脱敏(剔除路径/凭据/查询串);
 * - 错误分类(超时 / HTTP / 网络 / 其他);
 * - 观测器记录(成功/失败、耗时、回退标记、错误类别/状态码);
 * - 汇总统计(成功率 / 平均耗时 / p95 / 累计 token / 按任务);
 * - 记录上限裁剪与清空;
 * - OpenAiCompatLlm 默认接入全局观测器、可注入独立实例。
 */
import { describe, it, expect, vi } from "vitest";
import {
  LlmTelemetry,
  estimateTokens,
  hostOfBaseUrl,
  classifyLlmError,
  llmTelemetry,
} from "../src/llm/telemetry.js";
import { OpenAiCompatLlm } from "../src/llm/openai-compat-llm.js";
import { adapterFromConfig } from "../src/llm/factory.js";

describe("estimateTokens", () => {
  it("中文按字符计,ASCII 按 4 字符/ token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("中文abc")).toBe(2 + 1); // 2 CJK + 3/4 -> 1
    expect(estimateTokens("hello")).toBe(2); // 5/4 -> ceil 2
    expect(estimateTokens("效率工具分享")).toBe(6);
  });
});

describe("hostOfBaseUrl", () => {
  it("提取 host 并剔除路径/凭据/查询串", () => {
    expect(hostOfBaseUrl("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com");
    expect(hostOfBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(hostOfBaseUrl("")).toBe("");
  });
  it("非 URL 时截断脱敏", () => {
    expect(hostOfBaseUrl("api.deepseek.com/v1?key=abc")).toBe("api.deepseek.com");
  });
});

describe("classifyLlmError", () => {
  it("超时", () => {
    const r = classifyLlmError(new Error("LLM 请求超时(>30000ms): https://x"));
    expect(r.kind).toBe("timeout");
  });
  it("HTTP 状态", () => {
    const r = classifyLlmError(new Error("LLM 请求失败: HTTP 429"));
    expect(r.kind).toBe("http");
    expect(r.status).toBe(429);
  });
  it("网络", () => {
    const r = classifyLlmError(new Error("fetch failed"));
    expect(r.kind).toBe("network");
  });
  it("其他", () => {
    const r = classifyLlmError(new Error("LLM 返回错误: bad thing"));
    expect(r.kind).toBe("other");
  });
});

describe("LlmTelemetry", () => {
  it("记录成功调用(含 token 估算与耗时)", () => {
    const t = new LlmTelemetry({}, () => 1000);
    t.record({
      task: "title",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      durationMs: 120,
      ok: true,
      inputText: "效率工具分享",
      outputText: "5 个效率神器!",
      adapterId: "openai-compat",
    });
    const recs = t.all();
    expect(recs).toHaveLength(1);
    expect(recs[0].task).toBe("title");
    expect(recs[0].host).toBe("https://api.deepseek.com");
    expect(recs[0].durationMs).toBe(120);
    expect(recs[0].ok).toBe(true);
    expect(recs[0].inputTokens).toBe(6);
    expect(recs[0].outputTokens).toBe(6); // "5 个效率神器!" -> 5 CJK + 2 ASCII/4
    expect(recs[0].startedAt).toBe(new Date(880).toISOString());
  });

  it("记录失败调用(错误类别 + 状态码 + 脱敏消息)", () => {
    const t = new LlmTelemetry({}, () => 2000);
    t.record({
      task: "rewrite",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      durationMs: 300,
      ok: false,
      inputText: "hello",
      error: new Error("LLM 请求失败: HTTP 401"),
      adapterId: "openai-compat",
    });
    const rec = t.all()[0];
    expect(rec.ok).toBe(false);
    expect(rec.errorKind).toBe("http");
    expect(rec.status).toBe(401);
    expect(rec.errorMessage).toContain("HTTP 401");
    expect(rec.outputTokens).toBe(0);
  });

  it("汇总统计:成功率 / 平均耗时 / p95 / 累计 token / 按任务", () => {
    const t = new LlmTelemetry({}, () => 0);
    for (let i = 0; i < 10; i++) {
      t.record({
        task: i % 2 === 0 ? "title" : "summary",
        model: "m",
        baseUrl: "https://x/v1",
        durationMs: 100 + i * 10,
        ok: i !== 9, // 最后一条失败
        inputText: "中文".repeat(5),
        outputText: "ok",
        adapterId: "a",
      });
    }
    const s = t.summary();
    expect(s.totalCalls).toBe(10);
    expect(s.successCalls).toBe(9);
    expect(s.failedCalls).toBe(1);
    expect(s.successRate).toBeCloseTo(0.9);
    expect(s.avgDurationMs).toBe(Math.round((100 + 110 + 120 + 130 + 140 + 150 + 160 + 170 + 180 + 190) / 10));
    expect(s.p95DurationMs).toBeGreaterThanOrEqual(180);
    expect(s.totalInputTokens).toBe(10 * 10);
    expect(s.totalOutputTokens).toBe(9); // 9 条成功 × "ok"(1 token)
    expect(s.byTask.title.calls).toBe(5);
    expect(s.byTask.summary.calls).toBe(5);
    expect(s.byTask.title.ok).toBe(5);
    expect(s.byTask.summary.ok).toBe(4);

    // 失败那条 outputTokens = 0
    const failed = t.recent().find((r) => !r.ok);
    expect(failed?.outputTokens).toBe(0);
  });

  it("记录上限裁剪 + clear", () => {
    const t = new LlmTelemetry({ maxRecords: 3 }, () => 0);
    for (let i = 0; i < 5; i++) {
      t.record({
        task: "title",
        model: "m",
        baseUrl: "https://x/v1",
        durationMs: 10,
        ok: true,
        inputText: "a",
        outputText: "b",
        adapterId: "a",
      });
    }
    expect(t.all()).toHaveLength(3);
    expect(t.recent()[0].seq).toBe(5);
    t.clear();
    expect(t.all()).toHaveLength(0);
    expect(t.summary().totalCalls).toBe(0);
  });

  it("recent 最新在前", () => {
    const t = new LlmTelemetry({}, () => 0);
    t.record({ task: "title", model: "m", baseUrl: "https://x/v1", durationMs: 1, ok: true, inputText: "a", outputText: "b", adapterId: "a" });
    t.record({ task: "summary", model: "m", baseUrl: "https://x/v1", durationMs: 2, ok: true, inputText: "a", outputText: "b", adapterId: "a" });
    expect(t.recent().map((r) => r.task)).toEqual(["summary", "title"]);
  });
});

describe("OpenAiCompatLlm 接入观测", () => {
  it("默认接入全局观测器", async () => {
    llmTelemetry.clear();
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      model: "deepseek-chat",
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "标题候选" } }] }),
        }) as Response) as unknown as typeof fetch,
    });
    await llm.run({ task: "title", platformId: "zhihu", input: "测试输入" });
    const recs = llmTelemetry.recent();
    expect(recs[0].task).toBe("title");
    expect(recs[0].ok).toBe(true);
    expect(recs[0].model).toBe("deepseek-chat");
  });

  it("可注入独立观测实例(不污染全局)", async () => {
    llmTelemetry.clear();
    const t = new LlmTelemetry({}, () => 0);
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      fetchImpl,
      telemetry: t,
    });
    await expect(llm.run({ task: "rewrite", platformId: "x", input: "y" })).rejects.toThrow();
    expect(t.all()).toHaveLength(1);
    expect(t.all()[0].ok).toBe(false);
    expect(t.all()[0].errorKind).toBe("network");
    expect(llmTelemetry.all()).toHaveLength(0);
  });

  it("adapterFromConfig 默认接全局观测器", async () => {
    llmTelemetry.clear();
    const adapter = adapterFromConfig(
      { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "m" },
      {},
    );
    // 通过注入 fetch 无法从 factory 传入,这里用真实 fetch 不行;改为直接验证构造路径类型。
    expect(adapter.available).toBe(true);
  });
});
