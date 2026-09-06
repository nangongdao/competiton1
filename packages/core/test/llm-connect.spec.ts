/**
 * AI 连接中心 —— core LLM 层测试。
 *
 * 覆盖:
 * - presets:预设注册表/查询/由预设构造配置
 * - config:校验/归一化/剔除 apiKey/是否就绪
 * - connectivity:连通性检测(未配置/成功/鉴权失败/超时/网络错误)
 * - retry:指数退避重试/Retry-After/不可重试错误不上抛
 * - fallback:多模型回退/业务错误不上抛/观测标记
 * - openai-compat:任务级参数透传/超时
 * - factory:由配置构造适配器
 */
import { describe, expect, it, vi } from "vitest";
import {
  listLlmPresets,
  getLlmPreset,
  configFromPreset,
  validateLlmConfig,
  normalizeLlmConfig,
  stripApiKey,
  isConfigReady,
  testLlmConnection,
  LlmRetry,
  isRetryableLlmError,
  backoffDelay,
  FallbackLlm,
  adapterFromConfig,
  fallbackFromConfigs,
  OpenAiCompatLlm,
  NoopLlm,
} from "../src/index.js";
import type { LlmAdapter } from "../src/llm/types.js";

describe("presets — LLM 预设注册表", () => {
  it("包含主流服务商预设且字段完整", () => {
    const presets = listLlmPresets();
    expect(presets.length).toBeGreaterThanOrEqual(7);
    const ids = presets.map((p) => p.id);
    for (const expectId of ["deepseek", "openai", "moonshot", "qwen", "glm", "ollama", "vllm"]) {
      expect(ids).toContain(expectId);
    }
    for (const p of presets) {
      expect(p.name).toBeTruthy();
      expect(p.baseUrl).toMatch(/^https?:\/\//);
      expect(p.defaultModel).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("getLlmPreset 按 id 查询,不存在返回 undefined", () => {
    expect(getLlmPreset("deepseek")?.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(getLlmPreset("nope")).toBeUndefined();
  });

  it("configFromPreset 生成可编辑配置且 apiKey 为空", () => {
    const preset = getLlmPreset("deepseek")!;
    const cfg = configFromPreset(preset);
    expect(cfg.baseUrl).toBe(preset.baseUrl);
    expect(cfg.model).toBe(preset.defaultModel);
    expect(cfg.apiKey).toBe("");
    expect(cfg.presetId).toBe("deepseek");
    expect(cfg.id).toMatch(/^custom-deepseek-/);
  });
});

describe("config — LLM 配置契约", () => {
  it("validateLlmConfig 校验必填字段与基址格式", () => {
    expect(validateLlmConfig({}).ok).toBe(false);
    expect(validateLlmConfig({ name: "a", baseUrl: "not-a-url", model: "m" }).ok).toBe(false);
    expect(
      validateLlmConfig({ name: "a", baseUrl: "https://api.x.com/v1", model: "m" }).ok,
    ).toBe(true);
    expect(validateLlmConfig({ name: "a", baseUrl: "ftp://x/v1", model: "m" }).ok).toBe(false);
  });

  it("normalizeLlmConfig 补齐缺省并去除尾部斜杠", () => {
    const c = normalizeLlmConfig({ name: " t ", baseUrl: "https://api.x.com/v1/", model: " m " });
    expect(c.name).toBe("t");
    expect(c.baseUrl).toBe("https://api.x.com/v1");
    expect(c.model).toBe("m");
    expect(c.temperature).toBe(0.7);
    expect(c.maxTokens).toBe(1024);
    expect(c.timeoutMs).toBe(30000);
  });

  it("stripApiKey 移除密钥(符合 SEC-04)", () => {
    const rest = stripApiKey({ id: "1", name: "n", baseUrl: "b", apiKey: "sk-secret", model: "m" });
    expect("apiKey" in rest).toBe(false);
    expect((rest as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it("isConfigReady 判断是否可发起请求", () => {
    expect(isConfigReady({ baseUrl: "b", apiKey: "", model: "m" })).toBe(false);
    expect(isConfigReady({ baseUrl: "b", apiKey: "k", model: "m" })).toBe(true);
  });
});

describe("connectivity — 连通性检测", () => {
  function res(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
  }

  it("未配置返回 not-configured", async () => {
    const r = await testLlmConnection({ baseUrl: "", apiKey: "", model: "" });
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("not-configured");
  });

  it("GET /models 200 → 成功并返回模型", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/models");
      return res(200);
    }) as unknown as typeof fetch;
    const r = await testLlmConnection(
      { baseUrl: "https://api.x.com/v1", apiKey: "k", model: "m" },
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(r.model).toBe("m");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("GET /models 401 → 鉴权失败", async () => {
    const fetchImpl = vi.fn(async () => res(401)) as unknown as typeof fetch;
    const r = await testLlmConnection(
      { baseUrl: "https://api.x.com/v1", apiKey: "bad", model: "m" },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("http");
    expect(r.status).toBe(401);
  });

  it("GET /models 404 时回退到 chat completion 探测", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/models")) return res(404);
      return res(200);
    }) as unknown as typeof fetch;
    const r = await testLlmConnection(
      { baseUrl: "https://api.x.com/v1", apiKey: "k", model: "m" },
      { fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("chat completion 401 → 提示检查模型与 key", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/models")) return res(404);
      return res(401);
    }) as unknown as typeof fetch;
    const r = await testLlmConnection(
      { baseUrl: "https://api.x.com/v1", apiKey: "bad", model: "m" },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("HTTP 401");
  });

  it("超时 → errorKind=timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;
    const r = await testLlmConnection(
      { baseUrl: "https://api.x.com/v1", apiKey: "k", model: "m", timeoutMs: 5 },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("timeout");
  });
});

describe("retry — 指数退避重试", () => {
  it("isRetryableLlmError 识别 429/5xx/超时/网络错误", () => {
    expect(isRetryableLlmError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isRetryableLlmError(new Error("HTTP 503 Service Unavailable"))).toBe(true);
    expect(isRetryableLlmError(new Error("HTTP 400 Bad Request"))).toBe(false);
    expect(isRetryableLlmError(new Error("LLM 请求超时"))).toBe(true);
    expect(isRetryableLlmError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableLlmError(new Error("HTTP 200"))).toBe(false);
  });

  it("backoffDelay 指数增长(禁用抖动验证单调性)", () => {
    expect(backoffDelay(1, 300)).toBeGreaterThanOrEqual(240);
    expect(backoffDelay(1, 300)).toBeLessThanOrEqual(360);
    // attempt 2 基数为 600
    expect(backoffDelay(2, 300)).toBeGreaterThanOrEqual(480);
    expect(backoffDelay(2, 300)).toBeLessThanOrEqual(720);
  });

  it("backoffDelay 尊重 Retry-After(秒)", () => {
    const d = backoffDelay(1, 300, new Error("HTTP 429 Retry-After: 2"));
    expect(d).toBe(2000);
  });

  it("瞬时错误重试后成功", async () => {
    const inner: LlmAdapter = {
      id: "inner",
      available: true,
      run: vi
        .fn()
        .mockRejectedValueOnce(new Error("HTTP 503"))
        .mockResolvedValueOnce("ok"),
    };
    const retried = new LlmRetry(inner, { maxRetries: 2, baseDelayMs: 1, sleep: async () => {} });
    const out = await retried.run({ task: "title", platformId: "x", input: "y" });
    expect(out).toBe("ok");
    expect(inner.run).toHaveBeenCalledTimes(2);
  });

  it("不可重试错误不重试", async () => {
    const inner: LlmAdapter = {
      id: "inner",
      available: true,
      run: vi.fn().mockRejectedValue(new Error("HTTP 400")),
    };
    const retried = new LlmRetry(inner, { maxRetries: 2, sleep: async () => {} });
    await expect(retried.run({ task: "title", platformId: "x", input: "y" })).rejects.toThrow("HTTP 400");
    expect(inner.run).toHaveBeenCalledTimes(1);
  });

  it("重试耗尽后抛出最后一次错误", async () => {
    const inner: LlmAdapter = {
      id: "inner",
      available: true,
      run: vi.fn().mockRejectedValue(new Error("HTTP 503")),
    };
    const retried = new LlmRetry(inner, { maxRetries: 1, baseDelayMs: 1, sleep: async () => {} });
    await expect(retried.run({ task: "title", platformId: "x", input: "y" })).rejects.toThrow("HTTP 503");
    expect(inner.run).toHaveBeenCalledTimes(2);
  });
});

describe("fallback — 多模型回退", () => {
  function stub(id: string, available = true): LlmAdapter {
    return {
      id,
      available,
      run: vi.fn().mockResolvedValue(`from-${id}`),
    } as unknown as LlmAdapter;
  }

  it("主配置可用时直接成功且无回退标记", async () => {
    const primary = stub("primary");
    const fb = new FallbackLlm({ primary, fallbacks: [stub("backup")] });
    const out = await fb.run({ task: "title", platformId: "x", input: "y" });
    expect(out).toBe("from-primary");
    expect(fb.lastUsedFallback).toBe(false);
    expect(fb.lastUsedAdapterId).toBe("primary");
  });

  it("主配置可重试错误自动回退备用", async () => {
    const primary: LlmAdapter = {
      id: "primary",
      available: true,
      run: vi.fn().mockRejectedValue(new Error("HTTP 429")),
    };
    const backup = stub("backup");
    const fb = new FallbackLlm({ primary, fallbacks: [backup] });
    const out = await fb.run({ task: "title", platformId: "x", input: "y" });
    expect(out).toBe("from-backup");
    expect(fb.lastUsedFallback).toBe(true);
    expect(fb.fallbackCount).toBe(1);
  });

  it("业务错误(4xx)不上抛不回退", async () => {
    const primary: LlmAdapter = {
      id: "primary",
      available: true,
      run: vi.fn().mockRejectedValue(new Error("HTTP 400")),
    };
    const backup = stub("backup");
    const fb = new FallbackLlm({ primary, fallbacks: [backup] });
    await expect(fb.run({ task: "title", platformId: "x", input: "y" })).rejects.toThrow("HTTP 400");
    expect(backup.run).not.toHaveBeenCalled();
  });

  it("全部失败时抛出最后错误", async () => {
    const primary: LlmAdapter = {
      id: "primary",
      available: true,
      run: vi.fn().mockRejectedValue(new Error("HTTP 503")),
    };
    const backup: LlmAdapter = {
      id: "backup",
      available: true,
      run: vi.fn().mockRejectedValue(new Error("HTTP 503")),
    };
    const fb = new FallbackLlm({ primary, fallbacks: [backup] });
    await expect(fb.run({ task: "title", platformId: "x", input: "y" })).rejects.toThrow("HTTP 503");
  });

  it("无可用配置时 available=false", () => {
    const fb = new FallbackLlm({ primary: new NoopLlm(), fallbacks: [new NoopLlm()] });
    expect(fb.available).toBe(false);
  });
});

describe("openai-compat — 任务级参数与超时", () => {
  it("任务级 temperature/maxTokens/systemPrompt 透传", async () => {
    let captured: any;
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://api.x.com/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hi" } }] }) } as Response;
      }) as unknown as typeof fetch,
    });
    const out = await llm.run({
      task: "title",
      platformId: "x",
      input: "y",
      temperature: 0.2,
      maxTokens: 64,
      systemPrompt: "自定义提示",
    });
    expect(out).toBe("hi");
    expect(captured.temperature).toBe(0.2);
    expect(captured.max_tokens).toBe(64);
    expect(captured.messages[0].content).toBe("自定义提示");
  });

  it("超时抛错并带超时描述", async () => {
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://api.x.com/v1",
      apiKey: "k",
      model: "m",
      timeoutMs: 5,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })) as unknown as typeof fetch,
    });
    await expect(llm.run({ task: "title", platformId: "x", input: "y" })).rejects.toThrow("超时");
  });
});

describe("factory — 配置构造适配器", () => {
  it("adapterFromConfig 构造 OpenAiCompatLlm 并归一化", async () => {
    const adapter = adapterFromConfig({ baseUrl: "https://api.x.com/v1/", apiKey: "k", model: "m" });
    expect(adapter.available).toBe(true);
    expect(adapter.id).toBe("openai-compat");
  });

  it("adapterFromConfig 可叠加重试", () => {
    const adapter = adapterFromConfig({ baseUrl: "https://api.x.com/v1", apiKey: "k", model: "m" }, { retry: { maxRetries: 3 } });
    expect(adapter.id).toBe("llm-retry");
  });

  it("fallbackFromConfigs 单配置退化为直连适配器", () => {
    const adapter = fallbackFromConfigs({ baseUrl: "https://api.x.com/v1", apiKey: "k", model: "m" }, []);
    expect(adapter.id).toBe("openai-compat");
  });

  it("fallbackFromConfigs 多配置构造回退适配器", async () => {
    const adapter = fallbackFromConfigs(
      { baseUrl: "https://api.x.com/v1", apiKey: "k1", model: "m1" },
      [{ baseUrl: "https://api.y.com/v1", apiKey: "k2", model: "m2" }],
    );
    expect(adapter.id).toBe("llm-fallback");
    expect(adapter.available).toBe(true);
  });
});
