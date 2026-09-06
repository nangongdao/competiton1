/**
 * Bundle 大小门禁(TEST-02)。
 *
 * 构建后校验:
 * - 全部 JS chunk 单文件 < 500kB;
 * - 首屏(index-*.js)gzip 总和 < 180kB(路线图 Phase 3 预算);
 * - preview.worker 独立 chunk 不计入首屏。
 *
 * 用法:node scripts/check-bundle.mjs [distDir]
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = process.argv[2] ?? join(__dirname, "..", "packages", "app", "dist");
const MAIN_CHUNK_LIMIT = 500 * 1024; // 500 kB
const FIRST_SCREEN_GZIP_LIMIT = 180 * 1024; // 180 kB

async function main() {
  const assets = await readdir(join(DIST, "assets"));
  const jsChunks = assets.filter((f) => f.endsWith(".js") && !f.includes("preview.worker"));

  // 主入口:index-*.js(不含 lazy chunk)。
  const mainChunks = jsChunks.filter((f) => /^index-/.test(f));
  let mainGzip = 0;
  let failed = false;

  for (const chunk of jsChunks) {
    const file = await readFile(join(DIST, "assets", chunk));
    if (file.byteLength > MAIN_CHUNK_LIMIT) {
      console.error(`❌ ${chunk}: ${(file.byteLength / 1024).toFixed(1)} kB > ${MAIN_CHUNK_LIMIT / 1024} kB`);
      failed = true;
    }
  }

  for (const chunk of mainChunks) {
    const file = await readFile(join(DIST, "assets", chunk));
    mainGzip += gzipSync(file).byteLength;
  }
  if (mainGzip > FIRST_SCREEN_GZIP_LIMIT) {
    console.error(
      `❌ 首屏 gzip ${(mainGzip / 1024).toFixed(1)} kB > ${FIRST_SCREEN_GZIP_LIMIT / 1024} kB(index 主 chunk gzip 总和)`,
    );
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }
  console.log(
    `✅ Bundle 门禁通过:主入口 ${mainChunks.length} 个,全部 ${jsChunks.length} 个 JS chunk < 500kB;` +
      `首屏 gzip ${(mainGzip / 1024).toFixed(1)} kB < ${FIRST_SCREEN_GZIP_LIMIT / 1024} kB`,
  );
}

void main();
