/* Cube Coach — Practice screen (registers 'drills').
 *
 * params: { tab?: 'drills'|'algs'|'stages'|'timed', type?: drillType, stage?: stageId }
 * Four tabs, reflected in the hash (#/drills?tab=…) with history.replaceState, so switching tabs
 * never re-mounts the screen or loses keyboard focus:
 *   drills  no-cube drills: 10-question sessions on the 3D cube. Multiple choice (keys 1–4) or
 *           "do it on the on-screen cube" items that check themselves. Each answer is recorded with
 *           CC.Coach.recordDrill. params.type opens a drill directly; params.stage filters by stage.
 *   algs    spaced-repetition trainer for the 7 algorithms (CC.Coach.algDue / gradeAlg): cards with
 *           notation + plain English, a "Watch" player with arrows, and a review mode (see the case →
 *           recall → reveal → self-grade, or solve the case on the virtual cube).
 *   stages  the 8 stages with mastery and guidance level; launches stage practice, demos, lessons.
 *   timed   speed practice: how a timed solve works, best / ao5 / ao12, start a timed solve.
 *
 * Drill items come from CC.Drills (js/drills.js) when it is loaded. If it is missing or fails, the
 * built-in generator below (Gen, same contract: next / session / check) builds the items from
 * CC.Solver, CC.Lessons and CC.Cube, so the screen always works.
 *
 * Classic script; nothing touches the DOM at load time.
 */
(function (root) {
  'use strict';

  function CC() { return root.CC || {}; }
  function Cube() { return CC().Cube; }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function safe(fn, fallback) {
    try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; }
  }
  function warn(msg, err) { if (root.console && root.console.warn) root.console.warn('[drills] ' + msg, err || ''); }

  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
  var ALG_IDS = ['rtrigger', 'mid-right', 'mid-left', 'ycross', 'sune', 'corner-cycle', 'twist'];
  var TABS = [
    { id: 'drills', label: 'Drills', icon: 'zap' },
    { id: 'algs', label: 'Algorithms', icon: 'tip' },
    { id: 'stages', label: 'Stages', icon: 'cube' },
    { id: 'timed', label: 'Timed', icon: 'timer' }
  ];
  var TYPE_ICON = { notation: 'watch', perform: 'hand', recognise: 'tip', reps: 'refresh', predict: 'play', algorithm: 'cube' };
  var LEVEL_NAMES = ['Solo', 'Nudge', 'Coach', 'Show'];
  var LEVEL_BADGE = ['badge-success', 'badge-accent', 'badge-info', null];
  var LEVEL_TEXT = [
    'Stage name and timer only. Ask for a hint if you need one.',
    'Just the goal. "Hint" gives you a little more each time you press it.',
    'Goal, case and algorithm name. Moves are hidden until you ask.',
    'Every move is shown on the 3D cube. Copy it.'
  ];
  var SESSION_LENGTH = 10;
  var SOLO_MASTERY = 78;

  // ================================================================== small pure helpers
  function sameState(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  var ORIENT = null;
  function orientations() {
    if (!ORIENT) {
      ORIENT = [];
      ['', 'x', 'x2', "x'", 'z', "z'"].forEach(function (a) {
        ['', 'y', 'y2', "y'"].forEach(function (b) { ORIENT.push((a + ' ' + b).trim()); });
      });
    }
    return ORIENT;
  }
  // Same position, however the cube is held (a whole-cube rotation is not a mistake).
  function sameUpToRotation(a, b) {
    if (sameState(a, b)) return true;
    if (!a || !b || a.length !== 54 || b.length !== 54) return false;
    var o = orientations();
    for (var i = 1; i < o.length; i++) if (sameState(Cube().applyAlg(a, o[i]), b)) return true;
    return false;
  }
  function learningFrame() { return Cube().applyAlg(Cube().solved(), 'z2'); }
  function rngOf(seed) { return Cube().mulberry32((Number(seed) >>> 0) || 1); }
  function seedFrom(r) { return Math.floor(r() * 4294967296) >>> 0; }
  function randomSeed() { return Math.floor(Math.random() * 4294967296) >>> 0; }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function shuffled(r, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // answer + up to max-1 distinct distractors (in the order given), then shuffled unless keepOrder.
  function choice(r, answer, distractors, max, keepOrder) {
    var seen = {}; seen[answer] = true;
    var d = [];
    distractors.forEach(function (x) { if (x != null && !seen[x]) { seen[x] = true; d.push(x); } });
    d = d.slice(0, Math.max(1, (max || 4) - 1));
    var opts = keepOrder ? [answer].concat(d) : shuffled(r, [answer].concat(d));
    return { options: opts, answer: opts.indexOf(answer) };
  }
  // Pure: the stage with the lowest mastery among those practised (skills[id].sessions > 0). With
  // nothing practised yet, the lowest of all (ties: the earliest stage). list = [{id}], mast = {id: 0..100}.
  function weakestPractised(list, mast, data) {
    var skills = data && isObj(data.skills) ? data.skills : {};
    var tried = list.filter(function (s) { return isObj(skills[s.id]) && Number(skills[s.id].sessions) > 0; });
    var pool = tried.length ? tried : list;
    var w = pool[0].id;
    pool.forEach(function (s) { if ((mast[s.id] || 0) < (mast[w] || 0)) w = s.id; });
    return w;
  }

  function stageTitle(id) {
    var L = CC().Lessons, S = CC().Solver;
    var s = L && L.STAGES && L.STAGES[id];
    if (s && s.title) return s.title;
    var list = (S && S.STAGES) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return id;
  }
  function moveText(tok) { return safe(function () { return Cube().moveInfo(tok).text; }, ''); }

  var NOTATION_RE = /^\s*(?:(?:[URFDLBMESxyz]w?|[urfdlb])['’2]?)(?:\s+(?:(?:[URFDLBMESxyz]w?|[urfdlb])['’2]?))*\s*$/;
  function looksLikeNotation(s) { return typeof s === 'string' && NOTATION_RE.test(s); }

  // Name of a known algorithm written as `s` (e.g. "U R U' L' U R' U' L" -> "Corner cycle").
  function algNameFor(s) {
    var C = Cube(), L = CC().Lessons, S = CC().Solver;
    var key = safe(function () { return C.parseAlg(s).join(' '); }, null);
    if (!key) return null;
    var found = null;
    ALG_IDS.forEach(function (id) {
      if (found) return;
      var a = L && L.ALGORITHMS && L.ALGORITHMS[id], b = S && S.ALGS && S.ALGS[id];
      [a && a.notation, a && a.asUsed, b && b.moves].forEach(function (n) {
        if (!found && n && safe(function () { return C.parseAlg(n).join(' '); }, '') === key) found = (a && a.name) || (b && b.name) || id;
      });
    });
    return found;
  }

  // ================================================================== Gen: built-in drill generator
  // Same contract as CC.Drills (see ARCHITECTURE.md). Items it makes carry extra fields the screen
  // uses when present: moves (the answer, for "Show me"), focus (stickers to highlight),
  // optionDetails (a second line per option), showMoves, keepOrder, acceptRotations, _gen.
  var GEN_TYPES = [
    { id: 'notation', name: 'Name that move', desc: 'Watch one turn of the cube, then pick its name.', stageIds: null },
    { id: 'perform', name: 'Do the move', desc: 'Read a move in cube notation, then do it on the on-screen cube.', stageIds: null },
    { id: 'recognise', name: 'Spot the case', desc: 'Look at the cube and say which case it is, and what you would do.', stageIds: STAGE_IDS.slice() },
    { id: 'reps', name: 'How many times?', desc: '1, 3 or 5 right triggers? 2 or 4 twists? Read the corner and decide.', stageIds: ['corners', 'yorient'] },
    { id: 'predict', name: 'What comes next?', desc: 'Watch a few moves of a solve, pause, and predict the next one.', stageIds: STAGE_IDS.slice() },
    { id: 'algorithm', name: 'Algorithm recall', desc: 'See a case, then do its algorithm from memory on the on-screen cube.', stageIds: ['corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'] }
  ];

  var NOTATION_POOL = ['U', "U'", 'R', "R'", 'F', "F'", 'L', "L'", 'U2', 'R2', 'F2', 'D', "D'", 'B', "B'"];
  var MIRROR = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
  var SUFFIX = { 1: '', 2: '2', 3: "'" };
  var PERFORM_SEQS = ['R U', "R U'", "U R'", 'F R', "L' U'", "R' F", "U' L", "R U R' U'", "U R U' R'", "R' D' R D", "F R U R' U' F'"];

  function notationTip(tok) {
    var a = Cube().amountOf(tok);
    if (a === 2) return 'A 2 means a half turn: two quarter turns, either direction.';
    if (a === 3) return 'The ’ (say “prime”) means anticlockwise, judged as if you were looking straight at that face.';
    return 'A letter on its own means a clockwise quarter turn, judged as if you were looking straight at that face.';
  }

  function genNotation(r, o) {
    var C = Cube();
    var recent = o.used || [];
    var tok = pick(r, NOTATION_POOL);
    for (var g = 0; g < 4 && recent.slice(-3).indexOf(tok) !== -1; g++) tok = pick(r, NOTATION_POOL);
    recent.push(tok);
    var base = C.baseOf(tok), amt = C.amountOf(tok), suf = SUFFIX[amt];
    var close = amt === 2 ? [base, base + "'"] : [C.invertMove(tok), base + '2'];
    var others = ['U', 'R', 'F', 'L'].filter(function (b) { return b !== base && b !== MIRROR[base]; });
    var q = choice(r, tok, [close[0]].concat(shuffled(r, [close[1], MIRROR[base] + suf, pick(r, others) + suf])), 4);
    return {
      type: 'notation', stageId: null,
      prompt: 'Watch the cube (yellow on top, green in front). Which move was that?',
      state: learningFrame(), demo: [tok], options: q.options, answer: q.answer, targetState: null,
      explain: tok + ' = ' + C.moveInfo(tok).text + '. ' + notationTip(tok),
      algId: null, moves: [tok]
    };
  }

  function genPerform(r, o) {
    var C = Cube();
    var single = (o.index || 0) < 4 || r() < 0.4;
    var recent = o.used || [];
    var key = single ? pick(r, NOTATION_POOL) : pick(r, PERFORM_SEQS);
    for (var g = 0; g < 4 && recent.slice(-3).indexOf(key) !== -1; g++) key = single ? pick(r, NOTATION_POOL) : pick(r, PERFORM_SEQS);
    recent.push(key);
    var moves = C.parseAlg(key);
    var start = learningFrame();
    return {
      type: 'perform', stageId: null,
      prompt: moves.length === 1 ? 'Do this move on the on-screen cube.' : 'Do these ' + moves.length + ' moves on the on-screen cube, in order.',
      state: start, demo: null, options: null, answer: null, targetState: C.applyAlg(start, moves),
      explain: moves.map(function (t) { return t + ': ' + C.moveInfo(t).text; }).join('. ') + '.',
      algId: null, moves: moves, showMoves: true, acceptRotations: true
    };
  }

  function stageSteps(stageId, seed) {
    var S = CC().Solver;
    var d = S.drillScramble(stageId, seed);
    var sol = S.solve(d.state);
    for (var i = 0; i < sol.stages.length; i++) {
      if (sol.stages[i].id === stageId) return sol.stages[i].skipped ? [] : sol.stages[i].steps;
    }
    return [];
  }

  // The decision point of a solver step: after the set-up turns (lining up, turning the whole cube),
  // just before the real action. -> { state, rest (the action), focus (highlight at that point) }
  function splitStep(step) {
    var C = Cube(), S = CC().Solver;
    var segs = Array.isArray(step.segments) && step.segments.length ? step.segments : [{ moves: step.moves }];
    var k = 0, i;
    if (step.alg && S && S.ALGS && S.ALGS[step.alg.id]) {
      var algKey = C.parseAlg(S.ALGS[step.alg.id].moves).join(' ');
      k = -1;
      for (i = 0; i < segs.length && k < 0; i++) if (C.parseAlg(segs[i].moves).join(' ') === algKey) k = i;
      if (k < 0) k = 0;
    } else {
      while (k < segs.length - 1 && C.parseAlg(segs[k].moves).every(C.isRotation)) k++;
    }
    var setup = [], rest = [];
    segs.forEach(function (s, j) {
      var t = C.parseAlg(s.moves);
      if (j < k) setup = setup.concat(t); else rest = rest.concat(t);
    });
    return {
      state: C.applyAlg(step.startState, setup),
      rest: rest,
      focus: (step.focus || []).map(function (ix) { return C.stickerAfter(ix, setup); })
    };
  }

  var RECOGNISE_PROMPT = {
    daisy: 'The Daisy: look at the highlighted white edge. Which case is it?',
    cross: 'White cross: look at the highlighted petal and the centre below it. Which case is it?',
    corners: 'White corners: look at the highlighted corner. Which case is it?',
    middle: 'Middle layer: look at the highlighted edge. Which case is it?',
    ycross: 'Yellow cross: look at the yellow stickers on top. Which case is it?',
    yedges: 'Yellow edges: compare each top edge with the centre below it. Which case is it?',
    ycorners: 'Yellow corners: check each top corner against the three centres around it. Which case is it?',
    yorient: 'Corner twist: look at the highlighted corner. Which case is it?'
  };

  function genRecognise(r, o) {
    var C = Cube(), L = CC().Lessons;
    for (var attempt = 0; attempt < 12; attempt++) {
      var sid = o.stageId && STAGE_IDS.indexOf(o.stageId) !== -1 ? o.stageId : pick(r, STAGE_IDS);
      var rec = ((L.STAGES[sid] || {}).recognise || []).filter(function (x) { return x.caseId !== 'daisy-blocked'; });
      if (rec.length < 2) continue;
      var steps = stageSteps(sid, seedFrom(r)).filter(function (s) { return s.case; });
      if (!steps.length) continue;
      var step = pick(r, steps), sp = splitStep(step);
      var caseId = step.case.id, state = sp.state, rest = sp.rest, focus = sp.focus;
      if (sid === 'cross') {
        // A petal still waiting for a top turn is the "doesn't match yet" case; after the turn it matches.
        var lastSeg = C.parseAlg(step.segments[step.segments.length - 1].moves);
        var pre = rest.slice(0, rest.length - lastSeg.length);
        if (pre.length && r() < 0.5) caseId = 'cross-top-white-up';
        else {
          if (pre.length) {
            state = C.applyAlg(state, pre);
            focus = focus.map(function (ix) { return C.stickerAfter(ix, pre); });
            rest = lastSeg;
          }
          caseId = 'petal';
        }
      }
      var ans = null;
      rec.forEach(function (x) { if (x.caseId === caseId) ans = x; });
      if (!ans) continue;
      var opts = shuffled(r, [ans].concat(shuffled(r, rec.filter(function (x) { return x !== ans; })).slice(0, 3)));
      return {
        type: 'recognise', stageId: sid,
        prompt: focus.length || ['ycross', 'yedges', 'ycorners'].indexOf(sid) !== -1 ? RECOGNISE_PROMPT[sid] : stageTitle(sid) + ': which case is this?',
        state: state, demo: null,
        options: opts.map(function (x) { return x.name; }),
        optionDetails: opts.map(function (x) { return x.action; }),
        answer: opts.indexOf(ans), targetState: null,
        explain: ans.name + '. ' + ans.look + ' What to do: ' + ans.action,
        algId: step.alg ? step.alg.id : null, moves: rest, focus: focus
      };
    }
    throw new Error('Could not build a “spot the case” question');
  }

  var REPS = {
    corners: { alg: 'rtrigger', options: ['1', '3', '5'], cases: { 'corner-white-right': 'right', 'corner-white-up': 'up', 'corner-white-front': 'towards you' } },
    yorient: { alg: 'twist', options: ['2', '4'], cases: { 'yellow-right': 'right', 'yellow-front': 'towards you' } }
  };

  function genReps(r, o) {
    for (var attempt = 0; attempt < 12; attempt++) {
      var sid = REPS[o.stageId] ? o.stageId : pick(r, ['corners', 'yorient']);
      var cfg = REPS[sid];
      var steps = stageSteps(sid, seedFrom(r)).filter(function (s) {
        return s.kind === 'repeat' && s.alg && s.alg.id === cfg.alg && s.alg.reps && s.case && cfg.cases[s.case.id];
      });
      if (!steps.length) continue;
      var step = pick(r, steps), sp = splitStep(step), n = String(step.alg.reps);
      var ai = cfg.options.indexOf(n);
      if (ai < 0) continue;
      var dir = cfg.cases[step.case.id];
      var corners = sid === 'corners';
      return {
        type: 'reps', stageId: sid,
        prompt: corners
          ? 'The highlighted white corner is at the top front-right, right above its spot. How many times will you repeat R U R’ U’ (the right trigger)?'
          : 'The highlighted corner at the top front-right needs twisting. How many times will you repeat R’ D’ R D (the corner twist)?',
        state: sp.state, demo: null, options: cfg.options.slice(), answer: ai, targetState: null,
        explain: 'Its ' + (corners ? 'white' : 'yellow') + ' sticker faces ' + dir + ', so ' + n + (n === '1' ? ' go' : ' goes') + '. ' +
          (corners ? 'White facing right: 1. Facing up: 3. Facing you: 5.'
            : 'Yellow facing right: 2. Facing you: 4. The bottom looks scrambled halfway through: keep going, it comes back.'),
        algId: cfg.alg, moves: sp.rest, focus: sp.focus, keepOrder: true
      };
    }
    throw new Error('Could not build a “how many times” question');
  }

  function checkpointPool(stageId) {
    var L = CC().Lessons, pool = [];
    (stageId ? [stageId] : STAGE_IDS).forEach(function (sid) {
      ((L.DEMOS && L.DEMOS[sid]) || []).forEach(function (demo) {
        (demo.checkpoints || []).forEach(function (cp) {
          if ((cp.kind === 'next' || cp.kind === 'alg' || cp.kind === 'reps') && Array.isArray(cp.options) && typeof cp.answer === 'number') {
            pool.push({ stageId: sid, demo: demo, cp: cp, key: demo.id + '@' + cp.at });
          }
        });
      });
    });
    return pool;
  }

  function genPredict(r, o) {
    var C = Cube(), L = CC().Lessons, S = CC().Solver;
    var pool = checkpointPool(o.stageId);
    if (!pool.length) pool = checkpointPool(null);
    if (!pool.length) throw new Error('No demo checkpoints to build “what comes next” questions');
    // Least-used pause points first (never the one just asked), so a round spreads evenly.
    var used = o.used || [], uses = {}, least = Infinity, last = used[used.length - 1];
    used.forEach(function (k) { uses[k] = (uses[k] || 0) + 1; });
    pool.forEach(function (p) { least = Math.min(least, uses[p.key] || 0); });
    var fresh = pool.filter(function (p) { return (uses[p.key] || 0) === least && p.key !== last; });
    if (!fresh.length) fresh = pool.filter(function (p) { return p.key !== last; });
    if (!fresh.length) fresh = pool;
    var p = pick(r, fresh);
    used.push(p.key);
    var ds = L.demoStates(p.demo), cp = p.cp;
    var k = Math.max(0, cp.at - 4);
    var demo = ds.moves.slice(k, cp.at);
    var next;
    if (cp.kind === 'alg' && cp.answerAlg && S.ALGS[cp.answerAlg]) next = C.parseAlg(S.ALGS[cp.answerAlg].moves);
    else if (cp.kind === 'reps' && REPS[p.stageId] && S.ALGS[REPS[p.stageId].alg]) {
      // "How many times?" pause: the answer is that many repetitions of the stage's algorithm.
      var one = C.parseAlg(S.ALGS[REPS[p.stageId].alg].moves), times = Number(cp.options[cp.answer]) || 1;
      next = [];
      for (var t = 0; t < times; t++) next = next.concat(one);
    } else next = safe(function () { return C.parseAlg(cp.options[cp.answer]); }, []);
    var actual = ds.moves.slice(cp.at, cp.at + Math.max(1, next.length));
    if (actual.join(' ') !== next.join(' ')) next = actual;
    return {
      type: 'predict', stageId: p.stageId,
      prompt: (demo.length ? 'Watch the last few moves, then predict. ' : '') + cp.prompt,
      state: C.applyAlg(ds.start, ds.moves.slice(0, k)), demo: demo.length ? demo : null,
      options: cp.options.slice(), answer: cp.answer, targetState: null,
      explain: cp.explain || '', algId: cp.answerAlg || (cp.kind === 'reps' && REPS[p.stageId] ? REPS[p.stageId].alg : null),
      moves: next, keepOrder: true, cpKind: cp.kind
    };
  }

  var ALG_STAGES = ['corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];

  function genAlgorithm(r, o) {
    var C = Cube(), L = CC().Lessons, S = CC().Solver;
    for (var attempt = 0; attempt < 12; attempt++) {
      var sid = ALG_STAGES.indexOf(o.stageId) !== -1 ? o.stageId : pick(r, ALG_STAGES);
      var steps = stageSteps(sid, seedFrom(r)).filter(function (s) {
        return s.alg && S.ALGS[s.alg.id] && (s.kind === 'algorithm' || s.kind === 'repeat');
      });
      if (!steps.length) continue;
      var step = pick(r, steps), sp = splitStep(step);
      if (!sp.rest.length) continue;
      var A = (L.ALGORITHMS && L.ALGORITHMS[step.alg.id]) || {};
      var name = A.name || step.alg.name;
      var reps = step.alg.reps || 1;
      var notation = A.asUsed || S.ALGS[step.alg.id].moves;
      var task = step.kind === 'repeat'
        ? (sid === 'corners' ? 'Repeat the ' + name + ' until the corner drops into place.' : 'Repeat the ' + name + ' until yellow faces up.')
        : 'Do the “' + name + '” algorithm from memory.';
      return {
        type: 'algorithm', stageId: sid,
        prompt: 'Case: ' + (step.case ? step.case.name : step.title) + '. ' + task,
        state: sp.state, demo: null, options: null, answer: null,
        targetState: C.applyAlg(sp.state, sp.rest),
        explain: name + ': ' + notation + (reps > 1 ? ', ' + reps + ' times here' : '') + '.' + (A.mnemonic ? ' Memory hook: ' + A.mnemonic : ''),
        algId: step.alg.id, moves: sp.rest, focus: sp.focus, acceptRotations: true
      };
    }
    throw new Error('Could not build an algorithm question');
  }

  var GENERATORS = { notation: genNotation, perform: genPerform, recognise: genRecognise, reps: genReps, predict: genPredict, algorithm: genAlgorithm };

  var Gen = {
    TYPES: GEN_TYPES,
    next: function (type, o) {
      o = o || {};
      var g = GENERATORS[type];
      if (!g) throw new Error('Unknown drill type: ' + type);
      var item = g(rngOf(o.seed == null ? randomSeed() : o.seed), o);
      item._gen = true;
      return item;
    },
    session: function (type, o) {
      o = o || {};
      var r = rngOf(o.seed == null ? randomSeed() : o.seed);
      var n = o.count || SESSION_LENGTH, used = [], out = [];
      if (type === 'predict') {
        // A stage may have only a few pause points: keep the round short (each asked at most twice)
        // rather than repeat one question ten times.
        var pool = checkpointPool(o.stageId || null);
        if (!pool.length) pool = checkpointPool(null);
        n = Math.min(n, Math.max(4, pool.length * 2));
      }
      for (var i = 0; i < n; i++) out.push(Gen.next(type, { stageId: o.stageId || null, seed: seedFrom(r), index: i, used: used }));
      return out;
    },
    check: function (item, response) {
      var ok = false;
      if (typeof response === 'number') ok = response === item.answer;
      else if (Array.isArray(response) && Array.isArray(item.targetState)) {
        var same = item.acceptRotations ? sameUpToRotation : sameState;
        ok = same(response, item.targetState);
        // The app teaches "Sune + U"; the classic 7-move Sune (no final U) is just as right.
        if (!ok && item.type === 'algorithm' && item.algId === 'sune') {
          ok = ['U', "U'", 'U2'].some(function (u) { return safe(function () { return same(Cube().applyMove(response, u), item.targetState); }, false); });
        }
      }
      return { correct: ok, explain: item.explain || '' };
    }
  };

  // ================================================================== CC.Drills adapter
  function drillTypes() {
    var D = CC().Drills;
    var list = D && Array.isArray(D.TYPES) && D.TYPES.length ? D.TYPES : GEN_TYPES;
    return list.filter(function (t) { return t && t.id; });
  }
  function typeById(id) {
    var list = drillTypes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function typeHasStage(t, sid) { return !!sid && Array.isArray(t.stageIds) && t.stageIds.indexOf(sid) !== -1; }

  function validItem(it) {
    if (!isObj(it) || !Array.isArray(it.state) || it.state.length !== 54) return false;
    if (Array.isArray(it.options) && it.options.length >= 2) return typeof it.answer === 'number';
    return Array.isArray(it.targetState) && it.targetState.length === 54;
  }
  function asItems(r) {
    var list = Array.isArray(r) ? r : (r && Array.isArray(r.items) ? r.items : null);
    if (!list) return null;
    list = list.filter(validItem);
    return list.length ? list : null;
  }

  function buildSession(typeId, stageId, count) {
    var D = CC().Drills, seed = randomSeed(), items = null, opts = { stageId: stageId || undefined, seed: seed, count: count };
    if (D && typeof D.session === 'function') {
      try { items = asItems(D.session(typeId, opts)); } catch (e) { warn('CC.Drills.session failed; trying next()', e); }
    }
    if (!items && D && typeof D.next === 'function') {
      try {
        var list = [];
        for (var i = 0; i < count; i++) list.push(D.next(typeId, { stageId: stageId || undefined, seed: (seed + i * 7919) >>> 0 }));
        items = asItems(list);
      } catch (e) { warn('CC.Drills.next failed; using the built-in drills', e); items = null; }
    }
    if (!items && GENERATORS[typeId]) items = Gen.session(typeId, { stageId: stageId, seed: seed, count: count });
    return items ? items.slice(0, count) : [];
  }

  function checkItem(item, response) {
    var D = CC().Drills;
    if (!item._gen && D && typeof D.check === 'function') {
      try {
        var r = D.check(item, response);
        if (r && typeof r.correct === 'boolean') return { correct: r.correct, explain: r.explain || item.explain || '' };
      } catch (e) { warn('CC.Drills.check failed', e); }
    }
    return Gen.check(item, response);
  }

  // The moves that answer an item (for "Show me"), checked against its target when it has one.
  function intendedMoves(item, from) {
    var C = Cube();
    if (Array.isArray(item.moves) && item.moves.length) return safe(function () { return C.parseAlg(item.moves); }, null);
    if (!Array.isArray(item.targetState) || !from) return null;
    var hits = function (m) { return safe(function () { return sameUpToRotation(C.applyAlg(from, m), item.targetState); }, false); };
    var cands = [item.solution, item.answerMoves, item.alg, item.algorithm, item.notation];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (typeof c === 'string' || Array.isArray(c)) {
        var m = safe(function () { return C.parseAlg(c); }, null);
        if (m && m.length && hits(m)) return m;
      }
    }
    var S = CC().Solver;
    if (item.algId && S && S.ALGS && S.ALGS[item.algId]) {
      var base = C.parseAlg(S.ALGS[item.algId].moves), seq = [];
      for (var k = 1; k <= 6; k++) { seq = seq.concat(base); if (hits(seq)) return seq.slice(); }
    }
    var F = ['U', "U'", 'U2', 'R', "R'", 'R2', 'F', "F'", 'F2', 'L', "L'", 'L2', 'D', "D'", 'D2', 'B', "B'", 'B2'];
    for (var a = 0; a < F.length; a++) if (hits([F[a]])) return [F[a]];
    for (a = 0; a < F.length; a++) for (var b = 0; b < F.length; b++) if (F[a][0] !== F[b][0] && hits([F[a], F[b]])) return [F[a], F[b]];
    return null;
  }

  // ================================================================== algorithm content
  function algInfo(id) {
    var C = Cube(), L = CC().Lessons, S = CC().Solver;
    var A = (L && L.ALGORITHMS && L.ALGORITHMS[id]) || null, B = (S && S.ALGS && S.ALGS[id]) || null;
    if (!A && !B) return null;
    A = A || {}; B = B || {};
    var tokens = C.parseAlg(A.asUsed || B.moves || A.notation || B.notation);
    var lessonTokens = A.notation ? C.parseAlg(A.notation) : [];
    var plain = tokens.map(function (t, i) {
      return Array.isArray(A.plain) && A.plain[i] && lessonTokens[i] === t ? A.plain[i] : C.moveInfo(t).text;
    });
    var reps = id === 'twist' ? 2 : 1;   // "yellow facing right": the common case needs two goes
    var play = [];
    for (var k = 0; k < reps; k++) play = play.concat(tokens);
    return {
      id: id, name: A.name || B.name || id, tokens: tokens, plain: plain, reps: reps, play: play,
      setup: C.applyAlg(learningFrame(), C.invertAlg(play)),
      summary: A.summary || '', mnemonic: A.mnemonic || '', fingerTricks: A.fingerTricks || '', fact: A.fact || '',
      usedIn: Array.isArray(A.usedIn) ? A.usedIn : [],
      note: A.asUsed ? 'Used here with one extra U at the end (Sune, then U), which lines the edges back up.'
        : reps > 1 ? 'Shown twice: with yellow facing right it takes two goes (facing you, four).' : ''
    };
  }

  function fmtDue(iso, now) {
    var t = Date.parse(iso);
    now = now || new Date();
    if (!isFinite(t) || t <= now.getTime()) return 'due now';
    var a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var d = new Date(t), b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var days = Math.round((b - a) / 86400000);
    if (days <= 0) return 'later today';
    if (days === 1) return 'tomorrow';
    return 'in ' + days + ' days';
  }

  function buildHash(id, params) {
    var keys = Object.keys(params || {}).filter(function (k) {
      var v = params[k];
      return v != null && v !== '' && v !== false;
    }).sort();
    var q = keys.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); }).join('&');
    return '#/' + encodeURIComponent(id) + (q ? '?' + q : '');
  }

  // ================================================================== lifecycle scope
  // Collects cleanups (views, timers, listeners) for one view of the screen; dispose() runs them.
  function Scope() { this.fns = []; this.dead = false; }
  Scope.prototype.add = function (fn) {
    if (this.dead) { try { fn(); } catch (e) { /* ignore */ } return; }
    this.fns.push(fn);
  };
  Scope.prototype.timeout = function (fn, ms) {
    var self = this;
    if (self.dead) return 0;
    var id = setTimeout(function () { if (!self.dead) fn(); }, ms || 0);
    self.add(function () { clearTimeout(id); });
    return id;
  };
  Scope.prototype.dispose = function () {
    if (this.dead) return;
    this.dead = true;
    var list = this.fns.splice(0);
    for (var i = list.length - 1; i >= 0; i--) {
      try { list[i](); } catch (e) { if (root.console) root.console.error('[drills] cleanup failed', e); }
    }
  };

  // Plays tokens one at a time on a View3D, optionally showing the arrow before each move.
  // play() resolves true when finished, false when stopped (a newer play(), stop(), or disposal).
  function makeAnimator(scope, view) {
    var gen = 0;
    function stop() {
      gen++;
      if (view) { try { view.cancel(); view.showArrow(null); } catch (e) { /* ignore */ } }
    }
    function play(tokens, o) {
      o = o || {};
      var my = ++gen;
      var toks = safe(function () { return Cube().parseAlg(tokens || []); }, []);
      return new Promise(function (resolve) {
        if (!view) { resolve(false); return; }
        var i = 0;
        function alive() { return my === gen && !scope.dead; }
        function step() {
          if (!alive()) { resolve(false); return; }
          if (i >= toks.length) { resolve(true); return; }
          var t = toks[i];
          if (o.onMove) { try { o.onMove(i, t); } catch (e) { /* ignore */ } }
          if (o.arrows) view.showArrow(t);
          scope.timeout(function () {
            if (!alive()) { resolve(false); return; }
            view.play([t], { speed: o.speed }).then(function () {
              if (!alive()) { resolve(false); return; }
              if (o.arrows) view.showArrow(null);
              i++;
              scope.timeout(step, o.gap != null ? o.gap : (o.arrows ? 160 : 70));
            });
          }, o.arrows ? (o.lead != null ? o.lead : 520) : 0);
        }
        step();
      });
    }
    // Run fn after ms unless stop() or another play()/after() comes first.
    function after(ms, fn) {
      var my = ++gen;
      scope.timeout(function () { if (my === gen) fn(); }, ms);
    }
    return { play: play, stop: stop, after: after };
  }

  // ================================================================== styles
  var STYLE_ID = 'cc-style-drills';
  var CSS = [
    '.cc-drills .cc-dtabs { margin-bottom: 0; }',
    '.cc-dpanel:focus { outline: none; }',
    '@media (max-width: 440px) { .cc-dtabs .tab { padding: 10px 10px; } .cc-dtabs .tab .icon { display: none; } }',
    '.cc-intro { max-width: 62ch; margin: 0; }',
    '.cc-filter { display: inline-flex; align-items: center; gap: var(--space-2); flex-wrap: nowrap; }',
    '.cc-filter .select { width: auto; max-width: 100%; min-width: 0; }',
    '.cc-dgrid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }',
    '.cc-dcard { height: 100%; }',
    '.cc-dcard.is-rec { border-color: var(--accent-soft-2); box-shadow: 0 0 0 1px var(--accent-soft-2), var(--shadow-1); }',
    '.cc-dcard__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: var(--space-2); }',
    '.cc-dcard__bar { display: block; margin-top: var(--space-2); }',
    '.cc-loading { display: flex; align-items: center; justify-content: center; gap: var(--space-3); padding: var(--space-6) 0; color: var(--text-2); }',

    '.cc-run__top { gap: var(--space-2); }',
    '.cc-run__title { flex: 1 1 auto; }',
    '.cc-dots { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }',
    '.cc-dots > li { margin: 0; width: 14px; height: 14px; border-radius: 50%; background: var(--surface-3); border: 1.5px solid var(--border-strong); }',
    '.cc-dots > li.is-current { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-2); }',
    '.cc-dots > li.is-right { background: var(--success); border-color: var(--success); }',
    '.cc-dots > li.is-wrong { background: var(--danger); border-color: var(--danger); }',
    '.cc-run__prompt { margin: 0; font-size: var(--text-lg); font-weight: 650; line-height: 1.35; }',
    '@media (min-width: 720px) { .cc-run__prompt { font-size: var(--text-xl); } }',
    '.cc-run__prompt:focus { outline: none; }',
    '.cc-run__grid { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); align-items: start; }',
    '@media (min-width: 900px) { .cc-run__grid { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); } }',
    '.cc-drills .viewport-3d.cc-view { max-height: min(54vh, 520px); }',
    '.cc-fb:empty, .cc-padhost:empty { display: none; }',
    /* keep anything scrolled or focused into view clear of the sticky top bar and the phone tab bar */
    '.cc-drills * { scroll-margin-top: calc(var(--topbar-h, 60px) + 12px); scroll-margin-bottom: calc(var(--bottomnav-h, 0px) + 12px); }',
    '.cc-drills .viewport-3d.cc-view--sm { min-height: 240px; aspect-ratio: 4 / 3; max-height: 50vh; }',
    '.cc-status { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 10px; border-radius: var(--radius-pill); background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-1); font-size: var(--text-sm); font-weight: 600; color: var(--text); max-width: 100%; }',
    '.cc-status:empty { visibility: hidden; }',
    '.cc-opt__tok { font-family: var(--font-mono); font-weight: 700; font-size: 1.05rem; }',
    '.cc-opt__label { font-weight: 650; }',
    '.cc-opt__sub { display: block; margin-top: 2px; font-size: var(--text-sm); font-weight: 400; color: var(--text-2); line-height: 1.4; }',
    '.cc-plain { margin: 0; padding-left: 1.4em; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-plain > li + li { margin-top: 2px; }',
    '.cc-plain .mono { color: var(--text); }',
    '.cc-controls { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
    '.cc-mine { min-height: 1.6em; overflow-wrap: anywhere; }',
    '.cc-misses { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-misses > li { margin: 0; padding: var(--space-3); border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); }',
    '.cc-big { font-size: clamp(2.2rem, 8vw, 3rem); font-weight: 750; letter-spacing: -0.03em; line-height: 1.05; margin: 0; }',

    '.cc-alg-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); align-items: start; }',
    '.cc-details > summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text-2); padding: 2px 0; }',
    '.cc-details > summary:hover { color: var(--text); }',
    '.cc-details[open] > summary { margin-bottom: var(--space-2); }',
    '.cc-alg__player { display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-alg__cap { margin: 0; min-height: 2.9em; }',

    '.cc-stages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-stages > li { margin: 0; }',
    '.cc-stage { display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-stage.is-focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }',
    '.cc-stage.is-selected { background: var(--accent-soft); }',
    '.cc-stage__head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: start; }',
    '.cc-stage__num { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border); font-weight: 700; color: var(--text-2); }',
    '.cc-stage.is-focus .cc-stage__num { background: var(--accent); border-color: transparent; color: var(--on-accent); }',
    '.cc-stage__level { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }',
    '@media (max-width: 560px) { .cc-stage__head { grid-template-columns: auto minmax(0, 1fr); } .cc-stage__level { grid-column: 2; flex-direction: row; align-items: center; gap: var(--space-2); text-align: left; } }',

    '.cc-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }',
    '.cc-steps > li { margin: 0; display: flex; gap: var(--space-3); align-items: flex-start; }',
    '.cc-steps__num { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-weight: 700; }',
    '.cc-statgrid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr)); }',
    '.cc-statgrid .stat { padding: var(--space-3); border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); }',
    '.cc-statgrid .stat__value { font-size: var(--text-xl); }'
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ================================================================== the screen
  var def = {
    title: 'Practice',
    mount: function (el, params) {
      injectStyle();
      params = params || {};
      var C = CC(), UI = C.UI, h = UI.h, App = C.App;
      var screenScope = new Scope();
      var panelScope = null;
      var keyHandler = null;
      var atRoot = false;       // the current tab's front view is showing (not a session / review / summary)
      var syncedHash = null;    // the last hash this screen wrote with replaceState
      var state = {
        tab: TABS.some(function (t) { return t.id === params.tab; }) ? params.tab : 'drills',
        stage: STAGE_IDS.indexOf(params.stage) !== -1 ? params.stage : null,
        type: params.type ? String(params.type) : null
      };
      if (state.type && !params.tab) state.tab = 'drills';

      function data() { return App.data; }
      function settings() { var d = data(); return d && isObj(d.settings) ? d.settings : {}; }
      function animSpeed() { var s = Number(settings().animSpeed); return s > 0 && s < 10 ? s : 1; }
      function save() { try { App.save(); } catch (e) { /* App reports save errors itself */ } }
      function active() { try { App.markActive(); } catch (e) { /* ignore */ } }
      function go(id, p) { return function () { App.go(id, p || {}); }; }
      function stages() { return UI.stages(); }
      function keyboardHint() {
        return settings().keyboard === 'cstimer'
          ? 'Keyboard: csTimer layout (I and K turn the right side, J and F the top …). Backspace undoes.'
          : 'Keyboard: a letter turns that face clockwise (R, U, F, L, D, B); add Shift for anticlockwise. Backspace undoes.';
      }
      function btn(label, iconName, onClick, cls) {
        return h('button', { type: 'button', class: ['btn', cls || 'btn-secondary', 'btn-sm'], onClick: onClick }, iconName ? UI.icon(iconName, 16) : null, label);
      }
      function onControl(e) {
        var t = e.target;
        return !!(t && t.closest && t.closest('button, a[href], select, summary, input, textarea, [role="tab"]'));
      }

      function onKey(e) {
        if (!keyHandler || e.defaultPrevented) return;
        if (UI.shortcutsBlocked(e)) return;
        keyHandler(e);
      }
      document.addEventListener('keydown', onKey);
      screenScope.add(function () { document.removeEventListener('keydown', onKey); });

      // ------------------------------------------------------------ page frame + tabs
      el.classList.add('cc-drills');
      var tabButtons = {};
      var tabsEl = h('div', { class: 'tabs cc-dtabs', role: 'tablist', 'aria-label': 'Practice sections' });
      TABS.forEach(function (t) {
        var b = h('button', {
          type: 'button', role: 'tab', class: 'tab', id: 'cc-dtab-' + t.id, 'aria-controls': 'cc-dpanel',
          // Clicking the active tab mid-session goes back to that tab's front view (never restarts a session).
          onClick: function () { if (state.tab !== t.id || !atRoot) { state.type = null; showTab(t.id); } }
        }, UI.icon(t.icon, 18), t.label);
        tabButtons[t.id] = b;
        tabsEl.appendChild(b);
      });
      tabsEl.addEventListener('keydown', function (e) {
        var ids = TABS.map(function (t) { return t.id; });
        var i = ids.indexOf(state.tab), j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % ids.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + ids.length) % ids.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = ids.length - 1;
        if (j < 0) return;
        e.preventDefault();
        showTab(ids[j]);
        tabButtons[ids[j]].focus();
      });
      var panelEl = h('div', { class: 'cc-dpanel', id: 'cc-dpanel', role: 'tabpanel', tabindex: '-1' });
      el.appendChild(h('div', { class: 'stack' },
        h('header', { class: 'page-head m-0' },
          h('div', null,
            h('p', { class: 'eyebrow' }, 'Practice'),
            h('h1', null, 'Practice'),
            h('p', { class: 'muted' }, 'Short, focused practice. Most of it needs no cube in your hands: the on-screen cube does the work.'))),
        tabsEl, panelEl));

      function syncHash() {
        var p = { tab: state.tab };
        if (state.stage && (state.tab === 'drills' || state.tab === 'stages')) p.stage = state.stage;
        if (state.type && state.tab === 'drills') p.type = state.type;
        var hash = buildHash('drills', p);
        syncedHash = hash;
        try {
          if (root.location.hash !== hash) root.history.replaceState(root.history.state, '', hash);
        } catch (e) { /* sandboxed page: the tab still works, the address just doesn't follow */ }
      }

      // The app router ignores a hash equal to the one it mounted us with, but replaceState above has
      // moved the address on since then (e.g. mounted at #/drills, now #/drills?tab=algs). If the
      // learner then goes back to that exact address (typing it, or history), follow it here. When the
      // router does re-mount, it runs first and our cleanup removes this listener before it fires.
      function onHashChange() {
        var hs = String(root.location.hash || '');
        var m = /^#\/drills(?:\?(.*))?$/.exec(hs);
        if (!m || hs === syncedHash) return;
        var p = {};
        (m[1] || '').split('&').forEach(function (pair) {
          if (!pair) return;
          var i = pair.indexOf('=');
          try { p[decodeURIComponent(i < 0 ? pair : pair.slice(0, i))] = decodeURIComponent((i < 0 ? '' : pair.slice(i + 1)).replace(/\+/g, ' ')); } catch (e) { /* ignore */ }
        });
        state.tab = TABS.some(function (t) { return t.id === p.tab; }) ? p.tab : 'drills';
        state.stage = STAGE_IDS.indexOf(p.stage) !== -1 ? p.stage : null;
        state.type = p.type ? String(p.type) : null;
        if (state.type && !p.tab) state.tab = 'drills';
        showTab(state.tab);
      }
      root.addEventListener('hashchange', onHashChange);
      screenScope.add(function () { root.removeEventListener('hashchange', onHashChange); });

      function newPanel(isRoot) {
        if (panelScope) panelScope.dispose();
        panelScope = new Scope();
        keyHandler = null;
        atRoot = !!isRoot;
        UI.empty(panelEl);
        return panelScope;
      }
      // Starting a session or review: bring the tabs to the top so the question, cube and answers fit.
      function scrollToRun() {
        try { tabsEl.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (e) { /* ignore */ }
      }

      function showTab(id) {
        state.tab = id;
        if (id !== 'drills') state.type = null;
        TABS.forEach(function (t) {
          var b = tabButtons[t.id], on = t.id === id;
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.tabIndex = on ? 0 : -1;
          b.classList.toggle('is-active', on);
        });
        panelEl.setAttribute('aria-labelledby', 'cc-dtab-' + id);
        syncHash();
        if (id === 'algs') renderAlgs();
        else if (id === 'stages') renderStages();
        else if (id === 'timed') renderTimed();
        else renderDrills();
      }

      function makeView(scope, host, opts) {
        var V = C.View3D;
        var fail = function () {
          host.appendChild(h('div', { class: 'viewport-3d__placeholder' }, UI.icon('cube', 28),
            h('p', { class: 'm-0' }, 'The cube view couldn’t load here. Questions still work; reload the page to try again.')));
          return null;
        };
        if (!V || typeof V.create !== 'function') return fail();
        var v;
        try { v = V.create(host, opts || {}); } catch (e) { warn('3D view failed', e); return fail(); }
        try { v.setSpeed(animSpeed()); } catch (e) { /* ignore */ }
        scope.add(function () { try { v.onUserMove = null; v.dispose(); } catch (e) { /* ignore */ } });
        return v;
      }

      function movesBlock(tokens, label) {
        var chips = UI.algChips(tokens, { size: 'lg', label: label || 'Moves' });
        return {
          chips: chips,
          el: h('div', { class: 'stack stack-sm' }, chips,
            h('ol', { class: 'cc-plain' }, tokens.map(function (t) {
              return h('li', null, h('span', { class: 'mono strong' }, t), ' — ', moveText(t));
            })))
        };
      }

      function recordDrill(type, correct) {
        var d = data(), Co = C.Coach;
        try {
          if (Co && typeof Co.recordDrill === 'function') Co.recordDrill(d, type, !!correct);
          else {
            if (!isObj(d.drills)) d.drills = {};
            var e = isObj(d.drills[type]) ? d.drills[type] : (d.drills[type] = { right: 0, total: 0, lastAt: null });
            e.total = (Number(e.total) || 0) + 1;
            e.right = (Number(e.right) || 0) + (correct ? 1 : 0);
            e.lastAt = new Date().toISOString();
          }
        } catch (e) { warn('could not record the drill', e); }
        save();
        active();
      }

      // ============================================================ tab 1: drills
      function renderDrills() {
        if (state.type) {
          if (typeById(state.type)) { startSession(state.type); return; }
          state.type = null;
          syncHash();
        }
        renderHub();
      }

      function renderHub() {
        newPanel(true);
        var d = data(), stats = d && isObj(d.drills) ? d.drills : {};
        var types = drillTypes(), sid = state.stage;
        var shown = sid ? types.filter(function (t) { return typeHasStage(t, sid); }) : types;
        if (!shown.length) shown = types;
        var rec = null, worst = 2;
        shown.forEach(function (t) {
          var s = stats[t.id], tot = s && s.total > 0 ? s.total : 0;
          var score = tot ? s.right / tot : -1;          // never tried comes first
          if (score < worst) { worst = score; rec = t.id; }
        });
        var select = h('select', {
          class: 'select', 'aria-label': 'Which stage to drill',
          onChange: function () { state.stage = this.value || null; syncHash(); renderHub(); }
        }, h('option', { value: '' }, 'All stages'),
        stages().map(function (s, i) { return h('option', { value: s.id, selected: s.id === sid }, (i + 1) + '. ' + s.name); }));

        function card(t) {
          var s = stats[t.id], tot = s && s.total > 0 ? s.total : 0;
          var acc = tot ? Math.round(s.right / tot * 100) : null;
          var inter = t.id === 'perform' || t.id === 'algorithm';
          return h('button', { type: 'button', class: ['tile', 'cc-dcard', rec === t.id ? 'is-rec' : null], onClick: function () { startSession(t.id); } },
            h('span', { class: 'tile__icon' }, UI.icon(TYPE_ICON[t.id] || 'zap', 22)),
            h('span', { class: 'tile__body' },
              h('span', { class: 'tile__title' }, t.name || t.id, rec === t.id ? [' ', h('span', { class: 'badge badge-accent' }, tot ? 'Needs work' : 'Try next')] : null),
              t.desc ? h('span', { class: 'tile__desc' }, t.desc) : null,
              h('span', { class: 'cc-dcard__meta' },
                h('span', { class: 'badge' }, inter ? 'Turn the on-screen cube' : 'Watch and choose'),
                h('span', { class: 'xsmall subtle' }, acc == null ? 'Not tried yet' : s.right + ' of ' + tot + ' right · ' + acc + '%')),
              acc == null ? null : h('span', { class: 'progress progress-sm cc-dcard__bar', 'aria-hidden': 'true' },
                h('span', { class: ['progress__bar', 'cc-dcard__fill'], style: { width: acc + '%', display: 'block' } }))),
            h('span', { class: 'tile__arrow' }, UI.icon('arrowRight', 18)));
        }

        panelEl.appendChild(h('div', { class: 'stack' },
          h('div', { class: 'row row-between' },
            h('p', { class: 'muted cc-intro' }, 'Rounds of up to ten quick questions, about two minutes a round. Wrong answers come with an explanation and a “Show me” on the cube.'),
            h('label', { class: 'cc-filter' }, h('span', { class: 'small strong' }, 'Stage'), select)),
          sid ? UI.callout('tip', 'Drills for ' + stageTitle(sid),
            'Showing the drills that use this stage. ',
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { state.stage = null; syncHash(); renderHub(); } }, 'Show all drills')) : null,
          h('div', { class: 'cc-dgrid' }, shown.map(card)),
          C.Drills && C.Drills !== Gen ? null : h('p', { class: 'xsmall subtle m-0' }, 'Questions are built from real solves of random cubes, so no two sessions are the same.')));
      }

      function startSession(typeId) {
        var t = typeById(typeId);
        if (!t) { state.type = null; syncHash(); renderHub(); return; }
        state.type = t.id;
        syncHash();
        var scope = newPanel();
        var sid = typeHasStage(t, state.stage) ? state.stage : null;
        var items = [], err = null;
        try { items = buildSession(t.id, sid, SESSION_LENGTH); } catch (e) { err = e; warn('could not build the drill', e); }
        if (!items.length) {
          panelEl.appendChild(h('section', { class: 'card stack' },
            UI.callout('warn', 'This drill couldn’t start', 'Something went wrong while setting up the questions' + (err && err.message ? ' (' + err.message + ')' : '') + '. Try another drill, or reload the page.'),
            h('div', { class: 'row' }, btn('All drills', 'arrowLeft', exitToHub, 'btn-primary'))));
          return;
        }
        runSession(scope, t, sid, items);
      }

      function exitToHub() { state.type = null; syncHash(); renderHub(); }

      function runSession(scope, t, sid, items) {
        var spd = animSpeed();
        var idx = -1, item = null, results = [], phase = 'idle', turning = false;
        var userMoves = [], optionButtons = [], quizEl = null, pad = null, chipsEl = null, mineEl = null, controls = null;

        var dotEls = [];
        var dots = h('ol', { class: 'cc-dots', 'aria-label': 'Progress' });
        items.forEach(function (it, i) {
          var li = h('li', null, h('span', { class: 'sr-only' }, 'Question ' + (i + 1)));
          dotEls.push(li);
          dots.appendChild(li);
        });
        var scoreEl = h('span', { class: 'badge badge-accent' }, '0 right');
        var counterEl = h('p', { class: 'eyebrow m-0' });
        var promptEl = h('p', { class: 'cc-run__prompt', tabindex: '-1' });
        var extraEl = h('div');
        var statusEl = h('span', { class: 'cc-status' });
        var replayBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: function () { replay(); } }, UI.icon('refresh', 16), 'Replay');
        var viewHost = h('div', { class: 'viewport-3d cc-view' }, h('div', { class: 'viewport-3d__overlay' }, statusEl, replayBtn));
        var padHost = h('div', { class: 'stack stack-sm cc-padhost' });
        var answerEl = h('div', { class: 'stack stack-sm' });
        var feedbackEl = h('div', { class: 'cc-fb', 'aria-live': 'polite' });
        panelEl.appendChild(h('section', { class: 'cc-run stack', 'aria-labelledby': 'cc-run-title' },
          h('div', { class: 'row cc-run__top' },
            btn('All drills', 'arrowLeft', exitToHub, 'btn-ghost'),
            h('h2', { class: 'h3 m-0 cc-run__title', id: 'cc-run-title' }, t.name || t.id, sid ? h('span', { class: 'subtle small' }, ' · ' + stageTitle(sid)) : null),
            scoreEl),
          dots,
          h('div', { class: 'card card-sm stack stack-sm' }, counterEl, promptEl, extraEl),
          // The move pad sits beside the cube on wide screens (no scrolling to reach it) and right
          // under the instructions on phones.
          h('div', { class: 'cc-run__grid' },
            h('div', { class: 'stack stack-sm' }, viewHost),
            h('div', { class: 'stack' }, answerEl, feedbackEl, padHost))));
        var view = makeView(scope, viewHost, { interactive: true, turnable: false, label: 'Drill cube' });
        var anim = makeAnimator(scope, view);
        if (view) view.onUserMove = onUserMove;
        scope.add(function () { if (pad) pad.destroy(); pad = null; });
        keyHandler = onKeyRun;
        show(0);
        scrollToRun();

        function isInteractive(it) { return !(Array.isArray(it.options) && it.options.length) && Array.isArray(it.targetState); }
        function focusOf(it) { var f = it.focus || it.highlight; return Array.isArray(f) && f.length ? f : null; }
        function setStatus(text) { statusEl.textContent = text || ''; }
        function resetView(st) {
          if (!view) return;
          view.showArrow(null);
          view.setState(st);
          view.highlight(focusOf(item));
        }

        function show(i) {
          anim.stop();
          idx = i;
          item = items[i];
          userMoves = []; optionButtons = []; quizEl = null; chipsEl = null; mineEl = null; controls = null;
          var after = item.demo ? safe(function () { return Cube().applyAlg(item.state, item.demo); }, item.state) : item.state;
          // A demo that already reaches the target is "watch, then copy it": start from the beginning.
          item._copy = !!item.demo && isInteractive(item) && sameState(after, item.targetState);
          item._start = item._copy ? item.state : after;
          counterEl.textContent = 'Question ' + (i + 1) + ' of ' + items.length + (item.stageId ? ' · ' + stageTitle(item.stageId) : '');
          promptEl.textContent = item.prompt || '';
          UI.empty(extraEl); UI.empty(answerEl); UI.empty(feedbackEl);
          if (pad) { pad.destroy(); pad = null; }
          UI.empty(padHost);
          if (item.showMoves && Array.isArray(item.moves) && item.moves.length) {
            var mb = movesBlock(item.moves, 'Moves to do');
            chipsEl = mb.chips;
            extraEl.appendChild(mb.el);
          }
          updateDots();
          replayBtn.hidden = !item.demo || !view;
          setStatus('');
          if (view) { view.setTurnable(false); resetView(item.state); }
          if (isInteractive(item)) buildInteractive(); else buildChoices();
          if (item.demo && view) runDemo(650); else ready();
          if (i > 0) { try { promptEl.focus(); } catch (e) { /* ignore */ } }
        }

        function runDemo(delay) {
          phase = 'demo';
          setTurning(false);
          setChoicesEnabled(false);
          setStatus('Watch the cube…');
          anim.after(delay || 0, function () {
            if (phase !== 'demo') return;
            anim.play(item.demo, { speed: spd * (item.type === 'notation' ? 0.55 : 0.8), onMove: function () { active(); } }).then(function (ok) {
              if (!ok || phase !== 'demo') return;
              if (!item._copy) { ready(); return; }
              setStatus('Now you do it');
              anim.after(800, function () { if (phase === 'demo') { resetView(item.state); ready(); } });
            });
          });
        }

        function ready() {
          phase = 'answer';
          if (isInteractive(item)) { setTurning(true); setStatus('Your turn'); }
          else { setChoicesEnabled(true); setStatus(''); }
        }

        function replay() {
          if (!item || !item.demo || !view) return;
          if (phase === 'answer' || phase === 'demo') {
            anim.stop();
            resetView(item.state);
            userMoves = [];
            updateMine();
            runDemo(250);
          } else if (phase === 'feedback' || phase === 'practice') {
            anim.stop();
            setTurning(false);
            if (phase === 'practice') phase = 'feedback';
            resetView(item.state);
            anim.play(item.demo, { speed: spd * 0.55 });
          }
        }

        // ---- multiple choice
        function optionText(o) {
          var s = typeof o === 'string' ? o : isObj(o) ? String(o.label || o.text || o.name || '') : String(o);
          if ((item.type === 'reps' || item.cpKind === 'reps') && /^\d+$/.test(s)) return s + (s === '1' ? ' time' : ' times');
          return s;
        }
        function optionSub(s, j) {
          if (Array.isArray(item.optionDetails) && item.optionDetails[j]) {
            var det = String(item.optionDetails[j]);
            var nm = looksLikeNotation(det) ? algNameFor(det) : null;
            return nm ? det + ' (the ' + nm + ' algorithm)' : det;
          }
          if (!looksLikeNotation(s)) return null;
          var toks = safe(function () { return Cube().parseAlg(s); }, []);
          if (toks.length === 1) return moveText(toks[0]);
          return algNameFor(s);
        }
        function buildChoices() {
          var opts = item.options || [];
          // "Name that move" tests the notation itself, so each option's plain-English meaning stays
          // hidden until you've answered (then all of them show, to compare).
          var hideSubs = item.type === 'notation';
          quizEl = h('div', { class: 'quiz' });
          var list = h('div', { class: 'quiz__options', role: 'group', 'aria-label': 'Answers' });
          optionButtons = opts.map(function (o, j) {
            var lab = optionText(o), sub = optionSub(lab, j);
            var b = h('button', { type: 'button', class: 'quiz-option', 'aria-keyshortcuts': j < 9 ? String(j + 1) : null, onClick: function () { choose(j); } },
              h('span', { class: 'quiz-option__key', 'aria-hidden': 'true' }, String(j + 1)),
              h('span', { class: 'quiz-option__text' },
                h('span', { class: looksLikeNotation(lab) ? 'cc-opt__tok' : 'cc-opt__label' }, lab),
                sub ? h('span', { class: 'cc-opt__sub', hidden: hideSubs }, sub) : null));
            list.appendChild(b);
            return b;
          });
          quizEl.appendChild(list);
          answerEl.appendChild(quizEl);
          answerEl.appendChild(h('p', { class: 'xsmall subtle m-0' },
            'Keys: 1–' + Math.min(9, opts.length) + ' to answer' + (item.demo ? ', Space to replay the moves.' : '.')));
        }
        function setChoicesEnabled(on) { optionButtons.forEach(function (b) { b.disabled = !on; }); }
        function choose(j) {
          if (phase !== 'answer' || !item || isInteractive(item)) return;
          var res = checkItem(item, j);
          optionButtons.forEach(function (b, k) { b.disabled = true; if (k === item.answer) b.classList.add('is-correct'); });
          if (!res.correct && optionButtons[j]) optionButtons[j].classList.add('is-wrong');
          if (quizEl) {
            quizEl.classList.add('is-answered');
            Array.prototype.forEach.call(quizEl.querySelectorAll('.cc-opt__sub[hidden]'), function (x) { x.hidden = false; });
          }
          settle(res.correct, res.explain);
        }

        // ---- do it on the cube
        function buildInteractive() {
          mineEl = h('p', { class: 'small m-0 cc-mine' });
          var checkB = btn('Check', 'check', checkNow, 'btn-primary');
          controls = [btn('Undo', 'arrowLeft', undo), btn('Reset', 'refresh', reset), checkB, btn('Show me', 'play', giveUp, 'btn-ghost')];
          answerEl.appendChild(h('p', { class: 'm-0' }, 'Turn the on-screen cube: drag a layer, tap the move buttons, or use the keyboard. It checks itself the moment you get there.'));
          answerEl.appendChild(mineEl);
          if (C.MovePad && typeof C.MovePad.render === 'function') {
            try { pad = C.MovePad.render(padHost, { onMove: userTurn, compact: false, rotations: true }); } catch (e) { pad = null; warn('move pad failed', e); }
          }
          padHost.appendChild(h('div', { class: 'cc-controls' }, controls));
          padHost.appendChild(h('p', { class: 'xsmall subtle m-0' }, keyboardHint()));
          updateMine();
        }
        function setTurning(on) {
          turning = !!on;
          if (view) view.setTurnable(turning);
          if (pad && pad.el) Array.prototype.forEach.call(pad.el.querySelectorAll('button'), function (b) { b.disabled = !turning; });
          if (controls) controls.forEach(function (b) { b.disabled = !turning; });
        }
        function userTurn(tok) {
          if (!turning || !view) return;
          view.userMove(tok);
        }
        function onUserMove(tok) {
          if (phase !== 'answer' && phase !== 'practice') return;
          userMoves.push(tok);
          active();
          updateMine();
          if (checkItem(item, view.getState()).correct) reached();
        }
        function reached() {
          if (phase === 'answer') settle(true, checkItem(item, view.getState()).explain);
          else if (phase === 'practice') practiceDone();
        }
        function updateMine() {
          if (mineEl) {
            UI.empty(mineEl);
            mineEl.appendChild(userMoves.length
              ? h('span', null, h('span', { class: 'subtle' }, 'Your moves: '), h('span', { class: 'mono strong' }, userMoves.join(' ')))
              : h('span', { class: 'subtle' }, 'No moves yet.'));
          }
          if (chipsEl && Array.isArray(item.moves)) chipsEl.update(chipProgress());
        }
        // Which chip you're on, judged by the cube itself: a half turn done as two quarter turns, or a
        // whole-cube turn in between, still counts as following along.
        function chipProgress() {
          var C3 = Cube(), mv = item.moves, n = mv.length;
          var now = view ? view.finalState() : null;
          if (!now) return { current: userMoves.length ? -1 : 0, done: 0 };
          var st = item._start;
          for (var k = 0; k <= n; k++) {
            if (sameUpToRotation(now, st)) return k < n ? { current: k, done: k } : { current: -1, done: true };
            if (k === n) break;
            if (C3.amountOf(mv[k]) === 2) {
              var b = C3.baseOf(mv[k]);
              if (sameUpToRotation(now, C3.applyMove(st, b)) || sameUpToRotation(now, C3.applyMove(st, b + "'"))) return { current: k, done: k };
            }
            st = C3.applyMove(st, mv[k]);
          }
          return { current: -1, done: 0 };
        }
        function undo() {
          if (!turning || !view || !userMoves.length || view.isBusy()) return;
          var tok = userMoves.pop();
          var p = view.play([Cube().invertMove(tok)], { speed: Math.max(1, spd) * 1.5 });
          updateMine();
          p.then(function () {
            if ((phase === 'answer' || phase === 'practice') && checkItem(item, view.getState()).correct) reached();
          });
        }
        function reset() {
          if (!view || (phase !== 'answer' && phase !== 'practice')) return;
          anim.stop();
          resetView(item._start);
          userMoves = [];
          updateMine();
        }
        function checkNow() {
          if (phase !== 'answer' && phase !== 'practice') return;
          if (!userMoves.length) { App.toast('Make your moves on the cube first, then check.'); return; }
          var res = checkItem(item, view ? view.finalState() : item._start);
          if (res.correct) { reached(); return; }
          if (phase === 'answer') settle(false, res.explain);
          else App.toast('Not there yet. Press Reset to start again, or Show me.');
        }
        function giveUp() {
          if (phase === 'answer') settle(false, item.explain);
          showMe();
        }

        // ---- answer, feedback, show me
        function settle(correct, explain) {
          if (phase !== 'answer') return;
          phase = 'feedback';
          results[idx] = { correct: !!correct, item: item };
          recordDrill(item.type || t.id, correct);
          setTurning(false);
          setChoicesEnabled(false);
          setStatus(correct ? 'Correct' : '');
          updateDots();
          renderFeedback(correct, explain || item.explain);
        }
        function canShow() {
          return !!view && !!((item.type === 'notation' && item.demo) || intendedMoves(item, item._start) || item.demo);
        }
        function renderFeedback(correct, explain) {
          UI.empty(feedbackEl);
          var last = idx >= items.length - 1;
          var nextB = h('button', { type: 'button', class: 'btn btn-primary', onClick: next }, last ? 'See my score' : 'Next question', UI.icon('arrowRight', 16));
          var showB = canShow() ? btn(correct ? 'Show it again' : 'Show me', 'play', showMe) : null;
          var tryB = isInteractive(item) && !correct ? btn('Try it yourself', 'hand', practise, 'btn-ghost') : null;
          var praise = ['Correct!', 'Yes, that’s it.', 'Spot on.', 'Nicely done.'][idx % 4];
          feedbackEl.appendChild(UI.callout(correct ? 'success' : 'warn', correct ? praise : 'Not quite',
            explain ? h('p', { class: 'm-0' }, explain) : null,
            h('div', { class: 'row row-sm mt-2' }, nextB, showB, tryB)));
          try { nextB.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
          try { feedbackEl.scrollIntoView({ block: 'nearest', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
        }
        function showMe() {
          if (!view) return;
          var mv, from;
          if (item.demo && (item.type === 'notation' || !intendedMoves(item, item._start))) { mv = item.demo; from = item.state; }
          else { mv = intendedMoves(item, item._start); from = item._start; }
          if (phase === 'practice') phase = 'feedback';
          setTurning(false);
          anim.stop();
          if (!mv || !mv.length) {
            if (Array.isArray(item.targetState)) { view.setState(item.targetState); setStatus('This is where you were heading'); }
            return;
          }
          resetView(from);
          anim.after(350, function () {
            anim.play(mv, {
              arrows: true, speed: spd * 0.7,
              onMove: function (i, tok) { setStatus(tok + ' — ' + moveText(tok)); active(); }
            }).then(function (ok) { if (ok) setStatus('Done'); });
          });
        }
        function practise() {
          if (!view) return;
          phase = 'practice';
          anim.stop();
          resetView(item._start);
          userMoves = [];
          updateMine();
          setTurning(true);
          setStatus('Practice: not scored');
          App.toast('Have a go. This one isn’t scored again.');
        }
        function practiceDone() {
          phase = 'feedback';
          setTurning(false);
          setStatus('Got it');
          UI.empty(feedbackEl);
          var nextB = h('button', { type: 'button', class: 'btn btn-primary', onClick: next }, idx >= items.length - 1 ? 'See my score' : 'Next question', UI.icon('arrowRight', 16));
          feedbackEl.appendChild(UI.callout('success', 'That’s it, well done.',
            h('p', { class: 'm-0' }, 'It still counts as a miss in this round’s score, but doing it right once is what makes it stick.'),
            h('div', { class: 'row row-sm mt-2' }, nextB)));
          try { nextB.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        function next() {
          if (phase !== 'feedback') return;
          if (idx < items.length - 1) show(idx + 1); else summary();
        }

        function updateDots() {
          var right = 0, done = 0;
          dotEls.forEach(function (li, i) {
            var r = results[i];
            if (r) { done++; if (r.correct) right++; }
            li.className = r ? (r.correct ? 'is-right' : 'is-wrong') : (i === idx ? 'is-current' : '');
            li.firstChild.textContent = 'Question ' + (i + 1) + (r ? (r.correct ? ': right' : ': missed') : i === idx ? ': now' : '');
            if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
          });
          scoreEl.textContent = right + ' of ' + done + ' right';
        }

        function onKeyRun(e) {
          var k = e.key;
          if (phase === 'feedback') {
            if (k === 'Enter' && !onControl(e)) { e.preventDefault(); next(); }
            else if (k === ' ' && item.demo && !onControl(e)) { e.preventDefault(); replay(); }
            return;
          }
          if (phase === 'answer' && !isInteractive(item)) {
            if (/^[1-9]$/.test(k)) {
              var j = Number(k) - 1;
              if (j < optionButtons.length) { e.preventDefault(); choose(j); }
            } else if (k === ' ' && item.demo && !onControl(e)) { e.preventDefault(); replay(); }
            return;
          }
          if ((phase === 'answer' || phase === 'practice') && isInteractive(item) && turning) {
            if (k === 'Backspace') { e.preventDefault(); undo(); return; }
            if (k === 'Enter' && !onControl(e)) { e.preventDefault(); checkNow(); return; }
            var tok = C.Keys && C.Keys.toMove ? C.Keys.toMove(e, settings().keyboard === 'cstimer' ? 'cstimer' : 'simple') : null;
            if (tok) { e.preventDefault(); userTurn(tok); }
          }
        }

        function summary() {
          newPanel();     // disposes the runner's cube view, timers and keys
          // The address now points at the drill list, so Back from "Watch…" or the notation guide lands
          // there rather than silently starting a fresh session.
          state.type = null;
          syncHash();
          var right = 0, misses = [];
          items.forEach(function (it, i) {
            var r = results[i];
            if (r && r.correct) right++; else misses.push({ i: i, item: it });
          });
          var total = items.length, pct = Math.round(right / total * 100);
          var stageForMore = sid || (misses.length ? misses[0].item.stageId : null);
          var msg = pct >= 90 ? 'Excellent. You clearly know this one. Next time, try to answer faster.'
            : pct >= 70 ? 'Good work. One more round will lock it in.'
              : pct >= 50 ? 'Getting there. Read the notes below, then go again.'
                : stageForMore ? 'This one is still new, and that’s fine. Watch the demo for this stage, then try again: it gets easier quickly.'
                  : 'This one is still new, and that’s fine. Have another look at the notation guide, then try again: it gets easier quickly.';
          function answerLabel(it) {
            if (!Array.isArray(it.options) || typeof it.answer !== 'number') return null;
            var o = it.options[it.answer];
            var s = typeof o === 'string' ? o : isObj(o) ? (o.label || o.text || o.name || null) : null;
            return s && (it.type === 'reps' || it.cpKind === 'reps') && /^\d+$/.test(s) ? s + (s === '1' ? ' time' : ' times') : s;
          }
          var d = data(), all = d && isObj(d.drills) ? d.drills[t.id] : null;
          var finalDots = h('ol', { class: 'cc-dots', 'aria-label': 'Your answers' }, items.map(function (it, i) {
            var r = results[i];
            return h('li', { class: r && r.correct ? 'is-right' : 'is-wrong' }, h('span', { class: 'sr-only' }, 'Question ' + (i + 1) + (r && r.correct ? ': right' : ': missed')));
          }));
          var heading = h('h2', { class: 'cc-big', tabindex: '-1' }, right + ' out of ' + total);
          panelEl.appendChild(h('section', { class: 'card stack', 'aria-labelledby': 'cc-sum-title' },
            h('p', { class: 'eyebrow m-0', id: 'cc-sum-title' }, (t.name || t.id) + (sid ? ' · ' + stageTitle(sid) : '') + ' · done'),
            heading,
            h('p', { class: 'lead m-0' }, msg),
            finalDots,
            misses.length ? h('div', { class: 'stack stack-sm' },
              h('h3', { class: 'h4 m-0' }, 'Worth another look'),
              h('ul', { class: 'cc-misses' }, misses.map(function (m) {
                var ans = answerLabel(m.item);
                return h('li', null,
                  h('p', { class: 'strong m-0' }, 'Question ' + (m.i + 1) + (ans ? ' · answer: ' + ans : '')),
                  m.item.type !== 'notation' && m.item.prompt ? h('p', { class: 'small m-0' }, m.item.prompt) : null,
                  m.item.explain ? h('p', { class: 'small muted m-0' }, m.item.explain) : null);
              }))) : h('p', { class: 'm-0' }, 'A clean sheet: nothing to review.'),
            all && all.total ? h('p', { class: 'small subtle m-0' }, 'All time: ' + all.right + ' of ' + all.total + ' right (' + Math.round(all.right / all.total * 100) + '%).') : null,
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { startSession(t.id); } }, UI.icon('refresh', 18), 'Again'),
              btn('Choose another drill', 'zap', exitToHub),
              stageForMore ? btn('Watch ' + stageTitle(stageForMore), 'watch', go('watch', { stage: stageForMore }), 'btn-ghost')
                : btn('Notation guide', 'learn', go('lesson', { id: 'notation' }), 'btn-ghost'))));
          try { heading.focus(); } catch (e) { /* ignore */ }
        }
      }

      // ============================================================ tab 2: algorithms
      function algIds() {
        var base = (C.Coach && Array.isArray(C.Coach.ALG_IDS) && C.Coach.ALG_IDS.length) ? C.Coach.ALG_IDS : ALG_IDS;
        return base.filter(function (id) { return !!safe(function () { return algInfo(id); }, null); });
      }
      function algDue() {
        var d = data();
        return safe(function () { return C.Coach.algDue(d); }, []).filter(function (id) { return algIds().indexOf(id) !== -1; });
      }
      function usedInText(info) {
        return info.usedIn.length ? 'Used in: ' + info.usedIn.map(stageTitle).join(', ') : '';
      }

      function renderAlgs() {
        var scope = newPanel(true);
        var d = data(), ids = algIds(), due = algDue();
        var algs = d && isObj(d.algs) ? d.algs : {};
        var known = ids.filter(function (id) { return isObj(algs[id]); });
        var nextDue = null;
        known.forEach(function (id) {
          var t = Date.parse(algs[id].due);
          if (isFinite(t) && (nextDue === null || t < nextDue)) nextDue = t;
        });

        var head;
        if (due.length) {
          head = h('section', { class: 'card card-accent stack stack-sm' },
            h('h2', { class: 'card__title' }, due.length === 1 ? '1 algorithm to review today' : due.length + ' algorithms to review today'),
            h('p', { class: 'm-0' }, 'You’ll see each case on the cube. Recall the moves (say them, or air-cube them), then check yourself. About a minute each.'),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { startReview(due); } }, UI.icon('play', 18), 'Start review')));
        } else {
          head = h('section', { class: 'card card-muted stack stack-sm' },
            h('h2', { class: 'card__title' }, known.length ? 'All caught up' : 'Your algorithm cards'),
            h('p', { class: 'm-0' }, known.length
              ? 'Nothing is due right now. ' + (nextDue ? 'Next review ' + fmtDue(new Date(nextDue).toISOString()) + '. ' : '') + 'Spacing reviews out is what makes them stick.'
              : 'A card joins your reviews once you’ve practised its stage, or as soon as you practise it here. Each one comes back just before you’d forget it.'),
            h('div', { class: 'row' }, btn(known.length ? 'Review all ' + ids.length + ' anyway' : 'Practise all ' + ids.length, 'zap', function () { startReview(ids); })));
        }

        var current = null;   // the open "Watch" player
        function swapIcon(b, name) {
          try { if (b.firstChild && b.firstChild !== b.lastChild) b.replaceChild(UI.icon(name, 16), b.firstChild); } catch (e) { /* ignore */ }
        }
        function closeWatch() {
          if (!current) return;
          var c = current;
          current = null;
          c.scope.dispose();
          UI.empty(c.host);
          c.host.hidden = true;
          c.btn.setAttribute('aria-expanded', 'false');
          c.label.textContent = 'Watch';
          swapIcon(c.btn, 'play');
          c.chips.update({ current: -1 });
        }
        function openWatch(info, host, chips, watchBtn, label) {
          if (current && current.host === host) { closeWatch(); return; }
          closeWatch();
          var ws = new Scope();
          scope.add(function () { ws.dispose(); });
          host.hidden = false;
          watchBtn.setAttribute('aria-expanded', 'true');
          label.textContent = 'Close';
          swapIcon(watchBtn, 'x');
          var vh = h('div', { class: 'viewport-3d cc-view cc-view--sm' });
          var cap = h('p', { class: 'small cc-alg__cap', 'aria-live': 'polite' });
          host.appendChild(vh);
          host.appendChild(h('div', { class: 'row row-sm row-between' }, cap, btn('Replay', 'refresh', run)));
          var v = makeView(ws, vh, { interactive: true, label: info.name + ' demo' });
          var anim = makeAnimator(ws, v);
          current = { scope: ws, host: host, btn: watchBtn, chips: chips, label: label };
          var n = info.tokens.length;
          function run() {
            if (!v) return;
            anim.stop();
            v.setState(info.setup);
            chips.update({ current: -1 });
            cap.textContent = 'Yellow on top, green in front. This is the case the ' + info.name + ' fixes. Watch the arrows…';
            anim.after(900, function () {
              anim.play(info.play, {
                arrows: true, speed: animSpeed() * 0.8,
                onMove: function (i, tok) {
                  chips.update({ current: i % n });
                  cap.textContent = (info.reps > 1 ? 'Go ' + (Math.floor(i / n) + 1) + ' of ' + info.reps + ' · ' : '') + tok + ' — ' + info.plain[i % n];
                  active();
                }
              }).then(function (ok) {
                if (!ok) return;
                chips.update({ done: true });
                cap.textContent = 'Done: that’s the whole ' + info.name + (info.reps > 1 ? ', twice' : '') + '. Press Replay to watch again.';
              });
            }, 900);
          }
          run();
        }

        function algCard(info) {
          var e = algs[info.id];
          var isDue = due.indexOf(info.id) !== -1;
          var box = isObj(e) ? Math.max(1, Math.min(5, Math.round(Number(e.box) || 1))) : 0;
          var badge = isDue ? h('span', { class: 'badge badge-warn' }, 'Due')
            : box ? h('span', { class: 'badge badge-success' }, 'Box ' + box + ' of 5') : h('span', { class: 'badge' }, 'New');
          var chips = UI.algChips(info.tokens, { label: info.name + ' moves' });
          var host = h('div', { class: 'cc-alg__player', hidden: true });
          var label = h('span', null, 'Watch');
          var watchBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-expanded': 'false', onClick: function () { openWatch(info, host, chips, watchBtn, label); } }, UI.icon('play', 16), label);
          return h('article', { class: 'card cc-alg stack stack-sm', 'aria-labelledby': 'cc-alg-' + info.id },
            h('div', { class: 'card__head m-0' }, h('h3', { class: 'card__title', id: 'cc-alg-' + info.id }, info.name), badge),
            info.summary ? h('p', { class: 'small muted m-0' }, info.summary) : null,
            usedInText(info) ? h('p', { class: 'xsmall subtle m-0' }, usedInText(info)) : null,
            chips,
            info.note ? h('p', { class: 'xsmall subtle m-0' }, info.note) : null,
            info.mnemonic ? h('p', { class: 'small m-0' }, h('span', { class: 'strong' }, 'Memory hook: '), info.mnemonic) : null,
            h('details', { class: 'cc-details' }, h('summary', null, 'Each move in plain English'),
              h('ol', { class: 'cc-plain' }, info.tokens.map(function (tok, i) {
                return h('li', null, h('span', { class: 'mono strong' }, tok), ' — ', info.plain[i]);
              }))),
            info.fingerTricks ? h('details', { class: 'cc-details' }, h('summary', null, 'Finger tricks'), h('p', { class: 'small m-0' }, info.fingerTricks)) : null,
            host,
            h('div', { class: 'row row-sm' }, watchBtn, btn('Practise', 'zap', function () { startReview([info.id]); }, 'btn-ghost')),
            isObj(e) && Number(e.total) > 0 ? h('p', { class: 'xsmall subtle m-0' },
              'Remembered ' + (Number(e.right) || 0) + ' of ' + e.total + ' times · ' + (isDue ? 'due now' : 'next review ' + fmtDue(e.due))) : null);
        }

        var infos = ids.map(algInfo).filter(Boolean);
        panelEl.appendChild(h('div', { class: 'stack' }, head, h('div', { class: 'cc-alg-grid' }, infos.map(algCard))));
      }

      function startReview(ids) {
        var scope = newPanel();
        var queue = ids.filter(function (id) { return !!algInfo(id); });
        if (!queue.length) { renderAlgs(); return; }
        var pos = 0, log = [], info = null, mode = 'recall', moves = [], pad = null, controls = null, mineEl = null;
        var dotEls = queue.map(function (id, i) { return h('li', null, h('span', { class: 'sr-only' }, 'Card ' + (i + 1))); });
        var countEl = h('span', { class: 'badge badge-accent' });
        var statusEl = h('span', { class: 'cc-status' });
        var viewHost = h('div', { class: 'viewport-3d cc-view' }, h('div', { class: 'viewport-3d__overlay' }, statusEl));
        var padHost = h('div', { class: 'stack stack-sm cc-padhost' });
        var body = h('div', { class: 'stack' });
        panelEl.appendChild(h('section', { class: 'cc-run stack', 'aria-labelledby': 'cc-rev-title' },
          h('div', { class: 'row cc-run__top' },
            btn('All algorithms', 'arrowLeft', renderAlgs, 'btn-ghost'),
            h('h2', { class: 'h3 m-0 cc-run__title', id: 'cc-rev-title' }, 'Algorithm review'),
            countEl),
          h('ol', { class: 'cc-dots', 'aria-label': 'Progress' }, dotEls),
          h('div', { class: 'cc-run__grid' },
            h('div', { class: 'stack stack-sm' }, viewHost),
            h('div', { class: 'stack' }, body, padHost))));
        var view = makeView(scope, viewHost, { interactive: true, turnable: false, label: 'Algorithm case' });
        var anim = makeAnimator(scope, view);
        if (view) view.onUserMove = onUserMove;
        scope.add(function () { if (pad) pad.destroy(); pad = null; });
        keyHandler = onKeyReview;
        showCard();
        scrollToRun();

        function updateDots() {
          dotEls.forEach(function (li, i) {
            var r = log[i];
            li.className = r ? (r.ok ? 'is-right' : 'is-wrong') : (i === pos ? 'is-current' : '');
            li.firstChild.textContent = 'Card ' + (i + 1) + (r ? (r.ok ? ': got it' : ': not yet') : i === pos ? ': now' : '');
          });
          countEl.textContent = 'Card ' + Math.min(pos + 1, queue.length) + ' of ' + queue.length;
        }
        function clearPad() {
          if (pad) { pad.destroy(); pad = null; }
          controls = null;
          UI.empty(padHost);
          if (view) view.setTurnable(false);
        }
        function showCase() {
          anim.stop();
          if (view) { view.showArrow(null); view.setState(info.setup); }
        }

        function showCard() {
          info = algInfo(queue[pos]);
          mode = 'recall';
          moves = [];
          mineEl = null;
          clearPad();
          showCase();
          statusEl.textContent = '';
          updateDots();
          UI.empty(body);
          var revealB = h('button', { type: 'button', class: 'btn btn-primary', onClick: reveal }, UI.icon('watch', 18), 'Reveal the moves');
          var title = h('h3', { class: 'h2 m-0', tabindex: '-1' }, info.name);
          body.appendChild(h('div', { class: 'card stack stack-sm' },
            h('p', { class: 'eyebrow m-0' }, 'Card ' + (pos + 1) + ' of ' + queue.length),
            title,
            usedInText(info) ? h('p', { class: 'small subtle m-0' }, usedInText(info)) : null,
            h('p', { class: 'm-0' }, 'The cube shows the case this algorithm fixes (yellow on top, green in front). Recall the moves: say them out loud, or air-cube them with your hands. Then reveal and be honest with yourself.'),
            h('div', { class: 'row row-sm' }, revealB, btn('Do it on the virtual cube', 'hand', virtualMode)),
            h('p', { class: 'xsmall subtle m-0' }, 'Keys: Space reveals.')));
          if (pos > 0) { try { title.focus(); } catch (e) { /* ignore */ } }
        }

        function answerBlock() {
          var mb = movesBlock(info.tokens, info.name + ' moves');
          return { chips: mb.chips, el: h('div', { class: 'stack stack-sm' }, mb.el,
            info.reps > 1 ? h('p', { class: 'small m-0' }, 'Here it takes ' + info.reps + ' goes.') : null,
            info.mnemonic ? h('p', { class: 'small m-0' }, h('span', { class: 'strong' }, 'Memory hook: '), info.mnemonic) : null) };
        }
        function playAnswer(chips) {
          showCase();
          var n = info.tokens.length;
          anim.after(500, function () {
            anim.play(info.play, {
              arrows: true, speed: animSpeed() * 0.8,
              onMove: function (i, tok) { chips.update({ current: i % n }); statusEl.textContent = tok + ' — ' + info.plain[i % n]; active(); }
            }).then(function (ok) { if (ok) { chips.update({ done: true }); statusEl.textContent = 'Back to solved'; } });
          });
        }

        function reveal() {
          if (mode !== 'recall' && mode !== 'virtual') return;
          mode = 'revealed';
          clearPad();
          UI.empty(body);
          var ab = answerBlock();
          var notYet = h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { grade(false); } }, 'Not yet');
          var gotIt = h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { grade(true); } }, UI.icon('check', 18), 'Got it');
          body.appendChild(h('div', { class: 'card stack stack-sm' },
            h('p', { class: 'eyebrow m-0' }, 'Card ' + (pos + 1) + ' of ' + queue.length),
            h('h3', { class: 'h2 m-0' }, info.name),
            ab.el,
            h('p', { class: 'strong m-0' }, 'Did you remember it?'),
            h('div', { class: 'row row-sm' }, notYet, gotIt),
            h('p', { class: 'xsmall subtle m-0' }, 'Keys: 1 = not yet, 2 = got it. Be strict: a card you nearly knew comes back sooner, which is what you want.')));
          try { gotIt.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
          playAnswer(ab.chips);
        }

        function updateMine() {
          if (!mineEl) return;
          UI.empty(mineEl);
          mineEl.appendChild(moves.length
            ? h('span', null, h('span', { class: 'subtle' }, 'Your moves: '), h('span', { class: 'mono strong' }, moves.join(' ')))
            : h('span', { class: 'subtle' }, 'No moves yet.'));
        }
        function undoVirtual() {
          if (mode !== 'virtual' || !view || !moves.length || view.isBusy()) return;
          var tok = moves.pop();
          updateMine();
          view.play([Cube().invertMove(tok)], { speed: Math.max(1, animSpeed()) * 1.5 }).then(checkSolved);
        }
        function virtualMode() {
          if (mode !== 'recall') return;
          mode = 'virtual';
          moves = [];
          showCase();
          UI.empty(body);
          mineEl = h('p', { class: 'small m-0 cc-mine' });
          body.appendChild(h('div', { class: 'card stack stack-sm' },
            h('p', { class: 'eyebrow m-0' }, 'Card ' + (pos + 1) + ' of ' + queue.length + ' · on the virtual cube'),
            h('h3', { class: 'h2 m-0' }, info.name),
            h('p', { class: 'm-0' }, 'Do “' + info.name + '”' + (info.reps > 1 ? ' (' + info.reps + ' goes)' : '') + ' from memory: drag the layers, tap the buttons or use the keyboard. When the cube is solved it counts as “got it” automatically.'),
            mineEl));
          updateMine();
          controls = [
            btn('Undo', 'arrowLeft', undoVirtual),
            btn('Reset', 'refresh', function () { if (mode === 'virtual') { showCase(); moves = []; updateMine(); } }),
            btn('Show me', 'play', showVirtualAnswer, 'btn-ghost')
          ];
          if (C.MovePad && typeof C.MovePad.render === 'function') {
            try { pad = C.MovePad.render(padHost, { onMove: function (tok) { if (mode === 'virtual' && view) view.userMove(tok); }, rotations: true }); } catch (e) { pad = null; }
          }
          padHost.appendChild(h('div', { class: 'cc-controls' }, controls));
          padHost.appendChild(h('p', { class: 'xsmall subtle m-0' }, keyboardHint()));
          if (view) view.setTurnable(true);
          statusEl.textContent = 'Your turn';
        }
        // Gave up on the virtual cube: counts as "not yet", then shows the answer.
        function showVirtualAnswer() {
          if (mode !== 'virtual') return;
          mode = 'shown';
          clearPad();
          doGrade(false);
          UI.empty(body);
          var ab = answerBlock();
          var last = pos >= queue.length - 1;
          var nextB = h('button', { type: 'button', class: 'btn btn-primary', onClick: advance }, last ? 'Finish' : 'Next card', UI.icon('arrowRight', 16));
          body.appendChild(h('div', { class: 'card stack stack-sm' },
            h('p', { class: 'eyebrow m-0' }, 'Card ' + (pos + 1) + ' of ' + queue.length),
            h('h3', { class: 'h2 m-0' }, info.name),
            ab.el,
            UI.callout('warn', 'Marked as “not yet”', h('p', { class: 'm-0' }, 'It comes back soon. Watch the arrows on the cube, then say the moves to yourself once.'),
              h('div', { class: 'row row-sm mt-2' }, nextB))));
          try { nextB.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
          playAnswer(ab.chips);
        }
        function checkSolved() {
          if (mode !== 'virtual' || !view) return;
          if (Cube().isSolved(view.getState())) solvedIt();
        }
        function onUserMove(tok) {
          if (mode !== 'virtual') return;
          moves.push(tok);
          active();
          updateMine();
          checkSolved();
        }
        function solvedIt() {
          mode = 'solved';
          if (view) view.setTurnable(false);
          if (controls) controls.forEach(function (b) { b.disabled = true; });
          if (pad && pad.el) Array.prototype.forEach.call(pad.el.querySelectorAll('button'), function (b) { b.disabled = true; });
          statusEl.textContent = 'Solved';
          var e = doGrade(true);
          var last = pos >= queue.length - 1;
          var nextB = h('button', { type: 'button', class: 'btn btn-primary', onClick: advance }, last ? 'Finish' : 'Next card', UI.icon('arrowRight', 16));
          body.appendChild(UI.callout('success', 'Solved from memory!',
            h('p', { class: 'm-0' }, 'Marked as “got it”. ' + (e ? 'Next review ' + fmtDue(e.due) + '.' : '')),
            h('div', { class: 'row row-sm mt-2' }, nextB)));
          try { nextB.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
        }

        function doGrade(ok) {
          var e = null;
          try { if (C.Coach && C.Coach.gradeAlg) e = C.Coach.gradeAlg(data(), info.id, !!ok); } catch (err) { warn('gradeAlg failed', err); }
          save();
          active();
          log[pos] = { id: info.id, name: info.name, ok: !!ok, due: e && e.due };
          updateDots();
          return e;
        }
        function grade(ok) {
          if (mode !== 'revealed') return;
          mode = 'graded';
          doGrade(ok);
          advance();
        }
        function advance() {
          if (pos < queue.length - 1) { pos++; showCard(); } else finishReview();
        }

        function onKeyReview(e) {
          var k = e.key;
          if (mode === 'recall') {
            if ((k === ' ' || k === 'Enter') && !onControl(e)) { e.preventDefault(); reveal(); }
          } else if (mode === 'revealed') {
            if (k === '1') { e.preventDefault(); grade(false); } else if (k === '2') { e.preventDefault(); grade(true); }
          } else if (mode === 'virtual') {
            if (k === 'Backspace') { e.preventDefault(); undoVirtual(); return; }
            var tok = C.Keys && C.Keys.toMove ? C.Keys.toMove(e, settings().keyboard === 'cstimer' ? 'cstimer' : 'simple') : null;
            if (tok && view) { e.preventDefault(); view.userMove(tok); }
          } else if (mode === 'solved' || mode === 'shown') {
            if (k === 'Enter' && !onControl(e)) { e.preventDefault(); advance(); }
          }
        }

        function finishReview() {
          newPanel();
          var got = log.filter(function (r) { return r && r.ok; }).length;
          var misses = queue.filter(function (id, i) { return !(log[i] && log[i].ok); });
          var heading = h('h2', { class: 'cc-big', tabindex: '-1' }, got + ' of ' + queue.length + ' remembered');
          panelEl.appendChild(h('section', { class: 'card stack' },
            h('p', { class: 'eyebrow m-0' }, 'Review done'),
            heading,
            h('p', { class: 'lead m-0' }, got === queue.length ? 'All of them. They’ll come back at longer and longer gaps.'
              : 'The ones you missed come back soon. Watching them once more now really helps.'),
            h('ul', { class: 'cc-misses' }, queue.map(function (id, i) {
              var r = log[i] || { name: id, ok: false };
              return h('li', { class: 'row row-between' },
                h('span', { class: 'strong' }, r.name || id),
                h('span', { class: ['badge', r.ok ? 'badge-success' : 'badge-warn'] }, r.ok ? 'Got it · next ' + fmtDue(r.due) : 'Not yet · back soon'));
            })),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn btn-primary', onClick: renderAlgs }, UI.icon('arrowLeft', 18), 'All algorithms'),
              misses.length ? btn('Go over the misses again', 'refresh', function () { startReview(misses); }) : null)));
          try { heading.focus(); } catch (e) { /* ignore */ }
        }
      }

      // ============================================================ tab 3: stage practice
      function renderStages() {
        var scope = newPanel(true);
        var d = data(), Co = C.Coach, list = stages();
        var st = safe(function () { return Co.stats(d); }, null);
        var slow = st && st.slowestStage ? st.slowestStage : null;
        var mast = {}, lvl = {};
        list.forEach(function (s) {
          var sk = d && isObj(d.skills) && isObj(d.skills[s.id]) ? d.skills[s.id] : {};
          mast[s.id] = Math.round(safe(function () { return Co.masteryOf(d, s.id); }, Number(sk.mastery) || 0) || 0);
          var L = safe(function () { return Co.levelFor(d, s.id); }, 3);
          lvl[s.id] = L >= 0 && L <= 3 ? L : 3;
        });
        // Weakest of the stages practised so far: stages not started yet all sit at 0 and would always
        // "win", pointing a learner who is stuck on one stage at a stage they haven't been taught.
        var weakest = weakestPractised(list, mast, d);
        var mastered = list.filter(function (s) { return mast[s.id] >= SOLO_MASTERY; }).map(function (s) { return s.id; });
        var levelText = (Co && Array.isArray(Co.LEVEL_TEXT)) ? Co.LEVEL_TEXT : LEVEL_TEXT;
        var levelNames = (Co && Array.isArray(Co.LEVELS)) ? Co.LEVELS.map(function (x) { return x.name; }) : LEVEL_NAMES;
        var drillStages = {};
        drillTypes().forEach(function (t) { (t.stageIds || []).forEach(function (id) { drillStages[id] = true; }); });

        var focusReason = slow && slow !== weakest
          ? [h('strong', null, stageTitle(slow)), ' is the slowest part of your recent solves, and ', h('strong', null, stageTitle(weakest)), ' has the lowest mastery. Either is a good use of today.']
          : slow ? [h('strong', null, stageTitle(slow)), ' is both the slowest part of your solves and your weakest stage. Practise it a few times today.']
            : mastered.length === list.length ? ['Every stage is at Solo level. Timed solves are the best practice now.']
              : [h('strong', null, stageTitle(weakest)), ' has the lowest mastery so far. A couple of runs on the virtual cube will move it up.'];
        var gymNudge = weakest === 'middle' && C.Gym && mast.middle < SOLO_MASTERY;
        if (gymNudge) focusReason = focusReason.concat([' Stuck on the middle layer? The Middle Layer Gym has short exercises for each part of it.']);

        function stageCard(s, i) {
          var m = mast[s.id], L = lvl[s.id];
          var isFocus = s.id === weakest || s.id === slow;
          var badges = [];
          if (s.id === slow) badges.push(h('span', { class: 'badge badge-warn' }, 'Slowest'));
          if (s.id === weakest) badges.push(h('span', { class: 'badge badge-accent' }, 'Weakest'));
          return h('li', { class: ['card', 'card-sm', 'cc-stage', isFocus ? 'is-focus' : null, s.id === state.stage ? 'is-selected' : null], id: 'cc-stage-' + s.id },
            h('div', { class: 'cc-stage__head' },
              h('span', { class: 'cc-stage__num', 'aria-hidden': 'true' }, String(i + 1)),
              h('div', null,
                h('h3', { class: 'h4 m-0' }, s.name, badges.length ? [' ', badges] : null),
                h('p', { class: 'small muted m-0' }, s.goal || '')),
              h('div', { class: 'cc-stage__level' },
                h('span', { class: ['badge', LEVEL_BADGE[L]] }, levelNames[L] || LEVEL_NAMES[L]),
                h('span', { class: 'xsmall subtle' }, 'Mastery ' + m + '/100'))),
            h('div', {
              class: ['progress', 'progress-sm', m >= SOLO_MASTERY ? 'progress-success' : null], role: 'meter',
              'aria-label': s.name + ' mastery', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': m
            }, h('div', { class: 'progress__bar', style: { width: m + '%' } })),
            h('p', { class: 'xsmall subtle m-0' }, 'Help you’ll get: ' + (levelText[L] || '')),
            h('div', { class: 'row row-sm' },
              h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: go('solve', { device: 'virtual', source: 'drill', stage: s.id }) }, UI.icon('cube', 16), 'Practise on the virtual cube'),
              btn('With my cube', 'hand', go('solve', { device: 'physical', source: 'drill', stage: s.id })),
              btn('Watch it', 'watch', go('watch', { stage: s.id }), 'btn-ghost'),
              btn('Lesson', 'learn', go('lesson', { id: s.id }), 'btn-ghost'),
              drillStages[s.id] ? btn('Drills', 'zap', function () { state.stage = s.id; showTab('drills'); tabButtons.drills.focus(); }, 'btn-ghost') : null,
              s.id === 'middle' && C.Gym ? btn('Middle Layer Gym', 'zap', go('gym'), 'btn-soft') : null));
        }

        panelEl.appendChild(h('div', { class: 'stack' },
          h('p', { class: 'muted cc-intro' }, 'Practise one stage at a time. Each run sets up a cube where every earlier stage is already done, and stops when this stage is finished. Help steps down as your mastery grows.'),
          h('div', { class: 'card card-sm stack stack-sm' },
            UI.stageTrack(weakest, mastered, { caption: false }),
            h('p', { class: 'small subtle m-0' }, mastered.length + ' of ' + list.length + ' stages at Solo level (mastery ' + SOLO_MASTERY + '+).')),
          UI.callout('tip', 'Where to focus', h('p', { class: 'm-0' }, focusReason),
            gymNudge ? h('div', { class: 'row row-sm mt-2' }, btn('Middle Layer Gym', 'zap', go('gym'), 'btn-soft')) : null),
          h('ol', { class: 'cc-stages' }, list.map(stageCard))));

        if (state.stage) {
          scope.timeout(function () {
            var target = document.getElementById('cc-stage-' + state.stage);
            if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: UI.reducedMotion() ? 'auto' : 'smooth' });
          }, 60);
        }
      }

      // ============================================================ tab 4: timed
      function renderTimed() {
        newPanel(true);
        var d = data(), Co = C.Coach, set = settings();
        var ps = safe(function () { return Co.stats(d, { device: 'physical' }); }, null);
        var vs = safe(function () { return Co.stats(d, { device: 'virtual' }); }, null);
        var goalMs = (ps && ps.goalMs) || (Number(set.goalSeconds) || 180) * 1000;
        function t(ms, dnf) { return dnf ? 'DNF' : ms == null ? '—' : UI.fmtTime(ms); }
        function stat(label, value, sub) {
          return h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), h('span', { class: 'stat__value' }, value), sub ? h('span', { class: 'stat__sub' }, sub) : null);
        }
        // "—" until there are enough solves: say how many it takes rather than "last 12 solves".
        function avgSub(n) { var have = ps ? (ps.attempts != null ? ps.attempts : ps.count) : 0; return have >= n ? 'last ' + n + ' solves' : 'after ' + n + ' solves'; }
        var unaidedBest = ps && ps.unaided ? ps.unaided.best : null;
        var beat = unaidedBest != null && unaidedBest < goalMs;
        var tips = safe(function () { return C.Lessons.SPEED_TIPS.slice(0, 3); }, []);

        panelEl.appendChild(h('div', { class: 'stack' },
          h('section', { class: 'card stack' },
            h('h2', { class: 'card__title' }, 'Speed practice'),
            h('p', { class: 'muted m-0 cc-intro' }, 'Once you can finish a solve with a little help, the clock helps you get smooth. Your goal: any cube in under ' + UI.fmtTime(goalMs).replace(/\.00$/, '') + ', on your own. A timed solve works like this:'),
            h('ol', { class: 'cc-steps' },
              h('li', null, h('span', { class: 'cc-steps__num', 'aria-hidden': 'true' }, '1'),
                h('div', null, h('p', { class: 'strong m-0' }, 'Scramble'),
                  h('p', { class: 'small muted m-0' }, 'You get a scramble. Hold your cube with WHITE on top and GREEN in front, and do the moves. (On the virtual cube it’s done for you.)'))),
              h('li', null, h('span', { class: 'cc-steps__num', 'aria-hidden': 'true' }, '2'),
                h('div', null, h('p', { class: 'strong m-0' }, 'Inspect for 15 seconds'),
                  h('p', { class: 'small muted m-0' }, set.inspection === false
                    ? 'Inspection is switched off in Settings, so the clock starts straight away.'
                    : 'Don’t turn any layers yet. You may turn the whole cube: put yellow on top, find the white edges and plan your first petals.'))),
              h('li', null, h('span', { class: 'cc-steps__num', 'aria-hidden': 'true' }, '3'),
                h('div', null, h('p', { class: 'strong m-0' }, 'Solve against the clock'),
                  h('p', { class: 'small muted m-0' }, 'Start, solve, stop. No tips appear unless you ask for a hint, and any hint means the time doesn’t count as unaided.')))),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn btn-primary', onClick: go('solve', { device: 'physical', source: 'scramble', timed: true }) }, UI.icon('timer', 18), 'Timed solve with my cube'),
              h('button', { type: 'button', class: 'btn btn-secondary', onClick: go('solve', { device: 'virtual', source: 'scramble', timed: true }) }, UI.icon('cube', 18), 'Timed solve on the virtual cube'))),
          h('section', { class: 'card stack' },
            h('div', { class: 'card__head m-0' },
              h('h2', { class: 'card__title' }, 'Your times with a real cube'),
              ps && ps.count ? h('span', { class: 'small muted' }, ps.count + (ps.count === 1 ? ' solve' : ' solves')) : null),
            ps && ps.count
              ? h('div', { class: 'cc-statgrid' },
                stat('Best', t(ps.best)),
                stat('Average of 5', t(ps.ao5, ps.ao5Dnf), avgSub(5)),
                stat('Average of 12', t(ps.ao12, ps.ao12Dnf), avgSub(12)),
                stat('Best unaided', t(unaidedBest), 'no hints'))
              : h('p', { class: 'm-0' }, 'No real-cube solves yet. Your first timed solve sets your baseline, however long it takes.'),
            beat ? UI.callout('success', 'Goal reached', 'Your best unaided solve is under ' + UI.fmtTime(goalMs).replace(/\.00$/, '') + '. Keep your average of 5 there too.')
              : ps && ps.count ? h('p', { class: 'small muted m-0' }, 'Averages say more than single times: they drop the best and worst and average the rest.') : null,
            vs && vs.count ? h('p', { class: 'small subtle m-0' }, 'On the virtual cube: best ' + t(vs.best) +
              (vs.ao5 != null || vs.ao5Dnf ? ' · average of 5 ' + t(vs.ao5, vs.ao5Dnf) : '') + ' (' + vs.count + (vs.count === 1 ? ' solve' : ' solves') + ').') : null),
          tips.length ? h('section', { class: 'card stack stack-sm' },
            h('h2', { class: 'card__title' }, 'Three habits that make you faster'),
            h('ul', { class: 'cc-misses' }, tips.map(function (tip) {
              return h('li', null, h('p', { class: 'strong m-0' }, tip.title), h('p', { class: 'small muted m-0' }, tip.text));
            }))) : null));
      }

      // ------------------------------------------------------------ go
      showTab(state.tab);
      return function cleanup() {
        if (panelScope) panelScope.dispose();
        panelScope = null;
        keyHandler = null;
        screenScope.dispose();
      };
    }
  };

  def.Gen = Gen;                  // exposed for tests
  def._intendedMoves = intendedMoves;
  def._algInfo = algInfo;
  def._weakestPractised = weakestPractised;
  // No separate js/drills.js ships: the built-in generator IS CC.Drills, so Coach (today's plan)
  // and Stats name and pick drill types from the same list this screen runs.
  if (root.CC && !root.CC.Drills) root.CC.Drills = Gen;

  if (root.CC && root.CC.App) root.CC.App.registerScreen('drills', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
