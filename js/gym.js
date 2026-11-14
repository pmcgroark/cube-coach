/* Cube Coach — Middle Layer Gym engine (CC.Gym).
 *
 * Short, focused exercises for stage 4 (the middle layer), built around the four problems a
 * learner gets stuck on: remembering the moves, seeing what to do, stuck edges and losing their
 * place. Pure logic: no DOM. See docs/MOBILE-AND-GYM.md (Part B) for the contract.
 *
 *   CC.Gym.ALGS          the two algorithms, as two halves of four moves, with plain English
 *   CC.Gym.DRILLS        every drill: { id, group, groupName, name, desc, kind, needsCube, route? }
 *   CC.Gym.GROUPS        the five groups, with the learner's own words for each problem
 *   CC.Gym.LANDMARKS     what the cube looks like after each half (asserted by tests)
 *   CC.Gym.next(drillId, { seed, level }) -> Item           deterministic per seed
 *   CC.Gym.session(drillId, { seed, count, level }) -> [Item]  no duplicates in a round
 *   CC.Gym.check(item, response) -> { correct, explain, partial? }
 *   extras: mirror(tokens), drill(id), whereText(alg, k), goalMet(goal, state), MIRROR_FEEL,
 *           record(data, drillId, correct, { ms }, now), isStrong(entry), suggest(data, { hasCube })
 *
 * Feedback: every wrong option (top-level options and step options) carries `why`, a one-line
 * reason worked out by simulation (where that turn really takes the edge, which slot the other
 * algorithm drops it into, which move a wrong token really is). check() puts it first, both for
 * tap answers and for { step, id } answers, so a screen just shows `explain`.
 *
 * Learning frame throughout: YELLOW ON TOP, white on the bottom; states are always "as held".
 * Every state is built from a solved cube held yellow-up / green-front
 * (CC.Cube.applyAlg(CC.Cube.solved(), 'z2')) with moves that keep the white layer: the two
 * algorithms (and their inverses) at each slot, U turns and last-layer algorithms. Every answer
 * is computed by simulation with CC.Cube, never assumed; tests/gym.test.js re-checks them all.
 *
 * Facts proved by simulation (and re-checked by the tests):
 *   - After the first half (U R U' R') the edge is back above the front centre, where it
 *     started, and the white corner from the front-right slot is on top right next to it
 *     (top-front-right, white facing right), matching colours touching. Left: the mirror.
 *   - From the 2nd to the 7th move the white layer is broken (after F'/F even the white cross
 *     has a piece out); after the 8th it is whole and the other three slots are untouched.
 *   - The Right algorithm only changes the front-right slot (plus the top layer); the Left one
 *     only the front-left slot. Turning the top never changes which edges are on top.
 *   - Left = mirror of Right: swap R and L, turn every move the other way.
 *   - The second half is the first half with F in place of R (L) and every move turned the other way.
 *
 * Classic script: attaches to window.CC.Gym and module.exports. CC.Cube and CC.Solver are
 * looked up lazily at call time (in node they are required on demand).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ the two algorithms
  var RIGHT = ['U', 'R', "U'", "R'", "U'", "F'", 'U', 'F'];
  var LEFT = ["U'", "L'", 'U', 'L', 'U', 'F', "U'", "F'"];
  // = CC.Cube.moveInfo(token).text (asserted by tests; static so nothing runs at load time)
  var PLAIN = {
    U: 'Top layer: turn so the front moves to the LEFT',
    "U'": 'Top layer: turn so the front moves to the RIGHT',
    R: 'Right side: turn UP, away from you',
    "R'": 'Right side: turn DOWN, toward you',
    L: 'Left side: turn DOWN, toward you',
    "L'": 'Left side: turn UP, away from you',
    F: 'Front face: turn clockwise (top goes right)',
    "F'": 'Front face: turn anticlockwise (top goes left)'
  };
  function plainOf(toks) { return toks.map(function (t) { return PLAIN[t]; }); }

  var ALGS = {
    right: {
      id: 'right', algId: 'mid-right', name: 'Right', slot: 'front-right', slotPos: 'FR',
      notation: "U R U' R' U' F' U F", moves: RIGHT.slice(), plain: plainOf(RIGHT),
      halves: [
        { moves: RIGHT.slice(0, 4), name: 'First half: corner out', rhythm: 'away, up, back, down', plain: plainOf(RIGHT.slice(0, 4)),
          does: 'The edge steps away, the right side lifts the white corner out of the bottom layer, the edge comes back and the corner lands on top, just beside it.' },
        { moves: RIGHT.slice(4), name: 'Second half: pair in', rhythm: 'aside, open, back, close', plain: plainOf(RIGHT.slice(4)),
          does: 'The pair steps aside, the front turns to lift the slot up, the pair comes back above it and the front turns back, closing the slot with both inside.',
          link: 'The second half is the first half again with F in place of R, and every move turned the other way.' }
      ],
      mirrorOf: 'left'
    },
    left: {
      id: 'left', algId: 'mid-left', name: 'Left', slot: 'front-left', slotPos: 'FL',
      notation: "U' L' U L U F U' F'", moves: LEFT.slice(), plain: plainOf(LEFT),
      halves: [
        { moves: LEFT.slice(0, 4), name: 'First half: corner out', rhythm: 'away, up, back, down', plain: plainOf(LEFT.slice(0, 4)),
          does: 'The edge steps away, the left side lifts the white corner out of the bottom layer, the edge comes back and the corner lands on top, just beside it.' },
        { moves: LEFT.slice(4), name: 'Second half: pair in', rhythm: 'aside, open, back, close', plain: plainOf(LEFT.slice(4)),
          does: 'The pair steps aside, the front turns to lift the slot up, the pair comes back above it and the front turns back, closing the slot with both inside.',
          link: 'The second half is the first half again with F in place of L, and every move turned the other way.' }
      ],
      mirrorOf: 'right'
    }
  };
  var MIRROR_RULE = 'Swap R and L, and turn every move the other way (U becomes U\', F\' becomes F).';
  // What the mirror feels like in your hands (R and L' both lift a side UP; asserted by tests).
  var MIRROR_FEEL = 'In your hands it really is a mirror image: R lifts the right side UP and L\' lifts the left side UP, while U and U\' (and F and F\') turn opposite ways.';

  // Left is the mirror of right: swap R and L, flip every direction.
  function mirrorMove(t) {
    var b = t.charAt(0), m = { R: 'L', L: 'R' }[b] || b;
    if (t.slice(-1) === '2') return m + '2';
    return t.slice(-1) === "'" ? m : m + "'";
  }
  function mirror(toks) { return toks.map(mirrorMove); }

  // ------------------------------------------------------------------ landmarks
  var LANDMARKS = {
    right: [
      { after: 4, title: 'After the first half',
        text: "After the first half (U R U' R'): the edge is back on top at the front, where it started. The white corner from the bottom front-right has come up next to it, on top at the front-right, with its white sticker facing right. The two sit side by side with their matching colours touching. The white layer now has a gap at the front-right: that is normal, the second half fills it.",
        note: "From the 2nd move to the 7th the white layer always looks broken; after F' even the white cross has a piece out. Don't stop and don't turn the cube: keep going and it all comes back.",
        facts: { edge: 'UF', corner: 'URF', white: 'R', whiteLayer: false } },
      { after: 8, title: 'After the whole algorithm',
        text: 'After all eight moves: the edge is in the front-right slot, matching both centres. The white layer is whole again and any middle edges you had already placed are still in. Apart from that slot, only the top layer has changed.',
        facts: { edge: 'FR', corner: 'DFR', white: 'D', whiteLayer: true } }
    ],
    left: [
      { after: 4, title: 'After the first half',
        text: "After the first half (U' L' U L): the edge is back on top at the front, where it started. The white corner from the bottom front-left has come up next to it, on top at the front-left, with its white sticker facing left. The two sit side by side with their matching colours touching. The white layer now has a gap at the front-left: that is normal, the second half fills it.",
        note: 'From the 2nd move to the 7th the white layer always looks broken; after F even the white cross has a piece out. Don\'t stop and don\'t turn the cube: keep going and it all comes back.',
        facts: { edge: 'UF', corner: 'UFL', white: 'L', whiteLayer: false } },
      { after: 8, title: 'After the whole algorithm',
        text: 'After all eight moves: the edge is in the front-left slot, matching both centres. The white layer is whole again and any middle edges you had already placed are still in. Apart from that slot, only the top layer has changed.',
        facts: { edge: 'FL', corner: 'DLF', white: 'D', whiteLayer: true } }
    ]
  };

  // Where things are after k moves (used by 'whereami' and 'slowmo'; asserted by tests).
  var WHERE = {
    right: [
      'Not started: the edge makes the upside-down T at the front and the white layer is whole.',
      'The edge has stepped away to the top-left. The white layer is still whole.',
      'The edge is at the top-left and the white corner has come up to the top-front-right, white facing you.',
      'The edge is back at the front. The white corner is on top at the back-right.',
      'The first half is done: the edge is at the front and the white corner sits right next to it at the top-front-right, white facing right.',
      'The pair (edge and white corner together) has stepped aside: edge at the top-right, corner at the top-back-right.',
      'The front face is turned: the white cross has a piece out. The pair is still waiting on the right.',
      'The pair is back at the front, on top, and the front face is still turned.',
      'Finished: the edge is in its slot and the white layer is whole.'
    ],
    left: [
      'Not started: the edge makes the upside-down T at the front and the white layer is whole.',
      'The edge has stepped away to the top-right. The white layer is still whole.',
      'The edge is at the top-right and the white corner has come up to the top-front-left, white facing you.',
      'The edge is back at the front. The white corner is on top at the back-left.',
      'The first half is done: the edge is at the front and the white corner sits right next to it at the top-front-left, white facing left.',
      'The pair (edge and white corner together) has stepped aside: edge at the top-left, corner at the top-back-left.',
      'The front face is turned: the white cross has a piece out. The pair is still waiting on the left.',
      'The pair is back at the front, on top, and the front face is still turned.',
      'Finished: the edge is in its slot and the white layer is whole.'
    ]
  };
  function whereText(alg, k) { return (WHERE[alg] || [])[k] || null; }

  // ------------------------------------------------------------------ groups and drills
  var GROUPS = [
    { id: 1, name: 'See it', problem: "I don't know what to do", desc: 'Spot the right edge, make the upside-down T, choose left or right.' },
    { id: 2, name: 'Remember it', problem: "I can't remember the moves", desc: 'Two halves of four moves each, and left is the mirror of right.' },
    { id: 3, name: 'Stuck edges', problem: 'An edge is stuck', desc: 'Edges in the wrong slot or flipped, and what to do when no top edge fits.' },
    { id: 4, name: 'Keep your place', problem: 'I lose my place', desc: 'What the cube looks like half-way, and how to recover from a slip.' },
    { id: 5, name: 'Put it together', problem: 'Put it together', desc: 'Whole middle layers, on the virtual cube or your real one.' }
  ];
  function D(id, group, name, desc, kind, needsCube, route) {
    var d = { id: id, group: group, groupName: GROUPS[group - 1].name, name: name, desc: desc, kind: kind, needsCube: needsCube };
    if (route) d.route = route;
    return d;
  }
  var DRILLS = [
    D('spot', 1, 'Spot the middle edges', 'Tap every top edge with no yellow on it, or "none" if every one has yellow.', 'multi', false),
    D('lineup', 1, 'Make the T', 'Which turn of the top puts the edge right above its matching centre?', 'tap', false),
    D('leftright', 1, 'Left or right?', 'The T is made: does the edge go left or right? A speed round.', 'tap', false),
    D('decide', 1, 'The whole decision', 'Which edge, which centre in front, which turn, which way: four quick taps.', 'sequence', false),
    D('halves', 2, 'Learn it in halves', 'Each algorithm as two halves of four moves, with a rhythm. Watch each half, then predict the moves.', 'walkthrough', false),
    D('nextmove', 2, 'What comes next?', 'Part-way through an algorithm: pick the next move.', 'tap', false),
    D('mirror', 2, 'Mirror it', 'Build the left algorithm from the right one (and back): swap R and L, turn every move the other way.', 'sequence', false),
    D('recall', 2, 'From memory', 'Do the algorithm on the virtual cube while the cues fade away.', 'perform', 'virtual'),
    D('stuck-spot', 3, 'Is it stuck?', 'Look at a middle edge: is it home, flipped in its own slot, or in the wrong slot?', 'tap', false),
    D('stuck-fix', 3, 'Pop it out', 'No usable edge on top: choose how to free the stuck edge, then do it.', 'perform', 'virtual'),
    D('landmark', 4, 'Checkpoints', 'Pick the picture that shows the cube after the first half, or at the end.', 'tap', false),
    D('whereami', 4, 'Where am I?', 'A cube part-way through an algorithm: how far along is it, and what comes next?', 'tap', false),
    D('slip', 4, 'Fix a slip', 'One move went wrong. Undo it and finish the algorithm properly.', 'perform', 'virtual'),
    D('slowmo', 4, 'Slow motion', 'With your real cube: one move at a time, with a checkpoint picture after each half.', 'walkthrough', 'real'),
    D('full-virtual', 5, 'Whole middle layer: virtual', 'Solve all four middle edges on the virtual cube, with hints if you ask.', 'route', 'virtual',
      { id: 'solve', params: { device: 'virtual', source: 'drill', stage: 'middle' } }),
    D('full-real', 5, 'Whole middle layer: real cube', 'A scramble that only mixes the middle layer, for your real cube, then a coached solve.', 'route', 'real',
      { id: 'solve', params: { device: 'physical', source: 'drill', stage: 'middle' } }),
    D('sprint', 5, 'Four-edge sprint', 'Place all four middle edges on the virtual cube against the clock. No hints.', 'perform', 'virtual')
  ];
  var BY_ID = {};
  DRILLS.forEach(function (d) { BY_ID[d.id] = d; });
  function drill(id) { return BY_ID[id] || null; }

  // ------------------------------------------------------------------ lazy libraries
  function lookup(name, file) {
    var x = root.CC && root.CC[name];
    if (!x && typeof require === 'function') {
      try { require(file); } catch (e) { /* not in node */ }
      x = root.CC && root.CC[name];
    }
    if (!x) throw new Error('CC.Gym needs CC.' + name + ' — load ' + file.replace('./', 'js/') + ' first.');
    return x;
  }
  function Cube() { return lookup('Cube', './cube.js'); }
  function Solver() { return lookup('Solver', './solver.js'); }

  var K = null;   // cache built on first use
  function lib() {
    if (K) return K;
    var C = Cube();
    var k = { C: C, LEARN: C.applyAlg(C.solved(), 'z2'), P: {} };
    k.perm = function (alg) {
      var key = Array.isArray(alg) ? alg.join(' ') : String(alg);
      if (!k.P[key]) k.P[key] = C.algPerm(alg);
      return k.P[key];
    };
    // Blocks that keep the white layer and every other slot: an algorithm (or its inverse)
    // aimed at one slot, plus U turns and last-layer algorithms.
    k.slotBlocks = {};
    SLOTS.forEach(function (sl) {
      var fr = ROT_TO_FR[sl], fl = ROT_TO_FL[sl];
      k.slotBlocks[sl] = [
        k.perm(fr.concat(RIGHT, invY(fr))), k.perm(fr.concat(C.invertAlg(RIGHT), invY(fr))),
        k.perm(fl.concat(LEFT, invY(fl))), k.perm(fl.concat(C.invertAlg(LEFT), invY(fl)))
      ];
    });
    k.topBlocks = [k.perm('U'), k.perm("U'"), k.perm('U2')];
    ["F R U R' U' F'", "R U R' U R U2 R'", "U R U' L' U R' U' L"].forEach(function (a) {
      ['', 'y', "y'", 'y2'].forEach(function (r) { k.topBlocks.push(k.perm(r ? r + ' ' + a + ' ' + invY([r]).join(' ') : a)); });
    });
    K = k;
    return k;
  }

  // ------------------------------------------------------------------ geometry helpers
  var SLOTS = ['FR', 'FL', 'BL', 'BR'];
  var SLOT_STK = { FR: [23, 12], FL: [21, 41], BL: [50, 39], BR: [48, 14] };     // [F/B sticker, R/L sticker]
  var SLOT_FACES = { FR: ['F', 'R'], FL: ['F', 'L'], BL: ['B', 'L'], BR: ['B', 'R'] };
  var SLOT_WORDS = { FR: 'front-right', FL: 'front-left', BL: 'back-left', BR: 'back-right' };
  var ROT_TO_FR = { FR: [], FL: ["y'"], BL: ['y2'], BR: ['y'] };                // brings that slot to the front-right
  var ROT_TO_FL = { FL: [], FR: ['y'], BR: ['y2'], BL: ["y'"] };                // brings that slot to the front-left
  var TOP = [
    { pos: 'UF', st: [7, 19], label: 'Front' },
    { pos: 'UR', st: [5, 10], label: 'Right' },
    { pos: 'UB', st: [1, 46], label: 'Back' },
    { pos: 'UL', st: [3, 37], label: 'Left' }
  ];
  var TOP_WORDS = { UF: 'front', UR: 'right', UB: 'back', UL: 'left' };
  var FACE_IDX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  var U_TURNS = [[], ['U'], ["U'"], ['U2']];
  var PAD = ['U', "U'", 'R', "R'", 'L', "L'", 'F', "F'"];

  function invY(toks) { return toks.slice().reverse().map(function (t) { return t.slice(-1) === "'" ? t.slice(0, -1) : t.slice(-1) === '2' ? t : t + "'"; }); }
  function applyP(s, p) { var o = new Array(54); for (var i = 0; i < 54; i++) o[p[i]] = s[i]; return o; }
  function ap(s, alg) { return lib().C.applyAlg(s, alg); }
  function centre(s, face) { return s[FACE_IDX[face] * 9 + 4]; }
  function cn(c) { return lib().C.COLOR_NAME[c] || c; }
  function CN(c) { return cn(c).toUpperCase(); }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function pair(a, b) { return cn(a) + '–' + cn(b); }
  function str(s) { return s.join(''); }
  function hasY(cols) { return cols.indexOf('Y') !== -1; }

  // Status of the edge in a middle slot (as held): home | flipped | wrong-slot | yellow
  function slotStatus(s, sl) {
    var st = SLOT_STK[sl], f = SLOT_FACES[sl], a = s[st[0]], b = s[st[1]];
    if (a === 'Y' || b === 'Y') return 'yellow';
    var ca = centre(s, f[0]), cb = centre(s, f[1]);
    if (a === ca && b === cb) return 'home';
    if (a === cb && b === ca) return 'flipped';
    return 'wrong-slot';
  }
  function unsolvedSlots(s) { return SLOTS.filter(function (sl) { return slotStatus(s, sl) !== 'home'; }); }
  function homeSlotCols(s, except) {
    var out = [];
    SLOTS.forEach(function (sl) {
      var st = SLOT_STK[sl];
      if (slotStatus(s, sl) !== 'home') return;
      var cols = [s[st[0]], s[st[1]]];
      if (except && sameSet(cols, except)) return;
      out.push(cols);
    });
    return out;
  }
  function sameSet(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) !== -1; }); }
  // Top edges with no yellow: [{ pos, label, st, side, top }]
  function usableTop(s) {
    return TOP.filter(function (e) { return !hasY([s[e.st[0]], s[e.st[1]]]); })
      .map(function (e) { return { pos: e.pos, label: e.label, st: e.st, top: s[e.st[0]], side: s[e.st[1]] }; });
  }
  function whiteLayerWhole(s) {
    var Sv = Solver();
    return Sv.check.corners(s);
  }
  // Stickers of the edge with colours a/b and the white corner that belongs with it.
  function pieceStickers(s, a, b) {
    var C = lib().C, e = C.findEdge(s, a, b), k = C.findCorner(s, 'W', a, b), out = [];
    if (e) out = out.concat(e.stickers);
    if (k) out = out.concat(k.stickers);
    return out;
  }
  function edgeStickers(s, a, b) { var e = lib().C.findEdge(s, a, b); return e ? e.stickers.slice() : []; }

  // ------------------------------------------------------------------ randomness
  function hashStr(t) { var h = 2166136261; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngFor(seed, salt) {
    var s0 = seed == null ? Math.floor(Math.random() * 4294967296) : (Number(seed) >>> 0);
    return lib().C.mulberry32((s0 ^ hashStr(salt)) >>> 0);
  }
  function int(rnd, n) { return Math.floor(rnd() * n); }
  function pick(rnd, arr) { return arr[int(rnd, arr.length)]; }
  function shuffle(rnd, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = int(rnd, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pickSlots(rnd, n) { return shuffle(rnd, SLOTS).slice(0, n); }

  // A random state that keeps the white layer, disturbing only the given slots (learning frame).
  function walk(rnd, slots, steps) {
    var k = lib(), s = k.LEARN;
    for (var i = 0; i < steps; i++) {
      if (slots.length && rnd() < 0.6) s = applyP(s, pick(rnd, k.slotBlocks[pick(rnd, slots)]));
      else s = applyP(s, pick(rnd, k.topBlocks));
    }
    return s;
  }
  function rotY(rnd, s) { var r = pick(rnd, [[], ['y'], ["y'"], ['y2']]); return r.length ? ap(s, r) : s; }

  // A middle-stage state with the edge for one slot lined up as the upside-down T at the front,
  // ready for the given algorithm (built by un-doing that algorithm from a solved slot).
  function tState(rnd, alg) {
    var C = lib().C, target = pick(rnd, SLOTS), others = SLOTS.filter(function (x) { return x !== target; });
    var nOther = pick(rnd, [0, 1, 1, 2, 2, 3]);
    var base = walk(rnd, pickSlots2(rnd, others, nOther), 3 + 3 * nOther);
    var held = ap(base, (alg === 'right' ? ROT_TO_FR : ROT_TO_FL)[target]);
    var s = ap(held, C.invertAlg(ALGS[alg].moves));
    var side = s[19], top = s[7];
    return { state: s, side: side, top: top, keep: homeSlotCols(s, [side, top]), alg: alg };
  }
  function pickSlots2(rnd, pool, n) { return shuffle(rnd, pool).slice(0, n); }

  // ------------------------------------------------------------------ item helpers
  function moveOption(t) { return { id: t, label: t, sub: lib().C.moveInfo(t).text }; }
  var TURN_IDS = ['U', "U'", 'U2', 'none'];
  function turnOptions() {
    return TURN_IDS.map(function (t) {
      return t === 'none' ? { id: 'none', label: 'No turn', sub: 'It is already above its centre' } : moveOption(t);
    });
  }
  // The U turn (as an option id) that brings the top edge at `pos` to the front.
  function turnFor(s, a, b) {
    var C = lib().C;
    for (var i = 0; i < 4; i++) {
      var e = C.findEdge(ap(s, U_TURNS[i]), a, b);
      if (e && e.name === 'UF') return U_TURNS[i].length ? U_TURNS[i][0] : 'none';
    }
    return null;
  }
  function sideOf(s) {   // with the T made at the front: which way does the edge go?
    if (s[7] === centre(s, 'R')) return 'right';
    if (s[7] === centre(s, 'L')) return 'left';
    return null;
  }
  var SIDE_OPTIONS = [{ id: 'left', label: '← Left', sub: "U' L' U L U F U' F'" }, { id: 'right', label: 'Right →', sub: "U R U' R' U' F' U F" }];
  // 3 distractor moves for a "what comes next" question (all different from the answer).
  function moveChoices(rnd, alg, answer) {
    var pool = [mirrorMove(answer), lib().C.invertMove(answer)].concat(shuffle(rnd, ALGS[alg].moves.concat(PAD)));
    var out = [answer];
    pool.forEach(function (t) { if (out.length < 4 && out.indexOf(t) === -1) out.push(t); });
    return shuffle(rnd, out).map(moveOption);
  }
  function lcFirst(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
  function listAnd(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function withWhy(opts, fn) { opts.forEach(function (o) { var w = fn(o.id); if (w) o.why = w; }); return opts; }
  // Why a wrong move is wrong as move k+1 of `alg` ("what comes next?" questions).
  function moveWhy(alg, k, t) {
    var A = ALGS[alg], ans = A.moves[k], at = [];
    if (t === ans) return null;
    A.moves.forEach(function (m, i) { if (m === t) at.push(i + 1); });
    if (!at.length) {
      var O = ALGS[A.mirrorOf];
      return t + ' is not in the ' + A.name + ' algorithm: it only uses U, ' + (alg === 'right' ? 'R' : 'L') + ' and F.' +
        (O.moves.indexOf(t) !== -1 ? ' ' + t + ' belongs to the ' + O.name + ' algorithm' + (t === mirrorMove(ans) ? ' (it is the mirror of ' + ans + ').' : '.') : '');
    }
    if (t === lib().C.invertMove(ans)) return t + ' turns the other way. Move ' + (k + 1) + ' is ' + ans + ': ' + PLAIN[ans] + '.';
    var later = at.every(function (i) { return i > k + 1; }), earlier = at.every(function (i) { return i < k + 1; });
    var where = (at.length > 1 ? 'moves ' : 'move ') + listAnd(at.map(String));
    return t + (later ? ' comes later (' + where + ')' : earlier ? ' came earlier (' + where + ')' : ' is ' + where) + ', not move ' + (k + 1) + '.';
  }
  // Why a wrong turn of the top does not make the T (where it would really take the edge).
  function turnWhy(s, a, b, t, ans) {
    if (t === ans) return null;
    var e = lib().C.findEdge(ap(s, t === 'none' ? [] : [t]), a, b);
    return t === 'none' ? 'Not yet: the edge is at the ' + TOP_WORDS[e.name] + ' of the top layer, not at the front.'
      : t + ' would take it to the ' + TOP_WORDS[e.name] + ' of the top layer, not the front.';
  }
  function turnOptionsFor(s, a, b, ans) { return withWhy(turnOptions(), function (id) { return turnWhy(s, a, b, id, ans); }); }
  // With the T made at the front: why the other algorithm is wrong (it drops the edge into the other front slot).
  function sideWhy(s, side, chosen) {
    if (chosen === side) return null;
    return 'Its top colour is ' + cn(s[7]) + ', but the ' + chosen + ' centre is ' + cn(centre(s, chosen === 'right' ? 'R' : 'L')) + '. The ' +
      ALGS[chosen].name + ' algorithm would drop it into the front-' + chosen + ' slot, where it does not belong.';
  }
  function sideOptionsFor(s, side) { return withWhy(SIDE_OPTIONS.map(clone), function (id) { return sideWhy(s, side, id); }); }
  // A mirror question: given move g, its mirror m, the learner tapped c.
  function mirrorWhy(g, m, c) {
    if (c === m) return null;
    var C = lib().C, rl = /^[RL]/.test(g), from = g.charAt(0), to = m.charAt(0);
    if (c === g) return 'That is the move you were given. Mirror it: ' + (rl ? 'swap ' + from + ' for ' + to + ' and ' : '') + 'turn it the other way, so ' + g + ' becomes ' + m + '.';
    if (rl && c === C.invertMove(m)) return 'You swapped ' + from + ' for ' + to + '; now turn it the other way too: ' + m + '.';
    if (rl && c === C.invertMove(g)) return 'You turned it the other way; now swap ' + from + ' for ' + to + ' too: ' + m + '.';
    return 'The mirror of ' + g + ' is ' + m + '. ' + MIRROR_RULE;
  }
  function algSentence(alg) { return ALGS[alg].name + ' algorithm: ' + ALGS[alg].notation; }
  function rhythmSentence(alg) {
    var h = ALGS[alg].halves;
    return 'First half ' + h[0].moves.join(' ') + ' (' + h[0].rhythm + '), second half ' + h[1].moves.join(' ') + ' (' + h[1].rhythm + ').';
  }
  function base(drillId, extra) {
    var d = BY_ID[drillId];
    var it = { drillId: drillId, kind: d.kind, needsCube: d.needsCube, prompt: '', state: null, view: '3d', highlight: [],
      options: null, answer: null, explain: '' };
    Object.keys(extra).forEach(function (k) { it[k] = extra[k]; });
    return it;
  }

  // ------------------------------------------------------------------ generators
  // Each takes (rnd, level, concept) and returns an Item. `concept` is the sub-case the session
  // asks for (so a round spreads over all of them); null = choose at random.
  var CONCEPTS = {
    spot: ['0', '1', '2', '3', '4'],
    lineup: TURN_IDS.slice(),
    leftright: ['left', 'right'],
    decide: ['left', 'right'],
    halves: ['right', 'left'],
    nextmove: (function () { var o = []; ['right', 'left'].forEach(function (a) { for (var k = 0; k < 8; k++) o.push(a + '-' + k); }); return o; })(),
    mirror: ['move-U', "move-U'", 'move-R', "move-R'", 'move-L', "move-L'", 'move-F', "move-F'",
      'right-1', 'left-1', 'right-2', 'left-2', 'right-all', 'left-all'],
    recall: ['right', 'left'],
    'stuck-spot': ['fine', 'flipped', 'wrong-slot'],
    'stuck-fix': ['flipped', 'wrong-slot'],
    landmark: ['right-4', 'right-8', 'left-4', 'left-8'],
    whereami: (function () { var o = []; ['right', 'left'].forEach(function (a) { for (var k = 1; k < 8; k++) o.push(a + '-' + k + '-count', a + '-' + k + '-next'); }); return o; })(),
    slip: (function () { var o = []; ['right', 'left'].forEach(function (a) { for (var k = 0; k < 8; k++) o.push(a + '-' + k); }); return o; })(),
    slowmo: ['right', 'left'],
    'full-virtual': null, 'full-real': null, sprint: null
  };

  var GEN = {};

  GEN.spot = function (rnd, level, concept) {
    var want = concept != null ? +concept : int(rnd, 5);
    for (var a = 0; a < 5000; a++) {
      var d = want === 4 ? 4 : Math.max(want, 1 + int(rnd, 4));
      var s = rotY(rnd, walk(rnd, pickSlots(rnd, d), 4 + 3 * d));
      if (!unsolvedSlots(s).length) continue;
      var u = usableTop(s);
      if (u.length !== want) continue;
      var answer = u.length ? u.map(function (e) { return e.pos; }) : ['none'];
      var explain = u.length
        ? 'No yellow on ' + listAnd(u.map(function (e) { return 'the ' + TOP_WORDS[e.pos] + ' edge (' + pair(e.side, e.top) + ')'; })) +
          '. ' + (u.length > 1 ? 'Those belong' : 'That one belongs') + ' in the middle layer. Every edge with a yellow sticker belongs to the top layer, so leave it.'
        : 'Every top edge has a yellow sticker, so none of them belongs in the middle layer. That means a middle edge is stuck (in the wrong slot or flipped): hold it at the front-right and do the Right algorithm to pop it out.';
      return base('spot', {
        prompt: 'Tap every top edge that belongs in the middle layer (no yellow on it). If every one has yellow, tap "None of them".',
        state: s, view: 'top', selectable: TOP.map(function (e) { return e.pos; }),
        options: TOP.map(function (e) { return { id: e.pos, label: e.label + ' edge', stickers: e.st.slice() }; })
          .concat([{ id: 'none', label: 'None of them', sub: 'Every top edge has yellow: pop a stuck edge out' }]),
        answer: answer, explain: explain, concept: String(want)
      });
    }
    throw new Error('CC.Gym could not build a spot item');
  };

  GEN.lineup = function (rnd, level, concept) {
    var ans = concept || pick(rnd, TURN_IDS);
    var t = tState(rnd, pick(rnd, ['right', 'left']));
    var s = ans === 'none' ? t.state : ap(t.state, [lib().C.invertMove(ans)]);
    var e = lib().C.findEdge(s, t.side, t.top);
    var how = ans === 'none' ? 'It is already at the front with its ' + cn(t.side) + ' sticker right above the ' + cn(t.side) + ' centre: that is the upside-down T. No turn needed.'
      : 'The edge is at the ' + TOP_WORDS[e.name] + ' of the top layer. ' + ans + ' (' + lib().C.moveInfo(ans).text + ') brings it to the front, so its ' +
        cn(t.side) + ' sticker sits right above the ' + cn(t.side) + ' centre: the upside-down T.';
    return base('lineup', {
      prompt: CN(t.side) + ' is in front. Which turn of the top puts the highlighted ' + pair(t.side, t.top) + ' edge right above the ' + cn(t.side) + ' centre (the upside-down T)?',
      state: s, view: 'both', highlight: edgeStickers(s, t.side, t.top), options: turnOptionsFor(s, t.side, t.top, ans), answer: ans,
      explain: how, moves: ans === 'none' ? [] : [ans], edge: [t.side, t.top], concept: ans
    });
  };

  GEN.leftright = function (rnd, level, concept) {
    var alg = concept || pick(rnd, ['left', 'right']);
    var t = tState(rnd, alg), s = t.state;
    var side = alg === 'right' ? 'right' : 'left';
    return base('leftright', {
      prompt: 'The upside-down T is made. Does the ' + pair(t.side, t.top) + ' edge go left or right?' + (level >= 2 ? '' : ' Look at its top colour.'),
      state: s, view: '3d', highlight: edgeStickers(s, t.side, t.top), options: sideOptionsFor(s, side), answer: side,
      explain: 'Its top colour is ' + cn(t.top) + ', the same as the ' + side + ' centre, so it goes ' + side + ': ' + ALGS[alg].notation + '.',
      alg: alg, moves: ALGS[alg].moves.slice(), targetState: ap(s, ALGS[alg].moves), edge: [t.side, t.top], concept: alg
    });
  };

  GEN.decide = function (rnd, level, concept) {
    var C = lib().C;
    for (var a = 0; a < 5000; a++) {
      var d = 1 + int(rnd, 4);
      var s = rotY(rnd, walk(rnd, pickSlots(rnd, d), 4 + 3 * d));
      var u = usableTop(s);
      if (u.length !== 1 || !unsolvedSlots(s).length) continue;
      var e = u[0], rot = C.yRotationTo(s, e.side), s2 = ap(s, rot);
      var turn = turnFor(s2, e.side, e.top), s3 = ap(s2, turn === 'none' ? [] : [turn]);
      var side = sideOf(s3);
      if (!side || (concept && side !== concept)) continue;
      var alg = side, sides = ['G', 'O', 'B', 'R'];
      var steps = [
        { id: 'edge', prompt: 'Which top edge goes in the middle layer?', state: s, view: 'top', highlight: [],
          options: TOP.map(function (x) {
            var o = { id: x.pos, label: x.label + ' edge', stickers: x.st.slice() };
            if (x.pos !== e.pos) o.why = 'The ' + TOP_WORDS[x.pos] + ' edge has a yellow sticker, so it belongs in the top layer.';
            return o;
          }), answer: e.pos,
          explain: 'Only the ' + TOP_WORDS[e.pos] + ' edge (' + pair(e.side, e.top) + ') has no yellow, so that is the one.' },
        { id: 'centre', prompt: 'Its side sticker is the one on the side of the cube (not on top). Which centre do you turn to face you?', state: s, view: '3d',
          highlight: edgeStickers(s, e.side, e.top),
          options: sides.map(function (c) {
            var o = { id: c, label: cap(cn(c)) + ' centre' };
            if (c !== e.side) o.why = c === e.top ? cap(cn(c)) + ' is its top colour: that tells you left or right later. Put its side colour (' + cn(e.side) + ') in front.'
              : cap(cn(c)) + ' is not on this edge at all: it is ' + cn(e.side) + ' on the side and ' + cn(e.top) + ' on top.';
            return o;
          }), answer: e.side,
          explain: 'Its side sticker is ' + cn(e.side) + ', so the ' + cn(e.side) + ' centre goes in front' + (rot.length ? ' (' + rot.join(' ') + ': ' + C.moveInfo(rot[0]).how + ').' : ' (it already is).') },
        { id: 'turn', prompt: CN(e.side) + ' is in front. Which turn of the top makes the upside-down T?', state: s2, view: 'both',
          highlight: edgeStickers(s2, e.side, e.top), options: turnOptionsFor(s2, e.side, e.top, turn), answer: turn,
          explain: turn === 'none' ? 'It is already right above the ' + cn(e.side) + ' centre.' : turn + ' brings it to the front, right above the ' + cn(e.side) + ' centre.' },
        { id: 'side', prompt: 'The T is made. Left or right?', state: s3, view: '3d', highlight: edgeStickers(s3, e.side, e.top),
          options: sideOptionsFor(s3, side), answer: side,
          explain: 'Its top colour is ' + cn(e.top) + ', the same as the ' + side + ' centre: ' + ALGS[alg].notation + '.' }
      ];
      var moves = rot.concat(turn === 'none' ? [] : [turn], ALGS[alg].moves);
      return base('decide', {
        prompt: 'Make the whole decision: which edge, which centre in front, which turn, which way.',
        state: s, view: 'both', steps: steps, options: null, answer: steps.map(function (x) { return x.answer; }),
        explain: steps.map(function (x) { return x.explain; }).join(' '), alg: alg, moves: moves, targetState: ap(s, moves),
        edge: [e.side, e.top], concept: side
      });
    }
    throw new Error('CC.Gym could not build a decide item');
  };

  GEN.halves = function (rnd, level, concept) {
    var alg = concept || pick(rnd, ['right', 'left']);
    var t = tState(rnd, alg), A = ALGS[alg], s = t.state, steps = [];
    for (var i = 0; i < 8; i++) {
      var tok = A.moves[i], half = i < 4 ? 0 : 1, before = ap(s, A.moves.slice(0, i)), after = ap(before, [tok]);
      steps.push({
        index: i, half: half, token: tok, plain: PLAIN[tok], word: A.halves[half].rhythm.split(', ')[i % 4],
        ask: level >= 2 || i % 4 !== 0,
        prompt: (i % 4 === 0 ? A.halves[half].name + '. ' : '') + 'Move ' + (i + 1) + ' of 8: what comes next?',
        options: withWhy(moveChoices(rnd, alg, tok), moveWhy.bind(null, alg, i)), answer: tok, state: before, stateAfter: after,
        highlight: pieceStickers(before, t.side, t.top),
        explain: tok + ': ' + PLAIN[tok] + ' ("' + A.halves[half].rhythm.split(', ')[i % 4] + '").'
      });
    }
    return base('halves', {
      prompt: 'Learn the ' + A.name + ' algorithm in two halves. Watch each half, then predict the moves.' + (level >= 2 ? '' : ' The first move of each half is shown for you.'),
      state: s, view: '3d', highlight: pieceStickers(s, t.side, t.top), alg: alg, halves: A.halves, moves: A.moves.slice(),
      steps: steps, answer: steps.map(function (x) { return x.ask ? x.answer : null; }),
      halfStates: [s, ap(s, A.moves.slice(0, 4)), ap(s, A.moves)], targetState: ap(s, A.moves),
      landmarks: LANDMARKS[alg], explain: algSentence(alg) + '. ' + rhythmSentence(alg) + ' ' + A.halves[1].link, edge: [t.side, t.top], concept: alg
    });
  };

  GEN.nextmove = function (rnd, level, concept) {
    var c = (concept || (pick(rnd, ['right', 'left']) + '-' + int(rnd, 8))).split('-'), alg = c[0], k = +c[1];
    var t = tState(rnd, alg), A = ALGS[alg], s = ap(t.state, A.moves.slice(0, k)), tok = A.moves[k], half = k < 4 ? 0 : 1;
    return base('nextmove', {
      prompt: A.name + ' algorithm (edge going to the ' + A.slot + '). ' +
        (k ? 'Done so far: ' + A.moves.slice(0, k).join(' ') + '. What is the next move?' : 'What is the first move?'),
      state: s, view: '3d', highlight: pieceStickers(s, t.side, t.top), options: withWhy(moveChoices(rnd, alg, tok), moveWhy.bind(null, alg, k)), answer: tok, alg: alg,
      done: A.moves.slice(0, k), moves: A.moves.slice(k), startState: t.state,
      explain: 'Next is ' + tok + ' (' + PLAIN[tok] + '). ' + A.halves[half].name + ': ' + A.halves[half].moves.join(' ') + ' — "' + A.halves[half].rhythm + '".',
      edge: [t.side, t.top], concept: alg + '-' + k
    });
  };

  GEN.mirror = function (rnd, level, concept) {
    concept = concept || pick(rnd, CONCEPTS.mirror);
    var C = lib().C, given, from, to, what;
    if (concept.indexOf('move-') === 0) {
      given = [concept.slice(5)];
      from = 'right'; to = 'left'; what = 'the move ' + given[0];
    } else {
      var c = concept.split('-'); from = c[0]; to = from === 'right' ? 'left' : 'right';
      var part = c[1], A = ALGS[from];
      given = part === 'all' ? A.moves.slice() : A.halves[+part - 1].moves.slice();
      what = part === 'all' ? 'the whole ' + A.name + ' algorithm' : 'the ' + (part === '1' ? 'first' : 'second') + ' half of the ' + A.name + ' algorithm';
    }
    var answer = mirror(given);
    var t = tState(rnd, to), s = t.state;
    var pad = PAD.map(moveOption);
    var steps = answer.map(function (tok, i) {
      return { index: i, prompt: 'Move ' + (i + 1) + ' of ' + answer.length, answer: tok,
        options: withWhy(pad.map(clone), function (id) { return mirrorWhy(given[i], tok, id); }),
        explain: given[i] + ' mirrors to ' + tok + '.' };
    });
    var target = concept.indexOf('move-') === 0 ? 'its mirror' : 'its mirror, ' + (concept.slice(-3) === 'all' ? 'the whole ' + ALGS[to].name + ' algorithm' : 'the same half of the ' + ALGS[to].name + ' algorithm');
    return base('mirror', {
      prompt: 'Here is ' + what + (given.length > 1 ? ': ' + given.join(' ') : '') + '. Tap ' + target + '.' + (level >= 2 ? '' : ' ' + MIRROR_RULE),
      state: s, view: '3d', options: pad, answer: answer, steps: steps, given: given, alg: to,
      moves: concept.indexOf('move-') === 0 ? null : answer.slice(),
      explain: given.join(' ') + ' → ' + answer.join(' ') + '. ' + MIRROR_RULE + ' So there is really only one algorithm to remember. ' + MIRROR_FEEL,
      concept: concept
    });
  };

  var CUES = { 1: [1, 1, 1, 1, 1, 1, 1, 1], 2: [1, 0, 1, 0, 1, 0, 1, 0], 3: [1, 0, 0, 0, 0, 0, 0, 0], 4: [0, 0, 0, 0, 0, 0, 0, 0] };
  GEN.recall = function (rnd, level, concept) {
    var alg = concept || pick(rnd, ['right', 'left']), lv = Math.max(1, Math.min(4, level || 1));
    var t = tState(rnd, alg), s = t.state, A = ALGS[alg];
    var cueText = { 1: 'All the moves are shown.', 2: 'Every other move is hidden.', 3: 'Only the first move is shown.', 4: 'No help: all from memory.' }[lv];
    return base('recall', {
      prompt: 'The ' + pair(t.side, t.top) + ' edge goes ' + alg + '. Do the ' + A.name + ' algorithm on the virtual cube. ' + cueText,
      state: s, view: '3d', highlight: edgeStickers(s, t.side, t.top), alg: alg, moves: A.moves.slice(),
      cues: CUES[lv].map(Boolean), level: lv, targetState: ap(s, A.moves),
      goal: { kind: 'insert', edge: [t.side, t.top], keep: t.keep },
      explain: algSentence(alg) + '. ' + rhythmSentence(alg), edge: [t.side, t.top], concept: alg
    });
  };

  var STUCK_OPTIONS = [
    { id: 'fine', label: 'Home: it is fine', sub: 'Both colours match the centres next to it' },
    { id: 'flipped', label: 'Flipped in its own slot', sub: 'Right slot, colours the wrong way round' },
    { id: 'wrong-slot', label: 'In the wrong slot', sub: 'Its colours belong somewhere else' }
  ];
  GEN['stuck-spot'] = function (rnd, level, concept) {
    var want = concept || pick(rnd, ['fine', 'flipped', 'wrong-slot']);
    for (var a = 0; a < 5000; a++) {
      var d = 1 + int(rnd, 4);
      var s = rotY(rnd, walk(rnd, pickSlots(rnd, d), 4 + 3 * d));
      if (!unsolvedSlots(s).length) continue;
      var cands = SLOTS.filter(function (sl) { return slotStatus(s, sl) === (want === 'fine' ? 'home' : want); });
      if (!cands.length) continue;
      var sl = pick(rnd, cands), h = ap(s, ROT_TO_FR[sl]);
      var a0 = h[23], b0 = h[12], cF = centre(h, 'F'), cR = centre(h, 'R');
      var explain = want === 'fine'
        ? 'Its colours (' + cn(a0) + ' and ' + cn(b0) + ') match the centres next to it: ' + cn(cF) + ' in front, ' + cn(cR) + ' on the right. It is home: leave it.'
        : want === 'flipped'
          ? 'It belongs in this slot (its colours, ' + cn(a0) + ' and ' + cn(b0) + ', are the centres either side) but it is the wrong way round: its ' +
            cn(a0) + ' sticker is on the front, next to the ' + cn(cF) + ' centre. It is flipped. Place any top edges that fit first; once none fit, pop it out: ' +
            'do the Right algorithm once from here, then put it back the right way round.'
          : 'It is the ' + pair(a0, b0) + ' edge, but the centres either side are ' + cn(cF) + ' and ' + cn(cR) + ': it belongs in a different slot. ' +
            'Place any top edges that fit first (if this slot\'s own edge is on top, putting it in knocks this one out for you); once none fit, pop it out: ' +
            'do the Right algorithm once from here, then put it where it belongs.';
      var miss = a0 !== cF ? [a0, cF] : [b0, cR];
      var notHome = 'Its ' + cn(miss[0]) + ' sticker is next to the ' + cn(miss[1]) + ' centre: they do not match, so it is not home.';
      var whys = {
        fine: { flipped: 'Look again: its ' + cn(a0) + ' sticker is next to the ' + cn(cF) + ' centre and its ' + cn(b0) + ' sticker next to the ' + cn(cR) + ' centre. Both match, so it is home.' },
        flipped: { fine: notHome, 'wrong-slot': 'Its two colours, ' + cn(a0) + ' and ' + cn(b0) + ', are the two centres either side of this slot, so it does belong here, just the wrong way round.' },
        'wrong-slot': { fine: notHome, flipped: 'Flipped would mean ' + cn(cF) + ' and ' + cn(cR) + ' the wrong way round, but this edge is ' + pair(a0, b0) + ': it belongs in a different slot.' }
      }[want];
      if (want === 'fine') whys['wrong-slot'] = whys.flipped;
      return base('stuck-spot', {
        prompt: 'Look at the highlighted middle edge (front-right). Is it home, flipped in its own slot, or in the wrong slot?',
        state: h, view: '3d', highlight: [23, 12], slot: 'FR', options: withWhy(STUCK_OPTIONS.map(clone), function (id) { return whys[id] || null; }), answer: want,
        explain: explain, moves: want === 'fine' ? null : RIGHT.slice(), edge: [a0, b0], concept: want
      });
    }
    throw new Error('CC.Gym could not build a stuck-spot item');
  };

  var FIX_OPTIONS = {
    'right-at-fr': { id: 'right-at-fr', label: 'Hold it at the front-right, do the Right algorithm', sub: 'Whatever edge is on top' },
    'right-at-fl': { id: 'right-at-fl', label: 'Hold it at the front-left, do the Right algorithm',
      why: 'The Right algorithm only changes the front-right slot: with the stuck edge at the front-left it stays exactly where it is.' },
    'left-at-fr': { id: 'left-at-fr', label: 'Hold it at the front-right, do the Left algorithm',
      why: 'The Left algorithm only changes the front-left slot: the stuck edge at the front-right stays exactly where it is.' },
    'turn-top': { id: 'turn-top', label: 'Keep turning the top until a good edge shows up',
      why: 'Turning the top never changes which edges are on top: every one of them still has yellow.' }
  };
  GEN['stuck-fix'] = function (rnd, level, concept) {
    var want = concept || pick(rnd, ['flipped', 'wrong-slot']);
    for (var a = 0; a < 20000; a++) {
      var d = 1 + int(rnd, 3);
      var s0 = walk(rnd, pickSlots(rnd, d), 4 + 3 * d);
      if (usableTop(s0).length) continue;
      var s = rotY(rnd, s0);
      var cands = SLOTS.filter(function (sl) { return slotStatus(s, sl) === want; });
      if (!cands.length) continue;
      var sl = pick(rnd, cands), st = SLOT_STK[sl], cols = [s[st[0]], s[st[1]]];
      var moves = ROT_TO_FR[sl].concat(RIGHT);
      var opts = shuffle(rnd, Object.keys(FIX_OPTIONS)).map(function (k) { return clone(FIX_OPTIONS[k]); });
      return base('stuck-fix', {
        prompt: 'Every top edge has yellow, but the ' + pair(cols[0], cols[1]) + ' edge at the ' + SLOT_WORDS[sl] + ' is stuck (' +
          (want === 'flipped' ? 'flipped in its own slot' : 'in the wrong slot') + '). How do you get it out?',
        performPrompt: 'Now do it on the virtual cube: ' + (ROT_TO_FR[sl].length
          ? 'turn the whole cube so that slot is at the front-right (' + ROT_TO_FR[sl][0] + ': ' + lib().C.moveInfo(ROT_TO_FR[sl][0]).how + '), then '
          : 'it is already at the front-right, so just ') + 'do the Right algorithm once.',
        state: s, view: '3d', highlight: st.slice(), slot: sl, options: opts, answer: 'right-at-fr',
        moves: moves, targetState: ap(s, moves), goal: { kind: 'popout', edge: cols, keep: homeSlotCols(s, cols) },
        explain: 'Hold the stuck slot at the front-right and do the Right algorithm once, whatever edge is on top: it swaps the stuck edge up into the top layer, and then you put it back properly like any other edge. ' +
          'The Right algorithm only changes the front-right slot and the Left one only the front-left slot, so the stuck slot has to be in the right place. Turning the top never changes which edges are on top.',
        edge: cols, stuck: want, concept: want
      });
    }
    throw new Error('CC.Gym could not build a stuck-fix item');
  };

  function landmarkFacts(alg, after) { return LANDMARKS[alg][after === 4 ? 0 : 1].facts; }
  GEN.landmark = function (rnd, level, concept) {
    var c = (concept || pick(rnd, CONCEPTS.landmark)).split('-'), alg = c[0], after = +c[1];
    var other = alg === 'right' ? 'left' : 'right', C = lib().C;
    for (var a = 0; a < 200; a++) {
      var t = tState(rnd, alg), s = t.state, A = ALGS[alg].moves;
      var correct = ap(s, A.slice(0, after)), pool;
      if (after === 4) {
        pool = [
          { why: 'That one already looks finished — but half-way the white layer has a gap.', state: ap(s, A) },
          { why: 'That is the other algorithm\'s first half: the white corner popped up on the wrong side.', state: ap(s, ALGS[other].moves.slice(0, 4)) },
          { why: 'That is the cube before you started.', state: s }
        ];
      } else {
        var slipAt = pick(rnd, [5, 7]), slipped = A.slice(); slipped[slipAt] = C.invertMove(slipped[slipAt]);
        pool = [
          { why: 'That is only half-way: the white layer still has a gap.', state: ap(s, A.slice(0, 4)) },
          { why: 'That is the ' + ALGS[other].name + ' algorithm: the edge went into the wrong slot.', state: ap(s, ALGS[other].moves) },
          { why: 'That one has a slip in the second half (' + slipped[slipAt] + ' instead of ' + A[slipAt] + '): the white layer is broken.', state: ap(s, slipped) }
        ];
      }
      pool = pool.filter(function (x) { return !matchesLandmark(x.state, alg, after, t); });
      if (pool.length < 2) continue;
      var chosen = shuffle(rnd, pool).slice(0, 2);
      var all = [{ ok: true, state: correct }].concat(chosen);
      var keys = all.map(function (x) { return str(x.state); });
      if (keys[0] === keys[1] || keys[0] === keys[2] || keys[1] === keys[2]) continue;
      all = shuffle(rnd, all);
      var ids = ['a', 'b', 'c'], answer = null;
      var options = all.map(function (x, i) {
        if (x.ok) answer = ids[i];
        return { id: ids[i], label: 'Picture ' + ids[i].toUpperCase(), state: x.state, highlight: pieceStickers(x.state, t.side, t.top), why: x.ok ? null : x.why };
      });
      var L = LANDMARKS[alg][after === 4 ? 0 : 1];
      return base('landmark', {
        prompt: ALGS[alg].name + ' algorithm. Which picture shows the cube ' + (after === 4 ? 'after the first half (' + A.slice(0, 4).join(' ') + ')?' : 'after all eight moves?'),
        state: s, view: '3d', highlight: pieceStickers(s, t.side, t.top), options: options, answer: answer, alg: alg, after: after,
        explain: L.text + (L.note ? ' ' + L.note : ''), moves: A.slice(0, after), targetState: correct,
        edge: [t.side, t.top], concept: alg + '-' + after
      });
    }
    throw new Error('CC.Gym could not build a landmark item');
  };
  // Does state `s` show the landmark for `after` moves of `alg`, for the T described by t?
  function matchesLandmark(s, alg, after, t) {
    var C = lib().C, f = landmarkFacts(alg, after);
    var e = C.findEdge(s, t.side, t.top), k = C.findCorner(s, 'W', t.side, t.top);
    if (!e || !k || e.name !== f.edge || k.name !== f.corner) return false;
    if (k.faces[0] !== f.white) return false;
    if (whiteLayerWhole(s) !== f.whiteLayer) return false;
    if (after === 4) return e.faces[0] === 'F' && e.faces[1] === 'U';
    if (!edgeHome(s, t.side, t.top)) return false;
    return t.keep.every(function (p) { return edgeHome(s, p[0], p[1]); });
  }
  function edgeHome(s, a, b) {
    var C = lib().C, e = C.findEdge(s, a, b);
    if (!e) return false;
    return s[e.stickers[0]] === centre(s, e.faces[0]) && s[e.stickers[1]] === centre(s, e.faces[1]);
  }

  GEN.whereami = function (rnd, level, concept) {
    var c = (concept || pick(rnd, CONCEPTS.whereami)).split('-'), alg = c[0], k = +c[1], type = c[2];
    var t = tState(rnd, alg), A = ALGS[alg], s = ap(t.state, A.moves.slice(0, k)), options, answer;
    if (type === 'count') {
      var others = shuffle(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(function (x) { return x !== k; })).slice(0, 3);
      options = [k].concat(others).sort(function (x, y) { return x - y; }).map(function (n) {
        var o = { id: String(n), label: n === 1 ? '1 move' : n + ' moves', sub: n ? A.moves.slice(0, n).join(' ') : 'Not started' };
        if (n !== k) {
          o.why = n === 0 ? '0 moves would look exactly like the "before" picture.'
            : n === 8 ? '8 moves would mean you had finished: the edge in its slot and the white layer whole.'
              : (n === 1 ? '1 move' : n + ' moves') + ' would look different: ' + lcFirst(WHERE[alg][n]);
        }
        return o;
      });
      answer = String(k);
    } else {
      options = withWhy(moveChoices(rnd, alg, A.moves[k]), moveWhy.bind(null, alg, k));
      answer = A.moves[k];
    }
    return base('whereami', {
      prompt: 'You started the ' + A.name + ' algorithm with the ' + pair(t.side, t.top) + ' edge in the T at the front, then lost track. ' +
        (type === 'count' ? 'Looking at the cube, how many moves have you done?' : 'Looking at the cube, what is your next move?'),
      state: s, startState: t.state, view: '3d', highlight: pieceStickers(s, t.side, t.top), options: options, answer: answer, alg: alg,
      done: A.moves.slice(0, k), moves: A.moves.slice(k), targetState: ap(t.state, A.moves), question: type,
      explain: 'You have done ' + k + (k === 1 ? ' move' : ' moves') + ' (' + A.moves.slice(0, k).join(' ') + '): ' + lcFirst(WHERE[alg][k]) + ' Next is ' + A.moves[k] + '.',
      edge: [t.side, t.top], concept: alg + '-' + k + '-' + type
    });
  };

  GEN.slip = function (rnd, level, concept) {
    var C = lib().C, c = (concept || pick(rnd, CONCEPTS.slip)).split('-'), alg = c[0], j = +c[1];
    for (var a = 0; a < 200; a++) {
      var t = tState(rnd, alg), A = ALGS[alg].moves, s0 = t.state, should = A[j];
      var kinds = [{ w: C.invertMove(should), what: 'turned it the wrong way' }];
      if (/^[RL]/.test(should)) kinds.push({ w: mirrorMove(should), what: 'used the other side (the ' + (alg === 'right' ? 'Left' : 'Right') + ' algorithm\'s move)' });
      var sk = pick(rnd, kinds), w = sk.w;
      var done = A.slice(0, j).concat([w]), s = ap(s0, done);
      var goal = { kind: 'insert', edge: [t.side, t.top], keep: t.keep };
      var carryOn = ap(s, A.slice(j + 1));
      if (goalMet(goal, carryOn).ok) continue;   // the slip must really matter
      var moves = [C.invertMove(w)].concat(A.slice(j));
      return base('slip', {
        prompt: ALGS[alg].name + ' algorithm. You did ' + done.join(' ') + ' — but move ' + (j + 1) + ' should have been ' + should + ', not ' + w +
          '. Undo the slip and finish the algorithm.',
        state: s, startState: s0, view: '3d', highlight: pieceStickers(s, t.side, t.top), alg: alg, done: done, slipIndex: j, wrong: w, should: should,
        moves: moves, targetState: ap(s, moves), goal: goal,
        explain: 'Undo the slip first: ' + C.invertMove(w) + ' turns it back, so the cube is just as it was ' + (j ? 'after move ' + j : 'before you started') +
          '. Then carry on from move ' + (j + 1) + ': ' + A.slice(j).join(' ') + '. If you just carry on without undoing it, the edge does not go in properly.',
        edge: [t.side, t.top], concept: alg + '-' + j
      });
    }
    throw new Error('CC.Gym could not build a slip item');
  };

  GEN.slowmo = function (rnd, level, concept) {
    var alg = concept || pick(rnd, ['right', 'left']);
    var t = tState(rnd, alg), A = ALGS[alg], s = t.state, steps = [];
    for (var i = 0; i < 8; i++) {
      var after = ap(s, A.moves.slice(0, i + 1)), cp = (i === 3 || i === 7) ? LANDMARKS[alg][i === 3 ? 0 : 1] : null;
      steps.push({ index: i, half: i < 4 ? 0 : 1, token: A.moves[i], plain: PLAIN[A.moves[i]], word: A.halves[i < 4 ? 0 : 1].rhythm.split(', ')[i % 4],
        state: after, highlight: pieceStickers(after, t.side, t.top), where: WHERE[alg][i + 1],
        checkpoint: cp ? { after: cp.after, title: cp.title, text: cp.text, note: cp.note || null } : null });
    }
    return base('slowmo', {
      prompt: 'Take your real cube, yellow on top. Find a top edge with no yellow that goes ' + alg + ', make the upside-down T at the front, then follow one move at a time. ' +
        'Your cube will not match the pictures exactly: watch the edge and its white corner.',
      state: s, view: '3d', highlight: pieceStickers(s, t.side, t.top), alg: alg, moves: A.moves.slice(), steps: steps,
      checkpoints: LANDMARKS[alg], targetState: ap(s, A.moves), explain: algSentence(alg) + '. ' + rhythmSentence(alg),
      edge: [t.side, t.top], concept: alg
    });
  };

  function routeItem(id) {
    return function (rnd) {
      var seed = int(rnd, 4294967296), dsc = Solver().drillScramble('middle', seed), d = BY_ID[id];
      return base(id, {
        prompt: d.desc, state: dsc.state, scramble: dsc.scramble, seed: seed, route: clone(d.route), view: '3d',
        explain: 'Every white piece is done; place the four middle edges. Yellow on top, green in front.', concept: String(seed)
      });
    };
  }
  GEN['full-virtual'] = routeItem('full-virtual');
  GEN['full-real'] = routeItem('full-real');

  GEN.sprint = function (rnd) {
    for (var a = 0; a < 5000; a++) {
      var s = rotY(rnd, walk(rnd, SLOTS.slice(), 14 + int(rnd, 6)));
      if (unsolvedSlots(s).length !== 4) continue;
      var sol = Solver().solve(s), stg = sol.stages[3], moves = [];
      stg.steps.forEach(function (sp) { moves = moves.concat(sp.moves); });
      return base('sprint', {
        prompt: 'Place all four middle edges as fast as you can. No hints. Yellow on top.',
        state: s, view: '3d', moves: moves, targetState: stg.endState.slice(), goal: { kind: 'f2l' },
        explain: 'One way to do it: ' + stg.steps.length + ' steps, ' + moves.filter(function (m) { return !/^[xyz]/.test(m); }).length + ' turns.',
        concept: str(s)
      });
    }
    throw new Error('CC.Gym could not build a sprint item');
  };

  function clone(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }

  // ------------------------------------------------------------------ public: next / session
  function finish(item, drillId, level) {
    item.drillId = drillId;
    item.level = item.level || level || 1;
    item.key = drillId + ':' + item.concept + ':' + str(item.state);
    return item;
  }
  function next(drillId, opts) {
    opts = opts || {};
    if (!GEN[drillId]) throw new Error('Unknown gym drill: ' + drillId);
    var rnd = rngFor(opts.seed, 'gym:' + drillId);
    return finish(GEN[drillId](rnd, opts.level || 1, opts.concept || null), drillId, opts.level);
  }

  // A round of `count` items: the drill's sub-cases spread evenly (each used at most once when
  // there are enough of them) and no two items the same.
  var RAMP = { recall: [1, 1, 2, 2, 3, 3, 3, 4, 4, 4], halves: [1, 1, 1, 1, 1, 2, 2, 2, 2, 2], mirror: [1, 1, 1, 1, 1, 2, 2, 2, 2, 2] };
  function session(drillId, opts) {
    opts = opts || {};
    if (!GEN[drillId]) throw new Error('Unknown gym drill: ' + drillId);
    var count = opts.count == null ? 10 : Math.max(1, Math.floor(opts.count));
    var rnd = rngFor(opts.seed, 'gym-session:' + drillId);
    var pool = CONCEPTS[drillId], plan = [];
    if (pool) {
      var bag = [];
      while (bag.length < count) bag = bag.concat(shuffle(rnd, pool));
      plan = bag.slice(0, count);
      if (drillId === 'mirror') plan.sort(function (a, b) { return mirrorSize(a) - mirrorSize(b); });   // short ones first
    }
    var out = [], seen = {};
    for (var i = 0; i < count; i++) {
      var lv = opts.level || (RAMP[drillId] ? RAMP[drillId][Math.min(9, Math.floor(i * 10 / count))] : 1), item = null;
      for (var tries = 0; tries < 30 && !item; tries++) {
        var r2 = lib().C.mulberry32((int(rnd, 4294967296) ^ hashStr(drillId)) >>> 0);
        var cand = finish(GEN[drillId](r2, lv, plan[i] || null), drillId, lv);
        if (!seen[cand.key]) item = cand;
      }
      if (!item) throw new Error('CC.Gym could not build a round of ' + drillId);
      seen[item.key] = true;
      item.index = i;
      out.push(item);
    }
    return out;
  }
  function mirrorSize(c) { return c.indexOf('move-') === 0 ? 1 : c.slice(-3) === 'all' ? 8 : 4; }

  // ------------------------------------------------------------------ public: check
  // Goal for 'perform' drills, on any learner state (any way the cube is held).
  //   insert: that edge home, the white layer whole, every edge in `keep` still home
  //   popout: that edge in the top layer, white layer whole, `keep` still home
  //   f2l:    the first two layers solved
  function goalMet(goal, state) {
    if (typeof state === 'string') state = state.split('');
    if (!state || state.length !== 54) return { ok: false, why: 'That is not a whole cube.' };
    var Sv = Solver(), s = Sv.yellowUp(state);
    if (!s) return { ok: false, why: 'Hold the cube with yellow on top.' };
    if (!Sv.check.corners(s)) return { ok: false, why: 'The white layer is broken. Undo your last moves (each one turned the other way), or start again from the T.' };
    if (goal.kind === 'f2l') return Sv.check.middle(s) ? { ok: true } : { ok: false, why: 'Not every middle edge is in its slot yet.' };
    var C = lib().C, a = goal.edge[0], b = goal.edge[1], e = C.findEdge(s, a, b);
    if (goal.kind === 'insert' && !edgeHome(s, a, b)) {
      return { ok: false, why: 'The ' + pair(a, b) + ' edge is not in its slot yet' + (e && e.name.charAt(0) !== 'U' ? ' (it went into the wrong slot or the wrong way round).' : '.') };
    }
    // popout: out on top (or already put back home properly, which is even better)
    if (goal.kind === 'popout' && (!e || (e.name.charAt(0) !== 'U' && !edgeHome(s, a, b)))) return { ok: false, why: 'The ' + pair(a, b) + ' edge is still stuck in the middle layer.' };
    var lost = (goal.keep || []).filter(function (p) { return !edgeHome(s, p[0], p[1]); });
    if (lost.length) return { ok: false, why: 'The ' + pair(lost[0][0], lost[0][1]) + ' edge you had already placed has been knocked out.' };
    return { ok: true };
  }

  function check(item, response) {
    if (!item || !BY_ID[item.drillId]) return { correct: false, explain: 'Unknown item.' };
    var kind = item.kind || BY_ID[item.drillId].kind;
    if (typeof response === 'string' && response.length === 54) response = response.split('');   // a state as a string
    var isState = Array.isArray(response) && response.length === 54 && /^[WYGBRO?]$/.test(String(response[0]));
    if (kind === 'route') {
      if (isState) { var ok = Solver().check.middle(response); return { correct: ok, explain: ok ? 'Middle layer done.' : 'Not every middle edge is in its slot yet.' }; }
      return { correct: true, explain: item.explain };
    }
    if (kind === 'perform') {
      if (isState) {
        var g = goalMet(item.goal, response);
        return { correct: g.ok, explain: g.ok ? 'Done: ' + item.explain : g.why + ' ' + (item.moves ? 'One way: ' + item.moves.join(' ') + '.' : '') };
      }
      if (item.options && response != null && !Array.isArray(response)) return tapCheck(item, response);
      return { correct: false, explain: 'Do the moves on the virtual cube.' };
    }
    if (kind === 'tap') return tapCheck(item, response);
    if (kind === 'multi') {
      var want = item.answer.slice().sort(), got = (Array.isArray(response) ? response : [response]).filter(function (x) { return x != null; });
      var uniq = got.filter(function (x, i) { return got.indexOf(x) === i; }).sort();
      var hits = uniq.filter(function (x) { return want.indexOf(x) !== -1; });
      var correct = hits.length === want.length && uniq.length === want.length;
      var res = { correct: correct, explain: item.explain };
      if (!correct) res.partial = { hits: hits, missed: want.filter(function (x) { return uniq.indexOf(x) === -1; }), extra: uniq.filter(function (x) { return want.indexOf(x) === -1; }) };
      return res;
    }
    if (kind === 'sequence' || kind === 'walkthrough') {
      var steps = item.steps || [];
      if (response && typeof response === 'object' && !Array.isArray(response) && typeof response.step === 'number') {
        var st = steps[response.step];
        if (!st) return { correct: false, explain: 'No such step.' };
        var okStep = st.answer === response.id, sw = '';
        if (!okStep) (st.options || []).forEach(function (o) { if (o.id === response.id && o.why) sw = o.why + ' '; });
        return { correct: okStep, explain: sw + (st.explain || item.explain), step: response.step };
      }
      if (kind === 'walkthrough' && !Array.isArray(response)) {
        return { correct: response !== false && response != null, explain: item.explain };   // slowmo: "my cube matched" / done
      }
      if (!Array.isArray(response)) return { correct: false, explain: item.explain };
      var asked = 0, right = 0, firstWrong = -1;
      steps.forEach(function (sp, i) {
        if (kind === 'walkthrough' && sp.ask === false) return;
        asked++;
        if (response[i] === sp.answer) right++; else if (firstWrong < 0) firstWrong = i;
      });
      var all = asked > 0 && right === asked;
      var out = { correct: all, explain: item.explain };
      if (!all) out.partial = { right: right, of: asked, firstWrong: firstWrong };
      return out;
    }
    return { correct: false, explain: item.explain };
  }
  function tapCheck(item, response) {
    var correct = response === item.answer, opt = null;
    (item.options || []).forEach(function (o) { if (o.id === response) opt = o; });
    var why = !correct && opt && opt.why ? opt.why + ' ' : '';
    return { correct: correct, explain: why + item.explain };
  }

  // ------------------------------------------------------------------ progress (pure, over CC.Store data)
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  // data.gym[drillId] = { right, total, streak, best, bestMs, lastAt, recent:[0/1 …last 10] }.
  // Also calls CC.Coach.recordDrill(data, 'gym-' + drillId, correct) unless opts.coach === false.
  function record(data, drillId, correct, opts, now) {
    opts = opts || {};
    if (!isObj(data) || !BY_ID[drillId]) return null;
    var at = now ? new Date(now) : new Date();
    if (!isObj(data.gym)) data.gym = {};
    var g = data.gym[drillId];
    if (!isObj(g)) g = data.gym[drillId] = { right: 0, total: 0, streak: 0, best: 0, bestMs: null, lastAt: null, recent: [] };
    if (!Array.isArray(g.recent)) g.recent = [];
    g.total = (+g.total || 0) + 1;
    if (correct) {
      g.right = (+g.right || 0) + 1;
      g.streak = (+g.streak || 0) + 1;
      g.best = Math.max(+g.best || 0, g.streak);
      if (opts.ms > 0 && (g.bestMs == null || opts.ms < g.bestMs)) g.bestMs = Math.round(opts.ms);
    } else g.streak = 0;
    g.recent.push(correct ? 1 : 0);
    if (g.recent.length > 10) g.recent = g.recent.slice(-10);
    g.lastAt = at.toISOString();
    var Coach = root.CC && root.CC.Coach;
    if (opts.coach !== false && Coach && typeof Coach.recordDrill === 'function') Coach.recordDrill(data, 'gym-' + drillId, !!correct, at);
    return { entry: g, strong: isStrong(g) };
  }
  // "Strong" = at least 8 right in the last 10 answers.
  function isStrong(entry) {
    if (!isObj(entry) || !Array.isArray(entry.recent)) return false;
    return entry.recent.slice(-10).reduce(function (a, x) { return a + (x ? 1 : 0); }, 0) >= 8;
  }
  // The next drill to suggest: the weakest of groups 1–4 (the four problems), then the first
  // drill in it that is not strong yet. Real-cube drills only when opts.hasCube.
  function suggest(data, opts) {
    opts = opts || {};
    var gym = isObj(data) && isObj(data.gym) ? data.gym : {};
    function usable(d) { return d.needsCube !== 'real' || opts.hasCube; }
    function score(d) { var e = gym[d.id]; return isStrong(e) ? 1 : e && Array.isArray(e.recent) ? e.recent.slice(-10).reduce(function (a, x) { return a + (x ? 1 : 0); }, 0) / 10 : 0; }
    var best = null;
    [1, 2, 3, 4].forEach(function (gid) {
      var ds = DRILLS.filter(function (d) { return d.group === gid && d.kind !== 'route' && usable(d); });
      var avg = ds.reduce(function (a, d) { return a + score(d); }, 0) / ds.length;
      var first = ds.filter(function (d) { return !isStrong(gym[d.id]); })[0];
      if (first && (!best || avg < best.avg)) best = { avg: avg, group: gid, drillId: first.id };
    });
    if (!best) return { drillId: opts.hasCube ? 'full-real' : 'sprint', group: 5, reason: 'Every drill is strong: put it together.' };
    return { drillId: best.drillId, group: best.group, reason: GROUPS[best.group - 1].problem + ' — start with “' + BY_ID[best.drillId].name + '”.' };
  }

  var Gym = {
    ALGS: ALGS, DRILLS: DRILLS, GROUPS: GROUPS, LANDMARKS: LANDMARKS, MIRROR_RULE: MIRROR_RULE, MIRROR_FEEL: MIRROR_FEEL, CONCEPTS: CONCEPTS,
    next: next, check: check, session: session,
    mirror: mirror, mirrorMove: mirrorMove, drill: drill, whereText: whereText, goalMet: goalMet,
    record: record, isStrong: isStrong, suggest: suggest,
    // geometry helpers (for screens and tests)
    slotStatus: function (s, sl) { lib(); return slotStatus(s, sl); },
    usableTop: function (s) { lib(); return usableTop(s); },
    ROT_TO_FR: ROT_TO_FR, ROT_TO_FL: ROT_TO_FL, SLOTS: SLOTS, PAD: PAD
  };

  root.CC = root.CC || {};
  root.CC.Gym = Gym;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gym;
})(typeof window !== 'undefined' ? window : globalThis);
