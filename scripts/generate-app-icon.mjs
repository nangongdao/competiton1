/**
 * 生成桌面应用图标(纯 Node 实现,零外部依赖)。
 *
 * 输出:packages/desktop/app-icon.png(1024×1024,圆角渐变 + 发送箭头)
 * 再由 `tauri icon` 派生 ico/icns/多尺寸 png。
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopDir = join(root, "packages", "desktop");
mkdirSync(join(desktopDir, "icons"), { recursive: true });

const SIZE = 1024;
const px = Buffer.alloc(SIZE * SIZE * 4);

function set(x, y, r, g, b, a) {
  const i = (y * SIZE + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

const radius = 210;

function inRoundedRect(x, y) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const left = radius;
  const right = SIZE - radius;
  const top = radius;
  const bottom = SIZE - radius;
  if (cx >= left && cx <= right) return true;
  if (cy >= top && cy <= bottom) return true;
  const cxc = cx < left ? left : right;
  const cyc = cy < top ? top : bottom;
  const dx = cx - cxc;
  const dy = cy - cyc;
  return dx * dx + dy * dy <= radius * radius;
}

// 垂直渐变(indigo-500 → indigo-700)。
const c1 = [91, 91, 214];
const c2 = [67, 67, 176];
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  for (let x = 0; x < SIZE; x++) {
    if (!inRoundedRect(x, y)) {
      set(x, y, 0, 0, 0, 0);
    } else {
      set(x, y, r, g, b, 255);
    }
  }
}

// 白色"发送"箭头(纸飞机)居中。
function inTriangle(x, y, x1, y1, x2, y2, x3, y3) {
  const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(x, y, x1, y1, x2, y2);
  const d2 = sign(x, y, x2, y2, x3, y3);
  const d3 = sign(x, y, x3, y3, x1, y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// 纸飞机:左尖头 + 上/下双翼(读作"发送")。
const plane = [
  [270, 512, 760, 330, 470, 512],
  [270, 512, 470, 512, 760, 694],
];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const inside = plane.some(([x1, y1, x2, y2, x3, y3]) => inTriangle(x, y, x1, y1, x2, y2, x3, y3));
    if (inside) set(x, y, 255, 255, 255, 255);
  }
}

// 编码 PNG(RGBA8)。
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const pngPath = join(desktopDir, "app-icon.png");
writeFileSync(pngPath, png);
console.log(`✅ 已生成图标源文件: ${pngPath} (${(png.length / 1024).toFixed(1)} KiB)`);
console.log("   请运行 `npm run icon -w @mpp/desktop` 生成 src-tauri/icons 全尺寸图标。");
