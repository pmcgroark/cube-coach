/* Cube Coach — the coached solve (screen id 'solve').
 *
 * LEFT  the cube as the learner holds it (View3D), the current move in big type (notation + plain
 *       English), the step's move chips and transport controls — or, on the virtual cube, the move
 *       pad, keyboard legend, Undo and Reset.
 * RIGHT the coach panel: stage track + timers, the stage card (guidance level and WHY), the step card
 *       (depends on the level), quizzes, the hint ladder and stage controls.
 *
 * params (ARCHITECTURE.md "Screen routes & params"):
 *   { device:'physical'|'virtual', source:'scan'|'scramble'|'drill', state?:[54], scramble?, stage?, seed?, timed? }
 *   A `stage` with source 'scramble' is treated as a drill of that stage.
 *
 * Guidance per stage (CC.Coach.levelFor, which honours settings.guidanceOverride; timed mode = 0):
 *   3 Show   every move: arrow on the 3D cube + plain English; "anticipate" quiz first (optional)
 *   2 Coach  step title, case and algorithm name; moves behind "Show moves" (counts as a hint)
 *   1 Nudge  stage goal + reminder; Hint escalates through CC.Coach.hintLadder
 *   0 Solo   stage name + timer; hints on request
 * Real cube: at Show/Coach the app assumes the learner copies the shown moves. At Nudge/Solo it no
 * longer knows the state, so hints past level 1 ask about a rescan (CC.ScanUI.open) and a guided stage
 * after a self-solved one starts with a quick rescan. Virtual cube: the state is always known; the
 * learner's moves are matched against the current step (partial turns allowed) and the plan is
 * re-made with CC.Solver.solve when they go another way.
 *
 * Classic script; nothing touches the DOM at load time.
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'cc-style-solve';
  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
  var LEVEL_NAMES = ['Solo', 'Nudge', 'Coach', 'Show'];
  var LEVEL_BADGE = ['badge-success', 'badge-warn', 'badge-accent', 'badge-info'];
  var LEVEL_LINE = [
    'Stage name and timer only. Ask for a hint if you need one.',
    'Just the goal. Each press of Hint tells you a little more.',
    'I name the case and the algorithm; you make the moves.',
    'Every move is shown on the 3D cube. Copy it.'
  ];
  var NEXT_TIME = [
    'next time it’s just you and the timer.',
    'next time I’ll just give you the goal.',
    'next time I’ll name the case and the algorithm, and you make the moves.',
    'next time I’ll show you every move again.'
  ];
  var HINT_LABEL = ['', 'Hint 1 · the idea', 'Hint 2 · case and algorithm', 'Hint 3 · exact moves'];
  // Rough share of a beginner solve each stage takes (same numbers as CC.Coach), to find the stage
  // that was slow *for what it is*.
  var EXPECTED_SHARE = { daisy: 0.08, cross: 0.10, corners: 0.20, middle: 0.22, ycross: 0.06, yedges: 0.10, ycorners: 0.10, yorient: 0.14 };
  var SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3];
  var INSPECTION_MS = 15000;
  var IDLE_MS = 1400;
  var SUFFIX = ['', '', '2', "'"];

  // ================================================================ pure helpers
  function CCx() { return root.CC || {}; }
  function nowMs() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function parseBool(v) { return v === true || v === 1 || v === 'true' || v === '1' || v === 'yes'; }
  function isLevel(v) { return v === 0 || v === 1 || v === 2 || v === 3; }
  function stageIndex(id) { return STAGE_IDS.indexOf(id); }
  function timesText(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'; }

  function sameState(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Route params -> a tidy session description. Cube is optional (only used to read a state string).
  function normalizeParams(p, Cube) {
    p = p || {};
    var device = p.device === 'virtual' ? 'virtual' : 'physical';
    var stage = STAGE_IDS.indexOf(p.stage) !== -1 ? p.stage : null;
    var state = null;
    if (Array.isArray(p.state) && p.state.length === 54) state = p.state.slice();
    else if (typeof p.state === 'string' && p.state.length === 54) {
      try { state = Cube && Cube.fromString ? Cube.fromString(p.state) : p.state.toUpperCase().split(''); } catch (e) { state = null; }
    }
    var source = p.source === 'scan' || p.source === 'drill' || p.source === 'scramble' ? p.source : (state ? 'scan' : 'scramble');
    if (stage && source === 'scramble') source = 'drill';
    if (source === 'drill' && !stage) source = 'scramble';
    var scramble = null;
    if (p.scramble && source === 'scramble') {
      try { scramble = Cube && Cube.parseAlg ? Cube.parseAlg(p.scramble) : String(p.scramble).trim().split(/\s+/); } catch (e) { scramble = null; }
      if (scramble && !scramble.length) scramble = null;
    }
    var seed = p.seed != null && p.seed !== '' && isFinite(Number(p.seed)) ? Number(p.seed) >>> 0 : null;
    return {
      device: device, virtual: device === 'virtual', source: source, stage: source === 'drill' ? stage : null,
      state: state, scramble: scramble, seed: seed, timed: parseBool(p.timed)
    };
  }

  // A stopwatch that can be paused (clock is injectable for tests).
  function createClock(clockNow) {
    var acc = 0, since = null;
    clockNow = clockNow || nowMs;
    return {
      start: function () { if (since === null) since = clockNow(); },
      stop: function () { if (since !== null) { acc += clockNow() - since; since = null; } },
      reset: function () { acc = 0; since = null; },
      running: function () { return since !== null; },
      ms: function () { return acc + (since !== null ? clockNow() - since : 0); }
    };
  }

  // States along a step: trail[k] = the cube after the first k moves.
  function trailOf(Cube, step) {
    var t = [step.startState.slice()];
    for (var i = 0; i < step.moves.length; i++) t.push(Cube.applyMove(t[i], step.moves[i]));
    return t;
  }

  function firstActiveStage(plan, from) {
    for (var i = from || 0; i < 8; i++) {
      var s = plan && plan.stages && plan.stages[i];
      if (s && s.steps && s.steps.length) return i;
    }
    return 8;
  }

  // Did the learner turn the right layer by the wrong amount (U for U2, U' for U…)?
  // -> { done, remaining } (remaining is what still has to be turned), or null.
  function partialOf(Cube, base, expect, state) {
    if (!Cube || !base || !expect || !state) return null;
    var b, want;
    try { b = Cube.baseOf(expect); want = Cube.amountOf(expect); } catch (e) { return null; }
    for (var a = 1; a <= 3; a++) {
      if (a === want) continue;
      var tok = b + SUFFIX[a];
      var after;
      try { after = Cube.applyMove(base, tok); } catch (e) { return null; }
      if (sameState(after, state)) return { done: tok, remaining: b + SUFFIX[(want - a + 4) % 4] };
    }
    return null;
  }

  function slowestOf(splits) {
    var best = null, worst = -1;
    Object.keys(splits || {}).forEach(function (id) {
      var ms = splits[id];
      if (!(ms > 0)) return;
      var r = ms / (EXPECTED_SHARE[id] || 0.125);
      if (r > worst) { worst = r; best = id; }
    });
    return best;
  }

  function stageNameStatic(id) {
    var S = CCx().Solver, L = CCx().Lessons;
    var s = S && S.STAGES ? S.STAGES[stageIndex(id)] : null;
    return (s && s.name) || (L && L.STAGES && L.STAGES[id] && L.STAGES[id].title) || id;
  }

  // ================================================================ styles
  var CSS = [
    '.cc-solve__stage { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-solve__stage > :empty { display: none; }',
    '.cc-solve__vp { min-height: 300px; max-height: min(58vh, 620px, max(300px, calc(100vh - 440px))); }',
    '.cc-solve--virtual .solve-layout__stage { position: static; }',
    '.cc-solve--timed.cc-solve--physical .cc-solve__vp { min-height: 220px; aspect-ratio: 4 / 3; max-height: 42vh; }',
    '.cc-solve__head .btn { white-space: nowrap; }',
    '.cc-solve__status { position: absolute; left: 50%; top: var(--space-3); transform: translateX(-50%); display: inline-flex; align-items: center; gap: 8px;',
    '  padding: 4px 12px; border-radius: var(--radius-pill); background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-1);',
    '  font-size: var(--text-sm); font-weight: 600; color: var(--text-2); white-space: nowrap; pointer-events: none; }',
    '.cc-solve__status .spinner { width: 14px; height: 14px; border-width: 2px; }',
    '.cc-solve-move { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-solve-move__ctx { margin: 0; font-size: var(--text-sm); color: var(--text-2); font-weight: 600; }',
    '.cc-solve-move__now { display: flex; align-items: center; gap: var(--space-4); min-width: 0; }',
    '.cc-solve-move__chip { flex: none; display: inline-grid; place-items: center; min-width: 3.4rem; height: 3.4rem; padding: 0 0.6rem;',
    '  border-radius: 14px; background: var(--accent); color: var(--on-accent); font-family: var(--font-mono); font-size: 1.9rem; font-weight: 800;',
    '  letter-spacing: 0.01em; box-shadow: 0 0 0 4px var(--accent-soft-2); }',
    '.cc-solve-move__chip.is-rotation { background: var(--accent-soft); color: var(--accent-text); border: 2px dashed var(--accent); font-style: italic; box-shadow: none; }',
    '.cc-solve-move__chip.is-undo { background: var(--warn-soft); color: var(--warn-text); border: 2px solid var(--warn-border); box-shadow: none; }',
    '.cc-solve-move__text { font-size: 1.15rem; font-weight: 650; line-height: 1.35; min-width: 0; }',
    '.cc-solve-move__done { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--success-text); font-weight: 650; }',
    '.cc-solve-move__done .icon { flex: none; }',
    '.cc-solve-transport { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }',
    '.cc-solve-transport .kbd { margin-left: 2px; font-size: 0.72em; opacity: 0.85; }',
    '.cc-solve .btn-primary .kbd { background: transparent; color: inherit; border-color: currentColor; opacity: 0.75; }',
    '.cc-solve-speed { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: var(--text-sm); color: var(--text-2); font-weight: 600; }',
    '.cc-solve-speed .select { min-height: 34px; padding: 4px 32px 4px 10px; font-size: var(--text-sm); }',
    '.cc-solve-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }',
    '.cc-solve-times .stat__value { font-size: var(--text-xl); }',
    '.cc-solve-level { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }',
    '.cc-solve-why { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-solve-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px var(--space-3); margin: 0; font-size: var(--text-sm); }',
    '.cc-solve-facts dt { color: var(--text-3); font-weight: 700; }',
    '.cc-solve-facts dd { margin: 0; font-weight: 600; }',
    '.cc-solve-segs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-solve-segs > li + li { margin-top: 0; }',
    '.cc-solve-seg { display: flex; flex-direction: column; gap: 6px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); }',
    '.cc-solve-seg.is-current { border-color: var(--accent); background: var(--accent-soft); }',
    '.cc-solve-seg.is-done { opacity: 0.6; }',
    '.cc-solve-seg__label { font-size: var(--text-sm); font-weight: 600; }',
    '.cc-solve-hints { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-solve-hints > li + li { margin-top: 0; }',
    '.cc-solve-hint { padding: var(--space-3); border-radius: var(--radius); border: 1px solid var(--accent-soft-2); background: var(--accent-soft); }',
    '.cc-solve-hint__lvl { display: block; font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-text); margin-bottom: 2px; }',
    '.cc-solve-hint p { margin: 0; }',
    '.cc-solve-hint .alg-chips { margin-top: var(--space-2); }',
    '.cc-solve-plain { margin: var(--space-2) 0 0; padding-left: 1.4em; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-solve-plain li + li { margin-top: 2px; }',
    '.cc-solve-plain code { font-weight: 700; }',
    '.cc-solve-timercard { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-6) var(--space-4); }',
    '.cc-solve-timercard .timer { font-size: clamp(3.25rem, 12vw, 6.5rem); }',
    '.cc-solve-timercard--panel { padding: var(--space-5) var(--space-3); }',
    '.cc-solve-timercard--panel .timer { font-size: clamp(2.75rem, 9vw, 4.5rem); }',
    '.cc-solve-timercard .timer__label { margin: 0; }',
    '.cc-solve-splitlist { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm); }',
    '.cc-solve-splitlist > li + li { margin-top: 0; }',
    '.cc-solve-pop { animation: cc-solve-pop 0.75s var(--ease); }',
    '@keyframes cc-solve-pop { 0% { box-shadow: 0 0 0 0 var(--accent-soft-2); transform: scale(0.985); } 45% { box-shadow: 0 0 0 10px var(--accent-soft-2); transform: scale(1.01); } 100% { box-shadow: var(--shadow-1); transform: none; } }',
    '.cc-solve-padwrap .cc-pad { max-width: none; }',
    '.cc-solve-padwrap.is-locked .cc-pad { opacity: 0.45; pointer-events: none; }',
    '.cc-solve-legend summary { cursor: pointer; font-weight: 600; font-size: var(--text-sm); color: var(--text-2); border-radius: var(--radius-xs); }',
    '.cc-solve-keys { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: var(--space-2) 0 0; padding: 0; list-style: none; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-solve-keys > li + li { margin-top: 0; }',
    '.cc-solve-keys li { display: inline-flex; align-items: center; gap: 4px; }',
    '.cc-solve-preview { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }',
    '.cc-solve-preview > li + li { margin-top: 0; }',
    '.cc-solve-preview li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }',
    '.cc-solve-summary { max-width: 780px; margin-inline: auto; }',
    '.cc-solve-summary h1:focus { outline: none; }',
    '.cc-solve-trophy { flex: none; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 18px; background: var(--success-soft); color: var(--success-text);',
    '  animation: cc-solve-trophy 0.8s var(--ease); }',
    '.cc-solve-trophy.is-muted { background: var(--surface-2); color: var(--text-3); }',
    '@keyframes cc-solve-trophy { 0% { transform: scale(0.6) rotate(-12deg); opacity: 0; } 60% { transform: scale(1.12) rotate(4deg); opacity: 1; } 100% { transform: none; } }',
    '.cc-solve-total { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-3); }',
    '.cc-solve-total .timer { text-align: left; }',
    '.cc-solve-splits { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }',
    '.cc-solve-splits th, .cc-solve-splits td { padding: 8px 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }',
    '.cc-solve-splits thead th { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }',
    '.cc-solve-splits tbody th { font-weight: 600; text-transform: none; letter-spacing: normal; color: var(--text); font-size: inherit; }',
    '.cc-solve-splits .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }',
    '.cc-solve-bar { height: 6px; border-radius: var(--radius-pill); background: var(--surface-3); overflow: hidden; min-width: 40px; }',
    '.cc-solve-bar > span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }',
    '.cc-solve-col-bar { width: 26%; }',
    '@media (max-width: 520px) {',
    '  .cc-solve-move__chip { font-size: 1.5rem; min-width: 2.8rem; height: 2.8rem; }',
    '  .cc-solve-move__text { font-size: 1.02rem; }',
    '  .cc-solve-speed { margin-left: 0; }',
    '  .cc-solve-col-bar { display: none; }',
    '  .cc-solve__head .btn-label { display: none; }',
    '}',
    '@media (hover: none) { .cc-solve .kbd { display: none; } }'
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // A view with the View3D API but no drawing (used when render3d.js is missing).
  function nullView(Cube) {
    var state = Cube.solved();
    var api = { fallback: true, onUserMove: null };
    function apply(tokens, onMove) {
      Cube.parseAlg(tokens).forEach(function (t, i) { state = Cube.applyMove(state, t); if (onMove) onMove(i, t); });
    }
    api.setState = function (s) { state = s.slice(); };
    api.getState = function () { return state.slice(); };
    api.finalState = api.getState;
    api.play = function (tokens, o) { apply(tokens, o && o.onMove); return Promise.resolve(state.slice()); };
    api.userMove = function (t) { apply([t]); if (typeof api.onUserMove === 'function') api.onUserMove(t); return Promise.resolve(state.slice()); };
    api.cancel = api.showArrow = api.highlight = api.setTurnable = api.resetCamera = api.resize = api.dispose = api.setSpeed = function () {};
    api.isBusy = function () { return false; };
    return api;
  }

  // ================================================================ the session
  function createSession(el, rawParams) {
    var CC = CCx(), UI = CC.UI, App = CC.App, h = UI.h;
    var Cube = CC.Cube, Solver = CC.Solver, Coach = CC.Coach, Lessons = CC.Lessons;
    var P = normalizeParams(rawParams, Cube);
    var settings = (App.data && App.data.settings) || {};
    var scheme = settings.keyboard === 'cstimer' ? 'cstimer' : 'simple';
    var destroyed = false;
    var view = null, pad = null;
    var ui = {};
    var timeouts = [];
    var ticker = 0, idleTimer = 0;
    var pending = 0, idleWaiters = [];
    var arrowTok;

    var S = {
      phase: 'init', plan: null, planGen: 0,
      si: 0, pi: 0, mi: 0, trail: null, level: 3,
      rec: {}, splits: {}, initialDone: [],
      total: createClock(), stageClock: createClock(),
      pauseDepth: 0, resumeTotal: false, resumeStage: false,
      speed: SPEEDS.indexOf(Number(settings.animSpeed)) !== -1 ? Number(settings.animSpeed) : 1,
      scramble: null, startState: null, setupBase: null, setupIdx: 0, frame: 'standard',
      knownState: null, knownLabel: 'this stage started', trust: true, prevSelfSolved: false, gate: null,
      stageStartActual: null,
      quiz: null, quizDone: {}, revealed: false,
      hintLevel: 0, hints: [], hintBusy: false,
      history: [], offPlan: false, partial: null, drop: null, note: null,
      playing: false, stepEnding: false, demo: false, demoIdx: 0, overlay: false, pauseOpen: false, mute: false,
      inspectStart: 0, finished: false, leaving: false, result: null, totalMs: 0, pop: false, hlKey: null
    };

    // ---------------------------------------------------------------- small utilities
    function later(fn, ms) {
      var id = setTimeout(function () {
        var k = timeouts.indexOf(id);
        if (k !== -1) timeouts.splice(k, 1);
        if (!destroyed) fn();
      }, ms);
      timeouts.push(id);
      return id;
    }
    function active() { try { App.markActive(); } catch (e) { /* ignore */ } }
    function toast(text, opts) { try { return App.toast(text, opts); } catch (e) { return null; } }
    function announce(text) { if (ui.live) { ui.live.textContent = ''; ui.live.textContent = text; } }
    function icon(name, size) { return UI.icon(name, size || 18); }
    function kbd(text) { return h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, text); }
    function scanAvailable() { var s = CCx().ScanUI; return !!(s && typeof s.open === 'function'); }
    function isRot(tok) { return Cube.isRotation ? Cube.isRotation(tok) : /^[xyz]/.test(tok); }
    function moveText(tok) { try { return Cube.moveInfo(tok).text; } catch (e) { return tok; } }
    function colourName(c) { return ((Cube.COLOR_NAME && Cube.COLOR_NAME[c]) || c).toUpperCase(); }
    // Settings › "Skip the daisy" makes the solver build the cross straight onto the bottom.
    function solveOpts() { return { directCross: !!settings.directCross }; }
    function solveSafe(state) { try { return Solver.solve(state, solveOpts()); } catch (e) { return null; } }
    function progressOf(state) {
      try { return Solver.progress(state); } catch (e) { return { index: 0, id: STAGE_IDS[0], done: [] }; }
    }

    function stageMeta(id) {
      var s = (Solver && Solver.STAGES && Solver.STAGES[stageIndex(id)]) || {};
      var l = (Lessons && Lessons.STAGES && Lessons.STAGES[id]) || {};
      return { id: id, name: s.name || l.title || id, short: s.short || s.name || id, goal: l.goal || s.goal || '', tagline: l.tagline || '', hints: l.hints || [] };
    }
    function bare(name) { return String(name || '').replace(/^The /, ''); }
    function theStage(id) { return 'the ' + bare(stageMeta(id).name); }
    // The daisy is only a way to build the cross: once the learner is past the cross, a plan that
    // starts again from the daisy means their WHITE CROSS came undone — call it that.
    function brokenStage(id, from) { return id === 'daisy' && (from == null ? S.si : from) > 1 ? 'cross' : id; }
    function algName(alg) {
      if (!alg) return '';
      var L = Lessons && Lessons.ALGORITHMS && Lessons.ALGORITHMS[alg.id];
      return (L && L.name) || alg.name || alg.id;
    }
    function stageObj() { return S.plan && S.si < 8 ? S.plan.stages[S.si] : null; }
    function stepObj() { var st = stageObj(); return st ? st.steps[S.pi] || null : null; }
    function stageId() { var st = stageObj(); return st ? st.id : null; }
    function curRec() { var id = stageId(); return id ? S.rec[id] : null; }
    // Identifies a step's question by its piece and content, not by plan, so a re-plan (after a slip,
    // Undo or Reset) doesn't ask the learner the same thing again.
    function stepKey(step) {
      if (!step) return '';
      var piece = (step.focus || []).map(function (i) { return step.startState[i]; }).sort().join('');
      var q = step.quiz;
      return step.stage + '|' + piece + '|' + (q ? q.prompt + '|' + q.options[q.answer] : step.id);
    }
    function ensureRec(id) {
      if (!S.rec[id]) S.rec[id] = { level: levelForStage(id), hints: 0, reveals: 0, ms: 0, quizRight: 0, quizTotal: 0, done: false, free: false };
      return S.rec[id];
    }
    function tracking() { return S.phase === 'solving' && !P.timed && S.level >= 2 && !S.gate && !!stepObj(); }
    function showingMoves() { return tracking() && (S.level === 3 || S.revealed); }
    function doneIds() {
      var out = S.initialDone.slice();
      STAGE_IDS.forEach(function (id) { if (S.rec[id] && S.rec[id].done && out.indexOf(id) === -1) out.push(id); });
      return out;
    }

    function levelForStage(id) {
      if (P.timed) return 0;
      var ov = settings.guidanceOverride;
      if (isLevel(ov)) return ov;
      try {
        var l = Coach && Coach.levelFor ? Coach.levelFor(App.data, id) : 3;
        return isLevel(l) ? l : 3;
      } catch (e) { return 3; }
    }

    function whyText(id, lvl) {
      var name = bare(stageMeta(id).name);
      if (P.timed) return 'Speed practice: no coaching unless you ask for a hint.';
      if (isLevel(settings.guidanceOverride)) return 'You chose ' + LEVEL_NAMES[settings.guidanceOverride] + ' help for every stage in Settings.';
      var data = App.data || {};
      var sk = (data.skills && data.skills[id]) || {};
      var n = Math.max(0, Math.floor(Number(sk.sessions) || 0));
      var m = 0;
      try { m = Math.round(Coach && Coach.masteryOf ? Coach.masteryOf(data, id) : Number(sk.mastery) || 0); } catch (e) { m = 0; }
      if (lvl === 3) {
        return n === 0 ? 'First time on the ' + name + ', so I’ll show you every move.'
          : 'You’ve done the ' + name + ' ' + timesText(n) + ' so far (mastery ' + m + '/100). I’ll keep showing every move until it sticks.';
      }
      if (lvl === 2) return 'You’ve done the ' + name + ' ' + timesText(n) + ' (mastery ' + m + '/100), so now I’ll name the case and the algorithm and you make the moves.';
      if (lvl === 1) return 'You’ve done the ' + name + ' well ' + timesText(Math.max(1, n)) + ' (mastery ' + m + '/100), so I’ll only give you the goal now.';
      return 'You’ve mastered the ' + name + ' (mastery ' + m + '/100), so it’s just you and the timer.';
    }

    // ---------------------------------------------------------------- clocks
    function pauseClocks() {
      if (S.pauseDepth++ === 0) {
        S.resumeTotal = S.total.running();
        S.resumeStage = S.stageClock.running();
        S.total.stop();
        S.stageClock.stop();
      }
    }
    function resumeClocks() {
      if (S.pauseDepth === 0) return;
      if (--S.pauseDepth === 0 && !S.finished) {
        if (S.resumeTotal) S.total.start();
        if (S.resumeStage) S.stageClock.start();
      }
    }
    function startStageClock() {
      S.stageClock.reset();
      if (S.pauseDepth > 0) S.resumeStage = S.resumeTotal;
      else if (S.total.running()) S.stageClock.start();
    }

    // ---------------------------------------------------------------- animation plumbing
    function animate(tokens, opts) {
      opts = opts || {};
      pending++;
      setArrow(null);
      var p;
      try { p = view.play(tokens, { speed: opts.speed, onMove: opts.onMove }); } catch (e) { console.error(e); p = null; }
      function done() { pending = Math.max(0, pending - 1); if (!destroyed && !pending) flushIdle(); }
      return Promise.resolve(p).then(function (st) { done(); return st; }, function (err) { done(); console.error(err); return null; });
    }
    function whenIdle(fn) { if (!pending) fn(); else idleWaiters.push(fn); }
    function flushIdle() {
      var list = idleWaiters;
      idleWaiters = [];
      list.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
      if (!pending && !destroyed) { resync(); ensureHighlight(); updateArrow(); renderTransport(); }
    }
    function setArrow(tok) {
      tok = tok || null;
      if (tok === arrowTok) return;
      arrowTok = tok;
      try { view.showArrow(tok); } catch (e) { /* ignore */ }
    }
    function updateArrow() {
      if (destroyed || !view) return;
      var tok = null;
      if (showingMoves() && !S.quiz && !S.playing && !S.demo && !pending && !view.isBusy()) {
        var step = stepObj();
        if (P.virtual && S.drop && S.history.length) tok = Cube.invertMove(S.history[S.history.length - 1]);
        else if (S.partial) tok = S.partial.remaining;
        else if (step && S.mi < step.moves.length) tok = step.moves[S.mi];
      }
      setArrow(tok);
    }
    function focusNow() {
      var step = stepObj();
      if (!step || !step.focus || !step.focus.length) return null;
      if (!S.mi) return step.focus.slice();
      var done = step.moves.slice(0, S.mi);
      try { return step.focus.map(function (i) { return Cube.stickerAfter(i, done); }); } catch (e) { return null; }
    }
    // A question about "this corner" / "this edge" needs the piece lit up to be answerable.
    function quizNeedsFocus() { return !!(S.quiz && /\bthis (corner|edge|piece)\b/i.test(S.quiz.quiz.prompt || '')); }
    function applyHighlight() {
      var idx = tracking() && (!S.quiz || quizNeedsFocus()) ? focusNow() : null;
      try { view.highlight(idx && idx.length ? idx : null); } catch (e) { /* ignore */ }
    }
    // Re-apply the highlight only when the step changes (it follows the pieces through moves by itself).
    function ensureHighlight() {
      if (!view || S.demo) return;
      var key = S.planGen + ':' + S.si + ':' + S.pi + ':' + (tracking() && (!S.quiz || quizNeedsFocus()) ? 1 : 0) + ':' + S.phase;
      if (key === S.hlKey) return;
      S.hlKey = key;
      applyHighlight();
    }
    function expectedView() {
      if (P.virtual || S.phase !== 'solving' || S.demo || S.playing) return null;
      if (tracking() && S.trail) return S.trail[S.mi];
      return S.knownState;
    }
    // Defensive: the 3D cube must always match the plan.
    function resync() {
      var exp = expectedView();
      if (!exp || pending || view.isBusy()) return;
      if (!sameState(view.getState(), exp)) {
        view.setState(exp);
        S.hlKey = null;
        ensureHighlight();
      }
    }
    function cancelView() {
      S.mute = true;
      try { view.cancel(); } catch (e) { /* ignore */ }
      S.mute = false;
    }

    // ---------------------------------------------------------------- skeleton
    function build() {
      UI.empty(el);
      ui.root = h('div', { class: ['cc-solve', P.virtual ? 'cc-solve--virtual' : 'cc-solve--physical', P.timed ? 'cc-solve--timed' : null] });
      ui.head = h('header', { class: 'page-head cc-solve__head' });
      ui.timedCard = h('div', { class: 'cc-solve__timed' });
      ui.vp = h('div', { class: 'viewport-3d cc-solve__vp' });
      ui.status = h('div', { class: 'cc-solve__status', hidden: true });
      ui.moveArea = h('div', { class: 'cc-solve__move' });
      ui.transport = h('div', { class: 'cc-solve__transport' });
      ui.padArea = h('div', { class: 'cc-solve__pad' });
      ui.stageCol = h('div', { class: 'solve-layout__stage cc-solve__stage' }, ui.timedCard, ui.vp, ui.moveArea, ui.transport, ui.padArea);
      ui.panel = h('aside', { class: 'solve-layout__panel coach-panel cc-solve__panel', 'aria-label': 'Coach' });
      ui.live = h('p', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
      ui.root.appendChild(ui.head);
      ui.root.appendChild(h('div', { class: 'solve-layout' }, ui.stageCol, ui.panel));
      ui.root.appendChild(ui.live);
      el.appendChild(ui.root);

      var v = null;
      try {
        if (CC.View3D && typeof CC.View3D.create === 'function') {
          v = CC.View3D.create(ui.vp, {
            interactive: true, turnable: false,
            label: P.virtual ? 'Virtual Rubik’s cube. Drag a sticker to turn a layer; drag the background to look around.' : 'Your cube, as you hold it'
          });
        }
      } catch (e) { console.error('[CC solve] 3D view failed', e); v = null; }
      if (!v) {
        v = nullView(Cube);
        ui.vp.appendChild(h('div', { class: 'viewport-3d__placeholder' }, icon('cube', 40),
          h('strong', null, 'The cube picture isn’t available'),
          h('span', { class: 'small' }, 'Follow the moves written below — everything else still works.')));
      } else {
        ui.vp.appendChild(h('div', { class: 'viewport-3d__corner' },
          h('button', {
            type: 'button', class: 'btn btn-secondary btn-sm btn-icon', 'aria-label': 'Reset the view',
            title: 'Reset the view (or double-click the cube)', onClick: function () { try { view.resetCamera(); } catch (e) { /* ignore */ } }
          }, icon('refresh', 16))));
      }
      ui.vp.appendChild(ui.status);
      view = v;
      try { view.setSpeed(S.speed); } catch (e) { /* ignore */ }
      view.onUserMove = function (tok) { onCommit(tok, 'user'); };
    }

    function setStatus(text) {
      if (!ui.status) return;
      UI.empty(ui.status);
      if (!text) { ui.status.hidden = true; return; }
      ui.status.hidden = false;
      ui.status.appendChild(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
      ui.status.appendChild(document.createTextNode(text));
    }

    // ---------------------------------------------------------------- rendering
    function focusKey() {
      var a = document.activeElement;
      return a && a.getAttribute && el.contains(a) ? a.getAttribute('data-focus') : null;
    }
    function restoreFocus(key) {
      if (!key) return;
      var a = document.activeElement;
      if (a && a !== document.body && el.contains(a) && a.getAttribute('data-focus') === key) return;
      if (a && a !== document.body && !el.contains(a)) return;
      var n = el.querySelector('[data-focus="' + key + '"]');
      if (n && !n.disabled) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }

    function refresh() {
      if (destroyed || S.phase === 'done') return;
      var key = focusKey();
      ui.big = ui.bigLabel = null;
      renderMoveArea();
      renderTransport();
      renderPanel();
      renderTimedCard();
      syncTurnable();
      if (P.virtual || !pending) { if (!pending) resync(); ensureHighlight(); updateArrow(); }
      restoreFocus(key);
      S.pop = false;
    }

    function renderHead() {
      UI.empty(ui.head);
      var drill = P.source === 'drill';
      var eyebrow = (P.virtual ? 'Virtual cube' : 'Your cube') + ' · ' + (P.timed ? 'Speed practice' : drill ? 'Stage practice' : 'Coached solve');
      var title = P.timed ? (drill ? 'Timed: ' + stageMeta(P.stage).name : 'Timed solve')
        : drill ? 'Practise ' + theStage(P.stage) : P.virtual ? 'Solve the virtual cube' : 'Solve your cube';
      ui.head.appendChild(h('div', null, h('p', { class: 'eyebrow' }, eyebrow), h('h1', null, title)));
      var acts = h('div', { class: 'row row-sm' });
      var solving = S.phase === 'solving';
      if (solving && !P.virtual && !P.timed) {
        acts.appendChild(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: lost, title: 'Rescan your cube and get a fresh plan', 'aria-label': 'I’m lost — rescan my cube' },
          icon('camera', 16), h('span', { class: 'btn-label' }, 'I’m lost')));
      }
      if (solving) {
        acts.appendChild(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: openPause, 'aria-keyshortcuts': 'Escape', title: 'Pause (Esc)', 'aria-label': 'Pause' },
          icon('pause', 16), h('span', { class: 'btn-label' }, 'Pause')));
      }
      acts.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: leave, 'aria-label': 'Leave this solve' }, icon('x', 16), h('span', { class: 'btn-label' }, 'Leave')));
      ui.head.appendChild(acts);
    }

    function moveNow(tok, opts) {
      opts = opts || {};
      return h('div', { class: 'cc-solve-move__now' },
        h('span', { class: ['cc-solve-move__chip', isRot(tok) ? 'is-rotation' : null, opts.undo ? 'is-undo' : null], 'aria-hidden': 'true' }, tok),
        h('span', { class: 'cc-solve-move__text' }, h('span', { class: 'sr-only' }, tok + ': '), moveText(tok)));
    }

    function segmentAt(step, mi) {
      var n = 0;
      for (var i = 0; i < step.segments.length; i++) {
        n += step.segments[i].moves.length;
        if (mi < n) return step.segments[i];
      }
      return null;
    }

    function renderMoveArea() {
      var box = ui.moveArea;
      UI.empty(box);
      if (S.phase === 'setup') {
        var scr = S.scramble, i = S.setupIdx;
        box.appendChild(h('section', { class: 'card card-sm cc-solve-move', 'aria-label': 'Scramble moves' },
          h('p', { class: 'cc-solve-move__ctx' }, i < scr.length ? 'Move ' + (i + 1) + ' of ' + scr.length : 'All ' + scr.length + ' moves done'),
          i < scr.length ? moveNow(scr[i])
            : h('p', { class: 'cc-solve-move__done' }, icon('check', 20), 'That’s the scramble. Press Ready when your cube matches the picture.'),
          UI.algChips(scr, { current: i < scr.length ? i : -1, done: i, size: 'lg', label: 'Scramble' })));
        return;
      }
      if (S.phase !== 'solving' || P.timed) return;
      var step = stepObj();
      var card = h('section', { class: 'card card-sm cc-solve-move', 'aria-label': 'Current move' });
      if (S.demo && S.demoKind === 'hint') {
        card.appendChild(h('p', { class: 'cc-solve-move__done' }, icon('watch', 20), 'Showing the hint’s moves on the cube…'));
        box.appendChild(card);
        return;
      }
      if (S.demo && step) {
        card.appendChild(h('p', { class: 'cc-solve-move__ctx' }, 'Replaying this step…'));
        card.appendChild(UI.algChips(step.moves, { current: S.demoIdx < step.moves.length ? S.demoIdx : -1, done: S.demoIdx, size: 'lg', label: step.title }));
        box.appendChild(card);
        return;
      }
      if (P.virtual && S.drop && S.level >= 2 && S.history.length) {
        var inv = Cube.invertMove(S.history[S.history.length - 1]);
        card.appendChild(h('p', { class: 'cc-solve-move__ctx' }, 'That undid part of your ' + bare(stageMeta(brokenStage(S.drop.stage)).name) + '. Undo it to get back on track:'));
        card.appendChild(moveNow(inv, { undo: true }));
        box.appendChild(card);
        return;
      }
      if (tracking() && S.quiz && !S.quiz.answered) {
        // On a phone the question sits below the cube: say where it is.
        card.appendChild(h('p', { class: 'cc-solve-move__ctx' }, S.level === 3 ? 'Before the moves: a quick question' : 'A quick question first'));
        card.appendChild(h('p', { class: 'm-0' }, (quizNeedsFocus() ? 'Look at the highlighted piece and answer the question in the coach panel' : 'Look at the cube and answer the question in the coach panel') +
          ' (or press Skip).'));
        card.appendChild(h('div', { class: 'row row-sm' }, btn('Go to the question', { cls: 'btn-sm btn-secondary', focus: 'to-quiz', onClick: function () {
          var o = el.querySelector('[data-focus="opt-0"]');
          if (o) { try { o.scrollIntoView({ block: 'center', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); o.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        } })));
        box.appendChild(card);
        return;
      }
      if (showingMoves() && step && !S.quiz) {
        if (S.partial) {
          card.appendChild(h('p', { class: 'cc-solve-move__ctx' }, 'Nearly — you turned ' + S.partial.done + '. Finish the move with:'));
          card.appendChild(moveNow(S.partial.remaining));
        } else if (S.mi < step.moves.length) {
          var seg = segmentAt(step, S.mi), label = seg && seg.label;
          try {   // skip a label that only repeats the move's plain English
            var how = Cube.moveInfo(step.moves[S.mi]).how;
            if (label && how && label.toLowerCase().indexOf(how.toLowerCase()) !== -1) label = null;
          } catch (e) { /* ignore */ }
          card.appendChild(h('p', { class: 'cc-solve-move__ctx' }, 'Move ' + (S.mi + 1) + ' of ' + step.moves.length + (label ? ' · ' + label : '')));
          card.appendChild(moveNow(step.moves[S.mi]));
        } else {
          card.appendChild(h('p', { class: 'cc-solve-move__done' }, icon('check', 20), 'Step done'));
        }
        card.appendChild(UI.algChips(step.moves, { current: S.mi < step.moves.length ? S.mi : -1, done: S.mi, size: 'lg', label: step.title }));
        box.appendChild(card);
        return;
      }
      if (tracking() && S.level === 2 && !S.quiz) {
        card.appendChild(h('p', { class: 'cc-solve-move__ctx' }, 'Moves hidden'));
        card.appendChild(h('p', { class: 'm-0' }, P.virtual ? 'Make the moves on the cube — I’m following along.' : 'Do this step on your cube, then press Done.'));
        box.appendChild(card);
        return;
      }
      if (!P.virtual && S.level <= 1) {
        box.appendChild(h('p', { class: 'small muted m-0' }, S.trust
          ? 'The picture shows your cube as it was when ' + (S.knownLabel === 'your last scan' ? 'you last scanned it' : 'this stage began') + '.'
          : 'The picture shows how I expect your cube looks (you solved the last stage your own way).'));
      }
    }

    function btn(label, opts) {
      opts = opts || {};
      // A mouse click on a secondary button (Replay, Play step…) shouldn't keep focus there,
      // otherwise the learner's next Space press would click it again instead of "Next move".
      var primary = /\bbtn-primary\b/.test(opts.cls || '');
      var onClick = opts.onClick && function (e) {
        if (!primary && e && e.detail > 0 && e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
        return opts.onClick.apply(this, arguments);
      };
      return h('button', {
        type: 'button', class: ['btn', opts.cls || 'btn-secondary'], disabled: !!opts.disabled, onClick: onClick,
        dataset: { focus: opts.focus || null }, title: opts.title || null, 'aria-keyshortcuts': opts.keys || null
      }, opts.icon ? icon(opts.icon, 18) : null, label, opts.kbd ? kbd(opts.kbd) : null);
    }

    function speedControl() {
      var sel = h('select', {
        class: 'select select-inline', 'aria-label': 'Animation speed', dataset: { focus: 'speed' },
        onChange: function (e) { setSpeed(Number(e.target.value)); }
      }, SPEEDS.map(function (s) { return h('option', { value: String(s), selected: s === S.speed }, s + '×'); }));
      return h('label', { class: 'cc-solve-speed' }, h('span', null, 'Speed'), sel);
    }

    function setSpeed(s) {
      if (SPEEDS.indexOf(s) === -1) return;
      S.speed = s;
      try { view.setSpeed(s); } catch (e) { /* ignore */ }
      try { App.data.settings.animSpeed = s; App.save(); } catch (e) { /* ignore */ }
      active();
    }

    function renderTransport() {
      var box = ui.transport;
      if (!box) return;
      var key = focusKey();
      UI.empty(box);
      buildTransport(box);
      restoreFocus(key);
    }

    function buildTransport(box) {
      var row = h('div', { class: 'cc-solve-transport', role: 'group', 'aria-label': 'Controls' });
      if (S.phase === 'setup') {
        var n = S.scramble.length, i = S.setupIdx, busy = pending > 0;
        row.appendChild(btn('Back', { icon: 'arrowLeft', disabled: busy || i === 0, onClick: setupBack, focus: 'back', keys: 'ArrowLeft', title: 'Undo the last scramble move on screen (←)' }));
        row.appendChild(btn('Next move', { cls: 'btn-primary', icon: 'play', kbd: 'Space', disabled: i >= n || pending > 1, onClick: setupNext, focus: 'next', keys: 'Space ArrowRight' }));
        row.appendChild(btn('Show the rest', { icon: 'zap', disabled: busy || i >= n, onClick: setupAll, focus: 'all' }));
        row.appendChild(speedControl());
        box.appendChild(row);
        return;
      }
      if (S.phase !== 'solving' || P.timed) {
        if (P.virtual && P.timed && (S.phase === 'solving' || S.phase === 'ready' || S.phase === 'inspect')) {
          row.appendChild(btn('Undo', { icon: 'arrowLeft', onClick: undo, focus: 'undo', kbd: '⌘Z', disabled: !S.history.length }));
          box.appendChild(row);
        }
        return;
      }
      var step = stepObj();
      var lock = S.quiz || S.gate || S.demo || S.playing || S.stepEnding;
      if (P.virtual) {
        row.appendChild(btn('Undo', { icon: 'arrowLeft', onClick: undo, focus: 'undo', kbd: '⌘Z', disabled: !S.history.length, title: 'Undo your last move (Ctrl/Cmd+Z or ←)' }));
        if (showingMoves() && step) {
          row.appendChild(S.drop && S.history.length
            ? btn('Undo that move', { cls: 'btn-primary', icon: 'arrowLeft', kbd: 'Space', onClick: doForMe, focus: 'auto', disabled: !!lock })
            : btn('Do it for me', { cls: 'btn-primary', icon: 'play', kbd: 'Space', onClick: doForMe, focus: 'auto', disabled: !!lock || S.mi >= step.moves.length }));
        }
        row.appendChild(btn('Reset stage', { icon: 'refresh', onClick: resetStage, focus: 'reset', title: 'Put the cube back as it was at the start of this stage' }));
        row.appendChild(speedControl());
        box.appendChild(row);
        return;
      }
      if (!showingMoves() || !step) { if (tracking()) { row.appendChild(speedControl()); box.appendChild(row); } return; }
      var atStart = S.mi === 0 && S.pi === 0;
      row.appendChild(btn('Back', { icon: 'arrowLeft', onClick: backMove, focus: 'back', disabled: !!lock || pending > 0 || atStart, keys: 'ArrowLeft', title: 'Back a move (←)' }));
      row.appendChild(btn('Next move', { cls: 'btn-primary', icon: 'play', kbd: 'Space', onClick: nextMove, focus: 'next', disabled: !!lock || pending > 1 || S.mi >= step.moves.length, keys: 'Space ArrowRight' }));
      row.appendChild(btn('Replay', { icon: 'refresh', onClick: replayStep, focus: 'replay', disabled: !!lock || pending > 0, kbd: 'R', keys: 'R', title: 'Watch this step again' }));
      row.appendChild(btn('Play step', { icon: 'zap', onClick: playStep, focus: 'play', disabled: !!lock || pending > 0 || S.mi >= step.moves.length, title: 'Play the rest of this step' }));
      row.appendChild(speedControl());
      box.appendChild(row);
    }

    function renderPad() {
      if (!P.virtual || pad || !CC.MovePad) return;
      var wrap = h('section', { class: 'card card-sm stack stack-sm cc-solve-padwrap', 'aria-label': 'Turn the cube' });
      try { pad = CC.MovePad.render(wrap, { onMove: learnerMove, rotations: true }); } catch (e) { console.error(e); pad = null; }
      var legend = [];
      try { legend = CC.Keys ? CC.Keys.legend(scheme) : []; } catch (e) { legend = []; }
      var keys;
      if (scheme === 'cstimer') {
        keys = h('ul', { class: 'cc-solve-keys' }, legend.map(function (l) { return h('li', null, h('kbd', { class: 'kbd' }, l.key), l.token); }));
      } else {
        var group = function (label, letters) {
          return h('li', null, label + ':', letters.map(function (k) { return h('kbd', { class: 'kbd' }, k); }));
        };
        keys = h('div', null,
          h('p', { class: 'small muted m-0' }, 'Press a letter to turn that layer clockwise; hold Shift for anticlockwise.'),
          h('ul', { class: 'cc-solve-keys' },
            group('Faces', ['U', 'D', 'R', 'L', 'F', 'B']),
            group('Slices', ['M', 'E', 'S']),
            group('Whole cube', ['X', 'Y', 'Z'])));
      }
      wrap.appendChild(h('details', { class: 'cc-solve-legend' },
        h('summary', null, 'Keyboard shortcuts'),
        keys,
        h('ul', { class: 'cc-solve-keys' },
          h('li', null, h('kbd', { class: 'kbd' }, 'Ctrl/⌘ Z'), 'undo'),
          h('li', null, h('kbd', { class: 'kbd' }, 'Space'), 'do the shown move for me'),
          h('li', null, h('kbd', { class: 'kbd' }, '?'), 'hint'),
          h('li', null, h('kbd', { class: 'kbd' }, 'Esc'), 'pause'))));
      ui.padWrap = wrap;
      ui.padArea.appendChild(wrap);
    }

    function canTurn() {
      if (!P.virtual || S.finished || S.overlay || S.pauseOpen) return false;
      if (P.timed) return S.phase === 'ready' || S.phase === 'inspect' || S.phase === 'solving';
      return S.phase === 'solving' && !S.quiz;
    }
    function syncTurnable() {
      if (!view) return;
      var on = canTurn();
      try { view.setTurnable(on); } catch (e) { /* ignore */ }
      if (ui.padWrap) {
        ui.padWrap.classList.toggle('is-locked', !on);
        if (!on) ui.padWrap.setAttribute('aria-disabled', 'true'); else ui.padWrap.removeAttribute('aria-disabled');
      }
    }

    // ---------------------------------------------------------------- panel
    function renderPanel() {
      UI.empty(ui.panel);
      ui.total = ui.stage = null;
      if (S.phase === 'setup') { panelSetup(); return; }
      if (S.phase === 'init' || S.phase === 'scrambling') {
        ui.panel.appendChild(h('section', { class: 'card stack stack-sm' },
          h('div', { class: 'row row-nowrap' }, h('span', { class: 'spinner' }), h('strong', null, S.phase === 'scrambling' ? 'Scrambling your cube…' : 'Getting ready…'))));
        return;
      }
      if (P.timed) { panelTimed(); return; }
      if (S.phase !== 'solving') return;
      ui.panel.appendChild(trackCard());
      ui.panel.appendChild(stageCard());
      var sc = stepCard();
      if (sc) ui.panel.appendChild(sc);
      var hc = hintCard();
      if (hc) ui.panel.appendChild(hc);
    }

    function stat(label, valueNode) {
      return h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), valueNode);
    }

    function trackCard() {
      var id = stageId();
      ui.total = h('span', { class: 'stat__value' }, UI.fmtTime(S.total.ms()));
      ui.stage = h('span', { class: 'stat__value' }, UI.fmtTime(S.stageClock.ms()));
      return h('section', { class: 'card card-sm stack stack-sm', 'aria-label': 'Progress and time' },
        UI.stageTrack(id || 'solved', doneIds()),
        h('div', { class: 'cc-solve-times', role: 'timer', 'aria-live': 'off' },
          stat('Total', ui.total),
          stat('This stage', ui.stage)));
    }

    function levelBadge(lvl) {
      return h('span', { class: ['badge', LEVEL_BADGE[lvl]], title: LEVEL_LINE[lvl] }, LEVEL_NAMES[lvl]);
    }

    function stageCard() {
      var id = stageId(), meta = stageMeta(id), lvl = S.level, stg = stageObj();
      var rotateFirst = !P.virtual && lvl <= 1 && stg && stg.steps[0] && stg.steps[0].kind === 'rotate' && S.pi === 0;
      var card = h('section', { class: ['card', 'stack', 'stack-sm', S.pop ? 'cc-solve-pop' : null], 'aria-label': 'Stage' },
        h('div', { class: 'row row-between' },
          h('p', { class: 'eyebrow m-0' }, 'Stage ' + (stageIndex(id) + 1) + ' of 8'),
          P.source === 'drill' ? h('span', { class: 'badge' }, 'Drill') : null),
        h('h2', { class: 'h3 m-0' }, meta.name),
        h('div', { class: 'cc-solve-level' }, levelBadge(lvl), h('span', { class: 'small muted' }, LEVEL_LINE[lvl])),
        h('p', { class: 'cc-solve-why' }, whyText(id, lvl)),
        lvl >= 1 && meta.goal ? h('p', { class: 'm-0' }, h('strong', null, 'Goal: '), meta.goal) : null,
        lvl === 1 && meta.tagline ? h('p', { class: 'small muted m-0' }, 'Remember: ' + meta.tagline) : null,
        rotateFirst ? UI.callout('tip', null, 'First, hold the cube with ', UI.colourDot('Y'), ' YELLOW on top.') : null,
        id === 'middle' && !P.timed && CC.Gym ? h('div', { class: 'row row-sm' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { leave({ id: 'gym', params: {} }); } },
            icon('zap', 16), 'Stuck? Practise in the Gym')) : null);
      return card;
    }

    function noteCallout() {
      if (!S.note) return null;
      return UI.callout(S.note.kind || 'info', null, S.note.text);
    }

    function dropCallout() {
      if (!S.drop) return null;
      var name = bare(stageMeta(brokenStage(S.drop.stage)).name);
      var acts = h('div', { class: 'row row-sm mt-2' },
        P.virtual ? h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onClick: undo, dataset: { focus: 'drop-undo' } }, icon('arrowLeft', 16), 'Undo last move') : null,
        S.drop.plan ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: acceptDrop, dataset: { focus: 'drop-replan' } }, 'Re-plan from here') : null);
      return UI.callout('warn', 'Heads up: your ' + name + ' isn’t complete any more',
        h('p', { class: 'm-0' }, 'If you’re part-way through an algorithm, carry on. Otherwise, undo your last move.'), acts);
    }

    function stepCard() {
      var stg = stageObj(), step = stepObj(), lvl = S.level;
      if (!stg) return null;
      if (S.gate === 'rescan') return gateCard();
      if (lvl >= 2 && !step) {
        return h('section', { class: 'card step-card stack stack-sm' },
          h('h3', { class: 'm-0' }, 'This stage may already be done'),
          h('p', { class: 'm-0 muted' }, 'My plan says ' + theStage(stg.id) + ' is already finished on your cube. If yours agrees, carry on. If not, press I’m lost and show me your cube.'),
          h('div', { class: 'row row-sm' },
            btn('Continue', { cls: 'btn-primary', icon: 'arrowRight', onClick: function () { completeStage({ free: true }); refresh(); }, focus: 'continue', kbd: 'Enter' }),
            !P.virtual ? btn('I’m lost', { icon: 'camera', onClick: lost, focus: 'lost' }) : null));
      }
      if (lvl >= 2 && S.quiz) return quizCard(step);
      if (lvl >= 2) return showingMoves() ? showCard(stg, step) : coachCard(stg, step);
      return selfCard();
    }

    function stepHeader(stg, step, extra) {
      return h('div', { class: 'row row-between' },
        h('p', { class: 'eyebrow m-0' }, 'Step ' + (S.pi + 1) + ' of ' + stg.steps.length),
        extra || null);
    }

    function stepProgress(stg) {
      var pct = stg.steps.length ? Math.round(S.pi / stg.steps.length * 100) : 0;
      return h('div', { class: 'progress progress-sm', role: 'progressbar', 'aria-label': 'Steps done in this stage', 'aria-valuemin': 0, 'aria-valuemax': stg.steps.length, 'aria-valuenow': S.pi },
        h('div', { class: 'progress__bar', style: { width: pct + '%' } }));
    }

    function facts(step) {
      var rows = [];
      if (step.case && step.case.name) rows.push(h('dt', null, 'Case'), h('dd', null, step.case.name));
      if (step.alg) {
        var reps = Math.max(1, Math.round(Number(step.alg.reps) || 1));
        rows.push(h('dt', null, 'Algorithm'), h('dd', null, algName(step.alg) + (reps > 1 ? ' × ' + reps : '')));
      }
      return rows.length ? h('dl', { class: 'cc-solve-facts' }, rows) : null;
    }

    function showCard(stg, step) {
      var card = h('section', { class: 'card step-card stack stack-sm', 'aria-label': 'Step' },
        stepHeader(stg, step, S.level === 2 ? h('span', { class: 'badge badge-info' }, 'Moves shown') : null),
        h('h3', { class: 'm-0' }, step.title),
        step.explain ? h('p', { class: 'm-0 muted' }, step.explain) : null,
        facts(step));
      if (step.alg && step.alg.notation) {
        card.appendChild(h('p', { class: 'small m-0' }, h('span', { class: 'muted' }, algName(step.alg) + ': '), h('code', null, step.alg.notation)));
      }
      if (step.segments && step.segments.length > 1) {
        var n = 0;
        card.appendChild(h('ol', { class: 'cc-solve-segs', 'aria-label': 'Parts of this step' }, step.segments.map(function (seg) {
          var from = n; n += seg.moves.length;
          var state = S.mi >= n ? 'is-done' : S.mi >= from ? 'is-current' : '';
          return h('li', { class: ['cc-solve-seg', state] },
            h('span', { class: 'cc-solve-seg__label' }, seg.label),
            UI.algChips(seg.moves, { size: 'sm', current: state === 'is-current' ? S.mi - from : -1, done: state === 'is-done' ? true : Math.max(0, S.mi - from), label: seg.label }));
        })));
      }
      card.appendChild(stepProgress(stg));
      var nc = noteCallout(); if (nc) card.appendChild(nc);
      var dc = dropCallout(); if (dc) card.appendChild(dc);
      card.appendChild(h('p', { class: 'small muted m-0' }, P.virtual
        ? 'Make the move the arrow shows: drag that layer, use the buttons below the cube, or the keyboard. Stuck? “Do it for me”.'
        : 'Do each move on your cube, then press Space (or Next move). ← goes back a move.'));
      if (!P.virtual && S.level === 2) {
        card.appendChild(h('div', { class: 'row row-sm' }, btn('Done with this step', { cls: 'btn-secondary', icon: 'check', onClick: doneWithStep, focus: 'done-step', kbd: 'Enter', disabled: S.playing || pending > 0 })));
      }
      return card;
    }

    function coachCard(stg, step) {
      var card = h('section', { class: 'card step-card stack stack-sm', 'aria-label': 'Step' },
        stepHeader(stg, step),
        h('h3', { class: 'm-0' }, step.title),
        (step.kind === 'rotate' || step.kind === 'align') && step.explain ? h('p', { class: 'm-0 muted' }, step.explain) : null,
        facts(step),
        stepProgress(stg));
      var nc = noteCallout(); if (nc) card.appendChild(nc);
      var dc = dropCallout(); if (dc) card.appendChild(dc);
      if (P.virtual && S.offPlan && !S.drop) card.appendChild(h('p', { class: 'small muted m-0' }, 'You’re doing it your own way — that’s fine. When you pause, I’ll update the plan from your cube.'));
      card.appendChild(h('p', { class: 'small muted m-0' }, P.virtual
        ? 'Make the moves on the cube yourself — I’m following along and will move on when the step is done.'
        : 'Do this step on your cube from memory, then press Done.'));
      card.appendChild(h('div', { class: 'row row-sm' },
        !P.virtual ? btn('Done with this step', { cls: 'btn-primary', icon: 'check', onClick: doneWithStep, focus: 'done-step', kbd: 'Enter', disabled: S.playing || pending > 0 }) : null,
        btn('Show moves', { icon: 'watch', onClick: revealMoves, focus: 'reveal', kbd: 'H', title: 'Shows this step move by move (counts as a hint)' })));
      card.appendChild(h('p', { class: 'xsmall subtle m-0' }, 'Showing the moves counts as a hint.'));
      return card;
    }

    function quizCard(step) {
      var q = S.quiz, quiz = q.quiz;
      var stg = stageObj();
      var opts = h('ol', { class: 'quiz__options' }, quiz.options.map(function (o, i) {
        var cls = ['quiz-option'];
        if (q.answered && i === quiz.answer) cls.push('is-correct');
        else if (q.answered && i === q.choice) cls.push('is-wrong');
        return h('li', null, h('button', {
          type: 'button', class: cls, disabled: q.answered, dataset: { focus: 'opt-' + i },
          onClick: function () { answerQuiz(i); }
        }, h('span', { class: 'quiz-option__key', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'quiz-option__text' }, o)));
      }));
      var feedback = null;
      if (q.answered) {
        feedback = UI.callout(q.right ? 'success' : 'warn', q.right ? 'Right!' : 'Not quite — it’s “' + quiz.options[quiz.answer] + '”.', quiz.explain || '');
      }
      var lead = S.level === 3 ? 'Before I show you the moves — look at the cube and predict:' : 'Look at the cube and decide:';
      return h('section', { class: 'card step-card stack', 'aria-label': 'Question' },
        stepHeader(stg, step, h('span', { class: 'badge badge-accent' }, S.level === 3 ? 'Anticipate' : 'Quick check')),
        h('p', { class: 'small muted m-0' }, lead),
        h('div', { class: ['quiz', q.answered ? 'is-answered' : null] },
          h('p', { class: 'quiz__prompt' }, quiz.prompt),
          opts,
          feedback),
        h('div', { class: 'row row-sm' }, q.answered
          ? btn(S.level === 3 ? 'Show me the moves' : 'Continue', { cls: 'btn-primary', icon: 'arrowRight', onClick: finishQuiz, focus: 'quiz-continue', kbd: 'Space' })
          : btn('Skip', { cls: 'btn-ghost', onClick: skipQuiz, focus: 'quiz-skip', title: 'Skip the question (doesn’t count against you)' }),
        !q.answered ? h('span', { class: 'xsmall subtle' }, 'Press 1–' + quiz.options.length + ' to answer.') : null));
    }

    function gateCard() {
      var prev = S.lastDone ? theStage(S.lastDone) : 'the last stage';
      var can = scanAvailable();
      return h('section', { class: 'card step-card stack stack-sm', 'aria-label': 'Rescan' },
        h('h3', { class: 'm-0' }, 'Show me your cube so I can guide the next stage'),
        h('p', { class: 'm-0 muted' }, 'You did ' + prev + ' on your own, so I don’t know exactly how your cube looks now. ' +
          (can ? 'A quick scan lets me guide this stage move by move.' : 'Rescanning isn’t available right now, so check your cube looks like the picture before you carry on.')),
        h('div', { class: 'row row-sm' },
          can ? btn('Scan my cube', { cls: 'btn-primary', icon: 'camera', onClick: function () { doRescan('gate').then(function () { refresh(); }); }, focus: 'gate-scan' }) : null,
          btn(can ? 'Skip — it looks like the picture' : 'Continue', { cls: can ? 'btn-ghost' : 'btn-primary', onClick: skipGate, focus: 'gate-skip' })));
    }

    function selfCard() {
      var lvl = S.level;
      var card = h('section', { class: 'card step-card stack stack-sm', 'aria-label': 'Your turn' });
      if (P.virtual) {
        card.appendChild(h('p', { class: 'm-0' }, lvl === 1
          ? 'Turn the cube however you like. I’ll notice as soon as the goal is met.'
          : 'Over to you. I’ll notice when the stage is done.'));
        var dc = dropCallout(); if (dc) card.appendChild(dc);
        return card;
      }
      card.appendChild(h('p', { class: 'm-0' }, lvl === 1
        ? 'Work through this stage on your own. If you get stuck, press Hint — each press tells you a bit more.'
        : 'Over to you. Press Stage done (or Space) the moment the stage is finished.'));
      card.appendChild(h('div', { class: 'row row-sm' },
        btn('Stage done', { cls: 'btn-primary btn-lg', icon: 'check', onClick: stageDonePressed, focus: 'stage-done', kbd: 'Space', keys: 'Space Enter' }),
        btn('I’m lost', { icon: 'camera', onClick: lost, focus: 'lost', title: 'Rescan your cube and get a fresh plan' })));
      return card;
    }

    function hintAllowed() {
      return S.phase === 'solving' && (P.timed || S.level <= 1) && !S.gate && !S.hintBusy;
    }

    function hintCard() {
      if (!(P.timed || S.level <= 1)) return null;
      var list = S.hints.length ? h('ol', { class: 'cc-solve-hints' }, S.hints.map(function (ht, i) {
        var last = i === S.hints.length - 1;
        return h('li', { class: 'cc-solve-hint', tabindex: last ? '-1' : null, dataset: { focus: last ? 'hint-last' : null } },
          h('span', { class: 'cc-solve-hint__lvl' }, HINT_LABEL[ht.level] + (ht.generic ? ' (general)' : '')),
          ht.fix ? h('p', { class: 'strong' }, 'First, fix ' + theStage(brokenStage(ht.fix, ht.from)) + ' — it isn’t complete any more.') : null,
          ht.rotateFirst && ht.level >= 2 ? h('p', null, h('strong', null, 'First: '), 'hold the cube with YELLOW on top.') : null,
          h('p', null, ht.text),
          ht.moves && ht.moves.length ? exactMoves(ht) : null);
      })) : h('p', { class: 'small muted m-0' }, S.level === 0 || P.timed ? 'No hints so far — that’s the way.' : 'Each hint counts, so try on your own first.');
      var lvl = S.hintLevel, more = moreHints();
      var label = lvl === 0 ? 'Hint' : lvl < 3 ? 'Another hint' : more ? 'Hint for the next step' : 'No more hints';
      var used = S.hintsUsed || S.hints.length;
      return h('section', { class: 'card card-sm stack stack-sm', 'aria-label': 'Hints' },
        h('div', { class: 'row row-between' }, h('h3', { class: 'm-0 h4' }, 'Hints'),
          used ? h('span', { class: 'badge' }, used + ' used') : null),
        list,
        h('div', { class: 'row row-sm' },
          btn(label, { icon: 'tip', onClick: requestHint, focus: 'hint', kbd: P.virtual ? '?' : 'H', disabled: (lvl >= 3 && !more) || !hintAllowed() })),
        lvl >= 3 && !more && !P.virtual && !P.timed ? h('p', { class: 'xsmall subtle m-0' }, 'Stuck on the next piece? Press I’m lost and show me your cube for fresh hints.') : null);
    }

    function exactMoves(ht) {
      var moves = (ht.pre || []).concat(ht.moves);
      var plain = moves.map(function (t) { return moveText(t); });
      return h('div', null,
        UI.algChips(moves, { size: 'sm', label: 'Exact moves' }),
        h('ol', { class: 'cc-solve-plain' }, moves.map(function (t, i) { return h('li', null, h('code', null, t), ' — ', plain[i]); })),
        h('div', { class: 'row row-sm mt-2' }, P.virtual
          ? btn('Do these moves for me', { cls: 'btn-sm btn-secondary', icon: 'play', onClick: function () { doHintMoves(ht); }, disabled: pending > 0 })
          : btn('Show me on the cube', { cls: 'btn-sm btn-secondary', icon: 'watch', onClick: function () { demoHint(ht); }, disabled: pending > 0 || S.demo })));
    }

    function panelSetup() {
      var drill = P.source === 'drill';
      var top = S.frame === 'learning' ? 'Y' : 'W';
      var n = S.scramble.length;
      ui.panel.appendChild(h('section', { class: 'card stack stack-sm', 'aria-label': 'Set up' },
        h('p', { class: 'eyebrow m-0' }, drill ? 'Set up the practice cube' : 'Set up your cube'),
        h('h2', { class: 'h3 m-0' }, 'Scramble your cube'),
        h('p', { class: 'm-0' }, 'Start with a ', h('strong', null, 'SOLVED'), ' cube, ', UI.colourDot(top), ' ',
          h('strong', null, colourName(top) + ' on top'), ', ', UI.colourDot('G'), ' ', h('strong', null, 'GREEN facing you'),
          ', then do these ' + n + ' moves.'),
        h('p', { class: 'small muted m-0' }, 'Do them one at a time. Press Space (or Next move) after each one and the cube on screen copies you, so you can check you’re in step.'),
        drill ? h('p', { class: 'small m-0' }, 'This leaves everything before ' + theStage(P.stage) + ' already done, so you can practise just that stage.') : null,
        h('div', { class: 'row row-sm' },
          btn('Ready — my cube matches', { cls: 'btn-primary', icon: 'check', onClick: setupReady, focus: 'ready', kbd: 'Enter' }),
          btn('New scramble', { cls: 'btn-ghost', icon: 'refresh', onClick: newScramble, focus: 'new' })),
        UI.callout('tip', null, 'Lost count? Put the cube back to solved, press New scramble and start again.',
          P.source === 'scramble' && !P.timed ? [' If you can’t get it back to solved, ', h('a', { href: '#/scan' }, 'scan your cube'), ' instead.'] : null)));
      if (P.timed) {
        ui.panel.appendChild(h('section', { class: 'card card-sm stack stack-sm' },
          h('h3', { class: 'h4 m-0' }, 'Then the clock'),
          h('p', { class: 'small m-0' }, settings.inspection !== false
            ? 'After Ready you get 15 seconds to look at the cube. Press Space to start the timer, and Space again to stop.'
            : 'After Ready, press Space to start the timer and Space again to stop.'),
          settings.splitTaps !== false && !drill ? h('p', { class: 'small muted m-0' }, 'Split taps are on: press Space as you finish each stage to time it.') : null));
        return;
      }
      var ids = drill ? [P.stage] : STAGE_IDS;
      ui.panel.appendChild(h('section', { class: 'card card-sm stack stack-sm', 'aria-label': 'How I’ll help' },
        h('h3', { class: 'h4 m-0' }, 'How I’ll help this time'),
        h('ul', { class: 'cc-solve-preview' }, ids.map(function (id) {
          return h('li', null, h('span', null, stageMeta(id).name), levelBadge(levelForStage(id)));
        })),
        h('p', { class: 'xsmall subtle m-0' }, 'Help drops as you get better at each stage.')));
    }

    function bigTimerCard(inPanel) {
      var cls = S.phase === 'inspect' ? 'is-inspecting' : S.phase === 'solving' ? 'is-running' : '';
      ui.big = h('div', { class: ['timer', cls], role: 'timer', 'aria-live': 'off' }, timerText());
      ui.bigLabel = h('p', { class: 'timer__label' }, timerLabel());
      return h('section', { class: ['card', 'cc-solve-timercard', inPanel ? 'cc-solve-timercard--panel' : null], 'aria-label': 'Timer' }, ui.big, ui.bigLabel);
    }

    function timerText() {
      if (S.phase === 'inspect') return String(Math.max(0, Math.ceil((INSPECTION_MS - (nowMs() - S.inspectStart)) / 1000)));
      if (S.phase === 'ready') return UI.fmtTime(0);
      return UI.fmtTime(S.total.ms());
    }

    function timerLabel() {
      var cur = stageObj();
      if (S.phase === 'ready') {
        if (P.virtual) return settings.inspection !== false ? 'Inspect the cube — the timer starts with your first turn' : 'The timer starts with your first turn';
        return settings.inspection !== false ? 'Press Space to start 15 seconds of inspection' : 'Press Space to start the timer';
      }
      if (S.phase === 'inspect') return P.virtual ? 'Inspection — the timer starts with your first turn' : 'Inspection — press Space to start the timer';
      if (P.virtual) return cur ? 'Now: ' + stageMeta(cur.id).name : '';
      if (settings.splitTaps !== false && P.source !== 'drill' && cur) return 'Now: ' + stageMeta(cur.id).name + ' — Space when it’s done';
      return 'Press Space to stop';
    }

    function renderTimedCard() {
      if (!ui.timedCard) return;
      UI.empty(ui.timedCard);
      if (!P.timed || P.virtual || (S.phase !== 'ready' && S.phase !== 'inspect' && S.phase !== 'solving')) return;
      ui.timedCard.appendChild(bigTimerCard(false));
    }

    function panelTimed() {
      var cur = stageObj();
      var phase = S.phase;
      if (P.virtual && (phase === 'ready' || phase === 'inspect' || phase === 'solving')) ui.panel.appendChild(bigTimerCard(true));
      var doneList = STAGE_IDS.filter(function (id) { return S.rec[id] && S.rec[id].done; });
      var showTrack = P.virtual || settings.splitTaps !== false;
      ui.stage = phase === 'solving' && showTrack ? h('span', { class: 'tabular' }, UI.fmtTime(S.stageClock.ms())) : null;
      ui.panel.appendChild(h('section', { class: 'card card-sm stack stack-sm', 'aria-label': 'Stages' },
        showTrack ? UI.stageTrack(phase === 'solving' && cur ? cur.id : null, doneIds()) : h('p', { class: 'small muted m-0' }, 'Split taps are off, so I’ll just time the whole solve.'),
        ui.stage && cur ? h('p', { class: 'm-0' }, h('span', { class: 'muted' }, 'Now: '), h('strong', null, stageMeta(cur.id).name), ' · ', ui.stage) : null,
        doneList.length ? h('ol', { class: 'list-plain cc-solve-splitlist', 'aria-label': 'Splits' }, doneList.map(function (id) {
          return h('li', { class: 'row row-between' }, h('span', null, stageMeta(id).name), h('span', { class: 'tabular' }, S.splits[id] != null ? UI.fmtTime(S.splits[id]) : '—'));
        })) : null));
      var acts = h('div', { class: 'row row-sm' });
      if (!P.virtual) {
        if (phase === 'ready') acts.appendChild(btn(settings.inspection !== false ? 'Start inspection' : 'Start timer', { cls: 'btn-primary btn-lg', icon: 'timer', onClick: timedSpace, focus: 'timed-main', kbd: 'Space' }));
        else if (phase === 'inspect') acts.appendChild(btn('Start solving', { cls: 'btn-primary btn-lg', icon: 'play', onClick: timedSpace, focus: 'timed-main', kbd: 'Space' }));
        else if (phase === 'solving') {
          var splits = settings.splitTaps !== false && P.source !== 'drill' && cur && stageIndex(cur.id) < 7;
          acts.appendChild(btn(splits ? stageMeta(cur.id).short + ' done' : 'Stop', { cls: 'btn-primary btn-lg', icon: splits ? 'check' : 'pause', onClick: timedSpace, focus: 'timed-main', kbd: 'Space' }));
          if (splits) acts.appendChild(btn('Stop — solved', { icon: 'pause', onClick: stopTimed, focus: 'timed-stop' }));
        }
      } else if (phase === 'ready' || phase === 'inspect') {
        acts.appendChild(h('p', { class: 'small muted m-0' }, 'Whole-cube turns (x, y, z) don’t start the clock, so you can look around first.'));
      }
      if (phase === 'solving') acts.appendChild(btn('Give up (DNF)', { cls: 'btn-ghost', icon: 'x', onClick: dnf, focus: 'dnf' }));
      ui.panel.appendChild(h('section', { class: 'card card-sm stack stack-sm', 'aria-label': 'Timer controls' }, acts,
        !P.virtual ? h('p', { class: 'xsmall subtle m-0' }, 'Put the cube down, then use Space: start, ' + (settings.splitTaps !== false && P.source !== 'drill' ? 'tap as each stage finishes, ' : '') + 'stop.') : null));
      if (phase === 'solving') {
        var hc = hintCard();
        if (hc) ui.panel.appendChild(hc);
      }
    }

    // ---------------------------------------------------------------- ticker
    function startTicker() { if (!ticker) ticker = setInterval(tick, 47); }
    function stopTicker() { if (ticker) clearInterval(ticker); ticker = 0; }
    function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
    function tick() {
      if (destroyed) return;
      if (ui.total) setText(ui.total, UI.fmtTime(S.total.ms()));
      if (ui.stage) setText(ui.stage, UI.fmtTime(S.stageClock.ms()));
      if (ui.big) setText(ui.big, timerText());
      if (S.phase === 'inspect') {
        var left = INSPECTION_MS - (nowMs() - S.inspectStart);
        if (ui.big) ui.big.classList.toggle('is-holding', left <= 3000);
        if (left <= 0) startTimedSolve(true);
      }
    }

    // ---------------------------------------------------------------- setup (scrambles)
    function learnFrame() {
      var pre = (Lessons && Lessons.LEARNING_FRAME && Lessons.LEARNING_FRAME.prefix) || 'z2';
      return Cube.applyAlg(Cube.solved(), pre);
    }

    function makeScramble() {
      if (P.source === 'drill') {
        var d = Solver.drillScramble(P.stage, S.scramble ? null : P.seed);
        S.scramble = d.scramble.slice();
        S.setupBase = learnFrame();
        S.frame = 'learning';
        S.startState = d.state.slice();
        return;
      }
      S.scramble = (!S.scramble && P.scramble) ? P.scramble.slice() : Cube.scramble(20);
      S.frame = P.virtual ? 'learning' : 'standard';
      S.setupBase = P.virtual ? learnFrame() : Cube.solved();
      S.startState = Cube.applyAlg(S.setupBase, S.scramble);
    }

    function setupNext() {
      if (S.phase !== 'setup' || S.setupIdx >= S.scramble.length || pending > 1) return;
      active();
      var tok = S.scramble[S.setupIdx++];
      animate([tok]);
      refresh();
    }
    function setupBack() {
      if (S.phase !== 'setup' || S.setupIdx <= 0 || pending) return;
      active();
      S.setupIdx--;
      animate([Cube.invertMove(S.scramble[S.setupIdx])]);
      refresh();
    }
    function setupAll() {
      if (S.phase !== 'setup' || pending || S.setupIdx >= S.scramble.length) return;
      active();
      var from = S.setupIdx;
      animate(S.scramble.slice(from), { speed: Math.max(3, S.speed * 2), onMove: function (i) { if (S.phase === 'setup') { S.setupIdx = from + i + 1; renderMoveArea(); } } })
        .then(function () { if (S.phase === 'setup') refresh(); });
      refresh();
    }
    function newScramble() {
      if (S.phase !== 'setup') return;
      active();
      cancelView();
      try { makeScramble(); } catch (e) { showProblem(e); return; }
      S.setupIdx = 0;
      view.setState(S.setupBase);
      toast('New scramble ready.');
      refresh();
    }
    function setupReady() {
      if (S.phase !== 'setup') return;
      active();
      cancelView();
      view.setState(S.startState);
      afterSetup();
    }
    function afterSetup() {
      if (P.timed) timedReady(); else startSolving(S.startState);
    }

    function scrambleVirtual() {
      S.phase = 'scrambling';
      view.setState(S.setupBase);
      renderHead();
      refresh();
      var hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (UI.reducedMotion() || hidden) { view.setState(S.startState); afterSetup(); return; }
      setStatus('Scrambling…');
      var finished = false;
      function done() {
        if (finished || destroyed) return;
        finished = true;
        setStatus(null);
        cancelView();
        view.setState(S.startState);
        afterSetup();
      }
      later(function () { animate(S.scramble, { speed: 5 }).then(done); }, 300);
      later(done, 300 + S.scramble.length * 120 + 1500);   // safety net (e.g. the tab is in the background)
    }

    // ---------------------------------------------------------------- start
    function begin() {
      build();
      if (!Cube || !Solver) { showProblem(new Error('The cube solver didn’t load. Reload the page to try again.')); return; }
      renderHead();
      if (P.source === 'scan') {
        if (!P.state) { showNoState(); return; }
        S.startState = P.state.slice();
        view.setState(S.startState);
        afterSetup();
        return;
      }
      try { makeScramble(); } catch (e) { showProblem(e); return; }
      if (P.virtual) {
        renderPad();
        if (P.source === 'drill') { view.setState(S.startState); afterSetup(); }
        else scrambleVirtual();
        return;
      }
      S.phase = 'setup';
      S.setupIdx = 0;
      view.setState(S.setupBase);
      renderHead();
      refresh();
    }

    function startSolving(state) {
      var plan;
      try { plan = Solver.solve(state, solveOpts()); } catch (err) { showInvalid(err); return; }
      S.plan = plan; S.planGen++;
      S.trust = true;
      S.startState = state.slice();
      var si = firstActiveStage(plan, 0);
      if (si >= 8) { showAlreadySolved(); return; }
      S.initialDone = STAGE_IDS.slice(0, si);
      S.phase = 'solving';
      view.setState(state);
      if (P.virtual) renderPad();
      S.total.reset();
      S.total.start();
      startTicker();
      enterStage(si);
      renderHead();
      refresh();
      announce('Stage ' + (si + 1) + ': ' + stageMeta(STAGE_IDS[si]).name + '.');
    }

    // ---------------------------------------------------------------- stages & steps
    function enterStage(si, opts) {
      opts = opts || {};
      S.si = si;
      if (si >= 8 || (P.source === 'drill' && si > stageIndex(P.stage))) { finish(true); return; }
      var stg = S.plan.stages[si], id = stg.id;
      var rec = S.rec[id];
      if (!rec) rec = ensureRec(id);
      else if (rec.done) { rec.done = false; rec.free = false; delete S.splits[id]; }   // reopened
      S.level = rec.level;
      startStageClock();
      S.hintLevel = 0; S.hints = []; S.hintsUsed = 0; S.hintKey = null; S.drop = null; S.offPlan = false; S.partial = null;
      S.note = opts.note || null;
      S.gate = (!P.virtual && !P.timed && S.level >= 2 && S.prevSelfSolved && !opts.noGate) ? 'rescan' : null;
      S.knownState = stg.startState.slice();
      S.knownLabel = 'this stage started';
      S.stageStartActual = P.virtual ? view.getState() : stg.startState.slice();
      S.pop = !!opts.pop;
      S.hlKey = null;
      enterStep(0);
    }

    function enterStep(pi, opts) {
      opts = opts || {};
      S.pi = pi;
      S.mi = opts.at || 0;
      S.partial = null;
      if (!opts.keepReveal) S.revealed = false;
      var step = stepObj();
      S.trail = step ? trailOf(Cube, step) : null;
      S.quiz = null;
      S.hlKey = null;
      if (step && step.quiz && !P.timed && !S.gate && !opts.noQuiz && !S.quizDone[stepKey(step)] &&
          (S.level === 2 || (S.level === 3 && settings.anticipate !== false))) {
        S.quiz = { key: stepKey(step), quiz: step.quiz, answered: false, choice: -1, right: false };
      }
    }

    function completeStep() {
      var stg = stageObj();
      if (stg && S.pi + 1 < stg.steps.length) enterStep(S.pi + 1);
      else completeStage();
    }

    function markFree(id) {
      if (S.rec[id] && S.rec[id].done) return;
      var r = ensureRec(id);
      r.done = true; r.free = true;
    }

    function completeStage(opts) {
      opts = opts || {};
      var stg = stageObj();
      if (!stg || S.finished) return;
      var id = stg.id, rec = ensureRec(id), idx = stageIndex(id);
      rec.ms += S.stageClock.ms();
      S.stageClock.reset();
      rec.done = true;
      if (opts.free) rec.free = true;
      if (!rec.free) S.splits[id] = Math.round(rec.ms);
      S.lastDone = id;
      S.prevSelfSolved = !P.virtual && !P.timed && rec.level <= 1 && !opts.scanned && !rec.free;
      if (S.prevSelfSolved) S.trust = false;
      var next;
      if (P.virtual) {
        var plan = solveSafe(view.getState());
        if (plan) { S.plan = plan; S.planGen++; }
        next = Math.max(idx + 1, firstActiveStage(S.plan, 0));
      } else if (S.trust && !P.timed) next = firstActiveStage(S.plan, idx + 1);
      else next = idx + 1;   // timed / self-solved: the learner's cube follows their own moves, not my plan
      for (var k = idx + 1; k < Math.min(next, 8); k++) {
        if (P.timed) { var r = ensureRec(STAGE_IDS[k]); r.done = true; } else markFree(STAGE_IDS[k]);
      }
      celebrate(id, rec);
      if (P.source === 'drill' && idx >= stageIndex(P.stage)) { finish(true); return; }
      if (next >= 8) { finish(true); return; }
      enterStage(next, { pop: true });
      S.history = [];
    }

    function celebrate(id, rec) {
      if (P.timed || rec.free) return;
      var name = stageMeta(id).name;
      var t = UI.fmtTime(rec.ms);
      toast(name + ' done in ' + t + '.', { kind: 'success' });
      announce(name + ' done in ' + t + '.');
    }

    // ---------------------------------------------------------------- physical: Show / Coach
    function canStep() {
      return !P.virtual && showingMoves() && !S.quiz && !S.playing && !S.demo && !S.overlay && !S.stepEnding;
    }

    function nextMove() {
      if (!canStep() || pending > 1) return;
      var step = stepObj();
      if (!step || S.mi >= step.moves.length) return;
      active();
      S.note = null;
      var tok = step.moves[S.mi];
      S.mi++;
      animate([tok]);
      if (S.mi >= step.moves.length) {
        S.stepEnding = true;
        whenIdle(function () {
          S.stepEnding = false;
          if (stepObj() === step && S.mi >= step.moves.length) completeStep();
          refresh();
        });
      }
      refresh();
      announce(tok + ': ' + moveText(tok));
    }

    function backMove() {
      if (!canStep() || pending) return;
      var step = stepObj();
      if (!step) return;
      active();
      if (S.mi > 0) {
        S.mi--;
        animate([Cube.invertMove(step.moves[S.mi])]);
      } else if (S.pi > 0) {
        var prev = stageObj().steps[S.pi - 1];
        enterStep(S.pi - 1, { at: prev.moves.length - 1, noQuiz: true, keepReveal: S.level === 2 });
        if (S.level === 2) S.revealed = true;
        animate([Cube.invertMove(prev.moves[prev.moves.length - 1])]);
      } else return;
      refresh();
    }

    function replayStep() {
      if (!canStep() || pending) return;
      var step = stepObj();
      if (!step) return;
      active();
      var upto = S.mi;
      var toks = upto > 0 ? step.moves.slice(0, upto) : step.moves.slice();
      S.demo = true; S.demoKind = 'replay'; S.demoIdx = 0;
      view.setState(step.startState);
      try { view.highlight(step.focus && step.focus.length ? step.focus : null); } catch (e) { /* ignore */ }
      refresh();
      animate(toks, { onMove: function (i) { S.demoIdx = i + 1; if (S.demo) renderMoveArea(); } }).then(function () {
        function end() {
          S.demo = false;
          S.hlKey = null;
          if (S.phase === 'solving') { view.setState(S.trail ? S.trail[S.mi] : step.startState); refresh(); }
        }
        if (upto > 0) end(); else later(end, 700);
      });
    }

    function playStep() {
      if (!canStep() || pending) return;
      var step = stepObj();
      if (!step || S.mi >= step.moves.length) return;
      active();
      var from = S.mi;
      S.playing = true;
      refresh();
      animate(step.moves.slice(from), { onMove: function (i) { if (stepObj() === step) { S.mi = from + i + 1; renderMoveArea(); } } }).then(function () {
        S.playing = false;
        if (destroyed || S.finished) return;
        if (stepObj() === step && S.mi >= step.moves.length) completeStep();
        refresh();
      });
    }

    function doneWithStep() {
      if (P.virtual || !tracking() || S.quiz || S.playing || S.demo || pending || S.stepEnding) return;
      var step = stepObj();
      if (!step) return;
      active();
      var from = S.mi, rest = step.moves.slice(from);
      if (!rest.length) { completeStep(); refresh(); return; }
      S.playing = true;
      refresh();
      animate(rest, { speed: Math.max(2.5, S.speed * 2), onMove: function (i) { if (stepObj() === step) S.mi = from + i + 1; } }).then(function () {
        S.playing = false;
        if (destroyed || S.finished) return;
        if (stepObj() === step) completeStep();
        refresh();
      });
    }

    function revealMoves() {
      if (S.phase !== 'solving' || S.level !== 2 || S.revealed || S.quiz) return;
      active();
      if (P.virtual && (S.offPlan || S.drop)) {
        var plan = solveSafe(view.getState());
        if (plan && firstActiveStage(plan, 0) === S.si) adoptPlan(plan, {});
      }
      var rec = curRec();
      if (rec) { rec.hints++; rec.reveals++; }
      S.revealed = true;
      S.note = null;
      refresh();
      announce('Moves shown for this step.');
    }

    function stageDonePressed() {
      if (P.virtual || P.timed || S.phase !== 'solving' || S.level >= 2) return;
      active();
      completeStage();
      refresh();
    }

    // ---------------------------------------------------------------- quiz
    function answerQuiz(i) {
      var q = S.quiz;
      if (!q || q.answered) return;
      active();
      q.answered = true;
      q.choice = i;
      q.right = i === q.quiz.answer;
      var rec = curRec();
      if (rec) { rec.quizTotal++; if (q.right) rec.quizRight++; }
      refresh();
      announce(q.right ? 'Right!' : 'Not quite. The answer is ' + q.quiz.options[q.quiz.answer] + '.');
      var b = el.querySelector('[data-focus="quiz-continue"]');
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    function finishQuiz() {
      if (!S.quiz) return;
      active();
      S.quizDone[S.quiz.key] = true;
      S.quiz = null;
      S.hlKey = null;
      refresh();
    }
    function skipQuiz() { finishQuiz(); }

    // ---------------------------------------------------------------- virtual cube
    function learnerMove(tok) {
      if (destroyed) return;
      active();
      if (!canTurn()) {
        if (S.quiz) toast('Answer the question first — or press Skip.');
        return;
      }
      try { view.userMove(tok); } catch (e) { console.error(e); }
    }

    function doForMe() {
      if (!P.virtual || !showingMoves() || S.quiz || pending || view.isBusy()) return;
      if (S.drop && S.history.length) { undo(); return; }   // the arrow shows the undo move
      var step = stepObj();
      var tok = S.partial ? S.partial.remaining : (step && step.moves[S.mi]);
      if (!tok) return;
      active();
      animate([tok], { onMove: function (i, t) { onCommit(t, 'auto'); } });
    }

    function undo() {
      if (!P.virtual || S.finished || !S.history.length) return;
      if (S.phase !== 'solving' && !(P.timed && (S.phase === 'ready' || S.phase === 'inspect'))) return;
      if (pending || view.isBusy()) return;
      active();
      var tok = S.history[S.history.length - 1];
      animate([Cube.invertMove(tok)], { onMove: function (i, t) { onCommit(t, 'undo'); } });
    }

    function resetStage() {
      if (!P.virtual || S.phase !== 'solving' || !S.stageStartActual) return;
      active();
      cancelView();
      view.setState(S.stageStartActual);
      S.history = [];
      var plan = solveSafe(S.stageStartActual);
      if (plan) adoptPlan(plan, {});
      S.note = { kind: 'info', text: 'Back to how the cube was at the start of this stage.' };
      refresh();
    }

    // Called (synchronously) every time a move is committed on the virtual cube.
    function onCommit(tok, kind) {
      if (destroyed || S.mute || !P.virtual) return;
      active();
      if (kind === 'undo') S.history.pop();
      else { S.history.push(tok); if (S.history.length > 500) S.history.shift(); }
      var st = view.getState();
      if (P.timed) { timedCommit(tok, st); return; }
      if (S.phase !== 'solving') return;
      S.note = null;
      if (!followPlan(st, kind)) offTrail(st, kind);
      scheduleIdle();
      refresh();
      // A drag / pad / key move commits while the view still counts as busy, so refresh() can't put
      // up the arrow for the next move yet: do it once the view has finished this move.
      if (kind === 'user') Promise.resolve().then(function () { if (!destroyed && !S.finished) updateArrow(); });
    }

    function followPlan(st, kind) {
      var step = stepObj(), stg = stageObj();
      if (!step || !S.trail || S.level < 2 || !stg) return false;
      if (S.offPlan || S.drop) {
        if (sameState(st, S.trail[S.mi])) { S.offPlan = false; S.drop = null; S.partial = null; return true; }
        for (var k = S.pi; k < stg.steps.length; k++) {
          if (sameState(st, stg.steps[k].startState)) { enterStep(k, { noQuiz: k === S.pi }); S.offPlan = false; S.drop = null; return true; }
        }
        if (stg.endState && sameState(st, stg.endState)) { completeStage(); return true; }
        var back = partialOf(Cube, S.trail[S.mi], step.moves[S.mi], st);
        if (back) { S.offPlan = false; S.drop = null; S.partial = back; return true; }
        return false;
      }
      if (sameState(st, S.trail[S.mi + 1])) {
        S.mi++;
        S.partial = null;
        if (S.mi >= step.moves.length) completeStep();
        return true;
      }
      if (sameState(st, S.trail[S.mi])) { S.partial = null; return true; }
      // The move pad and keys only turn quarter turns, so "U" when U2 is asked for is the first half
      // of it — even when it also happens to undo the move before (…U' then U2). Only Undo goes back.
      var part = kind !== 'undo' ? partialOf(Cube, S.trail[S.mi], step.moves[S.mi], st) : null;
      if (part) { S.partial = part; return true; }
      if (S.mi > 0 && sameState(st, S.trail[S.mi - 1])) { S.mi--; S.partial = null; return true; }
      // Half of the last move undone (U2 then Undo / U'): back to "finish the move".
      var half = S.mi > 0 ? partialOf(Cube, S.trail[S.mi - 1], step.moves[S.mi - 1], st) : null;
      if (half) { S.mi--; S.partial = half; return true; }
      if (S.mi === 0 && S.pi > 0) {
        var prev = stg.steps[S.pi - 1], ptr = trailOf(Cube, prev), last = prev.moves.length - 1;
        if (sameState(st, ptr[ptr.length - 2])) {
          enterStep(S.pi - 1, { at: last, noQuiz: true, keepReveal: true });
          return true;
        }
        half = partialOf(Cube, ptr[ptr.length - 2], prev.moves[last], st);
        if (half) {
          enterStep(S.pi - 1, { at: last, noQuiz: true, keepReveal: true });
          S.partial = half;
          return true;
        }
      }
      if (kind === 'undo') {
        part = partialOf(Cube, S.trail[S.mi], step.moves[S.mi], st);
        if (part) { S.partial = part; return true; }
      }
      return false;
    }

    function offTrail(st, kind) {
      var stg = stageObj();
      if (!stg) return;
      var idx = stageIndex(stg.id);
      var prog = progressOf(st);
      if (prog.index > idx) { completeStage(); return; }
      S.partial = null;
      if (S.level <= 1) { if (S.drop && prog.index >= idx) S.drop = null; return; }
      if (S.level === 3 || S.revealed) deviate(st, kind);
      else S.offPlan = true;
    }

    // A guided learner went another way: re-plan, unless that would send them back a stage
    // (usually they are mid-algorithm) — then offer Undo first.
    function deviate(st, kind) {
      var plan = solveSafe(st);
      if (!plan) return;
      var ni = firstActiveStage(plan, 0);
      if (ni < S.si) { S.drop = { stage: STAGE_IDS[ni], plan: plan }; S.offPlan = true; return; }
      adoptPlan(plan, { keepReveal: true });
      if (kind !== 'undo') S.note = { kind: 'info', text: 'No problem — you went a different way, so I’ve re-planned from where your cube is now.' };
    }

    function acceptDrop() {
      if (!S.drop || !S.drop.plan) return;
      active();
      var plan = S.drop.plan;
      adoptPlan(plan, {});
      refresh();
    }

    function scheduleIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdle, IDLE_MS);
    }
    function onIdle() {
      idleTimer = 0;
      if (destroyed || S.phase !== 'solving' || !P.virtual || P.timed) return;
      if (pending || view.isBusy()) { scheduleIdle(); return; }
      var st = view.getState(), stg = stageObj();
      if (!stg) return;
      var idx = stageIndex(stg.id);
      if (S.level === 2 && !S.revealed && S.offPlan && !S.drop) {
        var plan = solveSafe(st);
        if (plan) {
          var ni = firstActiveStage(plan, 0);
          if (ni < S.si) S.drop = { stage: STAGE_IDS[ni], plan: plan };
          else { adoptPlan(plan, {}); S.note = { kind: 'info', text: 'I’ve updated the plan from where your cube is now.' }; }
        }
      } else if (S.level <= 1) {
        var prog = progressOf(st);
        S.drop = prog.index < idx ? { stage: prog.id, plan: null } : null;
      } else return;
      refresh();
    }

    // Replace the plan (after a rescan, a deviation or a reset) and move the session to its first stage.
    function adoptPlan(plan, opts) {
      opts = opts || {};
      var keepReveal = !!opts.keepReveal && S.revealed;
      S.plan = plan;
      S.planGen++;
      S.drop = null; S.offPlan = false; S.partial = null;
      var ni = firstActiveStage(plan, 0);
      if (ni > S.si) { completeStage({ scanned: !!opts.scanned }); return 'ahead'; }
      if (ni < S.si) {
        var cur = curRec();
        if (cur) cur.ms += S.stageClock.ms();
        enterStage(ni, { noGate: true });
        return 'back';
      }
      S.gate = null;
      enterStep(0, { keepReveal: keepReveal });
      return 'same';
    }

    // ---------------------------------------------------------------- physical: rescans & hints
    function doRescan(reason) {
      if (!scanAvailable()) {
        return App.modal({
          title: 'Rescanning isn’t available',
          body: 'The camera scanner isn’t available right now. If you haven’t moved since the cube on screen, just carry on from here.',
          actions: [{ label: 'I haven’t moved', primary: true }]
        }).then(function () { return false; });
      }
      var titles = { lost: 'Show me your cube', hint: 'Rescan for an exact hint', gate: 'Show me your cube so I can guide the next stage' };
      S.overlay = true;
      if (!P.timed) pauseClocks();
      setArrow(null);
      var p;
      try { p = Promise.resolve(CCx().ScanUI.open({ purpose: 'rescan', title: titles[reason] || titles.lost })); } catch (e) { p = Promise.reject(e); }
      return p.then(function (state) {
        S.overlay = false;
        if (!P.timed) resumeClocks();
        if (destroyed || S.finished) return false;
        if (!state) { refresh(); return false; }
        var out = replanPhysical(state);
        refresh();
        return out;
      }, function (err) {
        S.overlay = false;
        if (!P.timed) resumeClocks();
        console.error(err);
        toast('The scanner hit a problem: ' + ((err && err.message) || 'unknown error'), { kind: 'error' });
        if (!destroyed) refresh();
        return false;
      });
    }

    function replanPhysical(state) {
      var plan;
      try { plan = Solver.solve(state, solveOpts()); } catch (err) {
        var msg = (err && err.validation && err.validation.errors && err.validation.errors[0] && err.validation.errors[0].message) || (err && err.message) || '';
        App.modal({ title: 'That scan doesn’t add up', body: (msg ? msg + '\n\n' : '') + 'Usually one sticker was read as the wrong colour. Try scanning again in even light.', actions: [{ label: 'OK', primary: true }] });
        return false;
      }
      S.trust = true;
      S.prevSelfSolved = false;
      var before = S.si;
      var out = adoptPlan(plan, { scanned: true });
      var undone = brokenStage(STAGE_IDS[S.si], before);
      if (S.finished) return out;
      S.knownState = state.slice();
      S.knownLabel = 'your last scan';
      if (S.hintLevel >= 3) { S.hintLevel = 0; S.hints = []; }   // a fresh look at the cube: fresh hints
      cancelView();
      whenIdle(function () { resync(); });
      if (out === 'ahead') toast('Nice — you’re further on than I thought. On to ' + theStage(stageId()) + '.', { kind: 'success' });
      else if (out === 'back') toast('Part of ' + theStage(undone) + ' has come undone — let’s fix that first' + (undone !== STAGE_IDS[S.si] ? ', starting from the daisy.' : '.'), { kind: 'warn' });
      else toast('Got it — I’ve re-planned from your cube.');
      if (before !== S.si) S.history = [];
      return out;
    }

    function skipGate() {
      active();
      S.gate = null;
      S.trust = true;
      enterStep(0);
      refresh();
    }

    function lost() {
      if (P.virtual || S.phase !== 'solving') return;
      active();
      doRescan('lost');
    }

    function hintStepFrom(plan, si, pi) {
      var stg = plan && plan.stages[si];
      if (!stg) return null;
      var steps = stg.steps, k = pi || 0, pre = [];
      if (k >= steps.length) return null;
      var start = steps[k].startState;
      while (k < steps.length && steps[k].kind === 'rotate') { pre = pre.concat(steps[k].moves); k++; }
      if (k >= steps.length) return null;
      return { step: steps[k], rotateFirst: pre.length > 0, pre: pre, stageId: stg.id, start: start };
    }
    function hintFromState(st) {
      var plan = solveSafe(st);
      if (!plan) return null;
      var ni = firstActiveStage(plan, 0);
      var hs = hintStepFrom(plan, ni, 0);
      if (hs && ni < S.si) { hs.fix = hs.stageId; hs.from = S.si; }
      return hs;
    }

    function giveHint(level, hs) {
      var id = (hs && hs.stageId) || stageId();
      var item;
      if (hs && hs.step) {
        var ladder = [];
        try { ladder = Coach && Coach.hintLadder ? Coach.hintLadder(hs.step) : []; } catch (e) { ladder = []; }
        item = ladder[level - 1] || { text: hs.step.title, moves: hs.step.moves };
      } else {
        var lh = stageMeta(id).hints;
        item = { text: lh[level - 1] || lh[lh.length - 1] || ('Goal: ' + stageMeta(id).goal) };
      }
      S.hintLevel = level;
      S.hintsUsed = (S.hintsUsed || 0) + 1;
      S.hintKey = hintKeyOf(hs);
      var rec = (P.timed && !P.virtual && settings.splitTaps === false) ? ensureRec(id) : (curRec() || ensureRec(id));
      rec.hints++;
      S.hints.push({
        level: level, text: item.text, generic: !(hs && hs.step) && level > 1,
        moves: level >= 3 && hs && hs.step ? (item.moves || hs.step.moves).slice() : null,
        pre: level >= 3 && hs ? (hs.pre || []) : [], rotateFirst: !!(hs && hs.rotateFirst), fix: hs && hs.fix ? hs.fix : null, from: hs && hs.from,
        start: hs && hs.start ? hs.start : null
      });
      refresh();
      announce(HINT_LABEL[level] + ': ' + item.text);
      var n = el.querySelector('[data-focus="hint-last"]');
      if (n && n.scrollIntoView) { try { n.scrollIntoView({ block: 'nearest', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
    }

    function askForHint() {
      var can = scanAvailable();
      var body, actions;
      if (!P.timed && S.trust) {
        body = 'Have you turned the cube since ' + S.knownLabel + '?' +
          (can ? '' : ' (Rescanning isn’t available right now, so if you have, I can only give you a general hint.)');
        actions = [{ label: can ? 'Yes — rescan it' : 'Yes', value: can ? 'rescan' : 'general' }, { label: 'No, I haven’t', primary: true, value: 'plan' }];
      } else {
        body = P.timed ? 'For an exact hint I need to see your cube (the clock keeps running).' : 'You solved the last stage your own way, so I can’t be sure how your cube looks now.';
        actions = [{ label: 'General hint', value: 'general' }, { label: 'Rescan my cube', primary: true, value: 'rescan' }];
      }
      return App.modal({ title: 'Quick check', body: body, actions: actions.map(function (a) { return { label: a.label, primary: a.primary }; }) })
        .then(function (label) {
          if (!label) return null;
          for (var i = 0; i < actions.length; i++) if (actions[i].label === label) return actions[i].value;
          return null;
        });
    }

    // On the virtual cube the ladder starts again once the exact-moves hint has been used up and the
    // learner has moved on to another piece (a stage like the corners has four).
    function moreHints() { return P.virtual && S.hintLevel >= 3; }
    function hintKeyOf(hs) { return hs && hs.step ? hs.step.startState.join('') + '|' + hs.step.moves.join(' ') : null; }
    function requestHint() {
      if (!hintAllowed() || (S.hintLevel >= 3 && !moreHints())) return;
      active();
      if (P.virtual) {
        var hs = hintFromState(view.getState());
        if (S.hintLevel >= 3) {
          if (!hs || !hs.step || hintKeyOf(hs) === S.hintKey) { toast('The last hint still applies — make its moves, or press “Do these moves for me”.'); return; }
          S.hintLevel = 0; S.hints = [];
        }
        giveHint(S.hintLevel + 1, hs);
        return;
      }
      var level = S.hintLevel + 1;
      if (level === 1) { giveHint(1, null); return; }
      if ((P.timed || !S.trust) && !scanAvailable()) { giveHint(level, null); return; }
      S.hintBusy = true;
      refresh();
      askForHint().then(function (ans) {
        S.hintBusy = false;
        if (destroyed || S.finished) return;
        if (ans === 'plan') giveHint(level, hintStepFrom(S.plan, S.si, S.pi));
        else if (ans === 'general') giveHint(level, null);
        else if (ans === 'rescan') {
          doRescan('hint').then(function (out) {
            if (!out || destroyed || S.finished || out === 'ahead') { refresh(); return; }
            if (P.timed || S.level <= 1) giveHint(level, hintStepFrom(S.plan, S.si, S.pi));
            else refresh();
          });
          return;
        }
        refresh();
      });
    }

    // Real cube: play the hint's exact moves on the 3D cube, from the state the hint was worked out from.
    function demoHint(ht) {
      if (P.virtual || pending || S.demo || !ht.moves) return;
      active();
      var start = ht.start || S.knownState;
      S.demo = true;
      S.demoKind = 'hint';
      setArrow(null);
      try { view.highlight(null); } catch (e) { /* ignore */ }
      view.setState(start);
      refresh();
      animate((ht.pre || []).concat(ht.moves)).then(function () {
        later(function () {
          S.demo = false;
          S.hlKey = null;
          if (S.phase === 'solving') { view.setState(expectedView() || start); refresh(); }
        }, 900);
      });
    }

    function doHintMoves(ht) {
      if (!P.virtual || pending || view.isBusy() || !ht.moves) return;
      active();
      var moves = (ht.pre || []).concat(ht.moves);
      // Only valid from the state the hint was made for.
      var hs = hintFromState(view.getState());
      if (!hs || !hs.step || hs.step.moves.join(' ') !== ht.moves.join(' ')) {
        toast('Your cube has changed since that hint — ask for a fresh one.');
        return;
      }
      animate(moves, { onMove: function (i, t) { onCommit(t, 'auto'); } });
    }

    // ---------------------------------------------------------------- timed mode
    function timedReady() {
      var plan;
      try { plan = Solver.solve(S.startState, solveOpts()); } catch (err) { showInvalid(err); return; }
      S.plan = plan; S.planGen++;
      S.trust = true;
      var si = firstActiveStage(plan, 0);
      if (si >= 8) { showAlreadySolved(); return; }
      S.si = si;
      S.initialDone = STAGE_IDS.slice(0, si);
      S.level = 0;
      S.knownState = S.startState.slice();
      view.setState(S.startState);
      if (P.virtual) renderPad();
      S.phase = 'ready';
      startTicker();
      if (P.virtual && settings.inspection !== false) { S.phase = 'inspect'; S.inspectStart = nowMs(); }
      renderHead();
      refresh();
    }

    function startTimedSolve(auto) {
      if (S.phase !== 'ready' && S.phase !== 'inspect') return;
      S.phase = 'solving';
      S.total.reset();
      S.total.start();
      enterStage(S.si);
      if (auto) toast('Inspection over — go!');
      renderHead();
      refresh();
    }

    function timedSpace() {
      if (P.virtual) return;
      active();
      if (S.phase === 'ready') {
        if (settings.inspection !== false) { S.phase = 'inspect'; S.inspectStart = nowMs(); refresh(); }
        else startTimedSolve(false);
      } else if (S.phase === 'inspect') startTimedSolve(false);
      else if (S.phase === 'solving') {
        var cur = stageObj();
        if (settings.splitTaps !== false && P.source !== 'drill' && cur && stageIndex(cur.id) < 7) { completeStage(); refresh(); }
        else stopTimed();
      }
    }

    function stopTimed() {
      if (S.phase !== 'solving') return;
      active();
      finish(true);
    }

    function dnf() {
      if (S.phase !== 'solving') return;
      App.modal({
        title: 'Stop and record a DNF?',
        body: 'The solve is saved as not finished (DNF). Any stages you’ve finished still count.',
        actions: [{ label: 'Record DNF', danger: true }, { label: 'Keep going', primary: true }]
      }).then(function (l) { if (l === 'Record DNF' && !S.finished) finish(false); });
    }

    function timedCommit(tok, st) {
      if (S.phase === 'ready' || S.phase === 'inspect') {
        if (isRot(tok)) return;
        startTimedSolve(false);
      }
      if (S.phase !== 'solving') return;
      var prog = progressOf(st), guard = 0;
      while (!S.finished && stageObj() && prog.index > stageIndex(stageId()) && guard++ < 9) {
        var idx = stageIndex(stageId());
        var rec = ensureRec(stageId());
        rec.ms += S.stageClock.ms();
        S.stageClock.reset();
        S.stageClock.start();
        rec.done = true;
        S.splits[stageId()] = Math.round(rec.ms);
        if (P.source === 'drill' && idx >= stageIndex(P.stage)) { finish(true); return; }
        for (var k = idx + 1; k < Math.min(prog.index, 8); k++) ensureRec(STAGE_IDS[k]).done = true;
        if (prog.index >= 8) { finish(true); return; }
        S.si = prog.index;
        ensureRec(STAGE_IDS[S.si]);
        S.hintLevel = 0; S.hints = []; S.hintsUsed = 0; S.hintKey = null;
      }
      if (!S.finished && Cube.isSolved(st)) { finish(true); return; }
      if (!S.finished) refresh();
    }

    // ---------------------------------------------------------------- pause, leave
    function openPause() {
      if (S.pauseOpen || S.phase !== 'solving' || S.finished) return;
      S.pauseOpen = true;
      pauseClocks();
      syncTurnable();
      var actions = [{ label: 'Leave solve', danger: true }];
      if (!P.virtual && !P.timed) actions.push({ label: 'I’m lost — rescan' });
      actions.push({ label: 'Resume', primary: true });
      App.modal({
        title: 'Paused',
        body: h('div', null,
          h('p', null, 'The clock is stopped at ' + UI.fmtTime(S.total.ms()) + '.'),
          h('p', { class: 'small' }, 'Press Esc or Resume to carry on.')),
        actions: actions
      }).then(function (l) {
        S.pauseOpen = false;
        resumeClocks();
        if (destroyed) return;
        syncTurnable();
        if (l === 'Leave solve') leave();
        else if (l === 'I’m lost — rescan') lost();
      });
    }

    // leave() goes home; leave({ id, params }) goes there instead (e.g. the Middle Layer Gym).
    // Either way a solve in progress is confirmed first and saved as not finished.
    function leave(dest) {
      active();
      var toGym = !!(dest && dest.id === 'gym');
      var to = dest && typeof dest.id === 'string' ? dest : { id: 'home', params: {} };
      var go = toGym ? 'Go to the gym' : 'Leave';
      if (S.phase === 'solving' && !S.finished) {
        var done = doneIds().length - S.initialDone.length;
        pauseClocks();
        App.modal({
          title: toGym ? 'Leave this solve for the gym?' : 'Leave this solve?',
          body: (done > 0 ? 'The solve is saved as not finished. The stages you finished still count toward your progress.' : 'The solve is saved as not finished.') +
            (toGym ? ' When the gym exercises feel easy, start a fresh middle-layer practice from there.' : ''),
          actions: [{ label: go, danger: true }, { label: 'Keep going', primary: true }]
        }).then(function (l) {
          resumeClocks();
          if (l === go && !destroyed && !S.finished) {
            S.leaving = true;
            finish(false, { silent: true });
            App.go(to.id, to.params || {});
          }
        });
        return;
      }
      App.go(to.id, to.params || {});
    }

    // ---------------------------------------------------------------- finish & record
    function finish(completed, opts) {
      opts = opts || {};
      if (S.finished) return S.result;
      S.finished = true;
      var cur = stageObj();
      S.total.stop();
      if (cur && S.rec[cur.id] && !S.rec[cur.id].done) {
        var r = S.rec[cur.id];
        r.ms += S.stageClock.ms();
        if (completed && P.timed) {
          r.done = true;
          // Physical timed solves without split taps only have a total time.
          var timedSplits = P.virtual || P.source === 'drill' || settings.splitTaps !== false;
          if (timedSplits) S.splits[cur.id] = Math.round(r.ms);
        }
      }
      S.stageClock.stop();
      if (completed && P.timed && !P.virtual && P.source !== 'drill') {
        // Stages not split off separately were solved too (at Solo level).
        for (var k = S.si + 1; k < 8; k++) { var rr = ensureRec(STAGE_IDS[k]); rr.done = true; }
      }
      S.totalMs = Math.round(S.total.ms());
      S.phase = 'done';
      stopTicker();
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
      try { S.result = record(!!completed); } catch (e) { console.error('[CC solve] recording failed', e); S.result = { completed: !!completed, totalMs: S.totalMs, stages: [], changes: [], milestones: [], quiz: { right: 0, total: 0 } }; }
      // The finishing move is committed from inside the 3D view's animation frame, and that frame
      // still draws after this returns: tear the view down (renderSummary) only once it has.
      if (!opts.silent && !destroyed) Promise.resolve().then(function () { if (!destroyed) renderSummary(); });
      return S.result;
    }

    function record(completed) {
      var data = App.data;
      var res = { completed: completed, totalMs: S.totalMs, stages: [], changes: [], milestones: [], quiz: { right: 0, total: 0 }, pb: false, first: false, unaided: false, unaidedPb: false };
      var before = null;
      try { before = Coach && Coach.stats ? Coach.stats(data, { device: P.device }) : null; } catch (e) { before = null; }
      var levels = {}, hints = {}, totalHints = 0, allSolo = true;
      // A timed "solve" faster than this is a slip of the timer, not evidence of skill.
      var minMs = (Coach && Coach.PARAMS && Coach.PARAMS.minSolveMs) || 3000;
      res.slip = P.timed && completed && S.totalMs < minMs;
      function addMilestones(list) { (list || []).forEach(function (m) { if (res.milestones.indexOf(m) === -1) res.milestones.push(m); }); }
      STAGE_IDS.forEach(function (id) {
        var r = S.rec[id];
        if (!r) return;
        res.quiz.right += r.quizRight;
        res.quiz.total += r.quizTotal;
        if (!r.done || r.free) return;
        levels[id] = r.level;
        hints[id] = r.hints;
        totalHints += r.hints;
        if (r.level !== 0) allSolo = false;
        var out = null;
        if (Coach && Coach.recordStage && !res.slip) {
          try {
            out = Coach.recordStage(data, id, { level: r.level, hints: r.hints, ms: Math.round(r.ms), quizRight: r.quizRight, quizTotal: r.quizTotal, device: P.device });
          } catch (e) { console.error(e); }
        }
        res.stages.push({ id: id, rec: r, out: out });
        if (out && (out.promoted || out.demoted)) res.changes.push({ id: id, out: out });
        if (out) addMilestones(out.newMilestones);
      });
      var splits = {};
      Object.keys(S.splits).forEach(function (id) { if (S.rec[id] && S.rec[id].done && !S.rec[id].free) splits[id] = S.splits[id]; });
      var solve = {
        at: new Date().toISOString(), device: P.device, source: P.source, stage: P.source === 'drill' ? P.stage : null,
        scramble: S.scramble ? S.scramble.join(' ') : null, totalMs: S.totalMs, splits: splits, levels: levels, hints: hints,
        quiz: { right: res.quiz.right, total: res.quiz.total }, completed: completed
      };
      if (Coach && Coach.recordSolve) {
        try { var sr = Coach.recordSolve(data, solve); addMilestones(sr && sr.newMilestones); } catch (e) { console.error(e); }
      }
      try { App.save(); } catch (e) { console.error(e); }
      res.splits = splits;
      if (completed && P.source !== 'drill' && S.totalMs >= 3000 && before) {
        if (before.best == null) res.first = true;
        else if (S.totalMs < before.best) res.pb = true;
        res.unaided = !P.virtual && totalHints === 0 && allSolo && res.stages.length > 0;
        if (res.unaided && before.unaided && before.unaided.best != null && S.totalMs < before.unaided.best) res.unaidedPb = true;
      }
      res.slowest = slowestOf(splits);
      return res;
    }

    function milestoneInfo(id) {
      var list = (Lessons && Lessons.MILESTONES) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return { id: id, name: id, desc: '' };
    }

    function renderSummary() {
      var r = S.result || { stages: [], changes: [], milestones: [], quiz: { right: 0, total: 0 } };
      teardownCube();
      UI.empty(el);
      var drill = P.source === 'drill';
      var title = r.completed ? (drill ? bare(stageMeta(P.stage).name) + ' done!' : 'Solved!') : 'Saved as not finished';
      var doneRows = STAGE_IDS.filter(function (id) { return S.rec[id] && S.rec[id].done && !S.rec[id].free; });
      var maxMs = 1;
      doneRows.forEach(function (id) { if (r.splits && r.splits[id] > maxMs) maxMs = r.splits[id]; });
      var badges = h('div', { class: 'row row-sm' },
        r.pb ? h('span', { class: 'badge badge-success' }, 'Personal best') : null,
        r.first ? h('span', { class: 'badge badge-accent' }, 'Your first ' + (P.virtual ? 'virtual ' : '') + 'time — the one to beat') : null,
        r.unaided ? h('span', { class: 'badge badge-solid' }, 'Unaided') : null,
        r.unaidedPb ? h('span', { class: 'badge badge-success' }, 'Best unaided time') : null,
        P.timed ? h('span', { class: 'badge' }, 'Timed') : null);
      var table = doneRows.length ? h('table', { class: 'cc-solve-splits' },
        h('caption', { class: 'sr-only' }, 'Time per stage'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Stage'), h('th', { scope: 'col' }, 'Help'), h('th', { scope: 'col' }, 'Hints'),
          h('th', { scope: 'col', class: 'num' }, 'Time'), h('th', { scope: 'col', class: 'cc-solve-col-bar' }, h('span', { class: 'sr-only' }, 'Share')))),
        h('tbody', null, doneRows.map(function (id) {
          var rec = S.rec[id], ms = r.splits ? r.splits[id] : null;
          return h('tr', null,
            h('th', { scope: 'row' }, stageMeta(id).name),
            h('td', null, levelBadge(rec.level)),
            h('td', null, rec.hints ? String(rec.hints) : '—'),
            h('td', { class: 'num' }, ms != null ? UI.fmtTime(ms) : '—'),
            h('td', { class: 'cc-solve-col-bar' }, ms != null ? h('div', { class: 'cc-solve-bar', 'aria-hidden': 'true' }, h('span', { style: { width: Math.max(3, Math.round(ms / maxMs * 100)) + '%' } })) : null));
        }))) : h('p', { class: 'muted m-0' }, 'No stages finished this time.');

      var changes = r.changes.map(function (c) {
        var name = stageMeta(c.id).name, o = c.out;
        return o.promoted
          ? UI.callout('success', name + ' graduated to ' + LEVEL_NAMES[o.level], 'Well done — ' + NEXT_TIME[o.level])
          : UI.callout('info', name + ' goes back to ' + LEVEL_NAMES[o.level], 'A bit more help: ' + NEXT_TIME[o.level] + ' That’s normal — it comes back quickly.');
      });
      var miles = r.milestones.map(function (id) {
        var m = milestoneInfo(id);
        return UI.callout('success', 'New milestone: ' + m.name, m.desc);
      });

      var slow = drill ? P.stage : r.slowest;
      var againLabel = P.source === 'scan' ? 'Scan another cube' : drill ? 'Practise ' + theStage(P.stage) + ' again'
        : P.timed ? 'Another timed solve' : P.virtual ? 'Another virtual solve' : 'Another practice scramble';
      var againBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: again, dataset: { focus: 'again' } }, icon(P.source === 'scan' ? 'camera' : 'refresh', 18), againLabel);
      var actions = h('div', { class: 'row' },
        againBtn,
        slow && !drill ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { App.go('solve', { device: P.device, source: 'drill', stage: slow }); } },
          icon('practice', 18), 'Practise ' + theStage(slow)) : null,
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: function () { App.go('home'); } }, icon('home', 18), 'Home'));

      var wrap = h('div', { class: 'cc-solve cc-solve-summary stack stack-lg' },
        h('section', { class: 'card stack', 'aria-labelledby': 'cc-solve-sum-title' },
          h('div', { class: 'row row-nowrap row-top' },
            h('span', { class: ['cc-solve-trophy', r.completed ? null : 'is-muted'] }, icon(r.completed ? 'trophy' : 'info', 30)),
            h('div', null,
              h('p', { class: 'eyebrow m-0' }, (P.virtual ? 'Virtual cube' : 'Your cube') + ' · ' + (P.timed ? 'Speed practice' : drill ? 'Stage practice' : 'Coached solve')),
              h('h1', { class: 'm-0', id: 'cc-solve-sum-title', tabindex: '-1' }, title))),
          h('div', { class: 'cc-solve-total' },
            h('div', { class: 'timer timer-sm' }, UI.fmtTime(r.totalMs || 0)),
            h('span', { class: 'muted' }, 'total time')),
          badges,
          r.slip ? UI.callout('warn', 'That was too quick to count', 'Under ' + UI.fmtTime(3000) + ' looks like a slip of the timer, so it doesn’t change your progress.') : null,
          table,
          r.quiz.total ? h('p', { class: 'm-0' }, h('strong', null, 'Questions: '), r.quiz.right + ' of ' + r.quiz.total + ' right' + (r.quiz.right === r.quiz.total ? ' — spot on.' : '.')) : null,
          slow && !drill && doneRows.length > 1 ? h('p', { class: 'small muted m-0' }, 'For its size, ' + theStage(slow) + ' took you longest — a short drill there pays off fastest.') : null),
        changes.length ? h('section', { class: 'stack stack-sm', 'aria-label': 'Guidance changes' }, changes) : null,
        miles.length ? h('section', { class: 'stack stack-sm', 'aria-label': 'Milestones' }, miles) : null,
        actions);
      el.appendChild(wrap);
      // Focus the heading, not the "again" button: the Space that finished a real-cube solve (or one
      // pressed out of rhythm right after) must not start a new solve before the summary is seen.
      var sumTitle = wrap.querySelector('#cc-solve-sum-title');
      try { (sumTitle || againBtn).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      announce(title + ' Total time ' + UI.fmtTime(r.totalMs || 0) + '.');
    }

    function again() {
      if (P.source === 'scan') { App.go('scan'); return; }
      var p = { device: P.device, source: P.source };
      if (P.timed) p.timed = true;
      if (P.source === 'drill') p.stage = P.stage;
      App.go('solve', p);
    }

    // ---------------------------------------------------------------- problem cards
    function problemCard(kind, title, text, buttons) {
      teardownCube();
      UI.empty(el);
      el.appendChild(h('section', { class: 'card stack cc-solve-summary', role: kind === 'danger' ? 'alert' : null },
        h('h1', { class: 'h2 m-0' }, title),
        typeof text === 'string' ? h('p', { class: 'muted m-0' }, text) : text,
        h('div', { class: 'row' }, buttons)));
    }
    function goBtn(label, route, params, primary, ic) {
      return h('button', { type: 'button', class: ['btn', primary ? 'btn-primary' : 'btn-secondary'], onClick: function () { App.go(route, params || {}); } }, ic ? icon(ic, 18) : null, label);
    }
    function showNoState() {
      S.phase = 'done';
      problemCard('info', 'No scanned cube yet', 'I need to see your cube before I can coach you. Scan it with the camera, or practise with a scramble instead.', [
        goBtn('Scan my cube', 'scan', {}, true, 'camera'),
        goBtn('Practice scramble', 'solve', { device: 'physical', source: 'scramble' }, false, 'cube'),
        goBtn('Virtual cube', 'solve', { device: 'virtual', source: 'scramble' }, false, 'cube')
      ]);
    }
    function showInvalid(err) {
      S.phase = 'done';
      var v = err && err.validation;
      var msg = v && v.errors && v.errors[0] ? v.errors[0].message : (err && err.message) || 'Unknown problem.';
      problemCard('danger', 'This cube can’t be solved as scanned', h('div', { class: 'stack stack-sm' },
        h('p', { class: 'm-0' }, msg),
        h('p', { class: 'muted m-0' }, 'Usually one or two stickers were read as the wrong colour (orange and red are the usual suspects). Scan again in even light and check each face on the review screen.')), [
        goBtn('Scan again', 'scan', {}, true, 'camera'),
        goBtn('Practice scramble instead', 'solve', { device: 'physical', source: 'scramble' }, false, 'cube')
      ]);
    }
    function showAlreadySolved() {
      S.phase = 'done';
      problemCard('info', 'This cube is already solved', 'Nothing to do here! Scramble it and start again, or try a practice scramble.', [
        P.source === 'scan' ? goBtn('Scan again', 'scan', {}, true, 'camera') : null,
        goBtn('Practice scramble', 'solve', { device: P.device, source: 'scramble' }, P.source !== 'scan', 'cube'),
        goBtn('Home', 'home', {}, false, 'home')
      ]);
    }
    function showProblem(err) {
      console.error('[CC solve]', err);
      S.phase = 'done';
      problemCard('danger', 'Sorry — the solve couldn’t start', (err && err.message) || String(err), [
        h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { App.go('solve', rawParams || {}); } }, icon('refresh', 18), 'Try again'),
        goBtn('Home', 'home', {}, false, 'home')
      ]);
    }

    // ---------------------------------------------------------------- keyboard
    function isControl(t) {
      return !!(t && t.closest && t.closest('button, a[href], summary, select, input, textarea, [role="button"], [contenteditable="true"]'));
    }
    function hasModal() { return typeof document !== 'undefined' && document.documentElement.classList.contains('has-modal'); }

    function onKey(e) {
      if (destroyed) return;
      var k = e.key;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === 'z' || k === 'Z')) {
        if (UI.isTyping(e) || hasModal() || S.overlay) return;
        if (P.virtual && S.history.length) { e.preventDefault(); undo(); }
        return;
      }
      if (S.overlay || UI.shortcutsBlocked(e)) return;
      if (k === 'Escape' || k === 'Esc') {
        if (S.phase === 'solving' && !S.finished) { e.preventDefault(); openPause(); }
        return;
      }
      if (P.virtual && CC.Keys && canTurn()) {
        var tok = null;
        try { tok = CC.Keys.toMove(e, scheme); } catch (x) { tok = null; }
        if (tok) { e.preventDefault(); learnerMove(tok); return; }
      }
      var space = k === ' ' || k === 'Spacebar';
      // Timed real-cube solve: Space is the timer, wherever the focus is (like a real stackmat).
      if (space && P.timed && !P.virtual && (S.phase === 'ready' || S.phase === 'inspect' || S.phase === 'solving')) {
        e.preventDefault();
        S.eatSpace = true;
        if (!e.repeat) { active(); timedSpace(); }
        return;
      }
      if ((space || k === 'Enter') && isControl(e.target)) return;
      if (space && e.repeat) { e.preventDefault(); return; }
      if (dispatchKey(k, space)) { e.preventDefault(); active(); }
    }

    // Stop the Space that drove the timer from also "clicking" a focused button on key-up.
    function onKeyUp(e) {
      if (destroyed || !S.eatSpace) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        S.eatSpace = false;
        if (isControl(e.target)) e.preventDefault();
      }
    }

    function dispatchKey(k, space) {
      var lower = k && k.length === 1 ? k.toLowerCase() : k;
      var hintKey = lower === '?' || (lower === 'h' && !(P.virtual && scheme === 'cstimer'));
      if (S.phase === 'setup') {
        if (space || k === 'ArrowRight') { setupNext(); return true; }
        if (k === 'ArrowLeft') { setupBack(); return true; }
        if (k === 'Enter') { setupReady(); return true; }
        return false;
      }
      if (P.timed) {
        if (space && !P.virtual) { timedSpace(); return true; }
        if (hintKey && S.phase === 'solving' && hintAllowed()) { requestHint(); return true; }
        if (k === 'ArrowLeft' && P.virtual) { undo(); return true; }
        return false;
      }
      if (S.phase !== 'solving') return false;
      if (S.quiz) {
        if (!S.quiz.answered && /^[1-9]$/.test(k)) {
          var i = Number(k) - 1;
          if (i < S.quiz.quiz.options.length) { answerQuiz(i); return true; }
        }
        if (S.quiz.answered && (space || k === 'Enter' || k === 'ArrowRight')) { finishQuiz(); return true; }
        return false;
      }
      if (S.gate) return false;
      if (hintKey) {
        if (hintAllowed() && (S.hintLevel < 3 || moreHints())) { requestHint(); return true; }
        if (S.level === 2 && !S.revealed && tracking()) { revealMoves(); return true; }
        return false;
      }
      if (P.virtual) {
        if ((space || k === 'ArrowRight') && showingMoves()) { doForMe(); return true; }
        if (k === 'ArrowLeft') { undo(); return true; }
        return false;
      }
      if (S.level >= 2 && !stepObj()) {
        if (space || k === 'Enter') { completeStage({ free: true }); refresh(); return true; }
        return false;
      }
      if (S.level >= 2) {
        if (showingMoves()) {
          if (space || k === 'ArrowRight') { nextMove(); return true; }
          if (k === 'ArrowLeft') { backMove(); return true; }
          if (k === 'Enter') { doneWithStep(); return true; }
          if (lower === 'r') { replayStep(); return true; }
          return false;
        }
        if (space || k === 'Enter' || k === 'ArrowRight') { doneWithStep(); return true; }
        return false;
      }
      if (space || k === 'Enter') { stageDonePressed(); return true; }
      return false;
    }

    // ---------------------------------------------------------------- teardown
    function teardownCube() {
      stopTicker();
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
      if (pad) { try { pad.destroy(); } catch (e) { /* ignore */ } pad = null; }
      if (view) {
        S.mute = true;
        view.onUserMove = null;
        try { view.dispose(); } catch (e) { /* ignore */ }
        view = null;
      }
      ui.padWrap = null;
      ui.big = ui.bigLabel = ui.total = ui.stage = null;
      // A view-less stub keeps late callbacks harmless.
      view = nullView(Cube || { solved: function () { return []; }, parseAlg: function () { return []; }, applyMove: function (s) { return s; } });
    }

    function destroy() {
      if (destroyed) return;
      if (!S.finished && S.phase === 'solving' && !S.leaving) {
        try {
          finish(false, { silent: true });
          toast('Your unfinished solve was saved.');
        } catch (e) { console.error(e); }
      }
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp, true);
      timeouts.forEach(function (id) { clearTimeout(id); });
      timeouts = [];
      idleWaiters = [];
      teardownCube();
    }

    // ---------------------------------------------------------------- go
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp, true);
    try { begin(); } catch (err) { showProblem(err); }
    return { destroy: destroy, _state: S, get _view() { return view; } };
  }

  // ================================================================ registration
  var current = null;

  var def = {
    title: function (p) {
      var P = normalizeParams(p);
      if (P.timed) return 'Timed solve';
      if (P.source === 'drill' && P.stage) return 'Practise ' + String(stageNameStatic(P.stage)).replace(/^The /, 'the ');
      return P.virtual ? 'Virtual solve' : 'Coached solve';
    },
    mount: function (el, params) {
      injectStyle();
      if (current) { try { current.destroy(); } catch (e) { /* ignore */ } current = null; }
      var session = createSession(el, params);
      current = session;
      return function () {
        try { session.destroy(); } catch (e) { console.error(e); }
        if (current === session) current = null;
      };
    },
    unmount: function () {
      if (current) { try { current.destroy(); } catch (e) { console.error(e); } current = null; }
    },
    // Pure helpers, exposed for tests.
    _internal: {
      normalizeParams: normalizeParams, sameState: sameState, partialOf: partialOf, trailOf: trailOf,
      firstActiveStage: firstActiveStage, slowestOf: slowestOf, createClock: createClock,
      get session() { return current; }
    }
  };

  root.CC = root.CC || {};
  root.CC.SolveScreen = def;   // for tests and debugging
  if (root.CC.App) root.CC.App.registerScreen('solve', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
