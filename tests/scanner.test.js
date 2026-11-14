// node tests/scanner.test.js
const assert = require('assert');
require('../js/cube.js');
require('../js/scanner.js');
const Cube = globalThis.CC.Cube;
const Scanner = globalThis.CC.Scanner;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e && e.stack || e); process.exitCode = 1; }
}

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
// Realistic webcam sticker colours (sRGB) — deliberately the same family as the scanner's defaults.
const PALETTE = { W: [225, 228, 222], Y: [225, 205, 40], G: [20, 155, 75], B: [15, 75, 175], R: [185, 25, 40], O: [240, 105, 25] };
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = (v) => { v = Math.min(1, Math.max(0, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
const gauss = (rnd) => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) * Math.SQRT2; };
const randomCube = (seed) => Cube.applyAlg(Cube.solved(), Cube.scramble(25, seed));
const same = (a, b) => a.join('') === b.join('');

/* Simulated scan of a cube held in the standard scan frame. Per face: an auto-exposure gain,
 * a shared colour cast (with a little per-face drift), a lighting gradient across the face,
 * per-sticker brightness variation, occasional specular glare and sensor noise.
 * cast: 'neutral' | 'warm' | 'cool' | 'random' (random kind and strength). */
function observe(state, rnd, cfg) {
  let kind = cfg.cast || 'random';
  let str = cfg.castStr * (kind === 'random' ? rnd() : 1);
  if (kind === 'random') kind = ['neutral', 'warm', 'cool'][Math.floor(rnd() * 3)];
  const cast = kind === 'warm' ? [1 + 0.15 * str, 1, 1 - 0.32 * str]
    : kind === 'cool' ? [1 - 0.15 * str, 1 - 0.02 * str, 1 + 0.25 * str] : [1, 1, 1];
  const palette = cfg.palette || PALETTE;
  const faces = {};
  Scanner.SCAN_ORDER.forEach((e) => {
    const fi = FACES.indexOf(e.face);
    const gain = cfg.gainLo + (cfg.gainHi - cfg.gainLo) * rnd();
    const fc = cast.map((m) => m * (1 + (rnd() - 0.5) * cfg.castJitter));
    const gx = (rnd() - 0.5) * 2 * cfg.gradient, gy = (rnd() - 0.5) * 2 * cfg.gradient;
    const arr = [];
    for (let k = 0; k < 9; k++) {
      const r = Math.floor(k / 3), c = k % 3;
      const shade = (1 + gx * (c - 1) + gy * (r - 1)) * (1 + (rnd() - 0.5) * cfg.stickerVar);
      let s = palette[state[fi * 9 + k]].map((x, ch) => toSrgb(toLin(x) * fc[ch] * gain * shade));
      if (rnd() < cfg.specP) { const m = cfg.specMax * rnd(); s = s.map((x) => x + (255 - x) * m); }
      arr.push(s.map((x) => Math.min(255, Math.max(0, Math.round(x + gauss(rnd) * cfg.noise)))));
    }
    faces[e.face] = arr;
  });
  return faces;
}
const MODERATE = { gainLo: 0.65, gainHi: 1.35, castStr: 1, castJitter: 0.06, gradient: 0.06, stickerVar: 0.06, specP: 0.05, specMax: 0.25, noise: 5 };
const HEAVY = { gainLo: 0.55, gainHi: 1.5, castStr: 1.4, castJitter: 0.12, gradient: 0.12, stickerVar: 0.12, specP: 0.15, specMax: 0.45, noise: 12 };

function batch(cfg, n, seed) {
  const out = { n, exact: 0, silentWrong: 0, repaired: 0, invalid: 0, stickerErrors: 0, confusions: {}, warned: 0, uncertainTotal: 0 };
  for (let i = 0; i < n; i++) {
    const rnd = Cube.mulberry32(seed + i);
    const truth = randomCube(seed * 31 + i);
    const res = Scanner.classifyCube(observe(truth, rnd, cfg));
    assert.strictEqual(res.state.length, 54);
    assert.strictEqual(res.confidence.length, 54);
    const wrong = [];
    res.state.forEach((l, k) => {
      if (l !== truth[k]) { wrong.push(k); const key = truth[k] + '>' + l; out.confusions[key] = (out.confusions[key] || 0) + 1; }
    });
    out.stickerErrors += wrong.length;
    if (!wrong.length) out.exact++;
    if (res.repaired) out.repaired++;
    if (!res.validation.ok) out.invalid++;
    if (res.warnings.length) out.warned++;
    out.uncertainTotal += res.uncertain.length;
    // "silent": a wrong answer that is valid, not marked repaired, and highlights none of the wrong stickers
    if (wrong.length && res.validation.ok && !res.repaired && !wrong.some((k) => res.uncertain.includes(k))) out.silentWrong++;
  }
  return out;
}
const pairErrors = (b, x, y) => (b.confusions[x + '>' + y] || 0) + (b.confusions[y + '>' + x] || 0);

// ------------------------------------------------------------------ holds & geometry
test('SCAN_ORDER: six holds, standard centres, plain-English instructions', () => {
  const S = Scanner.SCAN_ORDER;
  assert.deepStrictEqual(S.map((e) => e.face).join(''), 'FRBLUD');
  assert.deepStrictEqual(S.map((e) => e.center).join(''), 'GRBOWY');
  assert.deepStrictEqual(S.map((e) => e.up).join(''), 'WWWWBG');
  S.forEach((e) => {
    assert.strictEqual(Cube.SCHEME[e.face], e.center, 'centre colour of ' + e.face);
    assert.ok(/Show the [A-Z]+ centre to the camera, [A-Z]+ on top/.test(e.say), e.say);
    assert.ok(e.tip && e.tip.length > 20);
  });
});

// Camera on +z looking back at the cube, world +y up, world +x = camera's right = right of the raw image.
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const faceOfColour = {};
Object.keys(Cube.SCHEME).forEach((f) => { faceOfColour[Cube.SCHEME[f]] = f; });
// world-from-cube map of a hold: rows (camera right, up, toward camera)
function hold(e) {
  const n = Cube.NORMAL[e.face], u = Cube.NORMAL[faceOfColour[e.up]];
  return [cross(u, n), u, n];
}
const toWorld = (M, p) => [dot(M[0], p), dot(M[1], p), dot(M[2], p)].map((v) => v + 0);   // + 0 turns -0 into 0

test('scan holds: raw camera cell (row, col) is exactly sticker (face, row, col)', () => {
  Scanner.SCAN_ORDER.forEach((e) => {
    const M = hold(e), fi = FACES.indexOf(e.face);
    for (let k = 0; k < 9; k++) {
      const s = Cube.STICKERS[fi * 9 + k];
      const w = toWorld(M, s.cubie);
      assert.strictEqual(w[2], 1, 'shown face is toward the camera');
      assert.strictEqual(1 - w[1], s.row, e.face + ' row of sticker ' + k);
      assert.strictEqual(w[0] + 1, s.col, e.face + ' col of sticker ' + k);
    }
  });
});

test('scan tips: next face is on the learner\'s left; U and D tips reach the right hold', () => {
  const S = Scanner.SCAN_ORDER;
  // learner faces the camera, so their LEFT is the camera's right (+x)
  for (let i = 0; i < 4; i++) {
    const next = i < 3 ? S[i + 1].face : 'F';   // after ORANGE, "the same way once more" brings GREEN back
    assert.deepStrictEqual(toWorld(hold(S[i]), Cube.NORMAL[next]), [1, 0, 0], 'after step ' + i);
  }
  assert.ok(/left/i.test(S[1].tip) && /same way/i.test(S[2].tip) && /same way/i.test(S[3].tip));
  // "tip the top of the cube toward the camera" from the GREEN hold: world rotation y -> z, z -> -y
  const tipToCamera = (w) => [w[0], -w[2], w[1]].map((v) => v + 0);
  const F = hold(S[0]);
  assert.deepStrictEqual(tipToCamera(toWorld(F, Cube.NORMAL.U)), [0, 0, 1], 'white faces camera');
  assert.deepStrictEqual(tipToCamera(toWorld(F, Cube.NORMAL.B)), [0, 1, 0], 'blue on top');
  // "flip top over bottom" from the WHITE hold: half turn about the camera's left-right axis
  const flip = (w) => [w[0], -w[1], -w[2]].map((v) => v + 0);
  const U = hold(S[4]);
  assert.deepStrictEqual(flip(toWorld(U, Cube.NORMAL.D)), [0, 0, 1], 'yellow faces camera');
  assert.deepStrictEqual(flip(toWorld(U, Cube.NORMAL.F)), [0, 1, 0], 'green on top');
});

// ------------------------------------------------------------------ colour maths
test('rgbToLab matches reference CIE Lab (D65) values', () => {
  const cases = [
    [[255, 255, 255], [100, 0, 0]],
    [[0, 0, 0], [0, 0, 0]],
    [[255, 0, 0], [53.2408, 80.0925, 67.2032]],
    [[0, 255, 0], [87.7347, -86.1827, 83.1793]],
    [[0, 0, 255], [32.2970, 79.1875, -107.8602]],
    [[128, 128, 128], [53.5850, 0, 0]],
    [[255, 255, 0], [97.1393, -21.5537, 94.4780]]
  ];
  cases.forEach(([rgb, lab]) => {
    const got = Scanner.rgbToLab(rgb[0], rgb[1], rgb[2]);
    got.forEach((v, i) => assert.ok(Math.abs(v - lab[i]) < 0.05, rgb + ' -> ' + got + ' expected ' + lab));
    assert.deepStrictEqual(Scanner.rgbToLab(rgb), got, 'array form');
  });
});

test('Hungarian assignment equals brute force on random matrices', () => {
  const rnd = Cube.mulberry32(42);
  const permute = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permute(arr.slice(0, i).concat(arr.slice(i + 1))).map((p) => [x].concat(p)));
  for (let t = 0; t < 300; t++) {
    const n = 1 + Math.floor(rnd() * 7);
    const integer = t % 2 === 0;   // integer costs have many ties
    const cost = Array.from({ length: n }, () => Array.from({ length: n }, () => integer ? Math.floor(rnd() * 5) : rnd() * 100));
    const a = Scanner.hungarian(cost);
    assert.deepStrictEqual(a.slice().sort((x, y) => x - y), Array.from({ length: n }, (_, i) => i), 'a permutation');
    const got = a.reduce((s, j, i) => s + cost[i][j], 0);
    let best = Infinity;
    permute(Array.from({ length: n }, (_, i) => i)).forEach((p) => { best = Math.min(best, p.reduce((s, j, i) => s + cost[i][j], 0)); });
    assert.ok(Math.abs(got - best) < 1e-9, 'n=' + n + ' got ' + got + ' best ' + best);
  }
  // rectangular (more columns than rows)
  const rect = [[4, 1, 3, 9], [2, 0, 5, 9], [3, 2, 2, 0]];
  const ra = Scanner.hungarian(rect);
  assert.strictEqual(ra.reduce((s, j, i) => s + rect[i][j], 0), 1 + 2 + 0);
});

// ------------------------------------------------------------------ sampling
test('sampleCells: per-channel median and uniformity from a synthetic raw frame', () => {
  const w = 320, h = 180, data = new Uint8ClampedArray(w * h * 4), rnd = Cube.mulberry32(7);
  const g = Scanner.guideRect(w, h);
  assert.ok(Math.abs(g.size - 0.55 * 180) < 1e-9 && Math.abs(g.x + g.size / 2 - 160) < 1e-9 && Math.abs(g.y + g.size / 2 - 90) < 1e-9);
  const colours = ['W', 'R', 'O', 'Y', 'G', 'B', 'R', 'O', 'W'].map((c) => PALETTE[c]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let px = [60 + rnd() * 40, 55 + rnd() * 40, 50 + rnd() * 40];                 // background
      const inBody = x >= g.x - 3 && x < g.x + g.size + 3 && y >= g.y - 3 && y < g.y + g.size + 3;
      if (inBody) px = [18, 18, 20];                                                  // black plastic
      const c = Math.floor((x - g.x) / g.cell), r = Math.floor((y - g.y) / g.cell);
      if (inBody && c >= 0 && c < 3 && r >= 0 && r < 3) {
        const lx = x - g.x - c * g.cell, ly = y - g.y - r * g.cell;
        if (lx > 2.5 && lx < g.cell - 2.5 && ly > 2.5 && ly < g.cell - 2.5) px = colours[r * 3 + c].map((v) => v + gauss(rnd) * 8);
        // a glare spot near the corner of the sampled area of cell (0,1)
        if (r === 0 && c === 1 && Math.hypot(lx - g.cell * 0.68, ly - g.cell * 0.68) < 4) px = [255, 255, 255];
      }
      data.set([px[0], px[1], px[2], 255], (y * w + x) * 4);
    }
  }
  const cells = Scanner.sampleCells({ data, width: w, height: h });
  assert.strictEqual(cells.length, 9);
  cells.forEach((cell, k) => {
    cell.rgb.forEach((v, ch) => assert.ok(Math.abs(v - colours[k][ch]) <= 6, 'cell ' + k + ' ch ' + ch + ': ' + cell.rgb + ' vs ' + colours[k]));
    assert.ok(cell.std < 22, 'uniform patch (the glare pixels on cell 1 are dropped), std ' + cell.std);
  });
  assert.strictEqual(cells.grid, 12, 'every border between cells shows the black gap');
  // a frame with no cube (random clutter) is not uniform
  const clutter = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : rnd() * 255));
  const bad = Scanner.sampleCells({ data: clutter, width: w, height: h });
  assert.ok(bad.every((c) => c.std > 22));
  // a plain wall / shirt / sheet of paper: uniform, but no seams
  const wall = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) wall.set([228 + gauss(rnd) * 4, 226 + gauss(rnd) * 4, 220 + gauss(rnd) * 4, 255], i * 4);
  const wc = Scanner.sampleCells({ data: wall, width: w, height: h });
  assert.ok(wc.every((c) => c.std < 22) && wc.grid === 0, 'wall: uniform, grid ' + wc.grid);
});

// ------------------------------------------------------------------ synthetic raw frames (pixel level)
/* renderFace(colours9, rnd, p) -> {data, width, height}: a 320x180 raw frame (the size the controller
 * samples) with one cube face: black body, stickers with gaps, shifted/scaled/rotated off the guide,
 * a lighting gradient, glare blobs (radius in cells, soft edge) and sensor noise. */
function renderFace(cols, rnd, p) {
  const w = 320, h = 180, data = new Uint8ClampedArray(w * h * 4);
  const g = Scanner.guideRect(w, h), pitch = g.cell * (p.scale || 1);
  const cx = g.x + g.size / 2 + (p.dx || 0) * g.cell, cy = g.y + g.size / 2 + (p.dy || 0) * g.cell;
  const cos = Math.cos(p.rot || 0), sin = Math.sin(p.rot || 0), gap = p.gapFrac == null ? 0.06 : p.gapFrac;
  const glares = [], which = new Set();
  while (which.size < (p.glareN || 0)) which.add(Math.floor(rnd() * 9));
  which.forEach((k) => glares.push({ u: (k % 3) + 0.25 + 0.5 * rnd(), v: Math.floor(k / 3) + 0.25 + 0.5 * rnd(), r: (p.glareR || 0.2) * (0.7 + 0.6 * rnd()), i: p.glareI || 0.9 }));
  const gx = (rnd() - 0.5) * 2 * (p.gradient || 0), gy = (rnd() - 0.5) * 2 * (p.gradient || 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x + 0.5 - cx, Y = y + 0.5 - cy;
      const u = (cos * X + sin * Y) / pitch + 1.5, v = (-sin * X + cos * Y) / pitch + 1.5;
      let px = [150 + 30 * Math.sin(x / 13), 120 + 20 * Math.sin(y / 9), 100];         // the learner behind
      if (u >= -0.05 && u < 3.05 && v >= -0.05 && v < 3.05) {
        px = [22, 22, 25];                                                              // black body
        const c = Math.floor(u), r = Math.floor(v), fu = u - c, fv = v - r;
        if (c >= 0 && c < 3 && r >= 0 && r < 3 && fu > gap && fu < 1 - gap && fv > gap && fv < 1 - gap) {
          const shade = 1 + gx * (u - 1.5) / 1.5 + gy * (v - 1.5) / 1.5;
          px = cols[r * 3 + c].map((s) => toSrgb(toLin(s) * shade));
          glares.forEach((G) => { const d = Math.hypot(u - G.u, v - G.v); if (d < G.r) { const m = G.i * (1 - (d / G.r) ** 2); px = px.map((s) => s + (255 - s) * m); } });
        }
      }
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) data[o + ch] = px[ch] + gauss(rnd) * (p.noise || 0);
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

// ------------------------------------------------------------------ classification
test('classifyCube: >= 99% exact recovery on 500 random cubes at moderate noise', () => {
  const b = batch(MODERATE, 500, 1000);
  assert.ok(b.exact / b.n >= 0.99, JSON.stringify(b));
  assert.strictEqual(b.silentWrong, 0, JSON.stringify(b));
  assert.ok(b.warned <= 5, 'few warnings on good scans: ' + b.warned);
  assert.ok(b.uncertainTotal / b.n < 1, 'few stickers flagged uncertain: ' + b.uncertainTotal / b.n);
  console.log('  moderate noise:', b.exact + '/' + b.n, 'exact,', b.repaired, 'repaired,', b.stickerErrors, 'sticker errors');
});

test('classifyCube: hard pairs (red/orange, white/yellow) under strong warm and cool light', () => {
  ['warm', 'cool'].forEach((cast, ci) => {
    const b = batch(Object.assign({}, MODERATE, { cast, castStr: 1.8 }), 300, 2000 + ci * 1000);
    assert.ok(b.exact / b.n >= 0.99, cast + ' ' + JSON.stringify(b));
    assert.ok(pairErrors(b, 'R', 'O') <= 2 && pairErrors(b, 'W', 'Y') <= 2, cast + ' ' + JSON.stringify(b.confusions));
    console.log('  strong ' + cast + ' light:', b.exact + '/' + b.n, 'exact');
  });
  // a cube whose red and orange are unusually close, under random casts
  const close = { W: [230, 232, 228], Y: [240, 225, 30], G: [0, 180, 80], B: [10, 90, 200], R: [205, 30, 30], O: [240, 90, 15] };
  const b = batch(Object.assign({}, MODERATE, { palette: close }), 300, 4000);
  assert.ok(b.exact / b.n >= 0.99, 'close palette ' + JSON.stringify(b));
  // single samples: canonical red and orange, warm-lit white and yellow, stay apart
  const warm = (rgb) => rgb.map((v, ch) => toSrgb(toLin(v) * [1.25, 1, 0.6][ch]));
  const refs = Scanner.liveRefs([]);
  assert.strictEqual(Scanner.classifyColour(PALETTE.R, refs).letter, 'R');
  assert.strictEqual(Scanner.classifyColour(PALETTE.O, refs).letter, 'O');
  // after the white centre has been captured under that warm light, white and yellow separate
  const warmRefs = Scanner.liveRefs([{ rgb: Array(9).fill(warm(PALETTE.G)) }, { rgb: Array(9).fill(warm(PALETTE.R)) },
    null, null, { rgb: Array(9).fill(warm(PALETTE.W)) }, null]);
  assert.strictEqual(Scanner.classifyColour(warm(PALETTE.W), warmRefs).letter, 'W');
  assert.strictEqual(Scanner.classifyColour(warm(PALETTE.Y), warmRefs).letter, 'Y');
  assert.strictEqual(Scanner.classifyColour(warm(PALETTE.O), warmRefs).letter, 'O');
});

test('classifyCube: heavy noise degrades gracefully (repaired or flagged, never silently wrong)', () => {
  const b = batch(HEAVY, 500, 5000);
  assert.ok(b.exact / b.n >= 0.95, JSON.stringify(b));
  assert.strictEqual(b.silentWrong, 0, JSON.stringify(b));
  assert.ok(b.repaired > 0, 'repair is exercised');
  console.log('  heavy noise:', b.exact + '/' + b.n, 'exact,', b.repaired, 'repaired,', b.invalid, 'left invalid (flagged)');
});

/* Harder lighting, per face (classify level). cast = [r,g,b] multipliers in linear light; darkFace = one
 * random face's exposure multiplied by this; glareN stickers per face washed toward white by glareMix;
 * gapN stickers per face darkened toward the black plastic by gapMix (a cell sample that caught part of
 * the gap); castJitter = per-face auto-white-balance drift. */
function observeHard(state, rnd, cfg) {
  const palette = cfg.palette || PALETTE, faces = {};
  const dark = cfg.darkFace ? Math.floor(rnd() * 6) : -1;
  Scanner.SCAN_ORDER.forEach((e, step) => {
    const fi = FACES.indexOf(e.face);
    let gain = cfg.gainLo + (cfg.gainHi - cfg.gainLo) * rnd();
    if (step === dark) gain *= cfg.darkFace;
    const fc = (cfg.cast || [1, 1, 1]).map((m) => m * (1 + (rnd() - 0.5) * (cfg.castJitter || 0)));
    const gx = (rnd() - 0.5) * 2 * (cfg.gradient || 0), gy = (rnd() - 0.5) * 2 * (cfg.gradient || 0);
    const glare = new Set(), gap = new Set();
    while (glare.size < (cfg.glareN || 0)) glare.add(Math.floor(rnd() * 9));
    while (gap.size < (cfg.gapN || 0)) gap.add(Math.floor(rnd() * 9));
    const arr = [];
    for (let k = 0; k < 9; k++) {
      const r = Math.floor(k / 3), c = k % 3;
      const shade = (1 + gx * (c - 1) + gy * (r - 1)) * (1 + (rnd() - 0.5) * (cfg.stickerVar || 0));
      let lin = palette[state[fi * 9 + k]].map((x, ch) => toLin(x) * fc[ch] * gain * shade);
      if (gap.has(k)) { const m = cfg.gapMix[0] + (cfg.gapMix[1] - cfg.gapMix[0]) * rnd(); lin = lin.map((v) => v * (1 - m) + 0.006 * m); }
      let srgb = lin.map(toSrgb);
      if (glare.has(k)) { const m = cfg.glareMix[0] + (cfg.glareMix[1] - cfg.glareMix[0]) * rnd(); srgb = srgb.map((x) => x + (255 - x) * m); }
      arr.push(srgb.map((x) => Math.min(255, Math.max(0, Math.round(x + gauss(rnd) * (cfg.noise || 0))))));
    }
    faces[e.face] = arr;
  });
  return faces;
}
// another brand's colours as a webcam sees them: redder orange, bluish white
const PAL2 = { W: [200, 210, 215], Y: [215, 210, 60], G: [40, 170, 90], B: [30, 70, 160], R: [200, 45, 55], O: [235, 110, 50] };
const HB = { gainLo: 0.7, gainHi: 1.3, castJitter: 0.06, gradient: 0.08, stickerVar: 0.06, noise: 5 };
const HARD = {
  '2700K, camera white balance off': Object.assign({}, HB, { cast: [1.9, 1, 0.33] }),
  'one face 3x darker': Object.assign({}, HB, { cast: [1.1, 1, 0.85], darkFace: 0.3 }),
  'one face 5x darker': Object.assign({}, HB, { cast: [1.1, 1, 0.85], darkFace: 0.18 }),
  'glare on 3 stickers per face': Object.assign({}, HB, { glareN: 3, glareMix: [0.3, 0.6] }),
  'gap in 2 cell samples per face': Object.assign({}, HB, { gapN: 2, gapMix: [0.2, 0.45] }),
  'white balance drifting per face': Object.assign({}, HB, { cast: [1.3, 1, 0.65], castJitter: 0.3, darkFace: 0.4, glareN: 2, glareMix: [0.25, 0.5], noise: 6 }),
  'all at once (warm)': Object.assign({}, HB, { cast: [1.45, 1, 0.55], darkFace: 0.35, glareN: 2, glareMix: [0.25, 0.5], gapN: 2, gapMix: [0.15, 0.35], noise: 7 }),
  'all at once (other brand)': Object.assign({}, HB, { palette: PAL2, cast: [1.3, 1, 0.65], darkFace: 0.4, glareN: 2, glareMix: [0.25, 0.5], gapN: 1, gapMix: [0.15, 0.35], noise: 6 })
};
function batchHard(cfg, n, seed) {
  const out = { n, exact: 0, silentWrong: 0, repaired: 0, repairedWrong: 0, invalid: 0 };
  for (let i = 0; i < n; i++) {
    const truth = randomCube(seed * 31 + i);
    const res = Scanner.classifyCube(observeHard(truth, Cube.mulberry32(seed + i), cfg));
    const wrong = [];
    res.state.forEach((l, k) => { if (l !== truth[k]) wrong.push(k); });
    if (!wrong.length) out.exact++;
    if (res.repaired) { out.repaired++; if (wrong.length) out.repairedWrong++; }
    if (!res.validation.ok) out.invalid++;
    if (wrong.length && res.validation.ok && !res.repaired && !wrong.some((k) => res.uncertain.includes(k))) out.silentWrong++;
  }
  return out;
}

// Measured on 300 cubes per row before this classifier (plain weighted Lab, linear chroma) and after:
//   glare on 3 stickers 249 -> 300, all at once (warm) 212 -> 291, all at once (other brand) 236 -> 295,
//   white balance drifting 259 -> 299; the other rows 300 -> 300.
test('classifyCube: hard lighting (2700K, a dark face, glare, gaps in the samples, white-balance drift)', () => {
  Object.keys(HARD).forEach((name, si) => {
    const b = batchHard(HARD[name], 150, 10000 + si * 1000);
    const all = /all at once/.test(name);
    assert.ok(b.exact / b.n >= (all ? 0.93 : 0.98), name + ' ' + JSON.stringify(b));
    assert.strictEqual(b.silentWrong, 0, name + ' ' + JSON.stringify(b));
    console.log('  ' + (name + ':').padEnd(33), b.exact + '/' + b.n, 'exact,', b.repaired, 'repaired (' + b.repairedWrong + ' wrong, flagged),', b.invalid, 'flagged as not a real cube');
  });
});

test('repair: never touches a valid read, and a wrong repair is rare and highlighted', () => {
  // a read that is already a real cube is never "repaired"
  for (let i = 0; i < 100; i++) {
    const truth = randomCube(40000 + i);
    const res = Scanner.classifyCube(observe(truth, Cube.mulberry32(41000 + i), MODERATE));
    if (Scanner.classifyCube(observe(truth, Cube.mulberry32(41000 + i), MODERATE), { repair: false }).validation.ok) assert.strictEqual(res.repaired, false);
  }
  // under very hard light: repairs are mostly right; a wrong repair still highlights wrong stickers
  let repaired = 0, wrongRepairs = 0, wrongStickers = 0, highlighted = 0;
  for (let i = 0; i < 400; i++) {
    const truth = randomCube(42000 + i);
    const res = Scanner.classifyCube(observeHard(truth, Cube.mulberry32(43000 + i), HARD['all at once (warm)']));
    if (!res.repaired) continue;
    repaired++;
    const wrong = res.state.map((l, k) => (l !== truth[k] ? k : -1)).filter((k) => k >= 0);
    if (!wrong.length) continue;
    wrongRepairs++; wrongStickers += wrong.length; highlighted += wrong.filter((k) => res.uncertain.includes(k)).length;
    assert.ok(wrong.some((k) => res.uncertain.includes(k)), 'a wrong repair highlights at least one wrong sticker');
  }
  assert.ok(repaired >= 40 && wrongRepairs / repaired <= 0.1, repaired + ' repairs, ' + wrongRepairs + ' wrong');
  console.log('  repairs under very hard light:', repaired, 'of which', wrongRepairs, 'wrong;', highlighted + '/' + wrongStickers, 'wrong stickers highlighted');
});

test('classifyCube: RED and ORANGE faces scanned in each other\'s slot are swapped back', () => {
  const truth = randomCube(4321);
  const faces = observe(truth, Cube.mulberry32(4322), MODERATE);
  const res = Scanner.classifyCube(Object.assign({}, faces, { R: faces.L, L: faces.R }));
  assert.ok(res.validation.ok && same(res.state, truth) && res.swappedRedOrange);
  assert.ok(res.warnings.some((w) => /RED and ORANGE faces/.test(w)), res.warnings.join(' | '));
  assert.strictEqual(Scanner.classifyCube(faces).swappedRedOrange, false);
});

// Pixel level: synthetic raw frames -> sampleCells -> classifyCube. Measured on 150 cubes per row,
// original sampler + classifier -> now: glare blobs 138 -> 150, very misaligned 86 -> 131,
// misaligned + glare 148 -> 150, big glare 76 -> 108; aligned / misaligned / thick gaps 150 -> 150.
test('sampleCells + classifyCube: misaligned cubes, glare blobs and thick gaps in real frames', () => {
  const FACE = { gainLo: 0.7, gainHi: 1.3, cast: [1.25, 1, 0.7], castJitter: 0.08, gradient: 0, stickerVar: 0.06, noise: 0, specP: 0, castStr: 0 };
  const PIX = {
    'held 30% of a cell off, tilted': [{ offset: 0.3, scaleJit: 0.1, rotJit: 0.08, noise: 6, gradient: 0.1 }, 0.95],
    'held 40% of a cell off': [{ offset: 0.4, scaleJit: 0.12, rotJit: 0.1, noise: 6, gradient: 0.1 }, 0.7],
    'glare blobs on 3 stickers': [{ offset: 0.1, scaleJit: 0.05, rotJit: 0.04, noise: 6, gradient: 0.1, glareN: 3, glareR: 0.3, glareI: 0.95 }, 0.95],
    'off-centre + glare': [{ offset: 0.3, scaleJit: 0.1, rotJit: 0.08, noise: 8, gradient: 0.12, glareN: 2, glareR: 0.3, glareI: 0.9 }, 0.95],
    'thick black gaps, off-centre': [{ offset: 0.3, scaleJit: 0.1, rotJit: 0.05, noise: 6, gradient: 0.1, gapFrac: 0.12 }, 0.95]
  };
  Object.keys(PIX).forEach((name, si) => {
    const [pix, need] = PIX[name];
    let exact = 0, silent = 0;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const seed = 60000 + si * 1000 + i, rnd = Cube.mulberry32(seed), truth = randomCube(seed);
      const cols = observeHard(truth, rnd, FACE), faces = {};
      FACES.forEach((f) => {
        const jit = (a) => (rnd() - 0.5) * 2 * a;
        const p = Object.assign({}, pix, { dx: jit(pix.offset), dy: jit(pix.offset), scale: 1 + jit(pix.scaleJit), rot: jit(pix.rotJit) });
        const cells = Scanner.sampleCells(renderFace(cols[f], rnd, p));
        assert.ok(cells.grid >= 4, name + ': seams seen ' + cells.grid);
        faces[f] = cells;
      });
      const res = Scanner.classifyCube(faces);
      const wrong = res.state.map((l, k) => (l !== truth[k] ? k : -1)).filter((k) => k >= 0);
      if (!wrong.length) exact++;
      if (wrong.length && res.validation.ok && !res.repaired && !wrong.some((k) => res.uncertain.includes(k))) silent++;
    }
    assert.ok(exact / n >= need, name + ': ' + exact + '/' + n);
    assert.strictEqual(silent, 0, name);
    console.log('  ' + (name + ':').padEnd(33), exact + '/' + n, 'exact');
  });
});

test('hungarian refuses non-finite costs instead of looping forever', () => {
  assert.throws(() => Scanner.hungarian([[NaN, 1], [1, 2]]), /finite/);
  assert.throws(() => Scanner.hungarian([[Infinity, Infinity], [1, 2]]), /finite/);
});

// Find a red sticker and an orange sticker (not centres) whose colour swap makes the cube invalid.
function crossablePair(truth) {
  for (let i = 0; i < 54; i++) {
    if (i % 9 === 4 || truth[i] !== 'R') continue;
    for (let j = 0; j < 54; j++) {
      if (j % 9 === 4 || truth[j] !== 'O') continue;
      const s = truth.slice(); s[i] = 'O'; s[j] = 'R';
      if (!Cube.validate(s).ok) return [i, j];
    }
  }
  return null;
}
const sampleAt = (faces, idx) => faces[FACES[Math.floor(idx / 9)]][idx % 9];
const setSample = (faces, idx, rgb) => { faces[FACES[Math.floor(idx / 9)]][idx % 9] = rgb; };
const mix = (a, b, t) => a.map((v, ch) => Math.round(v * (1 - t) + b[ch] * t));

test('repair: an ambiguous red/orange pair read the wrong way round is swapped back', () => {
  let tried = 0, fixed = 0;
  for (let n = 0; n < 40; n++) {
    const truth = randomCube(700 + n);
    const pair = crossablePair(truth);
    if (!pair) continue;
    const [i, j] = pair;
    const faces = observe(truth, Cube.mulberry32(800 + n), Object.assign({}, MODERATE, { noise: 2, specP: 0 }));
    // red sticker looks slightly orange-ish, orange sticker slightly red-ish: a coin flip that lands wrong
    setSample(faces, i, mix(PALETTE.R, PALETTE.O, 0.56));
    setSample(faces, j, mix(PALETTE.R, PALETTE.O, 0.44));
    const plain = Scanner.classifyCube(faces, { repair: false });
    if (plain.validation.ok) continue;   // the clustering already got it right
    tried++;
    const res = Scanner.classifyCube(faces);
    if (res.repaired && res.validation.ok && same(res.state, truth) && res.uncertain.includes(i) && res.uncertain.includes(j)) fixed++;
  }
  assert.ok(tried >= 10, 'enough crossed cases: ' + tried);
  assert.strictEqual(fixed, tried, fixed + '/' + tried + ' repaired');
});

test('repair: a face held turned round is straightened and reported', () => {
  const truth = randomCube(77);
  const faces = observe(truth, Cube.mulberry32(78), MODERATE);
  const g = faces.R, o = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 3 + (2 - r)] = g[r * 3 + c];   // shown a quarter turn off
  faces.R = o;
  const res = Scanner.classifyCube(faces);
  assert.ok(res.repaired && res.validation.ok && same(res.state, truth));
  assert.deepStrictEqual(res.suspectSteps, [1]);
  assert.ok(res.warnings.some((w) => /RED face/.test(w) && /turned/.test(w)), res.warnings.join(' | '));
});

test('physically impossible reads are flagged, not silently accepted', () => {
  // two confidently-read stickers swapped (e.g. a re-stickered cube): no cheap repair exists
  const truth = randomCube(91);
  const faces = observe(truth, Cube.mulberry32(92), Object.assign({}, MODERATE, { noise: 2 }));
  const [i, j] = crossablePair(truth);
  const a = sampleAt(faces, i), b = sampleAt(faces, j);
  setSample(faces, i, b); setSample(faces, j, a);
  const res = Scanner.classifyCube(faces);
  assert.ok(!same(res.state, truth));
  assert.ok(!res.validation.ok || (res.repaired && res.uncertain.length > 0), 'flagged, never silently valid');
  assert.ok(res.warnings.length > 0);
  assert.ok(res.validation.errors.length > 0 || res.repaired);
});

test('wrong-face warnings name the faces to rescan', () => {
  const truth = randomCube(123);
  const base = observe(truth, Cube.mulberry32(124), MODERATE);
  // blue face shown when asked for green, and green when asked for blue
  const swapped = Object.assign({}, base, { F: base.B, B: base.F });
  let res = Scanner.classifyCube(swapped);
  assert.ok(!res.validation.ok);
  assert.deepStrictEqual(res.suspectSteps, [0, 2]);
  assert.ok(res.warnings.some((w) => /GREEN face has a centre that looks BLUE/.test(w)), res.warnings.join(' | '));
  // the red face shown twice (once instead of orange): red vs orange is the hard pair
  res = Scanner.classifyCube(Object.assign({}, base, { L: base.R.map((x) => x.slice()) }));
  assert.ok(!res.validation.ok);
  assert.ok(res.suspectSteps.includes(3), JSON.stringify(res.suspectSteps));
  assert.ok(res.warnings.some((w) => /ORANGE face has a centre that looks RED/.test(w)), res.warnings.join(' | '));
  // white and yellow swapped
  res = Scanner.classifyCube(Object.assign({}, base, { U: base.D, D: base.U }));
  assert.deepStrictEqual(res.suspectSteps, [4, 5]);
  // a good scan has no warnings
  res = Scanner.classifyCube(base);
  assert.ok(res.validation.ok && same(res.state, truth) && res.warnings.length === 0 && res.suspectSteps.length === 0);
});

test('classifyCube accepts {r,g,b} and sampleCells cells, and rejects missing faces', () => {
  const truth = randomCube(5);
  const faces = observe(truth, Cube.mulberry32(6), MODERATE);
  const objs = {};
  FACES.forEach((f, fi) => { objs[f] = faces[f].map((p, k) => (fi % 2 ? { r: p[0], g: p[1], b: p[2] } : { rgb: p, std: 3 })); });
  assert.ok(same(Scanner.classifyCube(objs).state, truth));
  assert.throws(() => Scanner.classifyCube({ U: faces.U }), /9 colour samples/);
});

// ------------------------------------------------------------------ auto-capture session
function cellsFor(faces, step, rnd, jitter) {
  return faces[Scanner.SCAN_ORDER[step].face].map((p) => {
    const rgb = p.map((v) => Math.min(255, Math.max(0, v + gauss(rnd) * (jitter || 1.2))));
    return { rgb, std: 5 + rnd() * 3, mean: 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] };
  });
}
function blurCells(rnd) {   // a cube mid-turn: smeared, non-uniform patches
  return Array.from({ length: 9 }, () => ({ rgb: [rnd() * 200, rnd() * 200, rnd() * 200], std: 35 + rnd() * 30, mean: 90 }));
}

test('session: auto-captures every face exactly once and completes with the right state', () => {
  const truth = randomCube(321);
  const faces = observe(truth, Cube.mulberry32(322), Object.assign({}, MODERATE, { cast: 'warm', castStr: 1.2 }));
  const rnd = Cube.mulberry32(9);
  const ses = Scanner.createSession({ autoCapture: true });
  const captures = [];
  let t = 0, result = null, lastInfo = null;
  const run = (ms, makeCells) => {
    for (const end = t + ms; t < end; t += 33) {
      const out = ses.frame(makeCells(), t);
      lastInfo = out.info;
      if (out.event) { captures.push(out.event.step); if (out.event.result) result = out.event.result; }
    }
  };
  for (let step = 0; step < 6; step++) {
    run(800, () => blurCells(rnd));                          // turning to the face
    run(2500, () => cellsFor(faces, step, rnd));             // holding it (much longer than 600 ms)
    assert.deepStrictEqual(captures, Array.from({ length: step + 1 }, (_, i) => i), 'one capture per face so far');
  }
  assert.ok(result, 'completed');
  assert.ok(same(result.state, truth) && result.validation.ok);
  assert.ok(lastInfo.complete && lastInfo.step === 6 && lastInfo.expected === null);
  assert.deepStrictEqual(lastInfo.captured, [true, true, true, true, true, true]);
});

test('session: waits ~600 ms of stability, rejects wrong and repeated faces, captureNow and redo work', () => {
  const truth = randomCube(654);
  const faces = observe(truth, Cube.mulberry32(655), MODERATE);
  const rnd = Cube.mulberry32(10);
  const ses = Scanner.createSession({ autoCapture: true });
  let t = 0, info, ev;
  const frame = (cells) => { const out = ses.frame(cells, t); t += 33; info = out.info; ev = out.event; return out; };
  // showing BLUE when GREEN is wanted: never captures
  for (let k = 0; k < 60; k++) { frame(cellsFor(faces, 2, rnd)); assert.strictEqual(ev, null); }
  assert.strictEqual(info.centerMatches, false);
  assert.ok(/looks BLUE/.test(info.message), info.message);
  // GREEN: stability builds up, capture happens after ~600 ms, not before
  let firstAt = null;
  const start = t;
  for (let k = 0; k < 40 && firstAt === null; k++) { frame(cellsFor(faces, 0, rnd)); if (ev) firstAt = t - start; }
  assert.ok(firstAt >= 600 && firstAt <= 800, 'captured after ' + firstAt + ' ms');
  assert.strictEqual(info.step, 1);
  // still showing GREEN: no second capture, and a helpful message
  for (let k = 0; k < 60; k++) { frame(cellsFor(faces, 0, rnd)); assert.strictEqual(ev, null); }
  assert.ok(/already scanned the GREEN/.test(info.message), info.message);
  // manual capture always works (even of the wrong view)
  assert.ok(ses.captureNow(t));
  assert.strictEqual(ses.step, 2);
  // redo step 1 and capture RED properly
  assert.ok(ses.redo(1));
  assert.strictEqual(ses.step, 1);
  assert.deepStrictEqual(ses.captured, [true, false, false, false, false, false]);
  for (let k = 0; k < 10; k++) frame(blurCells(rnd));
  for (let k = 0; k < 40 && !ev; k++) frame(cellsFor(faces, 1, rnd));
  assert.ok(ev && ev.step === 1 && ev.letters[4] === 'R');
  assert.ok(!ses.redo(7) && !ses.redo(-1));
  // auto-capture off: ready but no capture
  ses.setAutoCapture(false);
  for (let k = 0; k < 10; k++) frame(blurCells(rnd));
  for (let k = 0; k < 60; k++) { frame(cellsFor(faces, 2, rnd)); assert.strictEqual(ev, null); }
  assert.ok(info.ready && /Press Capture/.test(info.message), info.message);
});

// drive a session: show `cellsFn()` until a capture or `ms` runs out -> { ev, t, info }
function showFor(ses, cellsFn, t0, ms) {
  let t = t0, info = null;
  for (; t < t0 + ms; t += 33) {
    const out = ses.frame(cellsFn(), t);
    info = out.info;
    if (out.event) return { ev: out.event, t: t + 33, info };
  }
  return { ev: null, t, info };
}
const darker = (cells, g) => cells.map((c) => Object.assign({}, c, { rgb: c.rgb.map((v) => toSrgb(toLin(v) * g)) }));

test('session: turning the wrong way (ORANGE before RED) still gives the right cube', () => {
  [['neutral', PALETTE], ['cool', PAL2], ['warm', PAL2]].forEach(([cast, palette], n) => {
    const truth = randomCube(900 + n);
    const faces = observe(truth, Cube.mulberry32(901 + n), Object.assign({}, MODERATE, { cast, castStr: 1.2, palette }));
    const rnd = Cube.mulberry32(902 + n), ses = Scanner.createSession({});
    let t = 0, result = null;
    const events = [];
    [0, 3, 2, 1, 4, 5].forEach((faceStep) => {                    // F, L, B, R, U, D
      const r = showFor(ses, () => cellsFor(faces, faceStep, rnd), t, 3000);
      assert.ok(r.ev, 'captured ' + Scanner.SCAN_ORDER[faceStep].face + ' (' + (r.info && r.info.message) + ')');
      events.push(r.ev);
      if (r.ev.result) result = r.ev.result;
      t = showFor(ses, () => blurCells(rnd), r.t, 400).t;
    });
    // the 4th capture (RED, shown for the ORANGE step) swaps the two faces back and reports both steps
    assert.deepStrictEqual(events[3].updates.map((u) => u.step), [3, 1], cast);
    assert.ok(events[3].swapped && events[3].updates[1].letters[4] === 'R' && events[3].updates[0].letters[4] === 'O');
    assert.ok(result && result.validation.ok && same(result.state, truth), cast);
  });
});

test('session: never captures the RED face again, YELLOW for WHITE, or a plain wall', () => {
  const truth = randomCube(950);
  const faces = observe(truth, Cube.mulberry32(951), Object.assign({}, MODERATE, { cast: 'warm', castStr: 1.4 }));
  const rnd = Cube.mulberry32(952);
  let ses = Scanner.createSession({}), t = 0, r;
  for (let step = 0; step < 3; step++) { t = showFor(ses, () => cellsFor(faces, step, rnd), t, 3000).t; t = showFor(ses, () => blurCells(rnd), t, 400).t; }
  // RED again, 35% darker (auto-exposure changed), when ORANGE is asked for
  r = showFor(ses, () => darker(cellsFor(faces, 1, rnd), 0.65), t, 3000);
  assert.strictEqual(r.ev, null);
  assert.ok(/already scanned the RED/.test(r.info.message), r.info.message);
  t = showFor(ses, () => blurCells(rnd), r.t, 400).t;
  t = showFor(ses, () => cellsFor(faces, 3, rnd), t, 3000).t;          // ORANGE
  t = showFor(ses, () => blurCells(rnd), t, 400).t;
  // YELLOW shown when WHITE is asked for (tipped the wrong way)
  r = showFor(ses, () => cellsFor(faces, 5, rnd), t, 3000);
  assert.strictEqual(r.ev, null);
  assert.ok(/looks YELLOW/.test(r.info.message), r.info.message);
  // a white wall / shirt filling the square: uniform, white, but no seams between the cells
  const wall = () => { const c = cellsFor(faces, 4, rnd).map((x) => ({ rgb: [228, 230, 224].map((v) => v + gauss(rnd)), std: 4, mean: 228 })); c.grid = 0; return c; };
  r = showFor(ses, wall, r.t, 3000);
  assert.strictEqual(r.ev, null);
  assert.ok(!r.info.ready && r.info.looksLikeCube === false && /filling the square/.test(r.info.message), r.info.message);
  // the same colours with the black gaps showing (a solved white face) are a cube face
  r = showFor(ses, () => { const c = wall(); c.grid = 12; return c; }, r.t, 3000);
  assert.ok(r.ev && r.ev.step === 4);
});

test('session: redo needs a fresh steady hold (no instant re-capture of the same view)', () => {
  const truth = randomCube(970);
  const faces = observe(truth, Cube.mulberry32(971), MODERATE);
  const rnd = Cube.mulberry32(972), ses = Scanner.createSession({});
  let r = showFor(ses, () => cellsFor(faces, 0, rnd), 0, 3000);
  r = showFor(ses, () => blurCells(rnd), r.t, 400);
  r = showFor(ses, () => cellsFor(faces, 1, rnd), r.t, 3000);
  assert.ok(r.ev && r.ev.step === 1);
  // still holding RED, steady for a long time; then redo RED
  r = showFor(ses, () => cellsFor(faces, 1, rnd), r.t, 2000);
  assert.strictEqual(r.ev, null);
  assert.ok(ses.redo(1));
  const t0 = r.t;
  r = showFor(ses, () => cellsFor(faces, 1, rnd), t0, 3000);
  assert.ok(r.ev && r.ev.step === 1 && r.t - t0 >= 600, 'recaptured after ' + (r.t - t0) + ' ms');
});

// ------------------------------------------------------------------ overlay (mock 2D context)
function recordingContext() {
  const log = { swatches: [] };
  let lastMove = null;
  const ctx = new Proxy({}, {
    get(target, k) {
      if (k in target) return target[k];
      if (k === 'measureText') return () => ({ width: 50 });
      if (k === 'moveTo') return (x, y) => { lastMove = [x, y]; };
      if (k === 'fill') return () => { if (/^#/.test(String(target.fillStyle))) log.swatches.push({ fill: target.fillStyle, x: lastMove[0] }); };
      return () => {};
    },
    set(target, k, v) { target[k] = v; return true; }
  });
  return { ctx, log };
}

test('overlay: each live swatch sits on the sticker the learner sees (mirrored or not)', () => {
  const W = 1280, H = 720, g = Scanner.guideRect(W, H);
  const live = ['W', 'Y', 'G', 'B', 'R', 'O', 'W', 'Y', 'G'];
  [true, false].forEach((mirror) => {
    const { ctx, log } = recordingContext();
    Scanner.drawOverlay(ctx, W, H, { live, confidence: live.map(() => 1), expected: Scanner.SCAN_ORDER[0], step: 0 }, { mirror, now: 0, flashAt: -1e9, hud: false });
    assert.strictEqual(log.swatches.length, 9);
    log.swatches.forEach((sw, k) => {
      const col = k % 3, shownCol = mirror ? 2 - col : col;
      assert.strictEqual(sw.fill, Cube.COLOR_HEX[live[k]]);
      assert.ok(Math.abs(sw.x - (g.x + (shownCol + 0.5) * g.cell)) < 1e-6, 'raw cell ' + k + ' drawn in column ' + shownCol + (mirror ? ' (mirrored)' : ''));
    });
  });
});

// ------------------------------------------------------------------ controller with a mocked DOM
function withMockDom(fn) {
  const saved = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'), window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame,
    performance: Object.getOwnPropertyDescriptor(globalThis, 'performance'), navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  };
  const env = { now: 0, frame: null, rafs: new Map(), nextRaf: 0, body: null, videos: [] };
  const noopCtx = (extra) => new Proxy(extra || {}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 50 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  env.body = { children: [], appendChild(el) { this.children.push(el); el.parentNode = this; }, removeChild(el) { this.children.splice(this.children.indexOf(el), 1); el.parentNode = null; } };
  globalThis.document = {
    body: env.body,
    createElement(tag) {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => noopCtx({ getImageData: () => env.frame }) };
      const listeners = {};
      const v = {
        tag, style: {}, readyState: 0, videoWidth: 0, videoHeight: 0, srcObject: null, parentNode: null, listeners,
        setAttribute() {}, pause() {},
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
        play() {   // like a browser: the first frame arrives (loadeddata), then play() resolves
          return new Promise((res) => setTimeout(() => {
            v.readyState = 4; v.videoWidth = 1280; v.videoHeight = 720;
            (listeners.loadeddata || []).slice().forEach((f) => f());
            res();
          }, 0));
        }
      };
      env.videos.push(v);
      return v;
    }
  };
  globalThis.requestAnimationFrame = (cb) => { env.rafs.set(++env.nextRaf, cb); return env.nextRaf; };
  globalThis.cancelAnimationFrame = (id) => { env.rafs.delete(id); };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => env.now }, configurable: true, writable: true });
  env.pump = (frames) => {
    for (let i = 0; i < frames; i++) {
      env.now += 33;
      const cbs = Array.from(env.rafs.values());
      env.rafs.clear();
      cbs.forEach((cb) => cb());
    }
  };
  env.track = () => { const tr = { stopped: false, listeners: {}, stop() { this.stopped = true; }, addEventListener(t, f) { this.listeners[t] = f; } }; return tr; };
  env.stream = (tr) => ({ getTracks: () => [tr], getVideoTracks: () => [tr] });
  const restore = () => {
    ['document', 'window', 'performance', 'navigator'].forEach((k) => { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; });
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf;
    if (saved.raf === undefined) delete globalThis.requestAnimationFrame;
    if (saved.caf === undefined) delete globalThis.cancelAnimationFrame;
  };
  return Promise.resolve().then(() => fn(env)).then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
}

const asyncTests = [];
function testAsync(name, fn) { asyncTests.push([name, fn]); }

testAsync('controller: scans a whole cube from a stream, then stop() cleans up everything', () => withMockDom(async (env) => {
  const truth = randomCube(1234), rnd = Cube.mulberry32(1235);
  const cols = observeHard(truth, rnd, { gainLo: 0.85, gainHi: 1.15, cast: [1.15, 1, 0.85] });
  const frames = Scanner.SCAN_ORDER.map((e) => renderFace(cols[e.face], rnd, { dx: 0.05, dy: -0.05, rot: 0.02, noise: 4, gradient: 0.08 }));
  const captures = [], errors = [];
  let complete = null, frameInfo = null;
  const ctrl = Scanner.createController({
    canvas: { width: 0, height: 0, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 50 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } }) },
    onFrame: (i) => { frameInfo = i; }, onCapture: (s, l) => captures.push([s, l.join('')]), onComplete: (r) => { complete = r; }, onError: (e) => errors.push(e)
  });
  const track = env.track();
  env.frame = frames[0];
  await ctrl.useStream(env.stream(track));
  for (let step = 0; step < 6; step++) {
    env.frame = frames[step];
    for (let k = 0; k < 60 && captures.length <= step; k++) env.pump(1);
    assert.strictEqual(captures.length, step + 1, 'step ' + step + ': ' + (frameInfo && frameInfo.message));
    env.frame = { data: new Uint8ClampedArray(320 * 180 * 4).map(() => Math.random() * 255), width: 320, height: 180 };   // turning: clutter
    env.pump(5);
  }
  assert.ok(complete && same(complete.state, truth), 'scanned the cube exactly');
  assert.deepStrictEqual(captures.map((c) => c[0]), [0, 1, 2, 3, 4, 5]);
  assert.strictEqual(errors.length, 0);
  const video = env.videos[0];
  assert.strictEqual(env.body.children.length, 1);
  assert.strictEqual((video.listeners.loadeddata || []).length, 0, 'loadeddata listener removed once the stream started');
  ctrl.stop();
  assert.strictEqual(env.rafs.size, 0, 'animation loop cancelled');
  assert.strictEqual(env.body.children.length, 0, 'hidden video removed');
  assert.ok(!track.stopped, 'a stream passed to useStream belongs to the caller');
  // a track that ends after stop() is not reported
  track.listeners.ended();
  assert.strictEqual(errors.length, 0);
}));

testAsync('controller: camera errors, a camera that drops out, and stop() while starting', () => withMockDom(async (env) => {
  Object.defineProperty(globalThis, 'window', { value: { isSecureContext: true, location: { protocol: 'http:' } }, configurable: true, writable: true });
  let gum = null;
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: () => gum() } }, configurable: true, writable: true });
  const errors = [];
  const ctrl = Scanner.createController({ onError: (e) => errors.push(e) });
  // permission denied: onError AND a rejected promise, with a friendly message
  gum = () => Promise.reject({ name: 'NotAllowedError', message: 'Permission denied' });
  await ctrl.start().then(() => assert.fail('should reject'), (e) => assert.strictEqual(e.code, 'denied'));
  assert.strictEqual(errors.length, 1);
  assert.ok(/Allow/.test(errors[0].message));
  // own stream: started, then the camera is unplugged (track ends) -> reported; stop() stops the track
  const tr = env.track();
  gum = () => Promise.resolve(env.stream(tr));
  await ctrl.start('cam-1');
  tr.listeners.ended();
  assert.strictEqual(errors.length, 2);
  assert.ok(errors[1].code === 'notfound' && /stopped sending pictures/.test(errors[1].message), JSON.stringify(errors[1]));
  ctrl.stop();
  assert.ok(tr.stopped, 'own camera track stopped');
  // stop() while getUserMedia is still pending: the late stream is stopped at once, no error, promise settles
  const late = env.track();
  let resolveGum;
  gum = () => new Promise((res) => { resolveGum = res; });
  const p = ctrl.start();
  ctrl.stop();
  resolveGum(env.stream(late));
  await p;
  assert.ok(late.stopped);
  // a late failure after stop() is not reported either
  let rejectGum;
  gum = () => new Promise((res, rej) => { rejectGum = rej; });
  const p2 = ctrl.start();
  ctrl.stop();
  rejectGum({ name: 'NotReadableError' });
  await p2;
  assert.strictEqual(errors.length, 2);
  // stop() while waiting for the first frame settles useStream's promise (no hang)
  const v0 = env.videos.length;
  const p3 = ctrl.useStream(env.stream(env.track()));
  env.videos[v0].play = () => new Promise(() => {});      // never starts
  ctrl.stop();
  await p3;
}));

// ------------------------------------------------------------------ camera plumbing (no DOM)
test('camera errors map to friendly codes; isSupported is false outside a browser', () => {
  const m = (name) => Scanner.mapCameraError({ name });
  assert.strictEqual(m('NotAllowedError').code, 'denied');
  assert.ok(/Chrome/.test(m('NotAllowedError').message) && /Safari/.test(m('NotAllowedError').message) && /System Settings/.test(m('NotAllowedError').message));
  assert.strictEqual(m('NotFoundError').code, 'notfound');
  assert.strictEqual(m('OverconstrainedError').code, 'notfound');
  assert.strictEqual(m('NotReadableError').code, 'busy');
  assert.strictEqual(m('TrackStartError').code, 'busy');
  assert.strictEqual(m('NotSupportedError').code, 'unsupported');
  assert.strictEqual(m('Weird').code, 'other');
  assert.ok(/localhost:8765/.test(Scanner.CAMERA_MESSAGES.insecure) && /file:/.test(Scanner.CAMERA_MESSAGES.insecure));
  const s = Scanner.isSupported();
  assert.strictEqual(s.ok, false);
  assert.ok(typeof s.reason === 'string' && s.reason.length > 0);
});

test('exports follow the ARCHITECTURE.md contract', () => {
  ['isSupported', 'createController', 'classifyCube', 'rgbToLab', 'createFakeCamera'].forEach((k) => assert.strictEqual(typeof Scanner[k], 'function', k));
  assert.ok(Array.isArray(Scanner.SCAN_ORDER) && Scanner.SCAN_ORDER.length === 6);
  assert.strictEqual(require('../js/scanner.js'), Scanner);
  assert.throws(() => Scanner.createFakeCamera(Cube.solved()), /browser/);
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e && e.stack || e); process.exitCode = 1; }
  }
  console.log(passed + ' scanner tests passed' + (process.exitCode ? ' (with failures)' : ''));
})();
