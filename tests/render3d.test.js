// node tests/render3d.test.js
// Pure-logic tests for js/render3d.js. Loads with no THREE and no DOM.
const assert = require('assert');

assert.strictEqual(typeof globalThis.THREE, 'undefined', 'tests must run without THREE');
assert.strictEqual(typeof globalThis.document, 'undefined', 'tests must run without a DOM');
require('../js/cube.js');
const exported = require('../js/render3d.js');
const CC = globalThis.CC;
const Cube = CC.Cube;
const I = CC.View3D._internal;

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const P = Cube.STICKERS.map((s) => s.point);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const ALL_TOKENS = Object.keys(Cube.PERM);

// Rotate v by `angle` (right-hand rule) about unit axis k — Rodrigues, independent of cube.js.
function rotate(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), kv = cross(k, v), kd = dot(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
}
// Independent reading of a quarter-turn permutation: which coordinate axis is fixed, and which way round.
function motionOf(perm) {
  const moving = [];
  for (let i = 0; i < 54; i++) if (perm[i] !== i) moving.push(i);
  const k = [0, 1, 2].find((ax) => moving.every((i) => P[i][ax] === P[perm[i]][ax]));
  const e = [0, 0, 0]; e[k] = 1;
  const i0 = moving.find((i) => {
    const p = P[i].slice(); p[k] = 0; return len(p) > 0;
  });
  const sense = Math.sign(dot(cross(P[i0], P[perm[i0]]), e));
  return { e, sense, moving };
}

// ------------------------------------------------------------------ module shape
test('module loads in node without THREE or DOM and attaches to CC', () => {
  ['View3D', 'Net2D', 'MovePad', 'Keys'].forEach((k) => {
    assert.ok(CC[k], k + ' on CC');
    assert.strictEqual(exported[k], CC[k], k + ' exported');
  });
  assert.strictEqual(CC.View3D.supported(), false, 'no WebGL in node');
  ['create', 'supported'].forEach((f) => assert.strictEqual(typeof CC.View3D[f], 'function', f));
  assert.strictEqual(typeof CC.Net2D.render, 'function');
  assert.strictEqual(typeof CC.MovePad.render, 'function');
  assert.strictEqual(typeof CC.Keys.toMove, 'function');
  assert.strictEqual(typeof CC.Keys.legend, 'function');
});

// ------------------------------------------------------------------ animation direction matches PERM
test('turnInfo: rotating each turning sticker by the tween angle lands where PERM says', () => {
  ALL_TOKENS.forEach((tok) => {
    const t = I.turnInfo(tok);
    const perm = Cube.PERM[tok];
    for (let i = 0; i < 54; i++) {
      const inLayer = t.layers.indexOf(dot(Cube.STICKERS[i].cubie, t.axis)) !== -1;
      if (!inLayer) { assert.strictEqual(perm[i], i, tok + ' moves an untouched sticker ' + i); continue; }
      const q = rotate(P[i], t.axis, t.angle).map(Math.round).map((v) => v || 0);
      assert.deepStrictEqual(q, P[perm[i]], tok + ' sticker ' + i);
    }
  });
});

test('turnInfo: clockwise -90°, prime +90°, double -180°', () => {
  assert.strictEqual(I.turnInfo('R').angle, -Math.PI / 2);
  assert.strictEqual(I.turnInfo("R'").angle, Math.PI / 2);
  assert.strictEqual(I.turnInfo('R2').angle, -Math.PI);
  assert.deepStrictEqual(I.turnInfo('x').layers, [-1, 0, 1]);
});

// ------------------------------------------------------------------ drag to turn
test('dragToToken: every sticker x 4 drag directions moves that sticker along the drag', () => {
  let checked = 0;
  Cube.STICKERS.forEach((s) => {
    I.inPlaneAxes(s.normal).forEach((d) => {
      const tok = I.dragToToken(s.normal, d, s.cubie);
      assert.ok(tok && Cube.PERM[tok], 'token for sticker ' + s.index + ' drag ' + d);
      assert.ok(/^[UDRLFBMES]'?$/.test(tok), 'single-layer quarter turn: ' + tok);
      const j = Cube.PERM[tok][s.index];
      assert.notStrictEqual(j, s.index, tok + ' must move sticker ' + s.index);
      const disp = sub(P[j], P[s.index]);
      assert.ok(dot(disp, d) > 0, tok + ' moves sticker ' + s.index + ' along ' + d);
      // the first instant of the turn also points along the drag: velocity = sense * (axis x point)
      const m = motionOf(Cube.PERM[tok]);
      const v = cross(m.e, P[s.index]).map((c) => c * m.sense);
      assert.ok(dot(v, d) > 0, tok + ' initial velocity of sticker ' + s.index);
      // dragging the other way gives the inverse move
      const back = I.dragToToken(s.normal, d.map((c) => -c), s.cubie);
      assert.strictEqual(back, Cube.invertMove(tok));
      checked++;
    });
  });
  assert.strictEqual(checked, 54 * 4);
});

test('dragToToken: a few hand-checked cases', () => {
  // top-right sticker of the front face dragged up = R; dragged left = U
  assert.strictEqual(I.dragToToken([0, 0, 1], [0, 1, 0], [1, 1, 1]), 'R');
  assert.strictEqual(I.dragToToken([0, 0, 1], [-1, 0, 0], [1, 1, 1]), 'U');
  // front centre dragged down = M (middle slice like L), dragged right = E
  assert.strictEqual(I.dragToToken([0, 0, 1], [0, -1, 0], [0, 0, 1]), 'M');
  assert.strictEqual(I.dragToToken([0, 0, 1], [1, 0, 0], [0, 0, 1]), 'E');
  // top face, front-right sticker dragged right = F
  assert.strictEqual(I.dragToToken([0, 1, 0], [1, 0, 0], [1, 1, 1]), 'F');
  // dragging along the normal is meaningless
  assert.strictEqual(I.dragToToken([0, 0, 1], [0, 0, 1], [1, 1, 1]), null);
  // tolerates float input from the 3D picker
  assert.strictEqual(I.dragToToken([0, 0, 0.9999], [0, 1.0001, 0], [0.98, 1.01, 1]), 'R');
});

// ------------------------------------------------------------------ arrows
const VISIBLE = ['U', 'F', 'R'];
const cam = I.viewDir(CC.View3D.DEFAULT_VIEW.az, CC.View3D.DEFAULT_VIEW.el);

test('default camera sees U, F and R (and not D, L, B)', () => {
  Cube.FACES.forEach((f) => {
    const seen = dot(Cube.NORMAL[f], cam) > 0;
    assert.strictEqual(seen, VISIBLE.indexOf(f) !== -1, f);
  });
});

test('arrowSpec: every token; arrow paths travel the way the stickers move (from PERM)', () => {
  ALL_TOKENS.forEach((tok) => {
    const spec = I.arrowSpec(tok);
    const amount = Cube.amountOf(tok);
    assert.strictEqual(spec.double, amount === 2, tok + ' double flag');
    const quarter = amount === 2 ? Cube.baseOf(tok) : tok;
    const m = motionOf(Cube.PERM[quarter]);
    assert.deepStrictEqual(spec.axis, m.e, tok + ' axis');
    assert.strictEqual(spec.sense, m.sense, tok + ' sense');
    assert.ok(spec.arrows.length >= 1, tok + ' has arrows');
    spec.arrows.forEach((a) => {
      assert.strictEqual(a.points.length, a.normals.length);
      assert.ok(a.points.length >= 2);
      let segs = 0;
      for (let k = 1; k < a.points.length; k++) {
        const seg = sub(a.points[k], a.points[k - 1]);
        if (len(seg) < 1e-9) continue; // bend corners: same point, rotating normal
        const mid = a.points[k].map((v, c) => (v + a.points[k - 1][c]) / 2);
        const vel = cross(m.e, mid).map((c) => c * m.sense);
        assert.ok(dot(seg, vel) > 0, tok + ' ' + a.kind + ' segment ' + k + ' runs against the motion');
        segs++;
      }
      assert.ok(segs > 0);
      if (a.kind === 'ring') {
        assert.ok(spec.rotation, tok + ' ring only for rotations');
        return;
      }
      // face arrows sit on visible faces, on stickers that really move
      a.faces.forEach((f) => assert.ok(VISIBLE.indexOf(f) !== -1, tok + ' arrow on hidden face ' + f));
      a.points.forEach((p, k) => {
        const n = a.normals[k];
        assert.ok(dot(n, cam) > 0, tok + ' arrow normal faces the camera');
        assert.ok(Math.abs(Math.max(...p.map(Math.abs)) - 3) < 1e-9, tok + ' arrow point on the cube surface');
        if (n.filter((c) => c !== 0).length === 1) assert.ok(Math.abs(dot(p, n) - 3) < 1e-9, tok + ' arrow point on its face');
      });
      a.stickers.forEach((i) => {
        assert.notStrictEqual(Cube.PERM[quarter][i], i, tok + ' arrow sticker ' + i + ' does not move');
        assert.ok(a.faces.indexOf(Cube.STICKERS[i].face) !== -1);
      });
      if (a.kind === 'line') {
        const dir = sub(a.points[1], a.points[0]);
        a.stickers.forEach((i) => {
          assert.ok(dot(sub(P[Cube.PERM[quarter][i]], P[i]), dir) > 0, tok + ' sticker ' + i + ' moves along the arrow');
        });
        // stickers listed tail -> head
        for (let k = 1; k < a.stickers.length; k++) {
          assert.ok(dot(P[a.stickers[k]], dir) > dot(P[a.stickers[k - 1]], dir));
        }
      }
    });
  });
});

test('arrowSpec: the shapes asked for (columns, rows, curves, back row, rings)', () => {
  const kinds = (t) => I.arrowSpec(t).arrows.map((a) => a.kind + ':' + a.faces.join(''));
  ['R', "R'", 'L', 'M', 'U', 'D', 'E', 'R2'].forEach((t) => assert.deepStrictEqual(kinds(t), ['line:F'], t));
  assert.deepStrictEqual(kinds('F'), ['arc:F']);
  assert.deepStrictEqual(kinds("F'"), ['arc:F']);
  assert.deepStrictEqual(kinds('B'), ['line:U']);
  assert.deepStrictEqual(kinds('S'), ['bend:UR']);
  ['x', "y'", 'z2'].forEach((t) => assert.deepStrictEqual(kinds(t), ['ring:'], t));
  assert.strictEqual(I.arrowSpec('r').arrows.length, 2, 'wide r = two columns');
  // column/row placement
  assert.deepStrictEqual(I.arrowSpec('R').arrows[0].stickers.slice().sort((a, b) => a - b), [20, 23, 26]);
  assert.deepStrictEqual(I.arrowSpec('L').arrows[0].stickers.slice().sort((a, b) => a - b), [18, 21, 24]);
  assert.deepStrictEqual(I.arrowSpec('M').arrows[0].stickers.slice().sort((a, b) => a - b), [19, 22, 25]);
  assert.deepStrictEqual(I.arrowSpec('U').arrows[0].stickers.slice().sort((a, b) => a - b), [18, 19, 20]);
  assert.deepStrictEqual(I.arrowSpec('D').arrows[0].stickers.slice().sort((a, b) => a - b), [24, 25, 26]);
  assert.deepStrictEqual(I.arrowSpec('B').arrows[0].stickers.slice().sort((a, b) => a - b), [0, 1, 2]);
  // plain-English sanity: R goes up, L goes down, U goes left, D goes right, B's top goes left
  assert.deepStrictEqual(I.arrowSpec('R').arrows[0].dir, [0, 1, 0]);
  assert.deepStrictEqual(I.arrowSpec("R'").arrows[0].dir, [0, -1, 0]);
  assert.deepStrictEqual(I.arrowSpec('L').arrows[0].dir, [0, -1, 0]);
  assert.deepStrictEqual(I.arrowSpec('U').arrows[0].dir, [-1, 0, 0]);
  assert.deepStrictEqual(I.arrowSpec('D').arrows[0].dir, [1, 0, 0]);
  assert.deepStrictEqual(I.arrowSpec('B').arrows[0].dir, [-1, 0, 0]);
  assert.strictEqual(I.arrowSpec('F').sense, -1, 'F is clockwise seen from the front');
  // doubles show the clockwise direction
  assert.deepStrictEqual(I.arrowSpec('U2').arrows[0].dir, I.arrowSpec('U').arrows[0].dir);
  assert.ok(I.arrowSpec('U2').double);
});

// ------------------------------------------------------------------ keys
function eventFor(entry, scheme, withCode) {
  let key = entry.key, shiftKey = false;
  if (key.indexOf('Shift+') === 0) { shiftKey = true; key = key.slice(6); }
  const ch = key.toLowerCase();
  const ev = { key: shiftKey ? key.toUpperCase() : ch, shiftKey, ctrlKey: false, metaKey: false, altKey: false };
  if (withCode) {
    ev.code = /[a-z]/.test(ch) ? 'Key' + ch.toUpperCase() : /[0-9]/.test(ch) ? 'Digit' + ch : ({ ';': 'Semicolon', '.': 'Period' })[ch];
  }
  return ev;
}

test('Keys: legends round-trip through toMove (with and without event.code)', () => {
  ['simple', 'cstimer'].forEach((scheme) => {
    const leg = CC.Keys.legend(scheme);
    assert.ok(leg.length > 0);
    leg.forEach((entry) => {
      assert.doesNotThrow(() => Cube.normalizeToken(entry.token), entry.token);
      [false, true].forEach((withCode) => {
        assert.strictEqual(CC.Keys.toMove(eventFor(entry, scheme, withCode), scheme), entry.token, scheme + ' ' + entry.key);
      });
    });
    const keys = leg.map((e) => e.key);
    assert.strictEqual(new Set(keys).size, keys.length, scheme + ' legend keys unique');
  });
});

test('Keys: simple scheme', () => {
  const k = (key, shiftKey) => CC.Keys.toMove({ key, shiftKey: !!shiftKey }, 'simple');
  assert.strictEqual(k('r'), 'R');
  assert.strictEqual(k('R', true), "R'");
  assert.strictEqual(k('m'), 'M');
  assert.strictEqual(k('E', true), "E'");
  assert.strictEqual(k('x'), 'x');
  assert.strictEqual(k('Y', true), "y'");
  assert.strictEqual(k('q'), null);
  assert.strictEqual(k('Enter'), null);
  'UDRLFBMES'.split('').forEach((f) => {
    assert.strictEqual(k(f.toLowerCase()), f);
    assert.strictEqual(k(f, true), f + "'");
  });
  assert.strictEqual(CC.Keys.toMove({ key: 'r' }), 'R', 'simple is the default scheme');
});

test('Keys: csTimer mapping', () => {
  const want = { i: 'R', k: "R'", j: 'U', f: "U'", h: 'F', g: "F'", s: 'D', l: "D'", d: 'L', e: "L'", w: 'B', o: "B'",
    ';': 'y', a: "y'", t: 'x', n: "x'", p: 'z', q: "z'", y: 'x', b: "x'" };
  Object.keys(want).forEach((key) => {
    assert.strictEqual(CC.Keys.toMove({ key }, 'cstimer'), want[key], key);
    assert.strictEqual(CC.Keys.toMove({ key: key.toUpperCase(), shiftKey: true }, 'cstimer'), want[key], 'shift ' + key);
  });
  // physical key position wins over the typed character (e.g. a non-QWERTY layout)
  assert.strictEqual(CC.Keys.toMove({ key: 'z', code: 'KeyI' }, 'cstimer'), 'R');
  assert.strictEqual(CC.Keys.toMove({ key: 'c' }, 'cstimer'), null);
});

test('Keys: ignored with modifiers, auto-repeat, or while typing', () => {
  ['simple', 'cstimer'].forEach((scheme) => {
    const key = scheme === 'simple' ? 'r' : 'i';
    assert.ok(CC.Keys.toMove({ key }, scheme));
    assert.strictEqual(CC.Keys.toMove({ key, ctrlKey: true }, scheme), null);
    assert.strictEqual(CC.Keys.toMove({ key, metaKey: true }, scheme), null);
    assert.strictEqual(CC.Keys.toMove({ key, altKey: true }, scheme), null);
    assert.strictEqual(CC.Keys.toMove({ key, repeat: true }, scheme), null);
    ['INPUT', 'TEXTAREA', 'SELECT', 'input'].forEach((tagName) => {
      assert.strictEqual(CC.Keys.toMove({ key, target: { tagName } }, scheme), null, tagName);
    });
    assert.strictEqual(CC.Keys.toMove({ key, target: { tagName: 'DIV', isContentEditable: true } }, scheme), null);
    assert.ok(CC.Keys.toMove({ key, target: { tagName: 'BUTTON' } }, scheme));
  });
  assert.strictEqual(CC.Keys.toMove(null), null);
});

// ------------------------------------------------------------------ net + pad (pure parts)
test('Net2D layout: neighbours across every fold of the cross belong to the same piece', () => {
  const cells = {};
  for (let i = 0; i < 54; i++) {
    const c = I.netCell(i);
    const key = c.join(',');
    assert.ok(!cells[key], 'two stickers in one net cell');
    cells[key] = i;
  }
  // U above F, D below F, L-F-R-B in a row
  assert.deepStrictEqual(I.netCell(22), [4, 4]);  // F centre
  assert.deepStrictEqual(I.netCell(4), [1, 4]);   // U centre
  assert.deepStrictEqual(I.netCell(31), [7, 4]);  // D centre
  assert.deepStrictEqual(I.netCell(40), [4, 1]);  // L centre
  assert.deepStrictEqual(I.netCell(13), [4, 7]);  // R centre
  assert.deepStrictEqual(I.netCell(49), [4, 10]); // B centre
  let folds = 0;
  for (let i = 0; i < 54; i++) {
    for (let j = 0; j < 54; j++) {
      const a = Cube.STICKERS[i], b = Cube.STICKERS[j];
      if (a.face === b.face) continue;
      const ci = I.netCell(i), cj = I.netCell(j);
      if (Math.abs(ci[0] - cj[0]) + Math.abs(ci[1] - cj[1]) !== 1) continue;
      assert.deepStrictEqual(a.cubie, b.cubie, 'net neighbours ' + i + '/' + j + ' are not on one piece');
      folds++;
    }
  }
  assert.strictEqual(folds, 2 * 5 * 3, 'five folds of three sticker pairs');
});

test('MovePad rows: face turns, optional slices, rotations; all valid with plain-English titles', () => {
  const flat = (o) => [].concat.apply([], I.padRows(o));
  assert.deepStrictEqual(flat({ rotations: false }), ['U', "U'", 'D', "D'", 'R', "R'", 'L', "L'", 'F', "F'", 'B', "B'"]);
  assert.strictEqual(flat({}).length, 18);
  assert.strictEqual(flat({ slices: true }).length, 24);
  flat({ slices: true }).forEach((t) => {
    assert.strictEqual(Cube.normalizeToken(t), t);
    assert.ok(Cube.moveInfo(t).text.length > 5);
  });
});

// ------------------------------------------------------------------ sequencer (queue behind play/cancel/userMove)
test('sequencer: plays tokens in order with eased timing and resolves with the end state', async () => {
  const log = [];
  const seq = I.createSequencer({
    begin: (a) => log.push('begin ' + a.token),
    progress: (a, k) => { assert.ok(k >= 0 && k <= 1); },
    end: (a) => log.push('end ' + a.token),
    commit: (tok, st) => log.push('commit ' + tok + ' ' + Cube.isSolved(st))
  });
  const moves = [];
  const p = seq.enqueue("R U'", { onMove: (i, t) => moves.push([i, t]) });
  assert.strictEqual(seq.step(0), true);
  assert.deepStrictEqual(seq.getState(), Cube.solved(), 'nothing committed yet');
  assert.deepStrictEqual(seq.finalState(), Cube.applyAlg(Cube.solved(), "R U'"));
  seq.step(100);
  assert.deepStrictEqual(moves, []);
  seq.step(I.BASE_MS + 1);
  assert.deepStrictEqual(moves, [[0, 'R']]);
  assert.strictEqual(seq.step(2 * I.BASE_MS + 5), false);
  assert.deepStrictEqual(moves, [[0, 'R'], [1, "U'"]]);
  const end = await p;
  assert.deepStrictEqual(end, Cube.applyAlg(Cube.solved(), "R U'"));
  assert.deepStrictEqual(log, ['begin R', 'end R', 'commit R false', "begin U'", "end U'", "commit U' false"]);
  assert.strictEqual(seq.busy(), false);
});

test('sequencer: doubles take 1.5x, speed scales, ease is in-out', () => {
  const seq = I.createSequencer({ speed: 2 });
  seq.enqueue(['R2']);
  seq.step(0);
  seq.step(I.BASE_MS * 1.5 / 2 - 2);
  assert.deepStrictEqual(seq.getState(), Cube.solved());
  seq.step(I.BASE_MS * 1.5 / 2 + 1);
  assert.deepStrictEqual(seq.getState(), Cube.applyMove(Cube.solved(), 'R2'));
  assert.strictEqual(I.ease(0), 0);
  assert.strictEqual(I.ease(1), 1);
  assert.ok(Math.abs(I.ease(0.5) - 0.5) < 1e-9);
  assert.ok(I.ease(0.1) < 0.1 && I.ease(0.9) > 0.9);
});

test('sequencer: cancel jumps to the final state of everything queued and resolves all promises', async () => {
  const seen = [];
  const user = [];
  const seq = I.createSequencer({ user: (t) => user.push(t) });
  const p1 = seq.enqueue("R U F", { onMove: (i, t) => seen.push(t) });
  const p2 = seq.enqueue(['D2'], { user: true });
  seq.step(0); seq.step(50);
  seq.cancel();
  const want = Cube.applyAlg(Cube.solved(), 'R U F D2');
  assert.deepStrictEqual(seq.getState(), want);
  assert.deepStrictEqual(seen, ['R', 'U', 'F']);
  assert.deepStrictEqual(user, ['D2']);
  assert.deepStrictEqual(await p1, Cube.applyAlg(Cube.solved(), 'R U F'));
  assert.deepStrictEqual(await p2, want);
  assert.strictEqual(seq.step(1000), false);
});

test('sequencer: reset drops the queue, resolves promises and sets the new state', async () => {
  const ended = [];
  const seq = I.createSequencer({ end: (a) => ended.push(a.token) });
  const p = seq.enqueue("R U");
  seq.step(0); seq.step(10);
  const s = Cube.applyMove(Cube.solved(), 'F');
  seq.reset(s);
  assert.deepStrictEqual(ended, ['R'], 'the running tween is unwound');
  assert.deepStrictEqual(await p, s);
  assert.deepStrictEqual(seq.getState(), s);
  assert.strictEqual(seq.busy(), false);
});

test('sequencer: fast user input queues (never desyncs) and catches up faster', () => {
  const user = [];
  const seq = I.createSequencer({ user: (t) => user.push(t) });
  const durs = [];
  const seq2 = I.createSequencer({ begin: (a) => durs.push(a.dur) });
  ['R', 'U', "R'", "U'", 'F'].forEach((t) => { seq.enqueue([t], { user: true }); seq2.enqueue([t], { user: true }); });
  let t = 0;
  while (seq.step(t)) t += 16;
  assert.deepStrictEqual(user, ['R', 'U', "R'", "U'", 'F']);
  assert.deepStrictEqual(seq.getState(), Cube.applyAlg(Cube.solved(), "R U R' U' F"));
  t = 0;
  while (seq2.step(t)) t += 16;
  assert.ok(durs[0] < durs[durs.length - 1], 'backlog speeds up early moves');
  assert.strictEqual(durs[durs.length - 1], I.BASE_MS);
  // a demo (non-user) alg keeps a steady pace
  const demo = [];
  const seq3 = I.createSequencer({ begin: (a) => demo.push(a.dur) });
  seq3.enqueue("R U R' U'");
  t = 0;
  while (seq3.step(t)) t += 16;
  assert.ok(demo.every((d) => d === I.BASE_MS));
});

test('sequencer: callbacks may queue more moves; bad tokens throw synchronously', async () => {
  const seq = I.createSequencer({});
  let chained = null;
  const p = seq.enqueue(['R'], { onMove: () => { chained = seq.enqueue(['U']); } });
  let t = 0;
  while (seq.step(t)) t += 20;
  await p;
  await chained;
  assert.deepStrictEqual(seq.getState(), Cube.applyAlg(Cube.solved(), 'R U'));
  assert.throws(() => seq.enqueue('R Q'));
  assert.deepStrictEqual(await seq.enqueue([]), seq.getState(), 'empty play resolves at once');
});

test('sequencer: a throwing callback does not break the queue', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const seq = I.createSequencer({ commit: () => { throw new Error('boom'); } });
    const p = seq.enqueue('R U');
    let t = 0;
    while (seq.step(t)) t += 20;
    assert.deepStrictEqual(await p, Cube.applyAlg(Cube.solved(), 'R U'));
  } finally { console.error = origError; }
});

// ------------------------------------------------------------------ touch: on the cube or on the background?
// The camera distance the view uses for a w×h canvas (render3d.js resize()).
function fitDist(w, h) {
  const vf = I.FOV * Math.PI / 180 / 2, hf = Math.atan(Math.tan(vf) * w / h);
  return I.FIT_RADIUS / Math.sin(Math.min(vf, hf));
}
function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
}

test('touchActionFor: a draggable cube lets vertical swipes scroll the page; never touch-action none', () => {
  assert.strictEqual(I.touchActionFor(true, false), 'pan-y');
  assert.strictEqual(I.touchActionFor(true, true), 'pan-y');
  assert.strictEqual(I.touchActionFor(false, true), 'pan-y');
  assert.strictEqual(I.touchActionFor(false, false), '');
});

test('convexHull / inHull: square with inside points, edges and the finger margin', () => {
  const hull = I.convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 8], [10, 5], null]);
  assert.strictEqual(hull.length, 4, 'interior and collinear points dropped');
  assert.ok(I.inHull(hull, 5, 5, 0) && I.inHull(hull, 0.01, 9.99, 0), 'inside');
  assert.ok(!I.inHull(hull, 11, 5, 0) && !I.inHull(hull, -3, -3, 2), 'outside');
  assert.ok(I.inHull(hull, 11, 5, 1.5) && I.inHull(hull, -1, -1, 1.5), 'within the margin');
  assert.ok(!I.inHull(hull, 15, 15, 4), 'beyond the margin (corner distance √50)');
  assert.ok(!I.inHull([[0, 0], [1, 1]], 0, 0, 5), 'degenerate hull holds nothing');
});

test('projectPoint: matches a camera at +z looking at the origin, and is the THREE lookAt frame', () => {
  const w = 400, h = 300, d = 10, t = Math.tan(I.FOV * Math.PI / 360);
  const c0 = I.projectPoint([0, 0, 0], { az: 0, el: 0, dist: d }, w, h);
  assert.ok(Math.abs(c0[0] - 200) < 1e-9 && Math.abs(c0[1] - 150) < 1e-9, 'origin at the centre');
  const p = I.projectPoint([1, 1, 0], { az: 0, el: 0, dist: d }, w, h);
  assert.ok(Math.abs(p[0] - (1 / (d * t * w / h) + 1) / 2 * w) < 1e-9, '+x goes right');
  assert.ok(Math.abs(p[1] - (1 - 1 / (d * t)) / 2 * h) < 1e-9, '+y goes up');
  // orbiting a quarter turn to the right (az 90°) the +x face looks at the camera: +z now goes left
  const q = I.projectPoint([0, 0, 1], { az: Math.PI / 2, el: 0, dist: d }, w, h);
  assert.ok(q[0] < 200 - 1, '+z left of centre seen from +x');
  assert.strictEqual(I.projectPoint([0, 0, 20], { az: 0, el: 0, dist: d }, w, h), null, 'behind the camera');
});

test('cubeOutline: at the default view the cube is a big target and the background stays free to scroll', () => {
  [[358, 358], [358, 300], [600, 540], [380, 250]].forEach(([w, h]) => {
    const cam = { az: CC.View3D.DEFAULT_VIEW.az, el: CC.View3D.DEFAULT_VIEW.el, dist: fitDist(w, h) };
    const hull = I.cubeOutline(cam, w, h);
    assert.strictEqual(hull.length, 6, 'a cube seen corner-on is a hexagon');
    hull.forEach(([x, y]) => assert.ok(x > 0 && x < w && y > 0 && y < h, 'outline fits the canvas ' + w + 'x' + h));
    assert.ok(I.inHull(hull, w / 2, h / 2, 0), 'the middle is on the cube');
    const share = polyArea(hull) / (w * h);
    assert.ok(share > 0.2 && share < 0.75, 'cube covers ' + share.toFixed(2) + ' of ' + w + 'x' + h);
    [[4, 4], [w - 4, 4], [4, h - 4], [w - 4, h - 4]].forEach(([x, y]) =>
      assert.ok(!I.inHull(hull, x, y, I.TOUCH_MARGIN), 'canvas corner is background ' + w + 'x' + h));
    // a strip down each side is background on a square-ish canvas (where a thumb scrolls past it)
    if (w / h < 1.25) assert.ok(!I.inHull(hull, 6, h / 2, I.TOUCH_MARGIN) || !I.inHull(hull, w - 6, h / 2, I.TOUCH_MARGIN), 'a side strip is background');
  });
});

test('cubeOutline: every sticker centre at any orbit lies inside the outline (touching a sticker claims the touch)', () => {
  const w = 358, h = 358, dist = fitDist(w, h);
  for (let az = -Math.PI; az <= Math.PI; az += Math.PI / 7) {
    for (let el = -1.4; el <= 1.4; el += 0.35) {
      const cam = { az, el, dist };
      const hull = I.cubeOutline(cam, w, h);
      Cube.STICKERS.forEach((s) => {
        const pt = I.projectPoint(s.point.map((v) => v / 2), cam, w, h);   // scene units = points / 2
        assert.ok(I.inHull(hull, pt[0], pt[1], 0.01), 'sticker ' + s.index + ' at az ' + az.toFixed(2) + ' el ' + el.toFixed(2));
      });
    }
  }
});

// ------------------------------------------------------------------ run
(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e && e.stack || e); process.exitCode = 1; }
  }
  console.log(passed + '/' + queue.length + ' render3d tests passed');
})();
