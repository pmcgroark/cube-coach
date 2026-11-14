// node tests/lessons.test.js
// Every factual claim about moves in js/lessons.js is checked here by simulation with CC.Cube.
const assert = require('assert');
require('../js/cube.js');
require('../js/lessons.js');
const Cube = globalThis.CC.Cube;
const L = globalThis.CC.Lessons;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack || e.message); process.exitCode = 1; }
}

const STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
const ALG_IDS = ['rtrigger', 'mid-right', 'mid-left', 'ycross', 'sune', 'corner-cycle', 'twist'];
const MILESTONE_IDS = ['first-solve', 'first-virtual', 'first-coach', 'first-solo', 'sub-10', 'sub-5', 'sub-3',
  'sub-2', 'sub-90', 'streak-7', 'streak-30', 'all-mastered', 'solves-100'];
const Y0 = Cube.applyAlg(Cube.solved(), 'z2'); // learning frame: yellow up, green front
const tok = (a) => Cube.parseAlg(a);
const rep = (a, n) => Array(n).fill(a).join(' ');
const A = (id) => L.ALGORITHMS[id].notation;
const SUNE_U = L.ALGORITHMS.sune.asUsed;

// ------------------------------------------------------------ stage-goal checks (any orientation)
function norm(s) { return Cube.applyAlg(s, Cube.rotationTo(s, 'Y', null)); } // yellow on top, D = white
const SIDES = ['R', 'F', 'L', 'B'];
const fi = (f) => Cube.FACES.indexOf(f) * 9;
function rowOK(s, f, row) { for (let c = 0; c < 3; c++) if (s[fi(f) + row * 3 + c] !== s[fi(f) + 4]) return false; return true; }
function cornerHome(s, name) {
  const c = Cube.CORNERS.find((x) => x.name === name);
  return c.stickers.map((i) => s[i]).sort().join('') === c.faces.map((f) => Cube.center(s, f)).sort().join('');
}
const CHECK = {
  daisy: (s) => { s = norm(s); return [1, 3, 5, 7].every((i) => s[i] === 'W'); },
  cross: (s) => { s = norm(s); return [28, 30, 32, 34].every((i) => s[i] === 'W') && s[25] === s[22] && s[16] === s[13] && s[43] === s[40] && s[52] === s[49]; },
  corners: (s) => { if (!CHECK.cross(s)) return false; s = norm(s); for (let i = 27; i < 36; i++) if (s[i] !== 'W') return false; return SIDES.every((f) => rowOK(s, f, 2)); },
  middle: (s) => CHECK.corners(s) && SIDES.every((f) => rowOK(norm(s), f, 1)),
  ycross: (s) => CHECK.middle(s) && [1, 3, 5, 7].every((i) => norm(s)[i] === 'Y'),
  yedges: (s) => { if (!CHECK.ycross(s)) return false; s = norm(s); return s[10] === s[13] && s[19] === s[22] && s[37] === s[40] && s[46] === s[49]; },
  ycorners: (s) => CHECK.yedges(s) && ['URF', 'UFL', 'ULB', 'UBR'].every((n) => cornerHome(norm(s), n)),
  yorient: (s) => Cube.isSolved(s)
};
const firstLayer = CHECK.corners;
const f2l = CHECK.middle;
const petals = (s) => [1, 3, 5, 7].filter((i) => norm(s)[i] === 'W').length;

// edge/top helpers in the current frame
const TOP_SIDE = { F: 19, R: 10, B: 46, L: 37 }; // top-row middle sticker of each side
function matchedEdges(s) { return ['F', 'R', 'B', 'L'].filter((f) => s[TOP_SIDE[f]] === Cube.center(s, f)); }
function shape(s) {
  const [B, Lf, R, F] = [1, 3, 5, 7].map((i) => (s[i] === Cube.center(s, 'U') ? 1 : 0));
  const n = B + Lf + R + F;
  if (n === 4) return 'cross'; if (n === 0) return 'dot';
  if (n === 2) { if (Lf && R) return 'line-LR'; if (F && B) return 'line-FB'; return 'L-' + (B ? 'B' : 'F') + (Lf ? 'L' : 'R'); }
  return 'odd';
}

// random state generators (seeded)
function randomFrom(pool, seed, steps) {
  const rnd = Cube.mulberry32(seed); let s = Y0;
  for (let k = 0; k < steps; k++) s = Cube.applyAlg(s, pool[Math.floor(rnd() * pool.length)]);
  return s;
}
// keeps the white cross: U turns, y turns, and X U^k X' conjugates
const CROSS_POOL = ['U', "U'", 'U2', 'y', "y'"];
['R', 'L', 'F', 'B'].forEach((f) => ['U', "U'", 'U2'].forEach((u) => {
  CROSS_POOL.push(f + ' ' + u + ' ' + f + "'"); CROSS_POOL.push(f + "' " + u + ' ' + f);
}));
// keeps the first layer
const FL_POOL = ['U', "U'", 'U2', 'y', "y'", A('mid-right'), A('mid-left')];
// keeps the first two layers
const LL_POOL = ['U', "U'", 'U2', 'y', A('ycross'), A('sune'), A('corner-cycle'), "R U2 R' U' R U' R'", "F U R U' R' F'"];
// keeps the first two layers and the yellow cross
const YC_POOL = ['U', "U'", 'U2', 'y', A('sune'), A('corner-cycle'), "R U2 R' U' R U' R'"];

// ------------------------------------------------------------ structure
test('stage ids, order and required fields', () => {
  assert.deepStrictEqual(L.STAGE_IDS, STAGE_IDS);
  assert.deepStrictEqual(Object.keys(L.STAGES).sort(), STAGE_IDS.slice().sort());
  const caseIds = new Set();
  STAGE_IDS.forEach((id, i) => {
    const s = L.STAGES[id];
    assert.strictEqual(s.id, id); assert.strictEqual(s.index, i);
    ['title', 'tagline', 'goal', 'why'].forEach((k) => assert.ok(typeof s[k] === 'string' && s[k].length > 5, id + '.' + k));
    ['howTo', 'recognise', 'mnemonics', 'mistakes', 'speedTips'].forEach((k) => assert.ok(Array.isArray(s[k]) && s[k].length >= 1, id + '.' + k));
    assert.ok(Array.isArray(s.algorithms), id + '.algorithms');
    assert.strictEqual(s.hints.length, 3, id + ' hints');
    s.hints.forEach((h) => assert.ok(typeof h === 'string' && h.length > 10));
    s.algorithms.forEach((a) => { assert.ok(L.ALGORITHMS[a], id + ' alg ' + a); assert.ok(L.ALGORITHMS[a].usedIn.includes(id)); });
    s.recognise.forEach((c) => {
      ['caseId', 'name', 'look', 'action'].forEach((k) => assert.ok(c[k], id + ' case ' + k));
      assert.ok(!caseIds.has(c.caseId), 'duplicate caseId ' + c.caseId); caseIds.add(c.caseId);
    });
  });
  assert.strictEqual(L.stage('cross'), L.STAGES.cross);
});

test('algorithms: ids, notation, per-move plain English matches CC.Cube.moveInfo', () => {
  assert.deepStrictEqual(Object.keys(L.ALGORITHMS).sort(), ALG_IDS.slice().sort());
  const expected = { rtrigger: "R U R' U'", 'mid-right': "U R U' R' U' F' U F", 'mid-left': "U' L' U L U F U' F'",
    ycross: "F R U R' U' F'", sune: "R U R' U R U2 R'", 'corner-cycle': "U R U' L' U R' U' L", twist: "R' D' R D" };
  ALG_IDS.forEach((id) => {
    const a = L.ALGORITHMS[id];
    assert.strictEqual(a.id, id);
    assert.strictEqual(a.notation, expected[id], id);
    const t = tok(a.notation);
    assert.strictEqual(a.plain.length, t.length, id + ' plain length');
    t.forEach((m, i) => assert.strictEqual(a.plain[i], Cube.moveInfo(m).text, id + ' plain ' + i));
    ['name', 'mnemonic', 'fingerTricks', 'summary'].forEach((k) => assert.ok(a[k], id + '.' + k));
    assert.ok(a.usedIn.length && a.usedIn.every((s) => STAGE_IDS.includes(s)), id + ' usedIn');
    if (a.reps) a.reps.forEach((r) => assert.ok(r.caseId && r.when && Number.isInteger(r.count)));
    assert.strictEqual(L.algorithm(id), a);
  });
  assert.strictEqual(SUNE_U, "R U R' U R U2 R' U");
});

test('algorithm orders ("N in a row returns the cube to where it started")', () => {
  const orderOf = (alg) => { let s = Y0; for (let n = 1; n <= 200; n++) { s = Cube.applyAlg(s, alg); if (Cube.isSolved(s)) return n; } return null; };
  ALG_IDS.forEach((id) => { if (L.ALGORITHMS[id].order) assert.strictEqual(orderOf(A(id)), L.ALGORITHMS[id].order, id); });
  assert.strictEqual(orderOf(A('rtrigger')), 6);
  assert.strictEqual(orderOf(A('twist')), 6);
  assert.strictEqual(orderOf(A('sune')), 6);
  assert.strictEqual(orderOf(A('ycross')), 6);
  assert.strictEqual(orderOf(A('corner-cycle')), 3);
});

test('what each algorithm preserves', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const fl = randomFrom(FL_POOL, seed, 6);
    assert.ok(firstLayer(fl));
    assert.ok(firstLayer(Cube.applyAlg(fl, A('mid-right'))), 'mid-right keeps first layer');
    assert.ok(firstLayer(Cube.applyAlg(fl, A('mid-left'))), 'mid-left keeps first layer');
    const ll = randomFrom(LL_POOL, seed, 6);
    assert.ok(f2l(ll));
    ['ycross', 'sune', 'corner-cycle'].forEach((id) => assert.ok(f2l(Cube.applyAlg(ll, A(id))), id + ' keeps F2L'));
    assert.ok(f2l(Cube.applyAlg(ll, "F U R U' R' F'")));
    const yc = randomFrom(YC_POOL, seed, 6);
    assert.ok(CHECK.ycross(yc));
    assert.ok(CHECK.ycross(Cube.applyAlg(yc, SUNE_U)), 'Sune + U keeps the yellow cross');
    assert.ok(CHECK.ycross(Cube.applyAlg(yc, A('corner-cycle'))), 'corner cycle keeps the yellow cross');
  }
  // the right trigger never moves a cross edge (bottom edges fixed in place and orientation), in any state
  const p = Cube.algPerm(A('rtrigger'));
  Cube.EDGES.filter((e) => e.name[0] === 'D').forEach((e) => e.stickers.forEach((i) => assert.strictEqual(p[i], i, e.name)));
  // and only moves pieces in the right side and top layer
  Cube.STICKERS.forEach((st) => { if (p[st.index] !== st.index) assert.ok(st.cubie[0] === 1 || st.cubie[1] === 1); });
  // the trigger swaps the front-right bottom corner with the corner above it (both twisted)
  const cornerAt = (perm, from) => Cube.CORNERS.find((x) => x.stickers.includes(perm[Cube.CORNERS.find((y) => y.name === from).stickers[0]])).name;
  assert.strictEqual(cornerAt(p, 'DFR'), 'URF'); assert.strictEqual(cornerAt(p, 'URF'), 'DFR');
  // R' D' R D: of the top layer, only the front-right corner is disturbed
  const tw = Cube.algPerm(A('twist'));
  ['UR', 'UF', 'UL', 'UB'].forEach((n) => Cube.EDGES.find((e) => e.name === n).stickers.forEach((i) => assert.strictEqual(tw[i], i, n)));
  ['UFL', 'ULB', 'UBR'].forEach((n) => Cube.CORNERS.find((e) => e.name === n).stickers.forEach((i) => assert.strictEqual(tw[i], i, n)));
  // R' D' R D only touches the right side and the bottom layer
  const q = Cube.algPerm(A('twist'));
  Cube.STICKERS.forEach((st) => { if (q[st.index] !== st.index) assert.ok(st.cubie[0] === 1 || st.cubie[1] === -1); });
});

// ------------------------------------------------------------ "every notation parses"
test('every notation in the content parses', () => {
  ALG_IDS.forEach((id) => tok(A(id)));
  tok(SUNE_U);
  L.NOTATION.forEach((n) => { if (n.token) assert.strictEqual(tok(n.token).length, 1, n.id); });
  STAGE_IDS.forEach((sid) => L.DEMOS[sid].forEach((d) => { tok(d.setup); tok(d.moves); }));
});

// Every move sequence (2+ moves) written anywhere in the prose must be a contiguous piece of a
// (possibly repeated) taught algorithm, or one of the shortcuts verified below.
const VERIFIED_SHORTCUTS = ["R U R'", "F' U' F", "R U2 R' U' R U R'", "F U R U' R' F'"];
test('every move sequence mentioned in prose is a known algorithm piece or a verified shortcut', () => {
  const pools = ALG_IDS.map((id) => ' ' + tok(rep(A(id), 6)).join(' ') + ' ').concat([' ' + tok(rep(SUNE_U, 4)).join(' ') + ' ']);
  const allowed = (seq) => VERIFIED_SHORTCUTS.includes(seq) || pools.some((p) => p.includes(' ' + seq + ' '));
  const RE = /(?:^|[^A-Za-z0-9'])((?:[URFDLBxyz][2']?[ ]+)+[URFDLBxyz][2']?)(?![A-Za-z0-9'])/g;
  const found = [];
  (function walk(v, key) {
    if (key === 'setup' || key === 'moves' || key === 'options') return; // checked by the demo/checkpoint tests
    if (typeof v === 'string') { let m; RE.lastIndex = 0; while ((m = RE.exec(v))) found.push([m[1], v]); return; }
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], k));
  })(L, '');
  assert.ok(found.length > 40, 'scanner found ' + found.length);
  found.forEach(([seq, ctx]) => { const t = tok(seq).join(' '); assert.ok(allowed(t), 'unverified sequence "' + seq + '" in: ' + ctx); });
});

// ------------------------------------------------------------ notation primer
test('notation primer matches the cube model', () => {
  const ids = L.NOTATION.map((n) => n.id);
  ['hold', 'faces', 'clockwise', 'prime', 'two', 'y', 'x', 'z', 'cube-vs-face'].forEach((k) => assert.ok(ids.includes(k), k));
  ['U', "U'", 'R', "R'", 'L', "L'", 'F', "F'", 'D', "D'", 'B', "B'"].forEach((t) => assert.ok(L.NOTATION.some((n) => n.token === t), t));
  L.NOTATION.forEach((n) => {
    assert.ok(n.title && n.text && n.tip, n.id);
    if (n.token && n.token !== 'x') assert.ok(n.text.includes(Cube.moveInfo(n.token).how), n.id + ': ' + n.text);
  });
  const centreAfter = (rot, from) => { const s = Cube.applyAlg(Cube.solved(), rot); return Cube.FACES.find((f) => Cube.center(s, f) === Cube.center(Cube.solved(), from)); };
  assert.strictEqual(centreAfter('y', 'R'), 'F'); // RIGHT face comes to the FRONT
  assert.strictEqual(centreAfter("y'", 'L'), 'F');
  assert.strictEqual(centreAfter('y2', 'B'), 'F');
  assert.strictEqual(centreAfter('x', 'F'), 'U'); // FRONT face goes to the TOP
  assert.ok(L.NOTATION.find((n) => n.id === 'x').text.includes('FRONT face goes to the TOP'));
  assert.strictEqual(centreAfter('z', 'U'), 'R'); // top goes to the right
  assert.deepStrictEqual(Cube.rotationTo(Cube.solved(), 'Y', 'G'), ['z2']); // z2: white-on-top -> yellow-on-top, green still in front
  assert.strictEqual(Cube.center(Cube.applyAlg(Cube.solved(), 'z2'), 'U'), 'Y');
  // x turns like R, z turns like F (whole-cube versions)
  const s = Cube.applyAlg(Y0, Cube.scramble(20, 9));
  assert.deepStrictEqual(Cube.applyAlg(s, 'x'), Cube.applyAlg(s, "R M' L'"));
  assert.deepStrictEqual(Cube.applyAlg(s, 'z'), Cube.applyAlg(s, "F S B'"));
  // prime undoes
  assert.deepStrictEqual(Cube.applyAlg(s, "R R'"), s);
  // U and D, R and L move the front opposite ways as seen from the front
  assert.match(Cube.moveInfo('U').how, /LEFT/); assert.match(Cube.moveInfo('D').how, /RIGHT/);
  assert.match(Cube.moveInfo('R').how, /UP/); assert.match(Cube.moveInfo('L').how, /DOWN/);
  assert.match(Cube.moveInfo("L'").how, /UP/);
});

// ------------------------------------------------------------ demos
function verifyDemo(stageId, d) {
  const idx = STAGE_IDS.indexOf(stageId);
  const setupTokens = tok(d.setup);
  assert.ok(setupTokens.length > 0 && setupTokens.length <= 20, d.id + ' setup length ' + setupTokens.length);
  assert.ok(setupTokens.every((t) => /^[URFDLB]['2]?$/.test(t)), d.id + ' setup must be face moves only');
  const start = Cube.applyAlg(Y0, d.setup);
  const end = Cube.applyAlg(start, d.moves);
  assert.ok(Cube.validate(start).ok);
  const earlier = idx === 0 ? [] : STAGE_IDS.slice(1, idx);
  // starts where the previous stage left off (a cross demo starts from a daisy)
  earlier.forEach((e) => assert.ok(CHECK[e](start), d.id + ': setup should keep ' + e));
  if (stageId === 'cross') assert.ok(CHECK.daisy(start), d.id + ': setup should be a daisy');
  assert.ok(!CHECK[stageId](start), d.id + ': setup must leave ' + stageId + ' unsolved');
  assert.ok(CHECK[stageId](end), d.id + ': moves must solve ' + stageId);
  earlier.forEach((e) => assert.ok(CHECK[e](end), d.id + ': moves must keep ' + e));
  // narration
  const n = tok(d.moves).length;
  assert.ok(d.narration.length >= 2 && d.narration[0].at === 0, d.id + ' narration starts at 0');
  d.narration.forEach((x, i) => {
    assert.ok(Number.isInteger(x.at) && x.at >= 0 && x.at <= n, d.id + ' narration at ' + x.at);
    if (i) assert.ok(x.at > d.narration[i - 1].at, d.id + ' narration order');
    assert.ok(x.text.length > 1);
  });
  (d.caseIds || []).forEach((c) => assert.ok(L.STAGES[stageId].recognise.some((r) => r.caseId === c), d.id + ' caseId ' + c));
  return { start, end };
}

test('every stage has 2-4 demos (the middle layer 8-12); each demo is verified by simulation', () => {
  const ids = new Set();
  STAGE_IDS.forEach((sid) => {
    const list = L.DEMOS[sid];
    if (sid === 'middle') assert.ok(list.length >= 8 && list.length <= 12, sid + ' demo count ' + list.length);
    else assert.ok(list.length >= 2 && list.length <= 4, sid + ' demo count');
    list.forEach((d) => {
      assert.ok(!ids.has(d.id), 'duplicate demo id ' + d.id); ids.add(d.id);
      assert.ok(d.title && d.summary, d.id);
      verifyDemo(sid, d);
      const st = L.demoStates(d.id);
      assert.strictEqual(st.stageId, sid);
      assert.deepStrictEqual(st.end, Cube.applyAlg(st.start, st.moves));
      assert.strictEqual(L.findDemo(d.id), d);
    });
  });
});

test('demo checkpoints have the right answers', () => {
  let count = 0;
  STAGE_IDS.forEach((sid) => L.DEMOS[sid].forEach((d) => (d.checkpoints || []).forEach((c) => {
    count++;
    const mv = tok(d.moves);
    assert.ok(c.prompt && c.explain && Array.isArray(c.options) && Number.isInteger(c.answer) && c.options[c.answer] !== undefined, d.id);
    assert.ok(c.at >= 0 && c.at < mv.length, d.id + ' checkpoint at');
    if (c.kind === 'next') {
      const want = tok(c.options[c.answer]);
      assert.deepStrictEqual(mv.slice(c.at, c.at + want.length), want, d.id + ' next');
      c.options.forEach((o, i) => { if (i !== c.answer) assert.notDeepStrictEqual(mv.slice(c.at, c.at + tok(o).length), tok(o), d.id + ' distractor ' + o); });
    } else if (c.kind === 'reps') {
      const unit = tok(A(c.algId)); let k = 0;
      while (mv.slice(c.at + k * unit.length, c.at + (k + 1) * unit.length).join(' ') === unit.join(' ')) k++;
      assert.strictEqual(c.options[c.answer], String(k), d.id + ' reps');
    } else if (c.kind === 'alg') {
      const unit = tok(c.answerAlg === 'sune' ? SUNE_U : A(c.answerAlg));
      assert.deepStrictEqual(mv.slice(c.at, c.at + unit.length), unit, d.id + ' alg');
      assert.strictEqual(c.options[c.answer], L.ALGORITHMS[c.answerAlg].name);
    } else assert.fail('unknown checkpoint kind ' + c.kind);
  })));
  assert.ok(count >= 15, 'checkpoints: ' + count);
});

test('demo narration facts', () => {
  const st = (id) => L.demoStates(id);
  const after = (id, n) => { const s = st(id); return Cube.applyAlg(s.start, s.moves.slice(0, n)); };
  // daisy: the bottom-sideways demo knocks the green petal off at move 2 and puts it back at move 4
  assert.strictEqual(petals(after('daisy-bottom-side', 2)), 3);
  assert.strictEqual(petals(after('daisy-bottom-side', 3)), 2); // F' (move index 2) knocks green off
  assert.ok(Cube.findEdge(after('daisy-bottom-side', 3), 'W', 'G').name[0] !== 'U');
  assert.strictEqual(petals(after('daisy-bottom-side', 4)), 3);
  assert.strictEqual(petals(after('daisy-bottom-side', 5)), 4); // F (move index 4) puts it back
  assert.strictEqual(Cube.findEdge(after('daisy-bottom-side', 5), 'W', 'G').name, 'UF');
  // daisy-down: never lifts into an occupied spot (petal count never drops)
  ['daisy-down', 'daisy-middle', 'daisy-top-out'].forEach((id) => {
    const n = st(id).moves.length;
    for (let k = 1; k <= n; k++) assert.ok(petals(after(id, k)) >= petals(after(id, k - 1)), id + ' move ' + k);
  });
  // corners-stuck: one trigger drops white-red-green into place
  { const s = norm(after('corners-stuck', 5)); const c = Cube.findCorner(s, 'W', 'R', 'G'); assert.strictEqual(c.faces[0], 'D');
    assert.ok(c.stickers.every((i) => s[i] === Cube.center(s, Cube.STICKERS[i].face))); }
  // middle-stuck: every top edge has yellow at the start, and the edge pops out to the back
  { const s = st('middle-stuck').start; ['UR', 'UF', 'UL', 'UB'].forEach((n) => assert.ok(Cube.EDGES.find((e) => e.name === n).stickers.some((i) => s[i] === 'Y')));
    const e = Cube.findEdge(after('middle-stuck', 8), 'G', 'O'); assert.strictEqual(e.name, 'UB'); assert.strictEqual(e.faces[0], 'B'); }
  // ycross shapes along the way
  assert.strictEqual(shape(st('ycross-line').start), 'line-FB');
  assert.strictEqual(shape(st('ycross-l').start), 'L-FR');
  assert.strictEqual(shape(after('ycross-l', 7)), 'line-LR');
  assert.strictEqual(shape(st('ycross-dot').start), 'dot');
  assert.strictEqual(shape(after('ycross-dot', 6)), 'L-FR');
  assert.strictEqual(shape(after('ycross-dot', 13)), 'line-LR');
  // yedges: opposite pair, and no U turn does better
  { const s = st('yedges-opposite').start; assert.deepStrictEqual(matchedEdges(s).sort(), ['L', 'R']);
    ['U', "U'", 'U2'].forEach((u) => assert.ok(matchedEdges(Cube.applyAlg(s, u)).length <= 2)); }
  assert.deepStrictEqual(matchedEdges(after('yedges-opposite', 9)).sort(), ['B', 'L']);
  assert.deepStrictEqual(matchedEdges(after('yedges-adjacent', 1)).sort(), ['F', 'R']);
  // ycorners: number of home corners
  const homes = (s) => ['URF', 'UFL', 'ULB', 'UBR'].filter((n) => cornerHome(s, n));
  assert.deepStrictEqual(homes(st('ycorners-one').start), ['ULB']);
  assert.deepStrictEqual(homes(st('ycorners-twice').start), ['URF']);
  assert.deepStrictEqual(homes(after('ycorners-twice', 8)), ['URF']);
  assert.deepStrictEqual(homes(st('ycorners-none').start), []);
  assert.deepStrictEqual(homes(after('ycorners-none', 8)), ['UBR']);
  assert.ok(!Cube.isSolved(st('ycorners-one').end), 'twists remain after ycorners-one');
  // yorient: bottom looks broken mid-way, repairs itself before the final U turn
  assert.ok(!f2l(after('yorient-two', 8)));
  assert.ok(f2l(after('yorient-two', 25)) && !Cube.isSolved(after('yorient-two', 25)));
  { const s = st('yorient-two').start; assert.strictEqual(s[9], 'Y'); assert.strictEqual(after('yorient-two', 9)[20], 'Y'); }
  { const s = st('yorient-three').start; assert.strictEqual([8, 6, 0, 2].filter((i) => s[i] !== 'Y').length, 3); }
});

// ------------------------------------------------------------ the rep-count facts
// Bring a white corner (in the top layer) above its slot at front-right; count triggers until it is home.
function cornerSolvedAtDFR(s) {
  const c = Cube.CORNERS.find((x) => x.name === 'DFR');
  return c.stickers.every((i) => s[i] === Cube.center(s, Cube.STICKERS[i].face));
}
test('right trigger: white right = 1, up = 3, facing you = 5 (corner above its front-right slot)', () => {
  const seen = { R: 0, U: 0, F: 0 }; const want = { R: 1, U: 3, F: 5 };
  for (let seed = 1; seed <= 150; seed++) {
    let s = randomFrom(CROSS_POOL, seed, 10);
    assert.ok(CHECK.cross(s));
    const whites = Cube.CORNERS.filter((c) => c.name[0] === 'U' && c.stickers.some((i) => s[i] === 'W'));
    whites.forEach((c) => {
      const cols = c.stickers.map((i) => s[i]).filter((x) => x !== 'W');
      const rot = ['', 'y', "y'", 'y2'].find((r) => { const t = Cube.applyAlg(s, r); return [Cube.center(t, 'F'), Cube.center(t, 'R')].sort().join('') === cols.sort().join(''); });
      let t = Cube.applyAlg(s, rot);
      const u = ['', 'U', "U'", 'U2'].find((x) => { const k = Cube.findCorner(Cube.applyAlg(t, x), 'W', cols[0], cols[1]); return k.name === 'URF'; });
      t = Cube.applyAlg(t, u);
      const wFace = Cube.findCorner(t, 'W', cols[0], cols[1]).faces[0];
      const others = Cube.CORNERS.filter((k) => k.name[0] === 'D' && k.name !== 'DFR').map((k) => k.stickers.map((i) => t[i]).join(''));
      let n = 0;
      while (!cornerSolvedAtDFR(t) && n < 7) { t = Cube.applyAlg(t, A('rtrigger')); n++; }
      assert.strictEqual(n, want[wFace], 'white on ' + wFace);
      seen[wFace]++;
      assert.ok(CHECK.cross(t), 'cross survives');
      // other bottom corners untouched
      assert.deepStrictEqual(Cube.CORNERS.filter((k) => k.name[0] === 'D' && k.name !== 'DFR').map((k) => k.stickers.map((i) => t[i]).join('')), others);
    });
  }
  assert.ok(seen.R > 20 && seen.U > 20 && seen.F > 20, JSON.stringify(seen));
  // the reps table in ALGORITHMS agrees
  const r = Object.fromEntries(L.ALGORITHMS.rtrigger.reps.map((x) => [x.caseId, x.count]));
  assert.deepStrictEqual([r['corner-white-right'], r['corner-white-up'], r['corner-white-front']], [1, 3, 5]);
});

test('right trigger: twisted in its own slot = 2 (white right) or 4 (white facing you); wrong slot pops out in one', () => {
  const r = Object.fromEntries(L.ALGORITHMS.rtrigger.reps.map((x) => [x.caseId, x.count]));
  let tested = { R: 0, F: 0, pop: 0 };
  for (let seed = 1; seed <= 600; seed++) {
    const s = randomFrom(CROSS_POOL, seed, 10);
    const c = Cube.CORNERS.find((x) => x.name === 'DFR');
    const cols = c.stickers.map((i) => s[i]);
    if (!cols.includes('W')) continue;
    const home = cols.slice().sort().join('') === ['W', Cube.center(s, 'F'), Cube.center(s, 'R')].sort().join('');
    const wFace = Cube.STICKERS[c.stickers[cols.indexOf('W')]].face;
    if (home && wFace !== 'D') {
      let t = s, n = 0; while (!cornerSolvedAtDFR(t) && n < 7) { t = Cube.applyAlg(t, A('rtrigger')); n++; }
      assert.strictEqual(n, wFace === 'R' ? r['corner-twisted-right'] : r['corner-twisted-front'], 'twisted, white on ' + wFace);
      tested[wFace]++;
    } else if (!home) {
      const t = Cube.applyAlg(s, A('rtrigger'));
      const k = Cube.findCorner(t, ...cols); assert.strictEqual(k.name[0], 'U', 'popped out');
      tested.pop++;
    }
  }
  assert.ok(tested.R > 3 && tested.F > 3 && tested.pop > 20, JSON.stringify(tested));
  assert.deepStrictEqual([r['corner-twisted-right'], r['corner-twisted-front']], [2, 4]);
});

test("corner shortcuts: R U R' (white right), F' U' F (white facing you), R U2 R' U' R U R' (white up)", () => {
  const short = { R: "R U R'", F: "F' U' F", U: "R U2 R' U' R U R'" };
  const n = { R: 0, F: 0, U: 0 };
  for (let seed = 1; seed <= 150; seed++) {
    const s0 = randomFrom(CROSS_POOL, seed, 10);
    Cube.CORNERS.filter((c) => c.name[0] === 'U' && c.stickers.some((i) => s0[i] === 'W')).forEach((c) => {
      const cols = c.stickers.map((i) => s0[i]).filter((x) => x !== 'W');
      const rot = ['', 'y', "y'", 'y2'].find((r) => { const t = Cube.applyAlg(s0, r); return [Cube.center(t, 'F'), Cube.center(t, 'R')].sort().join('') === cols.slice().sort().join(''); });
      let t = Cube.applyAlg(s0, rot);
      t = Cube.applyAlg(t, ['', 'U', "U'", 'U2'].find((x) => Cube.findCorner(Cube.applyAlg(t, x), 'W', cols[0], cols[1]).name === 'URF'));
      const w = Cube.findCorner(t, 'W', cols[0], cols[1]).faces[0];
      const u = Cube.applyAlg(t, short[w]);
      assert.ok(cornerSolvedAtDFR(u) && CHECK.cross(u), 'shortcut for white on ' + w);
      n[w]++;
    });
  }
  assert.ok(n.R && n.F && n.U);
  assert.ok(L.STAGES.corners.speedTips.join(' ').includes(short.U));
});

test("twist: yellow facing right = 2, facing you = 4 (and the corner stays at front-right)", () => {
  const r = Object.fromEntries(L.ALGORITHMS.twist.reps.map((x) => [x.caseId, x.count]));
  const seen = { R: 0, F: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const s = Cube.applyAlg(Y0, Cube.scramble(25, seed));
    const c = Cube.CORNERS.find((x) => x.name === 'URF');
    const cols = c.stickers.map((i) => s[i]);
    if (!cols.includes('Y')) continue;
    const yf = Cube.STICKERS[c.stickers[cols.indexOf('Y')]].face;
    if (yf === 'U') continue;
    let t = s, n = 0;
    while (n < 7) { t = Cube.applyAlg(t, A('twist')); n++; const k = Cube.findCorner(t, ...cols); if (k.name === 'URF' && k.faces[cols.indexOf('Y')] === 'U') break; }
    assert.strictEqual(n, yf === 'R' ? r['yellow-right'] : r['yellow-front'], 'yellow on ' + yf);
    seen[yf]++;
  }
  assert.ok(seen.R > 20 && seen.F > 20, JSON.stringify(seen));
  assert.deepStrictEqual([r['yellow-right'], r['yellow-front']], [2, 4]);
  // two goes return the corner to front-right, twisted by a third of a turn
  const p = Cube.algPerm(rep(A('twist'), 2));
  assert.deepStrictEqual(Cube.CORNERS.find((x) => x.name === 'URF').stickers.map((i) => p[i]).sort((a, b) => a - b), [8, 9, 20]);
  assert.notStrictEqual(p[8], 8);
});

test('twist routine: U-only between corners always ends solved; rotating the cube instead does not repair the bottom', () => {
  // twist-only states: random sequences of (twist pairs + U turns) that leave every corner in place
  const TW2 = rep(A('twist'), 2), TW4 = rep(A('twist'), 4);
  let tested = 0;
  for (let seed = 1; seed <= 800; seed++) {
    const rnd = Cube.mulberry32(seed); let s = Y0;
    for (let k = 0; k < 4; k++) s = Cube.applyAlg(s, [TW2, TW4, 'U', "U'", 'U2'][Math.floor(rnd() * 5)]);
    // only states a learner can meet at this stage: first two layers intact, corners in place
    const align = ['', 'U', "U'", 'U2'].find((u) => CHECK.yedges(Cube.applyAlg(s, u)));
    if (align === undefined) continue;
    s = Cube.applyAlg(s, align);
    if (!CHECK.ycorners(s) || Cube.isSolved(s)) continue;
    // human routine
    let t = s, guard = 0;
    while (guard++ < 10) {
      const un = [8, 6, 0, 2].filter((i) => t[i] !== 'Y');
      if (!un.length) break;
      if (t[8] === 'Y') t = Cube.applyAlg(t, ['U', "U'", 'U2'].find((u) => Cube.applyAlg(t, u)[8] !== 'Y'));
      let n = 0; while (t[8] !== 'Y') { t = Cube.applyAlg(t, A('twist')); n++; }
      assert.ok(n === 2 || n === 4);
    }
    const fin = ['', 'U', "U'", 'U2'].map((u) => Cube.applyAlg(t, u)).find(Cube.isSolved);
    assert.ok(fin, 'routine ends solved');
    tested++;
  }
  assert.ok(tested > 30, 'tested ' + tested);
  // the demo again, but rotating the cube (y) instead of turning the top: the bottom stays broken
  const d = L.demoStates('yorient-two');
  const bad = Cube.applyAlg(d.start, rep(A('twist'), 2) + " y' " + rep(A('twist'), 4));
  assert.ok(!f2l(bad));
});

test('daisy lifting rules', () => {
  // a single white edge from the learning frame in every middle-layer position and orientation
  let count = 0;
  for (const f of ['R', 'L', 'F', 'B']) for (const setup of [f, f + "'"]) {
    const s0 = Cube.applyAlg(Y0, setup); // drops one bottom (white) edge into the middle layer
    const mids = Cube.EDGES.filter((e) => e.name[0] !== 'U' && e.name[0] !== 'D');
    mids.forEach((e) => {
      const cols = e.stickers.map((i) => s0[i]); if (!cols.includes('W')) return;
      const other = cols.find((c) => c !== 'W');
      const colouredFace = Cube.STICKERS[e.stickers[cols.indexOf(other)]].face;
      const res = [colouredFace, colouredFace + "'"].map((m) => Cube.findEdge(Cube.applyMove(s0, m), 'W', other));
      // one direction lifts it with white up, the other takes it to the bottom layer
      assert.ok(res.some((k) => k.name[0] === 'U' && k.faces[0] === 'U'), 'lift ' + setup);
      assert.ok(res.some((k) => k.name[0] === 'D'), 'wrong way goes down ' + setup);
      // turning the face the white sticker is on never lifts it white-up
      const whiteFace = Cube.STICKERS[e.stickers[cols.indexOf('W')]].face;
      [whiteFace, whiteFace + "'"].forEach((m) => { const k = Cube.findEdge(Cube.applyMove(s0, m), 'W', other); assert.ok(!(k.name[0] === 'U' && k.faces[0] === 'U')); });
      count++;
    });
  }
  assert.ok(count >= 8);
  // hint: middle-layer edge at front-left with its coloured sticker facing you -> F; at front-right -> F'
  { const s = Cube.applyAlg(Y0, "F"); const fl = Cube.EDGES.find((e) => e.name === 'FL').stickers.map((i) => s[i]);
    assert.strictEqual(fl[1], 'W'); // white faces left, coloured sticker faces front
    const k = Cube.findEdge(Cube.applyMove(s, 'F'), ...fl); assert.strictEqual(k.name, 'UF'); assert.strictEqual(k.faces[1], 'U'); }
  { const s = Cube.applyAlg(Y0, "F'"); const fr = Cube.EDGES.find((e) => e.name === 'FR').stickers.map((i) => s[i]);
    assert.strictEqual(fr[1], 'W'); // white faces right, coloured sticker faces front
    const k = Cube.findEdge(Cube.applyMove(s, "F'"), ...fr); assert.strictEqual(k.name, 'UF'); assert.strictEqual(k.faces[1], 'U'); }
  // bottom edge, white down: a half turn of that side brings it up, white up
  ['F', 'R', 'B', 'L'].forEach((f) => {
    const before = Cube.EDGES.find((e) => e.name === 'D' + f); const cols = before.stickers.map((i) => Y0[i]);
    const k = Cube.findEdge(Cube.applyMove(Y0, f + '2'), ...cols); assert.strictEqual(k.name, 'U' + f); assert.strictEqual(k.faces[0], 'U');
  });
  // white facing sideways in the top or bottom layer: one turn of the face the white is on -> middle layer
  for (let seed = 1; seed <= 80; seed++) {
    const s = Cube.applyAlg(Y0, Cube.scramble(12, seed));
    Cube.EDGES.filter((e) => e.name[0] === 'U' || e.name[0] === 'D').forEach((e) => {
      const cols = e.stickers.map((i) => s[i]); const w = cols.indexOf('W'); if (w !== 1) return; // white on the side sticker
      const face = Cube.STICKERS[e.stickers[1]].face;
      [face, face + "'"].forEach((m) => { const k = Cube.findEdge(Cube.applyMove(s, m), ...cols); assert.ok(k.name[0] !== 'U' && k.name[0] !== 'D', m); });
    });
  }
});

test('cross rule: a matched petal half-turned lands matched on the bottom', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = randomFrom(['U', "U'", 'U2'], seed, 3);
    const daisy = Cube.applyAlg(s, 'F2 R2 B2 L2 U');
    for (const u of ['', 'U', "U'", 'U2']) {
      const t = Cube.applyAlg(daisy, u);
      ['F', 'R', 'B', 'L'].forEach((f) => {
        if (t[TOP_SIDE[f]] !== Cube.center(t, f)) return;
        const after = Cube.applyMove(t, f + '2');
        const k = Cube.findEdge(after, 'W', Cube.center(t, f));
        assert.strictEqual(k.name, 'D' + f); assert.strictEqual(k.faces[0], 'D');
      });
    }
  }
});

test('middle layer: right/left algorithms slot the T-edge; first U moves it away; right pops a stuck edge to the top', () => {
  let tested = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const s = randomFrom(FL_POOL, seed, 8);
    for (const rot of ['', 'y', "y'", 'y2']) for (const u of ['', 'U', "U'", 'U2']) {
      const t = Cube.applyAlg(s, rot + ' ' + u);
      const front = t[19], top = t[7];
      if (front !== Cube.center(t, 'F') || top === 'Y' || front === 'Y') continue;
      const algId = top === Cube.center(t, 'R') ? 'mid-right' : top === Cube.center(t, 'L') ? 'mid-left' : null;
      assert.ok(algId, 'top colour matches right or left');
      const solvedBefore = Cube.EDGES.filter((e) => e.name.length === 2 && 'FB'.includes(e.name[0]) && 'RL'.includes(e.name[1]))
        .filter((e) => e.stickers.every((i) => t[i] === Cube.center(t, Cube.STICKERS[i].face))).map((e) => e.name);
      const after = Cube.applyAlg(t, A(algId));
      const slot = Cube.EDGES.find((e) => e.name === (algId === 'mid-right' ? 'FR' : 'FL'));
      assert.ok(slot.stickers.every((i) => after[i] === Cube.center(after, Cube.STICKERS[i].face)), algId + ' slots the edge');
      assert.ok(firstLayer(after));
      solvedBefore.forEach((n) => { const e = Cube.EDGES.find((x) => x.name === n); assert.ok(e.stickers.every((i) => after[i] === Cube.center(after, Cube.STICKERS[i].face)), 'kept ' + n); });
      // the first move takes the edge away from its slot
      const k = Cube.findEdge(Cube.applyMove(t, tok(A(algId))[0]), front, top);
      assert.strictEqual(k.name, algId === 'mid-right' ? 'UL' : 'UR');
      tested++;
    }
    // a stuck edge in the front-right slot pops out to the top
    const fr = Cube.EDGES.find((e) => e.name === 'FR'); const cols = fr.stickers.map((i) => s[i]);
    assert.strictEqual(Cube.findEdge(Cube.applyAlg(s, A('mid-right')), ...cols).name[0], 'U');
  }
  assert.ok(tested > 100, 'tested ' + tested);
  // mirror relationship: swap R<->L and reverse every turn
  const mirror = tok(A('mid-right')).map((t) => { const b = { R: 'L', L: 'R', U: 'U', F: 'F' }[t[0]]; return t.endsWith("'") ? b : b + "'"; });
  assert.deepStrictEqual(mirror, tok(A('mid-left')));
});

test("yellow cross: L at back-left -> line, line left-right -> cross, dot -> L at front-right; wrong holds don't work", () => {
  const map = {};
  const alt = {};
  for (let seed = 1; seed <= 600; seed++) {
    const s = randomFrom(LL_POOL, seed, 6);
    const sh = shape(s);
    (map[sh] = map[sh] || new Set()).add(shape(Cube.applyAlg(s, A('ycross'))));
    (alt[sh] = alt[sh] || new Set()).add(shape(Cube.applyAlg(s, "F U R U' R' F'")));
  }
  const one = (m, k) => { assert.ok(m[k], 'saw ' + k); assert.strictEqual(m[k].size, 1, k); return [...m[k]][0]; };
  assert.strictEqual(one(map, 'L-BL'), 'line-LR');
  assert.strictEqual(one(map, 'line-LR'), 'cross');
  assert.strictEqual(one(map, 'dot'), 'L-FR');
  assert.strictEqual(one(map, 'line-FB'), 'dot');      // held front-to-back: back to a dot
  assert.strictEqual(one(map, 'L-FR'), 'line-FB');     // L in the wrong corner
  assert.strictEqual(one(map, 'L-BR'), 'L-BR');
  assert.strictEqual(one(map, 'L-FL'), 'L-FL');
  assert.strictEqual(one(alt, 'L-BL'), 'cross');       // speed tip: F U R U' R' F' with the L at back-left
});

test('yellow edges: always >= 2 matches after some U; pair at back+right -> Sune+U solves; opposite -> neighbouring pair', () => {
  let adj = 0, opp = 0, wrongHold = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const s0 = randomFrom(YC_POOL, seed, 6);
    const best = Math.max(...['', 'U', "U'", 'U2'].map((u) => matchedEdges(Cube.applyAlg(s0, u)).length));
    assert.ok(best >= 2, 'some U gives two matches');
    for (const u of ['', 'U', "U'", 'U2']) {
      const s = Cube.applyAlg(s0, u); const m = matchedEdges(s).sort().join('');
      if (m === 'BR') { const t = Cube.applyAlg(s, SUNE_U); assert.ok(CHECK.yedges(t), 'back+right solves'); adj++; }
      if (m === 'FR') { assert.ok(!CHECK.yedges(Cube.applyAlg(s, SUNE_U))); wrongHold++; }
      if (m === 'FB' || m === 'LR') {
        const t = Cube.applyAlg(s, SUNE_U);
        const ok = ['', 'U', "U'", 'U2'].some((x) => { const mm = matchedEdges(Cube.applyAlg(t, x)); return mm.length === 4 || (mm.length === 2 && !['BF', 'LR'].includes(mm.sort().join(''))); });
        assert.ok(ok, 'opposite becomes a neighbouring pair'); opp++;
      }
    }
  }
  assert.ok(adj > 20 && opp > 20 && wrongHold > 20, [adj, opp, wrongHold].join(','));
  // Sune + U swaps the front and left top edges and leaves back and right in place
  const p = Cube.algPerm(SUNE_U);
  const e = (n) => Cube.EDGES.find((x) => x.name === n).stickers;
  assert.deepStrictEqual(e('UR').map((i) => p[i]), e('UR'));
  assert.deepStrictEqual(e('UB').map((i) => p[i]), e('UB'));
  assert.deepStrictEqual(e('UF').map((i) => p[i]), e('UL'));
  assert.deepStrictEqual(e('UL').map((i) => p[i]), e('UF'));
});

test('corner cycle: front-right top corner stays, others go FL -> BR -> BL -> FL; none home -> exactly one home after one go', () => {
  const p = Cube.algPerm(A('corner-cycle'));
  const c = (n) => Cube.CORNERS.find((x) => x.name === n).stickers;
  assert.deepStrictEqual(c('URF').map((i) => p[i]), c('URF')); // not moved, not twisted
  const where = (n) => Cube.CORNERS.find((x) => x.stickers.includes(p[c(n)[0]])).name;
  assert.strictEqual(where('UFL'), 'UBR');
  assert.strictEqual(where('UBR'), 'ULB');
  assert.strictEqual(where('ULB'), 'UFL');
  // edges untouched
  Cube.EDGES.forEach((e) => e.stickers.forEach((i) => assert.strictEqual(p[i], i)));
  let none = 0, one = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const s0 = randomFrom(YC_POOL, seed, 6);
    const u = ['', 'U', "U'", 'U2'].find((x) => CHECK.yedges(Cube.applyAlg(s0, x)));
    if (u === undefined) continue;
    const s = Cube.applyAlg(s0, u);
    const homes = (t) => ['URF', 'UFL', 'ULB', 'UBR'].filter((n) => cornerHome(t, n));
    const h = homes(s);
    assert.ok(h.length !== 2 && h.length !== 3, 'home count is 0, 1 or 4');
    if (h.length === 0) {
      ['', 'y', "y'", 'y2'].forEach((r) => assert.strictEqual(homes(Cube.applyAlg(s, r + ' ' + A('corner-cycle'))).length, 1, 'from any angle ' + r));
      none++;
    }
    if (h.length === 1) {
      const rot = { URF: '', UFL: "y'", ULB: 'y2', UBR: 'y' }[h[0]];
      const t = Cube.applyAlg(s, rot);
      const once = Cube.applyAlg(t, A('corner-cycle'));
      const twice = Cube.applyAlg(once, A('corner-cycle'));
      assert.ok(CHECK.ycorners(once) || CHECK.ycorners(twice), 'once or twice');
      one++;
    }
  }
  assert.ok(none > 10 && one > 30, [none, one].join(','));
});

// ------------------------------------------------------------ curriculum, milestones, tips
test('curriculum: ~12 weeks of 20-minute days', () => {
  assert.ok(L.CURRICULUM.length >= 10 && L.CURRICULUM.length <= 14);
  L.CURRICULUM.forEach((w, i) => {
    assert.strictEqual(w.week, i + 1);
    ['title', 'focus', 'milestone'].forEach((k) => assert.ok(w[k], 'week ' + w.week + ' ' + k));
    assert.ok(w.goals.length >= 2);
    assert.strictEqual(w.routine.reduce((a, r) => a + r.minutes, 0), 20, 'week ' + w.week + ' minutes');
    w.routine.forEach((r) => assert.ok(r.activity));
    if (w.milestoneId) assert.ok(MILESTONE_IDS.includes(w.milestoneId));
  });
  const byId = Object.fromEntries(L.CURRICULUM.filter((w) => w.milestoneId).map((w) => [w.milestoneId, w.week]));
  assert.ok(byId['first-solo'] <= 4 && byId['sub-3'] >= 5 && byId['sub-3'] <= 8, JSON.stringify(byId));
  assert.ok(L.EXPECTATIONS.length > 50);
});

test('milestones: exactly the ids from ARCHITECTURE.md', () => {
  assert.deepStrictEqual(L.MILESTONES.map((m) => m.id), MILESTONE_IDS);
  L.MILESTONES.forEach((m) => assert.ok(m.name && m.desc, m.id));
});

test('speed tips, no-cube tips and glossary', () => {
  assert.ok(L.SPEED_TIPS.length >= 10 && L.SPEED_TIPS.length <= 15, 'speed tips ' + L.SPEED_TIPS.length);
  L.SPEED_TIPS.concat(L.NO_CUBE_TIPS).forEach((t) => assert.ok(t.title && t.text));
  assert.ok(L.NO_CUBE_TIPS.length >= 3);
  const terms = L.GLOSSARY.map((g) => g.term.toLowerCase());
  ['centre', 'edge', 'corner', 'layer', 'algorithm', 'trigger', 'case', 'look-ahead', 'inspection'].forEach((t) => assert.ok(terms.some((x) => x.startsWith(t)), t));
  L.GLOSSARY.forEach((g) => assert.ok(g.text.length > 10));
});

// ------------------------------------------------------------ fact-check pass (independent re-verification)
const after = (id, n) => { const s = L.demoStates(id); return Cube.applyAlg(s.start, s.moves.slice(0, n)); };
const edgeAt = (s, a, b) => { const e = Cube.findEdge(s, a, b); return e.name + ':' + e.faces[0]; };            // "UR:U" = at UR, colour a on U
const cornerAt = (s, a, b, c) => { const k = Cube.findCorner(s, a, b, c); return k.name + ':' + k.faces[0]; };
const petalSpots = (s) => ['UF', 'UR', 'UB', 'UL'].filter((n) => { const e = Cube.EDGES.find((x) => x.name === n); return s[e.stickers[0]] === 'W'; });
const solvedPiece = (s, name) => { const p = Cube.CORNERS.concat(Cube.EDGES).find((x) => x.name === name); return p.stickers.every((i) => s[i] === Cube.center(s, Cube.STICKERS[i].face)); };

test('learning frame: yellow up, green front, ORANGE right, red left; every demo starts in it', () => {
  assert.deepStrictEqual(Cube.centers(Y0), L.LEARNING_FRAME.colours);
  assert.deepStrictEqual(Cube.centers(Y0), { U: 'Y', R: 'O', F: 'G', D: 'W', L: 'R', B: 'B' });
  assert.deepStrictEqual(Cube.applyAlg(Cube.solved(), L.LEARNING_FRAME.prefix), Y0);
  STAGE_IDS.forEach((sid) => L.DEMOS[sid].forEach((d) => assert.deepStrictEqual(Cube.centers(L.demoStates(d.id).start), L.LEARNING_FRAME.colours, d.id)));
});

test('narration: every "X faces you / Y on your right / now on the LEFT" claim matches the centres', () => {
  // [demo, moves played, expected centres]
  const claims = [
    ['cross-front', 0, { F: 'G' }], ['cross-front', 3, { F: 'O' }], ['cross-front', 6, { F: 'B' }], ['cross-front', 8, { F: 'R' }],
    ['corners-right', 0, { F: 'G', R: 'O' }],
    ['corners-front', 1, { F: 'R', R: 'G' }], ['corners-up', 1, { F: 'O', R: 'B' }],
    ['corners-stuck', 1, { F: 'R', R: 'G' }], ['corners-stuck', 6, { F: 'G', R: 'O' }],
    ['middle-right', 1, { F: 'G', R: 'O' }], ['middle-left', 1, { F: 'B' }], ['middle-left', 2, { F: 'B', L: 'O' }],
    ['middle-stuck', 9, { F: 'G', R: 'O' }],
    ['yedges-adjacent', 1, { F: 'G', R: 'O' }], ['yedges-opposite', 0, { L: 'R', R: 'O' }]
  ];
  claims.forEach(([id, n, want]) => Object.keys(want).forEach((f) => assert.strictEqual(Cube.center(after(id, n), f), want[f], id + '@' + n + ' ' + f)));
});

test('narration: piece positions described in every daisy, cross, corner and middle demo', () => {
  const eq = (got, want) => assert.deepStrictEqual(got, want, 'expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
  // daisy-down
  eq(petalSpots(after('daisy-down', 0)), ['UR', 'UL']); eq(edgeAt(after('daisy-down', 0), 'W', 'B'), 'DB:D');
  eq(edgeAt(after('daisy-down', 1), 'W', 'R'), 'DL:D'); assert.ok(petalSpots(after('daisy-down', 1)).includes('UL'));
  assert.ok(!petalSpots(after('daisy-down', 2)).includes('UL')); eq(petalSpots(after('daisy-down', 3)).length, 4);
  // daisy-middle
  eq(petalSpots(after('daisy-middle', 0)), ['UR']); eq(edgeAt(after('daisy-middle', 0), 'W', 'O'), 'UR:U');
  eq(edgeAt(after('daisy-middle', 0), 'W', 'G'), 'FL:L'); eq(edgeAt(after('daisy-middle', 1), 'W', 'G'), 'UF:U');
  eq(edgeAt(after('daisy-middle', 1), 'W', 'R'), 'BL:B'); assert.ok(!petalSpots(after('daisy-middle', 1)).includes('UL'));
  eq(edgeAt(after('daisy-middle', 2), 'W', 'R'), 'UL:U');
  eq(edgeAt(after('daisy-middle', 2), 'W', 'B'), 'DR:D'); assert.ok(petalSpots(after('daisy-middle', 2)).includes('UR'));
  assert.ok(!petalSpots(after('daisy-middle', 3)).includes('UR')); eq(edgeAt(after('daisy-middle', 4), 'W', 'B'), 'UR:U');
  // daisy-top-out
  eq(petalSpots(after('daisy-top-out', 0)), ['UB', 'UL']); eq(edgeAt(after('daisy-top-out', 0), 'W', 'B'), 'UB:U'); eq(edgeAt(after('daisy-top-out', 0), 'W', 'R'), 'UL:U');
  eq(edgeAt(after('daisy-top-out', 0), 'W', 'G'), 'UR:R'); eq(edgeAt(after('daisy-top-out', 0), 'O', 'W'), 'FR:R');
  eq(edgeAt(after('daisy-top-out', 1), 'W', 'O'), 'UR:U'); eq(edgeAt(after('daisy-top-out', 1), 'G', 'W'), 'BR:B');
  assert.ok(petalSpots(after('daisy-top-out', 1)).includes('UB')); assert.ok(!petalSpots(after('daisy-top-out', 2)).includes('UB'));
  ['U', "U'"].forEach((u) => assert.ok(petalSpots(Cube.applyAlg(after('daisy-top-out', 1), u)).includes('UB'), 'only U2 frees the back spot'));
  eq(edgeAt(after('daisy-top-out', 3), 'W', 'G'), 'UB:U');
  // daisy-bottom-side
  eq(petalSpots(after('daisy-bottom-side', 0)), ['UB']); eq(edgeAt(after('daisy-bottom-side', 0), 'W', 'B'), 'UB:U');
  eq(edgeAt(after('daisy-bottom-side', 0), 'W', 'G'), 'DF:D'); eq(edgeAt(after('daisy-bottom-side', 0), 'W', 'O'), 'UF:F');
  eq(edgeAt(after('daisy-bottom-side', 1), 'W', 'G'), 'UF:U'); eq(edgeAt(after('daisy-bottom-side', 1), 'W', 'O'), 'DF:F');
  eq(edgeAt(after('daisy-bottom-side', 1), 'W', 'R'), 'DL:D'); assert.ok(!petalSpots(after('daisy-bottom-side', 1)).includes('UL'));
  eq(edgeAt(after('daisy-bottom-side', 2), 'W', 'O'), 'DF:F');
  eq(edgeAt(after('daisy-bottom-side', 3), 'O', 'W'), 'FR:R'); eq(edgeAt(after('daisy-bottom-side', 3), 'W', 'G'), 'FL:L');
  eq(edgeAt(after('daisy-bottom-side', 4), 'W', 'O'), 'UR:U'); eq(edgeAt(after('daisy-bottom-side', 5), 'W', 'G'), 'UF:U');
  // cross-faces: each U lines up the named petal over its centre
  eq(edgeAt(after('cross-faces', 1), 'G', 'W'), 'UF:F'); eq(edgeAt(after('cross-faces', 3), 'O', 'W'), 'UR:R');
  eq(edgeAt(after('cross-faces', 4), 'B', 'W'), 'UB:B'); eq(edgeAt(after('cross-faces', 6), 'R', 'W'), 'UL:L');
  // cross-front
  eq(edgeAt(after('cross-front', 1), 'G', 'W'), 'UF:F'); eq(edgeAt(after('cross-front', 4), 'O', 'W'), 'UF:F');
  eq(edgeAt(after('cross-front', 6), 'B', 'W'), 'UF:F'); eq(edgeAt(after('cross-front', 9), 'R', 'W'), 'UF:F');
  // corners-right: front-left, then parked with white facing right
  eq(cornerAt(after('corners-right', 0), 'W', 'G', 'O'), 'UFL:F'); eq(cornerAt(after('corners-right', 1), 'W', 'G', 'O'), 'URF:R');
  // corners-front: above the wrong (already solved) slot; parked with white facing you; hops top <-> slot
  eq(cornerAt(after('corners-front', 0), 'W', 'R', 'G'), 'URF:F'); assert.ok(solvedPiece(after('corners-front', 0), 'DFR'));
  eq(cornerAt(after('corners-front', 2), 'W', 'R', 'G'), 'URF:F');
  [6, 14].forEach((n) => eq(cornerAt(after('corners-front', n), 'W', 'R', 'G').slice(0, 3), 'DFR'));
  [10, 18].forEach((n) => eq(cornerAt(after('corners-front', n), 'W', 'R', 'G').slice(0, 3), 'URF'));
  // corners-up
  eq(cornerAt(after('corners-up', 0), 'W', 'O', 'B'), 'UFL:U'); eq(cornerAt(after('corners-up', 2), 'W', 'O', 'B'), 'URF:U');
  // corners-stuck
  eq(cornerAt(after('corners-stuck', 0), 'W', 'G', 'O').slice(0, 3), 'DLF'); eq(cornerAt(after('corners-stuck', 0), 'W', 'R', 'G').slice(0, 3), 'UFL');
  eq(cornerAt(after('corners-stuck', 5), 'W', 'G', 'O').slice(0, 3), 'URF'); assert.ok(solvedPiece(after('corners-stuck', 5), 'DFR'));
  eq(cornerAt(after('corners-stuck', 6), 'W', 'G', 'O').slice(0, 3), 'UFL'); eq(cornerAt(after('corners-stuck', 7), 'W', 'G', 'O'), 'URF:R');
  // middle demos: the T is made, top colour matches the named side
  eq(edgeAt(after('middle-right', 0), 'O', 'G'), 'UR:U'); eq(edgeAt(after('middle-right', 1), 'O', 'G'), 'UF:U');
  eq(edgeAt(after('middle-left', 0), 'O', 'B'), 'UR:U'); eq(edgeAt(after('middle-left', 2), 'O', 'B'), 'UF:U');
  eq(edgeAt(after('middle-stuck', 0), 'G', 'O'), 'FR:R'); eq(edgeAt(after('middle-stuck', 9), 'O', 'G'), 'UF:U');
  assert.ok(solvedPiece(after('middle-right', 9), 'FR')); assert.ok(solvedPiece(after('middle-left', 10), 'FL'));
});

test('narration: last-layer facts (shapes, pairs, home corners, twists)', () => {
  assert.strictEqual(shape(after('ycross-l', 1)), 'L-BL');
  assert.strictEqual(shape(after('ycross-line', 1)), 'line-LR');
  assert.strictEqual(shape(after('ycross-dot', 7)), 'L-BL');
  // yedges: after the rotation the pair is at the back and right; Sune + U swaps front and left, keeps back and right
  assert.deepStrictEqual(matchedEdges(after('yedges-adjacent', 2)).sort(), ['B', 'R']);
  { const s = after('yedges-adjacent', 2), t = after('yedges-adjacent', 10);
    const e = (st, n) => Cube.EDGES.find((x) => x.name === n).stickers.map((i) => st[i]).join('');
    assert.strictEqual(e(t, 'UB'), e(s, 'UB')); assert.strictEqual(e(t, 'UR'), e(s, 'UR'));
    assert.strictEqual(e(t, 'UF'), e(s, 'UL')); assert.strictEqual(e(t, 'UL'), e(s, 'UF')); }
  assert.deepStrictEqual(matchedEdges(after('yedges-opposite', 10)).sort(), ['B', 'R']);
  // ycorners: named home corners and their colours
  const homes = (s) => ['URF', 'UFL', 'ULB', 'UBR'].filter((n) => cornerHome(s, n));
  assert.strictEqual(cornerAt(after('ycorners-one', 0), 'Y', 'R', 'B').slice(0, 3), 'ULB');
  assert.deepStrictEqual(homes(after('ycorners-one', 1)), ['URF']);
  assert.deepStrictEqual(homes(after('ycorners-one', 9)).length, 4);
  { const s = after('ycorners-twice', 0); assert.notStrictEqual(cornerAt(s, 'Y', 'G', 'O'), 'URF:U'); assert.strictEqual(cornerAt(s, 'Y', 'G', 'O').slice(0, 3), 'URF'); }
  assert.strictEqual(cornerAt(after('ycorners-none', 8), 'Y', 'O', 'B').slice(0, 3), 'UBR');
  assert.deepStrictEqual(homes(after('ycorners-none', 9)), ['URF']);
  // yorient: counts of twisted corners, which way yellow faces at each start, U-only between corners
  const twisted = (s) => ['URF', 'UFL', 'ULB', 'UBR'].filter((n) => s[Cube.CORNERS.find((x) => x.name === n).stickers[0]] !== 'Y');
  assert.strictEqual(twisted(after('yorient-two', 0)).length, 2);
  assert.strictEqual(after('yorient-two', 8)[8], 'Y');
  assert.ok(f2l(after('yorient-two', 25)) && twisted(after('yorient-two', 25)).length === 0);
  assert.strictEqual(twisted(after('yorient-three', 0)).length, 3);
  [0, 9, 18].forEach((n) => assert.strictEqual(after('yorient-three', n)[9], 'Y', 'yellow faces right at ' + n));
  assert.deepStrictEqual(twisted(after('yorient-three', 17)), ['ULB']);
  ['yorient-two', 'yorient-three'].forEach((id) => assert.ok(L.demoStates(id).moves.every((t) => !Cube.isRotation(t)), id + ': the cube is never rotated'));
});

test('rep counts from first principles: undo n goes from a solved cube', () => {
  // undoing n right triggers puts the white-green-orange corner where n triggers will bring it home
  const trig = [1, 2, 3, 4, 5].map((n) => cornerAt(Cube.applyAlg(Y0, Cube.invertAlg(rep(A('rtrigger'), n))), 'W', 'G', 'O'));
  assert.deepStrictEqual(trig, ['URF:R', 'DFR:R', 'URF:U', 'DFR:F', 'URF:F']); // 1 right, 3 up, 5 you; in-slot: 2 right, 4 you
  const tw = [2, 4].map((n) => cornerAt(Cube.applyAlg(Y0, Cube.invertAlg(rep(A('twist'), n))), 'Y', 'G', 'O'));
  assert.deepStrictEqual(tw, ['URF:R', 'URF:F']);                                   // yellow right = 2, yellow facing you = 4
  [1, 3, 5].forEach((n) => assert.ok(!cornerAt(Cube.applyAlg(Y0, rep(A('twist'), n)), 'Y', 'G', 'O').startsWith('URF'), 'odd goes leave the corner out of place'));
  // "if you lose count, keep going": every one of the 6 corner states is home within 6 goes
  for (let n = 0; n < 6; n++) {
    let s = Cube.applyAlg(Y0, Cube.invertAlg(rep(A('rtrigger'), n))), k = 0;
    while (!solvedPiece(s, 'DFR') && k < 6) { s = Cube.applyAlg(s, A('rtrigger')); k++; }
    assert.ok(solvedPiece(s, 'DFR') && k === n, 'state ' + n);
  }
  // the shortcuts need exactly the orientation the speed tips say
  [["R U R'", 'URF:R'], ["F' U' F", 'URF:F'], ["R U2 R' U' R U R'", 'URF:U']].forEach(([a, w]) =>
    assert.strictEqual(cornerAt(Cube.applyAlg(Y0, Cube.invertAlg(a)), 'W', 'G', 'O'), w, a));
});

test('mnemonics describe the moves correctly', () => {
  const WORD = { up: /UP/, down: /DOWN/, push: /front moves to the LEFT/, pull: /front moves to the RIGHT/, left: /LEFT/, right: /RIGHT/, 'push-push': /twice/ };
  const check = (id, n) => {
    const words = L.ALGORITHMS[id].mnemonic.toLowerCase().match(/push-push|up|down|push|pull|left|right/g).slice(0, n);
    const t = tok(A(id)).slice(0, n);
    assert.strictEqual(words.length, t.length, id);
    t.forEach((m, i) => assert.match(Cube.moveInfo(m).how, WORD[words[i]], id + ' move ' + i + ' ' + m + ' = ' + words[i]));
  };
  check('rtrigger', 4); check('sune', 7); check('twist', 4);
  assert.match(L.ALGORITHMS.sune.mnemonic, /one more U/);
  // corner cycle: top goes left, right, left, right; R and L' go UP; R' and L go DOWN
  const cc = tok(A('corner-cycle'));
  assert.deepStrictEqual(cc.filter((m) => m[0] === 'U').map((m) => /LEFT/.test(Cube.moveInfo(m).how) ? 'left' : 'right'), ['left', 'right', 'left', 'right']);
  assert.deepStrictEqual(cc.filter((m) => m[0] !== 'U').map((m) => /UP/.test(Cube.moveInfo(m).how) ? 'up' : 'down'), ['up', 'up', 'down', 'down']);
  assert.deepStrictEqual(cc.filter((m) => m[0] !== 'U'), ['R', "L'", "R'", 'L']);
  // middle layer: the bracketed parts in the mnemonics rebuild the algorithm
  const parts = (str) => (str.match(/\(([^)]+)\)/g) || []).map((p) => p.slice(1, -1));
  assert.strictEqual(['U'].concat(parts(L.ALGORITHMS['mid-right'].mnemonic).join(" U' ")).join(' '), A('mid-right'));
  assert.strictEqual(["U'"].concat(parts(L.ALGORITHMS['mid-left'].mnemonic).join(' U ')).join(' '), A('mid-left'));
  assert.strictEqual(parts(L.STAGES.middle.mnemonics[1]).join(' '), A('mid-right'));
});

test('wide moves are not taught (f R U R\' U\' f\' would need the L at front-right, not back-left)', () => {
  const s = Cube.applyAlg(Y0, Cube.scramble(25, 5));
  // f R U R' U' f' is exactly the shortcut F U R U' R' F' done from the back (y2), so its L sits at front-right
  assert.deepStrictEqual(Cube.applyAlg(s, "f R U R' U' f'"), Cube.applyAlg(s, "y2 F U R U' R' F' y2"));
  const text = JSON.stringify(L);
  assert.ok(!/(^|[\s"(])[udrlfb]w?['2]?\s+[URFDLB]['2]?(\s|$|")/.test(text), 'no wide-move sequences in the content');
});

test('week 1 names every face letter the daisy and cross lessons use', () => {
  const used = new Set();
  ['daisy', 'cross'].forEach((sid) => {
    L.DEMOS[sid].forEach((d) => tok(d.moves).forEach((m) => { if (!Cube.isRotation(m)) used.add(m[0]); }));
    L.STAGES[sid].hints.concat(L.STAGES[sid].speedTips).join(' ').replace(/\b([URFDLB])2?\b/g, (m, f) => { used.add(f); return m; });
  });
  const goal = L.CURRICULUM[0].goals[0];
  used.forEach((f) => assert.ok(new RegExp('\\b' + f + '\\b').test(goal), 'week 1 goal should name ' + f));
});

test('no-cube learning: tips, and a pause-and-predict checkpoint in every demo', () => {
  assert.ok(L.NO_CUBE_TIPS.length >= 5);
  assert.strictEqual(new Set(L.NO_CUBE_TIPS.map((t) => t.title)).size, L.NO_CUBE_TIPS.length);
  STAGE_IDS.forEach((sid) => L.DEMOS[sid].forEach((d) => assert.ok((d.checkpoints || []).length >= 1, d.id + ' has a checkpoint')));
});

test('British/neutral spelling throughout', () => {
  const text = JSON.stringify(L);
  ['color', 'center', 'recognize', 'favorite', 'counterclockwise', 'practicing'].forEach((w) => assert.ok(!new RegExp('\\b' + w, 'i').test(text), w));
});

// ------------------------------------------------------------ middle layer: the extra worked examples and copy
const MID_SLOTS = Cube.EDGES.filter((e) => ['FR', 'FL', 'BL', 'BR'].includes(e.name));
const topEdgesFree = (s) => ['UF', 'UR', 'UB', 'UL'].filter((n) => Cube.EDGES.find((e) => e.name === n).stickers.every((i) => s[i] !== 'Y'));
const slotState = (s, name) => {   // home | flipped | wrong | yellow, for the middle slot `name`
  const e = Cube.EDGES.find((x) => x.name === name), cols = e.stickers.map((i) => s[i]), want = e.stickers.map((i) => Cube.center(s, Cube.STICKERS[i].face));
  if (cols.includes('Y')) return 'yellow';
  if (cols[0] === want[0] && cols[1] === want[1]) return 'home';
  return cols[0] === want[1] && cols[1] === want[0] ? 'flipped' : 'wrong';
};
const edgeHomeL = (s, a, b) => { const e = Cube.findEdge(s, a, b); return s[e.stickers[0]] === Cube.center(s, e.faces[0]) && s[e.stickers[1]] === Cube.center(s, e.faces[1]); };
// T-states: a random first-layer cube, one solved slot held at front-right (right) or front-left (left), the algorithm undone
function middleTs(n) {
  const out = [];
  for (let seed = 1; seed <= n; seed++) {
    const s0 = randomFrom(FL_POOL, seed, 8);
    for (const rot of ['', 'y', "y'", 'y2']) for (const id of ['mid-right', 'mid-left']) {
      const held = Cube.applyAlg(s0, rot);
      const slot = id === 'mid-right' ? 'FR' : 'FL';
      if (slotState(held, slot) !== 'home') continue;
      const t = Cube.applyAlg(held, Cube.invertAlg(A(id)));
      out.push({ id, t, side: t[19], top: t[7], slot, held });
    }
  }
  return out;
}

test('middle layer: at least 8 worked examples, the original three kept, and every new one tells the truth', () => {
  const ids = L.DEMOS.middle.map((d) => d.id);
  assert.ok(ids.length >= 8, 'middle demos: ' + ids.length);
  ['middle-right', 'middle-left', 'middle-stuck'].forEach((id) => assert.ok(ids.includes(id), id + ' kept'));
  ['middle-right-back', 'middle-right-turn', 'middle-two', 'middle-wrong-slot', 'middle-no-edge', 'middle-yellow-trap'].forEach((id) => assert.ok(ids.includes(id), id));
  const eq = (got, want, msg) => assert.deepStrictEqual(got, want, msg + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
  const C3 = (s) => [Cube.center(s, 'F'), Cube.center(s, 'R'), Cube.center(s, 'L')];
  const done = (id) => after(id, L.demoStates(id).moves.length);
  // edge at the back, U2
  eq(topEdgesFree(after('middle-right-back', 0)), ['UB'], 'right-back usable');
  eq(edgeAt(after('middle-right-back', 0), 'G', 'O'), 'UB:B', 'green faces the back'); eq(Cube.center(after('middle-right-back', 0), 'F'), 'G', 'green in front');
  eq(edgeAt(after('middle-right-back', 1), 'G', 'O'), 'UF:F', 'T made'); eq(after('middle-right-back', 1)[7], Cube.center(after('middle-right-back', 1), 'R'), 'orange on top = right centre');
  { const s = after('middle-right-back', 5); eq(edgeAt(s, 'G', 'O'), 'UF:F', 'half-way edge back'); eq(cornerAt(s, 'W', 'G', 'O'), 'URF:R', 'corner right next to it'); }
  assert.ok(solvedPiece(done('middle-right-back'), 'FR') && firstLayer(done('middle-right-back')));
  // not above its own colour: rotate first
  { const s = after('middle-right-turn', 0); eq(topEdgesFree(s), ['UF'], 'right-turn usable'); eq(edgeAt(s, 'O', 'B'), 'UF:F', 'orange faces you'); eq(Cube.center(s, 'F'), 'G', 'above green'); }
  { const s = after('middle-right-turn', 1); eq(Cube.center(s, 'F'), 'O', 'orange faces you'); eq(Cube.findEdge(s, 'O', 'B').name, 'UL', 'top-left'); }
  { const s = after('middle-right-turn', 2); eq(edgeAt(s, 'O', 'B'), 'UF:F', 'T'); eq(Cube.center(s, 'R'), 'B', 'blue is the right centre'); }
  assert.ok(edgeHomeL(done('middle-right-turn'), 'O', 'B'));
  // two in a row
  { const s = after('middle-two', 0); eq(topEdgesFree(s).sort(), ['UL', 'UR'], 'two usable'); eq(edgeAt(s, 'G', 'O'), 'UR:R', 'green–orange on the right, green on its side'); eq(edgeAt(s, 'R', 'B'), 'UL:L', 'red–blue on the left'); }
  eq(edgeAt(after('middle-two', 1), 'G', 'O'), 'UF:F', 'U lines it up'); eq(Cube.center(after('middle-two', 1), 'R'), 'O');
  { const s = after('middle-two', 9); assert.ok(edgeHomeL(s, 'G', 'O')); eq(edgeAt(s, 'R', 'B'), 'UR:R', 'red–blue at the top-right, red on its side'); eq(Cube.center(s, 'L'), 'R', 'red centre on the left'); }
  { const s = after('middle-two', 10); eq(Cube.center(s, 'F'), 'R', 'red faces you'); eq(edgeAt(s, 'R', 'B'), 'UB:B', 'at the back, red facing the back'); }
  { const s = after('middle-two', 11); eq(edgeAt(s, 'R', 'B'), 'UF:F', 'T'); eq(Cube.center(s, 'L'), 'B', 'blue is the left centre'); }
  { const s = done('middle-two'); assert.ok(edgeHomeL(s, 'G', 'O') && edgeHomeL(s, 'R', 'B')); }
  // wrong slot: the edge that belongs there kicks it out
  { const s = after('middle-wrong-slot', 0);
    eq(Cube.findEdge(s, 'G', 'O').name, 'BR', 'green–orange at the back-right'); eq(slotState(s, 'BR'), 'wrong', 'wrong slot');
    eq([Cube.center(s, 'B'), Cube.center(s, 'R')], ['B', 'O'], 'between blue and orange');
    eq(topEdgesFree(s), ['UF'], 'blue–orange is the usable edge'); eq(edgeAt(s, 'B', 'O'), 'UF:F', 'blue facing you'); }
  { const s = after('middle-wrong-slot', 1); eq(Cube.center(s, 'F'), 'B'); eq(edgeAt(s, 'B', 'O'), 'UB:B', 'blue facing the back'); }
  { const s = after('middle-wrong-slot', 2); eq(edgeAt(s, 'B', 'O'), 'UF:F', 'T'); eq(Cube.center(s, 'L'), 'O', 'orange is the left centre'); eq(Cube.findEdge(s, 'G', 'O').name, 'FL', 'green–orange sits in that slot'); }
  { const s = after('middle-wrong-slot', 10); assert.ok(edgeHomeL(s, 'B', 'O')); eq(edgeAt(s, 'G', 'O'), 'UB:B', 'kicked out to the top at the back, green facing the back'); }
  { const s = after('middle-wrong-slot', 11); eq(Cube.center(s, 'F'), 'G'); eq(edgeAt(s, 'G', 'O'), 'UF:F', 'already a T'); eq(Cube.center(s, 'R'), 'O'); }
  { const s = done('middle-wrong-slot'); assert.ok(edgeHomeL(s, 'G', 'O') && edgeHomeL(s, 'B', 'O')); }
  // no usable edge on top: find the flipped one at the back-left
  { const s = after('middle-no-edge', 0);
    ['', 'U', "U'", 'U2'].forEach((u) => eq(topEdgesFree(Cube.applyAlg(s, u)), [], 'no usable top edge'));
    eq(slotState(s, 'BL'), 'flipped', 'back-left flipped'); eq(Cube.findEdge(s, 'B', 'R').name, 'BL');
    const e = Cube.findEdge(s, 'B', 'R'); eq(Cube.center(s, e.faces[0]), 'R', 'blue on the red side');
    ['FR', 'FL', 'BR'].forEach((n) => eq(slotState(s, n), 'home', n)); }
  { const s = after('middle-no-edge', 1); eq(slotState(s, 'FR'), 'flipped', 'stuck slot at the front-right'); eq(Cube.findEdge(s, 'B', 'R').name, 'FR'); }
  { const s = after('middle-no-edge', 9); eq(edgeAt(s, 'B', 'R'), 'UB:B', 'out, on top at the back, blue facing the back'); eq(Cube.center(s, 'F'), 'B'); assert.ok(firstLayer(s)); }
  { const s = after('middle-no-edge', 10); eq(edgeAt(s, 'B', 'R'), 'UF:F'); eq(Cube.center(s, 'R'), 'R', 'red is the right centre'); }
  assert.ok(edgeHomeL(done('middle-no-edge'), 'B', 'R'));
  { const st = L.demoStates('middle-no-edge').start; const plan = require('../js/solver.js').solve(st).stages[3];
    eq(plan.steps.map((x) => x.case.id), ['edge-stuck', 'edge-right'], 'the coach does the same'); eq([].concat(...plan.steps.map((x) => x.moves)), L.demoStates('middle-no-edge').moves, 'same moves'); }
  // the yellow-edge trap
  { const s = after('middle-yellow-trap', 0);
    eq(s[19], Cube.center(s, 'F'), 'green above the green centre'); eq(s[7], 'Y', 'yellow on top');
    assert.ok(![Cube.center(s, 'R'), Cube.center(s, 'L')].includes('Y'), 'yellow is neither side centre');
    eq(topEdgesFree(s), ['UB'], 'only green–red is usable'); eq(edgeAt(s, 'G', 'R'), 'UB:B', 'at the back'); }
  { const s = after('middle-yellow-trap', 1); eq(edgeAt(s, 'G', 'R'), 'UF:F', 'a real T'); eq(Cube.center(s, 'L'), 'R', 'red is the left centre'); }
  assert.ok(edgeHomeL(done('middle-yellow-trap'), 'G', 'R'));
  // narration "U' / U2 / y / y' brings …": the claimed centres in front after each rotation
  [['middle-right-turn', 1, 'O'], ['middle-two', 10, 'R'], ['middle-wrong-slot', 1, 'B'], ['middle-wrong-slot', 11, 'G'], ['middle-no-edge', 1, 'B']]
    .forEach(([id, n, f]) => eq(C3(after(id, n))[0], f, id + '@' + n + ' front centre'));
  // every middle demo: each algorithm in it keeps the white layer and the slots already filled
  L.DEMOS.middle.forEach((d) => {
    const ds = L.demoStates(d.id);
    for (let k = 0; k + 8 <= ds.moves.length; k++) {
      const seg = ds.moves.slice(k, k + 8).join(' ');
      if (seg !== A('mid-right') && seg !== A('mid-left')) continue;
      const before = Cube.applyAlg(ds.start, ds.moves.slice(0, k));
      const end = Cube.applyAlg(ds.start, ds.moves.slice(0, k + 8));
      assert.ok(firstLayer(end), d.id + ': white layer whole after the algorithm at ' + k);
      MID_SLOTS.filter((e) => slotState(before, e.name) === 'home').forEach((e) => {
        const cols = e.stickers.map((i) => before[i]); assert.ok(edgeHomeL(end, cols[0], cols[1]), d.id + ' keeps ' + cols.join(''));
      });
    }
  });
});

test('middle layer: inserting an edge always pushes out whatever was in that slot (to the top layer)', () => {
  let n = 0;
  middleTs(120).forEach(({ id, t, slot }) => {
    const e = Cube.EDGES.find((x) => x.name === slot), occ = e.stickers.map((i) => t[i]);
    const end = Cube.applyAlg(t, A(id));
    assert.strictEqual(Cube.findEdge(end, occ[0], occ[1]).name[0], 'U', 'kicked to the top');
    n++;
  });
  assert.ok(n > 300, 'tested ' + n);
});

test('middle layer copy: two halves, the mirror rule, why it works, landmarks and what to do when lost', () => {
  require('../js/solver.js');
  const Gym = require('../js/gym.js');
  const M = L.STAGES.middle;
  // two halves of four moves; same rhythm as the gym
  assert.deepStrictEqual(M.halves.map((h) => h.algId), ['mid-right', 'mid-left']);
  M.halves.forEach((h) => {
    assert.strictEqual(tok(h.first).length, 4); assert.strictEqual(tok(h.second).length, 4);
    assert.strictEqual(h.first + ' ' + h.second, A(h.algId), h.algId + ' halves rebuild the algorithm');
    const g = Gym.ALGS[h.algId === 'mid-right' ? 'right' : 'left'];
    assert.deepStrictEqual(h.rhythm, g.halves.map((x) => x.rhythm));
    assert.deepStrictEqual([tok(h.first), tok(h.second)], g.halves.map((x) => x.moves));
    assert.ok(h.firstDoes && h.secondDoes);
  });
  const halvesText = M.howTo.find((p) => p.startsWith('Learn each algorithm as two halves'));
  assert.ok(halvesText.includes(M.halves[0].first) && halvesText.includes(M.halves[0].second) && halvesText.includes(M.halves[0].rhythm[0]) && halvesText.includes(M.halves[0].rhythm[1]));
  // left = mirror of right: swap R and L, every turn the other way
  const mirror = (a) => tok(a).map((t) => { const b = { R: 'L', L: 'R' }[t[0]] || t[0]; return t.endsWith("'") ? b : b + "'"; }).join(' ');
  assert.strictEqual(mirror(M.halves[0].first), M.halves[1].first); assert.strictEqual(mirror(M.halves[0].second), M.halves[1].second);
  const mirrorText = M.howTo.find((p) => p.startsWith('Left is the mirror'));
  assert.ok(mirrorText.includes(M.halves[1].first) && mirrorText.includes(M.halves[1].second));
  assert.match(M.mirrorRule, /swap R for L/);
  let tested = 0;
  middleTs(80).forEach(({ id, t, side, top, slot }) => {
    const R = id === 'mid-right', mv = tok(A(id));
    const st = (k) => Cube.applyAlg(t, mv.slice(0, k));
    // why it works: the first half parks the white corner on top next to the edge, matching colours touching…
    const h = st(4), e = Cube.findEdge(h, side, top), c = Cube.findCorner(h, 'W', side, top);
    assert.strictEqual(e.name, 'UF'); assert.strictEqual(c.name, R ? 'URF' : 'UFL'); assert.strictEqual(c.faces[0], R ? 'R' : 'L', 'white faces out to the side');
    assert.strictEqual(h[R ? 20 : 18], h[19]); assert.strictEqual(h[R ? 8 : 6], h[7]);
    // …the only piece missing from the white layer is that corner…
    const fl = (s) => Cube.EDGES.filter((x) => x.name[0] === 'D').concat(Cube.CORNERS.filter((x) => x.name[0] === 'D')).filter((p) => !p.stickers.every((i) => s[i] === Cube.center(s, Cube.STICKERS[i].face))).map((p) => p.name);
    assert.deepStrictEqual(fl(h), [R ? 'DFR' : 'DLF'], 'only that corner is missing');
    // …and that checkpoint picture appears only after the first half (never at another move)
    for (let k = 1; k <= 7; k++) {
      const s = st(k), ek = Cube.findEdge(s, side, top), ck = Cube.findCorner(s, 'W', side, top);
      const looks = ek.name === 'UF' && ck.name === (R ? 'URF' : 'UFL') && fl(s).length === 1;
      assert.strictEqual(looks, k === 4, 'checkpoint only at move 4 (k=' + k + ')');
      assert.ok(!firstLayer(s) || k === 1, 'white layer broken from the 2nd move');   // landmarks[2]
    }
    [6, 7].forEach((k) => assert.ok(fl(st(k)).some((n) => n.length === 2), 'after the F turn the white cross has a piece out'));
    // the second half puts the pair back together; everything else in the first two layers is where it was
    const end = st(8);
    assert.ok(edgeHomeL(end, side, top) && solvedPiece(end, R ? 'DFR' : 'DLF') && firstLayer(end));
    MID_SLOTS.filter((x) => x.name !== slot).forEach((x) => assert.deepStrictEqual(x.stickers.map((i) => end[i]), x.stickers.map((i) => t[i]), 'slot ' + x.name + ' unchanged'));
    // lost your place: undoing the moves in reverse, each turned the other way, gets you back to the T
    for (let k = 0; k <= 8; k++) assert.deepStrictEqual(Cube.applyAlg(st(k), Cube.invertAlg(mv.slice(0, k))), t);
    // a slip (direction, or the other side's move) never comes out right if you just carry on
    for (let j = 0; j < 8; j++) {
      const slips = [Cube.invertMove(mv[j])].concat(/^[RL]/.test(mv[j]) ? [{ R: 'L', L: 'R' }[mv[j][0]] + (mv[j].endsWith("'") ? '' : "'")] : []);
      slips.forEach((w) => {
        const s = Cube.applyAlg(t, mv.slice(0, j).concat([w], mv.slice(j + 1)));
        assert.ok(!(firstLayer(s) && edgeHomeL(s, side, top)), 'carrying on after a slip at move ' + (j + 1) + ' fails');
      });
    }
    tested++;
  });
  assert.ok(tested > 200, 'tested ' + tested);
  // "the right algorithm only changes the front-right slot" (and the left only the front-left)
  const pR = Cube.algPerm(A('mid-right')), pL = Cube.algPerm(A('mid-left'));
  ['FL', 'BL', 'BR'].forEach((n) => Cube.EDGES.find((e) => e.name === n).stickers.forEach((i) => assert.strictEqual(pR[i], i, n)));
  ['FR', 'BL', 'BR'].forEach((n) => Cube.EDGES.find((e) => e.name === n).stickers.forEach((i) => assert.strictEqual(pL[i], i, n)));
  // "yellow on top matches neither side centre": with yellow on top no side centre is ever yellow
  ['', 'y', "y'", 'y2'].forEach((r) => ['F', 'R', 'B', 'L'].forEach((f) => assert.notStrictEqual(Cube.center(Cube.applyAlg(Y0, r), f), 'Y')));
  // the copy is there and in the right places
  assert.ok(M.why.includes('first half lifts the white corner') && M.why.includes('together, as a pair'));
  assert.strictEqual(M.landmarks.length, 3); assert.strictEqual(M.lostPlace.length, 5);
  assert.ok(M.howTo.some((p) => p.startsWith('Lost your place?')) && M.howTo.some((p) => p.startsWith('Check yourself after the first half')));
  ['Turning the whole cube in the middle', 'Stopping half-way', 'A slip', 'Popping out a stuck edge', 'Lining up an edge with yellow on top']
    .forEach((m) => assert.ok(M.mistakes.some((x) => x.startsWith(m)), 'mistake: ' + m));
  assert.ok(M.mnemonics.length >= 5);
  assert.strictEqual(M.hints.length, 3);
  // the recognise cases stay as they were (the Practice screen draws its options from them)
  assert.deepStrictEqual(M.recognise.map((r) => r.caseId), ['edge-right', 'edge-left', 'edge-stuck', 'edge-yellow']);
});

console.log(passed + ' lessons tests passed' + (process.exitCode ? ' (with failures)' : ''));
