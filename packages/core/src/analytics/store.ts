/**
 * DATA-02 效果回收存储 —— 版本化、按平台检索。
 *
 * 与 JOB-02/FLOW-03 存储同构:纯读写 + 版本化 + 保留策略。
 * - `MemoryPerformanceStore`:测试/默认;
 * - 应用侧 IndexedDB / chrome.storage 可实现同样接口。
 */
import type { PerformanceRecord, PerformanceStore } from "./types.js";

/** 效果记录存储 schema 版本。 */
export const PERFORMANCE_SCHEMA_VERSION = 1;
/** 每平台保留记录条数上限(防无限增长)。 */
export const PERFORMANCE_RECORDS_MAX_PER_PLATFORM = 500;

/** 校验记录是否满足 schema。 */
export function assertPerformanceSchema(record: unknown): record is PerformanceRecord {
  if (typeof record !== "object" || record === null) return false;
  const r = record as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.platformId === "string" &&
    typeof r.title === "string" &&
    typeof r.publishedAt === "string" &&
    typeof r.collectedAt === "string" &&
    typeof r.metrics === "object" &&
    r.metrics !== null &&
    typeof r.source === "string"
  );
}

/** 内存实现(默认/测试用)。 */
export class MemoryPerformanceStore implements PerformanceStore {
  readonly schemaVersion = PERFORMANCE_SCHEMA_VERSION;
  private readonly records: PerformanceRecord[] = [];

  async list(): Promise<readonly PerformanceRecord[]> {
    return [...this.records].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async listByPlatform(platformId: string): Promise<readonly PerformanceRecord[]> {
    return this.records
      .filter((r) => r.platformId === platformId)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async get(id: string): Promise<PerformanceRecord | undefined> {
    return this.records.find((r) => r.id === id);
  }
  async put(record: PerformanceRecord): Promise<void> {
    const idx = this.records.findIndex((r) => r.id === record.id);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
  }
  async remove(id: string): Promise<void> {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx >= 0) this.records.splice(idx, 1);
  }
}
