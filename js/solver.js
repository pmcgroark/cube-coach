/* Cube Coach — beginner's-method solver and teacher (CC.Solver).
 *
 * Solves any legal cube exactly the way a beginner following the "daisy"
 * layer-by-layer method would, holding YELLOW ON TOP for the whole solve, and
 * explains every step in plain English (see ARCHITECTURE.md for the contract).
 *
 * Facts the teaching relies on were proved by simulation with CC.Cube and are
 * re-checked by tests/solver.test.js:
 *   - R U R' U' with the white corner at the top front-right drops it into the
 *     slot below after 1 (white facing right), 3 (white up) or 5 (white facing you) goes.
 *   - R' D' R D turns the front-right top corner yellow-up after 2 goes
 *     (yellow facing right) or 4 goes (yellow facing you); six goes restore the
 *     lower layers, so they fix themselves once every corner is done.
 *   - F R U R' U' F': dot -> L (front-right); L held back-left -> horizontal line;
 *     horizontal line -> cross.
 *   - R U R' U R U2 R' U with the matching edges at the back and right swaps the
 *     front and left edges (so all four match).
 *   - U R U' L' U R' U' L keeps the top front-right corner still and cycles the other three.
 *
 * Classic script: attaches to window.CC.Solver and module.exports. CC.Cube is
 * looked up lazily at call time (in node it is required on demand).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ static data
  var STAGES = [
    { id: 'daisy', name: 'The Daisy', short: 'Daisy',
      goal: 'Four white edges around the yellow centre, white stickers facing up.', algorithm: null, algorithms: [] },
    { id: 'cross', name: 'White Cross', short: 'Cross',
      goal: 'Four white edges on the bottom, each side colour matching its centre.', algorithm: null, algorithms: [] },
    { id: 'corners', name: 'White Corners', short: 'Corners',
      goal: 'The whole white (bottom) layer solved.', algorithm: 'rtrigger', algorithms: ['rtrigger'] },
    { id: 'middle', name: 'Middle Layer', short: 'Middle',
      goal: 'The first two layers solved.', algorithm: 'mid-right', algorithms: ['mid-right', 'mid-left'] },
    { id: 'ycross', name: 'Yellow Cross', short: 'Yellow cross',
      goal: 'First two layers solved plus a yellow cross on top.', algorithm: 'ycross', algorithms: ['ycross'] },
    { id: 'yedges', name: 'Yellow Edges', short: 'Yellow edges',
      goal: 'Yellow cross with every top edge matching the centre below it.', algorithm: 'sune', algorithms: ['sune'] },
    { id: 'ycorners', name: 'Yellow Corners: Position', short: 'Corner spots',
      goal: 'Every top corner in its correct spot (it may still be twisted).', algorithm: 'corner-cycle', algorithms: ['corner-cycle'] },
    { id: 'yorient', name: 'Yellow Corners: Twist', short: 'Corner twist',
      goal: 'The whole cube solved.', algorithm: 'twist', algorithms: ['twist'] }
  ];
  var STAGE_IDS = STAGES.map(function (s) { return s.id; });

  // `moves` is what the solver actually performs for the algorithm.
  var ALGS = {
    'rtrigger': { id: 'rtrigger', name: 'Right trigger', notation: "R U R' U'", moves: "R U R' U'" },
    'mid-right': { id: 'mid-right', name: 'Middle edge — right', notation: "U R U' R' U' F' U F", moves: "U R U' R' U' F' U F" },
    'mid-left': { id: 'mid-left', name: 'Middle edge — left', notation: "U' L' U L U F U' F'", moves: "U' L' U L U F U' F'" },
    'ycross': { id: 'ycross', name: 'Yellow cross', notation: "F R U R' U' F'", moves: "F R U R' U' F'" },
    'sune': { id: 'sune', name: 'Sune', notation: "R U R' U R U2 R' U", moves: "R U R' U R U2 R' U" },
    'corner-cycle': { id: 'corner-cycle', name: 'Corner cycle', notation: "U R U' L' U R' U' L", moves: "U R U' L' U R' U' L" },
    'twist': { id: 'twist', name: 'Corner twist', notation: "R' D' R D", moves: "R' D' R D" }
  };

  var CASES = {
    'top-flipped': 'On top, white facing sideways',
    'middle': 'In the middle layer',
    'bottom-white-down': 'On the bottom, white facing down',
    'bottom-white-side': 'On the bottom, white facing sideways',
    'petal': 'Petal ready to drop',
    'cross-top-white-up': 'On top, white facing up',
    'cross-top-flipped': 'On top, white facing sideways',
    'cross-middle': 'In the middle layer',
    'cross-bottom': 'On the bottom in the wrong spot or flipped',
    'corner-white-right': 'White sticker facing right',
    'corner-white-front': 'White sticker facing you',
    'corner-white-up': 'White sticker facing up',
    'corner-stuck': 'White corner stuck in the bottom layer',
    'edge-right': 'Edge goes to the right',
    'edge-left': 'Edge goes to the left',
    'edge-stuck': 'Edge stuck in the wrong middle slot',
    'dot': 'Dot',
    'l-shape': 'L-shape',
    'line': 'Line',
    'edges-adjacent': 'Two neighbouring edges match',
    'edges-opposite': 'Two opposite edges match',
    'edges-aligned': 'Edges just need lining up',
    'corners-none': 'No corner in its spot',
    'corners-one': 'One corner in its spot',
    'yellow-right': 'Yellow sticker facing right',
    'yellow-front': 'Yellow sticker facing you',
    'twist-continue': 'Corner half-way through twisting',
    'top-aligned': 'Top layer just needs lining up'
  };

  var HOLDING = 'Yellow on top, green in front';
  var U_TURNS = [[], ['U'], ["U'"], ['U2']];          // cheapest first
  var Y_TURNS = [[], ['y'], ["y'"], ['y2']];
  var Y_TO_FRONT = { F: [], R: ['y'], L: ["y'"], B: ['y2'] };
  var ROT_TO_URF = [[], ["y'"], ['y2'], ['y']];        // U corner position 0..3 (URF UFL ULB UBR) -> URF
  var ROT_TO_DFR = [[], ["y'"], ['y2'], ['y']];        // D corner position 4..7 (DFR DLF DBL DRB) -> DFR
  var ROT_TO_FR = [[], ["y'"], ['y2'], ['y']];         // middle edge position 8..11 (FR FL BL BR) -> FR
  var U_CORNER_SPOT = ['front-right', 'front-left', 'back-left', 'back-right'];
  var YCORNER_OPTIONS = ['Front-right', 'Front-left', 'Back-left', 'Back-right', 'None of them'];
  var SHAPE_OPTIONS = ['Dot', 'L-shape', 'Line', 'Cross'];
  var SLOT_NAME = { 7: 'top-front', 5: 'top-right', 3: 'top-left', 1: 'top-back' };

  // Sticker/centre pairs (yellow-up frame) that must match for each layer goal.
  var LIST_L1 = [27, 31, 28, 31, 29, 31, 30, 31, 32, 31, 33, 31, 34, 31, 35, 31,
    15, 13, 16, 13, 17, 13, 24, 22, 25, 22, 26, 22, 42, 40, 43, 40, 44, 40, 51, 49, 52, 49, 53, 49];
  var LIST_L2 = [12, 13, 14, 13, 21, 22, 23, 22, 39, 40, 41, 40, 48, 49, 50, 49];
  var LIST_YC = [1, 4, 3, 4, 5, 4, 7, 4];
  var LIST_YE = [10, 13, 19, 22, 37, 40, 46, 49];
  var U_CORNERS = [[8, 9, 20, 4, 13, 22], [6, 18, 38, 4, 22, 40], [0, 36, 47, 4, 40, 49], [2, 45, 11, 4, 49, 13]];

  // ------------------------------------------------------------------ lazy setup
  var C = null, PERM, STK, EDGES, CORNERS, CNAME, YUP_PERM, ALG_TOK = {}, TWIST, LEARN;

  function lib() {
    if (C) return C;
    var c = root.CC && root.CC.Cube;
    if (!c && typeof require === 'function') {
      try { require('./cube.js'); } catch (e) { /* not in node */ }
      c = root.CC && root.CC.Cube;
    }
    if (!c) throw new Error('CC.Solver needs CC.Cube — load js/cube.js first.');
    PERM = c.PERM; STK = c.STICKERS; EDGES = c.EDGES; CORNERS = c.CORNERS; CNAME = c.COLOR_NAME;
    Object.keys(ALGS).forEach(function (id) { ALG_TOK[id] = c.parseAlg(ALGS[id].moves); });
    TWIST = ALG_TOK.twist;
    YUP_PERM = { D: c.algPerm('x2'), F: c.algPerm('x'), B: c.algPerm("x'"), R: c.algPerm("z'"), L: c.algPerm('z') };
    LEARN = c.applyAlg(c.solved(), 'z2');
    C = c;
    return c;
  }

  // ------------------------------------------------------------------ small helpers
  function ap(s, toks) {
    for (var t = 0; t < toks.length; t++) {
      var p = PERM[toks[t]], o = new Array(54);
      for (var i = 0; i < 54; i++) o[p[i]] = s[i];
      s = o;
    }
    return s;
  }
  function applyPerm(s, p) { var o = new Array(54); for (var i = 0; i < 54; i++) o[p[i]] = s[i]; return o; }
  function after(index, toks) { for (var t = 0; t < toks.length; t++) index = PERM[toks[t]][index]; return index; }
  function repeat(toks, n) { var out = []; for (var i = 0; i < n; i++) out = out.concat(toks); return out; }
  function invertY(toks) { return toks.slice().reverse().map(function (t) { return t.slice(-1) === "'" ? t.slice(0, -1) : t.slice(-1) === '2' ? t : t + "'"; }); }
  function okList(s, list) { for (var i = 0; i < list.length; i += 2) if (s[list[i]] !== s[list[i + 1]]) return false; return true; }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) === -1) return false;
    return true;
  }
  function faceOfCentre(s, colour) {
    var f = 'URFDLB';
    for (var i = 0; i < 6; i++) if (s[i * 9 + 4] === colour) return f[i];
    return null;
  }
  function cn(c) { return CNAME[c] || c; }
  function CN(c) { return cn(c).toUpperCase(); }
  function pieceName(cols) { return cols.map(cn).join('–'); }
  function countFaceTurns(moves) { var n = 0; for (var i = 0; i < moves.length; i++) if (!/^[xyz]/.test(moves[i])) n++; return n; }
  function algRef(id, reps) { var a = ALGS[id]; return { id: id, name: a.name, notation: a.notation, reps: reps || 1 }; }
  function caseRef(id) { return { id: id, name: CASES[id] }; }
  function repSegs(id, reps) {
    var segs = [];
    for (var r = 1; r <= reps; r++) {
      segs.push({ label: ALGS[id].notation + (reps > 1 ? ' (' + r + ' of ' + reps + ')' : ''), moves: ALG_TOK[id].slice() });
    }
    return segs;
  }
  function edgeFocus(s, a, b) { var e = C.findEdge(s, a, b); return e ? e.stickers.slice() : []; }
  function cornerFocus(s, cols) { var k = C.findCorner(s, cols[0], cols[1], cols[2]); return k ? k.stickers.slice() : []; }
  function cornerPos(s, cols) {
    for (var k = 0; k < 8; k++) {
      var st = CORNERS[k].stickers;
      if (sameSet([s[st[0]], s[st[1]], s[st[2]]], cols)) return k;
    }
    return -1;
  }

  // Bring the yellow centre on top (only x/z — the y-orientation is irrelevant to every check).
  function yellowUp(state) {
    if (!state || state.length !== 54) return null;   // not a cube (e.g. a half-finished scan)
    if (state[4] === 'Y') return state;
    var f = faceOfCentre(state, 'Y');
    return f ? applyPerm(state, YUP_PERM[f]) : null;
  }

  // ------------------------------------------------------------------ stage goals (yellow-up frame)
  function petalCount(s) { var w = s[31]; return (s[1] === w) + (s[3] === w) + (s[5] === w) + (s[7] === w); }
  function homeCount(s) {
    var d = s[31];
    return (s[28] === d && s[25] === s[22]) + (s[30] === d && s[43] === s[40]) +
      (s[32] === d && s[16] === s[13]) + (s[34] === d && s[52] === s[49]);
  }
  // Side colours of the white edges already solved in the cross.
  function homeColours(s) {
    var d = s[31], out = [];
    if (s[28] === d && s[25] === s[22]) out.push(s[25]);
    if (s[30] === d && s[43] === s[40]) out.push(s[43]);
    if (s[32] === d && s[16] === s[13]) out.push(s[16]);
    if (s[34] === d && s[52] === s[49]) out.push(s[52]);
    return out;
  }
  // Daisy: every white edge is a petal (white up around the yellow centre) or already
  // home in the cross — so it counts as done once the cross is done, and stays done mid-cross.
  function kDaisy(s) { return petalCount(s) + homeCount(s) === 4; }
  function kCross(s) { return homeCount(s) === 4; }
  function kCorners(s) { return okList(s, LIST_L1); }
  function kMiddle(s) { return kCorners(s) && okList(s, LIST_L2); }
  function kYcross(s) { return kMiddle(s) && okList(s, LIST_YC); }
  function kYedges(s) { return kYcross(s) && okList(s, LIST_YE); }
  function cornerInPlace(s, k) {
    var c = U_CORNERS[k];
    return sameSet([s[c[0]], s[c[1]], s[c[2]]], [s[c[3]], s[c[4]], s[c[5]]]);
  }
  function kYcorners(s) { return kYedges(s) && cornerInPlace(s, 0) && cornerInPlace(s, 1) && cornerInPlace(s, 2) && cornerInPlace(s, 3); }
  function kSolved(s) { return C.isSolved(s); }
  var STAGE_K = [kDaisy, kCross, kCorners, kMiddle, kYcross, kYedges, kYcorners, kSolved];

  // Mid-way through "Yellow Corners: Twist" the lower layers look scrambled. Detect that:
  // a few more R' D' R D (from the right side) would give a cube whose only remaining job is
  // twisting corners (and turning the top). Also covers "lower layers fine, every top piece in
  // its place relative to the others, top layer just turned" — that is the same stage.
  function midTwist(s) {
    if (kMiddle(s)) {
      if (!kYcross(s) || kYedges(s)) return null;
      for (var n = 1; n < 4; n++) if (kYcorners(ap(s, U_TURNS[n]))) return { rot: [], remaining: 0 };
      return null;
    }
    for (var a = 0; a < 4; a++) {
      var t = ap(s, Y_TURNS[a]);
      for (var j = 1; j <= 5; j++) {
        t = ap(t, TWIST);
        if (!kMiddle(t)) continue;
        for (var m = 0; m < 4; m++) if (kYcorners(ap(t, U_TURNS[m]))) return { rot: Y_TURNS[a], remaining: j };
      }
    }
    return null;
  }

  function progressOf(state) {
    var s = yellowUp(state);
    var idx = 0;
    if (s) { while (idx < 8 && STAGE_K[idx](s)) idx++; }
    var mid = null;
    if (s && idx < 7) { mid = midTwist(s); if (mid) idx = 7; }
    return { index: idx, id: idx === 8 ? 'solved' : STAGE_IDS[idx], done: STAGE_IDS.slice(0, idx), midTwist: !!mid };
  }

  // ------------------------------------------------------------------ step building
  function addStep(b, stg, o) {
    var segs = [], moves = [];
    o.segments.forEach(function (sg) {
      if (sg.moves && sg.moves.length) { segs.push({ label: sg.label, moves: sg.moves.slice() }); moves = moves.concat(sg.moves); }
    });
    if (!moves.length) throw new Error('CC.Solver internal error: empty step in ' + stg.id);
    var start = b.state, end = ap(start, moves);
    var step = {
      id: stg.id + '-' + (stg.steps.length + 1), stage: stg.id, kind: o.kind, title: o.title, explain: o.explain,
      moves: moves, segments: segs, alg: o.alg || null, case: o.case || null, focus: o.focus || [],
      startState: start.slice(), endState: end.slice(), quiz: o.quiz || null
    };
    stg.steps.push(step);
    b.state = end;
    if (b.firstOnly) throw { firstStep: step };
    return step;
  }

  function guard(b, stg) {
    if (++b.guard > 40) throw new Error('CC.Solver internal error: no progress in stage ' + stg.id);
  }

  // Step 0: hold the cube yellow-up (keep the current front if possible).
  function rotateStep(b, stg) {
    var s = b.state;
    if (s[4] === 'Y') return;
    var rot = C.rotationTo(s, 'Y', s[22]) || C.rotationTo(s, 'Y', null);
    var where = faceOfCentre(s, 'Y');
    addStep(b, stg, {
      kind: 'rotate',
      title: 'Hold the cube with YELLOW on top',
      explain: 'The whole method is done with the yellow centre on top, so white ends up on the bottom. ' +
        'Turning the whole cube doesn\'t change the puzzle — it only changes your view. Right now yellow is on the ' +
        C.FACE_NAME[where] + '.',
      segments: rot.map(function (t) { return { label: 'Whole cube: ' + C.moveInfo(t).how, moves: [t] }; }),
      focus: [ 'URFDLB'.indexOf(where) * 9 + 4 ]
    });
  }

  // ------------------------------------------------------------------ 1. daisy
  function freeTurn(s, slot) {
    var w = s[31];
    for (var i = 0; i < 4; i++) if (ap(s, U_TURNS[i])[slot] !== w) return U_TURNS[i];
    return null;
  }

  var LIFT_LABEL = {
    'top-flipped': { F: 'F: drop it into the middle layer', "F'": "F': drop it into the middle layer" },
    'bottom-white-side': { F: 'F: raise it into the middle layer', "F'": "F': raise it into the middle layer" },
    any: { R: 'R: lift it to the top — white now faces up', "L'": "L': lift it to the top — white now faces up",
      F2: 'F2: flip it up to the top — white now faces up' }
  };

  function daisyPlans(s) {
    var w = s[31], plans = [], petals = petalCount(s), homes = homeCount(s);
    for (var k = 0; k < 12; k++) {
      var st = EDGES[k].stickers, wi, oi;
      if (s[st[0]] === w) { wi = st[0]; oi = st[1]; } else if (s[st[1]] === w) { wi = st[1]; oi = st[0]; } else continue;
      var wf = STK[wi].face, of = STK[oi].face, colour = s[oi];
      if (wf === 'U') continue;                                         // already a petal
      if (wf === 'D' && s[oi] === s['URFDLB'.indexOf(of) * 9 + 4]) continue; // already home in the cross
      var caseId, rot, templates;
      if (of === 'U') { caseId = 'top-flipped'; rot = Y_TO_FRONT[wf]; templates = [[['F', 7], ['R', 5]], [["F'", 7], ["L'", 3]]]; }
      else if (wf === 'D') { caseId = 'bottom-white-down'; rot = Y_TO_FRONT[of]; templates = [[['F2', 7]]]; }
      else if (of === 'D') { caseId = 'bottom-white-side'; rot = Y_TO_FRONT[wf]; templates = [[["F'", 7], ['R', 5]], [['F', 7], ["L'", 3]]]; }
      else {
        caseId = 'middle'; rot = Y_TO_FRONT[wf];
        templates = after(wi, rot) === 23 ? [[['R', 5]]] : [[["L'", 3]]];
      }
      templates.forEach(function (tpl) {
        var cur = ap(s, rot), segs = [], uTurns = 0;
        if (rot.length) {
          segs.push({ label: caseId === 'bottom-white-down' ? 'Turn the whole cube so this edge is at the bottom of the front face'
            : 'Turn the whole cube so the white sticker faces you', moves: rot.slice() });
        }
        for (var i = 0; i < tpl.length; i++) {
          var mv = tpl[i][0], slot = tpl[i][1], u = freeTurn(cur, slot);
          if (u.length) { segs.push({ label: 'Turn the top so the ' + SLOT_NAME[slot] + ' spot has no white petal', moves: u.slice() }); uTurns++; }
          cur = ap(cur, u.concat([mv]));
          var lab = (LIFT_LABEL[caseId] && LIFT_LABEL[caseId][mv]) || LIFT_LABEL.any[mv];
          segs.push({ label: lab, moves: [mv] });
        }
        // the edge must now be a petal, and no petal lost
        var e = C.findEdge(cur, w, colour);
        if (!e || e.faces[0] !== 'U' || petalCount(cur) < petals + 1) throw new Error('CC.Solver internal error: daisy template failed');
        var moves = []; segs.forEach(function (g) { moves = moves.concat(g.moves); });
        var knocked = Math.max(0, homes - homeCount(cur));
        plans.push({ caseId: caseId, colour: colour, focus: [wi, oi], segs: segs, uTurns: uTurns,
          cost: countFaceTurns(moves) * 10 + rot.length * 2 + knocked * 25 });
      });
    }
    return plans;
  }

  var DAISY_EXPLAIN = {
    'top-flipped': function (c) { return 'The white–' + c + ' edge is on top, but its white sticker faces sideways, so it isn\'t a petal yet. Drop it into the middle layer, then lift it straight back up with a side turn so white ends up facing up.'; },
    'middle': function (c, u) { return 'The white–' + c + ' edge is in the middle layer. With its white sticker facing you, one side turn lifts it to the top with white facing up' + (u ? ' — but first turn the top so no petal sits where it will land, or you would knock that petal off.' : ', and the spot it lands in is already free.'); },
    'bottom-white-down': function (c) { return 'The white–' + c + ' edge is on the bottom with white facing down. A half turn of the front (F2) flips it straight up with white facing up — just make sure no petal is in the top-front spot first.'; },
    'bottom-white-side': function (c) { return 'The white–' + c + ' edge is on the bottom with white facing sideways, so it can\'t go straight up. Raise it into the middle layer first, then lift it to the top — each time making sure no petal is in the way.'; }
  };

  function runDaisy(b, stg) {
    var firstStep = true;
    while (!kDaisy(b.state)) {
      guard(b, stg);
      var s = b.state, plans = daisyPlans(s), best = null;
      plans.forEach(function (p) { if (!best || p.cost < best.cost) best = p; });
      var c = cn(best.colour);
      var homes = homeCount(s);
      // A side turn can knock a white edge out of its solved spot on the bottom: say so.
      var moves = [];
      best.segs.forEach(function (g) { moves = moves.concat(g.moves); });
      var homeBefore = homeColours(s), homeAfter = homeColours(ap(s, moves));
      var knocked = homeBefore.filter(function (x) { return homeAfter.indexOf(x) === -1; });
      var note = '';
      if (knocked.length) {
        note = ' This also knocks the ' + knocked.map(function (x) { return 'white–' + cn(x); }).join(' and ') +
          ' edge out of its solved spot on the bottom — that\'s fine, it can go up into the daisy like the others.';
      } else if (firstStep && homes) {
        note = ' (White edges already solved on the bottom — white down, side colour matching its centre — can stay where they are.)';
      }
      addStep(b, stg, {
        kind: 'intuitive',
        title: 'Bring the white–' + c + ' edge into the daisy',
        explain: DAISY_EXPLAIN[best.caseId](c, best.uTurns > 0) + note,
        segments: best.segs,
        case: caseRef(best.caseId),
        focus: best.focus
      });
      firstStep = false;
    }
  }

  // ------------------------------------------------------------------ 2. cross
  function runCross(b, stg) {
    while (!kCross(b.state)) {
      guard(b, stg);
      var s = b.state, w = s[31], best = null;
      [[5, 10], [7, 19], [3, 37], [1, 46]].forEach(function (e) {
        if (s[e[0]] !== w) return;
        var c = s[e[1]], rot = Y_TO_FRONT[faceOfCentre(s, c)], s1 = ap(s, rot);
        for (var n = 0; n < 4; n++) {
          var s2 = ap(s1, U_TURNS[n]);
          if (s2[7] === w && s2[19] === c) {
            var cost = (n ? 10 : 0) + rot.length * 2;
            if (!best || cost < best.cost) best = { cost: cost, c: c, rot: rot, u: U_TURNS[n], focus: [e[0], e[1]] };
            return;
          }
        }
      });
      if (!best) throw new Error('CC.Solver internal error: cross stage without petals');
      var c = cn(best.c), C_ = CN(best.c);
      var explain = 'This petal\'s side colour is ' + c + ', so it belongs on the bottom below the ' + c + ' centre. ' +
        (best.u.length ? 'Turn the top until the petal sits right above the ' + c + ' centre, then a' : 'It is already right above the ' + c + ' centre, so a') +
        ' half turn of the front (F2) drops it to the bottom with white facing down.';
      addStep(b, stg, {
        kind: 'intuitive',
        title: 'Bring the white–' + c + ' petal down',
        explain: explain,
        segments: [
          { label: 'Turn the whole cube so the ' + C_ + ' centre faces you', moves: best.rot },
          { label: 'Turn the top until the white–' + c + ' petal is right above the ' + c + ' centre', moves: best.u },
          { label: 'F2: turn the front twice — the petal drops to the bottom', moves: ['F2'] }
        ],
        case: caseRef('petal'),
        focus: best.focus
      });
    }
  }


  // ------------------------------------------------------------------ 2b. direct cross (opts.directCross)
  // Skip the daisy: put each white edge straight into the cross with a short search that keeps
  // the white edges already in place. Only one sticker per edge needs tracking (edges are rigid).
  var DC_MOVES = ['U', "U'", 'U2', 'F', "F'", 'F2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'D', "D'", 'D2', 'B', "B'", 'B2'];
  var DC_AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 }, DC_ORDER = { U: 0, D: 1, R: 0, L: 1, F: 0, B: 1 };
  var EDGE_DIST = null;
  function edgeDist() {
    if (EDGE_DIST) return EDGE_DIST;
    EDGE_DIST = {};
    EDGES.forEach(function (e) {
      e.stickers.forEach(function (from) {
        var d = {}, q = [from];
        d[from] = 0;
        while (q.length) {
          var x = q.shift();
          for (var m = 0; m < DC_MOVES.length; m++) { var y = PERM[DC_MOVES[m]][x]; if (d[y] === undefined) { d[y] = d[x] + 1; q.push(y); } }
        }
        EDGE_DIST[from] = d;
      });
    });
    return EDGE_DIST;
  }
  function dcSearch(track, goals, maxDepth) {
    var D = edgeDist(), path = [];
    function h(t) { var m = 0; for (var i = 0; i < t.length; i++) { var v = D[t[i]][goals[i]]; if (v > m) m = v; } return m; }
    function dfs(t, depth, last) {
      var hv = h(t);
      if (hv === 0) return true;
      if (hv > depth) return false;
      for (var k = 0; k < DC_MOVES.length; k++) {
        var mv = DC_MOVES[k], f = mv[0];
        if (last && (f === last || (DC_AXIS[f] === DC_AXIS[last] && DC_ORDER[f] < DC_ORDER[last]))) continue;
        var p = PERM[mv], nt = new Array(t.length);
        for (var i = 0; i < t.length; i++) nt[i] = p[t[i]];
        path.push(mv);
        if (dfs(nt, depth - 1, f)) return true;
        path.pop();
      }
      return false;
    }
    for (var d = 0; d <= maxDepth; d++) if (dfs(track, d, null)) return path.slice();
    return null;
  }

  function runDirectCross(b, stg) {
    while (!kCross(b.state)) {
      guard(b, stg);
      var s = b.state, w = s[31], best = null;
      for (var k = 0; k < 12; k++) {
        var st = EDGES[k].stickers, wi, oi;
        if (s[st[0]] === w) { wi = st[0]; oi = st[1]; } else if (s[st[1]] === w) { wi = st[1]; oi = st[0]; } else continue;
        var c = s[oi], wf = STK[wi].face, of = STK[oi].face;
        if (wf === 'D' && c === s['URFDLB'.indexOf(of) * 9 + 4]) continue;   // already home
        var rot = Y_TO_FRONT[faceOfCentre(s, c)], s1 = ap(s, rot), track = [after(wi, rot)], goals = [28];
        for (var j = 0; j < 4; j++) {   // DF DL DR DB: keep the ones already home
          var d = [28, 30, 32, 34][j];
          if (s1[d] === w && s1[[25, 43, 16, 52][j]] === s1[[22, 40, 13, 49][j]]) { track.push(d); goals.push(d); }
        }
        var path = dcSearch(track, goals, 8);
        if (!path) throw new Error('CC.Solver internal error: direct cross search failed');
        var cost = path.length * 10 + rot.length * 2;
        var where = (wf === 'U' ? 'top-white-up' : of === 'U' ? 'top-flipped' : (wf === 'D' || of === 'D') ? 'bottom' : 'middle');
        if (!best || cost < best.cost) best = { cost: cost, rot: rot, path: path, c: c, where: where, focus: [wi, oi] };
      }
      var lead = 0;
      while (lead < best.path.length && best.path[lead][0] === 'U') lead++;
      var cname = cn(best.c);
      addStep(b, stg, {
        kind: 'intuitive',
        title: 'Put the white–' + cname + ' edge in the cross',
        explain: 'The white–' + cname + ' edge belongs on the bottom below the ' + cname + ' centre, with white facing down. With the ' + cname +
          ' centre facing you, ' + best.path.length + (best.path.length > 1 ? ' turns bring' : ' turn brings') + ' it down to the bottom front without disturbing the white edges already in place.',
        segments: [
          { label: 'Turn the whole cube so the ' + CN(best.c) + ' centre faces you', moves: best.rot },
          { label: 'Turn the top to line it up', moves: best.path.slice(0, lead) },
          { label: 'Bring it down into place (the other white edges stay put)', moves: best.path.slice(lead) }
        ],
        case: caseRef('cross-' + best.where),
        focus: best.focus
      });
    }
  }

  // ------------------------------------------------------------------ 3. white corners
  var RT_REPS = { R: 1, U: 3, F: 5 };
  var RT_CASE = { R: 'corner-white-right', U: 'corner-white-up', F: 'corner-white-front' };
  var RT_DIR = { R: 'faces right', U: 'faces up', F: 'faces you' };

  function runCorners(b, stg) {
    while (!kCorners(b.state)) {
      guard(b, stg);
      var s = b.state, w = s[31], best = null;
      for (var k = 0; k < 4; k++) {
        var st = CORNERS[k].stickers, cols = [s[st[0]], s[st[1]], s[st[2]]];
        if (cols.indexOf(w) === -1) continue;
        var others = cols.filter(function (x) { return x !== w; });
        for (var n = 0; n < 4; n++) {
          var s1 = ap(s, U_TURNS[n]), pos = cornerPos(s1, cols), ps = CORNERS[pos].stickers;
          var sides = [s1['URFDLB'.indexOf(STK[ps[1]].face) * 9 + 4], s1['URFDLB'.indexOf(STK[ps[2]].face) * 9 + 4]];
          if (!sameSet(sides, others)) continue;
          var rot = ROT_TO_URF[pos], s2 = ap(s1, rot);
          var dir = s2[8] === w ? 'U' : s2[9] === w ? 'R' : 'F';
          var cost = RT_REPS[dir] * 40 + (n ? 10 : 0) + rot.length * 2;
          if (!best || cost < best.cost) {
            best = { cost: cost, u: U_TURNS[n], rot: rot, dir: dir, others: others, focus: st.slice() };
          }
          break;
        }
      }
      if (best) {
        var reps = RT_REPS[best.dir];
        var oc = best.others, name = pieceName([w].concat(oc));
        addStep(b, stg, {
          kind: 'repeat',
          title: 'Put the ' + name + ' corner in place',
          explain: 'Its side colours are ' + cn(oc[0]) + ' and ' + cn(oc[1]) + ', so it belongs in the bottom corner between the ' +
            cn(oc[0]) + ' and ' + cn(oc[1]) + ' centres. Line it up above that spot and hold it at the front-right: its white sticker ' +
            RT_DIR[best.dir] + ', so R U R\' U\' ' + (reps === 1 ? 'once' : reps + ' times') + ' drops it in (white right = 1, white up = 3, white facing you = 5).',
          segments: [
            { label: 'Turn the top so the corner sits right above its spot, between the ' + CN(oc[0]) + ' and ' + CN(oc[1]) + ' centres', moves: best.u },
            { label: 'Turn the whole cube so that spot is at the front-right', moves: best.rot }
          ].concat(repSegs('rtrigger', reps)),
          alg: algRef('rtrigger', reps),
          case: caseRef(RT_CASE[best.dir]),
          focus: best.focus,
          quiz: {
            prompt: 'Once this corner is at the top front-right, its white sticker ' + RT_DIR[best.dir] + '. How many times will you repeat R U R\' U\'?',
            options: ['1', '3', '5'],
            answer: ['1', '3', '5'].indexOf(String(reps)),
            explain: 'White facing right needs 1, white facing up needs 3, white facing you needs 5 — keep repeating until the corner drops into place.'
          }
        });
        continue;
      }
      // Stuck: every white corner is in the bottom layer, at least one is wrong.
      var stuck = -1;
      for (var d = 4; d < 8 && stuck < 0; d++) {
        var ds = CORNERS[d].stickers;
        for (var q = 0; q < 3; q++) if (s[ds[q]] !== s['URFDLB'.indexOf(STK[ds[q]].face) * 9 + 4]) { stuck = d; break; }
      }
      var dst = CORNERS[stuck].stickers, dcols = [s[dst[0]], s[dst[1]], s[dst[2]]];
      var wFirst = [w].concat(dcols.filter(function (x) { return x !== w; }));
      addStep(b, stg, {
        kind: 'algorithm',
        title: 'Lift the ' + pieceName(wFirst) + ' corner out of the bottom',
        explain: 'There are no white corners left on top, but this one is in the bottom layer in the wrong spot (or twisted). ' +
          'Hold it at the bottom front-right and do R U R\' U\' once — that lifts it to the top so you can put it in properly.',
        segments: [{ label: 'Turn the whole cube so that corner is at the bottom front-right', moves: ROT_TO_DFR[stuck - 4] }].concat(repSegs('rtrigger', 1)),
        alg: algRef('rtrigger', 1),
        case: caseRef('corner-stuck'),
        focus: dst.slice()
      });
    }
  }

  // ------------------------------------------------------------------ 4. middle layer
  function runMiddle(b, stg) {
    while (!kMiddle(b.state)) {
      guard(b, stg);
      var s = b.state, Y = s[4], best = null;
      [[5, 10], [7, 19], [3, 37], [1, 46]].forEach(function (e) {
        var t = s[e[0]], c = s[e[1]];
        if (t === Y || c === Y) return;
        var rot = Y_TO_FRONT[faceOfCentre(s, c)], s1 = ap(s, rot);
        for (var n = 0; n < 4; n++) {
          var s2 = ap(s1, U_TURNS[n]);
          if (s2[19] === c && s2[7] === t) {
            var right = t === s2[13];
            if (!right && t !== s2[40]) throw new Error('CC.Solver internal error: middle edge colours');
            var cost = (n ? 10 : 0) + rot.length * 2;
            if (!best || cost < best.cost) best = { cost: cost, rot: rot, u: U_TURNS[n], c: c, t: t, right: right, focus: [e[1], e[0]] };
            return;
          }
        }
      });
      if (best) {
        var id = best.right ? 'mid-right' : 'mid-left', side = best.right ? 'right' : 'left';
        addStep(b, stg, {
          kind: 'algorithm',
          title: 'Put the ' + pieceName([best.c, best.t]) + ' edge in the middle layer',
          explain: 'The colour on its side is ' + cn(best.c) + ', so line it up above the ' + cn(best.c) + ' centre (it makes an upside-down T). ' +
            'Its top colour is ' + cn(best.t) + ', which matches the centre on the ' + side + ', so it goes down to the ' + side + '.',
          segments: [
            { label: 'Turn the whole cube so the ' + CN(best.c) + ' centre faces you', moves: best.rot },
            { label: 'Turn the top until the edge is right above the ' + cn(best.c) + ' centre (an upside-down T)', moves: best.u },
            { label: ALGS[id].notation + ' — send it down to the ' + side, moves: ALG_TOK[id] }
          ],
          alg: algRef(id, 1),
          case: caseRef(best.right ? 'edge-right' : 'edge-left'),
          focus: best.focus,
          quiz: {
            prompt: 'Once it is lined up above the ' + CN(best.c) + ' centre, does this edge go left or right?',
            options: ['Left', 'Right'],
            answer: best.right ? 1 : 0,
            explain: 'Look at its top colour (' + cn(best.t) + '): it matches the centre on the ' + side + ', so it goes ' + side + '.'
          }
        });
        continue;
      }
      // Stuck: no top edge without yellow, but a middle edge is in the wrong slot or flipped.
      var bad = -1;
      for (var k = 8; k < 12 && bad < 0; k++) {
        var st = EDGES[k].stickers;
        if (s[st[0]] !== s['URFDLB'.indexOf(STK[st[0]].face) * 9 + 4] || s[st[1]] !== s['URFDLB'.indexOf(STK[st[1]].face) * 9 + 4]) bad = k;
      }
      var bst = EDGES[bad].stickers;
      addStep(b, stg, {
        kind: 'algorithm',
        title: 'Pop the ' + pieceName([s[bst[0]], s[bst[1]]]) + ' edge out of the middle layer',
        explain: 'Every edge on top has yellow on it, so none of them belongs in the middle — but this middle edge is in the wrong spot or flipped. ' +
          'Hold it at the front-right and do the right-hand algorithm once: it swaps the edge up to the top so you can put it back properly.',
        segments: [
          { label: 'Turn the whole cube so that edge is at the front-right of the middle layer', moves: ROT_TO_FR[bad - 8] },
          { label: ALGS['mid-right'].notation + ' — swap it out to the top', moves: ALG_TOK['mid-right'] }
        ],
        alg: algRef('mid-right', 1),
        case: caseRef('edge-stuck'),
        focus: bst.slice()
      });
    }
  }

  // ------------------------------------------------------------------ 5. yellow cross
  function shapeOf(s) {
    var Y = s[4], b = s[1] === Y, l = s[3] === Y, r = s[5] === Y, f = s[7] === Y, n = b + l + r + f;
    if (n === 4) return 'cross';
    if (n === 0) return 'dot';
    if (n === 2) return (b && f) || (l && r) ? 'line' : 'l-shape';
    return 'odd';
  }

  function runYcross(b, stg) {
    while (!kYcross(b.state)) {
      guard(b, stg);
      var s = b.state, Y = s[4], shape = shapeOf(s), hold = [], holdLabel = '', title, explain;
      if (shape === 'dot') {
        title = 'Turn the yellow dot into an L';
        explain = 'No yellow edges face up yet — just the yellow centre (a "dot"). Do F R U R\' U\' F\' once from any side and you will get an L-shape.';
      } else if (shape === 'l-shape') {
        for (var n = 0; n < 4; n++) { var t = ap(s, U_TURNS[n]); if (t[1] === Y && t[3] === Y) { hold = U_TURNS[n]; break; } }
        holdLabel = 'Turn the top so the two yellow edges of the L are at the back and on the left';
        title = 'Turn the yellow L into a line';
        explain = 'Hold the L so its two yellow edges are at the back and on the left (like a clock showing 9 and 12). Then F R U R\' U\' F\' turns it into a straight line.';
      } else if (shape === 'line') {
        hold = s[3] === Y ? [] : ['U'];
        holdLabel = 'Turn the top so the yellow line goes left to right';
        title = 'Turn the yellow line into a cross';
        explain = 'Hold the line left to right (flat, not pointing at you). Then F R U R\' U\' F\' finishes the yellow cross.';
      } else {
        throw new Error('CC.Solver internal error: impossible yellow cross shape');
      }
      var segs = [];
      if (hold.length) segs.push({ label: holdLabel, moves: hold });
      segs.push({ label: 'F R U R\' U\' F\'', moves: ALG_TOK.ycross });
      var focus = [4];
      [1, 3, 5, 7].forEach(function (i) { if (s[i] === Y) focus.push(i); });
      addStep(b, stg, {
        kind: 'algorithm', title: title, explain: explain, segments: segs,
        alg: algRef('ycross', 1), case: caseRef(shape), focus: focus,
        quiz: {
          prompt: 'What shape is on top?',
          options: SHAPE_OPTIONS.slice(),
          answer: { dot: 0, 'l-shape': 1, line: 2 }[shape],
          explain: 'Count the yellow edges facing up: none is a dot, two side by side make an L, two opposite make a line.'
        }
      });
    }
  }

  // ------------------------------------------------------------------ 6. yellow edges
  // matches[] order: back, left, right, front
  function edgeMatches(s) { return [s[46] === s[49], s[37] === s[40], s[10] === s[13], s[19] === s[22]]; }
  function countTrue(a) { var n = 0; for (var i = 0; i < a.length; i++) if (a[i]) n++; return n; }
  var EDGE_SIDE_STICKERS = { 0: [1, 46], 1: [3, 37], 2: [5, 10], 3: [7, 19] };

  function runYedges(b, stg) {
    while (!kYedges(b.state)) {
      guard(b, stg);
      var s = b.state, aligned = null, adj = null, opp = null;
      for (var n = 0; n < 4; n++) {
        var s1 = ap(s, U_TURNS[n]), m = edgeMatches(s1), cnt = countTrue(m);
        if (cnt === 4 && !aligned) aligned = U_TURNS[n];
        if (cnt === 2) {
          var isOpp = (m[0] && m[3]) || (m[1] && m[2]);
          if (isOpp && !opp) opp = { u: U_TURNS[n], m: m };
          if (!isOpp && !adj) adj = { u: U_TURNS[n], m: m };
        }
      }
      if (aligned) {
        addStep(b, stg, {
          kind: 'align',
          title: 'Turn the top to line up the yellow edges',
          explain: 'All four top edges are in the right order already — they just need lining up. Turn the top until each edge matches the centre below it.',
          segments: [{ label: 'Turn the top until every edge matches its centre', moves: aligned }],
          case: caseRef('edges-aligned'),
          focus: [1, 3, 5, 7]
        });
        continue;
      }
      var pick = adj || opp;
      if (!pick) throw new Error('CC.Solver internal error: no two edges match');
      var s1b = ap(s, pick.u), focus = [];
      pick.m.forEach(function (ok, i) {
        if (!ok) return;
        var st = EDGE_SIDE_STICKERS[i];
        focus = focus.concat(edgeFocus(s, s1b[st[0]], s1b[st[1]]));
      });
      if (adj) {
        var rot = null;
        for (var r = 0; r < 4; r++) { var s2 = ap(s1b, Y_TURNS[r]); if (s2[46] === s2[49] && s2[10] === s2[13]) { rot = Y_TURNS[r]; break; } }
        addStep(b, stg, {
          kind: 'algorithm',
          title: 'Swap the last two yellow edges',
          explain: 'Two neighbouring top edges match their centres. Hold that pair at the back and on the right, then R U R\' U R U2 R\' U swaps the front and left edges so all four match.',
          segments: [
            { label: 'Turn the top until two neighbouring edges match their centres', moves: pick.u },
            { label: 'Turn the whole cube so the matching pair is at the back and on the right', moves: rot },
            { label: 'R U R\' U R U2 R\' U', moves: ALG_TOK.sune }
          ],
          alg: algRef('sune', 1),
          case: caseRef('edges-adjacent'),
          focus: focus,
          quiz: {
            prompt: 'Two neighbouring edges match their centres. Where should you hold them before doing R U R\' U R U2 R\' U?',
            options: ['Back and right', 'Front and left', 'Front and right', 'Back and left'],
            answer: 0,
            explain: 'Hold the matching pair at the back and on the right — the algorithm swaps the other two (front and left).'
          }
        });
      } else {
        addStep(b, stg, {
          kind: 'algorithm',
          title: 'Break up the opposite pair',
          explain: 'The two edges that match are opposite each other. Do R U R\' U R U2 R\' U once from any side — afterwards, turning the top will give you two neighbouring edges that match.',
          segments: [
            { label: 'Turn the top until two edges match their centres', moves: pick.u },
            { label: 'R U R\' U R U2 R\' U (from any side)', moves: ALG_TOK.sune }
          ],
          alg: algRef('sune', 1),
          case: caseRef('edges-opposite'),
          focus: focus,
          quiz: {
            prompt: 'Are the two matching edges next to each other or opposite each other?',
            options: ['Next to each other', 'Opposite each other'],
            answer: 1,
            explain: 'They are opposite, so do the algorithm once from any side first; then you will get a neighbouring pair.'
          }
        });
      }
    }
  }

  // ------------------------------------------------------------------ 7. yellow corners: position
  function runYcorners(b, stg) {
    var again = false;
    while (!kYcorners(b.state)) {
      guard(b, stg);
      var s = b.state, inPlace = [];
      for (var k = 0; k < 4; k++) if (cornerInPlace(s, k)) inPlace.push(k);
      if (inPlace.length === 0) {
        var all = [];
        U_CORNERS.forEach(function (c) { all.push(c[0], c[1], c[2]); });
        addStep(b, stg, {
          kind: 'algorithm',
          title: 'Get one yellow corner into its spot',
          explain: 'A corner is in its spot when its three colours match the three centres around it (it may still be twisted). None is yet, so do U R U\' L\' U R\' U\' L once from any side — afterwards exactly one corner will be in its spot.',
          segments: [{ label: 'U R U\' L\' U R\' U\' L (from any side)', moves: ALG_TOK['corner-cycle'] }],
          alg: algRef('corner-cycle', 1),
          case: caseRef('corners-none'),
          focus: all,
          quiz: {
            prompt: 'Which corner is already in its correct spot?', options: YCORNER_OPTIONS.slice(), answer: 4,
            explain: 'None of them: no corner\'s three colours match the three centres around it.'
          }
        });
        again = false;
        continue;
      }
      if (inPlace.length !== 1) throw new Error('CC.Solver internal error: ' + inPlace.length + ' corners in place');
      var pos = inPlace[0], rot = ROT_TO_URF[pos], st = U_CORNERS[pos], cols = [s[st[0]], s[st[1]], s[st[2]]];
      var yFirst = ['Y'].concat(cols.filter(function (x) { return x !== 'Y'; }));
      addStep(b, stg, {
        kind: 'algorithm',
        title: again ? 'Do the corner cycle once more' : 'Cycle the other three yellow corners',
        explain: again
          ? 'The other three corners moved round but are not in their spots yet. Keep the ' + pieceName(yFirst) + ' corner at the front-right and do U R U\' L\' U R\' U\' L again.'
          : 'The ' + pieceName(yFirst) + ' corner is already in its spot (its colours match the centres around it). Hold it at the top front-right and do U R U\' L\' U R\' U\' L — that corner stays put while the other three move round. If they\'re not all in place afterwards, do it once more.',
        segments: [
          { label: 'Turn the whole cube so the correct corner is at the top front-right', moves: rot },
          { label: 'U R U\' L\' U R\' U\' L', moves: ALG_TOK['corner-cycle'] }
        ],
        alg: algRef('corner-cycle', 1),
        case: caseRef('corners-one'),
        focus: [st[0], st[1], st[2]],
        quiz: again ? null : {
          prompt: 'Which corner is already in its correct spot?', options: YCORNER_OPTIONS.slice(), answer: pos,
          explain: 'The ' + U_CORNER_SPOT[pos] + ' corner: its three colours match the three centres around it.'
        }
      });
      again = true;
    }
  }

  // ------------------------------------------------------------------ 8. yellow corners: twist
  function runYorient(b, stg) {
    if (C.isSolved(b.state)) return;
    var fresh = kYcorners(b.state), pre = [];
    if (!fresh) {
      var mt = midTwist(b.state);
      if (!mt) throw new Error('CC.Solver internal error: yorient stage reached unexpectedly');
      pre = mt.rot;
    }
    var first = true, twisted = false;
    var CALM_NOW = ' The lower layers look scrambled right now — don\'t panic, they fix themselves once every corner is done.';
    var CALM_SOON = ' The lower layers will look scrambled while you do this — don\'t panic, they fix themselves once every corner is done.';
    while (!C.isSolved(b.state)) {
      guard(b, stg);
      var s = b.state, Y = s[4];
      var corr = first ? pre : [];
      var corrSeg = { label: 'Turn the whole cube back so you hold it the way you started this stage', moves: corr };
      var s0 = ap(s, corr), lowerOk = kMiddle(s0);
      if (s0[0] === Y && s0[2] === Y && s0[6] === Y && s0[8] === Y) {
        var al = null;
        for (var n = 0; n < 4; n++) if (C.isSolved(ap(s0, U_TURNS[n]))) { al = U_TURNS[n]; break; }
        if (!al) throw new Error('CC.Solver internal error: top corners twisted but cube not solvable by U');
        addStep(b, stg, {
          kind: 'align',
          title: 'Turn the top to finish',
          explain: twisted
            ? 'Every yellow sticker faces up and the lower layers have fixed themselves. Turn the top until it lines up with the rest — solved!'
            : 'Every yellow sticker already faces up — only the top layer is turned. Turn it until it lines up with the rest — solved!',
          segments: [corrSeg, { label: 'Turn the top until every side is one colour', moves: al }],
          case: caseRef('top-aligned'),
          focus: [0, 1, 2, 3, 5, 6, 7, 8]
        });
        first = false;
        continue;
      }
      var setup = [], setupLabel = '';
      if (s0[8] !== Y) setup = [];
      else if (first && fresh) {
        for (var r = 1; r < 4; r++) if (ap(s0, Y_TURNS[r])[8] !== Y) { setup = Y_TURNS[r]; break; }
        setupLabel = 'Turn the whole cube so a twisted corner is at the top front-right';
      } else {
        for (var u = 1; u < 4; u++) if (ap(s0, U_TURNS[u])[8] !== Y) { setup = U_TURNS[u]; break; }
        setupLabel = 'Turn only the top layer to bring ' + (first ? 'a' : 'the next') + ' twisted corner to the front-right';
      }
      var s1 = ap(s0, setup), reps = 0, t = s1;
      do { t = ap(t, TWIST); reps++; } while (t[8] !== Y && reps < 6);
      if (t[8] !== Y) throw new Error('CC.Solver internal error: corner never turned yellow-up');
      var isYellowCorner = s1[9] === Y || s1[20] === Y;
      var caseId = !isYellowCorner || (reps !== 2 && reps !== 4) ? 'twist-continue' : (s1[9] === Y ? 'yellow-right' : 'yellow-front');
      // The corner being twisted is the one that comes back up yellow-side up at the front-right
      // (part-way through, it sits at the bottom front-right and a white corner is in its place).
      var cols = [t[8], t[9], t[20]];
      cols = ['Y'].concat(cols.filter(function (x) { return x !== 'Y'; }));
      var start = s, focus = cornerFocus(start, cols);
      var explain, goes = ' (' + reps + ' go' + (reps > 1 ? 'es' : '') + ')';
      if (caseId === 'twist-continue') {
        explain = 'You are part-way through twisting the ' + pieceName(cols) + ' corner: right now it is at the bottom front-right, and a white corner sits in its place on top. ' +
          'Keep going: repeat R\' D\' R D ' + reps + ' more time' + (reps > 1 ? 's' : '') +
          ' until it comes back up with its yellow sticker facing up. Don\'t panic about the lower layers, and don\'t turn the whole cube.';
      } else if (first && fresh) {
        explain = 'Hold the cube with this corner at the top front-right, and from now on don\'t turn the whole cube. Repeat R\' D\' R D until its yellow sticker faces up: yellow facing right takes 2 goes, yellow facing you takes 4.' + CALM_SOON;
      } else if (first && lowerOk) {
        // Lower layers fine but the top layer is turned: every top piece is already in its spot
        // relative to the others, so the top is lined up at the very end.
        explain = 'Every yellow piece is already in its spot relative to the others — the top layer is just turned, and you can line it up at the very end. ' +
          (setup.length ? 'Turn only the top layer to bring a twisted corner to the front-right, then repeat'
            : 'The corner at the top front-right is twisted, so repeat') +
          ' R\' D\' R D until its yellow sticker faces up: yellow facing right takes 2 goes, yellow facing you takes 4. From now on don\'t turn the whole cube.' + CALM_SOON;
      } else {
        explain = (setup.length ? 'Turn only the top layer to bring the next twisted corner to the front-right, then repeat R\' D\' R D until its yellow faces up'
          : 'The corner at the top front-right still needs twisting: repeat R\' D\' R D until its yellow faces up') + goes + '.' + (lowerOk ? CALM_SOON : CALM_NOW);
      }
      var title = caseId === 'twist-continue' ? 'Keep twisting the ' + pieceName(cols) + ' corner' : 'Twist the ' + pieceName(cols) + ' corner yellow-side up';
      addStep(b, stg, {
        kind: 'repeat',
        title: title,
        explain: explain,
        segments: [corrSeg, { label: setupLabel, moves: setup }].concat(repSegs('twist', reps)),
        alg: algRef('twist', reps),
        case: caseRef(caseId),
        focus: focus,
        quiz: caseId === 'twist-continue' ? null : {
          prompt: 'At the top front-right, this corner\'s yellow sticker faces ' + (caseId === 'yellow-right' ? 'right' : 'you') + '. How many times will you repeat R\' D\' R D?',
          options: ['2', '4'],
          answer: reps === 2 ? 0 : 1,
          explain: 'Yellow facing right needs 2 goes; yellow facing you needs 4.'
        }
      });
      first = false;
      twisted = true;
    }
  }

  var RUNNERS = [runDaisy, runCross, runCorners, runMiddle, runYcross, runYedges, runYcorners, runYorient];

  // ------------------------------------------------------------------ public API
  function solveInternal(state, opts) {
    lib();
    opts = opts || {};
    if (!state || state.length !== 54) throw new Error('CC.Solver.solve needs a 54-sticker cube state.');
    if (opts.validate !== false) {
      var v = C.validate(state);
      if (!v.ok) {
        var err = new Error('This cube can\'t be solved as entered: ' + v.errors[0].message);
        err.validation = v;
        throw err;
      }
    }
    var start = state.slice();
    var b = { state: start, firstOnly: !!opts.firstOnly, guard: 0 };
    var prog = progressOf(start), target = prog.index, rotated = false;
    var stages = [];
    for (var i = 0; i < 8; i++) {
      var def = STAGES[i];
      var stg = { id: def.id, name: def.name, goal: def.goal, skipped: false, startState: b.state.slice(), endState: null, steps: [] };
      stages.push(stg);
      if (i === 0 && target === 0 && opts.directCross) target = 1;   // the daisy is skipped
      if (i === target) {
        b.guard = 0;
        if (!rotated) { rotateStep(b, stg); rotated = true; }
        (i === 1 && opts.directCross ? runDirectCross : RUNNERS[i])(b, stg);
        // Re-read progress so that solving from any step boundary gives the same plan.
        target = progressOf(b.state).index;
        if (target <= i) throw new Error('CC.Solver internal error: stage ' + def.id + ' did not finish');
      }
      stg.skipped = stg.steps.length === 0;
      stg.endState = b.state.slice();
    }
    if (!C.isSolved(b.state)) throw new Error('CC.Solver internal error: finished without solving');
    var moves = [];
    stages.forEach(function (st) { st.steps.forEach(function (sp) { moves = moves.concat(sp.moves); }); });
    return { start: start, end: b.state.slice(), moves: moves, moveCount: countFaceTurns(moves), stages: stages, resumedMidTwist: prog.midTwist };
  }

  function solve(state, opts) {
    var o = {};
    if (opts) Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    o.firstOnly = false;
    return solveInternal(state, o);
  }

  function nextStep(state, opts) {
    var o = { firstOnly: true };
    if (opts) Object.keys(opts).forEach(function (k) { if (k !== 'firstOnly') o[k] = opts[k]; });
    try {
      solveInternal(state, o);
    } catch (e) {
      if (e && e.firstStep) return e.firstStep;
      throw e;
    }
    return null;
  }

  function progress(state) {
    lib();
    var p = progressOf(state);
    return { index: p.index, id: p.id, done: p.done, midTwist: p.midTwist };
  }

  var check = {};
  STAGE_IDS.forEach(function (id, i) {
    check[id] = function (state) {
      lib();
      var s = yellowUp(state);
      return !!s && STAGE_K[i](s);
    };
  });

  // ------------------------------------------------------------------ drill scrambles
  function int(rnd, n) { return Math.floor(rnd() * n); }

  function conj(rnd, algToks, allowU) {
    var a = Y_TURNS[int(rnd, 4)], u = allowU ? U_TURNS[int(rnd, 4)] : [];
    return a.concat(u, algToks, invertY(a));
  }
  // Twists two top corners in opposite directions, everything else unchanged:
  // A U A' U' with A = (R' D' R D) x2 or its inverse (18 face turns).
  function twistPair(rnd) {
    var A = repeat(TWIST, 2);
    if (rnd() < 0.5) A = invertY(A);
    var u = U_TURNS[1 + int(rnd, 3)];
    var seq = A.concat(u, invertY(A), invertY(u));
    var a = Y_TURNS[int(rnd, 4)];
    return a.concat(seq, invertY(a));
  }
  // X U^k X' for a side face X: scrambles corners and middle edges but never moves a bottom edge.
  var SIDE_FACES = ['R', "R'", 'L', "L'", 'F', "F'", 'B', "B'"];
  function crossSafeBlock(rnd, prev) {
    var x;
    do { x = SIDE_FACES[int(rnd, SIDE_FACES.length)]; } while (prev && x[0] === prev[0]);   // no cancelling
    return [x].concat(U_TURNS[1 + int(rnd, 3)], invertY([x]));
  }

  // Drill scrambles are kept fairly short (roughly 25–55 face turns) because on a real cube the
  // learner has to apply them by hand.
  function drillSequence(k, rnd) {
    var seq = [], i, pool;
    if (k === 0) return C.scramble(25, int(rnd, 4294967296));
    if (k === 1) {
      var scr = C.scramble(25, int(rnd, 4294967296));
      var stg = { id: 'daisy', steps: [] };
      runDaisy({ state: ap(LEARN, scr), firstOnly: false, guard: 0 }, stg);
      seq = scr.slice();
      stg.steps.forEach(function (sp) { seq = seq.concat(sp.moves); });
      return seq;
    }
    var R = ALG_TOK;
    if (k === 2) {
      for (i = 0; i < 9; i++) seq = seq.concat(crossSafeBlock(rnd, seq[seq.length - 1]));
      return seq.concat(U_TURNS[int(rnd, 4)]);
    }
    if (k === 3) pool = [R['mid-right'], R['mid-left'], R['mid-right'], R['mid-left'], R.ycross, R.sune];
    else if (k === 4) pool = [R.ycross, R.sune, R['corner-cycle'], invertY(R.ycross)];
    else if (k === 5) pool = [R.sune, R['corner-cycle'], invertY(R.sune)];
    if (k <= 5) {
      var blocks = k === 3 ? 5 : 4;
      for (i = 0; i < blocks; i++) seq = seq.concat(conj(rnd, pool[int(rnd, pool.length)], true));
      return seq.concat(U_TURNS[int(rnd, 4)]);
    }
    if (k === 6) {
      for (i = 0; i < 3; i++) seq = seq.concat(rnd() < 0.6 ? conj(rnd, R['corner-cycle'], false) : twistPair(rnd));
      return seq;
    }
    var pairs = rnd() < 0.5 ? 2 : 3;
    for (i = 0; i < pairs; i++) seq = seq.concat(twistPair(rnd));
    return seq;
  }

  // Replace whole-cube rotations by relabelling the face moves that follow them.
  function faceMovesOnly(start, seq) {
    var cur = start, out = [];
    seq.forEach(function (tok) {
      if (/^[xyz]/.test(tok)) { cur = ap(cur, [tok]); return; }
      var face = 'URFDLB'.indexOf(tok[0]);
      out.push(faceOfCentre(start, cur[face * 9 + 4]) + tok.slice(1));
    });
    return C.simplifyAlg(out);
  }

  function drillScramble(stageId, seed) {
    lib();
    var k = STAGE_IDS.indexOf(stageId);
    if (k < 0) throw new Error('Unknown stage: ' + stageId);
    var s0 = seed == null ? Math.floor(Math.random() * 4294967296) : Number(seed) >>> 0;
    var rnd = C.mulberry32((s0 ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0);
    for (var attempt = 0; attempt < 200; attempt++) {
      var scramble = faceMovesOnly(LEARN, drillSequence(k, rnd));
      var st = ap(LEARN, scramble), ok = !STAGE_K[k](st) && progressOf(st).index === k;
      for (var j = 0; j < k && ok; j++) ok = STAGE_K[j](st);
      if (ok) return { scramble: scramble, holding: HOLDING, state: st, stage: stageId, seed: s0 };
    }
    throw new Error('CC.Solver could not build a drill for ' + stageId);
  }

  var Solver = {
    STAGES: STAGES,
    STAGE_IDS: STAGE_IDS,
    ALGS: ALGS,
    CASES: CASES,
    check: check,
    progress: progress,
    solve: solve,
    nextStep: nextStep,
    drillScramble: drillScramble,
    yellowUp: function (state) { lib(); return yellowUp(state); },
    shapeOf: function (state) { lib(); var s = yellowUp(state); return s ? shapeOf(s) : null; }
  };

  root.CC = root.CC || {};
  root.CC.Solver = Solver;
  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
})(typeof window !== 'undefined' ? window : globalThis);
