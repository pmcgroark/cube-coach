/* Cube Coach — the "less help over time" engine (CC.Coach).
 *
 * Pure functions over the CC.Store `data` object. The record..., logPractice and gradeAlg
 * functions update `data` in place (the caller saves); everything else only reads. Every time-dependent
 * function takes an optional `now` (Date | ISO string | ms) so it can be tested. Days are always the
 * learner's LOCAL calendar days.
 *
 * Guidance levels per stage: 3 Show < 25 <= 2 Coach < 50 <= 1 Nudge < 78 <= 0 Solo (mastery),
 * with 5 points of hysteresis before a demotion. Mastery moves toward a per-attempt
 * performance score (faster up than down), and decays gently after 7 days without practice.
 * A Show-level attempt always scores at least 30, so copying the moves always leads on to Coach;
 * Show alone can never get past Coach, and only clean Nudge/Solo work reaches Solo.
 */
(function (root) {
  'use strict';

  var DAY = 86400000;
  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
  var ALG_IDS = ['rtrigger', 'mid-right', 'mid-left', 'ycross', 'sune', 'corner-cycle', 'twist'];

  var LEVELS = [{ id: 0, name: 'Solo' }, { id: 1, name: 'Nudge' }, { id: 2, name: 'Coach' }, { id: 3, name: 'Show' }];
  var LEVEL_TEXT = [
    'Stage name and timer only. Ask for a hint if you need one.',
    'Just the goal. "Hint" gives you a little more each time you press it.',
    'Goal, case and algorithm name. Moves are hidden until you ask.',
    'Every move is shown on the 3D cube. Copy it.'
  ];

  // Tunable numbers (tests/coach.test.js checks the behaviour they produce).
  var PARAMS = {
    thresholds: { 2: 25, 1: 50, 0: 78 },     // mastery needed to reach level 2 / 1 / 0
    hysteresis: 5,                            // a demotion needs mastery this far below the threshold
    basePerf: [100, 88, 68, 45],              // score for a clean attempt done at level 0 / 1 / 2 / 3
    showFloor: 30,                            // a Show attempt never scores below this (copying always leads to Coach)
    hintPenalty: 14, maxHintPenalty: 60,      // each hint or "show moves" costs this much
    quizPenalty: 20,                          // a fully wrong quiz costs this much (scaled by error rate)
    rateUp: 0.42, rateDown: 0.22,             // fraction of the gap closed per attempt
    minStep: 0.1,                             // always move at least this far toward the score (no rounding traps)
    virtualWeight: 0.8,                       // a virtual-cube attempt counts this much
    decayAfterDays: 7, decayPerDay: 0.5, maxDecay: 20,
    leitnerDays: [0, 1, 3, 7, 14],            // review interval for boxes 1..5
    planMinutes: 20,
    minSolveMs: 3000                          // faster than this is a timer slip, not a solve (world record ~3 s)
  };

  // Rough share of a beginner layer-by-layer solve each stage takes; used to find the stage
  // that is slow *for what it is* (otherwise corners/middle would always be "slowest").
  var EXPECTED_SHARE = { daisy: 0.08, cross: 0.10, corners: 0.20, middle: 0.22, ycross: 0.06, yedges: 0.10, ycorners: 0.10, yorient: 0.14 };

  // Fallback content, used only when CC.Lessons / CC.Solver are not loaded.
  var STAGE_INFO = {
    daisy: { name: 'The Daisy', goal: 'Four white edges around the yellow centre, white stickers facing up.',
      concept: 'Find an edge piece with white on it and bring it up next to the yellow centre, white facing up. Turn the top layer first so you never knock off a petal you already have.' },
    cross: { name: 'White Cross', goal: 'Four white edges on the bottom, each side colour matching its centre.',
      concept: 'Turn the top layer until a petal\'s side colour matches the centre below it. Then turn that face twice (a half turn) to send the white edge down to the bottom.' },
    corners: { name: 'White Corners', goal: 'The whole white (bottom) layer solved.',
      concept: 'Find a white corner in the top layer and turn the top until it sits right above its spot. Hold that spot at the front-right and repeat R U R\' U\' until the corner drops in with white facing down: it always takes 1, 3 or 5 goes.' },
    middle: { name: 'Middle Layer', goal: 'The first two layers solved.',
      concept: 'Find a top-layer edge with no yellow on it. Turn the top until its front colour matches the centre below it, then check whether its top colour belongs on the left or the right.' },
    ycross: { name: 'Yellow Cross', goal: 'A yellow cross on top.',
      concept: 'Look only at the yellow edge stickers on top: a dot, an L or a line. Hold the L at the back-left, or the line going left to right, then do F R U R\' U\' F\'. A dot becomes an L, an L becomes a line, a line becomes the cross.' },
    yedges: { name: 'Yellow Edges', goal: 'Each top edge matches the centre below it.',
      concept: 'Turn the top until at least two edges match their side centres. Hold a matched pair at the back and right, then do R U R\' U R U2 R\' U.' },
    ycorners: { name: 'Yellow Corners: Position', goal: 'Every top corner in its correct spot (twist does not matter yet).',
      concept: 'Find a top corner that is already in its right spot: its three colours match the three centres around it, even if it is twisted. Hold it at the front-right and do U R U\' L\' U R\' U\' L.' },
    yorient: { name: 'Yellow Corners: Twist', goal: 'The cube is solved.',
      concept: 'Hold a twisted corner at the front-right of the top. Repeat R\' D\' R D until its yellow faces up (2 or 4 goes), then turn only the top layer to bring the next one there. The bottom looks scrambled halfway through: keep going.' }
  };
  var ALG_INFO = {
    rtrigger: { name: 'Right trigger', notation: "R U R' U'", stage: 'corners' },
    'mid-right': { name: 'Middle edge to the right', notation: "U R U' R' U' F' U F", stage: 'middle' },
    'mid-left': { name: 'Middle edge to the left', notation: "U' L' U L U F U' F'", stage: 'middle' },
    ycross: { name: 'Yellow cross', notation: "F R U R' U' F'", stage: 'ycross' },
    sune: { name: 'Sune', notation: "R U R' U R U2 R'", stage: 'yedges' },
    'corner-cycle': { name: 'Corner cycle', notation: "U R U' L' U R' U' L", stage: 'ycorners' },
    twist: { name: 'Corner twist', notation: "R' D' R D", stage: 'yorient' }
  };
  var DRILL_STAGES = {          // fallback for CC.Drills.TYPES
    notation: null, perform: null, predict: null,
    recognise: ['cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'],
    reps: ['corners', 'yorient'],
    algorithm: ['corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient']
  };
  var DRILL_NAMES = {
    notation: 'Move names', perform: 'Copy the move', predict: 'What comes next?',
    recognise: 'Spot the case', reps: 'How many times?', algorithm: 'Algorithm recall'
  };
  var MILESTONE_INFO = [
    { id: 'first-solve', name: 'First solve', desc: 'You solved a whole cube for the first time.' },
    { id: 'first-virtual', name: 'Virtual solver', desc: 'You solved the on-screen cube.' },
    { id: 'first-coach', name: 'Stabilisers off', desc: 'A full solve without any stage shown move by move.' },
    { id: 'first-solo', name: 'Solo!', desc: 'A real-cube solve with every stage at Solo level and no hints.' },
    { id: 'sub-10', name: 'Under 10 minutes', desc: 'An unaided real-cube solve in under 10:00.' },
    { id: 'sub-5', name: 'Under 5 minutes', desc: 'An unaided real-cube solve in under 5:00.' },
    { id: 'sub-3', name: 'Under 3 minutes', desc: 'An unaided real-cube solve in under 3:00. Goal reached!' },
    { id: 'sub-2', name: 'Under 2 minutes', desc: 'An unaided real-cube solve in under 2:00.' },
    { id: 'sub-90', name: 'Under 90 seconds', desc: 'An unaided real-cube solve in under 1:30.' },
    { id: 'streak-7', name: 'One-week streak', desc: 'Practised 7 days in a row.' },
    { id: 'streak-30', name: '30-day streak', desc: 'Practised 30 days in a row.' },
    { id: 'all-mastered', name: 'Every stage mastered', desc: 'All eight stages reached Solo level.' },
    { id: 'solves-100', name: 'A hundred solves', desc: '100 completed solves.' }
  ];
  var SUB_LIMITS = { 'sub-10': 600000, 'sub-5': 300000, 'sub-3': 180000, 'sub-2': 120000, 'sub-90': 90000 };

  // ------------------------------------------------------------ small helpers
  function CC() { return root.CC || {}; }
  function has(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  // Keys that are safe to use as property names on plain objects (no prototype tricks).
  function safeKey(k) { return typeof k === 'string' && k !== '' && k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }
  function own(o, k) { return has(o, k) ? o[k] : undefined; }
  // A non-negative count from a number or numeric string. Infinity means "a lot"; junk means 0.
  function count(v) {
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) v = Number(v);
    if (typeof v !== 'number' || isNaN(v) || v <= 0) return 0;
    return v === Infinity ? 1e6 : v;
  }
  // Parse a date. A bare 'YYYY-MM-DD' means local midnight (not UTC, which JS would otherwise assume).
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getTime());
    if (typeof v === 'string') {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function toDate(now) { return (now != null && parseDate(now)) || new Date(); }
  function iso(now) { return toDate(now).toISOString(); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  // Local calendar day, so "today" matches the learner's clock.
  function dayKey(now) { var d = toDate(now); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(now) { var d = toDate(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function dayNumber(now) { var d = startOfDay(now); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); }
  function keyNumber(k) {   // 'YYYY-MM-DD' -> day number, or null
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null;
  }
  function fmtTime(ms) {
    if (ms == null || !isFinite(ms)) return '–';
    var s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + pad(s % 60);
  }
  function sentence(t) { t = String(t == null ? '' : t).trim(); return !t || /[.!?…]$/.test(t) ? t : t + '.'; }
  function validLevel(l) { return l === 0 || l === 1 || l === 2 || l === 3; }
  function toLevel(v) {   // 0..3 from a number or numeric string, else null
    if (typeof v === 'string' && /^\s*[0-3]\s*$/.test(v)) v = Number(v);
    return validLevel(v) ? v : null;
  }
  function isStage(id) { return STAGE_IDS.indexOf(id) !== -1; }
  function truthy(v) { return isObj(v) ? !!v.correct : !!v; }   // accepts CC.Drills.check() results too

  function stageName(id) {
    var L = CC().Lessons, S = CC().Solver;
    var ls = L && L.STAGES && own(L.STAGES, id);
    if (ls && ls.title) return ls.title;
    if (S && Array.isArray(S.STAGES)) {
      for (var i = 0; i < S.STAGES.length; i++) if (S.STAGES[i].id === id && S.STAGES[i].name) return S.STAGES[i].name;
    }
    return has(STAGE_INFO, id) ? STAGE_INFO[id].name : String(id);
  }
  function stageGoal(id) {
    var L = CC().Lessons, S = CC().Solver;
    var ls = L && L.STAGES && own(L.STAGES, id);
    if (ls && ls.goal) return ls.goal;
    if (S && Array.isArray(S.STAGES)) {
      for (var i = 0; i < S.STAGES.length; i++) if (S.STAGES[i].id === id && S.STAGES[i].goal) return S.STAGES[i].goal;
    }
    return has(STAGE_INFO, id) ? STAGE_INFO[id].goal : '';
  }
  function lessonAlg(algId) { var L = CC().Lessons; return (L && L.ALGORITHMS && own(L.ALGORITHMS, algId)) || null; }
  function algStages(algId) {
    var a = lessonAlg(algId);
    if (a && Array.isArray(a.usedIn) && a.usedIn.length) return a.usedIn;
    return has(ALG_INFO, algId) ? [ALG_INFO[algId].stage] : [];
  }
  function algName(algId) {
    var a = lessonAlg(algId);
    return (a && a.name) || (has(ALG_INFO, algId) && ALG_INFO[algId].name) || algId;
  }
  function algNotation(algId) {
    var a = lessonAlg(algId);
    return (a && a.notation) || (has(ALG_INFO, algId) && ALG_INFO[algId].notation) || '';
  }
  function allAlgIds(data) {
    var ids = ALG_IDS.slice();
    var L = CC().Lessons;
    if (L && isObj(L.ALGORITHMS)) Object.keys(L.ALGORITHMS).forEach(function (k) { if (safeKey(k) && ids.indexOf(k) === -1) ids.push(k); });
    if (data && isObj(data.algs)) Object.keys(data.algs).forEach(function (k) { if (safeKey(k) && ids.indexOf(k) === -1) ids.push(k); });
    return ids;
  }

  function newSkill() { return { mastery: 0, sessions: 0, soloClean: 0, lastLevel: 3, lastPracticed: null }; }
  function skillOf(data, stageId) {
    var s = data && isObj(data.skills) ? own(data.skills, stageId) : null;
    return isObj(s) ? s : newSkill();
  }
  function ensureSkill(data, stageId) {
    if (!isObj(data.skills)) data.skills = {};
    if (!isObj(own(data.skills, stageId))) data.skills[stageId] = newSkill();
    return data.skills[stageId];
  }
  function touchDay(data, now) {
    if (!isObj(data.practiceLog)) data.practiceLog = {};
    var k = dayKey(now);
    if (!has(data.practiceLog, k)) data.practiceLog[k] = 0;
  }
  function goalMs(data) {
    var g = data && isObj(data.settings) && num(data.settings.goalSeconds, 0);
    return (g > 0 ? g : 180) * 1000;
  }

  // ------------------------------------------------------------ levels & mastery
  function naturalLevel(m) {
    var t = PARAMS.thresholds;
    return m >= t[0] ? 0 : m >= t[1] ? 1 : m >= t[2] ? 2 : 3;
  }
  // Promote as soon as a threshold is reached; demote only once mastery is `hysteresis` below it.
  function hysteresisLevel(m, prevLevel) {
    var n = naturalLevel(m);
    if (!validLevel(prevLevel) || n <= prevLevel) return n;
    return Math.max(prevLevel, naturalLevel(m + PARAMS.hysteresis));
  }
  function effectiveMastery(skill, now) {
    var m = clamp(num(skill && skill.mastery, 0), 0, 100);
    var last = skill && skill.lastPracticed ? parseDate(skill.lastPracticed) : null;
    if (!last) return m;
    var days = (toDate(now).getTime() - last.getTime()) / DAY;
    if (days <= PARAMS.decayAfterDays) return m;
    var decay = Math.min(PARAMS.maxDecay, (days - PARAMS.decayAfterDays) * PARAMS.decayPerDay);
    return Math.max(0, round1(m - decay));
  }
  function masteryOf(data, stageId, now) { return effectiveMastery(skillOf(data, stageId), now); }
  function autoLevel(data, stageId, now) {
    var sk = skillOf(data, stageId);
    return hysteresisLevel(effectiveMastery(sk, now), sk.lastLevel);
  }
  function levelFor(data, stageId, now) {
    var o = data && isObj(data.settings) ? data.settings.guidanceOverride : null;
    if (validLevel(o)) return o;
    return autoLevel(data, stageId, now);
  }

  function performance(o) {
    o = isObj(o) ? o : {};
    var level = toLevel(o.level);
    if (level === null) level = 3;
    var hints = count(o.hints);
    var p = PARAMS.basePerf[level] - Math.min(PARAMS.maxHintPenalty, hints * PARAMS.hintPenalty);
    var qt = count(o.quizTotal), qr = Math.min(count(o.quizRight), qt);
    if (qt > 0) {
      var ratio = qr / qt;
      if (!(ratio >= 0 && ratio <= 1)) ratio = 0;
      p -= PARAMS.quizPenalty * (1 - ratio);
    }
    if (level === 3) p = Math.max(p, PARAMS.showFloor);   // everything was shown: copying it always counts
    return clamp(p, 0, 100);
  }

  // opts = { level, hints, ms, quizRight, quizTotal, device, now }
  function recordStage(data, stageId, opts, now) {
    opts = isObj(opts) ? opts : {};
    now = toDate(now != null ? now : opts.now);
    if (!isObj(data) || !isStage(stageId)) {   // unknown stage: ignore, never write odd keys into data
      return { mastery: 0, delta: 0, level: 3, prevLevel: 3, promoted: false, demoted: false, performance: 0, newMilestones: [], ignored: true };
    }
    var sk = ensureSkill(data, stageId);
    var prev = autoLevel(data, stageId, now);
    var level = toLevel(opts.level);
    if (level === null) level = levelFor(data, stageId, now);
    var hints = count(opts.hints);
    var qt = count(opts.quizTotal), qr = count(opts.quizRight);
    var clean = hints === 0 && (qt === 0 || qr >= qt);
    var perf = performance({ level: level, hints: hints, quizRight: qr, quizTotal: qt });
    var start = effectiveMastery(sk, now);           // any decay is baked in when they come back
    var gap = perf - start;
    var change = gap * (gap >= 0 ? PARAMS.rateUp : PARAMS.rateDown) * (opts.device === 'virtual' ? PARAMS.virtualWeight : 1);
    if (Math.abs(change) < PARAMS.minStep && Math.abs(gap) >= 0.05) {
      change = gap > 0 ? Math.min(gap, PARAMS.minStep) : Math.max(gap, -PARAMS.minStep);
    }
    if (clean && change < 0) change = 0;             // choosing more help is not a failure
    var before = clamp(num(sk.mastery, 0), 0, 100);
    var m = clamp(round1(start + change), 0, 100);
    sk.mastery = m;
    sk.sessions = Math.max(0, Math.floor(num(sk.sessions, 0))) + 1;
    if (level === 0 && hints === 0) sk.soloClean = Math.max(0, Math.floor(num(sk.soloClean, 0))) + 1;
    sk.lastPracticed = now.toISOString();
    var lvl = hysteresisLevel(m, prev);
    sk.lastLevel = lvl;
    touchDay(data, now);
    return {
      mastery: m, delta: round1(m - before), level: lvl,
      prevLevel: prev, promoted: lvl < prev, demoted: lvl > prev, performance: round1(perf),
      newMilestones: checkMilestones(data, now)
    };
  }

  // ------------------------------------------------------------ solves
  function hintTotal(s) {
    var t = 0;
    if (isObj(s.hints)) Object.keys(s.hints).forEach(function (k) { t += count(s.hints[k]); });
    else t = count(s.hints);
    return t;
  }
  // Recorded levels; a value that is present but not 0..3 counts as Show (most help), never as Solo.
  function levelValues(s) {
    if (!isObj(s.levels)) { var one = toLevel(s.levels); return one === null ? [] : [one]; }
    var out = [];
    Object.keys(s.levels).forEach(function (k) {
      var v = s.levels[k];
      if (v == null) return;
      var l = toLevel(v);
      out.push(l === null ? 3 : l);
    });
    return out;
  }
  function hasTime(s) { return typeof s.totalMs === 'number' && isFinite(s.totalMs) && s.totalMs >= PARAMS.minSolveMs; }
  // A whole-cube attempt (not a single-stage drill), finished or not.
  function isAttempt(s) { return isObj(s) && s.source !== 'drill' && !s.stage; }
  function isFullSolve(s) { return isAttempt(s) && s.completed !== false && hasTime(s); }
  // Did-not-finish: a real attempt (at least a few seconds long) that was given up.
  function isDnf(s) { return isAttempt(s) && s.completed === false && hasTime(s); }
  function unaidedShape(s) {
    return s.device !== 'virtual' && hintTotal(s) === 0 && levelValues(s).every(function (l) { return l === 0; });
  }
  // Unaided: a completed real-cube solve, no stage above Solo level, no hints. (A timer-only solve
  // with no levels recorded counts as unaided.)
  function isUnaided(s) { return isFullSolve(s) && unaidedShape(s); }
  function isUnaidedAttempt(s) { return (isFullSolve(s) || isDnf(s)) && unaidedShape(s); }
  function solvesOf(data) { return data && Array.isArray(data.solves) ? data.solves : []; }
  function fullSolves(data) { return solvesOf(data).filter(isFullSolve); }

  function timeOf(s) { var d = parseDate(s && s.at); return d ? d.getTime() : -8.64e15; }
  function sortByTime(list) {   // stable; undated solves count as oldest
    return list.map(function (s, i) { return { s: s, i: i, t: timeOf(s) }; })
      .sort(function (a, b) { return (a.t - b.t) || (a.i - b.i); })
      .map(function (x) { return x.s; });
  }

  function cleanMap(m, fn) {
    var out = {};
    if (!isObj(m)) return out;
    Object.keys(m).forEach(function (k) {
      if (!safeKey(k)) return;
      var v = fn(m[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  var solveSeq = 0;
  function normalizeSolve(solve, now) {
    var s = {};
    if (isObj(solve)) Object.keys(solve).forEach(function (k) { if (safeKey(k)) s[k] = solve[k]; });
    if (!s.id) s.id = 's' + toDate(now).getTime().toString(36) + (solveSeq++).toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var when = s.at != null ? parseDate(s.at) : null;
    s.at = (when || toDate(now)).toISOString();
    s.device = s.device === 'virtual' ? 'virtual' : 'physical';
    if (s.stage === undefined || s.stage === '') s.stage = null;
    if (!s.source) s.source = s.stage ? 'drill' : 'scramble';
    if (s.scramble === undefined) s.scramble = null;
    s.totalMs = typeof s.totalMs === 'number' && isFinite(s.totalMs) && s.totalMs > 0 ? Math.round(s.totalMs) : 0;
    s.splits = cleanMap(s.splits, function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : undefined; });
    // levels / hints may arrive as one number for the whole solve; keep that information.
    var lv = toLevel(s.levels);
    s.levels = isObj(s.levels) ? cleanMap(s.levels, function (v) { return v == null ? undefined : (toLevel(v) === null ? 3 : toLevel(v)); })
      : (lv !== null ? { all: lv } : {});
    var hn = count(s.hints);
    s.hints = isObj(s.hints) ? cleanMap(s.hints, function (v) { return count(v); }) : (hn ? { total: hn } : {});
    if (!isObj(s.quiz)) s.quiz = { right: 0, total: 0 };
    s.completed = s.completed !== false;
    return s;
  }

  function recordSolve(data, solve, now) {
    now = toDate(now);
    if (!isObj(data)) return { newMilestones: [], solve: null };
    var s = normalizeSolve(solve, now);
    if (!Array.isArray(data.solves)) data.solves = [];
    data.solves.push(s);
    var max = (CC().Store && CC().Store.MAX_SOLVES) || 2000;
    if (data.solves.length > max) data.solves.splice(0, data.solves.length - max);
    // A finished solve practises every stage, so no stage decays while the learner keeps solving
    // (e.g. timer-only solves in the speed phase). Any decay so far is baked in first, so the
    // result does not depend on whether the UI calls recordStage before or after this.
    if (isFullSolve(s)) {
      var t = now.getTime();
      STAGE_IDS.forEach(function (id) {
        var sk = isObj(data.skills) ? own(data.skills, id) : null;
        if (!isObj(sk) || !(num(sk.sessions, 0) > 0)) return;
        var last = sk.lastPracticed ? parseDate(sk.lastPracticed) : null;
        if (last && last.getTime() >= t) return;
        sk.mastery = effectiveMastery(sk, now);
        sk.lastPracticed = now.toISOString();
      });
    }
    touchDay(data, now);
    return { newMilestones: checkMilestones(data, now), solve: s };
  }

  // ------------------------------------------------------------ drills, practice, algorithms
  function recordDrill(data, type, correct, now) {
    now = toDate(now);
    if (!isObj(data) || !safeKey(type)) return { drill: null, accuracy: 0, newMilestones: [] };
    if (!isObj(data.drills)) data.drills = {};
    var d = own(data.drills, type);
    if (!isObj(d)) d = data.drills[type] = { right: 0, total: 0, lastAt: null };
    d.total = Math.max(0, num(d.total, 0)) + 1;
    d.right = Math.max(0, num(d.right, 0)) + (truthy(correct) ? 1 : 0);
    d.lastAt = now.toISOString();
    touchDay(data, now);
    return { drill: d, accuracy: d.right / d.total, newMilestones: checkMilestones(data, now) };
  }

  // Adds practice minutes to today. Zero, negative or junk minutes change nothing (and do not
  // mark the day as practised); one call adds at most a day's worth.
  function logPractice(data, minutes, now) {
    now = toDate(now);
    if (!isObj(data)) return { today: 0, newMilestones: [] };
    if (!isObj(data.practiceLog)) data.practiceLog = {};
    var k = dayKey(now);
    var add = Math.min(1440, count(minutes));
    var cur = Math.max(0, num(data.practiceLog[k], 0));
    if (add > 0) data.practiceLog[k] = Math.min(1440, round1(cur + add));
    return { today: has(data.practiceLog, k) ? data.practiceLog[k] : 0, newMilestones: add > 0 ? checkMilestones(data, now) : [] };
  }

  // An algorithm joins the trainer once its stage has been practised (or it has been graded).
  function algUnlocked(data, algId) {
    if (data && isObj(data.algs) && isObj(own(data.algs, algId))) return true;
    return algStages(algId).some(function (st) { return num(skillOf(data, st).sessions, 0) > 0; });
  }
  function algDue(data, now) {
    var t = toDate(now).getTime();
    var due = [];
    allAlgIds(data).forEach(function (id, order) {
      if (!algUnlocked(data, id)) return;
      var e = data && isObj(data.algs) ? own(data.algs, id) : null;
      if (!isObj(e)) { due.push({ id: id, box: 0, due: -Infinity, order: order }); return; }
      var d = parseDate(e.due);
      if (!d || d.getTime() <= t) due.push({ id: id, box: clamp(Math.round(num(e.box, 1)), 1, 5), due: d ? d.getTime() : -Infinity, order: order });
    });
    due.sort(function (a, b) { return a.box - b.box || (a.due === b.due ? 0 : a.due < b.due ? -1 : 1) || a.order - b.order; });
    return due.map(function (x) { return x.id; });
  }
  // Leitner: a DUE card answered right moves up a box; any wrong answer sends it back to box 1
  // (due again straight away). Reviewing a card early never promotes it, so cramming one card ten
  // times in an evening does not push it out to two weeks. Due at the start of the local day
  // `interval` days ahead, so a card graded in the evening is ready the next morning.
  function gradeAlg(data, algId, correct, now) {
    now = toDate(now);
    if (!isObj(data) || !safeKey(algId)) return null;
    if (!isObj(data.algs)) data.algs = {};
    var e = own(data.algs, algId);
    if (!isObj(e)) e = data.algs[algId] = { box: 1, due: now.toISOString(), right: 0, total: 0 };
    var box = clamp(Math.round(num(e.box, 1)), 1, 5);
    var dueAt = parseDate(e.due);
    var isDue = !dueAt || dueAt.getTime() <= now.getTime();
    e.total = Math.max(0, num(e.total, 0)) + 1;
    e.right = Math.max(0, num(e.right, 0));
    if (truthy(correct)) {
      e.right += 1;
      if (isDue) {
        box = Math.min(5, box + 1);
        var days = PARAMS.leitnerDays[box - 1];
        e.due = days === 0 ? now.toISOString() : addDays(startOfDay(now), days).toISOString();
      }
    } else {
      box = 1;
      e.due = now.toISOString();
    }
    e.box = box;
    touchDay(data, now);
    return e;
  }

  // ------------------------------------------------------------ stats
  // WCA-style average: drop the single best and single worst, mean of the rest. A DNF (Infinity,
  // null or NaN) counts as the worst; if a DNF survives the trimming the average is a DNF (null).
  function averageOf(times) {
    if (!Array.isArray(times) || times.length < 3) return null;
    var s = times.map(function (t) { return typeof t === 'number' && isFinite(t) && t >= 0 ? t : Infinity; })
      .sort(function (a, b) { return a === b ? 0 : a < b ? -1 : 1; });
    var mid = s.slice(1, s.length - 1), sum = 0;
    for (var i = 0; i < mid.length; i++) { if (mid[i] === Infinity) return null; sum += mid[i]; }
    return Math.round(sum / mid.length);
  }
  function averageOfLast(times, n) { return times.length >= n ? averageOf(times.slice(times.length - n)) : null; }
  function attemptTimes(list) { return list.map(function (s) { return isFullSolve(s) ? s.totalMs : Infinity; }); }

  function streakOf(data, now) {
    var log = data && isObj(data.practiceLog) ? data.practiceLog : {};
    var d = startOfDay(now);
    if (!has(log, dayKey(d))) { d = addDays(d, -1); if (!has(log, dayKey(d))) return 0; }
    var n = 0;
    while (has(log, dayKey(d)) && n < 100000) { n++; d = addDays(d, -1); }
    return n;
  }
  // Longest run of consecutive practice days ever (for the streak milestones).
  function longestStreak(data) {
    var log = data && isObj(data.practiceLog) ? data.practiceLog : {};
    var days = Object.keys(log).map(keyNumber).filter(function (n) { return n !== null; }).sort(function (a, b) { return a - b; });
    var best = 0, run = 0, prev = null;
    days.forEach(function (n) {
      run = prev !== null && n === prev + 1 ? run + 1 : 1;
      prev = n;
      if (run > best) best = run;
    });
    return best;
  }

  function stats(data, opts, now) {
    opts = isObj(opts) ? opts : {};
    now = toDate(now != null ? now : opts.now);
    var device = opts.device === 'physical' || opts.device === 'virtual' ? opts.device : null;
    var attempts = sortByTime(solvesOf(data).filter(function (s) {
      return (isFullSolve(s) || isDnf(s)) && (!device || (s.device === 'virtual' ? 'virtual' : 'physical') === device);
    }));
    var list = attempts.filter(isFullSolve);
    var times = list.map(function (s) { return s.totalMs; });
    var seq = attemptTimes(attempts);
    var sum = 0; times.forEach(function (t) { sum += t; });

    // Stage splits: the 12 most recent solves that have them, so it reflects how you solve now.
    var withSplits = list.filter(function (s) { return isObj(s.splits) && Object.keys(s.splits).length; }).slice(-12);
    var byStage = {}, totalAvg = 0;
    STAGE_IDS.forEach(function (id) {
      var v = withSplits.map(function (s) { return own(s.splits, id); }).filter(function (x) { return typeof x === 'number' && isFinite(x) && x >= 0; });
      if (!v.length) return;
      var t = 0; v.forEach(function (x) { t += x; });
      byStage[id] = { avgMs: Math.round(t / v.length), share: 0, count: v.length };
      totalAvg += byStage[id].avgMs;
    });
    var slowest = null, worst = -1;
    Object.keys(byStage).forEach(function (id) {
      byStage[id].share = totalAvg > 0 ? Math.round(byStage[id].avgMs / totalAvg * 1000) / 1000 : 0;
      var ratio = byStage[id].share / (EXPECTED_SHARE[id] || 0.125);
      if (byStage[id].avgMs > 0 && ratio > worst) { worst = ratio; slowest = id; }
    });

    var log = data && isObj(data.practiceLog) ? data.practiceLog : {};
    var today = startOfDay(now), week = 0;
    for (var i = 0; i < 7; i++) week += Math.max(0, num(own(log, dayKey(addDays(today, -i))), 0));

    var ua = attempts.filter(isUnaidedAttempt);
    var uTimes = ua.filter(isFullSolve).map(function (s) { return s.totalMs; });
    var uSeq = attemptTimes(ua);
    var ao5 = averageOfLast(seq, 5), ao12 = averageOfLast(seq, 12), uao5 = averageOfLast(uSeq, 5);
    var trend = [];
    attempts.forEach(function (s, k) {
      if (!isFullSolve(s)) return;
      trend.push({ at: s.at, ms: s.totalMs, ao5: k >= 4 ? averageOf(seq.slice(k - 4, k + 1)) : null });
    });
    return {
      count: list.length,
      attempts: attempts.length,
      dnf: attempts.length - list.length,
      best: times.length ? Math.min.apply(null, times) : null,
      last: times.length ? times[times.length - 1] : null,
      mean: times.length ? Math.round(sum / times.length) : null,     // completed solves only
      ao5: ao5, ao12: ao12,                                            // over the last 5/12 attempts; DNF average -> null
      ao5Dnf: seq.length >= 5 && ao5 === null,
      ao12Dnf: seq.length >= 12 && ao12 === null,
      trend: trend,
      byStage: byStage,
      slowestStage: slowest,
      streak: streakOf(data, now),
      todayMinutes: round1(Math.max(0, num(own(log, dayKey(now)), 0))),
      weekMinutes: round1(week),
      unaided: {
        count: uTimes.length, best: uTimes.length ? Math.min.apply(null, uTimes) : null,
        ao5: uao5, ao5Dnf: uSeq.length >= 5 && uao5 === null
      },
      goalMs: goalMs(data)
    };
  }

  // ------------------------------------------------------------ milestones
  function earnedNow(data) {
    var ids = {};
    var full = fullSolves(data);
    full.forEach(function (s) {
      ids['first-solve'] = true;
      if (s.device === 'virtual') ids['first-virtual'] = true;
      if (levelValues(s).every(function (l) { return l !== 3; })) ids['first-coach'] = true;
      if (isUnaided(s)) {
        ids['first-solo'] = true;
        Object.keys(SUB_LIMITS).forEach(function (k) { if (s.totalMs < SUB_LIMITS[k]) ids[k] = true; });
      }
    });
    if (full.length >= 100) ids['solves-100'] = true;
    var st = longestStreak(data);
    if (st >= 7) ids['streak-7'] = true;
    if (st >= 30) ids['streak-30'] = true;
    if (STAGE_IDS.every(function (id) { return num(skillOf(data, id).mastery, 0) >= PARAMS.thresholds[0]; })) ids['all-mastered'] = true;
    return ids;
  }
  // Awards anything newly earned (each id once, ever) and returns the new ids.
  function checkMilestones(data, now) {
    if (!isObj(data)) return [];
    if (!isObj(data.milestones)) data.milestones = {};
    var earned = earnedNow(data), fresh = [];
    MILESTONE_INFO.forEach(function (m) {
      if (earned[m.id] && !own(data.milestones, m.id)) { data.milestones[m.id] = iso(now); fresh.push(m.id); }
    });
    return fresh;
  }
  function milestones(data) {
    var L = CC().Lessons;
    var list = L && Array.isArray(L.MILESTONES) && L.MILESTONES.length ? L.MILESTONES : MILESTONE_INFO;
    var got = data && isObj(data.milestones) ? data.milestones : {};
    var out = list.map(function (m) { return { id: m.id, name: m.name, desc: m.desc, earnedAt: own(got, m.id) || null }; });
    MILESTONE_INFO.forEach(function (m) {   // make sure every awardable id is listed
      if (!out.some(function (o) { return o.id === m.id; })) out.push({ id: m.id, name: m.name, desc: m.desc, earnedAt: own(got, m.id) || null });
    });
    return out;
  }

  // ------------------------------------------------------------ journey
  function weakestStage(data, now, onlyBelowSolo) {
    var best = null, bm = Infinity;
    STAGE_IDS.forEach(function (id) {
      if (onlyBelowSolo && autoLevel(data, id, now) === 0) return;
      var m = masteryOf(data, id, now);
      if (m < bm) { bm = m; best = id; }
    });
    return best;
  }

  function journey(data, now) {
    now = toDate(now);
    var ms = STAGE_IDS.map(function (id) { return masteryOf(data, id, now); });
    var levels = STAGE_IDS.map(function (id) { return autoLevel(data, id, now); });
    var gms = goalMs(data), goalTxt = fmtTime(gms);
    var ua = sortByTime(solvesOf(data).filter(isUnaidedAttempt));
    var unaided = ua.filter(isFullSolve).map(function (s) { return s.totalMs; });
    var bestUnaided = unaided.length ? Math.min.apply(null, unaided) : null;
    var r;

    // A stage is "learned" once it has left Show (same hysteresis as the levels, so the phase
    // does not flicker back and forth around the threshold).
    var learnIdx = levels.indexOf(3);

    if (learnIdx !== -1) {
      var sid = STAGE_IDS[learnIdx], started = num(skillOf(data, sid).sessions, 0) > 0;
      var p = 0; ms.forEach(function (m, i) { p += levels[i] < 3 ? PARAMS.thresholds[2] : Math.min(m, PARAMS.thresholds[2]); });
      var learned = levels.filter(function (l) { return l < 3; }).length;
      r = {
        phase: 'learn', title: 'Learning the method',
        description: 'You learn the solve as 8 short stages. At first the app shows every move and you copy it. ' +
          'As you get each stage right it steps back. ' + learned + ' of 8 stages learned so far.',
        progress: p / (PARAMS.thresholds[2] * STAGE_IDS.length),
        next: (started ? 'Keep going with ' : 'Next up: ') + stageName(sid) + '. Read the short lesson, watch the demo ' +
          '(no cube needed), then try it on the virtual cube or your own cube.',
        focusStage: sid
      };
    } else if (bestUnaided != null && bestUnaided < gms) {
      var uSeq = attemptTimes(ua);
      var ao5 = averageOfLast(uSeq, 5);
      var recent = unaided.slice(-5);
      var basis = ao5 != null ? ao5 : Math.round(recent.reduce(function (a, b) { return a + b; }, 0) / recent.length);
      var slow = stats(data, {}, now).slowestStage;
      var hit = ao5 != null && ao5 < gms;
      var nextGoal = fmtTime(Math.max(60000, gms - 60000));
      r = {
        phase: 'speed', title: hit ? 'Goal reached: keep it steady' : 'Getting faster',
        description: 'You have solved a cube with no help in under ' + goalTxt + '. Now make it normal: ' +
          'get your average of 5 unaided solves under ' + goalTxt + '.',
        progress: clamp(gms / basis, 0, 1),
        next: hit
          ? 'Your average of 5 is ' + fmtTime(ao5) + '. Set a new goal in Settings (' + nextGoal + ' is a good next one).'
          : (ao5 != null ? 'Your average of 5 is ' + fmtTime(ao5) + '. '
            : uSeq.length >= 5 ? 'Two of your last 5 unaided solves were not finished, so there is no average yet. Finish every solve, even a slow one. '
              : 'Do ' + (5 - uSeq.length) + ' more unaided solves to get an average of 5. ') +
            (slow ? 'Your slowest stage for its size is ' + stageName(slow) + ': drill it.' : 'Turn on stage splits to see where the time goes.'),
        focusStage: slow
      };
    } else if (levels.some(function (l) { return l > 0; })) {
      var w = weakestStage(data, now, true), lv = autoLevel(data, w, now);
      var pr = 0;
      ms.forEach(function (m, i) {
        pr += levels[i] === 0 ? 1 : clamp((m - PARAMS.thresholds[2]) / (PARAMS.thresholds[0] - PARAMS.thresholds[2]), 0, 0.99);
      });
      var solo = levels.filter(function (l) { return l === 0; }).length;
      r = {
        phase: 'practice', title: 'Practising with a coach',
        description: 'You have been through every stage. Now the coach gives less help each time you get a stage right: ' +
          'Show, then Coach, then Nudge, then Solo. ' + solo + ' of 8 stages are at Solo.',
        progress: pr / STAGE_IDS.length,
        next: 'Work on ' + stageName(w) + ': it is at ' + LEVELS[lv].name + ' level. Do it without hints a few times to move it up.',
        focusStage: w
      };
    } else {
      r = {
        phase: 'independent', title: 'Solving on your own',
        description: 'Every stage is at Solo level. Now do whole solves on your real cube with no hints, ' +
          'and bring your time under ' + goalTxt + '.',
        progress: bestUnaided != null ? clamp(gms / bestUnaided, 0, 0.99) : 0,
        next: bestUnaided != null
          ? 'Your best unaided solve is ' + fmtTime(bestUnaided) + '. Goal: under ' + goalTxt + '.'
          : 'Do your first full solve on your real cube without any hints. Take your time.',
        focusStage: stats(data, {}, now).slowestStage || weakestStage(data, now, false)
      };
    }
    r.progress = Math.round(clamp(r.progress, 0, 1) * 1000) / 1000;
    r.phaseIndex = ['learn', 'practice', 'independent', 'speed'].indexOf(r.phase);
    r.goalMs = gms;
    return r;
  }

  // ------------------------------------------------------------ today's plan
  function drillTypesFor(stageId) {
    var D = CC().Drills, out = [];
    if (D && Array.isArray(D.TYPES) && D.TYPES.length) {
      D.TYPES.forEach(function (t) { if (t && t.id && (!t.stageIds || t.stageIds.indexOf(stageId) !== -1)) out.push(t.id); });
    } else {
      Object.keys(DRILL_STAGES).forEach(function (t) { if (!DRILL_STAGES[t] || DRILL_STAGES[t].indexOf(stageId) !== -1) out.push(t); });
    }
    return out;
  }
  function drillName(type) {
    var D = CC().Drills;
    if (D && Array.isArray(D.TYPES)) for (var i = 0; i < D.TYPES.length; i++) if (D.TYPES[i] && D.TYPES[i].id === type && D.TYPES[i].name) return D.TYPES[i].name;
    return DRILL_NAMES[type] || type;
  }
  // Pick a drill for a stage: a weak drill type first (< 70% over 5+ tries), otherwise rotate by day.
  function pickDrill(data, stageId, now, avoid) {
    var types = drillTypesFor(stageId).filter(function (t) { return t !== 'notation'; });
    if (!types.length) types = ['predict'];
    if (avoid && types.length > 1) types = types.filter(function (t) { return t !== avoid; });
    var drills = data && isObj(data.drills) ? data.drills : {};
    var weak = types.filter(function (t) { var d = own(drills, t); return isObj(d) && num(d.total, 0) >= 5 && num(d.right, 0) / d.total < 0.7; });
    if (weak.length) return weak[0];
    return types[((dayNumber(now) % types.length) + types.length) % types.length];
  }
  // A short tip for a stage's watch item (memory aid, common mistake or speed tip), rotating by day.
  // learning = true leaves out speed tips (e.g. "skip the daisy") while the stage is still being learned.
  function stageTip(stageId, now, learning) {
    var L = CC().Lessons, ls = L && L.STAGES && own(L.STAGES, stageId), pool = [];
    function add(list, title) {
      if (Array.isArray(list)) list.forEach(function (t) { if (typeof t === 'string' && t.trim()) pool.push({ title: title, text: t }); });
    }
    if (ls) { add(ls.mnemonics, 'Memory aid'); add(ls.mistakes, 'Watch out for'); if (!learning) add(ls.speedTips, 'Speed tip'); }
    if (!pool.length && has(STAGE_INFO, stageId)) pool.push({ title: 'Key idea', text: STAGE_INFO[stageId].concept });
    return pool.length ? pool[((dayNumber(now) % pool.length) + pool.length) % pool.length] : null;
  }

  function item(minutes, kind, target, title, why, extra) {
    var it = { minutes: minutes, kind: kind, target: target, title: title, why: why,
      needsCube: kind === 'solve' || kind === 'timed', stageId: null };
    if (extra) Object.keys(extra).forEach(function (k) { it[k] = extra[k]; });
    return it;
  }
  // A no-cube alternative for every real-cube item.
  function withAlt(it, data, now, phase) {
    if (!it.needsCube) return it;
    if (phase === 'learn' && it.kind === 'solve' && it.stageId) {
      // The plan already has a virtual try of this stage just before; a drill adds variety.
      var dt = pickDrill(data, it.stageId, now);
      it.alt = {
        minutes: it.minutes, kind: 'drill', target: dt, drillType: dt, stageId: it.stageId, needsCube: false,
        title: 'Drill: ' + drillName(dt) + ' (' + stageName(it.stageId) + ')',
        why: 'No cube with you? Quick questions about this stage keep it fresh, and the demo is there to replay. No cube needed.'
      };
      return it;
    }
    it.alt = {
      minutes: it.minutes, kind: 'virtual', target: it.target, stageId: it.stageId, needsCube: false,
      timed: it.kind === 'timed',
      title: it.kind === 'timed' ? 'Timed solves on the virtual cube' : (it.target ? stageName(it.target) + ' on the virtual cube' : 'Coached solve on the virtual cube'),
      why: 'No cube with you? The virtual cube works the same way, and the app can check every move.'
    };
    return it;
  }

  function algsItem(data, due, minutes) {
    var names = due.slice(0, 3).map(algName).join(', ') + (due.length > 3 ? ' and ' + (due.length - 3) + ' more' : '');
    return item(minutes, 'algs', due[0], 'Algorithm flashcards: ' + names,
      'These are due for review today. Short, spaced reviews are how algorithms move into your fingers. No cube needed.',
      { algIds: due.slice() });
  }

  // opts = { cube:false } swaps every real-cube item for its no-cube alternative.
  function todayPlan(data, now, opts) {
    now = toDate(now);
    opts = isObj(opts) ? opts : {};
    var j = journey(data, now);
    var due = algDue(data, now);
    var st = stats(data, {}, now);
    var plan = [];
    var slow = st.slowestStage;
    var drills = data && isObj(data.drills) ? data.drills : {};
    var tipOfDay = dayNumber(now);

    if (j.phase === 'learn') {
      var s = j.focusStage, sk = skillOf(data, s), started = num(sk.sessions, 0) > 0;
      var nd = own(drills, 'notation');
      var notationDone = isObj(nd) && num(nd.total, 0) >= 10 && num(nd.right, 0) / nd.total >= 0.8;
      if (!notationDone) {
        plan.push(item(3, 'drill', 'notation', 'Warm-up: ' + drillName('notation'),
          'Every hint uses letters like R and U\'. Learning them now makes everything else easier. No cube needed.', { drillType: 'notation' }));
      } else if (due.length) {
        plan.push(algsItem(data, due, 3));
      } else if (STAGE_IDS.indexOf(s) > 0) {
        var prev = STAGE_IDS[STAGE_IDS.indexOf(s) - 1];
        var dt = pickDrill(data, prev, now);
        plan.push(item(3, 'drill', dt, 'Warm-up: ' + drillName(dt) + ' (' + stageName(prev) + ')',
          'A quick look back at the last stage you learned keeps it fresh. No cube needed.', { drillType: dt, stageId: prev }));
      } else {
        var d0 = pickDrill(data, s, now);
        plan.push(item(3, 'drill', d0, 'Warm-up: ' + drillName(d0),
          'A quick warm-up for your eyes and fingers before the first stage. No cube needed.', { drillType: d0 }));
      }
      plan.push(item(started ? 2 : 4, 'lesson', s, (started ? 'Recap: ' : 'Lesson: ') + stageName(s),
        started ? 'A one-minute reminder of the goal and the key move before you practise.'
          : 'Short and plain: what this stage is for, what to look for, and the moves.', { stageId: s }));
      plan.push(item(4, 'watch', s, 'Watch: ' + stageName(s) + ' demo',
        'See it done on the 3D cube with a running commentary. Pause and replay as often as you like. No cube needed.', { stageId: s, tip: stageTip(s, now, true) }));
      plan.push(item(4, 'virtual', s, 'Try it: ' + stageName(s) + ' on the virtual cube',
        'The app always knows the virtual cube, so it can coach every single move.', { stageId: s }));
      plan.push(item(started ? 7 : 5, 'solve', s, 'Do it: ' + stageName(s) + ' on your cube',
        'Doing it with your own hands is what makes it stick. The coach shows you as much as you need.', { stageId: s }));
    } else if (j.phase === 'practice') {
      var w = j.focusStage;
      // Stalled: many attempts and still at Coach or Show. Go back over the lesson (the cases and
      // the common mistakes) instead of only repeating the same practice.
      var stalled = num(skillOf(data, w).sessions, 0) >= 10 && autoLevel(data, w, now) >= 2;
      if (due.length) plan.push(algsItem(data, due, stalled ? 2 : due.length > 3 ? 4 : 3));
      if (stalled) {
        plan.push(item(due.length ? 2 : 3, 'lesson', w, 'Recap: ' + stageName(w) + ', what to look for',
          'You have practised this stage a lot and it is still hard. A fresh look at the cases and the common mistakes often unlocks it. No cube needed.',
          { stageId: w, stalled: true }));
      }
      var dw = pickDrill(data, w, now);
      plan.push(item(3, 'watch', w, 'Watch: ' + stageName(w) + ' demo and tips',
        'This is the stage that needs the most help right now. Watching it again helps you spot the cases faster. No cube needed.', { stageId: w, tip: stageTip(w, now, true) }));
      plan.push(item(4, 'drill', dw, 'Drill: ' + drillName(dw) + ' (' + stageName(w) + ')',
        'Quick questions that train your eye for this stage. No cube needed.', { drillType: dw, stageId: w }));
      plan.push(item(4, 'virtual', w, 'Stage practice: ' + stageName(w) + ' on the virtual cube',
        'A fresh case each time, set up just before this stage. Fewer hints = faster progress to Solo.', { stageId: w }));
      if (!due.length && !stalled) {
        var d2 = slow && slow !== w ? slow : null;
        var dt2 = pickDrill(data, d2 || w, addDays(startOfDay(now), 1), d2 ? null : dw); // not the same drill twice
        plan.push(item(3, 'drill', dt2, 'Drill: ' + drillName(dt2) + ' (' + stageName(d2 || w) + ')',
          d2 ? 'This stage takes you longest for its size, so a little extra recognition practice pays off. No cube needed.'
            : 'A second drill to lock in what you have just practised. No cube needed.', { drillType: dt2, stageId: d2 || w }));
      }
      plan.push(item(6, 'solve', null, 'Coached full solve on your cube',
        'A whole solve from a scramble. Each stage gets only the help it needs now, and less as you improve.'));
    } else if (j.phase === 'independent') {
      var f = j.focusStage || weakestStage(data, now, false);
      if (due.length) plan.push(algsItem(data, due, 2));
      else {
        plan.push(item(2, 'drill', 'predict', 'Warm-up: ' + drillName('predict'),
          'Practise seeing the next step before you turn. That is where most solving time goes. No cube needed.', { drillType: 'predict' }));
      }
      plan.push(item(3, 'watch', f, 'Watch: ' + stageName(f) + ' done smoothly',
        slow ? 'This is your slowest stage for its size. Watch how few moves it really needs. No cube needed.'
          : 'Watch a clean run of this stage and copy its rhythm. No cube needed.', { stageId: f, tip: stageTip(f, now) }));
      var df = pickDrill(data, f, now);
      plan.push(item(3, 'drill', df, 'Drill: ' + drillName(df) + ' (' + stageName(f) + ')',
        'Faster recognition means less staring and more turning. No cube needed.', { drillType: df, stageId: f }));
      plan.push(item(4, 'virtual', null, 'Full solve on the virtual cube, no hints',
        'A complete solve on your own. If you get stuck, the hint is there, but try first.'));
      plan.push(item(8, 'timed', null, 'Unaided solves on your real cube',
        'No hints, just the timer. Your goal: one under ' + fmtTime(goalMs(data)) + '.'));
    } else {
      var sl = j.focusStage || slow || weakestStage(data, now, false);
      if (due.length) plan.push(algsItem(data, due, 2));
      else {
        var da = drillTypesFor(sl).indexOf('algorithm') !== -1 ? 'algorithm' : pickDrill(data, sl, now);
        plan.push(item(2, 'drill', da, 'Warm-up: ' + drillName(da) + ' (' + stageName(sl) + ')',
          'Keep the algorithms sharp so your hands never wait for your head. No cube needed.', { drillType: da, stageId: sl }));
      }
      var L = CC().Lessons, tips = L && Array.isArray(L.SPEED_TIPS) ? L.SPEED_TIPS : [];
      var tip = tips.length ? tips[((tipOfDay % tips.length) + tips.length) % tips.length] : null;
      plan.push(item(3, 'watch', 'speed-tips', 'Speed tip' + (tip && tip.title ? ': ' + tip.title : 's'),
        'Small habits (look ahead, fewer cube rotations, smooth turning) cut whole seconds. No cube needed.', { stageId: null, tip: tip }));
      plan.push(item(4, 'virtual', sl, 'Stage sprint: ' + stageName(sl) + ' on the virtual cube',
        'This stage costs you the most time for its size. Short, repeated runs make it automatic.', { stageId: sl }));
      plan.push(item(11, 'timed', null, 'Average of 5 on your real cube',
        'Five unaided solves in a row. Aim for a steady average under ' + fmtTime(goalMs(data)) + ', not one lucky solve.'));
    }

    // Stuck on the middle layer (tried it, still under Nudge): a short Middle Layer Gym block, early in the plan.
    var G = CC().Gym;
    if (G && num(skillOf(data, 'middle').sessions, 0) > 0 && masteryOf(data, 'middle', now) < PARAMS.thresholds[1]) {
      var sug = null;
      try { sug = typeof G.suggest === 'function' ? G.suggest(data || {}, { hasCube: opts.cube !== false }) : null; } catch (e) { sug = null; }
      var gd = sug && sug.drillId && typeof G.drill === 'function' ? G.drill(sug.drillId) : null;
      plan.splice(Math.min(1, plan.length), 0, item(5, 'gym', 'middle', 'Middle Layer Gym' + (gd && gd.name ? ': ' + gd.name : ''),
        'Short exercises for the middle layer: seeing the case, remembering the moves, stuck edges, keeping your place. Most need no cube.',
        { stageId: 'middle', drillId: gd ? gd.id : null }));
      // Make room: take the 5 minutes from the longest other items (never below 2 minutes each).
      for (var take = 5; take > 0; take--) {
        var big = null;
        plan.forEach(function (it) { if (it.kind !== 'gym' && it.minutes > 2 && (!big || it.minutes > big.minutes)) big = it; });
        if (!big) break;
        big.minutes--;
      }
    }

    // Make the plan add up to exactly the target length by adjusting the main hands-on item.
    var total = 0; plan.forEach(function (it) { total += it.minutes; });
    var diff = PARAMS.planMinutes - total;
    if (diff !== 0) {
      var main = plan[plan.length - 1];
      main.minutes = Math.max(1, main.minutes + diff);
    }
    plan.forEach(function (it) { withAlt(it, data, now, j.phase); });
    if (opts.cube === false) {
      plan = plan.map(function (it) {
        if (!it.alt) return it;
        var a = it.alt; a.minutes = it.minutes; return a;
      });
    }
    return plan;
  }

  // ------------------------------------------------------------ hints
  function isRot(t) { return /^[xyz]/.test(t); }
  function isSetupMove(t) { return isRot(t) || /^U['2]?$/.test(t); }
  // How to hold / line up the cube before the main moves: the labelled set-up segments at the
  // start of the step (top-layer alignment and whole-cube turns), then any cube turn not covered.
  function holdText(step) {
    var Cube = CC().Cube;
    var segs = Array.isArray(step.segments) ? step.segments : [];
    var moves = Array.isArray(step.moves) ? step.moves : [];
    var setup = [], used = 0;
    for (var i = 0; i < segs.length - 1; i++) {
      var mv = segs[i] && Array.isArray(segs[i].moves) ? segs[i].moves : [];
      if (!mv.length || !segs[i].label || !mv.every(isSetupMove)) break;
      setup.push(sentence(segs[i].label));
      used += mv.length;
    }
    var rest = moves.slice(used), rots = rest.filter(isRot);
    if (rots.length) {
      var hows;
      try { hows = Cube && Cube.moveInfo ? rots.map(function (t) { return Cube.moveInfo(t).how; }).join(', then ') : rots.join(' '); }
      catch (e) { hows = rots.join(' '); }
      var firstFace = -1;
      for (var k = 0; k < rest.length; k++) if (!isRot(rest[k])) { firstFace = k; break; }
      var leadingOnly = rest.every(function (t, k2) { return !isRot(t) || firstFace === -1 || k2 < firstFace; });
      setup.push(leadingOnly
        ? (setup.length ? 'Then hold the cube differently: ' : 'First, hold the cube differently: ') + hows + '.'
        : 'Part-way through you turn the whole cube (' + hows + '): the exact moves show where.');
    }
    return setup.length ? setup.join(' ') : 'Keep yellow on top and hold the cube just as it is.';
  }

  function hintLadder(step) {
    if (!isObj(step)) return [];
    var stage = step.stage;
    if (!isStage(stage) && typeof step.id === 'string' && isStage(step.id.split('-')[0])) stage = step.id.split('-')[0];
    var L = CC().Lessons, Cube = CC().Cube;
    var ls = L && L.STAGES && own(L.STAGES, stage);
    var lh = ls && Array.isArray(ls.hints) ? ls.hints : [];
    var info = has(STAGE_INFO, stage) ? STAGE_INFO[stage] : {};

    var h1 = lh[0] || info.concept || sentence('Goal: ' + (stageGoal(stage) || 'finish this stage'));

    // Level 2: the case, how to hold / line it up, then the algorithm (or the step and the lesson's hint).
    var parts = [];
    if (step.case && step.case.name) parts.push('This is the case: ' + sentence(step.case.name));
    if (step.alg) {
      var reps = Math.round(num(Number(step.alg.reps), 1));
      var notation = step.alg.notation || algNotation(step.alg.id);
      parts.push(holdText(step));
      parts.push('Use the ' + (step.alg.name || algName(step.alg.id)) + (notation ? ': ' + notation : '') +
        (reps > 1 ? ', ' + reps + ' times' : '') + '.');
    } else {
      if (!parts.length && step.title) parts.push(sentence(step.title));
      if (!step.case && lh[1]) parts.push(sentence(lh[1]));
      parts.push(holdText(step));
    }
    var h2 = parts.join(' ');

    var moves = Array.isArray(step.moves) ? step.moves.slice() : [];
    var h3 = 'Exact moves: ' + (moves.length ? moves.join(' ') : '(none)') + '.' + (step.explain ? ' ' + step.explain : '');
    var third = { level: 3, text: h3, moves: moves };
    if (Cube && Cube.moveInfo) {
      try { third.plain = moves.map(function (t) { return Cube.moveInfo(t).text; }); } catch (e) { /* unknown token */ }
    }
    return [{ level: 1, text: h1 }, { level: 2, text: h2 }, third];
  }

  var Coach = {
    LEVELS: LEVELS, LEVEL_TEXT: LEVEL_TEXT, PARAMS: PARAMS, STAGE_IDS: STAGE_IDS, ALG_IDS: ALG_IDS,
    levelFor: levelFor, autoLevel: autoLevel, masteryOf: masteryOf,
    recordStage: recordStage, recordSolve: recordSolve, recordDrill: recordDrill, logPractice: logPractice,
    stats: stats, journey: journey, todayPlan: todayPlan, milestones: milestones, checkMilestones: checkMilestones,
    algDue: algDue, gradeAlg: gradeAlg, hintLadder: hintLadder,
    // exposed for tests and the UI
    naturalLevel: naturalLevel, hysteresisLevel: hysteresisLevel, effectiveMastery: effectiveMastery,
    performance: performance, averageOf: averageOf, streak: streakOf, longestStreak: longestStreak, dayKey: dayKey,
    isUnaided: isUnaided, isFullSolve: isFullSolve, isDnf: isDnf, fmtTime: fmtTime
  };

  root.CC = root.CC || {};
  root.CC.Coach = Coach;
  if (typeof module !== 'undefined' && module.exports) module.exports = Coach;
})(typeof window !== 'undefined' ? window : globalThis);
