// Rasterises the double-tick logo to PNG icons without any native deps.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [11, 87, 208];
const FG = [255, 255, 255];
// Tick strokes in a 16×11 design space, centred inside a 24×24 tile.
const STROKES = [
  [[1, 6.2], [4.2, 9.4], [11.4, 2]],
  [[7.4, 8.6], [8.2, 9.4], [15.4, 2]],
].map((pts) => pts.map(([x, y]) => [x + 4, y + 6.5]));

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inRoundedRect(x, y, size, r) {
  const cx = Math.max(r, Math.min(size - r, x)), cy = Math.max(r, Math.min(size - r, y));
  return Math.hypot(x - cx, y - cy) <= r;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size) {
  const SS = 4, scale = 24 / size, raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = (x + (sx + 0.5) / SS) * scale, py = (y + (sy + 0.5) / SS) * scale;
        if (!inRoundedRect(px, py, 24, 6)) continue;
        bg++;
        if (STROKES.some((s) => segDist(px, py, s[0], s[1]) < 1.1 || segDist(px, py, s[1], s[2]) < 1.1)) fg++;
      }
      const n = SS * SS, a = bg / n, f = bg ? fg / bg : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - f) + FG[i] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icon", { recursive: true });
for (const size of [16, 32, 48, 96, 128]) writeFileSync(`public/icon/${size}.png`, render(size));
console.log("icons written to public/icon/");
