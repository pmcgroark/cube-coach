#!/usr/bin/env node
/* Cube Coach — makes the app icons in icons/ from the brand mark (the 3×3 cube in index.html).
 *
 *   node tools/make-icons.js            write the PNGs
 *   node tools/make-icons.js --check    exit 1 if the PNGs on disk differ from what would be written
 *
 * No dependencies: a tiny PNG writer on top of node's built-in zlib. Shapes are drawn with signed
 * distance functions, so edges are anti-aliased at every size.
 *
 *   icons/icon-192.png, icon-512.png                 purpose "any": the mark with transparent corners
 *   icons/icon-maskable-192.png, -512.png            purpose "maskable": full-bleed background, the
 *                                                    cube inside the central safe circle (80 %)
 *   icons/apple-touch-icon.png (180)                 iPhone home screen: opaque, iOS rounds the corners
 *   icons/qr-cube-coach.svg                          QR code of the hosted link (CC.App.HOSTED_URL)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- the brand mark (index.html): 32×32 viewBox, rounded plate + 3×3 stickers
const PLATE = '#14181d';
const STICKERS = [
  ['#ffd500', '#c8102e', '#009e60'],
  ['#0051ba', '#ffd500', '#ff6a13'],
  ['#f5f5f0', '#009e60', '#ffd500']
];
const MARK = { size: 32, plateRadius: 7, cell: 7, pitch: 8.5, origin: 4, cellRadius: 1.6 };

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

// Signed distance (pixels) from point to a rounded rectangle centred at (cx, cy).
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function makeCanvas(size) { return { size, px: new Float64Array(size * size * 4) }; } // premultiplied RGBA 0..1

function fillRoundRect(cv, x, y, w, h, r, colour) {
  const [cr, cg, cb] = hex(colour).map((v) => v / 255);
  const cx = x + w / 2, cy = y + h / 2, n = cv.size;
  const x0 = Math.max(0, Math.floor(x - 1)), x1 = Math.min(n, Math.ceil(x + w + 1));
  const y0 = Math.max(0, Math.floor(y - 1)), y1 = Math.min(n, Math.ceil(y + h + 1));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const a = Math.min(1, Math.max(0, 0.5 - sdRoundRect(px + 0.5, py + 0.5, cx, cy, w / 2, h / 2, r)));
      if (!a) continue;
      const i = (py * n + px) * 4, k = 1 - a; // source-over, premultiplied
      cv.px[i] = cr * a + cv.px[i] * k;
      cv.px[i + 1] = cg * a + cv.px[i + 1] * k;
      cv.px[i + 2] = cb * a + cv.px[i + 2] * k;
      cv.px[i + 3] = a + cv.px[i + 3] * k;
    }
  }
}

// layout: { plate: 'rounded'|'square', grid: fraction of the icon the 3×3 grid spans }
function drawMark(size, layout) {
  const cv = makeCanvas(size);
  const s = size / MARK.size;
  if (layout.plate === 'square') fillRoundRect(cv, 0, 0, size, size, 0, PLATE);
  else fillRoundRect(cv, 0, 0, size, size, MARK.plateRadius * s, PLATE);
  // the mark's grid spans 4..28 of 32 (75 %); rescale it about the centre to layout.grid
  const markGrid = (MARK.pitch * 2 + MARK.cell) / MARK.size;
  const k = (layout.grid || markGrid) / markGrid;
  const centre = size / 2;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = centre + ((MARK.origin + c * MARK.pitch) * s - centre) * k;
      const y = centre + ((MARK.origin + r * MARK.pitch) * s - centre) * k;
      fillRoundRect(cv, x, y, MARK.cell * s * k, MARK.cell * s * k, MARK.cellRadius * s * k, STICKERS[r][c]);
    }
  }
  return cv;
}

// ---- PNG writer
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// opaque: write RGB (colour type 2) composited over the plate colour; else RGBA (colour type 6).
function encodePNG(cv, opaque) {
  const n = cv.size, ch = opaque ? 3 : 4;
  const raw = Buffer.alloc((n * ch + 1) * n);
  const bg = hex(PLATE).map((v) => v / 255);
  for (let y = 0; y < n; y++) {
    const row = y * (n * ch + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4, o = row + 1 + x * ch;
      const a = cv.px[i + 3];
      for (let c = 0; c < 3; c++) {
        const v = opaque ? cv.px[i + c] + bg[c] * (1 - a) : (a ? cv.px[i + c] / a : 0);
        raw[o + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
      if (!opaque) raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Maskable safe zone: everything important inside a circle of radius 40 % of the icon. The grid's
// half-diagonal must stay inside it: grid * sqrt(2) / 2 <= 0.4  =>  grid <= 0.566. We use 0.52.
const ICONS = [
  { file: 'icon-192.png', size: 192, layout: { plate: 'rounded' }, opaque: false },
  { file: 'icon-512.png', size: 512, layout: { plate: 'rounded' }, opaque: false },
  { file: 'icon-maskable-192.png', size: 192, layout: { plate: 'square', grid: 0.52 }, opaque: true },
  { file: 'icon-maskable-512.png', size: 512, layout: { plate: 'square', grid: 0.52 }, opaque: true },
  { file: 'apple-touch-icon.png', size: 180, layout: { plate: 'square', grid: 0.68 }, opaque: true }
];

// ---- QR code for the hosted link (Settings › On your phone, shown on a laptop: point the iPhone
// camera at it). Byte mode, error correction level M, versions 1-6 (no version-info block needed).
// Written from the QR specification (ISO/IEC 18004); checked by tests/platform.test.js (an
// independent reader + Reed-Solomon syndromes) and by the browser's BarcodeDetector during QA.
const QR_M = { // version: [ecc codewords per block, blocks, data codewords per block]
  1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44], 4: [18, 2, 32], 5: [24, 2, 43], 6: [16, 4, 27]
};
const QR_ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 255;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}
const QR_MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
];
function qrFormatBits(mask) { // level M = 00
  const data = (0 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function qrMatrix(text, opts) {
  opts = opts || {};
  const bytes = Buffer.from(String(text), 'utf8');
  let version = 0;
  for (let v = 1; v <= 6; v++) { const [, blocks, dpb] = QR_M[v]; if (4 + 8 + bytes.length * 8 <= blocks * dpb * 8) { version = v; break; } }
  if (!version) throw new Error('text too long for a version 1-6 QR code');
  const [eccLen, nBlocks, dataPerBlock] = QR_M[version];
  const capacity = nBlocks * dataPerBlock;
  // data codewords: mode 0100, 8-bit length, bytes, terminator, pad
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(4, 4); push(bytes.length, 8); for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; data.length < capacity; p++) data.push(p % 2 ? 0x11 : 0xec);
  // blocks + error correction, interleaved
  const div = rsDivisor(eccLen), blocks = [];
  for (let b = 0; b < nBlocks; b++) { const d = data.slice(b * dataPerBlock, (b + 1) * dataPerBlock); blocks.push({ d, e: rsRemainder(d, div) }); }
  const code = [];
  for (let i = 0; i < dataPerBlock; i++) blocks.forEach((bl) => code.push(bl.d[i]));
  for (let i = 0; i < eccLen; i++) blocks.forEach((bl) => code.push(bl.e[i]));
  // function patterns
  const size = 17 + 4 * version;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = QR_ALIGN[version];
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask) => {
    const f = qrFormatBits(mask), bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // the dark module
  };
  drawFormat(0); // reserve the format areas
  // data, zigzag from the bottom-right corner
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && k < code.length * 8) { mod[y][x] = ((code[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
    }
  }
  // pick the mask with the lowest penalty
  const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && QR_MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  const penalty = () => {
    let p = 0, dark = 0;
    const lines = [];
    for (let i = 0; i < size; i++) { lines.push(mod[i].slice()); lines.push(mod.map((r) => r[i])); }
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      const s = line.map((v) => (v ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) { let at = s.indexOf(pat); while (at !== -1) { p += 40; at = s.indexOf(pat, at + 1); } }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
    p += 10 * Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size));
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty();
    if (p < bestP) { bestP = p; best = m; }
    applyMask(m); // undo (XOR)
  }
  if (opts.mask >= 0 && opts.mask < 8) best = opts.mask; // tests: try every mask
  applyMask(best); drawFormat(best);
  return { version, size, mask: best, modules: mod, codewords: code, eccLen, nBlocks, dataPerBlock };
}

function qrSvg(text, opts) {
  const q = qrMatrix(text, opts), quiet = 4, n = q.size + quiet * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + n * 6 + '" height="' + n * 6 + '" shape-rendering="crispEdges" role="img" aria-label="QR code: ' + text + '">' +
    '<rect width="' + n + '" height="' + n + '" fill="#ffffff"/><path fill="#000000" d="' + d + '"/></svg>\n';
}

// The link the QR code points at: the same constant the app shows (CC.App.HOSTED_URL in js/app.js).
function hostedUrl() {
  const m = /var HOSTED_URL = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8'));
  if (!m) throw new Error('HOSTED_URL not found in js/app.js');
  return m[1];
}
const QR_FILE = 'qr-cube-coach.svg';

function build() {
  const out = ICONS.map((ic) => ({ file: ic.file, size: ic.size, png: encodePNG(drawMark(ic.size, ic.layout), ic.opaque) }));
  out.push({ file: QR_FILE, size: 0, png: Buffer.from(qrSvg(hostedUrl()), 'utf8') });
  return out;
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'icons');
  const check = process.argv.includes('--check');
  let stale = 0;
  if (!check) fs.mkdirSync(dir, { recursive: true });
  for (const out of build()) {
    const p = path.join(dir, out.file);
    if (check) {
      const same = fs.existsSync(p) && fs.readFileSync(p).equals(out.png);
      if (!same) { stale++; console.log('out of date: icons/' + out.file); }
    } else {
      fs.writeFileSync(p, out.png);
      console.log('wrote icons/' + out.file + (out.size ? ' (' + out.size + '×' + out.size + ', ' : ' (') + out.png.length + ' bytes)');
    }
  }
  if (check) { console.log(stale ? stale + ' icon(s) out of date: run node tools/make-icons.js' : 'icons are up to date'); process.exit(stale ? 1 : 0); }
}

module.exports = { ICONS, build, drawMark, encodePNG, crc32, sdRoundRect, PLATE, STICKERS, qrMatrix, qrSvg, hostedUrl, QR_FILE, rsRemainder, gfMul };
