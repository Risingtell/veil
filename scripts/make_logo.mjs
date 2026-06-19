// Generate a clean 480x480 PNG logo for Veil with no external image libs.
// A bold white "V" mark on a violet->blue gradient. Writes build/veil-logo.png.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 480;
const buf = Buffer.alloc(S * S * 3);

const lerp = (a, b, t) => a + (b - a) * t;
function dist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// gradient endpoints (top violet -> bottom blue)
const c0 = [124, 58, 237];  // #7C3AEF violet
const c1 = [37, 99, 235];   // #2563EB blue
// "V" geometry
const ax1 = 138, ay1 = 150, ax2 = 342, ay2 = 150, apexX = 240, apexY = 352;
const HALF = 26;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = y / (S - 1);
    let r = lerp(c0[0], c1[0], t);
    let g = lerp(c0[1], c1[1], t);
    let b = lerp(c0[2], c1[2], t);
    // subtle radial glow toward center for depth
    const rad = Math.hypot(x - 240, y - 240) / 340;
    const glow = Math.max(0, 1 - rad) * 18;
    r += glow; g += glow; b += glow;
    // the V strokes (rounded caps via segment distance)
    const d = Math.min(
      dist(x, y, ax1, ay1, apexX, apexY),
      dist(x, y, ax2, ay2, apexX, apexY)
    );
    const edge = Math.max(0, Math.min(1, (HALF + 1.2 - d) / 2.4)); // anti-aliased
    r = lerp(r, 255, edge); g = lerp(g, 255, edge); b = lerp(b, 255, edge);
    const i = (y * S + x) * 3;
    buf[i] = Math.round(Math.max(0, Math.min(255, r)));
    buf[i + 1] = Math.round(Math.max(0, Math.min(255, g)));
    buf[i + 2] = Math.round(Math.max(0, Math.min(255, b)));
  }
}

// --- encode PNG (color type 2, 8-bit, filter 0 per scanline) ---
const raw = Buffer.alloc((S * 3 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0; // filter: none
  buf.copy(raw, y * (S * 3 + 1) + 1, y * S * 3, (y + 1) * S * 3);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("build/veil-logo.png", png);
console.log("wrote build/veil-logo.png", png.length, "bytes");
