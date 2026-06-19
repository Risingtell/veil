// Generate a professional 480x480 PNG logo for Veil — no external image libs.
// Wordmark "VEIL" with a "ZK" accent below, on a deep indigo->blue gradient.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 480;
const buf = Buffer.alloc(S * S * 3);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- stroke-based geometric font (unit cell, y=0 top .. y=1 bottom) ----
const GLYPHS = {
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  E: [[[0.95, 0], [0, 0], [0, 1], [0.95, 1]], [[0, 0.5], [0.75, 0.5]]],
  I: [[[0.5, 0], [0.5, 1]], [[0.18, 0], [0.82, 0]], [[0.18, 1], [0.82, 1]]],
  L: [[[0, 0], [0, 1], [0.9, 1]]],
  Z: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
  K: [[[0, 0], [0, 1]], [[0.92, 0], [0.04, 0.52], [0.92, 1]]],
};

// distance from point to a polyline (list of [x,y] in pixel space)
function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = clamp(t, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }
  return best;
}

// place a word; returns array of {polys:[[ [x,y].. ]], } in pixel coords
function layoutWord(word, originX, topY, cellW, cellH, gap) {
  const placed = [];
  let x = originX;
  for (const ch of word) {
    const strokes = GLYPHS[ch] || [];
    for (const poly of strokes) {
      placed.push(poly.map(([ux, uy]) => [x + ux * cellW, topY + uy * cellH]));
    }
    x += cellW + gap;
  }
  return placed;
}

// ---- build the two words ----
// "VEIL" big, centered
const bigCellW = 72, bigCellH = 118, bigGap = 30;
const bigWidth = 4 * bigCellW + 3 * bigGap;
const bigPolys = layoutWord("VEIL", (S - bigWidth) / 2, 138, bigCellW, bigCellH, bigGap);
// "ZK" smaller accent, centered
const zkCellW = 56, zkCellH = 80, zkGap = 26;
const zkWidth = 2 * zkCellW + zkGap;
const zkPolys = layoutWord("ZK", (S - zkWidth) / 2, 322, zkCellW, zkCellH, zkGap);

const BIG_HALF = 9.5;   // half stroke width for VEIL
const ZK_HALF = 8.0;    // half stroke width for ZK
const ACCENT = [45, 212, 191]; // teal accent for ZK (#2DD4BF)

// gradient endpoints (diagonal, deep emerald -> near-black charcoal)
const c0 = [16, 67, 52];    // #104334 emerald
const c1 = [8, 20, 17];     // #081411 near-black

function minDist(px, py, polys) {
  let best = Infinity;
  for (const p of polys) best = Math.min(best, distToPolyline(px, py, p));
  return best;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = (x + y) / (2 * (S - 1));
    let r = lerp(c0[0], c1[0], t);
    let g = lerp(c0[1], c1[1], t);
    let b = lerp(c0[2], c1[2], t);
    // soft center glow
    const glow = Math.max(0, 1 - Math.hypot(x - 240, y - 240) / 330) * 22;
    r += glow; g += glow; b += glow;

    // VEIL in white
    const dBig = minDist(x, y, bigPolys);
    const eBig = clamp((BIG_HALF + 1.1 - dBig) / 2.2, 0, 1);
    r = lerp(r, 255, eBig); g = lerp(g, 255, eBig); b = lerp(b, 255, eBig);

    // thin divider line under VEIL
    if (y >= 296 && y <= 299 && x >= 176 && x <= 304) {
      r = lerp(r, 255, 0.85); g = lerp(g, 255, 0.85); b = lerp(b, 255, 0.85);
    }

    // ZK in teal accent
    const dZk = minDist(x, y, zkPolys);
    const eZk = clamp((ZK_HALF + 1.1 - dZk) / 2.2, 0, 1);
    r = lerp(r, ACCENT[0], eZk); g = lerp(g, ACCENT[1], eZk); b = lerp(b, ACCENT[2], eZk);

    const i = (y * S + x) * 3;
    buf[i] = Math.round(clamp(r, 0, 255));
    buf[i + 1] = Math.round(clamp(g, 0, 255));
    buf[i + 2] = Math.round(clamp(b, 0, 255));
  }
}

// ---- encode PNG (color type 2, 8-bit) ----
const raw = Buffer.alloc((S * 3 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0;
  buf.copy(raw, y * (S * 3 + 1) + 1, y * S * 3, (y + 1) * S * 3);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("build/veil-logo.png", png);
console.log("wrote build/veil-logo.png", png.length, "bytes");
