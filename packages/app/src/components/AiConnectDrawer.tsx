/**
 * AI 连接中心抽屉(Roadmap v2 Phase A/B)。
 *
 * 能力:
 * - **预设一键填充**:DeepSeek / OpenAI / Kimi / 通义 / GLM / Ollama / vLLM 等预设,
 *   点击即填入 baseUrl + 默认模型(apiKey 需用户填写,绝不落盘预设)。
 * - **多配置管理**:保存多套命名配置,一键切换当前生效、删除、设为默认。
 * - **连通性检测**:真实调用 API(先 /models,回退 chat completion),展示 成功/失败原因/延迟。
 * - **任务级参数**:temperature / maxTokens / 系统提示词 可编辑并随配置保存。
 *
 * 安全:apiKey 遵循 SEC-04(默认仅会话保存,持久化需用户在设置中显式开启);
 * 配置持久化时剔除 apiKey;错误信息不包含密钥。
 */
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Plug,
  Loader2,
  CheckCircle2,
  XCircle,
  KeyRound,
  Info,
  X,
  Plus,
  Trash2,
  RefreshCw,
  Check,
  Layers,
} from "lucide-react";
import { listLlmPresets, testLlmConnection, validateLlmConfig } from "@mpp/core";
import type { LlmConfig } from "@mpp/core";
import { useStore } from "../state/store.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 编辑中的草稿配置(基于某条已保存配置或新配置)。 */
interface DraftConfig {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: string;
  maxTokens: string;
  systemPrompt: string;
  timeoutMs: string;
}

/** 连接检测状态。 */
interface TestState {
  checking: boolean;
  result?: { ok: boolean; message: string; latencyMs?: number; errorKind?: string };
}

const PRESET_DEFAULT: DraftConfig = {
  id: null,
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: "0.7",
  maxTokens: "1024",
  systemPrompt: "",
  timeoutMs: "30000",
};

/** AI 连接中心抽屉(懒加载组件)。 */
export function AiConnectDrawer({ open, onOpenChange }: Props) {
  const llmConfigs = useStore((s) => s.llmConfigs);
  const activeLlmConfigId = useStore((s) => s.activeLlmConfigId);
  const llm = useStore((s) => s.llm);
  const persistLlmKey = useStore((s) => s.persistLlmKey);
  const saveLlmConfig = useStore((s) => s.saveLlmConfig);
  const deleteLlmConfig = useStore((s) => s.deleteLlmConfig);
  const activateLlmConfig = useStore((s) => s.activateLlmConfig);
  const applyLlmPreset = useStore((s) => s.applyLlmPreset);

  const presets = useMemo(() => listLlmPresets(), []);
  const [draft, setDraft] = useState<DraftConfig>(PRESET_DEFAULT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>({ checking: false });
  const [savedMsg, setSavedMsg] = useState("");
  const [presetSource, setPresetSource] = useState<string | null>(null);

  // 打开时重置编辑表单。
  useEffect(() => {
    if (open) {
      setDraft(PRESET_DEFAULT);
      setEditingId(null);
      setTestState({ checking: false });
      setSavedMsg("");
      setPresetSource(null);
    }
  }, [open]);

  /** 立即使用预设创建并激活配置(快速连接,key 留空由用户填)。 */
  const quickApplyPreset = (presetId: string) => {
    applyLlmPreset(presetId);
    setSavedMsg("已创建预设配置并设为当前,请到表单中填写 API Key");
    setPresetSource(presets.find((p) => p.id === presetId)?.name ?? null);
    const cfg = useStore.getState().llmConfigs.find((c) => c.presetId === presetId);
    if (cfg) editConfig(cfg);
  };

  /** 新建配置。 */
  const startNew = () => {
    setDraft(PRESET_DEFAULT);
    setEditingId(null);
    setSavedMsg("");
    setPresetSource(null);
  };

  /** 编辑已有配置。 */
  const editConfig = (cfg: LlmConfig) => {
    setEditingId(cfg.id);
    setDraft({
      id: cfg.id,
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey ?? "",
      model: cfg.model,
      temperature: String(cfg.temperature ?? 0.7),
      maxTokens: String(cfg.maxTokens ?? 1024),
      systemPrompt: cfg.systemPrompt ?? "",
      timeoutMs: String(cfg.timeoutMs ?? 30000),
    });
    setPresetSource(cfg.presetId ? presets.find((p) => p.id === cfg.presetId)?.name ?? null : null);
    setSavedMsg("");
  };

  /** 保存当前草稿为配置。 */
  const save = () => {
    const validation = validateLlmConfig({
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
    });
    if (!validation.ok) {
      setTestState({ checking: false, result: { ok: false, message: validation.errors.join("; "), errorKind: "bad-config" } });
      return;
    }
    const id = saveLlmConfig({
      id: editingId ?? undefined,
      name: draft.name,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      model: draft.model,
      temperature: Number.parseFloat(draft.temperature) || 0.7,
      maxTokens: Number.parseInt(draft.maxTokens, 10) || 1024,
      systemPrompt: draft.systemPrompt,
      timeoutMs: Number.parseInt(draft.timeoutMs, 10) || 30000,
    });
    setEditingId(id);
    setDraft((d) => ({ ...d, id }));
    setSavedMsg("已保存并设为当前生效配置");
    setTestState({ checking: false });
  };

  /** 连通性检测。 */
  const runTest = async () => {
    if (!draft.baseUrl || !draft.model || !draft.apiKey) {
      setTestState({ checking: false, result: { ok: false, message: "请先填写 API 基址、模型与 API Key", errorKind: "not-configured" } });
      return;
    }
    setTestState({ checking: true });
    const result = await testLlmConnection({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      model: draft.model,
      timeoutMs: Number.parseInt(draft.timeoutMs, 10) || 30000,
    });
    setTestState({ checking: false, result: { ok: result.ok, message: result.message, latencyMs: result.latencyMs, errorKind: result.errorKind } });
  };

  /** 测试当前生效配置(不进入表单)。 */
  const testActive = async () => {
    if (!llm.baseUrl || !llm.apiKey || !llm.model) return;
    setTestState({ checking: true });
    const result = await testLlmConnection({
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
    });
    setTestState({ checking: false, result: { ok: result.ok, message: result.message, latencyMs: result.latencyMs, errorKind: result.errorKind } });
  };

  const activeReady = !!llm.baseUrl && !!llm.apiKey && !!llm.model;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer drawer-wide" aria-describedby={undefined}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">
              <Plug size={18} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8 }} />
              AI 连接中心
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-icon" aria-label="关闭">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="drawer-body">
            {/* 当前生效配置概览 */}
            <div className="tag tag-neutral" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={13} aria-hidden />
              {activeReady
                ? `当前生效:${llm.model}@${llm.baseUrl}${persistLlmKey ? "(key 已持久化)" : "(key 仅会话)"}`
                : "未配置可用的 LLM 连接(规则式 AI 仍完整可用)"}
            </div>

            {/* 预设模板一键填充 */}
            <div style={{ borderTop: "1px solid var(--border)", margin: 0 }} />
            <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
              <Plug size={14} aria-hidden />
              预设模板(一键填充)
            </h3>
            <div className="preset-grid">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset-chip"
                  onClick={() => quickApplyPreset(p.id)}
                  title={p.description}
                >
                  <span className="preset-chip-name">{p.name}</span>
                  <span className="preset-chip-model">{p.defaultModel}</span>
                  {p.isLocal ? <span className="preset-chip-local">本地</span> : null}
                </button>
              ))}
            </div>
            {presetSource ? <small className="field-hint">已应用来自「{presetSource}」的模板并设为当前生效,请填写 API Key 后保存</small> : null}

            {/* 配置编辑器 */}
            <div style={{ borderTop: "1px solid var(--border)", margin: 0 }} />
            <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
              {editingId ? "编辑配置" : "新建配置"}
              {editingId ? (
                <button type="button" className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={startNew}>
                  <Plus size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  新建
                </button>
              ) : null}
            </h3>
            <label className="field">
              <span className="field-label">配置名称</span>
              <input
                className="field-input"
                value={draft.name}
                placeholder="如:我的 DeepSeek / 本地 Ollama"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">API 基址(到 /v1)</span>
              <input
                className="field-input"
                value={draft.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              />
              <small className="field-hint">服务地址,如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1(Ollama)</small>
            </label>
            <label className="field">
              <span className="field-label">
                <KeyRound size={12} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                API Key({persistLlmKey ? "已持久化" : "仅本次会话"})
              </span>
              <input
                className="field-input"
                type="password"
                value={draft.apiKey}
                placeholder="sk-..."
                autoComplete="off"
                onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
              />
              <small className="field-hint">在模型平台控制台创建;默认仅会话保存,如需持久化请到「AI 设置」开启</small>
            </label>
            <label className="field">
              <span className="field-label">模型</span>
              <input
                className="field-input"
                value={draft.model}
                placeholder="deepseek-chat"
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              />
              <small className="field-hint">如 gpt-4o / deepseek-chat / qwen-plus / glm-4-flash</small>
            </label>
            <div className="field-row">
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">温度</span>
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(e) => setDraft((d) => ({ ...d, temperature: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">最大 Token</span>
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  step={1}
                  value={draft.maxTokens}
                  onChange={(e) => setDraft((d) => ({ ...d, maxTokens: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">超时(ms)</span>
                <input
                  className="field-input"
                  type="number"
                  min={1000}
                  step={1000}
                  value={draft.timeoutMs}
                  onChange={(e) => setDraft((d) => ({ ...d, timeoutMs: e.target.value }))}
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">系统提示词(可选)</span>
              <textarea
                className="field-input"
                rows={2}
                value={draft.systemPrompt}
                placeholder="留空使用内置新媒体编辑助手提示词"
                onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              />
            </label>

            <div className="field-row" style={{ marginTop: 4 }}>
              <button type="button" className="btn" onClick={save} disabled={!draft.baseUrl || !draft.model}>
                <Check size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                保存并设为当前
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={runTest}
                disabled={testState.checking}
              >
                {testState.checking ? (
                  <Loader2 size={13} aria-hidden className="spin" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                ) : (
                  <RefreshCw size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                )}
                测试连接
              </button>
            </div>
            {savedMsg ? (
              <div className="field-hint" style={{ color: "var(--success)" }}>
                <CheckCircle2 size={12} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
                {savedMsg}
              </div>
            ) : null}
            {testState.result ? (
              <div
                className="field-hint"
                style={{ color: testState.result.ok ? "var(--success)" : "var(--danger)", display: "flex", alignItems: "flex-start", gap: 6 }}
              >
                {testState.result.ok ? (
                  <CheckCircle2 size={13} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
                ) : (
                  <XCircle size={13} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
                )}
                <span>
                  {testState.result.message}
                  {testState.result.latencyMs !== undefined ? ` · ${testState.result.latencyMs}ms` : ""}
                </span>
              </div>
            ) : null}

            {/* 已保存配置列表 */}
            <div style={{ borderTop: "1px solid var(--border)", margin: 0 }} />
            <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
              <Layers size={14} aria-hidden />
              已保存配置({llmConfigs.length})
            </h3>
            {llmConfigs.length === 0 ? (
              <small className="field-hint">还没有保存的配置。选择一个预设或手动填写后「保存并设为当前」。</small>
            ) : (
              <div className="config-list">
                {llmConfigs.map((cfg) => {
                  const isActive = cfg.id === activeLlmConfigId;
                  return (
                    <div key={cfg.id} className={`config-item${isActive ? " active" : ""}`}>
                      <div className="config-item-info">
                        <span className="config-item-name">
                          {cfg.name}
                          {isActive ? (
                            <span className="config-item-active">
                              <Check size={11} aria-hidden /> 当前
                            </span>
                          ) : null}
                        </span>
                        <span className="config-item-meta">
                          {cfg.model}@{cfg.baseUrl}
                          {cfg.apiKey ? "" : " · 未填 key"}
                          {cfg.isLocal ? " · 本地" : ""}
                        </span>
                      </div>
                      <div className="config-item-actions">
                        {!isActive ? (
                          <button
                            type="button"
                            className="btn-icon"
                            aria-label={`切换到 ${cfg.name}`}
                            title="切换为当前生效"
                            onClick={() => activateLlmConfig(cfg.id)}
                          >
                            <Check size={14} aria-hidden />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label={`编辑 ${cfg.name}`}
                          title="编辑"
                          onClick={() => editConfig(cfg)}
                        >
                          <Info size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label={`删除 ${cfg.name}`}
                          title="删除"
                          onClick={() => deleteLlmConfig(cfg.id)}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 当前生效配置测试 */}
            <div style={{ borderTop: "1px solid var(--border)", margin: 0 }} />
            <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
              <RefreshCw size={14} aria-hidden />
              检测当前生效配置
            </h3>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={testActive}
              disabled={testState.checking || !activeReady}
            >
              {testState.checking ? (
                <Loader2 size={13} aria-hidden className="spin" style={{ verticalAlign: "-2px", marginRight: 6 }} />
              ) : (
                <RefreshCw size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
              )}
              测试当前配置
            </button>
            <small className="field-hint">
              AI 自动完成、标题/摘要增强、段落改写等全部 AI 能力均使用「当前生效配置」;切换配置即时全局生效。
            </small>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
