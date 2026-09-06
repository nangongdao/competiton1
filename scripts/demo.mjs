// 零密钥、零扩展的完整闭环演示。
// 读取样例 Markdown → 经 core 适配多平台 → 模拟发布 → 产物写入 dist/demo/。
// 一条命令(npm run demo)即可证明核心链路闭环,无需任何 API key 或浏览器扩展。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  markdownToIR,
  syncToPlatforms,
  getAdapter,
  buildCoverSpec,
} from "../packages/core/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "dist", "demo");

const EXT = { wechat: "html", zhihu: "html", bilibili: "html", xiaohongshu: "txt", juejin: "md", csdn: "md", cnblogs: "md" };

async function main() {
  await mkdir(OUT, { recursive: true });

  const md = await readFile(join(__dirname, "sample", "article.md"), "utf8");
  const { document, assetTable } = markdownToIR(md, {
    meta: { authorName: "效率君", tags: ["效率", "时间管理", "科技"], canonicalUrl: "https://example.com/post/1" },
  });

  console.log(`\n📄 已解析文档:《${document.meta.title}》`);
  console.log(`   ${document.blocks.length} 个内容块,${document.assets.length} 个资产\n`);

  const platforms = ["wechat", "zhihu", "bilibili", "xiaohongshu", "juejin", "cnblogs", "csdn"];
  const now = () => new Date().toISOString();

  // 演示图片重托管:注入一个内存图床(把原始图 URL 映射为各平台图床 URL)。
  // 真实场景由 server 的 local/s3/wechat 图床完成;这里证明 rehost 链路端到端生效。
  const makeRehostCtx = (platformId) => ({
    platformId,
    upload: async (asset) => {
      const orig = asset.source.url ?? asset.source.dataUrl ?? "unknown";
      const name = orig.split("/").pop() ?? "image.png";
      // 模拟各平台图床域名。
      const host = { wechat: "mmbiz.qpic.cn", bilibili: "i0.hdslb.com" }[platformId] ?? "cdn.demo.local";
      return { url: `https://${host}/rehosted/${platformId}/${name}` };
    },
  });
  const rehost = Object.fromEntries(platforms.map((id) => [id, makeRehostCtx(id)]));

  const results = await syncToPlatforms(document, platforms, { now, rehost, assetTable });

  const report = { title: document.meta.title, generatedAt: now(), platforms: [] };

  for (const r of results) {
    const adapter = getAdapter(r.platformId);
    const payload = r.artifact?.payload;
    const ext = EXT[r.platformId] ?? "txt";
    const file = `${r.platformId}.${ext}`;

    if (payload) {
      await writeFile(join(OUT, file), payload.content, "utf8");
    }

    // 封面规格(小红书 3:4,公众号 2.35:1),demo 输出 SVG 占位(真实 PNG 由 app Canvas 生成)。
    let coverFile;
    if (adapter?.capabilities.requiresCover) {
      const ratio = r.platformId === "xiaohongshu" ? "3:4" : "2.35:1";
      const spec = buildCoverSpec(document, { ratio });
      coverFile = `${r.platformId}-cover.svg`;
      await writeFile(join(OUT, coverFile), renderCoverSvg(spec), "utf8");
    }

    const issues = r.report?.issues ?? [];
    const errs = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warning").length;
    const status = r.ok ? "✅" : "⛔";
    // 重托管失败明细:发布前让用户知道哪些图没传成功(公众号外链图会被平台屏蔽)。
    const failures = r.rehostFailures ?? [];
    for (const f of failures) {
      console.log(`      ⚠️ 图片重托管失败:${f.sourceUrl} → ${f.reason}`);
    }
    console.log(
      `${status} ${r.platformName.padEnd(8)} → ${file.padEnd(18)} ` +
        `[${errs} error, ${warns} warning] ${r.receipt ? r.receipt.message : r.error ?? ""}`,
    );
    // 排版质量分(UPGRADE §5.2):四维评分 + 建议。
    if (r.quality) {
      console.log(`      排版 ${r.quality.overall}/100 [段落${r.quality.paragraphRhythm} 图文${r.quality.imageBalance} 标题${r.quality.headingStructure} 可读${r.quality.readability}]`);
      for (const s of r.quality.suggestions) console.log(`      💡 ${s}`);
    }
    for (const i of issues) {
      console.log(`      ${sev(i.severity)} ${i.message}`);
    }

    report.platforms.push({
      platformId: r.platformId,
      platformName: r.platformName,
      ok: r.ok,
      file,
      coverFile,
      mime: payload?.mime,
      title: payload?.title,
      tags: payload?.tags,
      bodyChars: payload ? countChars(payload) : 0,
      extra: payload?.extra,
      issues,
      rehostFailures: failures,
      quality: r.quality,
      receipt: r.receipt,
      instructions: r.artifact?.instructions,
    });
  }

  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n📦 产物已写入 ${OUT}`);
  console.log(`   打开各 .html 可见平台适配效果,report.json 含校验与回执详情。\n`);
}

function sev(s) {
  return s === "error" ? "⛔" : s === "warning" ? "⚠️ " : "ℹ️ ";
}

function countChars(payload) {
  const text = payload.mime === "text/html" ? payload.content.replace(/<[^>]+>/g, "") : payload.content;
  return [...text].length;
}

// 极简 SVG 封面占位(演示用;真实位图封面由 app 端 Canvas 生成)。
function renderCoverSvg(spec) {
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
  const lines = wrapText(spec.title, 9);
  const fontSize = Math.floor(spec.width / 11);
  const startY = spec.height / 2 - ((lines.length - 1) * fontSize * 1.3) / 2;
  const tspans = lines
    .map((ln, i) => `<text x="${spec.width / 2}" y="${startY + i * fontSize * 1.3}" font-size="${fontSize}" font-weight="bold" fill="${spec.textColor}" text-anchor="middle" font-family="sans-serif">${esc(ln)}</text>`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
<rect width="${spec.width}" height="${spec.height}" fill="${spec.background}"/>
<rect x="0" y="0" width="${spec.width}" height="14" fill="${spec.accent}"/>
${tspans}
</svg>`;
}

function wrapText(text, perLine) {
  const chars = [...text];
  const lines = [];
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(""));
  return lines.length ? lines : [""];
}

main().catch((err) => {
  console.error("演示失败:", err);
  process.exit(1);
});
