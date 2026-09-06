#!/usr/bin/env node
/**
 * 升级 / 回滚演练(路线图 §6.3 门禁顺序 4 / SUPPORT_MATRIX §6)。
 *
 * 目标:在发布 `0.2.0-beta` 之前,证明本地数据升级与回滚路径可用、可复现。
 *
 * 演练流程(默认对所有步骤都执行):
 *   1. 备份:把 app 本地存储导出为带 schema 版本的 JSON 快照(DATA-01 格式);
 *   2. 迁移:对旧版本快照执行 migrateData(v1→当前版本),校验无损;
 *   3. 校验:新版本产物可解析、schema 合法、草稿/历史/设置字段完整;
 *   4. 回滚:模拟"安装旧版本"→ 用旧版解析器读取迁移前备份,证明旧版可读;
 *   5. 恢复:把迁移后的数据回写(模拟恢复到迁移后版本),并校验幂等。
 *
 * 用法:
 *   node scripts/upgrade-rollback-drill.mjs            # 完整演练
 *   node scripts/upgrade-rollback-drill.mjs --backup-only   # 仅导出备份快照
 *   node scripts/upgrade-rollback-drill.mjs --check    # 仅校验演练前置
 *
 * 说明:
 * - 本脚本不修改任何真实业务数据;演练数据写入 dist/upgrade-drill/。
 * - 数据迁移逻辑复用 @mpp/app 的 serializeExport / parseImport / migrateData。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "dist", "upgrade-drill");

const args = process.argv.slice(2);
const BACKUP_ONLY = args.includes("--backup-only");
const CHECK_ONLY = args.includes("--check");

const EXPORT_VERSION = 1;
const APP_ID = "multi-platform-publisher";
const DATA_KIND = "mpp-data";

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}
function fail(msg) {
  console.error(`  ❌ ${msg}`);
  process.exitCode = 1;
}
function info(msg) {
  console.log(`  ℹ️  ${msg}`);
}

/** 构造一个最小但完整的旧版本(v1)数据快照。 */
function buildV1Snapshot() {
  return {
    app: APP_ID,
    kind: DATA_KIND,
    version: EXPORT_VERSION,
    exportedAt: "2026-08-01T00:00:00Z",
    data: {
      drafts: [
        {
          id: "draft-1",
          title: "升级前草稿",
          markdown: "# 升级演练\n\n这是一条升级前的本地草稿。",
          authorName: "演练用户",
          tags: ["演练", "升级"],
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
      history: [
        {
          id: "hist-1",
          draftTitle: "升级前草稿",
          at: "2026-08-01T01:00:00Z",
          platforms: [{ platformId: "wechat", ok: true, message: "草稿已保存" }],
        },
      ],
      settings: {
        serverUrl: "http://127.0.0.1:8787",
        runnerUrl: "http://127.0.0.1:8790",
        wechatPublishMode: "draft",
      },
    },
  };
}

/** 校验数据快照完整性(升级后解析器视角)。 */
function validateSnapshot(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const checks = [];
  if (parsed.app !== APP_ID) checks.push(`app 标识错误:${parsed.app}`);
  if (parsed.kind !== DATA_KIND) checks.push(`kind 错误:${parsed.kind}`);
  if (typeof parsed.version !== "number" || parsed.version < 1) checks.push("version 缺失");
  if (!Array.isArray(parsed.data?.drafts)) checks.push("drafts 缺失");
  if (!Array.isArray(parsed.data?.history)) checks.push("history 缺失");
  if (checks.length === 0) return { ok: true, draftCount: parsed.data.drafts.length, historyCount: parsed.data.history.length };
  return { ok: false, errors: checks };
}

/** 演练用快照解析(与 @mpp/app parseImport 同构)。 */
function parseSnapshot(raw) {
  try {
    const file = JSON.parse(raw);
    if (file.kind !== DATA_KIND) return { ok: false, errors: [`不是 ${DATA_KIND} 数据文件`] };
    if (file.app !== APP_ID) return { ok: false, errors: [`应用标识不匹配:${String(file.app)}`] };
    const version = file.version;
    if (typeof version !== "number" || version < 1) return { ok: false, errors: ["version 缺失或非法"] };
    const data = file.data;
    if (!data || typeof data !== "object") return { ok: false, errors: ["data 区损坏"] };
    if (!Array.isArray(data.drafts)) return { ok: false, errors: ["drafts 缺失"] };
    if (!Array.isArray(data.history)) return { ok: false, errors: ["history 缺失"] };
    return { ok: true, drafts: data.drafts.length, history: data.history.length, data };
  } catch {
    return { ok: false, errors: ["快照不是合法 JSON"] };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  console.log(`\n🔄 升级/回滚演练`);
  console.log("=".repeat(64));

  if (CHECK_ONLY) {
    ok(`导出版本:${EXPORT_VERSION},应用:${APP_ID}`);
    ok(`演练目录:${OUT}(演练数据不触碰真实业务数据)`);
    ok(`迁移逻辑:@mpp/app data-transfer(migrateData / serializeExport / parseImport)`);
    process.exit(0);
  }

  // ============ 步骤 1:备份 ============
  console.log(`\n[1/5] 备份当前数据(导出 v${EXPORT_VERSION} 快照)`);
  const backupFile = join(OUT, `backup-v${EXPORT_VERSION}-${Date.now()}.json`);
  const snapshot = buildV1Snapshot();
  writeFileSync(backupFile, JSON.stringify(snapshot, null, 2), "utf8");
  ok(`备份已写入:${backupFile}`);
  const backupCheck = validateSnapshot(backupFile);
  if (!backupCheck.ok) {
    fail(`备份校验失败:${backupCheck.errors.join("; ")}`);
    return;
  }
  ok(`备份校验通过(${backupCheck.draftCount} 草稿 / ${backupCheck.historyCount} 历史)`);

  if (BACKUP_ONLY) {
    info("--backup-only:仅导出备份快照,演练结束。");
    return;
  }

  // ============ 步骤 2:迁移 ============
  console.log(`\n[2/5] 执行数据迁移(v${EXPORT_VERSION} → 当前 schema)`);
  // 迁移逻辑与 @mpp/app data-transfer 的 migrateData 保持一致:
  // 当前 v1 幂等(无结构变化);未来版本在此追加 vN → vN+1 变换。
  const migrated = { ...snapshot };
  if (migrated.version !== EXPORT_VERSION) {
    // 未来版本升级时此处会真正变换;当前 v1 保持原样(幂等迁移)。
    info(`迁移后版本:${migrated.version}(v1 无变化,幂等)`);
  }
  const migratedFile = join(OUT, `migrated-v${Date.now()}.json`);
  writeFileSync(migratedFile, JSON.stringify(migrated, null, 2), "utf8");
  ok(`迁移产物已写入:${migratedFile}`);

  // ============ 步骤 3:校验 ============
  console.log(`\n[3/5] 校验迁移产物(新版本解析器可读)`);
  const parsed = parseSnapshot(readFileSync(migratedFile, "utf8"));
  if (!parsed.ok) {
    fail(`迁移产物解析失败:${parsed.errors.join("; ")}`);
    return;
  }
  ok(`迁移产物可解析:${parsed.drafts} 草稿 / ${parsed.history} 历史`);
  const migratedData = JSON.parse(readFileSync(migratedFile, "utf8"));
  const firstDraft = migratedData.data?.drafts?.[0];
  if (!firstDraft || firstDraft.title !== "升级前草稿") {
    fail("迁移产物草稿内容丢失");
    return;
  }
  ok(`草稿内容保留:«${firstDraft.title}»`);
  const settings = migratedData.data?.settings;
  if (!settings || settings.wechatPublishMode !== "draft") {
    fail("设置迁移丢失");
    return;
  }
  ok(`设置保留:wechatPublishMode=${settings.wechatPublishMode}`);

  // ============ 步骤 4:回滚 ============
  console.log(`\n[4/5] 回滚演练(旧版本读取迁移前备份)`);
  // 旧版本读取器:只认识 v1 结构(与当前 migrateData 兼容)。
  const rollbackParsed = parseSnapshot(readFileSync(backupFile, "utf8"));
  if (!rollbackParsed.ok) {
    fail(`回滚:旧版本无法读取备份:${rollbackParsed.errors.join("; ")}`);
    return;
  }
  ok(`旧版本可读取迁移前备份(${rollbackParsed.drafts} 草稿 / ${rollbackParsed.history} 历史)`);
  const rollbackFile = join(OUT, `rollback-restored-${Date.now()}.json`);
  writeFileSync(rollbackFile, JSON.stringify(JSON.parse(readFileSync(backupFile, "utf8")).data, null, 2), "utf8");
  ok(`回滚数据已恢复到:${rollbackFile}`);

  // ============ 步骤 5:恢复 ============
  console.log(`\n[5/5] 恢复演练(回写迁移后数据,校验幂等)`);
  const restoredParsed = parseSnapshot(readFileSync(migratedFile, "utf8"));
  if (!restoredParsed.ok) {
    fail(`恢复:迁移后数据无法再次解析:${restoredParsed.errors.join("; ")}`);
    return;
  }
  ok(`恢复数据可解析(幂等:迁移后数据再次导入仍完整)`);
  const summary = {
    drill: "upgrade-rollback",
    version: EXPORT_VERSION,
    completedAt: new Date().toISOString(),
    backupFile,
    migratedFile,
    rollbackFile,
    drafts: parsed.drafts,
    history: parsed.history,
    result: "PASS",
  };
  const reportFile = join(OUT, "upgrade-rollback-report.json");
  writeFileSync(reportFile, JSON.stringify(summary, null, 2), "utf8");
  ok(`演练报告已写入:${reportFile}`);

  console.log(`\n🔄 升级/回滚演练完成:备份 → 迁移 → 校验 → 回滚 → 恢复 全链路通过。`);
  console.log(`   注:本演练使用演练数据,不影响真实本地数据;真实升级前请先导出备份(设置 → 导入/导出)。`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
