// node tests/cube.test.js
const assert = require('assert');
require('../js/cube.js');
const Cube = globalThis.CC.Cube;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; }
}

const SOLVED = Cube.solved();
const toFaces = (s) => s.map((c) => ({ W: 'U', R: 'R', G: 'F', Y: 'D', O: 'L', B: 'B' })[c]).join('');

test('solved cube is solved and valid', () => {
  assert.ok(Cube.isSolved(SOLVED));
  assert.ok(Cube.validate(SOLVED).ok);
});

test('every move has order 4 and X X\' = identity', () => {
  Object.keys(Cube.MOVE_DEFS).forEach((m) => {
    assert.deepStrictEqual(Cube.applyAlg(SOLVED, [m, m, m, m]), SOLVED, m);
    const s = Cube.applyAlg(SOLVED, 'R U F');
    assert.deepStrictEqual(Cube.applyAlg(s, [m, m + "'"]), s, m);
    assert.deepStrictEqual(Cube.applyAlg(s, [m + '2', m + '2']), s, m);
  });
});

test('R matches the known Kociemba facelet string', () => {
  assert.strictEqual(toFaces(Cube.applyMove(SOLVED, 'R')),
    'UUFUUFUUF' + 'RRRRRRRRR' + 'FFDFFDFFD' + 'DDBDDBDDB' + 'LLLLLLLLL' + 'UBBUBBUBB');
});

test('U matches the known Kociemba facelet string', () => {
  assert.strictEqual(toFaces(Cube.applyMove(SOLVED, 'U')),
    'UUUUUUUUU' + 'BBBRRRRRR' + 'RRRFFFFFF' + 'DDDDDDDDD' + 'FFFLLLLLL' + 'LLLBBBBBB');
});

test('F matches the known Kociemba facelet string', () => {
  assert.strictEqual(toFaces(Cube.applyMove(SOLVED, 'F')),
    'UUUUUULLL' + 'URRURRURR' + 'FFFFFFFFF' + 'RRRDDDDDD' + 'LLDLLDLLD' + 'BBBBBBBBB');
});

test('rotations equal their face/slice decompositions', () => {
  const s = Cube.applyAlg(SOLVED, Cube.scramble(30, 7));
  const eq = (a, b) => assert.deepStrictEqual(Cube.applyAlg(s, a), Cube.applyAlg(s, b), a + ' vs ' + b);
  eq('x', "R M' L'");
  eq('y', "U E' D'");
  eq('z', "F S B'");
  eq('r', "R M'");
  eq('Rw', 'r');
  eq("u", "U E'");
});

test('sexy move has order 6; Sune has order 6', () => {
  let s = SOLVED;
  for (let i = 0; i < 6; i++) s = Cube.applyAlg(s, "R U R' U'");
  assert.deepStrictEqual(s, SOLVED);
  s = SOLVED;
  for (let i = 0; i < 6; i++) s = Cube.applyAlg(s, "R U R' U R U2 R'");
  assert.deepStrictEqual(s, SOLVED);
});

test('alg followed by its inverse is identity', () => {
  for (let seed = 1; seed < 50; seed++) {
    const alg = Cube.scramble(25, seed);
    assert.deepStrictEqual(Cube.applyAlg(Cube.applyAlg(SOLVED, alg), Cube.invertAlg(alg)), SOLVED);
  }
});

test('parseAlg handles compact and decorated input', () => {
  assert.deepStrictEqual(Cube.parseAlg("RUR'U'"), ['R', 'U', "R'", "U'"]);
  assert.deepStrictEqual(Cube.parseAlg("(R U2 R’) Rw2' x"), ['R', 'U2', "R'", 'r2', 'x']);
  assert.throws(() => Cube.parseAlg('R Q'));
});

test('simplifyAlg merges and cancels', () => {
  assert.deepStrictEqual(Cube.simplifyAlg("R R U U' F F F"), ['R2', "F'"]);
  assert.deepStrictEqual(Cube.simplifyAlg("y y y y R"), ['R']);
});

test('piece tables are geometrically consistent', () => {
  Cube.CORNERS.forEach((c) => {
    const cubies = c.stickers.map((i) => Cube.STICKERS[i].cubie.join(','));
    assert.ok(cubies.every((k) => k === cubies[0]), c.name);
    const n = c.stickers.map((i) => Cube.STICKERS[i].normal);
    const cr = [n[0][1] * n[1][2] - n[0][2] * n[1][1], n[0][2] * n[1][0] - n[0][0] * n[1][2], n[0][0] * n[1][1] - n[0][1] * n[1][0]];
    assert.strictEqual(cr[0] * n[2][0] + cr[1] * n[2][1] + cr[2] * n[2][2], -1, 'handedness ' + c.name);
    assert.deepStrictEqual(c.faces.join(''), c.name);
  });
  Cube.EDGES.forEach((e) => {
    const cubies = e.stickers.map((i) => Cube.STICKERS[i].cubie.join(','));
    assert.strictEqual(cubies[0], cubies[1], e.name);
    assert.deepStrictEqual(e.faces.join(''), e.name);
  });
});

test('scrambled states validate in every orientation', () => {
  const rots = ['', 'y', 'y2', "y'", 'x', "x'", 'x2', 'z', "z'", 'z2', 'x y', 'x y2', "x y'", "x' y", "x' y2", "x' y'", 'z y', "z y'", "z' y", "z' y'", 'x2 y', "x2 y'", 'z2 y', 'z y2'];
  for (let seed = 1; seed < 40; seed++) {
    const s = Cube.applyAlg(SOLVED, Cube.scramble(25, seed));
    rots.forEach((r) => {
      const v = Cube.validate(Cube.applyAlg(s, r));
      assert.ok(v.ok, 'seed ' + seed + ' rot ' + r + ' ' + JSON.stringify(v.errors));
    });
  }
});

test('rotationTo reaches all 24 orientations', () => {
  const s = Cube.applyAlg(SOLVED, Cube.scramble(20, 3));
  const pairs = [];
  ['W', 'Y', 'G', 'B', 'R', 'O'].forEach((u) => ['W', 'Y', 'G', 'B', 'R', 'O'].forEach((f) => {
    if (u !== f && Cube.OPPOSITE[u] !== f) pairs.push([u, f]);
  }));
  assert.strictEqual(pairs.length, 24);
  pairs.forEach(([u, f]) => {
    const rot = Cube.rotationTo(s, u, f);
    assert.ok(rot, u + f);
    const t = Cube.applyAlg(s, rot);
    assert.strictEqual(Cube.center(t, 'U'), u);
    assert.strictEqual(Cube.center(t, 'F'), f);
  });
  assert.deepStrictEqual(Cube.rotationTo(SOLVED, 'Y', 'G'), ['z2']);
});

test('validation catches twist, flip, swap and miscounts', () => {
  const s = Cube.applyAlg(SOLVED, Cube.scramble(25, 11));
  // twist a corner (URF): rotate its three stickers
  const tw = s.slice(); [tw[8], tw[9], tw[20]] = [s[9], s[20], s[8]];
  assert.deepStrictEqual(Cube.validate(tw).errors.map((e) => e.type), ['twist']);
  // flip an edge (UF)
  const fl = s.slice(); [fl[7], fl[19]] = [s[19], s[7]];
  assert.deepStrictEqual(Cube.validate(fl).errors.map((e) => e.type), ['flip']);
  // swap two edges (UF <-> UR) preserving orientation
  const sw = s.slice(); [sw[7], sw[19], sw[5], sw[10]] = [s[5], s[10], s[7], s[19]];
  assert.deepStrictEqual(Cube.validate(sw).errors.map((e) => e.type), ['parity']);
  // misread one sticker
  const mr = s.slice(); mr[0] = mr[0] === 'W' ? 'Y' : 'W';
  assert.ok(!Cube.validate(mr).ok);
  assert.ok(Cube.validate(mr).errors.some((e) => e.type === 'count'));
});

test('findEdge / findCorner', () => {
  const e = Cube.findEdge(SOLVED, 'G', 'W');
  assert.strictEqual(e.name, 'UF');
  assert.deepStrictEqual(e.stickers, [19, 7]);
  const c = Cube.findCorner(SOLVED, 'R', 'W', 'G');
  assert.strictEqual(c.name, 'URF');
  assert.deepStrictEqual(c.stickers, [9, 8, 20]);
  const s = Cube.applyMove(SOLVED, 'R');
  assert.strictEqual(Cube.findCorner(s, 'W', 'G', 'R').name, 'UBR');
});

test('stickerAfter tracks a sticker through moves', () => {
  const s0 = Cube.applyAlg(SOLVED, Cube.scramble(25, 5));
  const alg = "R U R' U' F2";
  const s1 = Cube.applyAlg(s0, alg);
  for (let i = 0; i < 54; i++) assert.strictEqual(s1[Cube.stickerAfter(i, alg)], s0[i]);
});

test('moveInfo gives plain English', () => {
  assert.match(Cube.moveInfo("R").text, /UP/);
  assert.match(Cube.moveInfo("U'").text, /RIGHT/);
  assert.match(Cube.moveInfo('z2').text, /upside down/);
  assert.strictEqual(Cube.moveInfo('y').rotation, true);
});

console.log(passed + ' cube tests passed' + (process.exitCode ? ' (with failures)' : ''));
