// node tests/topview.test.js
// CC.TopView (js/topview.js): the last-layer diagram and the small iso pictures, checked against
// CC.Cube by simulation (a U turn must turn the picture, stickers next to each other across a fold
// must belong to one piece, …). Also the pure helpers of the gym screen (js/screens/gym.js).
const assert = require('assert');
require('../js/cube.js');
require('../js/solver.js');
require('../js/lessons.js');
require('../js/storage.js');
require('../js/coach.js');
require('../js/gym.js');
const TV = require('../js/topview.js');
const Cube = globalThis.CC.Cube;
const Gym = globalThis.CC.Gym;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack || e.message); process.exitCode = 1; }
}
const seeds = (n) => Array.from({ length: n }, (_, i) => i + 1);
const LEARN = Cube.applyAlg(Cube.solved(), 'z2');
function randomState(seed) { return Cube.applyAlg(LEARN, Cube.scramble(25, seed)); }
function picture(state) {   // 5×5 grid of colours (null where there is no sticker)
  const g = Array.from({ length: 5 }, () => Array(5).fill(null));
  TV.cells().forEach((c) => { g[c.row][c.col] = state[c.index]; });
  return g;
}
const rotCW = (g) => g.map((row, r) => row.map((_, c) => g[4 - c][r]));   // turn the picture 90° clockwise

// ------------------------------------------------------------ the diagram's grid
test('21 stickers: the top face plus the top row of each side, nothing from lower layers', () => {
  const cells = TV.cells();
  assert.strictEqual(cells.length, 21);
  const seen = {};
  cells.forEach((c) => {
    const s = Cube.STICKERS[c.index];
    assert.strictEqual(s.cubie[1], 1, 'only top-layer pieces');
    assert.ok(s.face === 'U' || s.row === 0, 'side stickers come from the top row');
    const k = c.row + ',' + c.col;
    assert.ok(!seen[k], 'one sticker per cell');
    seen[k] = true;
  });
  [[0, 0], [0, 4], [4, 0], [4, 4]].forEach(([r, c]) => assert.ok(!seen[r + ',' + c], 'grid corners empty'));
  for (let i = 0; i < 54; i++) {
    const s = Cube.STICKERS[i], onTop = s.face === 'U' || (s.face !== 'D' && s.row === 0);
    assert.strictEqual(!!TV.gridCell(i), onTop, 'sticker ' + i);
  }
});

test('top face in the middle, back at the top, FRONT AT THE BOTTOM, left and right where they belong', () => {
  for (let i = 0; i < 9; i++) assert.deepStrictEqual(TV.gridCell(i), { row: 1 + Math.floor(i / 3), col: 1 + (i % 3) });
  [18, 19, 20].forEach((i) => assert.strictEqual(TV.gridCell(i).row, 4, 'front strip at the bottom'));
  [45, 46, 47].forEach((i) => assert.strictEqual(TV.gridCell(i).row, 0, 'back strip at the top'));
  [36, 37, 38].forEach((i) => assert.strictEqual(TV.gridCell(i).col, 0, 'left strip on the left'));
  [9, 10, 11].forEach((i) => assert.strictEqual(TV.gridCell(i).col, 4, 'right strip on the right'));
  // the front strip reads left to right as seen from the front
  assert.deepStrictEqual([18, 19, 20].map((i) => TV.gridCell(i).col), [1, 2, 3]);
});

test('stickers next to each other across a fold are one piece (both stickers of every edge and corner)', () => {
  TV.cells().filter((c) => c.kind === 'side').forEach((c) => {
    const inward = { row: c.row === 0 ? 1 : c.row === 4 ? 3 : c.row, col: c.col === 0 ? 1 : c.col === 4 ? 3 : c.col };
    const nb = TV.cells().find((x) => x.row === inward.row && x.col === inward.col);
    assert.ok(nb && nb.kind === 'top');
    assert.deepStrictEqual(Cube.STICKERS[c.index].cubie, Cube.STICKERS[nb.index].cubie, 'strip ' + c.index + ' next to top ' + nb.index);
  });
});

test('a U turn (and a y turn of the whole cube) turns the picture a quarter clockwise; U\' anticlockwise', () => {
  seeds(300).forEach((sd) => {
    const s = randomState(sd), g = picture(s);
    assert.deepStrictEqual(picture(Cube.applyMove(s, 'U')), rotCW(g), 'U, seed ' + sd);
    assert.deepStrictEqual(picture(Cube.applyMove(s, 'y')), rotCW(g), 'y, seed ' + sd);
    assert.deepStrictEqual(picture(Cube.applyMove(s, "U'")), rotCW(rotCW(rotCW(g))), "U', seed " + sd);
    assert.deepStrictEqual(picture(Cube.applyMove(s, 'U2')), rotCW(rotCW(g)), 'U2, seed ' + sd);
  });
});

test('moves that leave the top layer alone leave the picture alone (D, E)', () => {
  seeds(100).forEach((sd) => {
    const s = randomState(sd);
    ['D', "D'", 'E'].forEach((m) => assert.deepStrictEqual(picture(Cube.applyMove(s, m)), picture(s)));
  });
});

// ------------------------------------------------------------ positions, layout, words
test('the four tappable positions are the four top edges of CC.Cube', () => {
  const ps = TV.positions();
  assert.deepStrictEqual(TV.POSITIONS, ['UF', 'UR', 'UB', 'UL']);
  TV.POSITIONS.forEach((p) => {
    const e = Cube.EDGES.find((x) => x.name === p);
    assert.deepStrictEqual(ps[p].stickers, e.stickers);
    assert.strictEqual(ps[p].top, e.stickers[0]);
    assert.strictEqual(Cube.STICKERS[ps[p].top].face, 'U');
    e.stickers.forEach((i) => assert.strictEqual(TV.positionOf(i), p));
  });
  assert.strictEqual(TV.positionOf(4), null);
  assert.strictEqual(TV.positionOf(8), null, 'corners are not edge positions');
  // these are the positions CC.Gym's 'spot' and 'decide' items use
  const item = Gym.next('spot', { seed: 3 });
  assert.deepStrictEqual(item.selectable.slice().sort(), TV.POSITIONS.slice().sort());
  item.options.filter((o) => o.stickers).forEach((o) => assert.deepStrictEqual(o.stickers, ps[o.id].stickers));
});

test('layout: rectangles inside the square, no overlaps, each tap area covers its two stickers and no other edge', () => {
  const L = TV.layout(), rects = L.cells;
  assert.strictEqual(L.width, L.height);
  const inside = (r, R) => r.x >= R.x - 1e-9 && r.y >= R.y - 1e-9 && r.x + r.w <= R.x + R.w + 1e-9 && r.y + r.h <= R.y + R.h + 1e-9;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  rects.forEach((r) => assert.ok(inside(r, { x: 0, y: 0, w: L.width, h: L.height })));
  rects.forEach((a, i) => rects.forEach((b, j) => { if (i < j) assert.ok(!overlap(a, b), a.index + ' vs ' + b.index); }));
  rects.filter((r) => r.kind === 'top').forEach((r) => assert.ok(r.w === r.h && r.w > 8));
  rects.filter((r) => r.kind === 'side').forEach((r) => assert.ok(Math.min(r.w, r.h) >= 3.5, 'strips thick enough to read'));
  L.positions.forEach((hr) => {
    const p = TV.positions()[hr.pos];
    rects.forEach((r) => {
      if (p.stickers.includes(r.index)) assert.ok(inside(r, hr), hr.pos + ' covers ' + r.index);
      else if (TV.positionOf(r.index)) assert.ok(!overlap(r, hr), hr.pos + ' clear of edge sticker ' + r.index);
    });
    assert.ok(inside(hr, { x: 0, y: 0, w: L.width, h: L.height }));
  });
  L.positions.forEach((a, i) => L.positions.forEach((b, j) => { if (i < j) assert.ok(!overlap(a, b)); }));
});

test('describe() names the colours on top and on the side', () => {
  assert.strictEqual(TV.describe(LEARN, 'UF'), 'Front edge: yellow on top, green on the side');
  assert.strictEqual(TV.describe(LEARN, 'UR'), 'Right edge: yellow on top, orange on the side');
  assert.strictEqual(TV.describe(LEARN, 'UL'), 'Left edge: yellow on top, red on the side');
  const s = Cube.applyAlg(LEARN, "U' L' U L U F U' F'");   // takes the red–green edge out to the top
  const e = Cube.findEdge(s, 'G', 'R');
  assert.ok(e.name.charAt(0) === 'U');
  const pos = e.name, p = TV.positions()[pos];
  assert.ok(TV.describe(s, pos).indexOf(Cube.COLOR_NAME[s[p.top]] + ' on top') !== -1);
});

// ------------------------------------------------------------ iso pictures
function area(pts) { let a = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }); return a / 2; }
function insidePoly(pt, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
test('iso pictures: top + front + right (default) or top + front + left; top above, sides below', () => {
  const R = TV.isoLayout('right'), Lf = TV.isoLayout('left');
  assert.deepStrictEqual(R.faces.map((f) => f.face).sort(), ['F', 'R', 'U']);
  assert.deepStrictEqual(Lf.faces.map((f) => f.face).sort(), ['F', 'L', 'U']);
  [R, Lf].forEach((L) => {
    assert.strictEqual(L.stickers.length, 27);
    const cen = (f) => L.stickers.find((s) => s.index === Cube.FACES.indexOf(f) * 9 + 4);
    const others = L.faces.map((f) => f.face).filter((f) => f !== 'U');
    others.forEach((f) => assert.ok(cen('U').cy < cen(f).cy, 'top above ' + f));
    L.stickers.forEach((s) => assert.ok(Math.abs(area(s.points)) > 0.5, 'sticker ' + s.index + ' has an area'));
    // no overlaps: every sticker centre lies inside its own polygon only
    L.stickers.forEach((s) => {
      const hits = L.stickers.filter((t) => insidePoly([s.cx, s.cy], t.points));
      assert.deepStrictEqual(hits.map((t) => t.index), [s.index]);
    });
    const [x0, y0, w, h] = L.viewBox;
    L.faces.forEach((f) => f.points.forEach(([x, y]) => assert.ok(x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h)));
  });
  const cx = (L, i) => L.stickers.find((s) => s.index === i).cx;
  assert.ok(cx(R, 22) < 0 && cx(R, 13) > 0, 'right view: front on the left, right face on the right');
  assert.ok(cx(Lf, 40) < 0 && cx(Lf, 22) > 0, 'left view: left face on the left, front on the right');
});

test('iso pictures: the two stickers of a piece meet at the fold (top-front edge, front-right corner)', () => {
  const R = TV.isoLayout('right'), Lf = TV.isoLayout('left');
  const c = (L, i) => { const s = L.stickers.find((x) => x.index === i); return [s.cx, s.cy]; };
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // the top-front edge: its top sticker (7) is the nearest top sticker to its front sticker (19)
  [R, Lf].forEach((L) => {
    const near = L.stickers.filter((s) => s.face === 'U').sort((a, b) => d([a.cx, a.cy], c(L, 19)) - d([b.cx, b.cy], c(L, 19)))[0];
    assert.strictEqual(near.index, 7);
  });
  const nearR = R.stickers.filter((s) => s.face === 'R').sort((a, b) => d([a.cx, a.cy], c(R, 20)) - d([b.cx, b.cy], c(R, 20)))[0];
  assert.strictEqual(nearR.index, 9, 'front-right corner: front 20 next to right 9');
  const nearL = Lf.stickers.filter((s) => s.face === 'L').sort((a, b) => d([a.cx, a.cy], c(Lf, 18)) - d([b.cx, b.cy], c(Lf, 18)))[0];
  assert.strictEqual(nearL.index, 38, 'front-left corner: front 18 next to left 38');
});

// ------------------------------------------------------------ gym screen helpers (pure)
const screen = require('../js/screens/gym.js');
const H = screen._helpers;

test('gym screen loads in node without a DOM and exposes its helpers', () => {
  assert.strictEqual(typeof screen.mount, 'function');
  ['progressOf', 'roundSize', 'decideParts', 'follow', 'faceTurns', 'stageFor', 'isoSide'].forEach((k) => assert.strictEqual(typeof H[k], 'function', k));
});

test('progressOf: recent score, Strong at 8 of the last 10, best time', () => {
  assert.deepStrictEqual(H.progressOf(null), { tried: false, recentRight: 0, recentN: 0, pct: 0, strong: false, bestMs: null, total: 0, streak: 0 });
  const e = { right: 12, total: 15, streak: 3, best: 6, bestMs: 1820, recent: [1, 1, 0, 1, 1, 1, 1, 1, 1, 1] };
  const p = H.progressOf(e);
  assert.strictEqual(p.recentRight, 9); assert.strictEqual(p.recentN, 10); assert.strictEqual(p.strong, true);
  assert.strictEqual(p.strong, Gym.isStrong(e)); assert.strictEqual(p.bestMs, 1820); assert.strictEqual(p.pct, 90);
  assert.strictEqual(H.progressOf({ recent: [1, 1, 1, 1, 1, 1, 1] }).strong, false, '7 answers are not enough');
});

test('roundSize: 10 for quick drills, shorter rounds for the long ones; every drill builds a round', () => {
  Gym.DRILLS.forEach((d) => {
    const n = H.roundSize(d.id);
    if (d.kind === 'route') { assert.strictEqual(n, 0); return; }
    assert.ok(n >= 3 && n <= 10, d.id);
    if (['tap', 'multi', 'sequence'].includes(d.kind)) assert.strictEqual(n, 10, d.id);
    const items = Gym.session(d.id, { seed: 11, count: n });
    assert.strictEqual(items.length, n);
  });
});

test('decideParts splits a decide item into rotation, top turn and algorithm (checked by simulation)', () => {
  seeds(300).forEach((sd) => {
    const it = Gym.next('decide', { seed: sd }), p = H.decideParts(it);
    assert.deepStrictEqual(Cube.applyAlg(it.steps[0].state, p.rot), it.steps[2].state, 'rotation, seed ' + sd);
    assert.deepStrictEqual(Cube.applyAlg(it.steps[2].state, p.turn), it.steps[3].state, 'turn, seed ' + sd);
    assert.deepStrictEqual(p.alg, Gym.ALGS[it.steps[3].answer].moves);
    assert.deepStrictEqual(p.rot.concat(p.turn, p.alg), it.moves);
  });
});

test('follow(): which move of the algorithm the learner is on, judged by the cube itself', () => {
  seeds(60).forEach((sd) => {
    const it = Gym.next('recall', { seed: sd }), mv = it.moves;
    let s = it.state;
    assert.deepStrictEqual(H.follow(it.state, mv, s), { at: 0, off: false });
    mv.forEach((m, k) => {
      s = Cube.applyMove(s, m);
      assert.deepStrictEqual(H.follow(it.state, mv, s), { at: k + 1, off: false });
      assert.deepStrictEqual(H.follow(it.state, mv, Cube.applyMove(s, 'y')), { at: k + 1, off: false }, 'holding the cube another way still counts');
    });
    const wrong = Cube.applyMove(Cube.applyMove(it.state, mv[0]), Cube.invertMove(mv[1]));
    assert.strictEqual(H.follow(it.state, mv, wrong).off, true, 'a wrong second move is spotted');
  });
  // a half turn done as two quarter turns
  const st = LEARN, mv = ['U2', 'R'];
  assert.deepStrictEqual(H.follow(st, mv, Cube.applyMove(st, 'U')), { at: 0, off: false, half: true });
});

test('faceTurns counts turns, not whole-cube rotations', () => {
  assert.strictEqual(H.faceTurns(['y', 'U', "R'", 'x2', 'F2']), 3);
  assert.strictEqual(H.faceTurns([]), 0);
});

test('stageFor and isoSide: which picture each item is shown with', () => {
  Gym.DRILLS.filter((d) => d.kind !== 'route').forEach((d) => {
    Gym.session(d.id, { seed: 5, count: H.roundSize(d.id) }).forEach((it) => {
      const m = H.stageFor(it);
      assert.ok(['3d', 'top', 'both', 'pics', 'none'].includes(m), d.id + ' ' + m);
      if (d.id === 'spot') assert.strictEqual(m, 'top');
      if (d.kind === 'perform') assert.strictEqual(m, '3d');
      if (it.alg) assert.strictEqual(H.isoSide(it), it.alg === 'left' ? 'left' : 'right');
    });
  });
  // the Left algorithm's checkpoint corner shows its white sticker on the LEFT: the left picture sees it
  const it = Gym.next('landmark', { seed: 2, concept: 'left-4' });
  const ok = it.options.find((o) => o.id === it.answer);
  const k = Cube.findCorner(ok.state, 'W', it.edge[0], it.edge[1]);
  assert.strictEqual(k.faces[0], 'L');
  const L = TV.isoLayout(H.isoSide(it));
  assert.ok(L.stickers.some((s) => s.index === k.stickers[0]), 'white sticker visible in the picture');
});

console.log(passed + ' topview tests passed');
