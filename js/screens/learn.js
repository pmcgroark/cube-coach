/* Cube Coach — Learn hub, Lesson and Watch screens ("learn without a cube").
 *
 * learn  : the course hub — the learner's journey, the notation primer, the 8 stage lessons with
 *          mastery, "watch a full solve", the algorithm library (each one plays on a mini cube),
 *          the 12-week plan (current week highlighted), speed tips, no-cube tips and a glossary.
 *          params: { tab?|section?: 'stages'|'notation'|'algorithms'|'plan'|'tips'|'glossary' } (scrolls there)
 * lesson : one stage's lesson (goal, why, how-to, cases, algorithms, mistakes, speed tips) with an
 *          embedded narrated DEMO PLAYER (CC.Lessons.DEMOS) that pauses at checkpoints so the learner
 *          predicts what comes next. id 'notation' is the interactive notation primer + "name that move".
 *          params: { id: stageId | 'notation' }   (also accepts { stage })
 * watch  : a narrated full solve of a random cube (or one stage with params.stage), step by step,
 *          with "anticipate" questions before steps. params: { stage?, seed? }
 *
 * Classic script; nothing touches the DOM at load time. One View3D per mounted screen, disposed on
 * unmount together with timers, intervals and key listeners.
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'cc-style-learn';
  var DAY_MS = 86400000;
  var SPEEDS = [
    { v: 0.5, label: '½×', name: 'Half speed' },
    { v: 1, label: '1×', name: 'Normal speed' },
    { v: 1.5, label: '1½×', name: 'One and a half times speed' },
    { v: 2, label: '2×', name: 'Double speed' }
  ];
  var LEVEL_BADGE = ['badge-success', 'badge-accent', 'badge-info', ''];
  var FACE_ROWS = [
    ['U', 'Top'], ['D', 'Bottom'], ['R', 'Right'], ['L', 'Left'], ['F', 'Front'], ['B', 'Back']
  ];
  var ROTATIONS = ['x', "x'", 'y', "y'", 'y2', 'z', "z'"];
  var NQ_POOL = ['U', "U'", 'U2', 'R', "R'", 'R2', 'L', "L'", 'F', "F'", 'F2', 'D', "D'", 'y', "y'"];
  var NQ_COUNT = 5;
  // Stages whose solver quizzes ask about one named piece ("this corner", "this edge").
  var PIECE_QUIZ_STAGES = { corners: true, middle: true, yorient: true };

  // ================================================================ lookups (lazy, never at load time)
  function CC() { return root.CC || {}; }
  function UI() { return CC().UI; }
  function h() { var u = UI(); return u.h.apply(u, arguments); }
  function icon(name, size) { return UI().icon(name, size); }
  function Ls() { return CC().Lessons || null; }
  function Cube() { return CC().Cube || null; }
  function Solver() { return CC().Solver || null; }
  function Coach() { return CC().Coach || null; }
  function App() { return CC().App; }
  function appData() { try { return App().data; } catch (e) { return null; } }
  function settings() { var d = appData(); if (d && !d.settings) d.settings = {}; return (d && d.settings) || {}; }
  function saveData() { try { App().save(); } catch (e) { if (root.console) console.error('[CC learn] save failed', e); } }
  function markActive() { try { if (App() && App().markActive) App().markActive(); } catch (e) { /* ignore */ } }
  function go(id, params) { App().go(id, params || {}); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }
  function reduced() { try { return UI().reducedMotion(); } catch (e) { return false; } }
  function scrollIntoViewIfNeeded(node) {
    if (!node || !node.scrollIntoView) return;
    try { node.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
  }
  function focusQuietly(node) { if (node && node.focus) { try { node.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  function narrow() { try { return !!(root.matchMedia && root.matchMedia('(max-width: 900px)').matches); } catch (e) { return false; } }
  // A question about the cube needs the cube in view. Wide screens keep the cube pinned beside the
  // panel, so just bring the question in; on a phone scroll the cube to the top (the question sits
  // right under it).
  function revealQuestion(card, vp) {
    if (!narrow() || !vp || !vp.getBoundingClientRect) { scrollIntoViewIfNeeded(card); return; }
    var r = vp.getBoundingClientRect(), vh = root.innerHeight || 0;
    if (r.top >= 40 && r.top < vh * 0.3) return;
    try { vp.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
  }

  function stageList() {
    try { return UI().stages(); } catch (e) { return []; }
  }
  function stageIds() { return stageList().map(function (s) { return s.id; }); }
  function stageIndex(id) { return stageIds().indexOf(id); }
  function isStageId(id) { return typeof id === 'string' && stageIndex(id) !== -1; }

  // Merged view of a stage: Lessons content when present, Solver/UI stage table otherwise.
  function lessonStage(id) {
    var L = Ls();
    var s = L && typeof L.stage === 'function' ? L.stage(id) : null;
    var base = null;
    stageList().forEach(function (x) { if (x.id === id) base = x; });
    if (!s && !base) return null;
    var algs = (s && s.algorithms) || (base && base.algorithms) || (base && base.algorithm ? [base.algorithm] : []);
    return {
      id: id, index: stageIndex(id),
      title: (s && s.title) || (base && base.name) || id,
      short: (base && base.short) || (s && s.title) || id,
      tagline: (s && s.tagline) || '',
      goal: (s && s.goal) || (base && base.goal) || '',
      why: (s && s.why) || '',
      howTo: (s && s.howTo) || [],
      recognise: (s && s.recognise) || [],
      algorithms: algs || [],
      mnemonics: (s && s.mnemonics) || [],
      mistakes: (s && s.mistakes) || [],
      speedTips: (s && s.speedTips) || [],
      // Middle Layer extras (see middleExtras); absent on other stages
      halves: (s && s.halves) || null,
      mirrorRule: (s && s.mirrorRule) || '',
      whyItWorks: (s && s.whyItWorks) || '',
      landmarks: (s && s.landmarks) || null,
      lostPlace: (s && s.lostPlace) || null
    };
  }

  function algInfo(id) {
    var L = Ls();
    var a = L && typeof L.algorithm === 'function' ? L.algorithm(id) : null;
    if (a) return a;
    var S = Solver();
    var b = S && S.ALGS ? S.ALGS[id] : null;
    return b ? { id: id, name: b.name, notation: b.notation, usedIn: [] } : null;
  }
  // "R U R' U R U2 R'" -> "Sune" (matches the notation or the as-used form), else null.
  function algNameFor(tokens) {
    var key = toks(tokens).join(' ');
    var ids = algIds();
    for (var i = 0; i < ids.length; i++) {
      var a = algInfo(ids[i]);
      if (!a) continue;
      if (toks(a.notation).join(' ') === key) return a.name;
      if (a.asUsed && toks(a.asUsed).join(' ') === key) return a.name + ' + U';
    }
    return null;
  }
  function algIds() {
    var L = Ls();
    if (L && L.ALGORITHMS) return Object.keys(L.ALGORITHMS);
    var S = Solver();
    return S && S.ALGS ? Object.keys(S.ALGS) : [];
  }

  function toks(alg) {
    var C = Cube();
    try { if (C) return C.parseAlg(alg); } catch (e) { /* fall through */ }
    if (Array.isArray(alg)) return alg.map(String);
    return String(alg == null ? '' : alg).trim().split(/\s+/).filter(Boolean);
  }
  function moveText(tok) {
    var C = Cube();
    try { return C.moveInfo(tok).text; } catch (e) { return String(tok); }
  }
  function moveLabel(tok) {
    var C = Cube();
    try { return C.moveInfo(tok).label; } catch (e) { return String(tok); }
  }
  function invertMove(tok) {
    var C = Cube();
    if (C && C.invertMove) return C.invertMove(tok);
    return /'$/.test(tok) ? tok.slice(0, -1) : /2$/.test(tok) ? tok : tok + "'";
  }
  function learnSolved() {
    var C = Cube(), L = Ls();
    var pre = (L && L.LEARNING_FRAME && L.LEARNING_FRAME.prefix) || 'z2';
    return C.applyAlg(C.solved(), pre);
  }
  function rng(seed) {
    var C = Cube();
    if (C && C.mulberry32) return C.mulberry32(seed >>> 0);
    var s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function newSeed() { return Math.floor(Math.random() * 1e9); }

  function levelOf(id) {
    var Co = Coach(), d = appData(), lvl = 3, m = 0;
    if (Co && d) {
      try {
        lvl = Co.levelFor(d, id);
        m = typeof Co.masteryOf === 'function' ? Co.masteryOf(d, id)
          : (d.skills && d.skills[id] ? Number(d.skills[id].mastery) || 0 : 0);
      } catch (e) { /* keep defaults */ }
    }
    if (lvl !== 0 && lvl !== 1 && lvl !== 2 && lvl !== 3) lvl = 3;
    var LV = (Co && Co.LEVELS) || [{ name: 'Solo' }, { name: 'Nudge' }, { name: 'Coach' }, { name: 'Show' }];
    return { level: lvl, name: (LV[lvl] && LV[lvl].name) || 'Show', mastery: Math.round(clamp(Number(m) || 0, 0, 100)) };
  }

  function recordDrill(type, correct) {
    var Co = Coach(), d = appData();
    if (!Co || !d || typeof Co.recordDrill !== 'function') return;
    try { Co.recordDrill(d, type, !!correct); saveData(); } catch (e) { if (root.console) console.error('[CC learn] recordDrill failed', e); }
  }

  // Pure helpers (exported for tests) -------------------------------------------------------
  // Four answer options for "what's the next move?": the right one, two other directions of the
  // same layer, and one other layer. -> { options:[tokens], answer:index }
  function moveOptions(tok, rnd) {
    var C = Cube();
    rnd = rnd || Math.random;
    var base = C.baseOf(tok), rot = C.isRotation(tok);
    var opts = [tok];
    function add(t) { if (t && opts.indexOf(t) === -1 && opts.length < 4) opts.push(t); }
    shuffle([base, base + "'", base + '2'], rnd).forEach(add);
    var others = rot ? ['x', 'y', 'z', 'U'].filter(function (b) { return b !== base; })
      : ['U', 'R', 'F', 'L', 'D'].filter(function (b) { return b !== base; });
    shuffle(others, rnd);
    for (var i = 0; opts.length < 4 && i < others.length; i++) add(others[i] + ['', "'"][Math.floor(rnd() * 2)]);
    var out = shuffle(opts.slice(), rnd);
    return { options: out, answer: out.indexOf(tok) };
  }

  // 1-based week of the 12-week plan, from when the learner started.
  function weekFor(createdAt, now, weeks) {
    var t = Date.parse(createdAt);
    var n = typeof now === 'number' ? now : Date.now();
    if (!isFinite(t)) return 1;
    return clamp(Math.floor((n - t) / (7 * DAY_MS)) + 1, 1, weeks || 12);
  }

  function readMs(text, speed) { return clamp(String(text || '').length * 28, 1200, 6500) / (speed || 1); }
  function arrowLead(speed) { return 650 / (speed || 1); }
  function moveGap(speed) { return 160 / (speed || 1); }
  function nearestSpeed(v) {
    v = Number(v) || 1;
    var best = SPEEDS[1].v, d = Infinity;
    SPEEDS.forEach(function (s) { var dd = Math.abs(s.v - v); if (dd < d) { d = dd; best = s.v; } });
    return best;
  }

  // ================================================================ styles
  var CSS = [
    '.cc-learn, .cc-lesson, .cc-watch { --cc-ln-gap: var(--space-5); }',
    '.cc-jump { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
    '.cc-hint { font-size: var(--text-xs); color: var(--text-3); }',
    '.cc-tok { font-family: var(--font-mono); font-weight: 700; }',
    '.cc-sec-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-3); }',
    '.cc-sec-head h2 { margin: 0; }',
    '.cc-sec-head p { margin: 0; color: var(--text-2); }',
    '.cc-section { scroll-margin-top: calc(var(--topbar-h) + env(safe-area-inset-top, 0px) + var(--space-3)); }',

    /* journey */
    '.cc-jcard { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-jcard__top { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); }',
    '.cc-jcard__title { margin: 0; font-size: var(--text-lg); }',
    '.cc-jcard__pct { font-weight: 700; color: var(--accent-text); font-variant-numeric: tabular-nums; }',
    '.cc-jcard__next { margin: 0; padding: var(--space-3); border-radius: var(--radius); background: var(--accent-soft); font-size: var(--text-sm); }',

    /* stage cards */
    '.cc-lcard { position: relative; display: flex; flex-direction: column; gap: var(--space-2); transition: border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease); }',
    '.cc-lcard:hover { border-color: var(--accent-soft-2); box-shadow: var(--shadow-2); }',
    '.cc-lcard.is-focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft-2), var(--shadow-1); }',
    '.cc-lcard__top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }',
    '.cc-lcard__title { margin: 0; font-size: var(--text-lg); }',
    '.cc-lcard__link { color: var(--text); text-decoration: none; }',
    '.cc-lcard__link:hover { text-decoration: none; color: var(--accent-text); }',
    '.cc-lcard__link::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }',
    '.cc-lcard__link:focus-visible { outline: none; }',
    '.cc-lcard:has(.cc-lcard__link:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.cc-lcard__actions { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: auto; padding-top: var(--space-1); }',
    '.cc-meter-row { display: flex; align-items: center; gap: var(--space-2); }',
    '.cc-meter-row .progress { flex: 1 1 auto; }',
    '.cc-pct { flex: none; min-width: 3.5ch; text-align: right; font-size: var(--text-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }',

    /* algorithm library */
    '.cc-alglib { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); align-items: start; }',
    '@media (min-width: 900px) { .cc-alglib { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); } .cc-alglib__player { position: sticky; top: calc(var(--topbar-h) + var(--space-4)); } }',
    '.cc-alglib__list { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-alglib__player { scroll-margin-top: calc(var(--topbar-h) + var(--space-3)); scroll-margin-bottom: calc(var(--bottomnav-h, 0px) + var(--space-3)); }',
    '.cc-mini { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-mini .viewport-3d { min-height: 220px; aspect-ratio: 1 / 1; max-height: 380px; }',
    '@media (max-width: 520px) { .cc-mini .viewport-3d { min-height: 220px; max-height: 300px; } }',
    '.cc-mini__title { margin: 0; font-weight: 700; }',
    '.cc-mini__line { margin: 0; min-height: 2.6em; }',
    '.cc-acard { display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-acard.is-playing { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft-2); }',
    '.cc-acard__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }',
    '.cc-acard__head h3 { margin: 0; font-size: var(--text-lg); }',
    '.cc-plain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }',
    '.cc-plain > li { margin: 0; display: flex; gap: var(--space-2); align-items: baseline; font-size: var(--text-sm); }',
    '.cc-plain .cc-plain__tok { flex: none; min-width: 2.6em; padding: 1px 6px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border); text-align: center; font-family: var(--font-mono); font-weight: 700; }',
    '.cc-plain .cc-plain__tok.is-rotation { border-style: dashed; font-style: italic; background: transparent; }',
    '.cc-reps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }',
    '.cc-reps > li { margin: 0; display: flex; gap: var(--space-2); align-items: baseline; font-size: var(--text-sm); }',
    '.cc-reps__n { flex: none; min-width: 3.2em; font-weight: 700; color: var(--accent-text); font-variant-numeric: tabular-nums; }',

    /* disclosure (weeks, glossary, details) */
    '.cc-disc { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }',
    '.cc-disc > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); font-weight: 650; border-radius: var(--radius); }',
    '.cc-disc > summary::-webkit-details-marker { display: none; }',
    '.cc-disc > summary::after { content: ""; margin-left: auto; flex: none; width: 8px; height: 8px; border-right: 2px solid var(--text-3); border-bottom: 2px solid var(--text-3); transform: rotate(45deg); transition: transform var(--dur-2) var(--ease); }',
    '.cc-disc[open] > summary::after { transform: rotate(-135deg); }',
    '.cc-disc > summary:hover { background: var(--surface-2); }',
    '.cc-disc[open] > summary { border-bottom: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0; }',
    '.cc-disc__body { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-disc--plain { border: 0; background: transparent; }',
    '.cc-disc--plain > summary { padding: 6px 0; font-size: var(--text-sm); color: var(--accent-text); }',
    '.cc-disc--plain > summary:hover { background: transparent; text-decoration: underline; }',
    '.cc-disc--plain[open] > summary { border-bottom: 0; }',
    '.cc-disc--plain > .cc-disc__body { padding: var(--space-2) 0 0; }',
    '.cc-week.is-current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft-2); }',
    '.cc-weeknum { flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border); font-size: var(--text-sm); font-weight: 700; font-variant-numeric: tabular-nums; }',
    '.cc-week.is-current .cc-weeknum { background: var(--accent); border-color: transparent; color: var(--on-accent); }',
    '.cc-week__title { min-width: 0; }',
    '.cc-week__body h4 { margin: 0 0 var(--space-1); font-size: var(--text-sm); color: var(--text-2); text-transform: uppercase; letter-spacing: 0.06em; }',
    '.cc-routine { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }',
    '.cc-routine > li { margin: 0; display: flex; gap: var(--space-2); align-items: baseline; }',
    '.cc-routine__min { flex: none; min-width: 3.6em; font-weight: 700; color: var(--accent-text); font-variant-numeric: tabular-nums; }',
    '.cc-gloss { margin: 0; display: grid; gap: var(--space-1) var(--space-4); grid-template-columns: minmax(0, 1fr); }',
    '@media (min-width: 720px) { .cc-gloss { grid-template-columns: minmax(8em, max-content) minmax(0, 1fr); } }',
    '.cc-gloss dt { font-weight: 700; }',
    '.cc-gloss dd { margin: 0 0 var(--space-2); color: var(--text-2); }',
    '.cc-tips { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); list-style: none; margin: 0; padding: 0; }',
    '.cc-tips > li { margin: 0; }',
    '.cc-tip { height: 100%; }',
    '.cc-tip h3 { margin: 0 0 4px; font-size: 1rem; }',
    '.cc-tip p { margin: 0; font-size: var(--text-sm); color: var(--text-2); }',

    /* player (lesson demo + watch) */
    '.cc-player__vp { position: relative; }',
    '.cc-movecap { position: absolute; left: var(--space-3); right: var(--space-3); bottom: var(--space-3); z-index: 2; display: flex; gap: var(--space-2); align-items: center; padding: 8px 12px; border-radius: var(--radius); background: var(--surface); background: color-mix(in srgb, var(--surface) 90%, transparent); border: 1px solid var(--border); box-shadow: var(--shadow-1); font-size: var(--text-sm); line-height: 1.35; pointer-events: none; }',
    '.cc-movecap__tok { flex: none; min-width: 2.3em; padding: 2px 8px; border-radius: 8px; background: var(--accent); color: var(--on-accent); font-family: var(--font-mono); font-weight: 800; font-size: 1.1rem; text-align: center; }',
    '.cc-movecap__tok.is-rotation { background: var(--accent-soft); color: var(--accent-text); border: 1px dashed var(--accent); }',
    '.cc-movecap__text { min-width: 0; }',
    '.cc-ctrls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }',
    '.cc-ctrls__count { margin-left: auto; font-variant-numeric: tabular-nums; }',
    '.cc-ctrls__opts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3) var(--space-4); margin-top: var(--space-3); }',
    '.cc-play { min-width: 7.5em; }',
    '.cc-narr { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-narr__text { font-size: 1.05rem; line-height: 1.55; }',
    '.cc-nextline { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--text-sm); }',
    '.cc-nextline:empty { display: none; }',
    '.cc-chips-masked .alg-chip:not(.is-done) { position: relative; color: transparent; }',
    '.cc-chips-masked .alg-chip:not(.is-done)::after { content: "?"; position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-3); font-style: normal; }',
    '.cc-q .quiz__options > li { margin: 0; }',
    '.cc-q__sub { display: block; margin-top: 2px; font-size: var(--text-xs); font-weight: 500; color: var(--text-2); }',
    '.cc-q .cc-tok { font-size: 1.05rem; }',
    '.cc-askcard { border-left: 4px solid var(--accent); }',
    '.cc-seg { display: flex; flex-direction: column; gap: 6px; }',
    '.cc-seg + .cc-seg { margin-top: var(--space-2); }',
    '.cc-seg__label { margin: 0; font-size: var(--text-sm); font-weight: 600; color: var(--text-2); }',
    '.cc-wcard { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-wcard h2 { margin: 0; }',
    '.cc-wcard .eyebrow { margin: 0; }',
    '.cc-score { font-size: var(--text-2xl); font-weight: 700; font-variant-numeric: tabular-nums; }',
    '.cc-watch .page-head { align-items: center; }',
    '.cc-qhost:empty, .cc-endhost:empty { display: none; }',
    '.cc-player__vp { scroll-margin-top: calc(var(--topbar-h) + var(--space-2)); }',
    /* phones/tablets (single column): put the narration/question right under the cube and its
       play controls, and the speed/toggle options after them, so the cube stays in sight. */
    '@media (max-width: 900px) {',
    '  .cc-reflow > .solve-layout__stage { display: contents; }',
    '  .cc-reflow > .solve-layout__stage > .cc-ctrls { margin-top: 0; }',
    '  .cc-reflow > .solve-layout__stage > .cc-ctrls__opts, .cc-reflow > .solve-layout__stage > .cc-hint { order: 2; margin-top: 0; }',
    '  .cc-reflow > .solve-layout__panel { order: 1; }',
    '  .cc-reflow .cc-qhost { order: -1; }',
    '  .cc-not-layout > .solve-layout__stage { position: sticky; top: var(--topbar-h); z-index: 3; padding: var(--space-2) 0; background: var(--bg); }',
    '  .cc-not-layout .viewport-3d { aspect-ratio: auto; min-height: 0; height: clamp(190px, 34vh, 300px); }',
    '  .cc-not-layout .cc-ctrls__opts { margin-top: var(--space-2); flex-wrap: nowrap; gap: var(--space-2); justify-content: space-between; }',
    '  .cc-not-layout .cc-ctrls__opts > .row > .small { display: none; }',
    '}',

    /* notation primer */
    '.cc-concepts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); counter-reset: cc-concept; }',
    '.cc-concepts > li { margin: 0; }',
    '.cc-concept { height: 100%; display: flex; flex-direction: column; gap: 6px; }',
    '.cc-concept h3 { margin: 0; font-size: 1rem; display: flex; gap: var(--space-2); align-items: baseline; }',
    '.cc-concept h3::before { counter-increment: cc-concept; content: counter(cc-concept); flex: none; display: inline-grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 50%; background: var(--accent-soft); color: var(--accent-text); font-size: var(--text-xs); font-weight: 700; }',
    '.cc-concept p { margin: 0; font-size: var(--text-sm); }',
    '.cc-mvrows { display: flex; flex-direction: column; gap: 6px; }',
    '.cc-mvrow { display: grid; grid-template-columns: 4.6em repeat(3, minmax(0, 1fr)); gap: 6px; align-items: center; }',
    '.cc-mvrow__label { font-size: var(--text-xs); font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }',
    '.cc-mvrot { display: grid; gap: 6px; grid-template-columns: repeat(7, minmax(0, 1fr)); }',
    '.cc-mv { font-family: var(--font-mono); font-size: 1rem; font-weight: 700; padding-left: 4px; padding-right: 4px; }',
    '.cc-mv.is-last { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }',
    '.cc-minfo { display: flex; gap: var(--space-3); align-items: flex-start; }',
    '.cc-minfo__tok { flex: none; display: inline-grid; place-items: center; min-width: 2.6em; height: 2.4em; padding: 0 8px; border-radius: 10px; background: var(--accent); color: var(--on-accent); font-family: var(--font-mono); font-size: 1.25rem; font-weight: 800; }',
    '.cc-minfo__body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }',
    '.cc-minfo__body p { margin: 0; }',

    /* Middle Layer lesson: two halves, the mirror, why it works, checkpoints, lost your place */
    '.cc-mid { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-mid > h2, .cc-mid > p { margin: 0; }',
    '.cc-mid__eyebrow { margin: 0 0 calc(-1 * var(--space-2)); }',
    '.cc-mid__pair { display: grid; gap: var(--space-3); grid-template-columns: minmax(0, 1fr); }',
    '@media (min-width: 760px) { .cc-mid__pair { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '.cc-half { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); min-width: 0; }',
    '.cc-half > h3 { margin: 0; font-size: var(--text-md); display: flex; align-items: center; gap: var(--space-2); }',
    '.cc-half__part { display: flex; flex-direction: column; gap: 6px; }',
    '.cc-half__label { margin: 0; font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-3); }',
    '.cc-half__does { margin: 0; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-beats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }',
    '.cc-beats > li { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }',
    '.cc-beat__tok { display: grid; place-items: center; width: 100%; min-height: 2.3em; border-radius: 9px; border: 1px solid var(--border-strong); background: var(--surface); font-family: var(--font-mono); font-size: 1.15rem; font-weight: 800; }',
    '.cc-beat__word { font-size: var(--text-xs); font-weight: 600; color: var(--accent-text); text-align: center; line-height: 1.25; overflow-wrap: anywhere; }',
    '.cc-mirror { display: grid; gap: var(--space-3); grid-template-columns: minmax(0, 1fr); }',
    '@media (min-width: 760px) { .cc-mirror { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '.cc-mirror__half { margin: 0; display: grid; grid-template-columns: 3.4em repeat(4, minmax(0, 1fr)); gap: 6px; align-items: center; }',
    '.cc-mirror__half > figcaption { grid-column: 1 / -1; margin: 0; font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-3); }',
    '.cc-mirror__side { font-size: var(--text-sm); font-weight: 700; }',
    '.cc-mirror__tok { display: grid; place-items: center; min-height: 2.2em; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); font-family: var(--font-mono); font-size: 1.05rem; font-weight: 800; }',
    '.cc-mirror__tok.is-left { background: var(--accent-soft); border-color: var(--accent-soft-2); color: var(--accent-text); }',
    '.cc-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); counter-reset: cc-check; }',
    '.cc-checks > li { margin: 0; display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-2); }',
    '.cc-checks > li::before { counter-increment: cc-check; content: counter(cc-check); flex: none; display: inline-grid; place-items: center; width: 1.8em; height: 1.8em; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: var(--text-sm); font-weight: 800; }',
    '.cc-checks p { margin: 0; min-width: 0; }',
    '.cc-lost { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-lost > li { margin: 0; }',
    '.cc-mid__more { display: flex; flex-wrap: wrap; gap: var(--space-2); }',

    /* phones & touch: whole-card lesson links get a 44 px line of their own */
    '@media (pointer: coarse) { .cc-lcard__link { display: inline-flex; align-items: center; min-height: 44px; } .cc-lcard__title { line-height: 1.25; } }'
  ];

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS.join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  // ================================================================ small shared widgets
  function meter(pct, label) {
    pct = Math.round(clamp(Number(pct) || 0, 0, 100));
    return h('div', {
      class: 'progress progress-sm', role: 'progressbar', 'aria-label': label || 'Mastery',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct)
    }, h('div', { class: 'progress__bar', style: { width: pct + '%' } }));
  }

  function levelBadge(lv) {
    return h('span', { class: ['badge', LEVEL_BADGE[lv.level]], title: 'Guidance level: ' + lv.name }, lv.name);
  }

  function sectionHead(title, sub, extra) {
    return h('div', { class: 'cc-sec-head' }, h('div', null, h('h2', null, title), sub ? h('p', null, sub) : null), extra || null);
  }

  function iconButton(name, label, onClick, cls) {
    return h('button', { type: 'button', class: ['btn btn-secondary btn-icon', cls], 'aria-label': label, title: label, onClick: onClick }, icon(name, 18));
  }

  function toggleControl(label, checked, onChange) {
    var input = h('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(!!input.checked); });
    var el = h('label', { class: 'toggle' }, input, h('span', { class: 'toggle__track', 'aria-hidden': 'true' }), h('span', { class: 'toggle__label small' }, label));
    return { el: el, input: input, set: function (v) { input.checked = !!v; } };
  }

  function speedControl(initial, onChange) {
    var current = nearestSpeed(initial);
    var buttons = [];
    var el = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Animation speed' });
    SPEEDS.forEach(function (s) {
      var b = h('button', {
        type: 'button', 'aria-label': s.name, title: s.name, 'aria-pressed': String(s.v === current),
        onClick: function () { current = s.v; update(); onChange(s.v); }
      }, s.label);
      buttons.push(b);
      el.appendChild(b);
    });
    function update() { buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(SPEEDS[i].v === current)); }); }
    return { el: h('div', { class: 'row row-sm' }, h('span', { class: 'small muted' }, 'Speed'), el), get: function () { return current; } };
  }

  // Timers that all die together: stop() invalidates every running sequence.
  function createRunner() {
    var id = 0, timers = [];
    function stop() {
      id++;
      timers.forEach(function (t) { clearTimeout(t); });
      timers = [];
      return id;
    }
    return {
      stop: stop,
      begin: stop,
      alive: function (t) { return t === id; },
      wait: function (ms) {
        return new Promise(function (res) {
          var t = setTimeout(function () {
            var i = timers.indexOf(t);
            if (i !== -1) timers.splice(i, 1);
            res();
          }, Math.max(0, ms || 0));
          timers.push(t);
        });
      }
    };
  }

  // View3D (or its 2D fallback). If the module is missing entirely, a text-only stand-in keeps
  // the screen working: moves apply instantly and the caption names the next move.
  function nullViewer(container, opts) {
    var C = Cube();
    var state = (opts && opts.state ? opts.state : C.solved()).slice();
    var cap = h('p', { class: 'small m-0' });
    var box = h('div', { class: 'viewport-3d__placeholder' }, icon('cube', 36),
      h('p', { class: 'm-0' }, 'The cube picture isn’t available here, but every move is still listed and explained.'), cap);
    container.appendChild(box);
    function noop() {}
    return {
      fallback: true, onUserMove: null,
      setState: function (s) { state = s.slice(); },
      getState: function () { return state.slice(); },
      finalState: function () { return state.slice(); },
      play: function (tokens, o) {
        toks(tokens).forEach(function (t, i) {
          state = C.applyMove(state, t);
          if (o && typeof o.onMove === 'function') o.onMove(i, t);
        });
        return Promise.resolve(state.slice());
      },
      userMove: function (t) { return this.play([t]); },
      cancel: noop, isBusy: function () { return false; }, setSpeed: noop,
      showArrow: function (t) { cap.textContent = t ? 'Next: ' + t + ' — ' + moveText(t) : ''; },
      highlight: noop, setTurnable: noop, resetCamera: noop, resize: noop,
      dispose: function () { if (box.parentNode) box.parentNode.removeChild(box); }
    };
  }

  function makeViewer(container, opts) {
    var V = CC().View3D;
    if (V && typeof V.create === 'function') {
      try { return V.create(container, opts); } catch (e) { if (root.console) console.error('[CC learn] View3D failed', e); }
    }
    return nullViewer(container, opts);
  }

  // q = { prompt, context?, options:[{ label, sub?, mono? }], answer, explain }
  function quizBlock(q, onAnswer, opts) {
    opts = opts || {};
    var answered = false;
    var fb = h('div', { class: 'quiz__feedback', 'aria-live': 'polite' });
    var buttons = [];
    var list = h('ul', { class: 'quiz__options' });
    q.options.forEach(function (o, i) {
      var b = h('button', { type: 'button', class: 'quiz-option', onClick: function () { choose(i); } },
        h('span', { class: 'quiz-option__key', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'quiz-option__text' },
          h('span', { class: o.mono ? 'cc-tok' : null }, o.label),
          o.sub ? h('span', { class: 'cc-q__sub' }, o.sub) : null));
      buttons.push(b);
      list.appendChild(h('li', null, b));
    });
    var skip = opts.onSkip ? h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm',
      onClick: function () { if (!answered) { answered = true; opts.onSkip(); } }
    }, 'Skip this question') : null;
    var el = h('div', { class: 'quiz cc-q' },
      q.context ? h('p', { class: 'eyebrow' }, q.context) : null,
      h('p', { class: 'quiz__prompt' }, q.prompt),
      list, fb,
      h('div', { class: 'row row-sm row-between' },
        h('span', { class: 'cc-hint' }, 'Press 1–' + Math.min(9, buttons.length) + ' or tap an answer.'), skip));
    function choose(i) {
      if (answered || i < 0 || i >= buttons.length) return false;
      answered = true;
      var correct = i === q.answer;
      el.classList.add('is-answered');
      if (skip && skip.parentNode) skip.parentNode.removeChild(skip);
      buttons.forEach(function (b, j) {
        b.disabled = true;
        if (j === q.answer) b.classList.add('is-correct');
        else if (j === i) b.classList.add('is-wrong');
      });
      var right = q.options[q.answer] ? q.options[q.answer].label : '';
      fb.appendChild(UI().callout(correct ? 'success' : 'warn',
        correct ? 'Yes, well spotted.' : 'Not quite. The answer is ' + right + '.',
        q.explain ? h('p', { class: 'm-0' }, q.explain) : null));
      try { onAnswer(correct, i, fb); } catch (e) { if (root.console) console.error(e); }
      return true;
    }
    return { el: el, choose: choose, answered: function () { return answered; } };
  }

  // Space on a focused button/link/checkbox should activate it, not toggle playback.
  function nativeSpace(e) {
    var t = e && e.target;
    if (!t || !t.tagName) return false;
    var tag = String(t.tagName).toUpperCase();
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return true;
    var role = t.getAttribute && t.getAttribute('role');
    return role === 'tab' || role === 'button' || role === 'slider' || role === 'checkbox';
  }
  // Arrow keys belong to tabs, selects and sliders; on ordinary buttons they step the player.
  function nativeArrows(e) {
    var t = e && e.target;
    if (!t || !t.tagName) return false;
    var tag = String(t.tagName).toUpperCase();
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && String(t.type).toLowerCase() === 'range')) return true;
    var role = t.getAttribute && t.getAttribute('role');
    return role === 'tab' || role === 'slider' || role === 'radio' || role === 'menuitem';
  }

  function addKeys(cleanups, handler) {
    function onKey(e) {
      if (e.defaultPrevented) return;
      try { if (UI().shortcutsBlocked(e)) return; } catch (err) { /* old app.js */ }
      if (handler(e)) e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    cleanups.push(function () { document.removeEventListener('keydown', onKey); });
  }

  function isSpace(e) { return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'; }
  function digit(e) { return /^[1-9]$/.test(e.key) ? Number(e.key) : 0; }

  function rotationClass(tok) {
    var C = Cube();
    try { return C.isRotation(tok) ? 'is-rotation' : null; } catch (e) { return null; }
  }

  // Move-by-move plain English list.
  function plainList(tokens) {
    return h('ol', { class: 'cc-plain' }, tokens.map(function (t) {
      return h('li', null, h('span', { class: ['cc-plain__tok', rotationClass(t)] }, t), h('span', null, moveText(t)));
    }));
  }

  function chipsOrNote(notation, size) {
    if (!notation) return null;
    try { return UI().algChips(notation, { size: size }); } catch (e) { return h('code', null, notation); }
  }

  // One algorithm card. o: { watch(algId)?, full?, lessonLink? }
  function algCard(id, o) {
    o = o || {};
    var a = algInfo(id);
    if (!a) return null;
    var tokens = toks(a.notation);
    var usedIn = (a.usedIn || []).map(function (sid) { var s = lessonStage(sid); return s ? s : null; }).filter(Boolean);
    var head = h('div', { class: 'cc-acard__head' },
      h('h3', null, a.name),
      usedIn.map(function (s) { return h('span', { class: 'badge' }, 'Stage ' + (s.index + 1) + ': ' + s.short); }));
    var asUsed = a.asUsed && a.asUsed !== a.notation
      ? h('p', { class: 'small m-0' }, 'In this method you add one more U at the end: ', h('code', null, a.asUsed), '.') : null;
    var reps = Array.isArray(a.reps) && a.reps.length ? h('div', { class: 'stack stack-xs' },
      h('p', { class: 'small strong m-0' }, 'How many times?'),
      h('ul', { class: 'cc-reps' }, a.reps.map(function (r) {
        return h('li', null, h('span', { class: 'cc-reps__n' }, r.count + '×'), h('span', null, r.when));
      }))) : null;
    var mnemonic = a.mnemonic ? h('p', { class: 'small m-0' }, h('strong', null, 'Memory trick: '), a.mnemonic) : null;
    var card;
    if (o.full) {
      card = h('article', { class: 'card cc-acard', dataset: { alg: id } },
        head,
        UI().algChips(tokens, { size: 'lg', label: a.name }),
        asUsed,
        a.summary ? h('p', { class: 'm-0' }, a.summary) : null,
        h('div', { class: 'stack stack-xs' }, h('p', { class: 'small strong m-0' }, 'Move by move'), plainList(tokens)),
        mnemonic ? UI().callout('tip', 'Memory trick', a.mnemonic) : null,
        reps,
        a.fingerTricks ? h('div', { class: 'stack stack-xs' }, h('p', { class: 'small strong m-0' }, 'Finger tricks'), h('p', { class: 'small muted m-0' }, a.fingerTricks)) : null,
        a.fact ? h('p', { class: 'small muted m-0' }, h('strong', null, 'Did you know? '), a.fact) : null);
    } else {
      card = h('article', { class: 'card card-sm cc-acard', dataset: { alg: id } },
        head,
        UI().algChips(tokens, { size: 'sm', label: a.name }),
        asUsed,
        mnemonic,
        h('details', { class: 'cc-disc cc-disc--plain' },
          h('summary', null, 'Move by move, in plain English'),
          h('div', { class: 'cc-disc__body' },
            plainList(tokens),
            reps,
            a.fingerTricks ? h('p', { class: 'small muted m-0' }, h('strong', null, 'Finger tricks: '), a.fingerTricks) : null)),
        h('div', { class: 'row row-sm' },
          o.watch ? h('button', { type: 'button', class: 'btn btn-soft btn-sm', onClick: function () { o.watch(id); } }, icon('play', 16), 'Watch it') : null,
          o.lessonLink && usedIn[0] ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { go('lesson', { id: usedIn[0].id }); }
          }, icon('learn', 16), 'Lesson: ' + usedIn[0].short) : null));
    }
    return card;
  }

  var cleanupsByScreen = { learn: null, lesson: null, watch: null };
  function beginCleanups(key) {
    runCleanups(key);
    var list = [];
    cleanupsByScreen[key] = list;
    return list;
  }
  function runCleanups(key) {
    var list = cleanupsByScreen[key];
    cleanupsByScreen[key] = null;
    if (!list) return;
    list.slice().reverse().forEach(function (fn) { try { fn(); } catch (e) { if (root.console) console.error('[CC learn] cleanup failed', e); } });
  }

  // ================================================================ LEARN HUB
  function journeyCard() {
    var Co = Coach(), d = appData(), j = null;
    if (Co && d && typeof Co.journey === 'function') { try { j = Co.journey(d); } catch (e) { j = null; } }
    if (!j) return null;
    var focus = j.focusStage && lessonStage(j.focusStage);
    var pct = Math.round((Number(j.progress) || 0) * 100);
    var phases = ['Learn', 'Practise', 'On your own', 'Speed'];
    // Coach's text may already start with "Next up:"; don't print "Next: Next up: …".
    var nextText = j.next ? String(j.next).replace(/^\s*next(\s+up)?\s*:\s*/i, '') : '';
    return h('section', { class: 'card cc-jcard', 'aria-label': 'Your journey' },
      h('div', { class: 'cc-jcard__top' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Your journey · phase ' + ((j.phaseIndex >= 0 ? j.phaseIndex : 0) + 1) + ' of 4: ' + (phases[j.phaseIndex] || 'Learn')),
          h('h2', { class: 'cc-jcard__title' }, j.title)),
        h('span', { class: 'cc-jcard__pct' }, pct + '%')),
      meter(pct, 'Progress through this phase'),
      j.description ? h('p', { class: 'muted small m-0' }, j.description) : null,
      nextText ? h('p', { class: 'cc-jcard__next' }, h('strong', null, 'Next: '), nextText) : null,
      focus ? h('div', { class: 'row row-sm' },
        h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('lesson', { id: focus.id }); } },
          icon('learn', 18), 'Open lesson: ' + focus.title),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: function () { go('watch', { stage: focus.id }); } },
          icon('watch', 18), 'Watch it solved')) : null);
  }

  function notationCard() {
    var d = appData();
    var nd = d && d.drills && d.drills.notation;
    var acc = nd && nd.total ? Math.round(100 * nd.right / nd.total) : null;
    return h('section', { class: 'card card-accent stack stack-sm cc-section', id: 'cc-learn-notation' },
      h('p', { class: 'eyebrow' }, 'Start here'),
      h('h2', { class: 'm-0' }, 'How to read moves'),
      h('p', { class: 'm-0' }, 'Every move has a letter. R means turn the right side, U the top, and so on. ' +
        'An apostrophe (R\') means the other way and a 2 means a half turn. Ten minutes here makes every lesson easier.'),
      UI().algChips(['R', "R'", 'U', "U'", 'F2', 'y'], { size: 'sm', label: 'Example moves' }),
      acc != null ? h('p', { class: 'small muted m-0' }, 'Your move-naming score so far: ' + acc + '% (' + nd.right + ' of ' + nd.total + ').') : null,
      h('div', { class: 'row row-sm' },
        h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('lesson', { id: 'notation' }); } },
          icon('cube', 18), 'Open the move primer')));
  }

  function stageCards(focusId) {
    var grid = h('div', { class: 'grid grid-2' });
    stageList().forEach(function (s, i) {
      var st = lessonStage(s.id);
      if (!st) return;
      var lv = levelOf(s.id);
      var algs = st.algorithms.map(algInfo).filter(Boolean);
      grid.appendChild(h('article', { class: ['card card-sm cc-lcard', focusId === s.id ? 'is-focus' : null], dataset: { stage: s.id } },
        h('div', { class: 'cc-lcard__top' },
          h('span', { class: 'badge badge-accent' }, 'Stage ' + (i + 1)),
          levelBadge(lv),
          focusId === s.id ? h('span', { class: 'badge badge-solid' }, 'Up next') : null),
        h('h3', { class: 'cc-lcard__title' },
          h('a', { class: 'cc-lcard__link', href: '#/lesson?id=' + encodeURIComponent(s.id) }, st.title)),
        st.tagline ? h('p', { class: 'muted small m-0' }, st.tagline) : null,
        h('div', { class: 'cc-meter-row' }, meter(lv.mastery, 'Mastery of ' + st.title), h('span', { class: 'cc-pct' }, lv.mastery + '%')),
        algs.length
          ? h('div', { class: 'stack stack-xs' }, algs.map(function (a) {
            return h('div', { class: 'stack stack-xs' }, h('span', { class: 'small strong' }, a.name), chipsOrNote(a.notation, 'sm'));
          }))
          : h('p', { class: 'small subtle m-0' }, 'No algorithm needed: just logic.'),
        h('div', { class: 'cc-lcard__actions' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { go('watch', { stage: s.id }); } },
            icon('watch', 16), 'Watch it solved'),
          s.id === 'middle' && CC().Gym ? h('button', { type: 'button', class: 'btn btn-soft btn-sm', onClick: function () { go('gym'); } },
            icon('zap', 16), 'Middle Layer Gym') : null)));
    });
    return grid;
  }

  function watchSection() {
    var sel = h('select', { class: 'select', 'aria-label': 'Watch one stage', id: 'cc-learn-watch-stage' },
      h('option', { value: '' }, 'Choose a stage…'),
      stageList().map(function (s, i) { return h('option', { value: s.id }, 'Stage ' + (i + 1) + ': ' + s.name); }));
    return h('section', { class: 'grid grid-2 cc-section', id: 'cc-learn-watch' },
      UI().tile({
        icon: 'watch', title: 'Watch a full solve', badge: 'No cube needed',
        desc: 'A randomly scrambled cube, solved stage by stage with a narrator. It pauses to ask what you think comes next.',
        onClick: function () { go('watch'); }
      }),
      h('div', { class: 'card card-sm stack stack-sm' },
        h('label', { class: 'label', htmlFor: 'cc-learn-watch-stage' }, 'Or watch just one stage'),
        h('div', { class: 'row row-sm row-nowrap' }, sel,
          h('button', {
            type: 'button', class: 'btn btn-secondary',
            onClick: function () { if (sel.value) go('watch', { stage: sel.value }); else { try { sel.focus(); } catch (e) { /* ignore */ } } }
          }, icon('play', 16), 'Watch'))));
  }

  function algLibrary(cleanups) {
    var runner = createRunner();
    var view = null, chips = null, playingId = null;
    var vp = h('div', { class: 'viewport-3d cc-player__vp' });
    var title = h('p', { class: 'cc-mini__title' }, 'Press “Watch it” on any algorithm');
    var chipsHost = h('div');
    var line = h('p', { class: 'cc-mini__line small muted', 'aria-live': 'polite' },
      'The cube starts in a position the algorithm fixes, so you can watch it finish on a solved cube.');
    var list = h('div', { class: 'cc-alglib__list' });
    var cards = {};
    algIds().forEach(function (id) {
      var c = algCard(id, { watch: watch, lessonLink: true });
      if (c) { cards[id] = c; list.appendChild(c); }
    });
    var playerCard = h('div', { class: 'cc-alglib__player card card-sm cc-mini' }, vp, title, chipsHost, line);
    var el = h('section', { class: 'cc-section', id: 'cc-learn-algorithms' },
      sectionHead('The 7 algorithms', 'Everything you need to memorise. Learn them in chunks of three or four moves.'),
      h('div', { class: 'cc-alglib' }, playerCard, list));

    function setPlaying(id) {
      Object.keys(cards).forEach(function (k) { cards[k].classList.toggle('is-playing', k === id); });
      playingId = id;
    }

    async function watch(id) {
      if (!view) return;
      var a = algInfo(id);
      if (!a) return;
      var C = Cube();
      var list2 = toks(a.asUsed || a.notation);
      var speed = nearestSpeed(settings().animSpeed);
      var t = runner.begin();
      if (view.isBusy()) view.cancel();
      view.showArrow(null);
      view.setState(C.applyAlg(learnSolved(), C.invertAlg(list2)));
      setPlaying(id);
      title.textContent = a.name;
      UI().empty(chipsHost);
      chips = UI().algChips(list2, { label: a.name });
      chipsHost.appendChild(chips);
      line.textContent = 'Watch the arrow: it shows which layer turns next.';
      scrollIntoViewIfNeeded(playerCard);
      markActive();
      await runner.wait(600);
      for (var i = 0; i < list2.length; i++) {
        if (!runner.alive(t)) return;
        var tok = list2[i];
        chips.update({ current: i });
        line.textContent = tok + ': ' + moveText(tok);
        view.showArrow(tok);
        await runner.wait(arrowLead(speed));
        if (!runner.alive(t)) return;
        await view.play([tok], { speed: speed });
        if (!runner.alive(t)) return;
        view.showArrow(null);
        await runner.wait(moveGap(speed));
      }
      if (!runner.alive(t)) return;
      chips.update({ done: true });
      line.textContent = 'Done: back to solved. ' + (a.summary || '');
      setPlaying(null);
    }

    cleanups.push(function () { runner.stop(); if (view) view.dispose(); view = null; });
    return {
      el: el,
      start: function () {
        view = makeViewer(vp, { interactive: true, turnable: false, state: learnSolved(), speed: nearestSpeed(settings().animSpeed), label: 'Algorithm demo cube' });
      },
      playing: function () { return playingId; }
    };
  }

  function planSection() {
    var L = Ls();
    var cur = (L && L.CURRICULUM) || [];
    if (!cur.length) return null;
    var d = appData();
    var week = weekFor(d && d.createdAt, Date.now(), cur.length);
    return h('section', { class: 'stack stack-sm cc-section', id: 'cc-learn-plan' },
      sectionHead('Your 12-week plan', 'Twenty minutes a day. You are in week ' + week + '.'),
      L.EXPECTATIONS ? UI().callout('info', 'Honest expectations', L.EXPECTATIONS) : null,
      cur.map(function (wk) {
        var isCur = wk.week === week;
        var det = h('details', { class: ['cc-disc cc-week', isCur ? 'is-current' : null] },
          h('summary', null,
            h('span', { class: 'cc-weeknum', 'aria-hidden': 'true' }, String(wk.week)),
            h('span', { class: 'cc-week__title' }, h('span', { class: 'sr-only' }, 'Week ' + wk.week + ': '), wk.title),
            isCur ? h('span', { class: 'badge badge-solid' }, 'This week') : null),
          h('div', { class: 'cc-disc__body cc-week__body' },
            wk.focus ? h('p', { class: 'm-0' }, wk.focus) : null,
            wk.goals && wk.goals.length ? h('div', null, h('h4', null, 'Goals'), h('ul', { class: 'm-0' }, wk.goals.map(function (g) { return h('li', null, g); }))) : null,
            wk.routine && wk.routine.length ? h('div', null, h('h4', null, 'Each day'),
              h('ul', { class: 'cc-routine' }, wk.routine.map(function (r) {
                return h('li', null, h('span', { class: 'cc-routine__min' }, r.minutes + ' min'), h('span', null, r.activity));
              }))) : null,
            wk.target ? h('p', { class: 'm-0' }, h('strong', null, 'Target: '), wk.target) : null,
            wk.milestone ? h('p', { class: 'm-0' }, h('strong', null, 'Milestone: '), wk.milestone) : null));
        if (isCur) det.open = true;
        return det;
      }));
  }

  function tipCards(list) {
    return h('ul', { class: 'cc-tips' }, list.map(function (t) {
      return h('li', null, h('div', { class: 'card card-sm cc-tip' }, h('h3', null, t.title), h('p', null, t.text)));
    }));
  }

  function tipsSection() {
    var L = Ls();
    var tips = (L && L.SPEED_TIPS) || [];
    var noCube = (L && L.NO_CUBE_TIPS) || [];
    if (!tips.length && !noCube.length) return null;
    var first = tips.slice(0, 6), rest = tips.slice(6);
    return h('section', { class: 'stack cc-section', id: 'cc-learn-tips' },
      noCube.length ? h('div', { class: 'card card-accent stack stack-sm' },
        h('h2', { class: 'm-0' }, 'No cube to hand?'),
        h('p', { class: 'muted m-0' }, 'You can still get better: these work with just this app.'),
        h('ul', { class: 'm-0' }, noCube.map(function (t) { return h('li', null, h('strong', null, t.title + ': '), t.text); }))) : null,
      tips.length ? h('div', { class: 'stack stack-sm' },
        sectionHead('Speed tips', 'For when the method feels easy. Smooth beats fast.'),
        tipCards(first),
        rest.length ? h('details', { class: 'cc-disc' },
          h('summary', null, 'More speed tips (' + rest.length + ')'),
          h('div', { class: 'cc-disc__body' }, tipCards(rest))) : null) : null);
  }

  function glossarySection() {
    var L = Ls();
    var g = (L && L.GLOSSARY) || [];
    if (!g.length) return null;
    var dl = h('dl', { class: 'cc-gloss' });
    g.forEach(function (x) { dl.appendChild(h('dt', null, x.term)); dl.appendChild(h('dd', null, x.text)); });
    return h('section', { class: 'cc-section', id: 'cc-learn-glossary' },
      h('details', { class: 'cc-disc' },
        h('summary', null, icon('info', 18), 'Glossary: ' + g.length + ' cube words explained'),
        h('div', { class: 'cc-disc__body' }, dl)));
  }

  var SECTION_IDS = {
    notation: 'cc-learn-notation', stages: 'cc-learn-stages', watch: 'cc-learn-watch', algorithms: 'cc-learn-algorithms',
    algs: 'cc-learn-algorithms', plan: 'cc-learn-plan', tips: 'cc-learn-tips', glossary: 'cc-learn-glossary'
  };

  var learnScreen = {
    title: 'Learn',
    mount: function (el, params) {
      params = params || {};
      injectStyle();
      var cleanups = beginCleanups('learn');
      var Co = Coach(), d = appData(), focusId = null;
      if (Co && d && typeof Co.journey === 'function') { try { focusId = Co.journey(d).focusStage || null; } catch (e) { focusId = null; } }

      function jump(key) {
        var node = document.getElementById(SECTION_IDS[key]);
        if (!node) return;
        if (key === 'glossary') { var det = node.querySelector('details'); if (det) det.open = true; }
        try { node.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
        var f = node.querySelector('h2, summary');
        if (f) { if (!f.hasAttribute('tabindex') && f.tagName !== 'SUMMARY') f.setAttribute('tabindex', '-1'); focusQuietly(f); }
      }
      var jumps = [['stages', 'Stages'], ['algorithms', 'Algorithms'], ['plan', '12-week plan'], ['tips', 'Tips'], ['glossary', 'Glossary']];

      var lib = algLibrary(cleanups);
      el.appendChild(h('div', { class: 'stack stack-lg cc-learn' },
        h('header', { class: 'page-head m-0' },
          h('div', null,
            h('p', { class: 'eyebrow' }, 'Learn'),
            h('h1', null, 'Learn to solve the cube'),
            h('p', { class: 'muted' }, 'A beginner’s method in 8 short stages, held with yellow on top the whole time. ' +
              'Read a lesson, watch it done, then try it: no cube needed for most of it.')),
          h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('watch'); } }, icon('watch', 18), 'Watch a full solve')),
        h('nav', { class: 'cc-jump', 'aria-label': 'Jump to a section' }, jumps.map(function (j) {
          return h('button', { type: 'button', class: 'chip', onClick: function () { jump(j[0]); } }, j[1]);
        })),
        journeyCard(),
        notationCard(),
        h('section', { class: 'cc-section', id: 'cc-learn-stages' },
          sectionHead('The 8 stages', 'In order. Each one has a short lesson and narrated demos.'),
          stageCards(focusId)),
        watchSection(),
        lib.el,
        planSection(),
        tipsSection(),
        glossarySection()));

      lib.start();
      var target = SECTION_IDS[params.section || params.tab];
      if (target) setTimeout(function () { if (document.getElementById(target)) jump(params.section || params.tab); }, 60);
    },
    unmount: function () { runCleanups('learn'); }
  };

  // ================================================================ LESSON: demo player
  function createDemoPlayer(stageId, demos, opts) {
    opts = opts || {};
    var C = Cube(), L = Ls();
    var runner = createRunner();
    var view = null, chips = null;
    var speed = nearestSpeed(settings().animSpeed);
    var P = { di: 0, demo: null, ds: null, idx: 0, playing: false, answered: {}, pending: null, quiz: null, read: {} };
    var ivl = setInterval(function () { if (P.playing) markActive(); }, 15000);

    // ---- DOM
    var tabButtons = [];
    var tabs = null;
    if (demos.length > 1) {
      tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Worked examples' });
      demos.forEach(function (d, i) {
        var b = h('button', {
          type: 'button', role: 'tab', class: 'tab', id: 'cc-demo-tab-' + i, 'aria-selected': 'false', tabindex: '-1',
          'aria-controls': 'cc-demo-panel',
          onClick: function () { load(i); },
          onKeydown: function (e) {
            var k = e.key, j = -1;
            if (k === 'ArrowRight') j = (i + 1) % demos.length;
            else if (k === 'ArrowLeft') j = (i - 1 + demos.length) % demos.length;
            else if (k === 'Home') j = 0;
            else if (k === 'End') j = demos.length - 1;
            if (j === -1) return;
            e.preventDefault();
            load(j);
            focusQuietly(tabButtons[j]);
          }
        }, (i + 1) + '. ' + d.title);
        tabButtons.push(b);
        tabs.appendChild(b);
      });
    }
    var vp = h('div', { class: 'viewport-3d cc-player__vp' });
    var capTok = h('span', { class: 'cc-movecap__tok' });
    var capText = h('span', { class: 'cc-movecap__text' });
    var cap = h('div', { class: 'cc-movecap', hidden: true, 'aria-hidden': 'true' }, capTok, capText);
    vp.appendChild(cap);

    var btnRestart = iconButton('refresh', 'Restart this example', function () { restart(); });
    var btnBack = iconButton('arrowLeft', 'Step back one move', function () { stepBack(); });
    var btnPlay = h('button', { type: 'button', class: 'btn btn-primary cc-play', onClick: function () { togglePlay(); } });
    var btnFwd = iconButton('arrowRight', 'Step forward one move', function () { stepFwd(); });
    var count = h('span', { class: 'cc-ctrls__count small muted' });
    var spd = speedControl(speed, function (v) {
      speed = v;
      if (view) view.setSpeed(v);
      settings().animSpeed = v;
      saveData();
    });
    var predict = toggleControl('Pause to let me predict', settings().anticipate !== false, function (on) {
      settings().anticipate = on;
      saveData();
      if (!on && P.pending) { P.pending = null; clearQuestion(); }
      render();
    });

    var dTitle = h('h3', { class: 'h4 m-0' });
    var dSummary = h('p', { class: 'small muted m-0' });
    var narr = h('p', { class: 'cc-narr__text m-0', 'aria-live': 'polite' });
    var nextLine = h('p', { class: 'cc-nextline' });
    var chipsHost = h('div');
    var qHost = h('div', { class: 'cc-qhost' });
    var endHost = h('div', { class: 'cc-endhost' });

    var el = h('div', { class: 'cc-player stack stack-sm' },
      tabs,
      h('div', { class: 'solve-layout cc-reflow', id: 'cc-demo-panel', role: tabs ? 'tabpanel' : null },
        h('div', { class: 'solve-layout__stage' },
          vp,
          h('div', { class: 'cc-ctrls', role: 'group', 'aria-label': 'Demo controls' }, btnRestart, btnBack, btnPlay, btnFwd, count),
          h('div', { class: 'cc-ctrls__opts' }, spd.el, predict.el),
          h('p', { class: 'cc-hint m-0 mt-2' }, 'Keys: Space play/pause · ← → step · 1–4 answer. Drag the cube to look around.')),
        h('div', { class: 'solve-layout__panel' },
          h('div', { class: 'card cc-narr' }, h('div', { class: 'stack stack-xs' }, dTitle, dSummary), narr, nextLine,
            h('div', { class: 'stack stack-xs' }, h('p', { class: 'small strong m-0' }, 'The moves'), chipsHost)),
          qHost,
          endHost)));

    // ---- model helpers
    function n() { return P.ds ? P.ds.moves.length : 0; }
    function cpAt(k) {
      var list = (P.demo && P.demo.checkpoints) || [];
      for (var i = 0; i < list.length; i++) if (list[i].at === k) return list[i];
      return null;
    }
    function anticipate() { return settings().anticipate !== false; }
    function needsAsk(k) { return !!cpAt(k) && anticipate() && !P.answered[k]; }
    function narrationFor(k, hideCurrent) {
      var best = null;
      ((P.demo && P.demo.narration) || []).forEach(function (x) {
        if (x.at <= k && (!hideCurrent || x.at < k) && (!best || x.at >= best.at)) best = x;
      });
      return best;
    }
    function narrationExact(k) {
      var list = (P.demo && P.demo.narration) || [];
      for (var i = 0; i < list.length; i++) if (list[i].at === k) return list[i];
      return null;
    }

    function render() {
      if (!P.ds) return;
      var total = n(), k = P.idx, ended = k >= total;
      // A question is waiting at this move: don't give its answer away (narration, arrow, chips).
      var askNext = !P.pending && !ended && needsAsk(k);
      var hide = !!P.pending || askNext;
      var nar = narrationFor(k, hide);
      narr.textContent = nar ? nar.text : P.pending ? 'Look at the cube, then answer the question.'
        : 'Press play to watch. Hold your view: yellow on top, green in front.';
      if (chips) {
        chips.update({ current: ended || hide ? -1 : k, done: k });
        chips.classList.toggle('cc-chips-masked', hide);
        if (hide) chips.setAttribute('aria-hidden', 'true'); else chips.removeAttribute('aria-hidden');
      }
      var busy = view && view.isBusy();
      if (P.pending) {
        nextLine.textContent = 'Your turn: what happens next? Answer below.';
        cap.hidden = true;
      } else if (askNext) {
        nextLine.textContent = 'Press play: first I’ll ask what you think comes next.';
        cap.hidden = true;
      } else if (ended) {
        nextLine.textContent = 'Example finished.';
        cap.hidden = true;
      } else {
        var tok = P.ds.moves[k];
        nextLine.textContent = 'Next move: ' + tok + ' — ' + moveText(tok);
        capTok.textContent = tok;
        capTok.className = 'cc-movecap__tok' + (rotationClass(tok) ? ' is-rotation' : '');
        capText.textContent = moveText(tok);
        cap.hidden = false;
      }
      if (view && !busy) view.showArrow(hide || ended ? null : P.ds.moves[k]);
      count.textContent = k + ' / ' + total + ' moves';
      UI().empty(btnPlay);
      if (P.playing) { btnPlay.appendChild(icon('pause', 18)); btnPlay.appendChild(document.createTextNode('Pause')); }
      else if (ended) { btnPlay.appendChild(icon('refresh', 18)); btnPlay.appendChild(document.createTextNode('Replay')); }
      else { btnPlay.appendChild(icon('play', 18)); btnPlay.appendChild(document.createTextNode(k ? 'Play' : 'Play')); }
      btnPlay.setAttribute('aria-label', P.playing ? 'Pause' : ended ? 'Replay from the start' : 'Play');
      btnBack.disabled = k === 0;
      btnFwd.disabled = ended;
      renderEnd(ended && !P.playing);
    }

    function renderEnd(show) {
      UI().empty(endHost);
      if (!show) return;
      var nextI = P.di + 1 < demos.length ? P.di + 1 : -1;
      endHost.appendChild(h('div', { class: 'card card-sm stack stack-sm' },
        h('p', { class: 'm-0 strong' }, 'That’s the “' + P.demo.title + '” example.'),
        h('p', { class: 'small muted m-0' }, nextI !== -1
          ? 'Try the next example, or replay this one at half speed and watch one piece only.'
          : 'You’ve seen every example. Now try it yourself on the virtual cube.'),
        h('div', { class: 'row row-sm' },
          nextI !== -1 ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: function () { load(nextI); focusQuietly(tabButtons[nextI]); } },
            'Next example', icon('arrowRight', 16)) : null,
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: function () { restart(); play(); } }, icon('refresh', 16), 'Replay'),
          nextI === -1 ? h('button', {
            type: 'button', class: 'btn btn-primary btn-sm',
            onClick: function () { go('solve', { device: 'virtual', source: 'drill', stage: stageId }); }
          }, icon('cube', 16), 'Try it on the virtual cube') : null)));
    }

    function clearQuestion() { P.quiz = null; UI().empty(qHost); }

    function optionView(cp, o) {
      var label = String(o);
      if (cp.kind === 'next') {
        var t = toks(label);
        var sub = t.length === 1 ? moveText(t[0]) : algNameFor(t) || (t.length <= 3 ? t.map(moveLabel).join(', then ') : '');
        return { label: label, mono: true, sub: sub || null };
      }
      if (cp.kind === 'reps' && /^\d+$/.test(label)) return { label: label + (label === '1' ? ' time' : ' times') };
      return { label: label };
    }

    function ask(k) {
      var cp = cpAt(k);
      if (!cp) return;
      P.pending = cp;
      if (view) view.showArrow(null);
      var q = quizBlock({
        prompt: cp.prompt,
        context: 'Pause and predict',
        options: (cp.options || []).map(function (o) { return optionView(cp, o); }),
        answer: cp.answer,
        explain: cp.explain
      }, function (correct, i, fb) {
        P.answered[k] = { correct: correct };
        P.read[k] = true;
        P.pending = null;
        recordDrill('predict', correct);
        var cont = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: function () { clearQuestion(); play(); } }, icon('play', 16), 'Continue');
        fb.appendChild(h('div', { class: 'row row-sm mt-2' }, cont));
        render();
        focusQuietly(cont);
      }, {
        onSkip: function () { P.answered[k] = { skipped: true }; P.pending = null; clearQuestion(); play(); }
      });
      P.quiz = q;
      UI().empty(qHost);
      qHost.appendChild(h('div', { class: 'card card-sm cc-askcard' }, q.el));
      render();
      revealQuestion(qHost, vp);
    }

    async function loop(t) {
      while (runner.alive(t)) {
        var total = n();
        if (P.idx >= total) { P.playing = false; render(); markActive(); if (opts.onFinish) opts.onFinish(P.demo); return; }
        if (needsAsk(P.idx)) { P.playing = false; ask(P.idx); return; }
        var k = P.idx, tok = P.ds.moves[k];
        render();
        var wait = arrowLead(speed);
        var nar = narrationExact(k);
        if (nar && !P.read[k]) { P.read[k] = true; wait = Math.max(wait, readMs(nar.text, speed)); }
        await runner.wait(wait);
        if (!runner.alive(t)) return;
        await playOne(k, tok);
        if (!runner.alive(t)) return;
        if (view) view.showArrow(null);
        markActive();
        await runner.wait(moveGap(speed));
      }
    }
    function playOne(k, tok) {
      return view.play([tok], { speed: speed, onMove: function () { P.idx = k + 1; } });
    }

    function play() {
      if (!P.ds || !view) return;
      if (P.pending) { revealQuestion(qHost, vp); return; }
      if (P.idx >= n()) restart();
      if (P.quiz && P.quiz.answered()) clearQuestion();
      P.playing = true;
      render();
      loop(runner.begin());
    }
    function pause() {
      runner.stop();
      P.playing = false;
      if (view && view.isBusy()) view.cancel();
      render();
    }
    function togglePlay() { if (P.playing) pause(); else play(); }
    function stepFwd() {
      if (!P.ds || !view) return;
      pause();
      if (P.pending) { revealQuestion(qHost, vp); return; }
      if (P.idx >= n()) return;
      if (needsAsk(P.idx)) { ask(P.idx); return; }
      if (P.quiz && P.quiz.answered()) clearQuestion();
      var k = P.idx, tok = P.ds.moves[k];
      P.read[k] = true;
      view.showArrow(tok);
      var t = runner.begin();
      playOne(k, tok).then(function () { if (runner.alive(t)) { view.showArrow(null); render(); } });
      markActive();
    }
    function stepBack() {
      if (!P.ds || !view) return;
      pause();
      if (P.idx <= 0) return;
      if (P.pending) { P.pending = null; }
      clearQuestion();
      var k = P.idx - 1;
      P.idx = k;
      view.showArrow(null);
      var t = runner.begin();
      view.play([invertMove(P.ds.moves[k])], { speed: speed * 1.5 }).then(function () { if (runner.alive(t)) render(); });
      render();
      markActive();
    }
    function restart() {
      pause();
      P.idx = 0; P.answered = {}; P.read = {}; P.pending = null;
      clearQuestion();
      if (view) { view.showArrow(null); view.setState(P.ds.start); }
      render();
    }
    function load(i) {
      if (!demos[i]) return;
      runner.stop();
      P.playing = false;
      if (view && view.isBusy()) view.cancel();
      P.di = i; P.demo = demos[i];
      try { P.ds = L.demoStates(P.demo); } catch (e) {
        if (root.console) console.error('[CC learn] demo failed', e);
        P.ds = { start: learnSolved(), moves: [], end: learnSolved() };
      }
      P.idx = 0; P.answered = {}; P.read = {}; P.pending = null;
      clearQuestion();
      tabButtons.forEach(function (b, j) {
        b.setAttribute('aria-selected', String(j === i));
        b.setAttribute('tabindex', j === i ? '0' : '-1');
        b.classList.toggle('is-active', j === i);
      });
      // On a phone the tab strip scrolls sideways: keep the chosen example's tab in view.
      if (tabs && tabButtons[i] && tabs.scrollWidth > tabs.clientWidth) {
        try {
          var tr = tabs.getBoundingClientRect(), br = tabButtons[i].getBoundingClientRect();
          if (br.left < tr.left || br.right > tr.right) tabs.scrollLeft += (br.left - tr.left) - Math.max(0, (tr.width - br.width) / 2);
        } catch (e) { /* ignore */ }
      }
      dTitle.textContent = (demos.length > 1 ? 'Example ' + (i + 1) + ' of ' + demos.length + ': ' : 'Example: ') + P.demo.title;
      dSummary.textContent = P.demo.summary || '';
      UI().empty(chipsHost);
      chips = UI().algChips(P.ds.moves, { size: 'sm', label: 'Moves in this example' });
      chipsHost.appendChild(chips);
      if (view) { view.showArrow(null); view.setState(P.ds.start); }
      render();
    }

    return {
      el: el,
      start: function () {
        if (!demos.length) return;
        view = makeViewer(vp, { interactive: true, turnable: false, state: learnSolved(), speed: speed, label: 'Demo cube, yellow on top and green in front' });
        load(0);
      },
      key: function (e) {
        var dg = digit(e);
        if (dg && P.quiz && !P.quiz.answered()) { P.quiz.choose(dg - 1); return true; }
        if (isSpace(e)) { if (nativeSpace(e)) return false; togglePlay(); return true; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          if (nativeArrows(e)) return false;
          if (e.key === 'ArrowRight') stepFwd(); else stepBack();
          return true;
        }
        return false;
      },
      dispose: function () {
        runner.stop();
        clearInterval(ivl);
        P.playing = false;
        if (view) view.dispose();
        view = null;
      }
    };
  }

  // ================================================================ LESSON: stage lesson
  // ---------------------------------------------------------------- Middle Layer extras
  // CC.Lessons.STAGES.middle carries halves, mirrorRule, whyItWorks, landmarks and lostPlace (the four
  // things learners get stuck on). These render as their own cards; the matching "How to do it"
  // paragraphs (which say the same in one line each) are left out of that list so nothing is said twice.
  function gymDrillButton(drillId, label, cls) {
    var G = CC().Gym, d = G && typeof G.drill === 'function' ? G.drill(drillId) : null;
    return h('button', {
      type: 'button', class: 'btn ' + (cls || 'btn-soft') + ' btn-sm',
      onClick: function () { go('gym', d ? { drill: drillId } : {}); }
    }, icon('zap', 16), label || ('Practise: ' + (d ? d.name : 'Middle Layer Gym')));
  }

  function beats(tokens, rhythm) {
    var words = String(rhythm || '').split(/\s*,\s*/).filter(Boolean);
    if (words.length !== tokens.length) words = [];
    return h('ol', { class: 'cc-beats', 'aria-label': tokens.join(' ') + (words.length ? ' (' + words.join(', ') + ')' : '') },
      tokens.map(function (t, i) {
        return h('li', { title: moveText(t) },
          h('span', { class: 'cc-beat__tok', 'aria-hidden': 'true' }, t),
          words[i] ? h('span', { class: 'cc-beat__word', 'aria-hidden': 'true' }, words[i]) : null);
      }));
  }

  function middleExtras(st) {
    if (!st || st.id !== 'middle') return null;
    var halves = Array.isArray(st.halves) ? st.halves.filter(function (x) { return x && x.first && x.second; }) : [];
    var out = [];
    function sideOf(hv) { return /left/.test(hv.algId) ? 'left' : 'right'; }

    if (halves.length) {
      out.push(h('section', { class: 'card cc-mid', 'aria-labelledby': 'cc-mid-halves' },
        h('p', { class: 'eyebrow cc-mid__eyebrow' }, 'Remember the moves'),
        h('h2', { class: 'h3', id: 'cc-mid-halves' }, 'Two halves'),
        h('p', null, 'Each algorithm is eight moves, but you only have to learn two groups of four, and both groups have the same rhythm. Say the words as you turn.'),
        h('div', { class: 'cc-mid__pair' }, halves.map(function (hv) {
          var a = algInfo(hv.algId);
          var side = sideOf(hv);
          var rh = Array.isArray(hv.rhythm) ? hv.rhythm : [];
          return h('article', { class: 'cc-half', 'aria-label': 'Goes ' + side },
            h('h3', null, icon(side === 'left' ? 'arrowLeft' : 'arrowRight', 18), 'Goes ' + side, a ? h('span', { class: 'small muted' }, '(' + a.notation + ')') : null),
            h('div', { class: 'cc-half__part' },
              h('p', { class: 'cc-half__label' }, '1st half'),
              beats(toks(hv.first), rh[0]),
              hv.firstDoes ? h('p', { class: 'cc-half__does' }, hv.firstDoes) : null),
            h('div', { class: 'cc-half__part' },
              h('p', { class: 'cc-half__label' }, '2nd half'),
              beats(toks(hv.second), rh[1]),
              hv.secondDoes ? h('p', { class: 'cc-half__does' }, hv.secondDoes) : null));
        })),
        h('div', { class: 'cc-mid__more' }, gymDrillButton('halves'), gymDrillButton('nextmove', null, 'btn-ghost'))));
    }

    var right = halves.filter(function (x) { return sideOf(x) === 'right'; })[0];
    var left = halves.filter(function (x) { return sideOf(x) === 'left'; })[0];
    if (st.mirrorRule || (right && left)) {
      var tables = right && left ? h('div', { class: 'cc-mirror' }, [['first', '1st half'], ['second', '2nd half']].map(function (p) {
        var r = toks(right[p[0]]), l = toks(left[p[0]]);
        return h('figure', { class: 'cc-mirror__half', 'aria-label': p[1] + ': right ' + r.join(' ') + ', left ' + l.join(' ') },
          h('figcaption', null, p[1]),
          h('span', { class: 'cc-mirror__side', 'aria-hidden': 'true' }, 'Right'),
          r.map(function (t) { return h('span', { class: 'cc-mirror__tok', 'aria-hidden': 'true', title: moveText(t) }, t); }),
          h('span', { class: 'cc-mirror__side', 'aria-hidden': 'true' }, 'Left'),
          l.map(function (t) { return h('span', { class: 'cc-mirror__tok is-left', 'aria-hidden': 'true', title: moveText(t) }, t); }));
      })) : null;
      out.push(h('section', { class: 'card cc-mid', 'aria-labelledby': 'cc-mid-mirror' },
        h('h2', { class: 'h3', id: 'cc-mid-mirror' }, 'Left is the mirror of right'),
        st.mirrorRule ? h('p', null, mirrorText(st.mirrorRule)) : null,
        tables,
        h('p', { class: 'small muted' }, 'Read each column top to bottom: R becomes L, and every move turns the other way. Learn the right one first; the left one is the same dance with your other hand.'),
        h('div', { class: 'cc-mid__more' }, gymDrillButton('mirror'))));
    }

    if (st.whyItWorks) {
      out.push(h('section', { class: 'card card-muted cc-mid', 'aria-labelledby': 'cc-mid-why' },
        h('h2', { class: 'h3', id: 'cc-mid-why' }, 'Why it works'),
        h('p', null, st.whyItWorks)));
    }

    if (Array.isArray(st.landmarks) && st.landmarks.length) {
      out.push(h('section', { class: 'card cc-mid', 'aria-labelledby': 'cc-mid-checks' },
        h('p', { class: 'eyebrow cc-mid__eyebrow' }, 'Keep your place'),
        h('h2', { class: 'h3', id: 'cc-mid-checks' }, 'Checkpoints'),
        h('p', null, 'Check the cube against these as you go, so you always know where you are.'),
        h('ol', { class: 'cc-checks' }, st.landmarks.map(function (t) {
          var m = /^([^:]{3,40}):\s+(.+)$/.exec(String(t));
          return h('li', null, h('p', null, m ? [h('strong', null, m[1] + ': '), m[2]] : t));
        })),
        h('div', { class: 'cc-mid__more' }, gymDrillButton('landmark'), gymDrillButton('slowmo', null, 'btn-ghost'))));
    }

    if (Array.isArray(st.lostPlace) && st.lostPlace.length) {
      out.push(h('section', { class: 'card card-accent cc-mid', 'aria-labelledby': 'cc-mid-lost' },
        h('h2', { class: 'h3', id: 'cc-mid-lost' }, 'Lost your place?'),
        h('ul', { class: 'cc-lost' }, st.lostPlace.map(function (t) { return h('li', null, t); })),
        h('div', { class: 'cc-mid__more' }, gymDrillButton('whereami', null, 'btn-primary'), gymDrillButton('slip', null, 'btn-secondary'))));
    }
    return out.length ? out : null;
  }

  // The card's heading already says "Left is the mirror of right", so don't open the text with it too.
  function mirrorText(rule) {
    var t = String(rule).replace(/^\s*left is the mirror of right\s*[:.,-]\s*/i, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // "How to do it" paragraphs that a Middle Layer card already covers (see middleExtras).
  function coveredByExtras(st, p) {
    if (!st || st.id !== 'middle') return false;
    p = String(p);
    return (Array.isArray(st.halves) && st.halves.length && /^Learn each algorithm as two halves/.test(p)) ||
      (st.mirrorRule && /^Left is the mirror of right/.test(p)) ||
      (Array.isArray(st.landmarks) && st.landmarks.length && /^Check yourself after the first half/.test(p)) ||
      (Array.isArray(st.lostPlace) && st.lostPlace.length && /^Lost your place\?/.test(p));
  }

  function mountStageLesson(el, st, cleanups) {
    var L = Ls();
    var ids = stageIds();
    var i = st.index;
    var lv = levelOf(st.id);
    var demos = (L && L.DEMOS && L.DEMOS[st.id]) || [];
    var player = demos.length ? createDemoPlayer(st.id, demos) : null;
    if (player) cleanups.push(function () { player.dispose(); });
    var prev = i > 0 ? lessonStage(ids[i - 1]) : null;
    var next = i < ids.length - 1 ? lessonStage(ids[i + 1]) : null;

    var actions = h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onClick: function () { go('solve', { device: 'virtual', source: 'drill', stage: st.id }); }
      }, icon('cube', 18), 'Try it yourself on the virtual cube'),
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onClick: function () { go('drills', { tab: 'drills', stage: st.id }); }
      }, icon('zap', 18), 'Drill this stage'),
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onClick: function () { go('solve', { device: 'physical', source: 'drill', stage: st.id }); }
      }, icon('hand', 18), 'Do it with my real cube'),
      st.id === 'middle' ? h('button', {
        type: 'button', class: 'btn btn-secondary',
        onClick: function () { go('gym'); }
      }, icon('zap', 18), 'Middle Layer Gym') : null);

    el.appendChild(h('div', { class: 'stack stack-lg cc-lesson' },
      h('div', { class: 'row row-between' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { go('learn'); } }, icon('arrowLeft', 16), 'All lessons'),
        h('div', { class: 'row row-sm' }, h('span', { class: 'small muted' }, 'Your level'), levelBadge(lv),
          h('span', { class: 'small muted num' }, lv.mastery + '% mastered'))),
      h('header', { class: 'm-0' },
        h('p', { class: 'eyebrow' }, 'Stage ' + (i + 1) + ' of ' + ids.length),
        h('h1', null, st.title),
        st.tagline ? h('p', { class: 'lead m-0' }, st.tagline) : null),
      UI().stageTrack(st.id),
      h('section', { class: 'card stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, 'The goal'),
        h('p', { class: 'm-0' }, st.goal),
        st.why ? h('h3', { class: 'h4 m-0 mt-2' }, 'Why it matters') : null,
        st.why ? h('p', { class: 'muted m-0' }, st.why) : null),
      st.id === 'middle' ? h('section', { class: 'card card-accent stack stack-sm', 'aria-labelledby': 'cc-lesson-gym' },
        h('h2', { class: 'h3 m-0', id: 'cc-lesson-gym' }, 'Stuck? Go to the gym'),
        h('p', { class: 'm-0' }, 'The Middle Layer Gym has short exercises for the four things that trip people up here: remembering the moves, seeing what to do, stuck edges and losing your place. Most of them need no cube.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('gym'); } }, icon('zap', 18), 'Go to the gym'))) : null,
      h('section', { class: 'stack stack-sm', 'aria-labelledby': 'cc-lesson-watch' },
        h('div', { class: 'cc-sec-head' },
          h('div', null, h('h2', { id: 'cc-lesson-watch' }, 'Watch it done'),
            h('p', null, 'Held with yellow on top and green in front. The arrow shows the next turn; the player stops so you can predict.')),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { go('watch', { stage: st.id }); } },
            icon('watch', 16), 'Watch it on a random cube')),
        player ? player.el : UI().callout('info', 'No demo for this stage yet', 'Use “Watch it on a random cube” to see it solved.'),
        actions),
      st.howTo.length ? h('section', { class: 'card stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, 'How to do it'),
        h('ol', { class: 'stack stack-sm m-0' }, st.howTo.filter(function (p) { return !coveredByExtras(st, p); }).map(function (p) { return h('li', null, p); }))) : null,
      middleExtras(st),
      st.recognise.length ? h('section', { class: 'stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, 'Recognise each case'),
        h('p', { class: 'muted m-0' }, 'Look first, then act. Each case has a tell-tale sign and one thing to do.'),
        h('div', { class: 'grid grid-2' }, st.recognise.map(function (c) {
          return h('article', { class: 'card card-sm stack stack-xs' },
            h('h3', { class: 'h4 m-0' }, c.name),
            h('p', { class: 'small m-0' }, h('strong', null, 'How to spot it: '), c.look),
            h('p', { class: 'small m-0' }, h('strong', null, 'What to do: '), c.action));
        }))) : null,
      h('section', { class: 'stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, st.algorithms.length > 1 ? 'The algorithms' : 'The algorithm'),
        st.algorithms.length
          ? st.algorithms.map(function (id) { return algCard(id, { full: true }); })
          : UI().callout('tip', 'No algorithm to learn here', 'This stage is all logic: look where the piece is, and move it where it belongs.')),
      st.mnemonics.length ? h('section', { class: 'card card-accent stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, 'Memory tricks'),
        h('ul', { class: 'm-0' }, st.mnemonics.map(function (m) { return h('li', null, m); }))) : null,
      st.mistakes.length ? h('section', { class: 'card stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, 'Common mistakes'),
        h('ul', { class: 'm-0' }, st.mistakes.map(function (m) { return h('li', null, m); }))) : null,
      st.speedTips.length ? h('section', { class: 'card card-muted stack stack-sm' },
        h('h2', { class: 'h3 m-0' }, 'Speed tips (for later)'),
        h('ul', { class: 'm-0' }, st.speedTips.map(function (m) { return h('li', null, m); }))) : null,
      h('nav', { class: 'row row-between', 'aria-label': 'Other lessons' },
        prev ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { go('lesson', { id: prev.id }); } },
          icon('arrowLeft', 18), 'Stage ' + i + ': ' + prev.title)
          : h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { go('lesson', { id: 'notation' }); } },
            icon('arrowLeft', 18), 'How to read moves'),
        next ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { go('lesson', { id: next.id }); } },
          'Stage ' + (i + 2) + ': ' + next.title, icon('arrowRight', 18))
          : h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { go('watch'); } },
            'Watch a full solve', icon('arrowRight', 18)))));

    if (player) {
      player.start();
      addKeys(cleanups, function (e) { return player.key(e); });
    }
  }

  // ================================================================ LESSON: notation primer
  function mountNotation(el, cleanups) {
    var L = Ls(), C = Cube();
    var NOT = (L && L.NOTATION) || [];
    var byToken = {}, byId = {};
    NOT.forEach(function (x) { if (x.token) byToken[x.token] = byToken[x.token] || x; if (x.id) byId[x.id] = x; });
    var concepts = NOT.filter(function (x) { return !x.token || x.id === 'two'; });
    var runner = createRunner();
    var view = null;
    var speed = nearestSpeed(settings().animSpeed);
    var mode = 'explore';
    var chain = Promise.resolve(), gen = 0;
    var history = [];
    var lastBtn = null;
    var moveButtons = {};
    var activeQuiz = null;

    function infoFor(tok) {
      var info = C.moveInfo(tok);
      var entry = byToken[tok] || (info.amount === 2 && !info.rotation ? byId.two : null) || byToken[info.base] || null;
      // The primer's own titles where it has one for this exact move ("U': top layer, back the
      // other way"); otherwise the same style built from moveInfo ("D2: bottom layer, half turn").
      var own = entry && entry.token === tok && entry.id !== 'two';
      var lbl = String(info.label || '');
      lbl = lbl.charAt(0).toLowerCase() + lbl.slice(1);
      var gen = tok + ': ' + lbl + (info.amount === 2 ? ', half turn' : info.amount === 3 ? ', the other way' : '');
      return {
        tok: tok,
        title: own ? entry.title : gen,
        text: info.text,
        tip: entry ? entry.tip : ''
      };
    }

    // ---- explore mode
    var infoHost = h('div', { 'aria-live': 'polite' });
    var histHost = h('div');
    function showInfo(tok) {
      UI().empty(infoHost);
      if (!tok) {
        infoHost.appendChild(h('p', { class: 'muted m-0' }, 'Press a move. The arrow shows the turn first, then the cube makes it.'));
        return;
      }
      var x = infoFor(tok);
      infoHost.appendChild(h('div', { class: 'cc-minfo' },
        h('span', { class: 'cc-minfo__tok' }, x.tok),
        h('div', { class: 'cc-minfo__body' },
          h('p', { class: 'strong' }, x.title),
          h('p', null, x.text),
          x.tip ? h('p', { class: 'small muted' }, h('strong', null, 'Tip: '), x.tip) : null)));
    }
    function showHistory() {
      UI().empty(histHost);
      if (!history.length) return;
      histHost.appendChild(h('div', { class: 'stack stack-xs' },
        h('p', { class: 'small strong m-0' }, 'Your moves so far'),
        UI().algChips(history.slice(-24), { size: 'sm', done: true, label: 'Moves so far' })));
    }
    function resetChain() { gen++; chain = Promise.resolve(); runner.stop(); if (view && view.isBusy()) view.cancel(); if (view) view.showArrow(null); }
    async function doMove(tok, g, isUndo) {
      if (g !== gen || !view) return;
      if (!isUndo) {
        showInfo(tok);
        if (lastBtn) lastBtn.classList.remove('is-last');
        lastBtn = moveButtons[tok] || null;
        if (lastBtn) lastBtn.classList.add('is-last');
      }
      view.showArrow(tok);
      await runner.wait(arrowLead(speed) * (isUndo ? 0.5 : 1.1));
      if (g !== gen) return;
      await view.play([tok], {
        speed: speed,
        onMove: function () { if (isUndo) history.pop(); else history.push(tok); }
      });
      if (g !== gen) return;
      view.showArrow(null);
      showHistory();
      markActive();
    }
    function enqueue(tok) {
      var g = gen;
      chain = chain.then(function () { return doMove(tok, g, false); }).catch(function (e) { if (root.console) console.error(e); });
    }
    function undo() {
      var g = gen;
      chain = chain.then(function () {
        var last = history[history.length - 1];
        if (!last) return null;
        return doMove(invertMove(last), g, true);
      }).catch(function (e) { if (root.console) console.error(e); });
    }
    function resetCube() {
      resetChain();
      history = [];
      if (lastBtn) lastBtn.classList.remove('is-last');
      lastBtn = null;
      if (view) view.setState(learnSolved());
      showInfo(null);
      showHistory();
    }

    function mvButton(tok) {
      var b = h('button', {
        type: 'button', class: 'btn btn-secondary btn-sm cc-mv', title: moveText(tok), 'aria-label': tok + ': ' + moveText(tok),
        onClick: function () { enqueue(tok); }
      }, tok);
      moveButtons[tok] = b;
      return b;
    }
    var explorePanel = h('div', { class: 'stack' },
      h('div', { class: 'card card-sm stack stack-sm' },
        h('p', { class: 'small strong m-0' }, 'Turn a face'),
        h('div', { class: 'cc-mvrows' }, FACE_ROWS.map(function (r) {
          return h('div', { class: 'cc-mvrow' }, h('span', { class: 'cc-mvrow__label' }, r[1]),
            mvButton(r[0]), mvButton(r[0] + "'"), mvButton(r[0] + '2'));
        })),
        h('p', { class: 'small strong m-0 mt-2' }, 'Turn the whole cube'),
        h('div', { class: 'cc-mvrot' }, ROTATIONS.map(mvButton)),
        h('div', { class: 'row row-sm mt-2' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: undo }, icon('arrowLeft', 16), 'Undo'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: resetCube }, icon('refresh', 16), 'Reset cube')),
        h('p', { class: 'cc-hint m-0' }, settings().keyboard === 'cstimer'
          ? 'Keyboard: your cstimer key layout works here too.'
          : 'Keyboard: press a letter to turn that face (R), or Shift + the letter to turn it the other way (R\').')),
      h('div', { class: 'card card-sm stack stack-sm' }, infoHost, histHost));

    // ---- quiz mode ("name that move")
    var quizHost = h('div', { class: 'stack' });
    var NQ = { items: [], i: 0, right: 0, rnd: rng(Date.now() >>> 0) };
    function nqStart() {
      resetChain();
      var pool = shuffle(NQ_POOL.slice(), NQ.rnd);
      NQ.items = pool.slice(0, NQ_COUNT);
      NQ.i = 0; NQ.right = 0;
      nqAsk();
    }
    async function nqPlay(tok) {
      resetChain();
      var t = runner.begin();
      if (!view) return;
      view.setState(learnSolved());
      await runner.wait(700);
      if (!runner.alive(t)) return;
      await view.play([tok], { speed: Math.min(speed, 1) });
    }
    function nqAsk() {
      UI().empty(quizHost);
      activeQuiz = null;
      if (NQ.i >= NQ.items.length) { nqSummary(); return; }
      var tok = NQ.items[NQ.i];
      var o = moveOptions(tok, NQ.rnd);
      var q = quizBlock({
        context: 'Question ' + (NQ.i + 1) + ' of ' + NQ.items.length,
        prompt: 'Watch the cube. Which move was that?',
        options: o.options.map(function (t) { return { label: t, mono: true }; }),
        answer: o.answer,
        explain: tok + ' — ' + moveText(tok) + '.'
      }, function (correct, i, fb) {
        if (correct) NQ.right++;
        recordDrill('notation', correct);
        var nextBtn = h('button', {
          type: 'button', class: 'btn btn-primary btn-sm',
          onClick: function () { NQ.i++; nqAsk(); }
        }, NQ.i + 1 < NQ.items.length ? 'Next question' : 'See my score', icon('arrowRight', 16));
        fb.appendChild(h('div', { class: 'row row-sm mt-2' }, nextBtn));
        focusQuietly(nextBtn);
      });
      activeQuiz = q;
      quizHost.appendChild(h('div', { class: 'card card-sm stack stack-sm' },
        q.el,
        h('div', { class: 'row row-sm' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { nqPlay(tok); } }, icon('refresh', 16), 'Show it again'))));
      nqPlay(tok);
    }
    function nqSummary() {
      var r = NQ.right, total = NQ.items.length;
      var msg = r === total ? 'Perfect! You can read moves. Time for stage 1.'
        : r >= total - 1 ? 'Nearly perfect. One more round and it will stick.'
          : 'Keep going: try the moves you missed in “Try the moves”, then have another go.';
      quizHost.appendChild(h('div', { class: 'card stack stack-sm' },
        h('p', { class: 'eyebrow' }, 'Your score'),
        h('p', { class: 'cc-score m-0' }, r + ' / ' + total),
        h('p', { class: 'm-0' }, msg),
        h('div', { class: 'row row-sm' },
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: nqStart }, icon('refresh', 16), 'Another 5'),
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: function () { go('lesson', { id: 'daisy' }); } }, 'Start stage 1: The Daisy', icon('arrowRight', 16)))));
    }

    var panelHost = h('div', { class: 'stack' });
    var modeBtns = [];
    var modeSeg = h('div', { class: 'segmented segmented-block', role: 'group', 'aria-label': 'Mode' },
      [['explore', 'Try the moves'], ['quiz', 'Name that move']].map(function (m) {
        var b = h('button', { type: 'button', 'aria-pressed': String(mode === m[0]), onClick: function () { setMode(m[0]); } }, m[1]);
        b.dataset.mode = m[0];
        modeBtns.push(b);
        return b;
      }));
    function setMode(m) {
      mode = m;
      modeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === m)); });
      UI().empty(panelHost);
      resetChain();
      activeQuiz = null;
      if (m === 'explore') {
        history = [];
        if (lastBtn) lastBtn.classList.remove('is-last');
        lastBtn = null;
        if (view) view.setState(learnSolved());
        showInfo(null); showHistory();
        panelHost.appendChild(explorePanel);
      } else {
        panelHost.appendChild(quizHost);
        nqStart();
      }
    }

    var vp = h('div', { class: 'viewport-3d cc-player__vp' });
    var spd = speedControl(speed, function (v) { speed = v; if (view) view.setSpeed(v); settings().animSpeed = v; saveData(); });

    el.appendChild(h('div', { class: 'stack stack-lg cc-lesson' },
      h('div', { class: 'row row-between' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { go('learn'); } }, icon('arrowLeft', 16), 'All lessons')),
      h('header', { class: 'm-0' },
        h('p', { class: 'eyebrow' }, 'Start here'),
        h('h1', null, 'How to read moves'),
        h('p', { class: 'lead m-0' }, 'Cube guides write moves as letters. Learn the six letters and two marks, and every lesson opens up.')),
      h('ol', { class: 'cc-concepts' }, concepts.map(function (x) {
        return h('li', null, h('article', { class: 'card card-sm cc-concept' },
          h('h3', null, x.title),
          h('p', null, x.text),
          x.tip ? h('p', { class: 'small muted' }, x.tip) : null));
      })),
      h('section', { class: 'stack stack-sm', 'aria-labelledby': 'cc-not-try' },
        sectionHead('Try every move', 'Yellow on top, green in front. Press a move: the arrow appears first, then the turn.'),
        h('div', { class: 'solve-layout cc-not-layout' },
          h('div', { class: 'solve-layout__stage' }, vp,
            h('div', { class: 'cc-ctrls__opts' }, spd.el,
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { if (view) view.resetCamera(); } }, 'Reset view'))),
          h('div', { class: 'solve-layout__panel' }, modeSeg, panelHost))),
      h('nav', { class: 'row row-between', 'aria-label': 'Next' },
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { go('drills', { tab: 'drills', type: 'notation' }); } },
          icon('zap', 18), 'Notation drill'),
        h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('lesson', { id: 'daisy' }); } },
          'Start stage 1: The Daisy', icon('arrowRight', 18)))));
    var tryHead = el.querySelector('.cc-sec-head h2');
    if (tryHead) tryHead.id = 'cc-not-try';

    view = makeViewer(vp, { interactive: true, turnable: false, state: learnSolved(), speed: speed, label: 'Practice cube, yellow on top and green in front' });
    setMode('explore');

    addKeys(cleanups, function (e) {
      var dg = digit(e);
      if (mode === 'quiz' && dg && activeQuiz && !activeQuiz.answered()) { activeQuiz.choose(dg - 1); return true; }
      if (mode !== 'explore' || isSpace(e) || nativeArrows(e)) return false;
      var K = CC().Keys;
      if (!K || typeof K.toMove !== 'function') return false;
      var tok = null;
      try { tok = K.toMove(e, settings().keyboard || 'simple'); } catch (err) { tok = null; }
      if (!tok) return false;
      enqueue(tok);
      return true;
    });
    cleanups.push(function () { gen++; runner.stop(); if (view) view.dispose(); view = null; });
  }

  var lessonScreen = {
    title: function (p) {
      var id = p && (p.id || p.stage);
      if (!id || id === 'notation') return 'How to read moves';
      var s = lessonStage(id);
      return s ? s.title : 'Lesson';
    },
    mount: function (el, params) {
      params = params || {};
      injectStyle();
      var cleanups = beginCleanups('lesson');
      var id = params.id || params.stage || 'notation';
      if (id === 'notation') { mountNotation(el, cleanups); return; }
      var st = isStageId(id) ? lessonStage(id) : null;
      if (!st) {
        el.appendChild(h('section', { class: 'card empty-state' },
          h('div', { class: 'empty-state__icon' }, icon('learn', 28)),
          h('h2', { class: 'h3' }, 'That lesson doesn’t exist'),
          h('p', { class: 'muted' }, 'The link may be out of date. Pick a lesson from the list.'),
          h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('learn'); } }, 'All lessons')));
        return;
      }
      mountStageLesson(el, st, cleanups);
    },
    unmount: function () { runCleanups('lesson'); }
  };

  // ================================================================ WATCH
  var watchScreen = {
    title: function (p) {
      var s = p && isStageId(p.stage) ? lessonStage(p.stage) : null;
      return s ? 'Watch: ' + s.title : 'Watch a full solve';
    },
    mount: function (el, params) {
      params = params || {};
      injectStyle();
      var cleanups = beginCleanups('watch');
      var C = Cube(), S = Solver();
      var stageParam = isStageId(params.stage) ? params.stage : null;
      var seed = params.seed != null && params.seed !== '' && isFinite(Number(params.seed)) ? (Number(params.seed) >>> 0) : newSeed();
      var stageInfo = stageParam ? lessonStage(stageParam) : null;

      var sel = h('select', {
        class: 'select select-inline', 'aria-label': 'What to watch',
        onChange: function () { go('watch', sel.value ? { stage: sel.value } : {}); }
      }, h('option', { value: '' }, 'Full solve'),
      stageList().map(function (s, i) { return h('option', { value: s.id }, 'Stage ' + (i + 1) + ': ' + s.name); }));
      sel.value = stageParam || '';

      var head = h('header', { class: 'page-head m-0' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Watch & learn · no cube needed'),
          h('h1', null, stageInfo ? 'Watch: ' + stageInfo.title : 'Watch a full solve'),
          h('p', { class: 'muted' }, stageInfo
            ? 'A cube with the earlier stages done. Watch how this stage is solved, step by step.'
            : 'A randomly scrambled cube, solved one stage at a time with the method you are learning.')),
        h('div', { class: 'row row-sm' }, h('span', { class: 'small muted' }, 'Watch'), sel));

      if (!C || !S || typeof S.solve !== 'function') {
        el.appendChild(h('div', { class: 'stack stack-lg cc-watch' }, head,
          UI().callout('warn', 'The solver didn’t load', 'Reload the page to try again. Lessons and demos still work.')));
        return;
      }

      var plan, startState, scrambleToks, holding;
      try {
        if (stageParam) {
          var dsx = S.drillScramble(stageParam, seed);
          startState = dsx.state; scrambleToks = dsx.scramble; holding = dsx.holding || 'Yellow on top, green in front';
        } else {
          scrambleToks = C.scramble(25, seed);
          startState = C.applyAlg(C.solved(), scrambleToks);
          holding = 'White on top, green in front';
        }
        plan = S.solve(startState);
      } catch (e) {
        if (root.console) console.error('[CC learn] watch plan failed', e);
        el.appendChild(h('div', { class: 'stack stack-lg cc-watch' }, head,
          UI().callout('danger', 'Couldn’t set up this cube', String(e && e.message || e)),
          h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('watch', stageParam ? { stage: stageParam, seed: newSeed() } : { seed: newSeed() }); } },
            icon('refresh', 18), 'Try another cube')));
        return;
      }

      // Flatten the plan into steps (only the chosen stage in stage mode).
      var flat = [];
      var skippedBefore = {};
      var pendingSkipped = [];
      plan.stages.forEach(function (stg, si) {
        if (stageParam && stg.id !== stageParam) return;
        if (!stg.steps.length) { if (!stageParam) pendingSkipped.push(stg); return; }
        stg.steps.forEach(function (sp, k) {
          if (k === 0 && pendingSkipped.length) { skippedBefore[flat.length] = pendingSkipped; pendingSkipped = []; }
          flat.push({ stage: stg, stageIndex: si, step: sp, k: k, count: stg.steps.length });
        });
      });
      var N = flat.length;
      var endState = N ? flat[N - 1].step.endState : startState;

      var runner = createRunner();
      var view = null;
      var rnd = rng((seed ^ 0x5bd1e995) >>> 0);
      var W = {
        started: false, playing: false, pos: 0, sub: 'intro', moveIdx: 0,
        speed: nearestSpeed(settings().animSpeed), auto: true,
        q: {}, sinceQ: 0, score: { right: 0, total: 0 }, introShownFor: -1
      };
      var segChips = [];
      var activeQuiz = null;
      var trackKey = null;

      // ---- DOM
      var trackHost = h('div');
      var vp = h('div', { class: 'viewport-3d cc-player__vp' });
      var capTok = h('span', { class: 'cc-movecap__tok' });
      var capText = h('span', { class: 'cc-movecap__text' });
      var cap = h('div', { class: 'cc-movecap', hidden: true, 'aria-hidden': 'true' }, capTok, capText);
      vp.appendChild(cap);
      var panel = h('div', { class: 'stack', 'aria-live': 'polite' });

      var btnPrev = iconButton('arrowLeft', 'Previous step', function () { prevStep(); });
      var btnPlay = h('button', { type: 'button', class: 'btn btn-primary cc-play', onClick: function () { togglePlay(); } });
      var btnNext = iconButton('arrowRight', 'Next step', function () { nextStep(); });
      var btnSkip = stageParam ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { skipStage(); } }, 'Skip to next stage');
      var stepCount = h('span', { class: 'cc-ctrls__count small muted' });
      var spd = speedControl(W.speed, function (v) { W.speed = v; if (view) view.setSpeed(v); settings().animSpeed = v; saveData(); });
      var autoT = toggleControl('Auto-continue', W.auto, function (on) { W.auto = on; });
      var antT = toggleControl('Anticipate: ask me first', settings().anticipate !== false, function (on) {
        settings().anticipate = on;
        saveData();
        if (!on && W.sub === 'ask') { var q = W.q[W.pos]; if (q && !q.done) { W.q[W.pos] = undefined; W.sub = 'show'; renderPanel(); } }
      });

      el.appendChild(h('div', { class: 'stack stack-lg cc-watch' },
        head,
        trackHost,
        h('div', { class: 'solve-layout cc-reflow' },
          h('div', { class: 'solve-layout__stage' },
            vp,
            h('div', { class: 'cc-ctrls', role: 'group', 'aria-label': 'Playback' }, btnPrev, btnPlay, btnNext, btnSkip, stepCount),
            h('div', { class: 'cc-ctrls__opts' }, spd.el, autoT.el, antT.el),
            h('p', { class: 'cc-hint m-0 mt-2' }, 'Keys: Space play/pause · → next step · ← previous step · 1–4 answer.')),
          h('div', { class: 'solve-layout__panel' }, panel))));

      // ---- helpers
      function stageOf(pos) { return flat[pos] ? flat[pos].stage : null; }
      function anticipate() { return settings().anticipate !== false; }
      function stageNum(stg) { return stageIndex(stg.id) + 1; }
      function isFirstOfStage(pos) { return pos < N && flat[pos].k === 0; }

      function renderTrack() {
        var key, node;
        if (W.pos >= N) {
          if (stageParam && !C.isSolved(endState)) {
            var ids = stageIds(), upto = ids.slice(0, stageIndex(stageParam) + 1);
            key = 'end-' + stageParam; node = function () { return UI().stageTrack(null, upto); };
          } else { key = 'solved'; node = function () { return UI().stageTrack('solved'); }; }
        } else {
          var id = stageOf(W.pos).id;
          key = id; node = function () { return UI().stageTrack(id); };
        }
        if (key === trackKey) return;
        trackKey = key;
        UI().empty(trackHost);
        trackHost.appendChild(node());
      }

      function renderControls() {
        UI().empty(btnPlay);
        var ended = W.started && W.pos >= N;
        if (W.playing) { btnPlay.appendChild(icon('pause', 18)); btnPlay.appendChild(document.createTextNode('Pause')); }
        else if (!W.started) { btnPlay.appendChild(icon('play', 18)); btnPlay.appendChild(document.createTextNode('Start')); }
        else if (ended) { btnPlay.appendChild(icon('refresh', 18)); btnPlay.appendChild(document.createTextNode('Watch again')); }
        else { btnPlay.appendChild(icon('play', 18)); btnPlay.appendChild(document.createTextNode('Play')); }
        btnPlay.setAttribute('aria-label', W.playing ? 'Pause' : !W.started ? 'Start watching' : ended ? 'Watch this solve again' : 'Play');
        btnPrev.disabled = !W.started || (W.pos === 0 && W.moveIdx === 0);
        btnNext.disabled = W.started && W.pos >= N;
        if (btnSkip) btnSkip.disabled = !W.started || W.pos >= N;
        stepCount.textContent = !W.started ? N + ' steps' : W.pos >= N ? 'Done' : 'Step ' + (W.pos + 1) + ' of ' + N;
        var ph = panel.querySelector('.cc-paused-hint');
        if (ph) ph.hidden = !!W.playing;
        renderTrack();
      }

      function setCap(tok) {
        if (!tok) { cap.hidden = true; return; }
        capTok.textContent = tok;
        capTok.className = 'cc-movecap__tok' + (rotationClass(tok) ? ' is-rotation' : '');
        capText.textContent = moveText(tok);
        cap.hidden = false;
      }

      function updateMoves() {
        var it = flat[W.pos];
        if (!it) return;
        var total = it.step.moves.length;
        var cur = W.sub === 'play' && W.moveIdx < total ? W.moveIdx : -1;
        var done = W.sub === 'done' ? total : W.moveIdx;
        segChips.forEach(function (sc) {
          var lc = cur >= sc.off && cur < sc.off + sc.len ? cur - sc.off : -1;
          sc.chips.update({ current: lc, done: clamp(done - sc.off, 0, sc.len) });
        });
        var nl = panel.querySelector('.cc-nextline');
        if (nl) {
          if (W.moveIdx < total && (W.sub === 'play' || W.sub === 'show')) {
            var tok = it.step.moves[W.moveIdx];
            nl.textContent = (W.sub === 'play' ? 'Now: ' : 'First move: ') + tok + ' — ' + moveText(tok);
          } else nl.textContent = W.moveIdx >= total ? 'Step done.' : '';
        }
      }

      // ---- questions
      function questionFor(pos) {
        if (!anticipate()) return null;
        if (W.q[pos] !== undefined) return W.q[pos];
        var sp = flat[pos].step, q = null;
        if (sp.quiz && Array.isArray(sp.quiz.options) && sp.quiz.options.length > 1) {
          q = {
            kind: 'quiz', prompt: sp.quiz.prompt, answer: sp.quiz.answer, explain: sp.quiz.explain,
            options: sp.quiz.options.map(function (o) { return { label: String(o) }; })
          };
        } else if (sp.kind !== 'rotate' && W.sinceQ >= 2 && sp.moves.length && !/^[xyz]/.test(sp.moves[0])) {
          // (whole-cube rotations are skipped: guessing which way to hold the cube isn't a useful prediction)
          var first = sp.moves[0];
          var mo = moveOptions(first, rnd);
          q = {
            kind: 'next', prompt: 'What’s the next move?',
            answer: mo.answer,
            options: mo.options.map(function (t) { return { label: t, mono: true, sub: moveText(t) }; }),
            explain: 'It’s ' + first + ': ' + moveText(first) + '. ' + (sp.explain || '')
          };
        }
        if (q) W.sinceQ = 0; else W.sinceQ++;
        W.q[pos] = q;
        return q;
      }

      // ---- panel cards
      function readyCard() {
        var first = flat[0];
        var sn = stageParam ? stageNum({ id: stageParam }) : 0;
        var doneBefore = sn <= 1 ? 'It is freshly scrambled.' : sn === 2 ? 'Stage 1 is already done.' : 'Stages 1 to ' + (sn - 1) + ' are already done.';
        return h('section', { class: 'card cc-wcard' },
          h('p', { class: 'eyebrow' }, stageParam ? 'Stage ' + sn + ' only' : 'A fresh scramble'),
          h('h2', { class: 'h3' }, 'Ready when you are'),
          h('p', { class: 'm-0' }, stageParam
            ? 'This cube is held ' + holding.toLowerCase() + '. ' + doneBefore + ' Watch how ' + (stageInfo ? stageInfo.title : 'this stage') + ' gets solved.'
            : 'Here is a cube scrambled with these 25 moves, held ' + holding.toLowerCase() + ' (the way you would scan it):'),
          stageParam ? null : UI().algChips(scrambleToks, { size: 'sm', label: 'Scramble' }),
          h('p', { class: 'small muted m-0' }, 'The coach will solve it in ' + plural(N, 'step') + (stageParam ? '' : ', stage by stage') + '. ' +
            (anticipate() ? 'Anticipate is on: before some steps I’ll stop and ask what you think comes next.' : 'Turn on “Anticipate” to be asked what comes next.')),
          h('div', { class: 'row row-sm' },
            h('button', { type: 'button', class: 'btn btn-primary', onClick: start }, icon('play', 18), 'Start watching'),
            h('span', { class: 'cc-hint' }, 'or press Space')),
          first ? null : UI().callout('info', 'Nothing to do', 'This cube is already solved.'));
      }

      function introCard(it, pos) {
        var info = lessonStage(it.stage.id) || { title: it.stage.name, goal: it.stage.goal, tagline: '', algorithms: [] };
        var algs = (info.algorithms || []).map(algInfo).filter(Boolean);
        var skipped = skippedBefore[pos] || [];
        return h('section', { class: 'card cc-wcard step-card' },
          h('p', { class: 'eyebrow' }, 'Stage ' + stageNum(it.stage) + ' of ' + stageIds().length + ' · ' + plural(it.count, 'step')),
          h('h2', { class: 'h3' }, info.title),
          h('p', { class: 'm-0' }, h('strong', null, 'Goal: '), info.goal || it.stage.goal),
          info.tagline ? h('p', { class: 'muted m-0' }, info.tagline) : null,
          algs.length ? h('div', { class: 'stack stack-xs' },
            h('p', { class: 'small strong m-0' }, 'Tool: ' + algs.map(function (a) { return a.name; }).join(' or ')),
            algs.map(function (a) { return chipsOrNote(a.notation, 'sm'); })) : h('p', { class: 'small muted m-0' }, 'No algorithm here: just logic.'),
          skipped.length ? h('p', { class: 'small muted m-0' }, skipped.map(function (s) { return s.name; }).join(' and ') +
            (skipped.length === 1 ? ' was' : ' were') + ' already done on this cube, so we skip ' + (skipped.length === 1 ? 'it.' : 'them.')) : null,
          h('div', { class: 'row row-sm' },
            W.playing ? h('span', { class: 'cc-hint' }, 'Starting in a moment…') : h('button', {
              type: 'button', class: 'btn btn-primary btn-sm', onClick: function () { W.sub = 'ask'; play(); }
            }, icon('play', 16), 'Continue'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { go('lesson', { id: it.stage.id }); } }, icon('learn', 16), 'Read the lesson')));
      }

      function eyebrowFor(it) {
        return 'Stage ' + stageNum(it.stage) + ': ' + (lessonStage(it.stage.id) || { short: it.stage.name }).short + ' · step ' + (it.k + 1) + ' of ' + it.count;
      }

      function askCard(it, q, pos) {
        var qb = quizBlock({
          context: q.kind === 'quiz' ? 'Look at the cube first' : 'Anticipate',
          prompt: q.prompt,
          options: q.options,
          answer: q.answer,
          explain: q.explain
        }, function (correct, i, fb) {
          q.done = true; q.correct = correct;
          W.score.total++; if (correct) W.score.right++;
          recordDrill('predict', correct);
          markActive();
          var cont = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: function () { W.sub = 'show'; play(); } }, icon('play', 16), 'Continue');
          fb.appendChild(h('div', { class: 'row row-sm mt-2' }, cont));
          focusQuietly(cont);
          activeQuiz = null;
        }, {
          onSkip: function () { q.done = true; q.skipped = true; W.sub = 'show'; activeQuiz = null; play(); }
        });
        activeQuiz = qb;
        // Questions about "this corner / this edge" need the piece named and highlighted; for shape
        // and position questions the step title or highlight would give the answer away.
        var showPiece = q.kind === 'next' || !!PIECE_QUIZ_STAGES[it.stage.id];
        var focus = it.step.focus && it.step.focus.length ? it.step.focus : null;
        if (view && W.moveIdx === 0) view.highlight(showPiece ? focus : null);
        return h('section', { class: 'card cc-wcard cc-askcard' },
          h('p', { class: 'eyebrow' }, eyebrowFor(it)),
          showPiece ? h('h2', { class: 'h3' }, it.step.title) : null,
          showPiece && focus ? h('p', { class: 'small muted m-0' }, q.kind === 'next'
            ? 'The arrow is hidden. The glowing stickers show the piece. Where would you turn first?'
            : 'The glowing stickers show the piece this question is about.') : null,
          qb.el);
      }

      function stepCard(it) {
        var sp = it.step;
        segChips = [];
        var off = 0;
        var segs = (sp.segments && sp.segments.length ? sp.segments : [{ label: '', moves: sp.moves }]).map(function (sg) {
          var chips = UI().algChips(sg.moves, { size: 'sm', label: sg.label || 'Moves' });
          segChips.push({ chips: chips, off: off, len: sg.moves.length });
          off += sg.moves.length;
          return h('div', { class: 'cc-seg' }, sg.label ? h('p', { class: 'cc-seg__label' }, sg.label) : null, chips);
        });
        var badges = [];
        if (sp.case && sp.case.name) badges.push(h('span', { class: 'badge badge-info' }, 'Case: ' + sp.case.name));
        if (sp.alg && sp.alg.name) badges.push(h('span', { class: 'badge badge-accent' }, sp.alg.name + (sp.alg.reps > 1 ? ' × ' + sp.alg.reps : '')));
        var q = W.q[W.pos];
        return h('section', { class: 'card cc-wcard step-card' },
          h('p', { class: 'eyebrow' }, eyebrowFor(it)),
          h('h2', { class: 'h3' }, sp.title),
          badges.length ? h('div', { class: 'row row-sm' }, badges) : null,
          sp.explain ? h('p', { class: 'm-0' }, sp.explain) : null,
          h('div', null, segs),
          h('p', { class: 'cc-nextline' }),
          q && q.done && !q.skipped ? h('p', { class: 'small subtle m-0' }, q.correct ? 'You predicted this one correctly.' : 'You’ll spot it next time.') : null,
          h('p', { class: 'cc-hint m-0 cc-paused-hint', hidden: !!W.playing }, 'Paused. Press Play (Space) to continue, or → for the next step.'));
      }

      function endCard() {
        var sc = W.score;
        var stg = stageInfo;
        return h('section', { class: 'card cc-wcard' },
          h('p', { class: 'eyebrow' }, stageParam ? 'Stage done' : 'Solved'),
          h('h2', { class: 'h3' }, stageParam ? (stg ? stg.title : 'Stage') + ' — done!' : 'Solved!'),
          h('p', { class: 'm-0' }, stageParam
            ? 'That took ' + plural(N, 'step') + '. Watch another, then try one yourself.'
            : 'The coach used ' + plan.moveCount + ' face turns in ' + plural(N, 'step') + '. You’ll get faster than that once you look ahead.'),
          sc.total ? h('div', { class: 'stack stack-xs' },
            h('p', { class: 'small muted m-0' }, 'Your predictions'),
            h('p', { class: 'cc-score m-0' }, sc.right + ' / ' + sc.total),
            h('p', { class: 'small m-0' }, sc.right === sc.total ? 'Every one right. You are anticipating, not just watching.'
              : sc.right * 2 >= sc.total ? 'Good: more right than wrong. Watch another and beat it.'
                : 'Predicting is hard at first. It gets easier with every solve you watch.')) : null,
          h('div', { class: 'row row-sm' },
            h('button', {
              type: 'button', class: 'btn btn-primary',
              onClick: function () { go('watch', stageParam ? { stage: stageParam, seed: newSeed() } : { seed: newSeed() }); }
            }, icon('refresh', 18), 'Watch another'),
            h('button', {
              type: 'button', class: 'btn btn-secondary',
              onClick: function () { go('solve', stageParam ? { device: 'virtual', source: 'drill', stage: stageParam } : { device: 'virtual', source: 'scramble' }); }
            }, icon('cube', 18), 'Try one on the virtual cube'),
            stageParam ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: function () { go('lesson', { id: stageParam }); } }, icon('learn', 18), 'Read the lesson')
              : h('button', { type: 'button', class: 'btn btn-ghost', onClick: function () { go('learn'); } }, icon('learn', 18), 'Back to lessons')));
      }

      function renderPanel() {
        UI().empty(panel);
        segChips = [];
        activeQuiz = null;
        if (!W.started) panel.appendChild(readyCard());
        else if (W.pos >= N) panel.appendChild(endCard());
        else {
          var it = flat[W.pos];
          var pq = W.sub === 'ask' ? questionFor(W.pos) : null;
          if (W.sub === 'intro') { W.introShownFor = W.pos; panel.appendChild(introCard(it, W.pos)); }
          else if (pq && !pq.done) panel.appendChild(askCard(it, pq, W.pos));
          else { panel.appendChild(stepCard(it)); updateMoves(); }
        }
        renderControls();
      }

      // ---- flow
      function focusStep() {
        var it = flat[W.pos];
        if (view && it) view.highlight(it.step.focus && it.step.focus.length ? it.step.focus : null);
      }
      function advance() {
        if (view) view.highlight(null);
        W.pos++;
        W.moveIdx = 0;
        W.sub = isFirstOfStage(W.pos) ? 'intro' : 'ask';
      }
      function finish() {
        runner.stop();
        W.playing = false;
        W.pos = N; W.moveIdx = 0;
        setCap(null);
        if (view) { view.highlight(null); view.showArrow(null); }
        renderPanel();
        markActive();
      }

      async function loop(t) {
        while (runner.alive(t)) {
          if (W.pos >= N) { finish(); return; }
          var it = flat[W.pos];
          if (W.sub === 'intro') {
            setCap(null);
            renderPanel();
            if (!W.auto) { W.playing = false; renderPanel(); return; }
            await runner.wait(Math.max(2600, readMs(it.stage.goal, 1)) / W.speed);
            if (!runner.alive(t)) return;
            W.sub = 'ask';
            continue;
          }
          if (W.sub === 'ask') {
            var q = questionFor(W.pos);
            if (q && !q.done) {
              W.playing = false;
              setCap(null);
              if (view) view.showArrow(null);
              renderPanel();
              revealQuestion(panel.firstChild, vp);
              return;
            }
            W.sub = 'show';
            continue;
          }
          if (W.sub === 'show') {
            renderPanel();
            focusStep();
            markActive();
            var first = it.step.moves[0];
            if (view && first) view.showArrow(first);
            setCap(first || null);
            await runner.wait(readMs(it.step.explain, W.speed));
            if (!runner.alive(t)) return;
            W.sub = 'play';
            continue;
          }
          if (W.sub === 'play') {
            var mv = it.step.moves;
            while (W.moveIdx < mv.length) {
              var k = W.moveIdx, tok = mv[k];
              updateMoves();
              setCap(tok);
              if (view) view.showArrow(tok);
              await runner.wait(arrowLead(W.speed));
              if (!runner.alive(t)) return;
              await playMove(k, tok);
              if (!runner.alive(t)) return;
              if (view) view.showArrow(null);
              updateMoves();
              await runner.wait(moveGap(W.speed));
              if (!runner.alive(t)) return;
            }
            W.sub = 'done';
            setCap(null);
            updateMoves();
            continue;
          }
          if (W.sub === 'done') {
            await runner.wait(900 / W.speed);
            if (!runner.alive(t)) return;
            advance();
            if (!W.auto && W.pos < N) { W.playing = false; renderPanel(); return; }
            continue;
          }
          W.sub = 'ask';
        }
      }
      function playMove(k, tok) {
        return view.play([tok], { speed: W.speed, onMove: function () { W.moveIdx = k + 1; } });
      }

      function stopRun() {
        runner.stop();
        W.playing = false;
        if (view && view.isBusy()) view.cancel();
        if (view) view.showArrow(null);
      }
      function play() {
        if (!view) return;
        if (!W.started) { start(); return; }
        if (W.pos >= N) { restartAll(); }
        if (W.sub === 'ask') { var q = W.q[W.pos]; if (q && !q.done) { revealQuestion(panel.firstChild, vp); return; } }
        if (W.sub === 'intro' && W.introShownFor === W.pos && !W.playing) W.sub = 'ask';
        W.playing = true;
        renderControls();
        loop(runner.begin());
      }
      function pause() {
        stopRun();
        setCap(null);
        renderPanel();
      }
      function togglePlay() { if (W.playing) pause(); else play(); }
      function start() {
        if (W.started || !view) return;
        W.started = true;
        W.pos = 0; W.moveIdx = 0; W.sub = 'intro'; W.introShownFor = -1;
        markActive();
        if (!N) { finish(); return; }
        W.playing = true;
        renderControls();
        loop(runner.begin());
      }
      function restartAll() {
        stopRun();
        W.pos = 0; W.moveIdx = 0; W.sub = 'intro'; W.introShownFor = -1;
        // Watching again = another chance to anticipate: ask afresh and start a new score.
        W.q = {}; W.sinceQ = 0; W.score = { right: 0, total: 0 };
        if (view) { view.highlight(null); view.setState(startState); }
      }
      function nextStep() {
        if (!W.started) { start(); return; }
        if (W.pos >= N) return;
        var was = W.playing;
        stopRun();
        if (W.sub === 'intro') W.sub = 'ask';
        else {
          if (view) view.setState(flat[W.pos].step.endState);
          advance();
        }
        setCap(null);
        markActive();
        if (W.pos >= N) { finish(); return; }
        if (was) play(); else renderPanel();
      }
      function prevStep() {
        if (!W.started) return;
        var was = W.playing && W.pos < N;
        stopRun();
        if (W.pos >= N) W.pos = N - 1;
        else if (W.moveIdx === 0 && W.sub !== 'play' && W.sub !== 'done' && W.pos > 0) W.pos--;
        W.moveIdx = 0;
        W.sub = 'show';
        if (view) view.setState(flat[W.pos].step.startState);
        setCap(null);
        focusStep();
        markActive();
        if (was) play(); else renderPanel();
      }
      function skipStage() {
        if (!W.started || W.pos >= N) return;
        var was = W.playing;
        stopRun();
        var cur = flat[W.pos].stage.id, j = W.pos;
        while (j < N && flat[j].stage.id === cur) j++;
        if (j >= N) { if (view) view.setState(endState); finish(); return; }
        W.pos = j; W.moveIdx = 0; W.sub = 'intro'; W.introShownFor = -1;
        if (view) { view.highlight(null); view.setState(flat[j].step.startState); }
        setCap(null);
        if (was) play(); else renderPanel();
      }

      // ---- go
      view = makeViewer(vp, { interactive: true, turnable: false, state: startState, speed: W.speed, label: 'Cube being solved' });
      renderPanel();
      var ivl = setInterval(function () { if (W.playing) markActive(); }, 15000);

      addKeys(cleanups, function (e) {
        var dg = digit(e);
        if (dg && activeQuiz && !activeQuiz.answered()) { activeQuiz.choose(dg - 1); return true; }
        if (isSpace(e)) { if (nativeSpace(e)) return false; togglePlay(); return true; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          if (nativeArrows(e)) return false;
          if (e.key === 'ArrowRight') nextStep(); else prevStep();
          return true;
        }
        return false;
      });
      cleanups.push(function () {
        runner.stop();
        clearInterval(ivl);
        W.playing = false;
        if (view) view.dispose();
        view = null;
      });
    },
    unmount: function () { runCleanups('watch'); }
  };

  // ================================================================ register
  if (root.CC && root.CC.App && typeof root.CC.App.registerScreen === 'function') {
    root.CC.App.registerScreen('learn', learnScreen);
    root.CC.App.registerScreen('lesson', lessonScreen);
    root.CC.App.registerScreen('watch', watchScreen);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      learn: learnScreen, lesson: lessonScreen, watch: watchScreen,
      _moveOptions: moveOptions, _weekFor: weekFor, _nearestSpeed: nearestSpeed,
      _coveredByExtras: coveredByExtras, _mirrorText: mirrorText
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
