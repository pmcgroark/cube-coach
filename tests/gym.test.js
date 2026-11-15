// node tests/gym.test.js
// CC.Gym (js/gym.js): every drill over >= 500 seeds. Answers are re-derived here independently by
// simulation with CC.Cube (nothing below reuses the gym's own helpers), option sets are checked for
// exactly one defensible answer, perform goals for reachability and for accepting other correct
// solutions while rejecting wrong ones, stuck cases for really being stuck, and the landmarks for
// both algorithms from every slot.
const assert = require('assert');
require('../js/cube.js');
require('../js/solver.js');
require('../js/lessons.js');
require('../js/storage.js');
require('../js/coach.js');
const Gym = require('../js/gym.js');
const Cube = globalThis.CC.Cube;
const Solver = globalThis.CC.Solver;
const Lessons = globalThis.CC.Lessons;
const Coach = globalThis.CC.Coach;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack || e.message); process.exitCode = 1; }
}
const SEEDS = Math.max(500, +process.env.GYM_SEEDS || 0);   // GYM_SEEDS=5000 node tests/gym.test.js for a deeper run
const seeds = (n = SEEDS) => Array.from({ length: n }, (_, i) => i + 1);

// ------------------------------------------------------------ independent helpers
const Y0 = Cube.applyAlg(Cube.solved(), 'z2');              // learning frame: yellow up, green front
const tok = (a) => Cube.parseAlg(a);
const ap = (s, a) => Cube.applyAlg(s, a);
const RIGHT = tok("U R U' R' U' F' U F");
const LEFT = tok("U' L' U L U F U' F'");
const ALG = { right: RIGHT, left: LEFT };
const FI = (f) => Cube.FACES.indexOf(f) * 9;
const cen = (s, f) => s[FI(f) + 4];
const norm = (s) => ap(s, Cube.rotationTo(s, 'Y', null));
const str = (s) => s.join('');
function firstLayer(s) {
  s = norm(s);
  for (let i = 27; i < 36; i++) if (s[i] !== 'W') return false;
  return ['R', 'F', 'L', 'B'].every((f) => [6, 7, 8].every((j) => s[FI(f) + j] === cen(s, f)));
}
const MID = Cube.EDGES.filter((e) => e.name.length === 2 && 'FB'.includes(e.name[0]) && 'RL'.includes(e.name[1]));
const TOPE = Cube.EDGES.filter((e) => e.name[0] === 'U');
const home = (s, piece) => piece.stickers.every((i) => s[i] === cen(s, Cube.STICKERS[i].face));
function edgeHome(s, a, b) { const e = Cube.findEdge(s, a, b); return !!e && s[e.stickers[0]] === cen(s, e.faces[0]) && s[e.stickers[1]] === cen(s, e.faces[1]); }
const f2l = (s) => firstLayer(s) && MID.every((e) => home(norm(s), e));
const midHomeCols = (s) => MID.filter((e) => home(s, e)).map((e) => e.stickers.map((i) => s[i]));
const usableTopT = (s) => TOPE.filter((e) => e.stickers.every((i) => s[i] !== 'Y')).map((e) => e.name);
function category(s, name) {   // independent: home | flipped | wrong-slot | yellow
  const e = MID.find((x) => x.name === name), cols = e.stickers.map((i) => s[i]);
  if (cols.includes('Y')) return 'yellow';
  const want = e.stickers.map((i) => cen(s, Cube.STICKERS[i].face));
  if (cols[0] === want[0] && cols[1] === want[1]) return 'home';
  if (cols[0] === want[1] && cols[1] === want[0]) return 'flipped';
  return 'wrong-slot';
}
function goalIndependent(goal, s) {   // re-implementation of the perform goals
  if (!firstLayer(s)) return false;
  const t = norm(s);
  if (goal.kind === 'f2l') return f2l(t);
  const [a, b] = goal.edge;
  if (goal.kind === 'insert' && !edgeHome(t, a, b)) return false;
  if (goal.kind === 'popout' && Cube.findEdge(t, a, b).name[0] !== 'U') return false;
  return (goal.keep || []).every(([x, y]) => edgeHome(t, x, y));
}
// random states that keep the white layer (U, y, both algorithms and their inverses)
const FL_POOL = ['U', "U'", 'U2', 'y', "y'", RIGHT.join(' '), LEFT.join(' '), Cube.invertAlg(RIGHT).join(' '), Cube.invertAlg(LEFT).join(' '),
  "F R U R' U' F'", "R U R' U R U2 R'"];
function randomFL(seed, steps) {
  const rnd = Cube.mulberry32(seed); let s = Y0;
  for (let k = 0; k < steps; k++) s = ap(s, FL_POOL[Math.floor(rnd() * FL_POOL.length)]);
  return s;
}
const ROT_FR = { FR: '', FL: "y'", BL: 'y2', BR: 'y' };
const ROT_FL = { FL: '', FR: 'y', BR: 'y2', BL: "y'" };
const SLOT_COLS = { FR: ['G', 'O'], FL: ['G', 'R'], BL: ['B', 'R'], BR: ['B', 'O'] };   // learning frame
function uniqueIds(opts) { const ids = opts.map((o) => o.id); assert.strictEqual(new Set(ids).size, ids.length, 'option ids unique: ' + ids); return ids; }
function basicItem(it, id) {
  assert.strictEqual(it.drillId, id);
  assert.ok(Array.isArray(it.state) && it.state.length === 54, id + ' state');
  assert.ok(Cube.validate(it.state).ok, id + ' state is a real cube');
  assert.strictEqual(cen(it.state, 'U'), 'Y', id + ': yellow on top (as held)');
  assert.ok(['3d', 'top', 'both'].includes(it.view), id + ' view');
  assert.ok(typeof it.prompt === 'string' && it.prompt.length > 10, id + ' prompt');
  assert.ok(typeof it.explain === 'string' && it.explain.length > 10, id + ' explain');
  assert.ok(Array.isArray(it.highlight), id + ' highlight');
  it.highlight.forEach((i) => assert.ok(Number.isInteger(i) && i >= 0 && i < 54));
  assert.ok(typeof it.key === 'string' && it.key.length > 0);
}
// a middle-stage state: white layer whole, middle layer not finished
function middleStage(s, id) { assert.ok(firstLayer(s), id + ': white layer whole'); assert.ok(!f2l(s), id + ': middle unsolved'); }
function tMade(s) { return s[19] === cen(s, 'F') && s[7] !== 'Y' && s[19] !== 'Y' && firstLayer(s); }
function sideOfT(s) { return s[7] === cen(s, 'R') ? 'right' : s[7] === cen(s, 'L') ? 'left' : null; }
const each = (id, fn, n) => seeds(n).forEach((seed) => fn(Gym.next(id, { seed }), seed));

// ------------------------------------------------------------ algorithms
test('ALGS: moves, halves, plain English, mirror relation, matching the rest of the app', () => {
  assert.deepStrictEqual(Object.keys(Gym.ALGS).sort(), ['left', 'right']);
  assert.deepStrictEqual(Gym.ALGS.right.moves, RIGHT);
  assert.deepStrictEqual(Gym.ALGS.left.moves, LEFT);
  assert.deepStrictEqual(tok(Solver.ALGS['mid-right'].moves), RIGHT);
  assert.deepStrictEqual(tok(Solver.ALGS['mid-left'].moves), LEFT);
  assert.strictEqual(Lessons.ALGORITHMS['mid-right'].notation, Gym.ALGS.right.notation);
  assert.strictEqual(Lessons.ALGORITHMS['mid-left'].notation, Gym.ALGS.left.notation);
  ['right', 'left'].forEach((a) => {
    const A = Gym.ALGS[a];
    assert.strictEqual(A.id, a);
    assert.deepStrictEqual(tok(A.notation), A.moves);
    assert.deepStrictEqual(A.plain, A.moves.map((m) => Cube.moveInfo(m).text), a + ' plain');
    assert.strictEqual(A.halves.length, 2);
    assert.deepStrictEqual(A.halves[0].moves.concat(A.halves[1].moves), A.moves);
    A.halves.forEach((h) => {
      assert.strictEqual(h.moves.length, 4);
      assert.deepStrictEqual(h.plain, h.moves.map((m) => Cube.moveInfo(m).text));
      assert.ok(h.name && h.does && h.rhythm.split(', ').length === 4, a + ' half');
    });
    assert.strictEqual(Gym.ALGS[A.mirrorOf].mirrorOf, a);
    assert.strictEqual(A.algId, a === 'right' ? 'mid-right' : 'mid-left');
  });
  // mirror rule: swap R and L, flip every direction
  assert.deepStrictEqual(Gym.mirror(RIGHT), LEFT);
  assert.deepStrictEqual(Gym.mirror(LEFT), RIGHT);
  assert.deepStrictEqual(Gym.ALGS.right.halves.map((h) => Gym.mirror(h.moves)), Gym.ALGS.left.halves.map((h) => h.moves));
  ['U', "U'", 'R', "R'", 'L', "L'", 'F', "F'", 'U2', 'R2'].forEach((m) => assert.strictEqual(Gym.mirrorMove(Gym.mirrorMove(m)), m));
});

test('left really is the mirror image of right (reflect the cube left-to-right: the results match)', () => {
  const P2I = {}; Cube.STICKERS.forEach((s) => (P2I[s.point.join(',')] = s.index));
  const MIR = Cube.STICKERS.map((s) => P2I[[-s.point[0], s.point[1], s.point[2]].join(',')]);
  const reflect = (s) => { const o = new Array(54); for (let i = 0; i < 54; i++) o[MIR[i]] = s[i]; return o; };
  for (const seed of seeds(60)) {
    const s = ap(Y0, Cube.scramble(20, seed));
    assert.deepStrictEqual(ap(reflect(s), LEFT), reflect(ap(s, RIGHT)));
    assert.deepStrictEqual(ap(reflect(s), RIGHT), reflect(ap(s, LEFT)));
    Gym.PAD.forEach((m) => assert.deepStrictEqual(ap(reflect(s), [Gym.mirrorMove(m)]), reflect(ap(s, [m])), 'mirror of ' + m));
  }
});

// T-states built here independently: a random first-layer state, slot X held at FR (right) or
// FL (left), then the algorithm undone, so the slot's edge makes the upside-down T at the front.
function tStates(n) {
  const out = [];
  for (const seed of seeds(n)) {
    const s0 = randomFL(seed, 8);
    for (const slot of ['FR', 'FL', 'BL', 'BR']) for (const a of ['right', 'left']) {
      const held = ap(s0, a === 'right' ? ROT_FR[slot] : ROT_FL[slot]);
      const slotNow = a === 'right' ? 'FR' : 'FL';
      const cols = MID.find((e) => e.name === slotNow).stickers.map((i) => held[i]);
      if (!home(held, MID.find((e) => e.name === slotNow))) continue;   // that slot has to be solved first
      const t = ap(held, Cube.invertAlg(ALG[a]));
      out.push({ a, slot, t, side: t[19], top: t[7], cols, keep: midHomeCols(t).filter((p) => !(p.includes(t[19]) && p.includes(t[7]))) });
    }
  }
  return out;
}

test('landmarks hold for both algorithms from every slot', () => {
  const L = Gym.LANDMARKS;
  assert.deepStrictEqual(Object.keys(L).sort(), ['left', 'right']);
  ['right', 'left'].forEach((a) => { assert.deepStrictEqual(L[a].map((x) => x.after), [4, 8]); L[a].forEach((x) => assert.ok(x.text.length > 40 && x.title)); });
  const seen = {};
  tStates(150).forEach(({ a, slot, t, side, top, keep }) => {
    seen[a + slot] = (seen[a + slot] || 0) + 1;
    assert.ok(tMade(t), 'T made'); assert.strictEqual(sideOfT(t), a, 'top colour says ' + a);
    const after = (k) => ap(t, ALG[a].slice(0, k));
    const R = a === 'right';
    // after the first half: edge back where it started; white corner on top next to it, white facing out; matching colours touching
    const h = after(4), e = Cube.findEdge(h, side, top), c = Cube.findCorner(h, 'W', side, top);
    assert.strictEqual(e.name, 'UF'); assert.deepStrictEqual(e.faces, ['F', 'U']);
    assert.strictEqual(c.name, R ? 'URF' : 'UFL'); assert.strictEqual(c.faces[0], R ? 'R' : 'L');
    assert.strictEqual(h[R ? 20 : 18], h[19], 'side colours touch on the front'); assert.strictEqual(h[R ? 8 : 6], h[7], 'top colours touch on top');
    assert.notStrictEqual(h[R ? 29 : 27], 'W', 'gap in the white layer at the ' + (R ? 'front-right' : 'front-left'));
    assert.ok(!firstLayer(h));
    const f = L[a][0].facts; assert.strictEqual(f.edge, e.name); assert.strictEqual(f.corner, c.name); assert.strictEqual(f.white, c.faces[0]); assert.strictEqual(f.whiteLayer, false);
    // broken from the 2nd move to the 7th; after F'/F (move 6) even the white cross has a piece out
    for (let k = 0; k <= 8; k++) assert.strictEqual(firstLayer(after(k)), k <= 1 || k === 8, a + ' white layer at ' + k);
    [6, 7].forEach((k) => assert.notStrictEqual(Cube.findEdge(after(k), 'W', cen(t, 'F')).name, 'DF', 'cross broken at ' + k));
    [0, 1, 2, 3, 4, 5, 8].forEach((k) => assert.strictEqual(Cube.findEdge(after(k), 'W', cen(t, 'F')).name, 'DF', 'cross whole at ' + k));
    // after all eight: edge home, white layer whole, every other slot untouched
    const end = after(8);
    assert.ok(edgeHome(end, side, top)); assert.ok(firstLayer(end));
    keep.forEach(([x, y]) => assert.ok(edgeHome(end, x, y), 'kept ' + x + y));
    ['FL', 'BL', 'BR', 'FR'].filter((n) => n !== (R ? 'FR' : 'FL')).forEach((n) => {
      const st = MID.find((x) => x.name === n).stickers; assert.deepStrictEqual(st.map((i) => end[i]), st.map((i) => t[i]), 'slot ' + n + ' untouched');
    });
    const f8 = L[a][1].facts; assert.strictEqual(Cube.findEdge(end, side, top).name, f8.edge); assert.strictEqual(Cube.findCorner(end, 'W', side, top).name, f8.corner);
  });
  ['right', 'left'].forEach((a) => ['FR', 'FL', 'BL', 'BR'].forEach((sl) => assert.ok(seen[a + sl] > 20, 'tested ' + a + ' from ' + sl)));
  // the words in the text
  assert.match(L.right[0].text, /front-right/); assert.match(L.right[0].text, /white sticker facing right/);
  assert.match(L.left[0].text, /front-left/); assert.match(L.left[0].text, /white sticker facing left/);
  ['right', 'left'].forEach((a) => { assert.match(L[a][0].text, /normal/); assert.match(L[a][0].note, /white cross/); assert.match(L[a][1].text, /whole again/); });
});

test('the rhythm words describe what each move really does (away, up, back, down / aside, open, back, close)', () => {
  tStates(60).forEach(({ a, t, side, top }) => {
    const R = a === 'right', A = ALG[a];
    const st = (k) => ap(t, A.slice(0, k));
    const edge = (k) => Cube.findEdge(st(k), side, top), corner = (k) => Cube.findCorner(st(k), 'W', side, top);
    assert.deepStrictEqual(Gym.ALGS[a].halves.map((h) => h.rhythm), ['away, up, back, down', 'aside, open, back, close']);
    assert.strictEqual(edge(1).name, R ? 'UL' : 'UR', 'away: the edge steps away from its slot');
    assert.match(Cube.moveInfo(A[1]).how, /UP/); assert.strictEqual(corner(2).name[0], 'U', 'up: the white corner comes out of its slot');
    assert.strictEqual(edge(3).name, 'UF', 'back: the edge returns to the front');
    assert.match(Cube.moveInfo(A[3]).how, /DOWN/); assert.strictEqual(corner(4).name, R ? 'URF' : 'UFL', 'down: the corner lands next to the edge');
    assert.ok(!edge(5).name.includes('F') && !corner(5).name.includes('F'), 'aside: the pair leaves the front layer');
    assert.strictEqual(edge(6).name, edge(5).name); assert.strictEqual(corner(6).name, corner(5).name);
    // open: the front turns so the slot (edge spot + corner spot) is lifted to the top front
    const slotE = R ? 'FR' : 'FL', slotC = R ? 'DFR' : 'DLF';
    const pe = Cube.EDGES.find((x) => x.name === slotE).stickers, pc = Cube.CORNERS.find((x) => x.name === slotC).stickers;
    const e5 = pe.map((i) => st(5)[i]), c5 = pc.map((i) => st(5)[i]);
    assert.strictEqual(Cube.findEdge(st(6), e5[0], e5[1]).name, 'UF', 'open: the slot\'s edge spot is now at the top front');
    assert.strictEqual(Cube.findCorner(st(6), c5[0], c5[1], c5[2]).name, R ? 'URF' : 'UFL', 'open: the slot\'s corner spot is now on top');
    assert.strictEqual(edge(7).name, 'UF'); assert.strictEqual(corner(7).name, R ? 'URF' : 'UFL', 'back: the pair returns above the slot');
    assert.ok(edgeHome(st(8), side, top) && home(st(8), Cube.CORNERS.find((x) => x.name === slotC)), 'close: both in the slot');
  });
});

test('WHERE texts (used by whereami/slowmo) match where the pieces are after each move', () => {
  tStates(40).forEach(({ a, t, side, top }) => {
    const R = a === 'right', A = ALG[a];
    for (let k = 0; k <= 8; k++) {
      const s = ap(t, A.slice(0, k)), txt = Gym.whereText(a, k), e = Cube.findEdge(s, side, top), c = Cube.findCorner(s, 'W', side, top);
      assert.ok(txt, a + ' ' + k);
      if (/white layer is (still )?whole/.test(txt)) assert.ok(firstLayer(s), a + k + ' whole');
      if (/white cross has a piece out/.test(txt)) assert.notStrictEqual(Cube.findEdge(s, 'W', cen(s, 'F')).name, 'DF');
      if (/front face is (still )?turned/.test(txt)) assert.ok(!firstLayer(s));
      const want = {
        right: [['UF', 'DFR'], ['UL', 'DFR'], ['UL', 'URF', 'F'], ['UF', 'UBR'], ['UF', 'URF', 'R'], ['UR', 'UBR'], ['UR', 'UBR'], ['UF', 'URF'], ['FR', 'DFR']],
        left: [['UF', 'DLF'], ['UR', 'DLF'], ['UR', 'UFL', 'F'], ['UF', 'ULB'], ['UF', 'UFL', 'L'], ['UL', 'ULB'], ['UL', 'ULB'], ['UF', 'UFL'], ['FL', 'DLF']]
      }[a][k];
      assert.strictEqual(e.name, want[0], a + k + ' edge'); assert.strictEqual(c.name, want[1], a + k + ' corner');
      if (want[2]) { assert.strictEqual(c.faces[0], want[2]); assert.match(txt, want[2] === 'F' ? /white facing you/ : want[2] === 'R' ? /white facing right/ : /white facing left/); }
      if (k === 1 || k === 2) assert.ok(txt.includes(R ? 'top-left' : 'top-right'), txt);
      if (k === 3) assert.ok(txt.includes(R ? 'back-right' : 'back-left'), txt);
      if (k === 5) assert.ok(txt.includes(R ? 'top-right' : 'top-left') && txt.includes(R ? 'top-back-right' : 'top-back-left'), txt);
      if (k === 6) assert.ok(txt.includes(R ? 'on the right' : 'on the left'), txt);
    }
  });
});

// ------------------------------------------------------------ drills table
test('DRILLS: every id from the spec, with group, kind, cube needs and routes', () => {
  const want = {
    spot: [1, 'multi', false], lineup: [1, 'tap', false], leftright: [1, 'tap', false], decide: [1, 'sequence', false],
    halves: [2, 'walkthrough', false], nextmove: [2, 'tap', false], mirror: [2, 'sequence', false], recall: [2, 'perform', 'virtual'],
    'stuck-spot': [3, 'tap', false], 'stuck-fix': [3, 'perform', 'virtual'],
    landmark: [4, 'tap', false], whereami: [4, 'tap', false], slip: [4, 'perform', 'virtual'], slowmo: [4, 'walkthrough', 'real'],
    'full-virtual': [5, 'route', 'virtual'], 'full-real': [5, 'route', 'real'], sprint: [5, 'perform', 'virtual']
  };
  assert.deepStrictEqual(Gym.DRILLS.map((d) => d.id).sort(), Object.keys(want).sort());
  const KINDS = ['tap', 'multi', 'sequence', 'perform', 'walkthrough', 'route'];
  Gym.DRILLS.forEach((d) => {
    const [g, k, c] = want[d.id];
    assert.strictEqual(d.group, g, d.id); assert.strictEqual(d.kind, k, d.id); assert.strictEqual(d.needsCube, c, d.id);
    assert.ok(KINDS.includes(d.kind));
    assert.strictEqual(d.groupName, Gym.GROUPS[g - 1].name);
    assert.ok(d.name && d.desc && d.desc.length > 15, d.id);
    assert.strictEqual(Gym.drill(d.id), d);
  });
  assert.deepStrictEqual(Gym.drill('full-virtual').route, { id: 'solve', params: { device: 'virtual', source: 'drill', stage: 'middle' } });
  assert.deepStrictEqual(Gym.drill('full-real').route, { id: 'solve', params: { device: 'physical', source: 'drill', stage: 'middle' } });
  assert.deepStrictEqual(Gym.GROUPS.map((g) => g.name), ['See it', 'Remember it', 'Stuck edges', 'Keep your place', 'Put it together']);
  assert.deepStrictEqual(Gym.GROUPS.slice(0, 4).map((g) => g.problem), ["I don't know what to do", "I can't remember the moves", 'An edge is stuck', 'I lose my place']);
  assert.throws(() => Gym.next('nope', { seed: 1 }));
});

// ------------------------------------------------------------ group 1: see it
test('spot: answer = exactly the top edges with no yellow, or "none" (and then an edge really is stuck)', () => {
  const counts = {};
  each('spot', (it) => {
    basicItem(it, 'spot'); middleStage(it.state, 'spot');
    assert.strictEqual(it.view, 'top');
    const ids = uniqueIds(it.options);
    assert.deepStrictEqual(ids, ['UF', 'UR', 'UB', 'UL', 'none']);
    it.options.slice(0, 4).forEach((o) => assert.deepStrictEqual(o.stickers, TOPE.find((e) => e.name === o.id).stickers));
    const u = usableTopT(it.state);
    counts[u.length] = (counts[u.length] || 0) + 1;
    if (u.length) assert.deepStrictEqual(it.answer.slice().sort(), u.slice().sort());
    else {
      assert.deepStrictEqual(it.answer, ['none']);
      const inMiddle = MID.filter((e) => e.stickers.every((i) => it.state[i] !== 'Y'));
      assert.strictEqual(inMiddle.length, 4, 'all four middle-layer edges are in the middle layer');
      assert.ok(MID.some((e) => !home(it.state, e)), 'and one of them is stuck');
    }
    assert.ok(Gym.check(it, it.answer.slice().reverse()).correct);
    if (it.answer[0] !== 'none') {
      const fewer = Gym.check(it, it.answer.slice(1));
      assert.ok(!fewer.correct || it.answer.length === 0); if (it.answer.length > 1) assert.deepStrictEqual(fewer.partial.missed, [it.answer[0]]);
      assert.ok(!Gym.check(it, it.answer.concat(['none'])).correct);
      const yellowEdge = ['UF', 'UR', 'UB', 'UL'].find((p) => !it.answer.includes(p));
      if (yellowEdge) assert.ok(!Gym.check(it, it.answer.concat([yellowEdge])).correct);
    } else assert.ok(!Gym.check(it, ['UF']).correct);
    assert.ok(!Gym.check(it, []).correct);
  });
  [0, 1, 2, 3, 4].forEach((n) => assert.ok(counts[n] > 40, 'saw ' + n + ' usable edges: ' + JSON.stringify(counts)));
});

test('lineup: the answer turn (and only it) puts the edge above its centre, making the T', () => {
  const counts = {};
  each('lineup', (it) => {
    basicItem(it, 'lineup'); middleStage(it.state, 'lineup');
    assert.deepStrictEqual(uniqueIds(it.options), ['U', "U'", 'U2', 'none']);
    const [side, top] = it.edge;
    assert.ok(side !== 'Y' && top !== 'Y');
    assert.strictEqual(cen(it.state, 'F'), side, 'held with the side colour in front');
    assert.ok(it.prompt.startsWith(Cube.COLOR_NAME[side].toUpperCase() + ' is in front'));
    assert.deepStrictEqual(it.highlight.slice().sort((x, y) => x - y), Cube.findEdge(it.state, side, top).stickers.slice().sort((x, y) => x - y));
    const makes = it.options.filter((o) => { const s = ap(it.state, o.id === 'none' ? [] : [o.id]); const e = Cube.findEdge(s, side, top); return e.name === 'UF' && s[19] === side && s[22] === side && s[25] === side; });
    assert.strictEqual(makes.length, 1, 'exactly one turn makes the T');
    assert.strictEqual(makes[0].id, it.answer);
    counts[it.answer] = (counts[it.answer] || 0) + 1;
    assert.ok(Gym.check(it, it.answer).correct);
    it.options.filter((o) => o.id !== it.answer).forEach((o) => assert.ok(!Gym.check(it, o.id).correct));
  });
  ['U', "U'", 'U2', 'none'].forEach((t) => assert.ok(counts[t] > 80, JSON.stringify(counts)));
});

test('leftright: the top colour says which way; that algorithm inserts it and the other one does not', () => {
  const counts = {};
  each('leftright', (it) => {
    basicItem(it, 'leftright'); middleStage(it.state, 'leftright');
    assert.ok(tMade(it.state), 'the T is made');
    assert.deepStrictEqual(uniqueIds(it.options), ['left', 'right']);
    const side = sideOfT(it.state);
    assert.strictEqual(it.answer, side);
    assert.strictEqual(it.alg, side);
    const [a, b] = [it.state[19], it.state[7]];
    const end = ap(it.state, ALG[side]);
    assert.ok(edgeHome(end, a, b) && firstLayer(end));
    midHomeCols(it.state).forEach(([x, y]) => assert.ok(edgeHome(end, x, y)));
    assert.ok(!edgeHome(ap(it.state, ALG[side === 'right' ? 'left' : 'right']), a, b), 'the other algorithm puts it in the wrong slot');
    assert.deepStrictEqual(it.targetState, end);
    counts[side] = (counts[side] || 0) + 1;
    assert.ok(Gym.check(it, side).correct && !Gym.check(it, side === 'right' ? 'left' : 'right').correct);
    assert.ok(it.explain.toLowerCase().includes(Cube.COLOR_NAME[b] + ' on top matches the ' + side + ' centre') && it.explain.includes(side), it.explain);
  });
  assert.ok(counts.left > 150 && counts.right > 150, JSON.stringify(counts));
});

test('decide: which edge, which centre, which turn, which way — each step has one answer, and it matches the solver', () => {
  const counts = {};
  each('decide', (it) => {
    basicItem(it, 'decide'); middleStage(it.state, 'decide');
    assert.strictEqual(it.steps.length, 4);
    it.steps.forEach((st) => { uniqueIds(st.options); assert.ok(st.options.some((o) => o.id === st.answer)); assert.ok(st.prompt && st.explain && st.state); });
    const s = it.state, u = usableTopT(s);
    assert.strictEqual(u.length, 1, 'exactly one top edge without yellow');
    assert.strictEqual(it.steps[0].answer, u[0]);
    const e = TOPE.find((x) => x.name === u[0]), top = s[e.stickers[0]], side = s[e.stickers[1]];
    assert.strictEqual(it.steps[1].answer, side, 'face the side colour');
    assert.deepStrictEqual(it.steps[1].options.map((o) => o.id).sort(), ['B', 'G', 'O', 'R']);
    const s2 = it.steps[2].state;
    assert.strictEqual(cen(s2, 'F'), side); assert.strictEqual(cen(s2, 'U'), 'Y');
    const makes = ['U', "U'", 'U2', 'none'].filter((t) => { const x = ap(s2, t === 'none' ? [] : [t]); return x[19] === side && x[7] === top; });
    assert.deepStrictEqual(makes, [it.steps[2].answer]);
    const s3 = it.steps[3].state;
    assert.ok(tMade(s3));
    assert.strictEqual(it.steps[3].answer, sideOfT(s3));
    assert.deepStrictEqual(it.answer, it.steps.map((x) => x.answer));
    const end = ap(s, it.moves);
    assert.ok(edgeHome(end, side, top) && firstLayer(end));
    // the solver's first middle-layer step makes the same decision
    const step = Solver.nextStep(s);
    assert.strictEqual(step.stage, 'middle');
    assert.strictEqual(step.case.id, it.steps[3].answer === 'right' ? 'edge-right' : 'edge-left');
    assert.deepStrictEqual(step.moves, it.moves);
    assert.strictEqual(step.quiz.options[step.quiz.answer].toLowerCase(), it.steps[3].answer);
    counts[it.alg] = (counts[it.alg] || 0) + 1;
    assert.ok(Gym.check(it, it.answer).correct);
    const wrong = it.answer.slice(); wrong[3] = wrong[3] === 'left' ? 'right' : 'left';
    const r = Gym.check(it, wrong); assert.ok(!r.correct); assert.deepStrictEqual(r.partial, { right: 3, of: 4, firstWrong: 3 });
    assert.ok(Gym.check(it, { step: 1, id: side }).correct && !Gym.check(it, { step: 0, id: u[0] === 'UF' ? 'UB' : 'UF' }).correct);
  });
  assert.ok(counts.left > 150 && counts.right > 150);
});

// ------------------------------------------------------------ group 2: remember it
test('halves: steps follow the algorithm; each prediction has exactly one right option', () => {
  each('halves', (it, seed) => {
    basicItem(it, 'halves'); middleStage(it.state, 'halves'); assert.ok(tMade(it.state));
    const A = ALG[it.alg];
    assert.deepStrictEqual(it.moves, A); assert.strictEqual(it.steps.length, 8);
    it.steps.forEach((st, i) => {
      assert.strictEqual(st.token, A[i]); assert.strictEqual(st.answer, A[i]); assert.strictEqual(st.half, i < 4 ? 0 : 1);
      assert.strictEqual(st.plain, Cube.moveInfo(A[i]).text);
      assert.deepStrictEqual(st.state, ap(it.state, A.slice(0, i))); assert.deepStrictEqual(st.stateAfter, ap(it.state, A.slice(0, i + 1)));
      const ids = uniqueIds(st.options); assert.strictEqual(ids.length, 4); assert.strictEqual(ids.filter((x) => x === A[i]).length, 1);
      assert.strictEqual(st.ask, i % 4 !== 0, 'level 1 shows the first move of each half');
    });
    assert.deepStrictEqual(it.halfStates, [it.state, ap(it.state, A.slice(0, 4)), ap(it.state, A)]);
    assert.ok(Gym.check(it, it.steps.map((x) => x.answer)).correct);
    const wrong = it.steps.map((x) => x.answer); wrong[1] = wrong[1] === 'R' ? "R'" : 'R';
    assert.ok(!Gym.check(it, wrong).correct);
    if (seed <= 50) { const l2 = Gym.next('halves', { seed, level: 2 }); assert.ok(l2.steps.every((x) => x.ask)); }
  });
});

test('nextmove: after k moves the next move is the answer; options are distinct', () => {
  const combos = new Set();
  each('nextmove', (it) => {
    basicItem(it, 'nextmove'); middleStage(it.startState, 'nextmove');
    const A = ALG[it.alg], k = it.done.length;
    assert.deepStrictEqual(it.done, A.slice(0, k));
    assert.ok(tMade(it.startState));
    assert.deepStrictEqual(it.state, ap(it.startState, it.done));
    assert.strictEqual(it.answer, A[k]);
    const ids = uniqueIds(it.options); assert.strictEqual(ids.length, 4); assert.ok(ids.includes(A[k]));
    combos.add(it.alg + k);
    assert.ok(Gym.check(it, A[k]).correct);
    ids.filter((x) => x !== A[k]).forEach((x) => assert.ok(!Gym.check(it, x).correct));
  });
  assert.strictEqual(combos.size, 16, 'both algorithms, every k');
});

test('mirror: the answer is the mirror of what is given, and equals the other algorithm\'s matching part', () => {
  each('mirror', (it) => {
    basicItem(it, 'mirror');
    assert.deepStrictEqual(it.answer, Gym.mirror(it.given));
    assert.strictEqual(it.steps.length, it.answer.length);
    it.steps.forEach((st, i) => { assert.strictEqual(st.answer, it.answer[i]); assert.deepStrictEqual(uniqueIds(st.options), Gym.PAD); });
    const g = it.given.join(' ');
    const parts = { [RIGHT.join(' ')]: LEFT, [LEFT.join(' ')]: RIGHT, [RIGHT.slice(0, 4).join(' ')]: LEFT.slice(0, 4), [RIGHT.slice(4).join(' ')]: LEFT.slice(4),
      [LEFT.slice(0, 4).join(' ')]: RIGHT.slice(0, 4), [LEFT.slice(4).join(' ')]: RIGHT.slice(4) };
    if (it.given.length > 1) assert.deepStrictEqual(it.answer, parts[g], 'matches the real algorithm');
    if (it.moves) { const end = ap(it.state, it.moves); if (it.moves.length === 8) assert.ok(edgeHome(end, it.state[19], it.state[7]) && firstLayer(end)); }
    assert.ok(Gym.check(it, it.answer).correct);
    if (it.given.length > 1) assert.ok(!Gym.check(it, it.given).correct, 'the unmirrored moves are wrong');
    assert.ok(!Gym.check(it, it.answer.map(Cube.invertMove)).correct);
  });
});

function performChecks(it, extraWrong) {
  const g = it.goal;
  assert.ok(g && it.targetState && it.moves && it.moves.length);
  assert.deepStrictEqual(it.targetState, ap(it.state, it.moves));
  assert.ok(!goalIndependent(g, it.state), 'not already done');
  assert.ok(goalIndependent(g, it.targetState), 'the intended moves reach the goal');
  assert.ok(Gym.check(it, it.targetState).correct);
  // alternative correct solutions: extra top turns, the cube held another way, a fresh solver plan
  ['U', "U'", 'U2', 'y', "y'", 'y2', 'U y2', 'x2', 'z', "x'"].forEach((x) => {
    const alt = ap(it.targetState, x);
    const want = goalIndependent(g, alt);
    assert.ok(want, 'alternative finish (' + x + ') still meets the goal');
    assert.ok(Gym.check(it, alt).correct, 'alternative finish (' + x + ') accepted');
  });
  if (g.kind !== 'popout') {
    const sol = Solver.solve(it.state).stages[3].endState;   // solve the whole middle layer another way
    assert.ok(goalIndependent(g, sol)); assert.ok(Gym.check(it, sol).correct, 'solver plan accepted');
  }
  // wrong: nothing done, a white-layer-breaking move left in, and whatever the caller adds
  assert.ok(!Gym.check(it, it.state).correct);
  const broken = ap(it.targetState, 'R');
  assert.strictEqual(Gym.check(it, broken).correct, goalIndependent(g, broken));
  assert.ok(!Gym.check(it, broken).correct, 'white layer broken');
  (extraWrong || []).forEach((w) => { const s = ap(it.state, w); assert.strictEqual(Gym.check(it, s).correct, goalIndependent(g, s)); assert.ok(!goalIndependent(g, s), 'wrong: ' + w); });
  assert.ok(!Gym.check(it, null).correct && !Gym.check(it, [1, 2]).correct);
}

test('recall: fading cues; check() accepts any state that inserts the edge and rejects wrong ones', () => {
  const lv = { 1: [1, 1, 1, 1, 1, 1, 1, 1], 2: [1, 0, 1, 0, 1, 0, 1, 0], 3: [1, 0, 0, 0, 0, 0, 0, 0], 4: [0, 0, 0, 0, 0, 0, 0, 0] };
  each('recall', (it, seed) => {
    basicItem(it, 'recall'); middleStage(it.state, 'recall'); assert.ok(tMade(it.state));
    assert.deepStrictEqual(it.moves, ALG[it.alg]); assert.strictEqual(sideOfT(it.state), it.alg);
    assert.deepStrictEqual(it.goal.edge, [it.state[19], it.state[7]]);
    const other = it.alg === 'right' ? 'left' : 'right';
    const slipped = ALG[it.alg].slice(); slipped[3] = Cube.invertMove(slipped[3]);
    performChecks(it, [ALG[other], slipped, ALG[it.alg].slice(0, 7), ALG[it.alg].slice(0, 4)]);
    const L = 1 + (seed % 4), x = Gym.next('recall', { seed, level: L });
    assert.deepStrictEqual(x.cues, lv[L].map(Boolean));
  });
});

// ------------------------------------------------------------ group 3: stuck edges
test('stuck-spot: the highlighted front-right edge really is home / flipped / in the wrong slot', () => {
  const counts = {};
  each('stuck-spot', (it) => {
    basicItem(it, 'stuck-spot'); middleStage(it.state, 'stuck-spot');
    assert.deepStrictEqual(it.highlight, [23, 12]);
    assert.deepStrictEqual(uniqueIds(it.options), ['fine', 'flipped', 'wrong-slot']);
    const cat = category(it.state, 'FR');
    assert.notStrictEqual(cat, 'yellow');
    assert.strictEqual(it.answer, cat === 'home' ? 'fine' : cat);
    counts[it.answer] = (counts[it.answer] || 0) + 1;
    if (it.answer !== 'fine') {
      // really stuck where it is, and the Right algorithm pops it to the top
      const cols = [it.state[23], it.state[12]];
      assert.ok(!edgeHome(it.state, cols[0], cols[1]));
      const out = ap(it.state, RIGHT);
      assert.strictEqual(Cube.findEdge(out, cols[0], cols[1]).name[0], 'U'); assert.ok(firstLayer(out));
    }
    assert.ok(Gym.check(it, it.answer).correct);
    it.options.filter((o) => o.id !== it.answer).forEach((o) => assert.ok(!Gym.check(it, o.id).correct));
  });
  ['fine', 'flipped', 'wrong-slot'].forEach((c) => assert.ok(counts[c] > 120, JSON.stringify(counts)));
});

test('stuck-fix: really stuck (no turn of the top helps); only "front-right + Right" frees it; perform accepts the mirror way too', () => {
  const counts = {};
  each('stuck-fix', (it) => {
    basicItem(it, 'stuck-fix'); middleStage(it.state, 'stuck-fix');
    const s = it.state, [a, b] = it.goal.edge;
    ['', 'U', "U'", 'U2'].forEach((u) => assert.strictEqual(usableTopT(ap(s, u)).length, 0, 'no usable top edge after ' + (u || 'no turn')));
    const where = Cube.findEdge(s, a, b);
    assert.ok(MID.some((e) => e.name === where.name), 'the edge is in the middle layer');
    const cat = category(s, where.name);
    assert.strictEqual(cat, it.stuck); assert.ok(cat === 'flipped' || cat === 'wrong-slot');
    assert.deepStrictEqual(it.highlight.slice().sort((x, y) => x - y), MID.find((e) => e.name === where.name).stickers.slice().sort((x, y) => x - y));
    assert.deepStrictEqual(uniqueIds(it.options).sort(), ['left-at-fr', 'right-at-fl', 'right-at-fr', 'turn-top']);
    assert.strictEqual(it.answer, 'right-at-fr');
    // each wrong choice really fails: the stuck edge does not move
    const unchanged = (t) => { const e = Cube.findEdge(t, a, b); return e.name === Cube.findEdge(norm(t), a, b).name && e; };
    const atFL = ap(s, ROT_FL[where.name] + ' ' + RIGHT.join(' ')), atFR = ap(s, ROT_FR[where.name] + ' ' + LEFT.join(' '));
    [atFL, atFR].forEach((t) => { assert.ok(unchanged(t)); assert.ok(!goalIndependent(it.goal, t)); assert.strictEqual(category(t, Cube.findEdge(t, a, b).name), cat); });
    // the right choice works, and so does the mirror way (slot at front-left, Left algorithm)
    performChecks(it, (where.name !== 'FR' ? [RIGHT] : []).concat(where.name !== 'FL' ? [LEFT] : []));
    const mirrorWay = ap(s, ROT_FL[where.name] + ' ' + LEFT.join(' '));
    assert.ok(goalIndependent(it.goal, mirrorWay) && Gym.check(it, mirrorWay).correct, 'the mirror way also pops it out');
    assert.ok(Gym.check(it, 'right-at-fr').correct);
    ['right-at-fl', 'left-at-fr', 'turn-top'].forEach((w) => { const r = Gym.check(it, w); assert.ok(!r.correct && r.explain.length > 40); });
    counts[cat] = (counts[cat] || 0) + 1;
  });
  assert.ok(counts.flipped > 150 && counts['wrong-slot'] > 150, JSON.stringify(counts));
});

// ------------------------------------------------------------ group 4: keep your place
function landmarkIndependent(s, a, after, t) {
  const R = a === 'right';
  if (after === 4) {
    const e = Cube.findEdge(s, t.side, t.top), c = Cube.findCorner(s, 'W', t.side, t.top);
    return e.name === 'UF' && e.faces[0] === 'F' && c.name === (R ? 'URF' : 'UFL') && c.faces[0] === (R ? 'R' : 'L') && !firstLayer(s);
  }
  return firstLayer(s) && edgeHome(s, t.side, t.top) && t.keep.every(([x, y]) => edgeHome(s, x, y));
}
test('landmark: exactly one of the three pictures shows the landmark, and it is the answer', () => {
  const counts = {};
  each('landmark', (it) => {
    basicItem(it, 'landmark'); middleStage(it.state, 'landmark'); assert.ok(tMade(it.state));
    assert.strictEqual(it.options.length, 3); uniqueIds(it.options);
    const t = { side: it.state[19], top: it.state[7], keep: midHomeCols(it.state) };
    assert.strictEqual(new Set(it.options.map((o) => str(o.state))).size, 3, 'three different pictures');
    const good = it.options.filter((o) => landmarkIndependent(o.state, it.alg, it.after, t));
    assert.strictEqual(good.length, 1, 'one defensible picture');
    assert.strictEqual(good[0].id, it.answer);
    assert.deepStrictEqual(good[0].state, ap(it.state, ALG[it.alg].slice(0, it.after)));
    assert.ok(it.explain.includes(Gym.LANDMARKS[it.alg][it.after === 4 ? 0 : 1].text));
    it.options.forEach((o) => { if (o.id !== it.answer) { const r = Gym.check(it, o.id); assert.ok(!r.correct && r.explain.startsWith(o.why)); } });
    assert.ok(Gym.check(it, it.answer).correct);
    counts[it.alg + it.after] = (counts[it.alg + it.after] || 0) + 1;
    counts['pos-' + it.answer] = (counts['pos-' + it.answer] || 0) + 1;
  });
  ['right4', 'right8', 'left4', 'left8', 'pos-a', 'pos-b', 'pos-c'].forEach((k) => assert.ok(counts[k] > 80, JSON.stringify(counts)));
});

test('whereami: the cube really is k moves in; every count option is a different-looking cube', () => {
  const types = {};
  each('whereami', (it) => {
    basicItem(it, 'whereami'); middleStage(it.startState, 'whereami'); assert.ok(tMade(it.startState));
    assert.strictEqual(firstLayer(it.state), it.done.length <= 1, 'white layer broken from the 2nd move on');
    const A = ALG[it.alg], k = it.done.length;
    assert.ok(k >= 1 && k <= 7);
    assert.deepStrictEqual(it.done, A.slice(0, k)); assert.deepStrictEqual(it.state, ap(it.startState, A.slice(0, k)));
    uniqueIds(it.options); assert.strictEqual(it.options.length, 4);
    if (it.question === 'count') {
      assert.strictEqual(it.answer, String(k));
      const states = it.options.map((o) => str(ap(it.startState, A.slice(0, +o.id))));
      assert.strictEqual(new Set(states).size, 4, 'each count gives a different cube');
      assert.strictEqual(it.options.filter((o, i) => states[i] === str(it.state)).length, 1);
    } else {
      assert.strictEqual(it.answer, A[k]);
      assert.ok(it.options.some((o) => o.id === A[k]));
    }
    const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
    assert.ok(it.explain.includes(lc(Gym.whereText(it.alg, k))) && it.explain.includes('You have done ' + k) && it.explain.endsWith('Next is ' + A[k] + ' (' + Cube.moveInfo(A[k]).text + ').'));
    types[it.question] = (types[it.question] || 0) + 1;
    assert.ok(Gym.check(it, it.answer).correct);
    it.options.filter((o) => o.id !== it.answer).forEach((o) => assert.ok(!Gym.check(it, o.id).correct));
  });
  assert.ok(types.count > 150 && types.next > 150);
  // the cube after k moves is different for every k = 0..8 (so a picture fixes where you are)
  tStates(30).forEach(({ a, t }) => assert.strictEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => str(ap(t, ALG[a].slice(0, k))))).size, 9));
});

test('slip: one wrong move; carrying on fails; undo + finish works, and so do other correct ways', () => {
  const kinds = {};
  each('slip', (it) => {
    basicItem(it, 'slip'); assert.ok(firstLayer(it.startState) && tMade(it.startState));
    const A = ALG[it.alg], j = it.slipIndex;
    assert.ok(j >= 0 && j <= 7);
    assert.deepStrictEqual(it.done.slice(0, j), A.slice(0, j));
    assert.strictEqual(it.done[j], it.wrong); assert.strictEqual(it.should, A[j]); assert.notStrictEqual(it.wrong, it.should);
    assert.ok(it.wrong === Cube.invertMove(A[j]) || it.wrong === Gym.mirrorMove(A[j]), 'a direction or side slip');
    kinds[it.wrong === Cube.invertMove(A[j]) ? 'direction' : 'side'] = 1 + (kinds[it.wrong === Cube.invertMove(A[j]) ? 'direction' : 'side'] || 0);
    assert.deepStrictEqual(it.state, ap(it.startState, it.done));
    assert.deepStrictEqual(it.moves, [Cube.invertMove(it.wrong)].concat(A.slice(j)));
    assert.deepStrictEqual(it.targetState, ap(it.startState, A), 'undo + finish = the algorithm done properly');
    const carryOn = A.slice(j + 1);
    assert.ok(!goalIndependent(it.goal, ap(it.state, carryOn)), 'carrying on without undoing fails');
    performChecks(it, [carryOn, Cube.invertAlg(it.done)]);
    // another correct way: undo everything back to the T, then the whole algorithm
    const restart = ap(it.state, Cube.invertAlg(it.done).concat(A));
    assert.ok(Gym.check(it, restart).correct);
  });
  assert.ok(kinds.direction > 200 && kinds.side > 50, JSON.stringify(kinds));
});

test('slowmo: one move at a time, checkpoints after each half', () => {
  each('slowmo', (it) => {
    basicItem(it, 'slowmo'); middleStage(it.state, 'slowmo'); assert.ok(tMade(it.state));
    const A = ALG[it.alg];
    assert.deepStrictEqual(it.steps.map((x) => x.token), A);
    it.steps.forEach((st, i) => {
      assert.deepStrictEqual(st.state, ap(it.state, A.slice(0, i + 1)));
      assert.strictEqual(st.plain, Cube.moveInfo(A[i]).text);
      assert.strictEqual(st.where, Gym.whereText(it.alg, i + 1));
      assert.strictEqual(!!st.checkpoint, i === 3 || i === 7);
    });
    assert.strictEqual(it.steps[3].checkpoint.text, Gym.LANDMARKS[it.alg][0].text);
    assert.strictEqual(it.steps[7].checkpoint.text, Gym.LANDMARKS[it.alg][1].text);
    assert.ok(goalIndependent({ kind: 'insert', edge: [it.state[19], it.state[7]], keep: midHomeCols(it.state) }, it.steps[7].state));
    assert.ok(Gym.check(it, true).correct && !Gym.check(it, false).correct);
  }, 200);
});

// ------------------------------------------------------------ group 5: put it together
test('full-virtual / full-real: route items with a middle-layer drill scramble', () => {
  ['full-virtual', 'full-real'].forEach((id) => each(id, (it) => {
    basicItem(it, id); middleStage(it.state, id);
    assert.deepStrictEqual(it.route, Gym.drill(id).route);
    assert.deepStrictEqual(ap(Y0, it.scramble), it.state);
    assert.ok(it.scramble.every((m) => /^[URFDLB]['2]?$/.test(m)));
    assert.ok(Gym.check(it, it.state).correct === false && Gym.check(it, Solver.solve(it.state).stages[3].endState).correct);
  }, 100));
});

test('sprint: all four middle edges to place; any solved first-two-layers counts', () => {
  each('sprint', (it) => {
    basicItem(it, 'sprint'); middleStage(it.state, 'sprint');
    assert.strictEqual(MID.filter((e) => !home(it.state, e)).length, 4, 'all four slots unsolved');
    assert.strictEqual(it.goal.kind, 'f2l');
    assert.ok(f2l(it.targetState));
    performChecks(it, [RIGHT, LEFT]);
  });
});

// ------------------------------------------------------------ sessions and determinism
test('sessions: 10 items, no duplicates, sub-cases spread out; next() and session() are deterministic', () => {
  Gym.DRILLS.forEach((d) => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const ses = Gym.session(d.id, { seed });
      assert.strictEqual(ses.length, 10, d.id);
      assert.strictEqual(new Set(ses.map((x) => x.key)).size, 10, d.id + ' unique keys');
      assert.strictEqual(new Set(ses.map((x) => JSON.stringify([x.prompt, x.state, x.answer, x.options && x.options.map((o) => o.id)]))).size, 10, d.id + ' no identical items');
      ses.forEach((x) => assert.strictEqual(x.drillId, d.id));
      const pool = Gym.CONCEPTS[d.id];
      if (pool && pool.length >= 10) assert.strictEqual(new Set(ses.map((x) => x.concept)).size, 10, d.id + ' every item a different case');
      if (pool && pool.length < 10) {
        const c = {}; ses.forEach((x) => (c[x.concept] = (c[x.concept] || 0) + 1));
        assert.ok(Math.max(...Object.values(c)) - Math.min(...Object.values(c)) <= 1 && Object.keys(c).length === pool.length, d.id + ' even spread ' + JSON.stringify(c));
      }
      assert.deepStrictEqual(JSON.stringify(Gym.session(d.id, { seed })), JSON.stringify(ses), d.id + ' deterministic');
    }
    assert.deepStrictEqual(JSON.stringify(Gym.next(d.id, { seed: 5 })), JSON.stringify(Gym.next(d.id, { seed: 5 })));
    assert.strictEqual(Gym.session(d.id, { seed: 3, count: 4 }).length, 4);
  });
  // recall fades its cues across a round; mirror goes short to long
  assert.deepStrictEqual(Gym.session('recall', { seed: 1 }).map((x) => x.level), [1, 1, 2, 2, 3, 3, 3, 4, 4, 4]);
  const lens = Gym.session('mirror', { seed: 1 }).map((x) => x.answer.length);
  assert.deepStrictEqual(lens, lens.slice().sort((a, b) => a - b));
  // a bigger round than there are sub-cases still has no duplicates
  assert.strictEqual(new Set(Gym.session('leftright', { seed: 8, count: 30 }).map((x) => x.key)).size, 30);
});

// ------------------------------------------------------------ progress helpers
test('record / isStrong / suggest', () => {
  const data = globalThis.CC.Store.defaults();
  const now = new Date('2026-11-14T10:00:00Z');
  for (let i = 0; i < 7; i++) Gym.record(data, 'leftright', true, { ms: 2000 - i * 100 }, now);
  assert.ok(!Gym.isStrong(data.gym.leftright));
  const r = Gym.record(data, 'leftright', true, { ms: 900 }, now);
  assert.ok(r.strong);
  Gym.record(data, 'leftright', false, {}, now);
  const g = data.gym.leftright;
  assert.deepStrictEqual([g.right, g.total, g.streak, g.best, g.bestMs], [8, 9, 0, 8, 900]);
  assert.strictEqual(g.recent.length, 9); assert.strictEqual(g.lastAt, now.toISOString());
  for (let i = 0; i < 5; i++) Gym.record(data, 'leftright', true, {}, now);
  assert.strictEqual(g.recent.length, 10);
  assert.deepStrictEqual(data.drills['gym-leftright'], { right: 13, total: 14, lastAt: now.toISOString() }, 'Coach.recordDrill was called');
  Gym.record(data, 'spot', true, { coach: false }, now);
  assert.ok(!data.drills['gym-spot']);
  assert.strictEqual(Gym.record(data, 'nope', true), null);
  // suggestion: the weakest of the four problems; ties go to the learner's own order (remembering first)
  const fresh = globalThis.CC.Store.defaults();
  assert.deepStrictEqual(Gym.suggest(fresh).drillId, 'halves');
  assert.deepStrictEqual(Gym.PRIORITY, [2, 1, 3, 4]);
  ['spot', 'lineup', 'leftright', 'decide'].forEach((id) => { for (let i = 0; i < 10; i++) Gym.record(fresh, id, true, {}, now); });
  const s2 = Gym.suggest(fresh);
  assert.strictEqual(s2.group, 2); assert.strictEqual(s2.drillId, 'halves');
  Gym.DRILLS.forEach((d) => { if (d.kind !== 'route') for (let i = 0; i < 10; i++) Gym.record(fresh, d.id, true, {}, now); });
  assert.strictEqual(Gym.suggest(fresh).group, 5);
  assert.ok(Gym.suggest(null).drillId);
});

test('recordRound keeps the best perfect round; suggest picks the weakest drill of the weakest problem', () => {
  const data = globalThis.CC.Store.defaults();
  const now = new Date('2026-11-15T10:00:00Z');
  assert.deepStrictEqual(Gym.recordRound(data, 'leftright', { right: 10, total: 10, ms: 9000 }), { best: false }, 'nothing recorded yet');
  for (let i = 0; i < 10; i++) Gym.record(data, 'leftright', true, {}, now);
  assert.strictEqual(Gym.recordRound(data, 'leftright', { right: 9, total: 10, ms: 5000 }).best, false, 'an imperfect round is never a best');
  assert.strictEqual(data.gym.leftright.bestRoundMs, undefined);
  assert.strictEqual(Gym.recordRound(data, 'leftright', { right: 10, total: 10, ms: 12000.4 }).best, true);
  assert.strictEqual(data.gym.leftright.bestRoundMs, 12000);
  assert.strictEqual(Gym.recordRound(data, 'leftright', { right: 10, total: 10, ms: 13000 }).best, false);
  const r = Gym.recordRound(data, 'leftright', { right: 10, total: 10, ms: 11000 });
  assert.ok(r.best && r.previous === 12000); assert.strictEqual(data.gym.leftright.bestRoundMs, 11000);
  assert.strictEqual(data.gym.leftright.bestMs, null, 'the best single answer is a different record');
  assert.strictEqual(Gym.recordRound(data, 'nope', { right: 1, total: 1, ms: 1 }).best, false);
  assert.strictEqual(Gym.recordRound(null, 'leftright', { right: 1, total: 1, ms: 1 }).best, false);
  // suggest: inside the weakest group, the weakest drill that is not strong (ties: the earlier one)
  const d2 = globalThis.CC.Store.defaults();
  const rec = (id, rights, n) => { for (let i = 0; i < n; i++) Gym.record(d2, id, i < rights, {}, now); };
  ['spot', 'lineup', 'leftright', 'decide'].forEach((id) => rec(id, 10, 10));            // group 1 strong
  ['stuck-spot', 'stuck-fix', 'landmark', 'whereami', 'slip'].forEach((id) => rec(id, 9, 10));
  rec('halves', 7, 10); rec('nextmove', 3, 10); rec('mirror', 6, 10); rec('recall', 7, 10);   // group 2 weakest
  assert.deepStrictEqual([Gym.suggest(d2).group, Gym.suggest(d2).drillId], [2, 'nextmove'], 'the weakest drill, not just the first');
  rec('nextmove', 10, 10);
  assert.strictEqual(Gym.suggest(d2).drillId, 'mirror');
  assert.strictEqual(Gym.suggest(d2, { hasCube: false }).drillId, 'mirror');
});

// ------------------------------------------------------------ feedback on wrong answers (review round)
// Every wrong option carries a `why`, check() puts it first, and every cube fact in it is re-derived here.
const WORD = { UF: 'front', UR: 'right', UB: 'back', UL: 'left' };
const CN = (c) => Cube.COLOR_NAME[c];
function expectWhys(opts, answer, label) {
  opts.forEach((o) => {
    if (o.id === answer) assert.ok(!o.why, label + ': no why on the right answer');
    else assert.ok(typeof o.why === 'string' && o.why.length > 15, label + ': why on wrong option ' + o.id);
  });
}
// independent re-derivation of what a "what comes next" why must say
function checkMoveWhy(a, k, o) {
  const A = ALG[a], ans = A[k], pos = A.map((m, i) => (m === o.id ? i + 1 : 0)).filter(Boolean);
  if (o.id === ans) return;
  if (!pos.length) {
    assert.ok(o.why.startsWith(o.id + ' is not in the ' + (a === 'right' ? 'Right' : 'Left') + ' algorithm'), o.why);
    assert.ok(!ALG[a].includes(o.id) && ALG[a === 'right' ? 'left' : 'right'].includes(o.id), 'a move from the other algorithm');
    if (o.id === Gym.mirrorMove(ans)) assert.match(o.why, /mirror/);
  } else if (o.id === Cube.invertMove(ans)) {
    assert.ok(o.why === o.id + ' turns the other way: move ' + (k + 1) + ' is ' + ans + '.', o.why);
  } else {
    const where = (pos.length > 1 ? 'moves ' + pos.slice(0, -1).join(', ') + ' and ' + pos[pos.length - 1] : 'move ' + pos[0]);
    if (pos.every((p) => p > k + 1)) assert.ok(o.why.startsWith(o.id + ' comes later (' + where + '), not move ' + (k + 1) + '.'), o.why);
    else if (pos.every((p) => p < k + 1)) assert.ok(o.why.startsWith(o.id + ' came earlier (' + where + '), not move ' + (k + 1) + '.'), o.why);
    else assert.ok(o.why.startsWith(o.id + ' is ' + where + ', not move ' + (k + 1) + '.'), o.why);
  }
}
function checkTurnWhy(s, side, top, o, answer) {
  if (o.id === answer) return;
  const e = Cube.findEdge(ap(s, o.id === 'none' ? [] : [o.id]), side, top);
  assert.notStrictEqual(e.name, 'UF');
  assert.ok(o.why.includes('the ' + WORD[e.name] + ' of the top layer'), 'turn why names where it really goes: ' + o.why);
}
function checkSideWhy(s, side, o) {
  if (o.id === side) return;
  const end = ap(s, ALG[o.id]), e = Cube.findEdge(end, s[19], s[7]);
  assert.strictEqual(e.name, o.id === 'right' ? 'FR' : 'FL', 'the other algorithm drops it into the other front slot');
  assert.ok(!edgeHome(end, s[19], s[7]) && firstLayer(end));
  assert.ok(o.why.includes('front-' + o.id + ' slot') && o.why.includes('Its top colour is ' + CN(s[7])) && o.why.includes('the ' + o.id + ' centre is ' + CN(cen(s, o.id === 'right' ? 'R' : 'L'))), o.why);
}

test('wrong answers explain themselves, and every cube fact in the explanation is true', () => {
  const n = Math.round(SEEDS / 2);
  each('lineup', (it) => {
    expectWhys(it.options, it.answer, 'lineup');
    it.options.forEach((o) => checkTurnWhy(it.state, it.edge[0], it.edge[1], o, it.answer));
    it.options.filter((o) => o.id !== it.answer).forEach((o) => assert.ok(Gym.check(it, o.id).explain.startsWith(o.why)));
  }, n);
  each('leftright', (it) => {
    expectWhys(it.options, it.answer, 'leftright');
    it.options.forEach((o) => checkSideWhy(it.state, it.answer, o));
  }, n);
  each('decide', (it) => {
    it.steps.forEach((st, i) => {
      expectWhys(st.options, st.answer, 'decide ' + st.id);
      st.options.filter((o) => o.id !== st.answer).forEach((o) => {
        const r = Gym.check(it, { step: i, id: o.id });
        assert.ok(!r.correct && r.explain.startsWith(o.why + ' ' + st.explain), 'step check puts the why first');
      });
      assert.ok(Gym.check(it, { step: i, id: st.answer }).explain === st.explain);
    });
    const [e0, c1, t2, s3] = it.steps;
    e0.options.filter((o) => o.id !== e0.answer).forEach((o) => assert.ok(TOPE.find((x) => x.name === o.id).stickers.some((j) => it.state[j] === 'Y'), 'that edge really has yellow'));
    const [side, top] = it.edge;
    c1.options.filter((o) => o.id === top).forEach((o) => assert.match(o.why, /top colour/));
    c1.options.filter((o) => o.id !== top && o.id !== side).forEach((o) => assert.ok(o.why.includes('is not on this edge at all: it is ' + CN(side) + ' on the side and ' + CN(top) + ' on top'), o.why));
    t2.options.forEach((o) => checkTurnWhy(t2.state, side, top, o, t2.answer));
    s3.options.forEach((o) => checkSideWhy(s3.state, s3.answer, o));
  }, n);
  ['nextmove', 'whereami', 'halves'].forEach((id) => each(id, (it) => {
    const qs = id === 'halves' ? it.steps.map((st, i) => [st.options, st.answer, i]) : it.question === 'count' ? [] : [[it.options, it.answer, it.done.length]];
    qs.forEach(([opts, answer, k]) => { expectWhys(opts, answer, id); opts.forEach((o) => checkMoveWhy(it.alg, k, o)); });
  }, n));
  each('whereami', (it) => {
    if (it.question !== 'count') return;
    expectWhys(it.options, it.answer, 'whereami count');
    const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
    it.options.filter((o) => o.id !== it.answer).forEach((o) => {
      const m = +o.id;
      if (m === 0) assert.match(o.why, /before/); else if (m === 8) assert.match(o.why, /finished/); else assert.ok(o.why.endsWith(lc(Gym.whereText(it.alg, m))), o.why);
      assert.ok(Gym.check(it, o.id).explain.startsWith(o.why));
    });
  }, n);
  each('mirror', (it) => {
    it.steps.forEach((st, i) => {
      expectWhys(st.options, st.answer, 'mirror');
      const g = it.given[i], given = st.options.find((o) => o.id === g);
      if (g !== st.answer) assert.match(given.why, /the move you were given/);
      if (/^[RL]/.test(g)) {
        assert.match(st.options.find((o) => o.id === Cube.invertMove(st.answer)).why, /now turn it the other way too/);
        assert.match(st.options.find((o) => o.id === Cube.invertMove(g)).why, /now swap/);
      }
    });
    assert.ok(it.explain.includes(Gym.MIRROR_FEEL));
  }, n);
  each('stuck-spot', (it) => {
    expectWhys(it.options, it.answer, 'stuck-spot');
    const s = it.state, a0 = s[23], b0 = s[12], cF = cen(s, 'F'), cR = cen(s, 'R');
    it.options.filter((o) => o.id !== it.answer).forEach((o) => {
      // every "its X sticker is next to the Y centre" in the why is literally true
      const claims = [...o.why.matchAll(/its (\w+) sticker (?:is )?next to the (\w+) centre/gi)];
      for (const m of claims) {
        const st = m[1] === CN(a0) && m[2] === CN(cF) ? 23 : m[1] === CN(b0) && m[2] === CN(cR) ? 12 : -1;
        assert.ok(st >= 0, 'sticker claim matches the cube: ' + o.why);
      }
      if (/do not match/.test(o.why)) { assert.notStrictEqual(it.answer, 'fine'); assert.strictEqual(claims.length, 1); assert.notStrictEqual(claims[0][1], claims[0][2], 'they really do not match: ' + o.why); }
      if (/Both match/.test(o.why)) { assert.strictEqual(it.answer, 'fine'); assert.ok(claims.length === 2 && claims.every((m) => m[1] === m[2])); }
    });
  }, n);
  each('stuck-fix', (it) => expectWhys(it.options, it.answer, 'stuck-fix'), 50);
  each('landmark', (it) => expectWhys(it.options, it.answer, 'landmark'), 50);
});

test('stuck-spot explanations: the flipped and wrong-slot copy says what is really on the cube', () => {
  const seen = { flipped: 0, 'wrong-slot': 0, knock: 0 };
  each('stuck-spot', (it) => {
    const s = it.state, a0 = s[23], b0 = s[12], cF = cen(s, 'F'), cR = cen(s, 'R');
    assert.ok(!/its (\w+) sticker is on the \1 side/i.test(it.explain), 'no "its green sticker is on the green side": ' + it.explain);
    if (it.answer === 'flipped') {
      seen.flipped++;
      assert.strictEqual(a0, cR); assert.strictEqual(b0, cF);
      assert.ok(it.explain.includes('its ' + CN(a0) + ' sticker is on the front, next to the ' + CN(cF) + ' centre'), it.explain);
      assert.ok(it.explain.includes('its colours, ' + CN(a0) + ' and ' + CN(b0) + ', are the centres either side'));
    }
    if (it.answer === 'wrong-slot') {
      seen['wrong-slot']++;
      assert.ok(it.explain.includes('It is the ' + CN(a0) + '–' + CN(b0) + ' edge') && it.explain.includes('either side are ' + CN(cF) + ' and ' + CN(cR)));
      // "if this slot's own edge is on top, putting it in knocks this one out for you"
      const own = Cube.findEdge(s, cF, cR);
      if (own.name[0] === 'U') {
        let done = false;
        for (const pre of ['', 'U', "U'", 'U2', 'y', 'y U', "y U'", 'y U2']) for (const a of ['right', 'left']) {
          if (done) continue;
          const t = ap(s, pre);
          if (!(t[19] === cen(t, 'F') && t[7] === cen(t, a === 'right' ? 'R' : 'L'))) continue;   // the T, going the right way
          const end = ap(t, ALG[a]);
          if (!edgeHome(end, cF, cR)) continue;
          assert.strictEqual(Cube.findEdge(end, a0, b0).name[0], 'U', 'the stuck edge is knocked up to the top');
          assert.ok(firstLayer(end)); done = true; seen.knock++;
        }
        assert.ok(done, 'the slot\'s own edge could be put in');
      }
    }
  });
  assert.ok(seen.flipped > 100 && seen['wrong-slot'] > 100 && seen.knock > 10, JSON.stringify(seen));
});

test('perform goals: a popped-out edge that is then put back properly also counts; states as strings work', () => {
  each('stuck-fix', (it) => {
    const popped = ap(it.state, it.moves);
    const fixed = Solver.solve(popped).stages[3].endState;            // carry on and solve the middle layer
    assert.ok(edgeHome(norm(fixed), it.goal.edge[0], it.goal.edge[1]));
    assert.ok(Gym.check(it, fixed).correct, 'put back home is even better than popped out');
    assert.ok(Gym.check(it, popped.join('')).correct && !Gym.check(it, it.state.join('')).correct, 'string states');
  }, 150);
  const r = Gym.next('recall', { seed: 3 });
  assert.ok(Gym.check(r, r.targetState.join('')).correct && Gym.goalMet(r.goal, r.targetState.join('')).ok);
});

test('copy claims: mirror feel, halves wording, the corner comes from the bottom, only the slot and the top change', () => {
  // MIRROR_FEEL: R and L' both lift a side UP; U/U' and F/F' turn opposite ways
  assert.strictEqual(Cube.moveInfo('R').how, Cube.moveInfo("L'").how); assert.match(Cube.moveInfo('R').how, /UP/);
  assert.notStrictEqual(Cube.moveInfo('U').how, Cube.moveInfo("U'").how); assert.notStrictEqual(Cube.moveInfo('F').how, Cube.moveInfo("F'").how);
  assert.match(Gym.MIRROR_FEEL, /R lifts the right side UP and L' lifts the left side UP/);
  ['right', 'left'].forEach((a) => Gym.ALGS[a].halves.forEach((h) => assert.ok(!/top right|top left/.test(h.does), 'no "top right" that reads as a place: ' + h.does)));
  // "the second half is the first half again with F in place of R (L), every move turned the other way"
  ['right', 'left'].forEach((a) => {
    const [h1, h2] = Gym.ALGS[a].halves, side = a === 'right' ? 'R' : 'L';
    assert.deepStrictEqual(h1.moves.map((m) => Cube.invertMove(m.replace(side, 'F'))), h2.moves, a + ' second half from the first');
    assert.strictEqual(h2.link, 'The second half is the first half again with F in place of ' + side + ', and every move turned the other way.');
    assert.ok(Gym.next('halves', { seed: 1, concept: a }).explain.endsWith(h2.link));
  });
  tStates(40).forEach(({ a, t, side, top }) => {
    const R = a === 'right';
    assert.strictEqual(Cube.findCorner(t, 'W', side, top).name, R ? 'DFR' : 'DLF', 'the white corner starts in the bottom ' + (R ? 'front-right' : 'front-left'));
    assert.match(Gym.LANDMARKS[a][0].text, R ? /from the bottom front-right/ : /from the bottom front-left/);
    // after all eight: apart from that slot's edge, only the top layer has changed
    const end = ap(t, ALG[a]), slotSt = MID.find((e) => e.name === (R ? 'FR' : 'FL')).stickers;
    const topLayer = (i) => Cube.STICKERS[i].face === 'U' || (Cube.STICKERS[i].face !== 'D' && Cube.STICKERS[i].row === 0);
    for (let i = 0; i < 54; i++) if (!topLayer(i) && !slotSt.includes(i)) assert.strictEqual(end[i], t[i], 'sticker ' + i + ' unchanged');
    assert.match(Gym.LANDMARKS[a][1].text, /Apart from that slot, only the top layer has changed/);
  });
  // slip copy: undoing the slip really gives the cube as it was after move j
  each('slip', (it) => {
    const back = ap(it.state, [Cube.invertMove(it.wrong)]);
    assert.deepStrictEqual(back, ap(it.startState, ALG[it.alg].slice(0, it.slipIndex)));
    assert.ok(it.explain.includes(it.slipIndex ? 'as it was after move ' + it.slipIndex : 'as it was before you started'));
  }, 200);
});

test('speed: next() stays well under 20 ms', () => {
  Gym.DRILLS.forEach((d) => {
    const times = [];
    for (let s = 1; s <= 120; s++) { const t0 = process.hrtime.bigint(); Gym.next(d.id, { seed: s * 7919 }); times.push(Number(process.hrtime.bigint() - t0) / 1e6); }
    times.sort((x, y) => x - y);
    assert.ok(times[Math.floor(times.length * 0.99)] < 20, d.id + ' p99 ' + times[Math.floor(times.length * 0.99)].toFixed(1) + ' ms');
  });
});

test('plain English, British spelling, no personal names, nothing in the DOM at load', () => {
  const sample = Gym.DRILLS.map((d) => [11, 12, 13, 14].map((seed) => Gym.next(d.id, { seed }))).flat();
  const text = JSON.stringify([Gym.ALGS, Gym.DRILLS, Gym.GROUPS, Gym.LANDMARKS, Gym.MIRROR_FEEL, sample.map((x) => [x.prompt, x.performPrompt, x.explain, x.options, x.steps && x.steps.map((st) => [st.prompt, st.explain, st.options])])]);
  ['color', 'center', 'favorite', 'counterclockwise', 'practicing'].forEach((w) => assert.ok(!new RegExp('\\b' + w, 'i').test(text), w));
  assert.ok(typeof globalThis.document === 'undefined');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'gym.js'), 'utf8');
  assert.ok(!/\bdocument\.|\bwindow\.(?!CC)/.test(src.replace(/typeof window/g, '')), 'no DOM use');
});

console.log(passed + ' gym tests passed' + (process.exitCode ? ' (with failures)' : ''));
