/**
 * 增量适配引擎(UPGRADE §3)—— 预览场景只重算受影响的阶段。
 *
 * 问题:Web UI 实时预览下,用户每敲一个字都触发 parse → preprocess → serialize 全量重算。
 * 本引擎做三层缓存:
 *   1. 源 Markdown 哈希未变 → 复用解析出的 IR(parse 是最重的阶段);
 *   2. 平台 config/override 哈希未变 → 复用该平台的序列化产物;
 *   3. 仅单个平台配置变化 → 只重算该平台,其余平台命中缓存直出。
 *
 * core 是零 DOM 纯 TS,天然可放进 Web Worker —— 本引擎是"预览不卡顿"的架构落点,
 * app 端可配合防抖 + 输入级 memo(见 store)把感知延迟压到 300ms 内。
 */
import type { Document, PlatformOverride } from "../ir/types.js";
import type { PlatformConfigMap } from "../config/platform-config.js";
import type { SerializedPayload } from "../adapters/types.js";
import { markdownToIR } from "../parse/md-to-ir.js";
import { getAdapter } from "../adapters/registry.js";
import { fnv1a } from "../publish/idempotency.js";

export interface IncrementalOptions {
  /** 每平台覆盖层。 */
  readonly overrides?: Readonly<Record<string, PlatformOverride>>;
  /** 每平台运行时配置。 */
  readonly config?: PlatformConfigMap;
}

export interface IncrementalResult {
  readonly platformId: string;
  readonly output: SerializedPayload;
  /** 本次是否命中缓存(未重算序列化)。 */
  readonly cached: boolean;
}

/** 结构哈希:对任意可 JSON 序列化的值求稳定哈希,用于失效判断。 */
function hashInput(value: unknown): string {
  return fnv1a(JSON.stringify(value ?? null));
}

export class IncrementalAdapter {
  private sourceHash = "";
  private ir: Document | null = null;
  private serialized = new Map<string, SerializedPayload>();

  /**
   * 增量适配:返回各平台序列化产物。
   *
   * 源变化 → 重解析 IR 并清空全部序列化缓存;仅配置变化 → 复用 IR,只重跑该平台。
   * 同一 (source, platformId, config) 组合重复调用返回同一产物引用(零拷贝)。
   */
  adapt(source: string, platformIds: readonly string[], options: IncrementalOptions = {}): IncrementalResult[] {
    const sourceHash = hashInput(source);
    if (this.sourceHash !== sourceHash) {
      this.sourceHash = sourceHash;
      this.ir = markdownToIR(source).document;
      this.serialized.clear();
    }
    const ir = this.ir!;

    const results: IncrementalResult[] = [];
    for (const platformId of platformIds) {
      const adapter = getAdapter(platformId);
      if (!adapter) continue; // 未注册平台跳过(与 sync 引擎行为一致,不抛异常)

      const key = `${platformId}:${hashInput([options.overrides?.[platformId], options.config?.[platformId]])}`;
      const hit = this.serialized.get(key);
      if (hit) {
        results.push({ platformId, output: hit, cached: true });
        continue;
      }
      const processed = adapter.preprocess(ir, options.overrides?.[platformId], options.config?.[platformId]);
      const output = adapter.serialize(processed, options.overrides?.[platformId]);
      this.serialized.set(key, output);
      results.push({ platformId, output, cached: false });
    }
    return results;
  }

  /** 强制下次全量重算(如平台能力变更、外部数据变化时)。 */
  clear(): void {
    this.sourceHash = "";
    this.ir = null;
    this.serialized.clear();
  }
}
