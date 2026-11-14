// node tests/solver.test.js
const assert = require('assert');
require('../js/cube.js');
require('../js/solver.js');
const Cube = globalThis.CC.Cube;
const S = globalThis.CC.Solver;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack || e.message); process.exitCode = 1; }
}

const N_RANDOM = 3000;
const IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
const KINDS = ['rotate', 'intuitive', 'algorithm', 'repeat', 'align'];
const ALG_IDS = ['rtrigger', 'mid-right', 'mid-left', 'ycross', 'sune', 'corner-cycle', 'twist'];
const SOLVED = Cube.solved();
const LEARN = Cube.applyAlg(SOLVED, 'z2');
const isRot = (t) => /^[xyz]/.test(t);
const base = (t) => t.replace(/['2]$/, '');
const faceTurns = (moves) => moves.filter((t) => !isRot(t)).length;

// All 24 whole-cube orientations, as rotation sequences.
const ROT24 = (() => {
  const seen = new Map();
  const queue = [[]];
  seen.set(Cube.toString(Cube.applyAlg(SOLVED, [])), []);
  while (queue.length) {
    const seq = queue.shift();
    for (const r of ['x', 'y', 'z']) {
      const next = seq.concat([r]);
      const key = Cube.toString(Cube.applyAlg(SOLVED, next));
      if (!seen.has(key)) { seen.set(key, next); queue.push(next); }
    }
  }
  return [...seen.values()];
})();

// ---- yellow-up helpers used by the semantic checks (independent of the solver's own code)
const cen = (s, f) => s['URFDLB'.indexOf(f) * 9 + 4];
const petals = (s) => [1, 3, 5, 7].filter((i) => s[i] === 'W').length;
const homeEdges = (s) => [[28, 25, 'F'], [30, 43, 'L'], [32, 16, 'R'], [34, 52, 'B']].filter(([d, x, f]) => s[d] === 'W' && s[x] === cen(s, f)).length;
const DCORNERS = Cube.CORNERS.slice(4);
const solvedDCorners = (s) => DCORNERS.filter((c) => c.stickers.every((i) => s[i] === cen(s, Cube.STICKERS[i].face))).length;
const MIDEDGES = Cube.EDGES.slice(8);
const solvedMidEdges = (s) => MIDEDGES.filter((e) => e.stickers.every((i) => s[i] === cen(s, Cube.STICKERS[i].face))).length;
const topWhiteCorners = (s) => Cube.CORNERS.slice(0, 4).filter((c) => c.stickers.some((i) => s[i] === 'W')).length;
const topEdgesNoYellow = (s) => Cube.EDGES.slice(0, 4).filter((e) => e.stickers.every((i) => s[i] !== 'Y')).length;
function shape(s) {
  const b = s[1] === 'Y', l = s[3] === 'Y', r = s[5] === 'Y', f = s[7] === 'Y', n = b + l + r + f;
  if (n === 4) return 'cross';
  if (n === 0) return 'dot';
  return (b && f) || (l && r) ? 'line' : 'l-shape';
}
const U_CORNERS = [[8, 9, 20, 'U', 'R', 'F'], [6, 18, 38, 'U', 'F', 'L'], [0, 36, 47, 'U', 'L', 'B'], [2, 45, 11, 'U', 'B', 'R']];
const cornerInPlace = (s, k) => {
  const c = U_CORNERS[k], a = [s[c[0]], s[c[1]], s[c[2]]].sort().join(''), b = [cen(s, c[3]), cen(s, c[4]), cen(s, c[5])].sort().join('');
  return a === b;
};

const stats = { solves: 0, faceTurns: 0, ms: 0, maxMs: 0, maxTurns: 0, steps: 0, quizzes: 0, cases: {} };

function checkStep(step, stage, k, state, ctx) {
  const where = `${step.id}`;
  assert.strictEqual(step.stage, stage.id, where + ' stage');
  assert.strictEqual(step.id, `${stage.id}-${k + 1}`, where + ' id');
  assert.ok(KINDS.includes(step.kind), where + ' kind ' + step.kind);
  assert.ok(typeof step.title === 'string' && step.title.length > 3, where + ' title');
  assert.ok(typeof step.explain === 'string' && step.explain.length > 10, where + ' explain');
  assert.ok(Array.isArray(step.moves) && step.moves.length > 0, where + ' empty moves');
  step.moves.forEach((t) => assert.strictEqual(Cube.normalizeToken(t), t, where + ' token ' + t));
  // segments partition moves
  assert.ok(Array.isArray(step.segments) && step.segments.length > 0, where + ' segments');
  const flat = [];
  step.segments.forEach((g) => {
    assert.ok(typeof g.label === 'string' && g.label.length > 0, where + ' segment label');
    assert.ok(Array.isArray(g.moves) && g.moves.length > 0, where + ' empty segment');
    for (let i = 1; i < g.moves.length; i++) assert.notStrictEqual(base(g.moves[i]), base(g.moves[i - 1]), where + ' unmerged moves in a segment: ' + g.moves.join(' '));
    flat.push(...g.moves);
  });
  assert.deepStrictEqual(flat, step.moves, where + ' segments do not partition moves');
  // adjacent tokens across segments: never two rotations of the same axis, never two set-up U turns
  for (let i = 1; i < step.segments.length; i++) {
    const a = step.segments[i - 1].moves.slice(-1)[0], b = step.segments[i].moves[0];
    if (base(a) !== base(b)) continue;
    assert.ok(!isRot(a), where + ' pointless rotation pair ' + a + ' ' + b);
    const algSeg = step.alg && Cube.parseAlg(step.alg.notation).join(' ') === step.segments[i].moves.join(' ');
    assert.ok(algSeg, where + ' consecutive ' + a + ' ' + b + ' outside an algorithm');
  }
  // states
  assert.deepStrictEqual(step.startState, state, where + ' startState');
  assert.deepStrictEqual(Cube.applyAlg(step.startState, step.moves), step.endState, where + ' endState');
  // alg / case / focus / quiz shapes
  if (step.alg) {
    assert.ok(ALG_IDS.includes(step.alg.id), where + ' alg id');
    assert.ok(step.alg.name && step.alg.notation, where + ' alg fields');
    assert.ok(Number.isInteger(step.alg.reps) && step.alg.reps >= 1, where + ' reps');
  } else {
    assert.ok(['rotate', 'intuitive', 'align'].includes(step.kind), where + ' algorithm step without alg');
  }
  if (step.kind === 'repeat' || step.kind === 'algorithm') assert.ok(step.alg, where + ' alg missing');
  if (step.case) { assert.ok(step.case.id && step.case.name, where + ' case'); stats.cases[step.case.id] = (stats.cases[step.case.id] || 0) + 1; }
  assert.ok(Array.isArray(step.focus) && step.focus.length > 0, where + ' focus');
  step.focus.forEach((i) => assert.ok(Number.isInteger(i) && i >= 0 && i < 54, where + ' focus index'));
  if (step.quiz) {
    stats.quizzes++;
    const q = step.quiz;
    assert.ok(q.prompt && q.explain && Array.isArray(q.options) && q.options.length >= 2, where + ' quiz shape');
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, where + ' quiz answer range');
  }
  // rotation discipline
  if (step.kind === 'rotate') {
    assert.ok(ctx.firstStep, where + ' rotate step must be the very first step');
    assert.ok(step.moves.every(isRot), where + ' rotate step has face turns');
    assert.strictEqual(step.endState[4], 'Y', where + ' rotate step must end yellow-up');
  } else {
    assert.strictEqual(step.startState[4], 'Y', where + ' not yellow-up');
    step.moves.filter(isRot).forEach((t) => assert.ok(/^y/.test(t), where + ' only y rotations after the first step: ' + t));
  }
  ctx.firstStep = false;
  if (step.kind !== 'rotate') checkSemantics(step, stage, ctx);
}

function checkSemantics(step, stage, ctx) {
  const s0 = step.startState, s1 = step.endState, where = step.id, q = step.quiz;
  switch (stage.id) {
    case 'daisy':
      assert.ok(['top-flipped', 'middle', 'bottom-white-down', 'bottom-white-side'].includes(step.case.id), where + ' daisy case');
      assert.ok(petals(s1) > petals(s0), where + ' daisy step must add a petal');
      // every petal at the start is still a petal (in the top layer, white up)
      for (let k = 0; k < 4; k++) {
        const st = Cube.EDGES[k].stickers;
        if (s0[st[0]] !== 'W') continue;
        assert.strictEqual(Cube.findEdge(s1, 'W', s0[st[1]]).faces[0], 'U', where + ' knocked a petal off');
      }
      break;
    case 'cross':
      if (step.case.id === 'petal') {
        assert.strictEqual(homeEdges(s1), homeEdges(s0) + 1, where + ' cross step must place one edge');
        assert.deepStrictEqual(step.moves.slice(-1), ['F2'], where + ' cross step ends with F2');
        assert.strictEqual(petals(s1), petals(s0) - 1, where + ' petal not used');
      } else {
        assert.ok(ctx.directCross && /^cross-/.test(step.case.id), where + ' cross case ' + step.case.id);
        assert.ok(homeEdges(s1) > homeEdges(s0), where + ' direct cross step must place an edge (and keep the others)');
        const e = Cube.findEdge(s1, 'W', s1[25]);
        assert.ok(s1[28] === 'W' && s1[25] === s1[22] && e.name === 'DF', where + ' edge must land at the bottom front');
      }
      break;
    case 'corners':
      if (step.case.id === 'corner-stuck') {
        assert.strictEqual(topWhiteCorners(s0), 0, where + ' stuck case with a white corner on top');
        assert.ok(topWhiteCorners(s1) >= 1, where + ' stuck case must lift a corner');
        assert.strictEqual(step.alg.reps, 1);
      } else {
        assert.strictEqual(step.kind, 'repeat');
        assert.strictEqual(solvedDCorners(s1), solvedDCorners(s0) + 1, where + ' corner step must solve one corner');
        assert.strictEqual(homeEdges(s1), 4, where + ' corner step broke the cross');
        const want = { 'corner-white-right': 1, 'corner-white-up': 3, 'corner-white-front': 5 }[step.case.id];
        assert.strictEqual(step.alg.reps, want, where + ' reps for ' + step.case.id);
        assert.strictEqual(q.options[q.answer], String(step.alg.reps), where + ' quiz reps');
        // white direction really is as claimed once lined up: replay the set-up moves
        const setup = step.moves.slice(0, step.moves.length - 4 * step.alg.reps);
        const t = Cube.applyAlg(s0, setup);
        const dir = t[8] === 'W' ? 'up' : t[9] === 'W' ? 'right' : t[20] === 'W' ? 'front' : 'none';
        assert.strictEqual('corner-white-' + dir, step.case.id, where + ' white direction');
      }
      break;
    case 'middle':
      if (step.case.id === 'edge-stuck') {
        assert.strictEqual(topEdgesNoYellow(s0), 0, where + ' stuck case with a usable top edge');
        assert.strictEqual(step.alg.id, 'mid-right');
      } else {
        assert.strictEqual(solvedMidEdges(s1), solvedMidEdges(s0) + 1, where + ' middle step must solve one edge');
        assert.strictEqual(solvedDCorners(s1), 4, where + ' middle step broke the first layer');
        assert.strictEqual(q.options[q.answer], step.alg.id === 'mid-right' ? 'Right' : 'Left', where + ' quiz left/right');
        assert.strictEqual(step.case.id, step.alg.id === 'mid-right' ? 'edge-right' : 'edge-left');
        // the T: before the algorithm the edge is at UF, front colour = front centre, top colour = side centre
        const setup = step.moves.slice(0, step.moves.length - 8), t = Cube.applyAlg(s0, setup);
        assert.strictEqual(t[19], t[22], where + ' not an upside-down T');
        assert.strictEqual(t[7], step.alg.id === 'mid-right' ? t[13] : t[40], where + ' wrong direction');
      }
      break;
    case 'ycross': {
      const sh = shape(s0), sh1 = shape(s1);
      assert.strictEqual(q.options[q.answer], { dot: 'Dot', 'l-shape': 'L-shape', line: 'Line' }[sh], where + ' quiz shape');
      assert.strictEqual(step.case.id, sh);
      const next = { dot: 'l-shape', 'l-shape': 'line', line: 'cross' }[sh];
      assert.strictEqual(sh1, next, where + ` ${sh} should become ${next}, got ${sh1}`);
      assert.ok(step.moves.slice(0, -6).every((t) => base(t) === 'U'), where + ' ycross holding must use U turns only');
      break;
    }
    case 'yedges':
      if (step.case.id === 'edges-adjacent') {
        assert.ok(S.check.yedges(s1), where + ' adjacent case must finish the edges');
        assert.strictEqual(q.options[q.answer], 'Back and right');
        const t = Cube.applyAlg(s0, step.moves.slice(0, -8));
        assert.ok(t[46] === t[49] && t[10] === t[13], where + ' pair not at back and right');
      } else if (step.case.id === 'edges-opposite') {
        assert.strictEqual(q.options[q.answer], 'Opposite each other');
        const t = Cube.applyAlg(s0, step.moves.slice(0, -8));
        const m = [t[46] === t[49], t[37] === t[40], t[10] === t[13], t[19] === t[22]];
        assert.ok((m[0] && m[3] && !m[1] && !m[2]) || (m[1] && m[2] && !m[0] && !m[3]), where + ' not an opposite pair');
      } else {
        assert.strictEqual(step.kind, 'align');
        assert.ok(S.check.yedges(s1), where + ' align must finish');
      }
      assert.ok(S.check.ycross(s1), where + ' yellow cross lost');
      break;
    case 'ycorners': {
      const inPlace = [0, 1, 2, 3].filter((k) => cornerInPlace(s0, k));
      if (q) {
        if (q.answer === 4) assert.strictEqual(inPlace.length, 0, where + ' quiz says none');
        else assert.deepStrictEqual(inPlace, [q.answer], where + ' quiz corner');
      }
      assert.ok(inPlace.length === 0 || inPlace.length === 1, where + ' in-place count');
      const after = [0, 1, 2, 3].filter((k) => cornerInPlace(s1, k)).length;
      assert.ok(after === 1 || after === 4, where + ' after count ' + after);
      assert.ok(S.check.yedges(s1), where + ' edges lost');
      break;
    }
    case 'yorient':
      if (step.kind === 'repeat') {
        assert.strictEqual(s1[8], 'Y', where + ' corner not yellow-up afterwards');
        assert.ok(step.moves.filter(isRot).length === 0 || step.id === 'yorient-1' || (ctx.firstOfStage && step === ctx.firstOfStage), where + ' rotation mid-twist');
        if (q) {
          assert.strictEqual(q.options[q.answer], String(step.alg.reps), where + ' quiz reps');
          const setup = step.moves.slice(0, step.moves.length - 4 * step.alg.reps), t = Cube.applyAlg(s0, setup);
          assert.strictEqual(step.alg.reps, t[9] === 'Y' ? 2 : 4, where + ' twist reps vs yellow direction');
        }
      } else {
        assert.strictEqual(step.kind, 'align');
        assert.ok(Cube.isSolved(s1), where + ' final align must solve');
      }
      break;
    default:
      throw new Error('unknown stage ' + stage.id);
  }
}

function verifySolution(start, sol, opts) {
  assert.deepStrictEqual(sol.start, start, 'start');
  assert.deepStrictEqual(Cube.applyAlg(start, sol.moves), sol.end, 'moves -> end');
  assert.ok(Cube.isSolved(sol.end), 'end not solved');
  assert.strictEqual(sol.moveCount, faceTurns(sol.moves), 'moveCount');
  assert.deepStrictEqual(sol.stages.map((s) => s.id), IDS, 'stage ids');
  const all = [];
  let state = start;
  const ctx = { firstStep: true, directCross: !!(opts && opts.directCross) };
  let lastProgress = -1;
  sol.stages.forEach((stage, si) => {
    assert.deepStrictEqual(stage.startState, state, stage.id + ' startState');
    assert.strictEqual(stage.skipped, stage.steps.length === 0, stage.id + ' skipped flag');
    if (stage.id === 'yorient') ctx.firstOfStage = stage.steps.find((st) => st.kind !== 'rotate');
    stage.steps.forEach((step, k) => {
      checkStep(step, stage, k, state, ctx);
      state = step.endState;
      all.push(...step.moves);
    });
    assert.deepStrictEqual(stage.endState, state, stage.id + ' endState');
    if (!stage.skipped) {
      for (let j = 0; j <= si; j++) assert.ok(S.check[IDS[j]](stage.endState), `${IDS[j]} check fails at end of ${stage.id}`);
      const p = S.progress(stage.endState).index;
      assert.ok(p > si && p > lastProgress, `progress must move forward after ${stage.id}`);
      lastProgress = p;
    }
  });
  assert.deepStrictEqual(all, sol.moves, 'steps concatenate to moves');
  // daisy is skipped exactly when the cross was already there (or petals/home edges complete)
  if (S.check.cross(start)) assert.ok(sol.stages[0].skipped && sol.stages[1].skipped, 'daisy/cross not skipped');
  if (ctx.directCross) assert.ok(sol.stages[0].skipped, 'directCross must skip the daisy');
  // the yorient stage never rotates the cube after its first step
  const yo = sol.stages[7].steps.filter((st) => st.kind !== 'rotate');
  yo.slice(1).forEach((st) => assert.ok(!st.moves.some(isRot), st.id + ' rotates the cube mid-twist'));
}

// ------------------------------------------------------------------ tests
test('STAGES table matches the architecture', () => {
  assert.deepStrictEqual(S.STAGES.map((s) => s.id), IDS);
  S.STAGES.forEach((s) => {
    assert.ok(s.name && s.short && s.goal, s.id);
    assert.ok(s.algorithm === null || ALG_IDS.includes(s.algorithm), s.id);
  });
  assert.deepStrictEqual(S.STAGES.map((s) => s.algorithm), [null, null, 'rtrigger', 'mid-right', 'ycross', 'sune', 'corner-cycle', 'twist']);
  ALG_IDS.forEach((id) => assert.ok(S.ALGS[id] && S.ALGS[id].notation, id));
});

test('algorithm facts the teaching relies on (simulation)', () => {
  // Sune + U swaps only the front and left top edges
  const p = Cube.algPerm("R U R' U R U2 R' U");
  const movedEdges = Cube.EDGES.filter((e) => e.stickers.some((i) => p[i] !== i)).map((e) => e.name).sort();
  assert.deepStrictEqual(movedEdges, ['UF', 'UL']);
  // corner cycle keeps URF and all edges
  const q = Cube.algPerm("U R U' L' U R' U' L");
  assert.ok([8, 9, 20].every((i) => q[i] === i));
  assert.ok(Cube.EDGES.every((e) => e.stickers.every((i) => q[i] === i)));
  // R' D' R D six times = identity, fewer never restores the lower layers
  assert.deepStrictEqual(Cube.applyAlg(LEARN, Array(6).fill("R' D' R D").join(' ')), LEARN);
  // R U R' U' keeps the cross and every other bottom corner
  const r = Cube.applyAlg(LEARN, "R U R' U'");
  [28, 30, 32, 34, 25, 16, 43, 52, 27, 33, 35].forEach((i) => assert.strictEqual(r[i], LEARN[i]));
});

test('solved cube in all 24 orientations -> no moves, all stages skipped', () => {
  assert.strictEqual(ROT24.length, 24);
  ROT24.forEach((rot) => {
    const s = Cube.applyAlg(SOLVED, rot);
    const sol = S.solve(s);
    assert.deepStrictEqual(sol.moves, []);
    assert.strictEqual(sol.moveCount, 0);
    assert.ok(sol.stages.every((st) => st.skipped && st.steps.length === 0));
    assert.strictEqual(S.nextStep(s), null);
    const p = S.progress(s);
    assert.strictEqual(p.index, 8); assert.strictEqual(p.id, 'solved'); assert.deepStrictEqual(p.done, IDS);
    IDS.forEach((id) => assert.ok(S.check[id](s), id));
  });
});

test('one-move-from-solved cubes, held any way up', () => {
  const s = Cube.applyAlg(LEARN, 'U');
  const sol = S.solve(s);
  assert.deepStrictEqual(sol.moves, ["U'"]);
  verifySolution(s, sol);
  const s2 = Cube.applyAlg(Cube.applyAlg(SOLVED, 'D'), 'x');  // white-top frame, yellow layer turned, held oddly
  const sol2 = S.solve(s2);
  verifySolution(s2, sol2);
  assert.strictEqual(sol2.stages.find((st) => !st.skipped).steps[0].kind, 'rotate');
});

test('invalid cubes are rejected with a friendly error', () => {
  const bad = SOLVED.slice(); bad[0] = 'R'; bad[9] = 'W';
  assert.throws(() => S.solve(bad), /can't be solved/);
  const twisted = Cube.applyAlg(SOLVED, 'R U');
  const t2 = twisted.slice(); [t2[8], t2[9], t2[20]] = [t2[9], t2[20], t2[8]];
  assert.throws(() => S.solve(t2), (e) => e.validation && !e.validation.ok);
});

let randomSolutions = [];
test(`${N_RANDOM} random scrambles in random orientations: all invariants`, () => {
  const rnd = Cube.mulberry32(20261002);
  for (let i = 0; i < N_RANDOM; i++) {
    const rot = ROT24[Math.floor(rnd() * 24)];
    const s = Cube.applyAlg(Cube.applyAlg(SOLVED, Cube.scramble(25, 1000 + i)), rot);
    const t0 = process.hrtime.bigint();
    const sol = S.solve(s);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.solves++; stats.ms += ms; stats.maxMs = Math.max(stats.maxMs, ms);
    stats.faceTurns += sol.moveCount; stats.maxTurns = Math.max(stats.maxTurns, sol.moveCount);
    stats.steps += sol.stages.reduce((n, st) => n + st.steps.length, 0);
    try { verifySolution(s, sol); } catch (e) { e.message = `scramble #${i} (${Cube.scramble(25, 1000 + i).join(' ')} / ${rot.join(' ')}): ` + e.message; throw e; }
    if (i < 300) randomSolutions.push({ s, sol });
  }
});

test('check[] is orientation independent', () => {
  const rnd = Cube.mulberry32(77);
  randomSolutions.slice(0, 150).forEach(({ sol }) => {
    sol.stages.forEach((stage) => {
      const st = stage.endState, rot = ROT24[Math.floor(rnd() * 24)], r = Cube.applyAlg(st, rot);
      IDS.forEach((id) => assert.strictEqual(S.check[id](r), S.check[id](st), id + ' changes with orientation'));
      assert.strictEqual(S.progress(r).index, S.progress(st).index);
    });
  });
});

test('check[] is cumulative (a later stage implies every earlier one)', () => {
  randomSolutions.slice(0, 200).forEach(({ sol }) => {
    sol.stages.forEach((stage) => stage.steps.forEach((step) => {
      const c = IDS.map((id) => S.check[id](step.endState));
      for (let j = 1; j < 8; j++) if (c[j]) assert.ok(c[j - 1], `${IDS[j]} true but ${IDS[j - 1]} false`);
    }));
  });
});

test('nextStep() = first step of solve(); re-solving at any step boundary gives the same remaining moves', () => {
  randomSolutions.slice(0, 200).forEach(({ s, sol }) => {
    const steps = [].concat(...sol.stages.map((st) => st.steps));
    const first = S.nextStep(s);
    assert.deepStrictEqual(first.moves, steps[0].moves);
    assert.strictEqual(first.id, steps[0].id);
    let done = 0;
    steps.forEach((step, k) => {
      done += step.moves.length;
      const again = S.solve(step.endState);
      assert.deepStrictEqual(again.moves, sol.moves.slice(done), `re-solve after ${step.id} differs`);
      const nx = S.nextStep(step.endState);
      if (k + 1 < steps.length) {
        assert.strictEqual(nx.stage, steps[k + 1].stage, `stage after ${step.id}`);
        assert.strictEqual(S.progress(step.endState).id, steps[k + 1].stage, `progress after ${step.id}`);
      } else assert.strictEqual(nx, null);
    });
  });
});

test('cross already done -> daisy (and cross) skipped, in any orientation', () => {
  const rnd = Cube.mulberry32(5);
  for (let i = 0; i < 300; i++) {
    const d = S.drillScramble(IDS[2 + (i % 6)], i);
    const s = Cube.applyAlg(d.state, ROT24[Math.floor(rnd() * 24)]);
    const sol = S.solve(s);
    verifySolution(s, sol);
    assert.ok(sol.stages[0].skipped && sol.stages[1].skipped, 'daisy not skipped');
    assert.ok(S.check.daisy(s) && S.check.cross(s));
  }
});

test('mid-cross: placed edges stay, the daisy is not rebuilt', () => {
  randomSolutions.slice(0, 200).forEach(({ sol }) => {
    const cross = sol.stages[1].steps;
    if (cross.length < 2) return;
    const mid = cross[0].endState;
    assert.strictEqual(S.progress(mid).id, 'cross');
    const nx = S.nextStep(mid);
    assert.strictEqual(nx.stage, 'cross');
  });
});

test('mid-twist (lower layers scrambled during yellow corner twisting) resumes the twist stage', () => {
  let seen = 0;
  randomSolutions.slice(0, 300).forEach(({ sol }) => {
    const yo = sol.stages[7].steps;
    yo.forEach((step) => {
      if (Cube.isSolved(step.endState)) return;
      // also from the middle of a repeat (after each full R' D' R D)
      if (step.kind === 'repeat') {
        const setupLen = step.moves.length - 4 * step.alg.reps;
        for (let r = 1; r < step.alg.reps; r++) {
          const st = Cube.applyAlg(step.startState, step.moves.slice(0, setupLen + 4 * r));
          const p = S.progress(st);
          assert.strictEqual(p.id, 'yorient', 'progress mid-repeat');
          const sol2 = S.solve(st);
          assert.ok(sol2.stages.slice(0, 7).every((x) => x.skipped));
          const nx = sol2.stages[7].steps[0];
          assert.strictEqual(nx.alg.id, 'twist');
          assert.strictEqual(nx.alg.reps, step.alg.reps - r, 'remaining reps');
          assert.ok(!nx.moves.some(isRot), 'no rotation when resuming');
          seen++;
        }
      }
      const p = S.progress(step.endState);
      assert.strictEqual(p.id, 'yorient');
    });
  });
  assert.ok(seen > 100, 'mid-repeat states tested: ' + seen);
  // the user spins the cube mid-twist: the solver turns it back first
  const { sol } = randomSolutions.find(({ sol }) => sol.stages[7].steps.length >= 3);
  const st = Cube.applyAlg(sol.stages[7].steps[0].endState, 'y');
  const sol2 = S.solve(st);
  verifySolution(st, sol2);
  assert.ok(sol2.resumedMidTwist);
  assert.deepStrictEqual(sol2.stages[7].steps[0].segments[0].moves, ["y'"]);
});

test('drillScramble: every stage, face moves only, earlier stages solved, target unsolved, deterministic', () => {
  IDS.forEach((id, k) => {
    for (let seed = 0; seed < 150; seed++) {
      const d = S.drillScramble(id, seed);
      assert.strictEqual(d.holding, 'Yellow on top, green in front');
      assert.ok(d.scramble.length > 0);
      d.scramble.forEach((t) => assert.ok(/^[URFDLB](2|')?$/.test(t), id + ' non-face move ' + t));
      for (let i = 1; i < d.scramble.length; i++) assert.notStrictEqual(base(d.scramble[i]), base(d.scramble[i - 1]));
      const st = Cube.applyAlg(LEARN, d.scramble);
      assert.deepStrictEqual(d.state, st, 'state = scramble applied to the yellow-up/green-front solved cube');
      assert.strictEqual(st[4], 'Y'); assert.strictEqual(st[22], 'G');
      assert.ok(Cube.validate(st).ok);
      for (let j = 0; j < k; j++) assert.ok(S.check[IDS[j]](st), `${id} drill: ${IDS[j]} should be solved`);
      assert.ok(!S.check[id](st), `${id} drill: target already solved`);
      assert.strictEqual(S.progress(st).id, id);
      const sol = S.solve(st);
      verifySolution(st, sol);
      assert.ok(!sol.stages[k].skipped, id + ' drill stage skipped');
      if (seed < 3) assert.deepStrictEqual(S.drillScramble(id, seed), d, 'deterministic');
    }
  });
  assert.ok(S.drillScramble('middle').scramble.length > 0, 'random seed works');
  assert.throws(() => S.drillScramble('nope', 1));
});

test('drills reach the interesting cases', () => {
  const cases = {};
  IDS.slice(2).forEach((id) => {
    for (let seed = 0; seed < 200; seed++) {
      const sol = S.solve(S.drillScramble(id, seed).state);
      sol.stages.forEach((st) => st.steps.forEach((sp) => { if (sp.case) cases[sp.case.id] = true; }));
    }
  });
  ['corner-white-right', 'corner-white-up', 'corner-white-front', 'corner-stuck', 'edge-right', 'edge-left', 'edge-stuck',
    'dot', 'l-shape', 'line', 'edges-adjacent', 'edges-opposite', 'corners-none', 'corners-one', 'yellow-right', 'yellow-front']
    .forEach((c) => assert.ok(cases[c], 'never saw case ' + c));
});

test('every case seen across the random solves', () => {
  ['top-flipped', 'middle', 'bottom-white-down', 'bottom-white-side', 'petal', 'corner-white-right', 'corner-white-up',
    'corner-white-front', 'edge-right', 'edge-left', 'dot', 'l-shape', 'line', 'edges-adjacent', 'edges-opposite',
    'corners-none', 'corners-one', 'yellow-right', 'yellow-front']
    .forEach((c) => assert.ok(stats.cases[c], 'never saw case ' + c));
});

test('opts.directCross: daisy skipped, edges go straight into the cross, all invariants', () => {
  const rnd = Cube.mulberry32(99);
  let turns = 0, ms = 0;
  for (let i = 0; i < 1000; i++) {
    const s = Cube.applyAlg(Cube.applyAlg(SOLVED, Cube.scramble(25, 50000 + i)), ROT24[Math.floor(rnd() * 24)]);
    const t0 = process.hrtime.bigint();
    const sol = S.solve(s, { directCross: true });
    ms += Number(process.hrtime.bigint() - t0) / 1e6;
    verifySolution(s, sol, { directCross: true });
    turns += faceTurns([].concat(...sol.stages[1].steps.map((st) => st.moves)));
    const steps = [].concat(...sol.stages.map((st) => st.steps));
    if (i < 100) {
      let done = 0;
      steps.forEach((step) => { done += step.moves.length; assert.deepStrictEqual(S.solve(step.endState, { directCross: true }).moves, sol.moves.slice(done)); });
      assert.deepStrictEqual(S.nextStep(s, { directCross: true }).moves, steps[0].moves);
    }
    steps.filter((st) => st.stage === 'cross' && st.kind !== 'rotate').forEach((st) => { stats.cases[st.case.id] = true; });
  }
  ['cross-top-white-up', 'cross-top-flipped', 'cross-middle', 'cross-bottom'].forEach((c) => assert.ok(stats.cases[c], 'never saw ' + c));
  stats.directCross = { turns: turns / 1000, ms: ms / 1000 };
  assert.ok(ms / 1000 < 30);
});

// ------------------------------------------------------------------ review regressions
// An independent re-implementation of every check[], with no cube rotation: pure geometry
// relative to whichever face holds each centre.
const FACE_OF = (i) => Cube.STICKERS[i].face;
const cenAt = (s, f) => s['URFDLB'.indexOf(f) * 9 + 4];
const faceWith = (s, c) => 'URFDLB'.split('').find((f) => cenAt(s, f) === c);
const ALL_PIECES = Cube.EDGES.map((e) => e.stickers).concat(Cube.CORNERS.map((c) => c.stickers));
function independentChecks(s) {
  const top = faceWith(s, 'Y'), bot = faceWith(s, 'W');
  const ok = (st) => st.every((i) => s[i] === cenAt(s, FACE_OF(i)));
  const touches = (st, f) => st.some((i) => FACE_OF(i) === f);
  const white = Cube.EDGES.map((e) => e.stickers).filter((st) => st.some((i) => s[i] === 'W'));
  const petal = (st) => st.some((i) => s[i] === 'W' && FACE_OF(i) === top);
  const home = (st) => ok(st) && st.some((i) => s[i] === 'W' && FACE_OF(i) === bot);
  const L1 = ALL_PIECES.filter((st) => touches(st, bot)).every(ok);
  const L2 = ALL_PIECES.filter((st) => !touches(st, bot) && !touches(st, top)).every(ok);
  const tEdges = Cube.EDGES.map((e) => e.stickers).filter((st) => touches(st, top));
  const tCorners = Cube.CORNERS.map((c) => c.stickers).filter((st) => touches(st, top));
  const yc = tEdges.every((st) => st.some((i) => FACE_OF(i) === top && s[i] === 'Y'));
  const ye = tEdges.every(ok);
  const yp = tCorners.every((st) => st.map((i) => s[i]).sort().join('') === st.map((i) => cenAt(s, FACE_OF(i))).sort().join(''));
  return [white.every((st) => petal(st) || home(st)), white.every(home), L1 && white.every(home), L1 && L2,
    L1 && L2 && yc, L1 && L2 && yc && ye, L1 && L2 && yc && ye && yp, Cube.isSolved(s)];
}
const lowerLayersOk = (s) => independentChecks(s)[3];

test('check[] agrees with an independent implementation (step boundaries, mid-step states, any orientation)', () => {
  let n = 0;
  randomSolutions.slice(0, 120).forEach(({ s, sol }, k) => {
    const states = [s];
    sol.stages.forEach((st) => st.steps.forEach((sp) => {
      states.push(sp.endState);
      for (let m = 1; m < sp.moves.length; m += 3) states.push(Cube.applyAlg(sp.startState, sp.moves.slice(0, m)));
    }));
    states.forEach((st, j) => {
      const r = Cube.applyAlg(st, ROT24[(k + j) % 24]), want = independentChecks(r);
      IDS.forEach((id, i) => assert.strictEqual(S.check[id](r), want[i], `check.${id} (solve ${k}, state ${j})`));
      n++;
    });
  });
  assert.ok(n > 5000, 'states compared: ' + n);
  // not a cube: no throw
  [null, undefined, [], SOLVED.slice(0, 50)].forEach((bad) => {
    IDS.forEach((id) => assert.strictEqual(S.check[id](bad), false));
    assert.strictEqual(S.progress(bad).index, 0);
  });
});

test('any mid-step state (the learner stopped part-way through a step) still solves with every invariant', () => {
  let n = 0;
  randomSolutions.slice(0, 40).forEach(({ sol }) => {
    sol.stages.forEach((st) => st.steps.forEach((sp) => {
      for (let m = 1; m < sp.moves.length; m++) {
        const mid = Cube.applyAlg(sp.startState, sp.moves.slice(0, m));
        verifySolution(mid, S.solve(mid));
        n++;
      }
    }));
  });
  assert.ok(n > 3000, 'mid-step states: ' + n);
});

// Collects every yorient step reached from the random solves, from resumed mid-twist states,
// and from states where only the top layer is turned.
function yorientRuns() {
  const runs = [];
  randomSolutions.slice(0, 300).forEach(({ sol }) => {
    runs.push(sol.stages[7]);
    sol.stages[7].steps.forEach((sp) => {
      if (sp.kind !== 'repeat') return;
      const setupLen = sp.moves.length - 4 * sp.alg.reps;
      for (let r = 1; r < sp.alg.reps; r++) runs.push(S.solve(Cube.applyAlg(sp.startState, sp.moves.slice(0, setupLen + 4 * r))).stages[7]);
      runs.push(S.solve(Cube.applyAlg(sp.startState, sp.moves.slice(0, setupLen))).stages[7]);
    });
  });
  for (let seed = 0; seed < 150; seed++) {
    const d = S.drillScramble('yorient', seed);
    ['U', "U'", 'U2'].forEach((u) => runs.push(S.solve(Cube.applyAlg(d.state, u)).stages[7]));
  }
  ['U', "U'", 'U2'].forEach((u) => runs.push(S.solve(Cube.applyAlg(LEARN, u)).stages[7]));   // only the top is turned
  return runs;
}

test('yorient explanations are true for the state they describe', () => {
  const seen = {};
  yorientRuns().forEach((stage) => {
    let twisted = false;
    stage.steps.forEach((sp) => {
      if (sp.kind === 'rotate') return;
      const s0 = sp.startState, scrambled = !lowerLayersOk(s0);
      if (scrambled) twisted = true;
      const where = sp.id + ': ' + sp.explain;
      if (/look scrambled right now/.test(sp.explain)) { assert.ok(scrambled, where); seen.now = 1; }
      if (/will look scrambled while you do this/.test(sp.explain)) { assert.ok(!scrambled, where); seen.soon = 1; }
      if (/have fixed themselves/.test(sp.explain)) { assert.ok(twisted, where); seen.fixed = 1; }
      if (/only the top layer is turned/.test(sp.explain)) { assert.ok(!twisted && !scrambled, where); seen.onlyTop = 1; }
      const turnsTop = sp.moves.some((t) => /^U/.test(t));
      if (/Turn only the top layer/.test(sp.explain)) assert.ok(turnsTop, where);
      if (/still needs twisting|is twisted, so repeat/.test(sp.explain)) { assert.ok(!turnsTop, where); seen.noTurn = 1; }
      if (/relative to the others/.test(sp.explain)) {
        assert.ok(['U', "U'", 'U2'].some((u) => S.check.ycorners(Cube.applyAlg(s0, u))) && !S.check.ycorners(s0), where);
        seen.relative = 1;
      }
      if (sp.kind === 'repeat') {
        twisted = true;
        // focus = the yellow corner that ends up yellow-side up at the top front-right
        const after = sp.endState, cols = sp.focus.map((i) => s0[i]).sort().join('');
        assert.strictEqual(sp.focus.length, 3, where);
        assert.ok(cols.includes('Y'), where + ' focus is not a yellow corner');
        assert.strictEqual([8, 9, 20].map((i) => after[i]).sort().join(''), cols, where + ' focus is not the twisted corner');
        if (sp.case.id === 'twist-continue') {
          seen.cont = 1;
          assert.ok(/^Keep twisting the yellow–/.test(sp.title), sp.title);
          const setup = sp.moves.slice(0, sp.moves.length - 4 * sp.alg.reps), t = Cube.applyAlg(s0, setup);
          assert.strictEqual([29, 26, 15].map((i) => t[i]).sort().join(''), cols, where + ' corner not at the bottom front-right');
        }
      }
    });
  });
  ['now', 'soon', 'fixed', 'onlyTop', 'noTurn', 'relative', 'cont'].forEach((k) => assert.ok(seen[k], 'never saw explanation kind ' + k));
});

test('daisy steps that knock a solved white edge off the bottom say so', () => {
  let knocks = 0;
  const check = (sol) => sol.stages[0].steps.forEach((sp) => {
    if (sp.kind === 'rotate') return;
    const lost = homeEdges(sp.endState) < homeEdges(sp.startState);
    if (lost) { knocks++; assert.ok(/knocks the white–/.test(sp.explain) && !/can stay where they are/.test(sp.explain), sp.explain); }
    else assert.ok(!/knocks the white–/.test(sp.explain), sp.explain);
  });
  randomSolutions.forEach(({ sol }) => check(sol));
  for (let i = 0; i < 300; i++) {   // part-built crosses (from direct-cross steps) solved the daisy way
    const s = Cube.applyAlg(SOLVED, Cube.scramble(25, 60000 + i));
    S.solve(s, { directCross: true }).stages[1].steps.forEach((sp) => { const sol = S.solve(sp.endState); verifySolution(sp.endState, sol); check(sol); });
  }
  assert.ok(knocks > 20, 'knock cases seen: ' + knocks);
});

test('directCross explanations use the right grammar', () => {
  for (let i = 0; i < 200; i++) {
    const sol = S.solve(Cube.applyAlg(SOLVED, Cube.scramble(25, 70000 + i)), { directCross: true });
    sol.stages[1].steps.forEach((sp) => assert.ok(!/ 1 turn bring | turns brings /.test(sp.explain), sp.explain));
  }
});

test('drill scrambles are short enough to apply by hand', () => {
  IDS.forEach((id) => {
    let total = 0;
    for (let seed = 0; seed < 100; seed++) {
      const n = S.drillScramble(id, seed).scramble.length;
      assert.ok(n <= 60, id + ' drill scramble has ' + n + ' moves');
      total += n;
    }
    assert.ok(total / 100 <= 50, id + ' average drill length ' + total / 100);
  });
});

test('performance: solve() averages < 30 ms', () => {
  assert.ok(stats.ms / stats.solves < 30, 'avg ' + (stats.ms / stats.solves).toFixed(2) + ' ms');
});

console.log(`${passed} solver tests passed` + (process.exitCode ? ' (with failures above)' : ''));
console.log(`  ${stats.solves} random solves: avg ${(stats.faceTurns / stats.solves).toFixed(1)} face turns (max ${stats.maxTurns}), ` +
  `avg ${(stats.ms / stats.solves).toFixed(3)} ms (max ${stats.maxMs.toFixed(2)} ms), avg ${(stats.steps / stats.solves).toFixed(1)} steps, ${stats.quizzes} quizzes checked`);
if (stats.directCross) console.log(`  directCross: avg ${stats.directCross.turns.toFixed(1)} cross face turns, avg ${stats.directCross.ms.toFixed(3)} ms per solve`);
