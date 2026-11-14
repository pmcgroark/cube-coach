/* Cube Coach — the Middle Layer Gym screen ('gym').
 *
 * Route: go('gym')                 the hub: the four problems in the learner's own words, every drill
 *                                  with its progress, and a "Start with this" suggestion
 *        go('gym', { drill: id })  a round of that drill (CC.Gym.session), one question at a time
 *
 * Phone first (390×844): answers sit under the picture, big enough for a thumb; on a wide screen the
 * picture moves to the left and the questions to the right. Exactly one CC.View3D per mounted
 * screen (created for the round, reused for every item, disposed on unmount). Pictures that have
 * to be shown side by side (left/right views, checkpoint choices, before/now) are CC.TopView SVGs.
 *
 * Every answer is checked by CC.Gym.check and recorded with CC.Gym.record (data.gym + Coach
 * drill stats), then saved. The screen keeps the phone awake while a round runs.
 */
(function (root) {
  'use strict';

  function CC() { return root.CC || {}; }
  function Cube() { return CC().Cube; }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function safe(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function warn(msg, err) { if (root.console && root.console.warn) root.console.warn('[gym] ' + msg, err || ''); }
  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  // ================================================================== pure helpers (tested in node)
  var ROUND = { halves: 4, slowmo: 4, sprint: 3 };   // long items get shorter rounds; everything else 10
  function roundSize(drillId) {
    var G = CC().Gym, d = G && G.drill(drillId);
    if (!d || d.kind === 'route') return 0;
    return ROUND[drillId] || 10;
  }

  function progressOf(entry) {
    var G = CC().Gym;
    if (!isObj(entry)) return { tried: false, recentRight: 0, recentN: 0, pct: 0, strong: false, bestMs: null, total: 0, streak: 0 };
    var rec = Array.isArray(entry.recent) ? entry.recent.slice(-10) : [];
    var right = rec.reduce(function (a, x) { return a + (x ? 1 : 0); }, 0);
    var total = Number(entry.total) || 0;
    return {
      tried: total > 0 || rec.length > 0, recentRight: right, recentN: rec.length,
      pct: rec.length ? Math.round(right / rec.length * 100) : 0,
      strong: G && G.isStrong ? !!G.isStrong(entry) : right >= 8,
      bestMs: entry.bestMs != null && isFinite(entry.bestMs) ? Number(entry.bestMs) : null,
      total: total, streak: Number(entry.streak) || 0
    };
  }

  // The cube held yellow up, green in front (so two states can be compared however they are held).
  function norm(s) {
    var C = Cube(), r = safe(function () { return C.rotationTo(s, 'Y', 'G'); }, null);
    return r && r.length ? C.applyAlg(s, r) : s;
  }
  function sameState(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sameHeld(a, b) { return sameState(norm(a), norm(b)); }

  // How far along `moves` (from `start`) the cube `now` is: { at, off:false } — or { at:-1, off:true }
  // when it is not on the way at all. A half turn done as one quarter turn so far: half:true.
  function follow(start, moves, nowState) {
    var C = Cube(), n = norm(nowState), st = start;
    for (var k = 0; k <= moves.length; k++) {
      if (sameState(n, norm(st))) return { at: k, off: false };
      if (k === moves.length) break;
      if (C.amountOf(moves[k]) === 2) {
        var b = C.baseOf(moves[k]);
        if (sameState(n, norm(C.applyMove(st, b))) || sameState(n, norm(C.applyMove(st, b + "'")))) return { at: k, off: false, half: true };
      }
      st = C.applyMove(st, moves[k]);
    }
    return { at: -1, off: true };
  }
  function faceTurns(toks) {
    var C = Cube();
    return (toks || []).filter(function (t) { return !C.isRotation(t); }).length;
  }
  // A 'decide' item's moves = turn the cube (rot) + line up (turn) + the algorithm.
  function decideParts(item) {
    var mv = item.moves || [], turnId = item.steps && item.steps[2] ? item.steps[2].answer : 'none';
    var nTurn = turnId === 'none' ? 0 : 1, nAlg = 8;
    var rot = mv.slice(0, Math.max(0, mv.length - nAlg - nTurn));
    return { rot: rot, turn: mv.slice(rot.length, rot.length + nTurn), alg: mv.slice(mv.length - nAlg) };
  }
  var DECIDE_STAGE = { edge: 'top', centre: 'both', turn: 'both', side: 'pics' };   // the diagram shows side stickers the 3D view hides
  var STAGE = { spot: 'top', lineup: 'both', leftright: 'pics', landmark: 'pics', whereami: 'pics', mirror: 'none' };
  // Which picture an item (or a step of 'decide') is shown with: '3d' | 'top' | 'both' | 'pics' | 'none'.
  function stageFor(item, stepIndex) {
    if (!item) return '3d';
    if (item.drillId === 'decide') {
      var st = item.steps && item.steps[stepIndex || 0];
      return DECIDE_STAGE[st && st.id] || '3d';
    }
    return STAGE[item.drillId] || '3d';
  }
  // The flat pictures look at the side the algorithm works on.
  function isoSide(item) { return item && item.alg === 'left' ? 'left' : 'right'; }
  function pieceHl(state, edge) {
    var C = Cube();
    if (!state || !edge) return null;
    var e = safe(function () { return C.findEdge(state, edge[0], edge[1]); }, null);
    var k = safe(function () { return C.findCorner(state, 'W', edge[0], edge[1]); }, null);
    var out = [];
    if (e) out = out.concat(e.stickers);
    if (k) out = out.concat(k.stickers);
    return out.length ? out : null;
  }
  function isMoveLabel(s) { return typeof s === 'string' && /^[URFDLBMESxyz](?:'|2)?$/.test(s); }

  // ================================================================== styles
  var STYLE_ID = 'cc-style-gym';
  var CSS = [
    '.gy [hidden] { display: none !important; }',
    '.gy * { scroll-margin-top: calc(var(--topbar-h, 60px) + 12px); scroll-margin-bottom: calc(var(--bottomnav-h, 0px) + env(safe-area-inset-bottom, 0px) + 12px); }',
    '.gy button { touch-action: manipulation; }',

    /* ---- hub */
    '.gy-hub__head .lead { max-width: 60ch; }',
    '.gy-hub__head h1 { margin: 0 0 4px; }',
    '.gy-sug { display: flex; flex-direction: column; gap: var(--space-2); }',
    '.gy-sug__row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }',
    '.gy-sug__name { margin: 0; font-size: var(--text-xl); font-weight: 750; line-height: 1.2; }',
    '.gy-sug__why { margin: 0; color: var(--text-2); }',
    '.gy-sug .btn { align-self: flex-start; }',
    '@media (max-width: 520px) { .gy-sug .btn { align-self: stretch; } }',
    '.gy-groups { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); }',
    '@media (min-width: 960px) { .gy-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } }',
    '.gy-group { display: flex; flex-direction: column; gap: var(--space-2); }',
    '.gy-group.is-suggested { border-color: var(--accent-soft-2); box-shadow: 0 0 0 1px var(--accent-soft-2), var(--shadow-1); }',
    '.gy-group__title { margin: 0; font-size: var(--text-xl); line-height: 1.25; }',
    '.gy-drills { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.gy-drills > li { margin: 0; }',
    '.gy-drill { -webkit-appearance: none; appearance: none; display: flex; align-items: flex-start; gap: var(--space-3); width: 100%; min-height: 64px; margin: 0; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: border-color var(--dur-1), background var(--dur-1); }',
    '.gy-drill:hover { border-color: var(--accent-soft-2); background: var(--surface-2); }',
    '.gy-drill:active { background: var(--surface-3); }',
    '.gy-drill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.gy-drill.is-next { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }',
    '.gy-drill__icon { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: var(--accent-soft); color: var(--accent-text); }',
    '.gy-drill.is-strong .gy-drill__icon { background: var(--success-soft); color: var(--success-text); }',
    '.gy-drill__body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }',
    '.gy-drill__name { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-weight: 650; line-height: 1.3; }',
    '.gy-drill__desc { font-size: var(--text-sm); color: var(--text-2); line-height: 1.4; }',
    '.gy-drill__meta { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: var(--text-xs); color: var(--text-3); line-height: 1.4; }',
    '.gy-drill__meta > span { display: inline-flex; align-items: center; gap: 4px; }',
    '.gy-drill__go { flex: none; align-self: center; color: var(--text-3); }',
    '.gy-bar { display: block; height: 4px; margin-top: 4px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }',
    '.gy-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }',
    '.gy-drill.is-strong .gy-bar > span { background: var(--success); }',
    '.gy-algs > summary { cursor: pointer; font-weight: 650; list-style-position: inside; }',
    '.gy-algs[open] > summary { margin-bottom: var(--space-3); }',
    '.gy-algrow { display: flex; flex-direction: column; gap: 6px; }',
    '.gy-algrow + .gy-algrow { margin-top: var(--space-4); }',
    '.gy-algrow__name { margin: 0; font-weight: 650; }',

    /* ---- move chips (two halves of four) */
    '.gy-strip { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 14px; min-width: 0; }',
    '.gy-strip__half { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
    '.gy-strip__name { font-size: var(--text-xs); font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; }',
    '.gy-chips { display: flex; gap: 5px; list-style: none; margin: 0; padding: 0; }',
    '.gy-chips > li { margin: 0; }',
    '.gy-chip { display: flex; flex-direction: column; align-items: center; gap: 2px; }',
    '.gy-chip > b { display: grid; place-items: center; min-width: 2.45em; height: 2.1em; padding: 0 .35em; border-radius: 9px; border: 1.5px solid var(--border-strong); background: var(--surface); color: var(--text); font: 800 1.05rem/1 var(--font-mono); transition: background var(--dur-1), color var(--dur-1), transform var(--dur-1); }',
    '.gy-chip > small { font-size: 0.7rem; color: var(--text-3); line-height: 1.2; white-space: nowrap; }',
    '.gy-chip.is-hidden > b { border-style: dashed; background: var(--surface-2); color: var(--text-3); }',
    '.gy-chip.is-done > b { opacity: .42; }',
    '.gy-chip.is-current > b { background: var(--accent); border-color: transparent; color: var(--on-accent); transform: translateY(-1px) scale(1.06); }',
    '.gy-chip.is-right > b { border-color: var(--success); background: var(--success-soft); color: var(--success-text); opacity: 1; }',
    '.gy-chip.is-wrong > b { border-color: var(--danger); background: var(--danger-soft); color: var(--danger-text); opacity: 1; }',
    '.gy-chip.is-shown > b { border-color: var(--accent-soft-2); }',
    '.gy-chip.is-fixed > b { border-color: var(--warn); background: var(--warn-soft); color: var(--warn-text); opacity: 1; }',   /* the right move, after a wrong guess */
    '@media (max-width: 440px) { .gy-chip > b { min-width: 2.15em; height: 2em; font-size: .95rem; border-radius: 8px; } .gy-chips { gap: 4px; } .gy-strip { gap: 6px 10px; } .gy-chip > small { font-size: .66rem; } }',

    /* ---- runner */
    '.gy-run { display: flex; flex-direction: column; gap: var(--space-3); }',
    '.gy-run__head { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }',
    '.gy-run__titles { flex: 1 1 auto; min-width: 0; }',
    '.gy-run__name { margin: 0; font-weight: 750; line-height: 1.25; overflow-wrap: anywhere; }',
    '.gy-run__count { margin: 0; font-size: var(--text-sm); color: var(--text-3); }',
    '.gy-run__stats { display: flex; align-items: center; gap: 6px; flex: none; }',
    '.gy-pill { display: inline-flex; align-items: center; gap: 4px; min-height: 30px; padding: 3px 10px; border-radius: 99px; border: 1px solid var(--border); background: var(--surface); font-size: var(--text-sm); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }',
    '.gy-pill--streak { color: var(--warn-text); background: var(--warn-soft); border-color: var(--warn-border); }',
    '.gy-pill:empty { display: none; }',
    '.gy-dots { display: flex; gap: 5px; list-style: none; margin: 0; padding: 0; }',
    '.gy-dots > li { flex: 1 1 0; max-width: 56px; height: 7px; margin: 0; border-radius: 99px; background: var(--surface-3); }',
    '.gy-dots > li.is-current { background: var(--accent-soft-2); box-shadow: inset 0 0 0 1.5px var(--accent); }',
    '.gy-dots > li.is-right { background: var(--success); }',
    '.gy-dots > li.is-wrong { background: var(--danger); }',
    '.gy-q { margin: 0; font-size: var(--text-lg); font-weight: 650; line-height: 1.38; letter-spacing: -0.01em; }',
    '@media (min-width: 720px) { .gy-q { font-size: var(--text-xl); } }',
    '.gy-q:focus { outline: none; }',
    '.gy-run__body { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }',
    '.gy-extra { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }',
    '.gy-extra:empty, .gy-answer:empty, .gy-fb:empty { display: none; }',
    '.gy-stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); align-items: center; min-width: 0; }',
    '.gy-stage.is-both { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }',
    '.gy-stage.is-none { display: none; }',
    '.gy .gy-view { aspect-ratio: 4 / 3; min-height: 0; max-height: 46vh; max-height: 46dvh; }',
    '@media (max-width: 520px) { .gy .gy-view { aspect-ratio: 1 / 0.74; min-height: 0; max-height: 38vh; max-height: 38dvh; } }',
    '.gy .gy-stage.is-both .gy-view { aspect-ratio: 1 / 1; }',
    '.gy .gy-view.gy-view--big { aspect-ratio: 1 / 0.92; max-height: 50vh; max-height: 50dvh; }',
    '@media (max-width: 520px) { .gy .gy-view.gy-view--big { aspect-ratio: 1 / 0.72; max-height: 36vh; max-height: 36dvh; } }',
    '@media (max-width: 520px) { .gy .gy-view.gy-view--small { aspect-ratio: 1 / 0.6; max-height: 30vh; max-height: 30dvh; } }',
    '.gy-cap { grid-column: 1 / -1; margin: 0; min-height: 1.45em; font-size: var(--text-sm); color: var(--text-2); text-align: center; line-height: 1.45; }',
    '.gy-cap:empty { display: none; }',
    '.gy-cap .mono { font-weight: 800; color: var(--text); }',
    '.gy-top { display: flex; justify-content: center; min-width: 0; }',
    '.gy-top .cc-tv { width: min(100%, 340px); }',
    '.gy-stage.is-both .gy-top .cc-tv { width: 100%; }',
    '.gy-stage.is-both .gy-top .cc-tv__cap { display: none; }',
    '.gy-pics { display: grid; gap: var(--space-2); grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; }',
    '.gy-pics--1 { grid-template-columns: minmax(0, 1fr); justify-items: center; }',
    '.gy-pic { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; padding: 12px 8px 10px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: radial-gradient(90% 80% at 50% 38%, var(--stage-glow) 0%, var(--stage-bg) 100%); }',
    '.gy-pic .cc-iso { width: 100%; }',
    '.gy-pic .cc-iso svg { width: 100%; max-width: 190px; margin: 0 auto; }',
    '.gy-pics--1 .gy-pic { width: min(100%, 300px); }',
    '.gy-pics--1 .gy-pic .cc-iso svg { max-width: 230px; }',
    '.gy-pics--small .gy-pic { width: min(100%, 220px); padding: 8px 6px 6px; }',
    '.gy-pics--small .gy-pic .cc-iso svg { max-width: 130px; }',
    '.gy-pic__label { margin: 0; font-size: var(--text-sm); font-weight: 700; color: var(--text-2); text-align: center; line-height: 1.3; }',
    'button.gy-pic { -webkit-appearance: none; appearance: none; margin: 0; border-width: 2px; color: inherit; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }',
    'button.gy-pic:hover:not(:disabled) { border-color: var(--accent); }',
    'button.gy-pic:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    'button.gy-pic:disabled { cursor: default; }',
    '.gy-pic.is-correct { border-color: var(--success); box-shadow: 0 0 0 2px var(--success-border); }',
    '.gy-pic.is-wrong { border-color: var(--danger); box-shadow: 0 0 0 2px var(--danger-border); }',
    '.gy-pick3 { display: grid; gap: var(--space-2); grid-template-columns: repeat(3, minmax(0, 1fr)); }',
    '.gy-pick3 .gy-pic { padding: 8px 4px 8px; }',
    '.gy-answered .gy-pic:not(.is-correct):not(.is-wrong) { opacity: .55; }',

    /* ---- answers */
    '.gy-answer { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }',
    '.gy-opts { display: grid; gap: var(--space-2); grid-template-columns: repeat(2, minmax(0, 1fr)); }',
    '.gy-opts--list { grid-template-columns: minmax(0, 1fr); }',
    '.gy-opts--colours { grid-template-columns: repeat(2, minmax(0, 1fr)); }',
    '.gy-opt { -webkit-appearance: none; appearance: none; position: relative; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px; min-width: 0; min-height: 60px; margin: 0; padding: 10px 14px; border-radius: var(--radius); border: 1.5px solid var(--border-strong); background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: border-color var(--dur-1), background var(--dur-1), opacity var(--dur-2), transform var(--dur-1); }',
    '.gy-opt:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }',
    '.gy-opt:active:not(:disabled) { transform: scale(.985); }',
    '.gy-opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.gy-opt:disabled { cursor: default; }',
    '.gy-opt__label { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 1.02rem; line-height: 1.28; }',
    '.gy-opt__tok { font: 800 1.4rem/1 var(--font-mono); }',
    '.gy-opt__key { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-3); font-size: 0.72rem; font-weight: 700; flex: none; }',
    '@media (pointer: coarse) { .gy-opt__key { display: none; } }',
    '.gy-opt__sub { font-size: var(--text-sm); color: var(--text-2); line-height: 1.35; }',
    '.gy-opt.is-picked { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent); }',
    '.gy-opt.is-correct { border-color: var(--success); background: var(--success-soft); opacity: 1; }',
    '.gy-opt.is-wrong { border-color: var(--danger); background: var(--danger-soft); opacity: 1; animation: quiz-shake .35s var(--ease); }',
    '.gy-answered .gy-opt:not(.is-correct):not(.is-wrong) { opacity: .5; }',
    '.gy-opt--lr { align-items: center; text-align: center; min-height: 68px; }',
    '.gy-opt--lr .gy-opt__label { font-size: 1.25rem; font-weight: 750; }',
    '.gy-opt .colour-dot { width: 1.25em; height: 1.25em; }',
    '.gy-hint { margin: 0; font-size: var(--text-sm); color: var(--text-3); }',
    '.gy-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }',
    '.gy-inline > .gy-hint { min-width: 3.6em; font-weight: 650; }',
    '.gy-note { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: var(--text-sm); line-height: 1.45; background: var(--surface-2); border: 1px solid var(--border); }',
    '.gy-note.is-right { background: var(--success-soft); border-color: var(--success-border); }',
    '.gy-note.is-wrong { background: var(--warn-soft); border-color: var(--warn-border); }',
    '.gy-steps { display: flex; gap: 4px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }',
    '.gy-steps > li { margin: 0; padding: 3px 10px; border-radius: 99px; font-size: var(--text-xs); font-weight: 700; background: var(--surface-2); color: var(--text-3); border: 1px solid var(--border); }',
    '.gy-steps > li.is-current { background: var(--accent); color: var(--on-accent); border-color: transparent; }',
    '.gy-steps > li.is-right { background: var(--success-soft); color: var(--success-text); border-color: var(--success-border); }',
    '.gy-steps > li.is-wrong { background: var(--danger-soft); color: var(--danger-text); border-color: var(--danger-border); }',
    '.gy-slots { display: flex; gap: 5px; flex-wrap: wrap; list-style: none; margin: 0; padding: 0; }',
    '.gy-pad8 { display: grid; gap: var(--space-2); grid-template-columns: repeat(4, minmax(0, 1fr)); }',
    '.gy-pad8 .gy-opt { align-items: center; min-height: 58px; padding: 6px; }',
    '.gy-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
    '.gy-row > .btn { flex: 1 1 auto; }',
    '.gy-card { padding: var(--space-4); border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: var(--space-2); }',
    '.gy-card p { margin: 0; }',
    '.gy-card__title { font-weight: 750; font-size: var(--text-lg); }',

    /* ---- feedback */
    '.gy-fb { min-width: 0; }',
    '.gy-fbcard { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); border: 1.5px solid var(--border); background: var(--surface); box-shadow: var(--shadow-1); }',
    '.gy-fbcard.is-right { border-color: var(--success-border); background: var(--success-soft); }',
    '.gy-fbcard.is-wrong { border-color: var(--danger-border); background: var(--danger-soft); }',
    '.gy-fbcard__title { margin: 0; display: flex; align-items: center; gap: 8px; font-size: var(--text-lg); font-weight: 750; }',
    '.gy-fbcard.is-right .gy-fbcard__title { color: var(--success-text); }',
    '.gy-fbcard.is-wrong .gy-fbcard__title { color: var(--danger-text); }',
    '.gy-fbcard__lead { margin: 0; font-weight: 650; }',
    '.gy-fbcard__text { margin: 0; line-height: 1.5; }',
    '.gy-fbcard__acts { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-1); }',
    '.gy-fbcard__acts .btn { flex: 1 1 auto; }',

    /* ---- doing it on the cube */
    '.gy-perf { display: flex; flex-direction: column; gap: var(--space-2); }',
    '.gy-perf .cc-pad { max-width: none; }',
    '.gy .cc-pad-btn:disabled { opacity: .45; cursor: default; }',
    '.gy-ctrls { display: grid; gap: var(--space-2); grid-template-columns: repeat(4, minmax(0, 1fr)); }',
    '.gy-ctrls .btn { padding-inline: 6px; gap: 4px; }',
    '@media (max-width: 440px) { .gy-ctrls .btn .icon { display: none; } }',
    '.gy-mine { margin: 0; min-height: 1.5em; font-size: var(--text-sm); color: var(--text-2); overflow-wrap: anywhere; }',
    '.gy-mine .mono { color: var(--text); font-weight: 700; }',
    '.gy-kbd { margin: 0; font-size: var(--text-xs); color: var(--text-3); }',
    '@media (pointer: coarse) { .gy-kbd { display: none; } }',
    '.gy-placed { font-weight: 700; }',

    /* ---- slow motion with a real cube */
    '.gy-slow { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: var(--space-4); border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); text-align: center; }',
    '.gy-big { margin: 0; font: 800 clamp(2.8rem, 14vw, 5rem)/1 var(--font-mono); letter-spacing: -0.02em; color: var(--accent-text); }',
    '@media (max-width: 520px) { .gy-slow { padding: var(--space-3); } .gy-big__plain { font-size: var(--text-md); } }',
    '.gy-big__plain { margin: 0; font-size: var(--text-lg); font-weight: 650; line-height: 1.35; }',
    '.gy-big__word { margin: 0; font-size: var(--text-sm); color: var(--text-3); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }',

    /* ---- end of round */
    '.gy-sum { display: flex; flex-direction: column; gap: var(--space-4); }',
    '.gy-score { margin: 0; font-size: clamp(2.6rem, 12vw, 3.6rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1; }',
    '.gy-misses { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.gy-misses > li { margin: 0; padding: var(--space-3); border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); font-size: var(--text-sm); }',
    '.gy-misses p { margin: 0; }',

    /* ---- wide screens (and phones on their side): picture on the left, questions on the right */
    '@media (min-width: 900px), (orientation: landscape) and (max-height: 500px) and (min-width: 600px) {',
    '  .gy-run__body { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); grid-template-areas: "stage q" "stage extra" "stage answer" "stage fb" "stage rest"; grid-template-rows: auto auto auto auto 1fr; column-gap: var(--space-6); row-gap: var(--space-3); align-items: start; }',
    '  .gy-q { grid-area: q; } .gy-extra { grid-area: extra; } .gy-answer { grid-area: answer; } .gy-fb { grid-area: fb; }',
    '  .gy-stage { grid-area: stage; position: sticky; top: calc(var(--topbar-h, 60px) + var(--space-4)); }',
    '  .gy-run__body.is-nostage { grid-template-columns: minmax(0, 1fr); grid-template-areas: "q" "extra" "answer" "fb" "rest"; max-width: 760px; }',
    '  .gy .gy-view { aspect-ratio: 1 / 0.9; max-height: 64vh; }',
    '  .gy .gy-view.gy-view--big { aspect-ratio: 1 / 0.95; max-height: 66vh; }',
    '  .gy-pic .cc-iso svg { max-width: 220px; }',
    '}',
    '@media (orientation: landscape) and (max-height: 500px) and (min-width: 600px) {',
    '  .gy-run__body { column-gap: var(--space-4); }',
    '  .gy .gy-view, .gy .gy-view.gy-view--big, .gy .gy-view.gy-view--small { aspect-ratio: 1 / 0.9; max-height: calc(100vh - var(--topbar-h, 48px) - 96px); max-height: calc(100dvh - var(--topbar-h, 48px) - 96px); }',
    '  .gy-pic .cc-iso svg { max-width: 130px; }',
    '  .gy-top .cc-tv { width: min(100%, calc(100dvh - var(--topbar-h, 48px) - 70px)); }',
    '  .gy-q { font-size: var(--text-md); }',
    '}'
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ================================================================== lifecycle scope
  function Scope() { this.fns = []; this.dead = false; }
  Scope.prototype.add = function (fn) {
    if (typeof fn !== 'function') return;
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
      try { list[i](); } catch (e) { if (root.console) root.console.error('[gym] cleanup failed', e); }
    }
  };

  var GROUP_ORDER = [2, 1, 3, 4];             // the learner's own order: remembering first
  var nav = { fromHub: false };               // a round opened from the hub closes with Back
  var PRAISE = ['Right!', 'Yes!', 'Spot on.', 'Correct.', 'That’s it.'];

  // ================================================================== the screen
  var def = {
    title: function (p) {
      var G = CC().Gym, d = p && p.drill && G ? G.drill(String(p.drill)) : null;
      return d ? d.name + ' · Gym' : 'Middle Layer Gym';
    },
    mount: function (el, params) {
      injectStyle();
      params = params || {};
      var C = CC(), UI = C.UI, h = UI.h, App = C.App, G = C.Gym;
      var scope = new Scope();
      el.classList.add('gy');
      if (!G || !Cube()) {
        el.appendChild(UI.callout('danger', 'The gym couldn’t load', 'Some of the app files are missing. Reload the page to try again.'));
        return function () { scope.dispose(); };
      }
      function data() { return App.data; }
      function settings() { var d = data(); return d && isObj(d.settings) ? d.settings : {}; }
      function hasCube() { return settings().hasCube !== false; }
      function animSpeed() { var s = Number(settings().animSpeed); return s > 0 && s < 10 ? s : 1; }
      function save() { try { App.save(); } catch (e) { /* the shell reports save errors */ } }
      function active() { try { App.markActive(); } catch (e) { /* ignore */ } }
      function awake(on) { try { if (typeof App.keepAwake === 'function') App.keepAwake(!!on); } catch (e) { /* ignore */ } }
      function moveText(t) { return safe(function () { return Cube().moveInfo(t).text; }, ''); }
      function fmt(ms) { return UI.fmtTime(ms); }
      function btn(label, iconName, onClick, cls, attrs) {
        var a = { type: 'button', class: ['btn', cls || 'btn-secondary'], onClick: onClick };
        if (attrs) Object.keys(attrs).forEach(function (k) { a[k] = attrs[k]; });
        return h('button', a, iconName ? UI.icon(iconName, 18) : null, label);
      }
      function onControl(e) {
        var t = e && e.target;
        return !!(t && t.closest && t.closest('button, a[href], select, summary, input, textarea, [role="button"]'));
      }
      function scrollTo(node, block) {
        if (!node || !node.scrollIntoView) return;
        try { node.scrollIntoView({ block: block || 'nearest', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
      }

      // keyboard: one handler at a time (set by whatever is on screen)
      var keyHandler = null;
      function onKey(e) {
        if (!keyHandler || e.defaultPrevented || UI.shortcutsBlocked(e)) return;
        keyHandler(e);
      }
      document.addEventListener('keydown', onKey);
      scope.add(function () { document.removeEventListener('keydown', onKey); });

      var drillParam = params.drill ? G.drill(String(params.drill)) : null;
      if (drillParam && drillParam.kind === 'route') {
        scope.timeout(function () { App.go(drillParam.route.id, drillParam.route.params, { replace: true }); }, 0);
      } else if (drillParam) runner(drillParam);
      else hub();

      return function cleanup() {
        keyHandler = null;
        scope.dispose();
        awake(false);
      };

      // ============================================================ the hub
      function hub() {
        var d = data(), gym = d && isObj(d.gym) ? d.gym : {};
        var sug = safe(function () { return G.suggest(d, { hasCube: hasCube() }); }, null);
        var sd = sug ? G.drill(sug.drillId) : null;
        var page = h('div', { class: 'gy-hub stack stack-lg' });
        page.appendChild(h('header', { class: 'gy-hub__head' },
          h('p', { class: 'eyebrow' }, 'Stage 4 · Middle Layer'),
          h('h1', null, 'Middle Layer Gym'),
          h('p', { class: 'lead m-0' }, 'Short exercises for the four things that make the middle layer hard. Most of them need no cube: just tap. Yellow on top, white on the bottom, all the way through.')));
        if (sd) page.appendChild(suggestCard(sd, sug));
        page.appendChild(algCard());
        var groups = h('div', { class: 'gy-groups' });
        GROUP_ORDER.forEach(function (gid) { groups.appendChild(groupCard(gid, gym, sug)); });
        page.appendChild(groups);
        page.appendChild(groupCard(5, gym, sug));
        el.appendChild(page);
      }

      function suggestCard(sd, sug) {
        var p = progressOf((data().gym || {})[sd.id]);
        return h('section', { class: 'card card-accent gy-sug', 'aria-labelledby': 'gy-sug-title' },
          h('p', { class: 'eyebrow m-0', id: 'gy-sug-title' }, 'Start with this'),
          h('div', { class: 'gy-sug__row' }, h('p', { class: 'gy-sug__name' }, sd.name), p.strong ? strongBadge() : null),
          h('p', { class: 'gy-sug__why' }, sd.desc),
          G.GROUPS[sug.group - 1] && sug.group !== 5 ? h('p', { class: 'small muted m-0' }, 'Helps with “' + G.GROUPS[sug.group - 1].problem + '”.')
            : sug.reason ? h('p', { class: 'small muted m-0' }, sug.reason) : null,
          btn(sd.kind === 'route' ? 'Open it' : 'Start', 'play', function () { start(sd); }, 'btn-primary btn-lg'));
      }

      function algCard() {
        var box = h('details', { class: 'card card-sm gy-algs' },
          h('summary', null, 'The two algorithms, in two halves'));
        ['right', 'left'].forEach(function (k) {
          var A = G.ALGS[k];
          box.appendChild(h('div', { class: 'gy-algrow' },
            h('p', { class: 'gy-algrow__name' }, A.name + ' — the edge goes to the ' + A.slot + ' slot'),
            strip(A.moves, { words: words(A), halfNames: true }).el));
        });
        box.appendChild(h('p', { class: 'small muted mt-4 mb-0' }, 'Left is the mirror of right. ' + (G.MIRROR_RULE || '')));
        return box;
      }

      function groupCard(gid, gym, sug) {
        var grp = G.GROUPS[gid - 1] || { name: '', problem: '', desc: '' };
        var list = G.DRILLS.filter(function (x) { return x.group === gid; });
        var isSug = !!sug && sug.group === gid && gid !== 5;
        return h('section', { class: ['card', 'gy-group', isSug ? 'is-suggested' : null], 'aria-labelledby': 'gy-g' + gid },
          h('p', { class: 'eyebrow m-0' }, gid === 5 ? 'When the drills feel easy' : grp.name),
          h('h2', { class: 'gy-group__title', id: 'gy-g' + gid }, gid === 5 ? 'Put it together' : '“' + grp.problem + '”'),
          grp.desc ? h('p', { class: 'small muted m-0' }, grp.desc) : null,
          h('ul', { class: 'gy-drills' }, list.map(function (x) { return h('li', null, drillRow(x, gym, sug)); })));
      }

      function iconFor(x) {
        if (x.id === 'sprint') return 'timer';
        if (x.needsCube === 'real') return 'hand';
        if (x.kind === 'route' || x.kind === 'perform') return 'cube';
        if (x.kind === 'walkthrough') return 'watch';
        return 'zap';
      }
      function strongBadge() { return h('span', { class: 'badge badge-success' }, UI.icon('check', 12), 'Strong'); }

      function drillRow(x, gym, sug) {
        var p = progressOf(gym[x.id]), isNext = !!sug && sug.drillId === x.id;
        var where = x.needsCube === 'real' ? 'With your real cube' : x.needsCube === 'virtual' ? 'On the virtual cube' : 'Just tap';
        var timed = x.id === 'leftright' || x.id === 'sprint';
        var meta = x.kind === 'route' ? 'Opens a coached solve'
          : !p.tried ? 'Not tried yet'
            : p.recentRight + ' of your last ' + p.recentN + ' right' + (timed && p.bestMs != null ? ' · best ' + fmt(p.bestMs) + ' s' : '');
        return h('button', {
          type: 'button', class: ['gy-drill', p.strong ? 'is-strong' : null, isNext ? 'is-next' : null],
          onClick: function () { start(x); },
          'aria-label': x.name + '. ' + x.desc + ' ' + where + '. ' + meta + (p.strong ? '. Strong.' : '.')
        },
        h('span', { class: 'gy-drill__icon', 'aria-hidden': 'true' }, UI.icon(iconFor(x), 20)),
        h('span', { class: 'gy-drill__body', 'aria-hidden': 'true' },
          h('span', { class: 'gy-drill__name' }, x.name, p.strong ? strongBadge() : null, isNext ? h('span', { class: 'badge badge-accent' }, 'Next') : null),
          h('span', { class: 'gy-drill__desc' }, x.desc),
          h('span', { class: 'gy-drill__meta' }, h('span', null, where), h('span', null, meta)),
          p.tried && x.kind !== 'route' ? h('span', { class: 'gy-bar' }, h('span', { style: { width: p.pct + '%' } })) : null),
        h('span', { class: 'gy-drill__go', 'aria-hidden': 'true' }, UI.icon('arrowRight', 18)));
      }

      function start(x) {
        if (x.kind === 'route') { App.go(x.route.id, x.route.params); return; }
        nav.fromHub = true;
        App.go('gym', { drill: x.id });
      }

      // ============================================================ shared bits
      function words(A) {
        var out = [];
        (A.halves || []).forEach(function (hf) { String(hf.rhythm || '').split(', ').forEach(function (w) { out.push(w); }); });
        return out.length === A.moves.length ? out : null;
      }
      // Move chips in two halves of four. o: { shown:[bool], words:[str], halfNames:true|[a,b] }
      function strip(tokens, o) {
        o = o || {};
        var n = tokens.length, st = tokens.map(function (t, i) { return { shown: o.shown ? !!o.shown[i] : true, cls: null }; });
        var cur = -1, doneN = 0, lis = [];
        var groups = n === 8 ? [[0, 4], [4, 8]] : [[0, n]];
        var names = o.halfNames === true ? ['First half', 'Second half'] : Array.isArray(o.halfNames) ? o.halfNames : null;
        var elx = h('div', { class: 'gy-strip', role: 'group', 'aria-label': o.label || 'Moves' }, groups.map(function (g, gi) {
          var ol = h('ol', { class: 'gy-chips' });
          for (var i = g[0]; i < g[1]; i++) { var li = h('li', { class: 'gy-chip' }); lis[i] = li; ol.appendChild(li); }
          return h('div', { class: 'gy-strip__half' }, names && n === 8 ? h('span', { class: 'gy-strip__name' }, names[gi]) : null, ol);
        }));
        function paint() {
          lis.forEach(function (li, i) {
            UI.empty(li);
            var s = st[i];
            li.className = 'gy-chip' + (s.shown ? '' : ' is-hidden') + (i === cur ? ' is-current' : '') +
              (i < doneN && i !== cur ? ' is-done' : '') + (s.cls ? ' is-' + s.cls : '');
            li.appendChild(h('b', null, s.shown ? tokens[i] : '?'));
            if (o.words && o.words[i]) li.appendChild(h('small', null, o.words[i]));
            li.setAttribute('aria-label', 'Move ' + (i + 1) + ': ' + (s.shown ? tokens[i] + ', ' + moveText(tokens[i]) : 'hidden'));
          });
        }
        paint();
        return {
          el: elx,
          current: function (i) { cur = i; paint(); },
          done: function (k) { doneN = k; paint(); },
          show: function (i, on, cls) { if (st[i]) { st[i].shown = on !== false; if (cls !== undefined) st[i].cls = cls; } paint(); },
          mark: function (i, cls) { if (st[i]) { st[i].cls = cls; st[i].shown = true; } paint(); },
          hide: function (a, b) { for (var i = a; i < b; i++) { st[i].shown = false; st[i].cls = null; } paint(); },
          reset: function () { st.forEach(function (s, i) { s.shown = o.shown ? !!o.shown[i] : true; s.cls = null; }); cur = -1; doneN = 0; paint(); }
        };
      }

      // ============================================================ the round runner
      function runner(d) {
        var fromHub = nav.fromHub;
        nav.fromHub = false;
        var n = roundSize(d.id);
        var items = [], idx = 0, results = [], streak = 0, bestStreak = 0, roundT0 = 0, itemT0 = 0, sprintT0 = null;
        var item = null, iscope = null, settled = false, ticker = 0, timerMode = null, autoNext = 0, curTv = null;
        var gen = 0;   // animation generation: bumping it stops whatever is playing

        // ---- skeleton
        var countEl = h('p', { class: 'gy-run__count' });
        var streakEl = h('span', { class: 'gy-pill gy-pill--streak', 'aria-live': 'polite' });
        var timerEl = h('span', { class: 'gy-pill gy-pill--timer', role: 'timer', 'aria-live': 'off', hidden: true });
        var dotsEl = h('ol', { class: 'gy-dots', 'aria-label': 'Progress through the round' });
        var head = h('div', { class: 'gy-run__head' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Leave this round', title: 'Leave this round', onClick: leave }, UI.icon('arrowLeft', 20)),
          h('div', { class: 'gy-run__titles' }, h('p', { class: 'gy-run__name' }, d.name), countEl),
          h('div', { class: 'gy-run__stats' }, streakEl, timerEl));
        var promptEl = h('h2', { class: 'gy-q', tabindex: '-1' });
        var extraEl = h('div', { class: 'gy-extra' });
        var viewWrap = h('div', { class: 'viewport-3d gy-view' });
        var topEl = h('div', { class: 'gy-top', hidden: true });
        var picsEl = h('div', { class: 'gy-pics', hidden: true });
        var capEl = h('p', { class: 'gy-cap', 'aria-live': 'polite' });
        var stageEl = h('div', { class: 'gy-stage' }, viewWrap, topEl, picsEl, capEl);
        var answerEl = h('div', { class: 'gy-answer' });
        var fbEl = h('div', { class: 'gy-fb', 'aria-live': 'polite' });
        var body = h('div', { class: 'gy-run__body' }, promptEl, extraEl, stageEl, answerEl, fbEl);
        var runEl = h('div', { class: 'gy-run' }, head, dotsEl, body);
        var sumEl = h('div', { class: 'gy-sum', hidden: true });
        el.appendChild(runEl);
        el.appendChild(sumEl);
        // read-only peek at the round (for testing in the browser console)
        runEl.gymRound = function () { return { drill: d.id, item: item, index: idx, results: results.slice(), settled: settled }; };

        var view = makeView(viewWrap);
        scope.add(function () { if (ticker) clearInterval(ticker); ticker = 0; if (iscope) iscope.dispose(); });


        // ---- 3D view and animation
        function makeView(host) {
          var V = C.View3D;
          function fail() {
            host.appendChild(h('div', { class: 'viewport-3d__placeholder' }, UI.icon('cube', 28),
              h('p', { class: 'm-0' }, 'The cube view couldn’t load here. The questions still work.')));
            return null;
          }
          if (!V || typeof V.create !== 'function') return fail();
          var v;
          try { v = V.create(host, { interactive: true, turnable: false, label: 'The cube, held with yellow on top' }); } catch (e) { warn('3D view failed', e); return fail(); }
          try { v.setSpeed(animSpeed()); } catch (e) { /* ignore */ }
          scope.add(function () { try { v.onUserMove = null; v.dispose(); } catch (e) { /* ignore */ } });
          return v;
        }
        function stopAnim() {
          gen++;
          if (view) { try { view.cancel(); view.showArrow(null); } catch (e) { /* ignore */ } }
        }
        // Plays tokens one at a time, the arrow shown before each. Resolves true when finished, false
        // when stopped (another animation, a new item, leaving the screen).
        function playMoves(tokens, o) {
          o = o || {};
          var my = ++gen, toks = safe(function () { return Cube().parseAlg(tokens || []); }, []);
          var spd = animSpeed();
          return new Promise(function (resolve) {
            if (!view) { resolve(true); return; }
            var i = 0;
            function alive() { return my === gen && !scope.dead; }
            function step() {
              if (!alive()) { resolve(false); return; }
              if (i >= toks.length) { if (o.onEnd) o.onEnd(); resolve(true); return; }
              var t = toks[i];
              if (o.onMove) { try { o.onMove(i, t); } catch (e) { /* ignore */ } }
              if (o.arrows !== false) view.showArrow(t);
              scope.timeout(function () {
                if (!alive()) { resolve(false); return; }
                view.play([t]).then(function () {
                  if (!alive()) { resolve(false); return; }
                  if (o.arrows !== false) view.showArrow(null);
                  if (o.onAfter) { try { o.onAfter(i, t, view.getState()); } catch (e) { /* ignore */ } }
                  i++;
                  scope.timeout(step, (o.gap != null ? o.gap : 260) / spd);
                });
              }, o.arrows === false ? 0 : (o.lead != null ? o.lead : 650) / spd);
            }
            step();
          });
        }
        function caption(parts) { UI.empty(capEl); if (parts) capEl.appendChild(h('span', null, parts)); }
        function moveCaption(i, t, total, word) {
          caption([total ? (i + 1) + ' of ' + total + ' · ' : '', h('span', { class: 'mono' }, t), ' — ', moveText(t), word ? ' (“' + word + '”)' : '']);
        }

        // ---- stage modes
        function setMode(mode) {
          var show3d = mode === '3d' || mode === 'both';
          viewWrap.hidden = !show3d;
          topEl.hidden = !(mode === 'top' || mode === 'both');
          picsEl.hidden = mode !== 'pics';
          stageEl.className = 'gy-stage' + (mode === 'both' ? ' is-both' : '') + (mode === 'none' ? ' is-none' : '');
          body.classList.toggle('is-nostage', mode === 'none');
          if (show3d && view) { try { view.resize(); } catch (e) { /* ignore */ } }
        }
        function show3d(state, hl) {
          if (!view) return;
          view.setState(state);
          view.highlight(hl && hl.length ? hl : null);
        }
        function topView(host, state, o) {
          var tv = C.TopView.render(host, state, o);
          iscope.add(function () { tv.destroy(); if (curTv === tv) curTv = null; });
          if (!(o && o.onSelect)) curTv = tv;   // a picture beside the 3D cube: Show me keeps it in step
          return tv;
        }
        function edgeSt(state) {
          if (!item || !item.edge) return null;
          var e = safe(function () { return Cube().findEdge(state, item.edge[0], item.edge[1]); }, null);
          return e ? e.stickers.slice() : null;
        }
        function isoPic(host, state, o) {
          var p = C.TopView.renderIso(host, state, o);
          iscope.add(function () { p.destroy(); });
          return p;
        }

        // ---- round
        function startRound() {
          items = safe(function () { return G.session(d.id, { seed: (Math.random() * 4294967296) >>> 0, count: n }); }, []);
          if (!items.length) {
            runEl.hidden = true;
            sumEl.hidden = false;
            UI.empty(sumEl);
            sumEl.appendChild(UI.callout('danger', 'This drill couldn’t start', 'Something went wrong building the questions. Go back and try another drill.'));
            sumEl.appendChild(btn('Back to the gym', 'arrowLeft', leave, 'btn-primary'));
            return;
          }
          idx = 0; results = []; streak = 0; bestStreak = 0; roundT0 = now();
          runEl.hidden = false;
          sumEl.hidden = true;
          UI.empty(dotsEl);
          items.forEach(function () { dotsEl.appendChild(h('li')); });
          timerMode = d.id === 'leftright' ? 'round' : d.id === 'sprint' ? 'item' : null;
          timerEl.hidden = !timerMode;
          timerEl.textContent = timerMode ? fmt(0) : '';
          if (timerMode === 'round') startTicker();
          awake(true);
          showItem();
        }
        function startTicker() {
          if (ticker) return;
          ticker = setInterval(function () {
            if (timerMode === 'round') timerEl.textContent = fmt(now() - roundT0);
            else if (timerMode === 'item' && sprintT0 != null && !settled) timerEl.textContent = fmt(now() - sprintT0);
          }, 100);
        }
        function stopTicker() { if (ticker) clearInterval(ticker); ticker = 0; }
        function updateHead() {
          countEl.textContent = 'Question ' + (idx + 1) + ' of ' + items.length;
          UI.empty(streakEl);
          if (streak >= 2) { streakEl.appendChild(UI.icon('zap', 14)); streakEl.appendChild(document.createTextNode(streak + ' in a row')); }
          Array.prototype.forEach.call(dotsEl.children, function (li, i) {
            var r = results[i];
            li.className = r ? (r.correct ? 'is-right' : 'is-wrong') : i === idx ? 'is-current' : '';
            li.setAttribute('aria-label', 'Question ' + (i + 1) + (r ? (r.correct ? ': right' : ': wrong') : i === idx ? ': now' : ''));
          });
        }
        function setPrompt(text) { promptEl.textContent = text || ''; }

        function showItem() {
          if (iscope) iscope.dispose();
          iscope = new Scope();
          stopAnim();
          keyHandler = null;
          settled = false;
          sprintT0 = null;
          autoNext = 0;
          item = items[idx];
          itemT0 = now();
          [extraEl, answerEl, fbEl, topEl, picsEl, capEl].forEach(function (x) { UI.empty(x); });
          picsEl.className = 'gy-pics';
          viewWrap.classList.remove('gy-view--big', 'gy-view--small');
          if (item.drillId === 'slowmo') viewWrap.classList.add('gy-view--small');
          if (view) {
            view.setTurnable(false);
            view.onUserMove = null;
            show3d(item.state, item.highlight);
            try { view.resetCamera(); } catch (e) { /* ignore */ }
          }
          if (timerMode === 'item') { timerEl.textContent = fmt(0); startTicker(); }
          updateHead();
          setPrompt(item.prompt);
          var r = RENDER[item.drillId] || renderTap;
          try { r(); } catch (e) {
            warn('could not show ' + item.drillId, e);
            answerEl.appendChild(UI.callout('danger', 'This question couldn’t be shown', 'Skip to the next one.'));
            answerEl.appendChild(btn('Skip', 'arrowRight', next, 'btn-primary'));
          }
          if (idx > 0) scrollTo(runEl, 'start');
        }

        // ---- answers and feedback
        function settle(correct, explain, o) {
          if (settled) return;
          settled = true;
          o = o || {};
          var ms = o.ms != null ? o.ms : now() - itemT0;
          var timed = d.id === 'leftright' || d.id === 'sprint';
          results[idx] = { correct: !!correct, item: item, ms: ms, explain: explain };
          streak = correct ? streak + 1 : 0;
          bestStreak = Math.max(bestStreak, streak);
          var dd = data(), before = progressOf(dd && dd.gym ? dd.gym[d.id] : null).strong;
          safe(function () { G.record(dd, d.id, !!correct, timed && correct ? { ms: ms } : {}); });
          save();
          active();
          var after = progressOf(dd && dd.gym ? dd.gym[d.id] : null).strong;
          if (after && !before) { try { App.toast('“' + d.name + '” is now Strong: 8 of your last 10 right.', { kind: 'success' }); } catch (e) { /* ignore */ } }
          if (view) { view.setTurnable(false); view.onUserMove = null; }
          updateHead();
          renderFeedback(!!correct, explain, o);
        }
        function showMoves(it) {
          if (it.drillId === 'whereami') return (it.done || []).concat(it.moves || []);
          return Array.isArray(it.moves) && it.moves.length ? it.moves : null;
        }
        function showFrom(it) { return it.drillId === 'whereami' && it.startState ? it.startState : it.state; }
        function renderFeedback(correct, explain, o) {
          UI.empty(fbEl);
          var last = idx >= items.length - 1;
          var moves = o.moves !== undefined ? o.moves : showMoves(item);
          var nextB = btn(last ? 'See how you did' : 'Next', 'arrowRight', next, 'btn-primary btn-lg gy-next');
          var showB = moves && moves.length && view ? btn('Show me', 'play', function () { showMe(moves, o.from || showFrom(item)); }, 'btn-secondary btn-lg') : null;
          fbEl.appendChild(h('div', { class: ['gy-fbcard', correct ? 'is-right' : 'is-wrong'], role: 'status' },
            h('p', { class: 'gy-fbcard__title' }, UI.icon(correct ? 'check' : 'x', 20), correct ? PRAISE[idx % PRAISE.length] : 'Not quite'),
            o.lead ? h('p', { class: 'gy-fbcard__lead' }, o.lead) : null,
            explain ? h('p', { class: 'gy-fbcard__text' }, explain) : null,
            h('div', { class: 'gy-fbcard__acts' }, showB, nextB)));
          keyHandler = function (e) {
            if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); next(); }
            else if ((e.key === ' ' || e.key === 'Spacebar') && showB && !onControl(e)) { e.preventDefault(); showB.click(); }
          };
          if (d.id === 'leftright' && correct && !o.noAuto) {
            autoNext = iscope.timeout(next, 750);   // speed round: right answers move straight on
            return;
          }
          if (o.autoShow && showB) { showMe(moves, o.from || showFrom(item)); return; }
          iscope.timeout(function () {
            scrollTo(fbEl, 'nearest');
            try { nextB.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
          }, 60);
        }
        function showMe(moves, from) {
          if (autoNext) { clearTimeout(autoNext); autoNext = 0; }   // asking to see it stops a speed round moving on
          stopAnim();
          setMode(stageFor(item) === 'both' ? 'both' : '3d');
          if (!view) return;
          view.setTurnable(false);
          var hl = from === item.state && item.highlight && item.highlight.length ? item.highlight : pieceHl(from, item.edge);
          show3d(from, hl);
          if (curTv) curTv.update(from, { highlight: edgeSt(from) });
          scrollTo(stageEl, 'nearest');
          caption('Watch: ' + moves.join(' '));
          playMoves(moves, {
            lead: 700,
            onMove: function (i, t) { moveCaption(i, t, moves.length); },
            onAfter: function (i, t, stt) { if (curTv) curTv.update(stt, { highlight: edgeSt(stt) }); }
          }).then(function (ok) {
            if (ok) caption('Done.' + (item.drillId === 'whereami' ? ' Your cube was ' + (item.done || []).length + ' moves in.' : '') + ' Press Show me to watch again.');
          });
        }
        function next() {
          if (!settled) return;
          if (idx < items.length - 1) { idx++; showItem(); }
          else summary();
        }
        function leave() {
          stopAnim();
          if (fromHub) App.back();
          else App.go('gym', {}, { replace: true });
        }

        // ---- option buttons
        function options(list, onPick, o) {
          o = o || {};
          var box = h('div', { class: ['gy-opts', o.layout === 'list' ? 'gy-opts--list' : null, o.cls], role: 'group', 'aria-label': o.label || 'Answers' });
          var done = false;
          var btns = (list || []).map(function (op, i) {
            var mv = isMoveLabel(op.label);
            var b = h('button', {
              type: 'button', class: ['gy-opt', o.btnCls], dataset: { id: op.id },
              'aria-label': (op.ariaLabel || op.label) + (op.sub ? ': ' + op.sub : ''),
              onClick: function () { if (!done) { done = true; onPick(op.id, i); } }
            },
            h('span', { class: 'gy-opt__label' },
              o.keys !== false && list.length <= 9 ? h('span', { class: 'gy-opt__key', 'aria-hidden': 'true' }, String(i + 1)) : null,
              op.dot ? UI.colourDot(op.dot) : null,
              mv ? h('span', { class: 'gy-opt__tok' }, op.label) : h('span', null, op.label)),
            op.sub && o.subs !== false ? h('span', { class: 'gy-opt__sub' }, op.sub) : null);
            box.appendChild(b);
            return b;
          });
          return {
            el: box, buttons: btns,
            pick: function (i) { if (!done && btns[i]) btns[i].click(); },
            mark: function (answerId, chosenId) {
              done = true;
              box.classList.add('gy-answered');
              btns.forEach(function (b, i) {
                b.disabled = true;
                var id = list[i].id;
                if (id === answerId) b.classList.add('is-correct');
                else if (id === chosenId) b.classList.add('is-wrong');
              });
            }
          };
        }
        function digitKeys(oc) {
          return function (e) {
            if (/^[1-9]$/.test(e.key)) { e.preventDefault(); oc.pick(Number(e.key) - 1); }
          };
        }
        function note(ok, text) { return h('p', { class: ['gy-note', ok ? 'is-right' : 'is-wrong'], role: 'status' }, text); }

        // ============================================================ renderers
        var RENDER = {
          spot: renderSpot, decide: renderDecide, halves: renderHalves, mirror: renderMirror,
          recall: renderPerform, slip: renderPerform, sprint: renderPerform, 'stuck-fix': renderStuckFix,
          slowmo: renderSlowmo, leftright: renderLeftRight, landmark: renderLandmark
        };

        // Tap one answer: lineup, nextmove, stuck-spot, whereami.
        function renderTap() {
          var it = item, mode = stageFor(it);
          setMode(mode);
          if (mode === 'both') topView(topEl, it.state, { highlight: it.highlight, size: 'fill', caption: false });
          if (it.drillId === 'nextmove') {
            var A = G.ALGS[it.alg], k = (it.done || []).length;
            var sh = A.moves.map(function (t, i) { return i < k; });
            var s = strip(A.moves, { shown: sh, halfNames: true, label: 'The ' + A.name + ' algorithm so far' });
            s.done(k); s.current(k);
            extraEl.appendChild(s.el);
          }
          if (it.drillId === 'whereami') {
            picsEl.className = 'gy-pics';
            var side = isoSide(it);
            [['Before you started', it.startState], ['Your cube now', it.state]].forEach(function (x) {
              var pic = h('div', { class: 'gy-pic' });
              isoPic(pic, x[1], { side: side, highlight: pieceHl(x[1], it.edge), size: 'fill', dim: false });
              pic.appendChild(h('p', { class: 'gy-pic__label' }, x[0]));
              picsEl.appendChild(pic);
            });
          }
          var oc = options(it.options, function (id) {
            var res = G.check(it, id);
            oc.mark(it.answer, id);
            settle(res.correct, res.explain);
          }, { layout: it.drillId === 'stuck-spot' ? 'list' : null });
          answerEl.appendChild(oc.el);
          keyHandler = digitKeys(oc);
        }

        // Tap the edges with no yellow (several, or "None").
        function renderSpot() {
          var it = item, chosen = [];
          setMode('top');
          var tv = topView(topEl, it.state, { selectable: it.selectable, selected: [], onSelect: toggle, size: 'fill' });
          var none = (it.options || []).filter(function (o) { return o.id === 'none'; })[0] || { id: 'none', label: 'None of them' };
          var noneB = h('button', { type: 'button', class: 'gy-opt', 'aria-pressed': 'false', onClick: function () { if (!settled) { chosen = chosen.indexOf('none') !== -1 ? [] : ['none']; sync(); } } },
            h('span', { class: 'gy-opt__label' }, none.label), none.sub ? h('span', { class: 'gy-opt__sub' }, none.sub) : null);
          var checkB = btn('Check', 'check', checkNow, 'btn-primary btn-lg', { disabled: true });
          var hintEl = h('p', { class: 'gy-hint' }, 'Tap an edge to pick it; tap it again to change your mind.');
          answerEl.appendChild(hintEl);
          answerEl.appendChild(noneB);
          answerEl.appendChild(checkB);
          function toggle(pos) {
            if (settled) return;
            chosen = chosen.filter(function (x) { return x !== 'none'; });
            var j = chosen.indexOf(pos);
            if (j === -1) chosen.push(pos); else chosen.splice(j, 1);
            sync();
            tv.focus(pos);
          }
          function sync() {
            tv.update(null, { selected: chosen.filter(function (x) { return x !== 'none'; }) });
            var on = chosen.indexOf('none') !== -1;
            noneB.setAttribute('aria-pressed', on ? 'true' : 'false');
            noneB.classList.toggle('is-picked', on);
            checkB.disabled = !chosen.length;
          }
          function checkNow() {
            if (settled || !chosen.length) return;
            var res = G.check(it, chosen), ans = it.answer, marks = {};
            C.TopView.POSITIONS.forEach(function (p) {
              var a = ans.indexOf(p) !== -1, c = chosen.indexOf(p) !== -1;
              if (a && c) marks[p] = 'right'; else if (a) marks[p] = 'missed'; else if (c) marks[p] = 'wrong';
            });
            tv.update(null, { selected: [], selectable: [], onSelect: null, marks: marks });
            noneB.disabled = true;
            noneB.classList.remove('is-picked');
            if (ans.indexOf('none') !== -1) noneB.classList.add('is-correct');
            else if (chosen.indexOf('none') !== -1) noneB.classList.add('is-wrong');
            checkB.remove();
            hintEl.remove();
            var lead = null;
            if (res.partial) {
              var P = res.partial, wordOf = function (p) { return p === 'none' ? '“None”' : 'the ' + (C.TopView.positions()[p] || { words: p }).words + ' edge'; };
              var bits = [], extra = P.extra.filter(function (x) { return x !== 'none'; });
              if (ans.indexOf('none') !== -1) bits.push('The answer was “None of them”.');
              else if (P.extra.indexOf('none') !== -1) bits.push('Not “None”: ' + (ans.length === 1 ? 'one top edge has' : ans.length + ' top edges have') + ' no yellow.');
              else if (P.missed.length) bits.push('Missed: ' + P.missed.map(wordOf).join(', ') + '.');
              if (extra.length) bits.push('Not a middle edge: ' + extra.map(wordOf).join(', ') + '.');
              lead = bits.join(' ');
            }
            settle(res.correct, res.explain, { lead: lead });
          }
          keyHandler = function (e) {
            if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); checkNow(); }
            var m = { 1: 'UF', 2: 'UR', 3: 'UB', 4: 'UL' }[e.key];
            if (m) { e.preventDefault(); toggle(m); }
            if (e.key === '0' || e.key === 'n') { e.preventDefault(); noneB.click(); }
          };
        }

        // Left or right: the side views show both side centres; the buttons sit under the pictures.
        function lrPictures(state, hl) {
          setMode('pics');
          UI.empty(picsEl);
          picsEl.className = 'gy-pics';
          var extra = (hl || []).concat([13, 22, 40]);
          [['left', 'Seen from the left'], ['right', 'Seen from the right']].forEach(function (x) {
            var pic = h('div', { class: 'gy-pic' });
            isoPic(pic, state, { side: x[0], highlight: extra, size: 'fill' });
            pic.appendChild(h('p', { class: 'gy-pic__label' }, x[1]));
            picsEl.appendChild(pic);
          });
        }
        function lrButtons(onPick) {
          var list = [{ id: 'left', label: '← Left', ariaLabel: 'Left', sub: "U' L' U L U F U' F'" }, { id: 'right', label: 'Right →', ariaLabel: 'Right', sub: "U R U' R' U' F' U F" }];
          var oc = options(list, onPick, { btnCls: 'gy-opt--lr', subs: false, label: 'Left or right' });
          return oc;
        }
        function renderLeftRight() {
          var it = item;
          lrPictures(it.state, it.highlight);
          var oc = lrButtons(function (id) {
            var res = G.check(it, id);
            oc.mark(it.answer, id);
            settle(res.correct, res.explain);
          });
          answerEl.appendChild(oc.el);
          keyHandler = function (e) {
            if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); oc.pick(0); }
            else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); oc.pick(1); }
          };
        }

        // Pick the right picture out of three.
        function renderLandmark() {
          var it = item, side = isoSide(it);
          setMode('pics');
          picsEl.className = 'gy-pics gy-pics--1 gy-pics--small';
          var startPic = h('div', { class: 'gy-pic' });
          isoPic(startPic, it.state, { side: side, highlight: pieceHl(it.state, it.edge), size: 'fill', dim: false });
          startPic.appendChild(h('p', { class: 'gy-pic__label' }, 'Before: the T at the front'));
          picsEl.appendChild(startPic);
          var box = h('div', { class: 'gy-pick3', role: 'group', 'aria-label': 'Pictures to choose from' });
          var done = false, btns = [];
          it.options.forEach(function (op) {
            var b = h('button', { type: 'button', class: 'gy-pic', 'aria-label': op.label, onClick: function () { pick(op.id); } });
            isoPic(b, op.state, { side: side, highlight: op.highlight, size: 'fill', dim: false });
            b.appendChild(h('p', { class: 'gy-pic__label' }, op.label));
            btns.push(b);
            box.appendChild(b);
          });
          answerEl.appendChild(box);
          function pick(id) {
            if (done) return;
            done = true;
            var res = G.check(it, id);
            box.classList.add('gy-answered');
            btns.forEach(function (b, i) {
              b.disabled = true;
              if (it.options[i].id === it.answer) b.classList.add('is-correct');
              else if (it.options[i].id === id) b.classList.add('is-wrong');
            });
            settle(res.correct, res.explain);
          }
          keyHandler = function (e) {
            var k = { 1: 0, 2: 1, 3: 2, a: 0, b: 1, c: 2 }[String(e.key).toLowerCase()];
            if (k != null && it.options[k]) { e.preventDefault(); pick(it.options[k].id); }
          };
        }

        // Four quick decisions in a row: edge, centre, turn, side.
        function renderDecide() {
          var it = item, parts = decideParts(it), resp = [], k = 0;
          var names = ['Edge', 'Centre', 'Turn', 'Side'];
          var stepper = h('ol', { class: 'gy-steps', 'aria-label': 'Steps' });
          var lis = names.map(function (nm) { var li = h('li', null, nm); stepper.appendChild(li); return li; });
          extraEl.appendChild(stepper);
          showStep(0);
          function paintSteps() {
            lis.forEach(function (li, i) {
              li.className = i === k && resp[i] === undefined ? 'is-current' : resp[i] === undefined ? '' : resp[i] === it.steps[i].answer ? 'is-right' : 'is-wrong';
            });
          }
          function showStep(j) {
            k = j;
            var st = it.steps[j];
            UI.empty(answerEl); UI.empty(topEl); UI.empty(picsEl); caption(null);
            setPrompt('Step ' + (j + 1) + ' of 4. ' + st.prompt);
            paintSteps();
            var mode = stageFor(it, j);
            if (mode === '3d' || mode === 'both') { setMode(mode); show3d(st.state, st.highlight); }
            if (st.id === 'edge') {
              setMode('top');
              var tv = topView(topEl, st.state, { selectable: st.options.map(function (o) { return o.id; }), onSelect: function (pos) { answer(pos, tv); }, size: 'fill' });
              answerEl.appendChild(h('p', { class: 'gy-hint' }, 'Tap the edge on the picture.'));
              keyHandler = function (e) { var m = { 1: 'UF', 2: 'UR', 3: 'UB', 4: 'UL' }[e.key]; if (m) { e.preventDefault(); answer(m, tv); } };
            } else if (st.id === 'side') {
              lrPictures(st.state, st.highlight);
              var lr = lrButtons(function (id) { lr.mark(st.answer, id); answer(id); });
              answerEl.appendChild(lr.el);
              keyHandler = function (e) {
                if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); lr.pick(0); }
                else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); lr.pick(1); }
              };
            } else {
              topView(topEl, st.state, { highlight: st.highlight, size: 'fill', caption: false });
              var list = st.options.map(function (o) { return st.id === 'centre' ? { id: o.id, label: o.label, dot: o.id } : o; });
              var oc = options(list, function (id) { oc.mark(st.answer, id); answer(id); }, { cls: st.id === 'centre' ? 'gy-opts--colours' : null });
              answerEl.appendChild(oc.el);
              keyHandler = digitKeys(oc);
            }
          }
          function answer(id, tv) {
            if (resp[k] !== undefined) return;
            var st = it.steps[k], res = G.check(it, { step: k, id: id });
            resp[k] = id;
            keyHandler = null;
            if (tv) {
              var marks = {};
              marks[st.answer] = id === st.answer ? 'right' : 'missed';
              if (id !== st.answer) marks[id] = 'wrong';
              tv.update(null, { selectable: [], onSelect: null, marks: marks });
            }
            paintSteps();
            if (k === 3) {
              var all = G.check(it, resp);
              var right = resp.filter(function (x, i) { return x === it.steps[i].answer; }).length;
              settle(all.correct, it.explain, { lead: all.correct ? 'All four decisions right.' : 'You got ' + right + ' of the 4 decisions right.' });
              return;
            }
            answerEl.appendChild(note(res.correct, (res.correct ? 'Yes. ' : 'Not quite. ') + st.explain));
            var go = function () {
              if (scope.dead || settled) return;
              var mv = k === 1 ? parts.rot : k === 2 ? parts.turn : [];
              if (mv.length && view) {
                setMode('3d');
                playMoves(mv, { onMove: function (i, t) { moveCaption(i, t, 0); } }).then(function (ok) { if (ok) showStep(k + 1); });
              } else showStep(k + 1);
            };
            if (res.correct) iscope.timeout(go, 900);
            else {
              var c = btn('Carry on', 'arrowRight', go, 'btn-primary btn-lg');
              answerEl.appendChild(c);
              keyHandler = function (e) { if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); go(); } };
              try { c.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
              scrollTo(c, 'nearest');
            }
          }
        }

        // Learn it in halves: watch a half, then predict its moves; a checkpoint after each half.
        function renderHalves() {
          var it = item, A = G.ALGS[it.alg], resp = [], k = 0;
          setMode('3d');
          var s = strip(A.moves, { words: words(A), halfNames: true, shown: A.moves.map(function () { return false; }), label: 'The ' + A.name + ' algorithm' });
          extraEl.appendChild(s.el);
          watch(0);
          function halfCard(hf) {
            var H = A.halves[hf];
            return h('div', { class: 'gy-card' },
              h('p', { class: 'gy-card__title' }, H.name),
              h('p', null, h('span', { class: 'mono strong' }, H.moves.join(' ')), ' — “' + H.rhythm + '”'),
              H.does ? h('p', { class: 'small muted' }, H.does) : null);
          }
          function watch(hf) {
            UI.empty(answerEl);
            keyHandler = null;
            setPrompt((hf ? 'Second half' : 'First half') + ' of the ' + A.name + ' algorithm. Watch it, then you predict the moves.');
            for (var i = hf * 4; i < hf * 4 + 4; i++) s.show(i, true, 'shown');
            var hs = it.halfStates[hf];
            show3d(hs, pieceHl(hs, it.edge));
            answerEl.appendChild(halfCard(hf));
            var againB = btn('Watch again', 'refresh', run, 'btn-secondary btn-lg');
            var goB = btn('Now you try', 'arrowRight', function () { predict(hf); }, 'btn-primary btn-lg');
            answerEl.appendChild(h('div', { class: 'gy-row' }, againB, goB));
            keyHandler = function (e) { if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); predict(hf); } };
            function run() {
              show3d(hs, pieceHl(hs, it.edge));
              playMoves(A.halves[hf].moves, {
                onMove: function (i, t) { s.current(hf * 4 + i); moveCaption(hf * 4 + i, t, 8, (words(A) || [])[hf * 4 + i]); },
                onEnd: function () { s.current(-1); }
              });
            }
            run();
          }
          function predict(hf) {
            stopAnim();
            s.hide(hf * 4, hf * 4 + 4);
            show3d(it.halfStates[hf], pieceHl(it.halfStates[hf], it.edge));
            caption(null);
            k = hf * 4;
            ask();
          }
          function ask() {
            var st = it.steps[k];
            UI.empty(answerEl);
            keyHandler = null;
            s.current(k);
            if (st.ask === false) {
              setPrompt('Move ' + (k + 1) + ' of 8 is shown for you: ' + st.token + ' (“' + st.word + '”).');
              s.show(k, true, 'shown');
              playMoves([st.token], { onMove: function (i, t) { moveCaption(k, t, 8, st.word); } }).then(function (ok) { if (ok) iscope.timeout(advance, 450); });
              return;
            }
            setPrompt(st.prompt);
            var oc = options(st.options, function (id) {
              var res = G.check(it, { step: k, id: id });
              resp[k] = id;
              oc.mark(st.answer, id);
              s.mark(k, res.correct ? 'right' : 'fixed');
              answerEl.appendChild(note(res.correct, (res.correct ? 'Yes: ' : 'It’s ') + st.explain));
              keyHandler = null;
              playMoves([st.token], { onMove: function (i, t) { moveCaption(k, t, 8, st.word); } }).then(function (ok) {
                if (!ok) return;
                if (res.correct) { iscope.timeout(advance, 500); return; }
                var c = btn('Carry on', 'arrowRight', advance, 'btn-primary btn-lg');
                answerEl.appendChild(c);
                keyHandler = function (e) { if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); advance(); } };
                scrollTo(c, 'nearest');
              });
            });
            answerEl.appendChild(oc.el);
            keyHandler = digitKeys(oc);
          }
          function advance() {
            if (settled) return;
            k++;
            s.current(-1);
            if (k === 4) checkpoint(0); else if (k === 8) checkpoint(1); else ask();
          }
          function checkpoint(hf) {
            var L = (it.landmarks || [])[hf] || {};
            UI.empty(answerEl);
            setPrompt((L.title || (hf ? 'After the whole algorithm' : 'After the first half')) + ': this is what your cube should look like.');
            caption(null);
            answerEl.appendChild(h('div', { class: 'gy-card' }, h('p', null, L.text || ''), L.note ? h('p', { class: 'small muted' }, L.note) : null));
            var goB = hf === 0 ? btn('On to the second half', 'arrowRight', function () { watch(1); }, 'btn-primary btn-lg')
              : btn('Finish', 'check', finish, 'btn-primary btn-lg');
            answerEl.appendChild(goB);
            keyHandler = function (e) { if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); goB.click(); } };
            scrollTo(goB, 'nearest');
          }
          function finish() {
            var arr = it.steps.map(function (st, i) { return st.ask === false ? null : resp[i]; });
            var res = G.check(it, arr), asked = it.steps.filter(function (st) { return st.ask !== false; }).length;
            var right = res.partial ? res.partial.right : asked;
            settle(res.correct, res.explain, { lead: res.correct ? 'Every move right.' : 'You got ' + right + ' of ' + asked + ' moves right.' });
          }
        }

        // Build the mirror: tap the moves one at a time from a pad of eight.
        function renderMirror() {
          var it = item, k = 0, resp = [];
          setMode('none');
          var to = G.ALGS[it.alg] || { name: '' };
          extraEl.appendChild(h('p', { class: 'gy-hint' }, it.given.length > 1 ? 'Given:' : 'The move:'));
          extraEl.appendChild(strip(it.given, { label: 'Given moves' }).el);
          extraEl.appendChild(h('p', { class: 'gy-hint' }, 'Its mirror' + (it.given.length > 1 ? ' (' + to.name + ' algorithm)' : '') + ':'));
          var slots = strip(it.answer, { shown: it.answer.map(function () { return false; }), label: 'Your mirror' });
          extraEl.appendChild(slots.el);
          slots.current(0);
          var pad = { el: h('div', { class: 'gy-opts gy-pad8', role: 'group', 'aria-label': 'Moves' }), buttons: [] };
          it.options.forEach(function (op) {
            var b = h('button', { type: 'button', class: 'gy-opt', title: op.sub || '', 'aria-label': op.label + (op.sub ? ': ' + op.sub : ''), onClick: function () { tap(op.id); } },
              h('span', { class: 'gy-opt__label' }, h('span', { class: 'gy-opt__tok' }, op.label)));
            pad.buttons.push(b);
            pad.el.appendChild(b);
          });
          answerEl.appendChild(pad.el);
          var noteHost = h('div');
          answerEl.appendChild(noteHost);
          function tap(tok) {
            if (settled || k >= it.steps.length) return;
            var res = G.check(it, { step: k, id: tok });
            resp[k] = tok;
            var st = it.steps[k];
            slots.mark(k, res.correct ? 'right' : 'fixed');
            UI.empty(noteHost);
            noteHost.appendChild(note(res.correct, res.correct ? st.explain : 'Not ' + tok + ': ' + st.explain));
            k++;
            slots.current(k < it.steps.length ? k : -1);
            if (k >= it.steps.length) {
              pad.buttons.forEach(function (b) { b.disabled = true; });
              var all = G.check(it, resp), right = resp.filter(function (x, i) { return x === it.steps[i].answer; }).length;
              slots.reset();
              it.answer.forEach(function (t, i) { slots.mark(i, resp[i] === t ? 'right' : 'fixed'); });
              settle(all.correct, it.explain, { lead: all.correct ? 'All ' + it.steps.length + ' right: ' + it.answer.join(' ') : right + ' of ' + it.steps.length + ' right. The mirror is ' + it.answer.join(' ') + '.' });
            }
          }
          var KEYMAP = {};
          it.options.forEach(function (o) { KEYMAP[o.id] = true; });
          keyHandler = function (e) {
            var t = C.Keys && C.Keys.toMove ? C.Keys.toMove(e, 'simple') : null;
            if (t && KEYMAP[t]) { e.preventDefault(); tap(t); }
          };
        }

        // Do it on the virtual cube: recall, slip, sprint (and the second part of stuck-fix).
        function performUI(it, o) {
          o = o || {};
          setMode('3d');
          viewWrap.classList.add('gy-view--big');
          var start = it.state, made = [], turns = 0, done = false, sprint = it.drillId === 'sprint';
          show3d(start, it.highlight);
          if (view) { view.setTurnable(true); view.onUserMove = onUserMove; }
          var chips = null;
          if (it.drillId === 'recall') {
            chips = strip(it.moves, { shown: it.cues, halfNames: true, label: 'The ' + ((G.ALGS[it.alg] || {}).name || '') + ' algorithm (some moves hidden)' });
            chips.current(0);
            extraEl.appendChild(chips.el);
          } else if (it.drillId === 'slip') {
            var A = G.ALGS[it.alg];
            var didS = strip(it.done, { label: 'What you did' });
            didS.mark(it.slipIndex, 'wrong');
            extraEl.appendChild(h('div', { class: 'gy-inline' }, h('span', { class: 'gy-hint' }, 'You did'), didS.el));
            var algS = strip(A.moves, { label: 'The ' + A.name + ' algorithm' });
            algS.done(it.slipIndex); algS.current(it.slipIndex);
            extraEl.appendChild(h('div', { class: 'gy-inline' }, h('span', { class: 'gy-hint' }, A.name), algS.el));
          }
          var mine = h('p', { class: 'gy-mine', 'aria-live': 'polite' });
          var noteEl = h('p', { class: 'gy-note is-wrong', hidden: true, role: 'status' });
          var padHost = h('div');
          var pad = null;
          if (C.MovePad && typeof C.MovePad.render === 'function') {
            try { pad = C.MovePad.render(padHost, { onMove: turn, rotations: !!o.rotations }); } catch (e) { pad = null; warn('move pad failed', e); }
            if (pad) iscope.add(function () { pad.destroy(); });
          }
          var undoB = btn('Undo', 'arrowLeft', undo, 'btn-secondary btn-sm');
          var resetB = btn('Reset', 'refresh', reset, 'btn-secondary btn-sm');
          var checkB = btn('Check', 'check', checkNow, 'btn-secondary btn-sm');
          var giveB = btn(sprint ? 'Give up' : 'Show me', sprint ? 'x' : 'play', giveUp, 'btn-ghost btn-sm');
          answerEl.appendChild(h('div', { class: 'gy-perf' }, padHost,
            h('div', { class: 'gy-ctrls' }, undoB, resetB, checkB, giveB), mine, noteEl,
            h('p', { class: 'gy-kbd' }, settings().keyboard === 'cstimer'
              ? 'Keyboard: csTimer layout. Backspace undoes, Enter checks.'
              : 'Keyboard: a letter turns that side clockwise (R, U, F, L…), Shift+letter anticlockwise. Backspace undoes.')));
          if (idx === 0 || sprint) caption(sprint ? 'Drag a layer to turn it, or use the buttons. The clock starts with your first move.' : 'Drag a layer to turn it, or use the buttons below.');
          update();
          keyHandler = function (e) {
            if (done) return;
            if (e.key === 'Backspace') { e.preventDefault(); undo(); return; }
            if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); checkNow(); return; }
            var t = C.Keys && C.Keys.toMove ? C.Keys.toMove(e, settings().keyboard === 'cstimer' ? 'cstimer' : 'simple') : null;
            if (t) { e.preventDefault(); turn(t); }
          };
          function enable(on) {
            if (view) view.setTurnable(!!on);
            if (pad && pad.el) Array.prototype.forEach.call(pad.el.querySelectorAll('button'), function (b) { b.disabled = !on; });
            [undoB, resetB, checkB, giveB].forEach(function (b) { b.disabled = !on; });
          }
          function turn(tok) { if (!done && view) view.userMove(tok); }
          function onUserMove(tok) {
            if (done) return;
            if (sprintT0 == null) sprintT0 = now();
            caption(null);
            made.push(tok);
            if (!Cube().isRotation(tok)) turns++;
            active();
            update();
            var res = G.check(it, view.getState());
            if (res.correct) reached(res);
          }
          function update() {
            UI.empty(mine);
            mine.appendChild(made.length ? h('span', null, h('span', { class: 'subtle' }, 'Your moves: '), h('span', { class: 'mono' }, made.join(' ')))
              : h('span', { class: 'subtle' }, sprint ? 'Place all four middle edges.' : 'No moves yet.'));
            var cur = view ? view.finalState() : start;
            if (sprint) {
              var placed = safe(function () {
                var s = C.Solver.yellowUp(cur) || cur;
                return G.SLOTS.filter(function (sl) { return G.slotStatus(s, sl) === 'home'; }).length;
              }, 0);
              mine.appendChild(h('span', { class: 'gy-placed' }, ' · ' + placed + ' of 4 placed'));
            }
            if (chips && Array.isArray(it.moves)) {
              var f = follow(start, it.moves, cur);
              if (!f.off) { chips.done(f.at); chips.current(f.at < it.moves.length ? f.at : -1); }
              noteEl.hidden = !f.off || !made.length;
              noteEl.textContent = 'That move isn’t part of the algorithm from here. Undo it (Backspace), or press Reset.';
            }
          }
          function undo() {
            if (done || !view || !made.length || view.isBusy()) return;
            var tok = made.pop();
            if (!Cube().isRotation(tok)) turns++;
            view.play([Cube().invertMove(tok)]).then(function () {
              update();
              if (!done) { var res = G.check(it, view.getState()); if (res.correct) reached(res); }
            });
            update();
          }
          function reset() {
            if (done || !view) return;
            stopAnim();
            show3d(start, it.highlight);
            made = [];
            update();
          }
          function checkNow() {
            if (done) return;
            if (!made.length) { try { App.toast('Make your moves on the cube first.'); } catch (e) { /* ignore */ } return; }
            var st = view ? view.finalState() : start, res = G.check(it, st);
            if (res.correct) { reached(res); return; }
            var why = safe(function () { return G.goalMet(it.goal, st).why; }, null) || 'Not there yet.';
            noteEl.hidden = false;
            noteEl.textContent = why;
          }
          function reached(res) {
            if (done) return;
            done = true;
            enable(false);
            var ms = sprintT0 != null ? now() - sprintT0 : now() - itemT0;
            if (o.onDone) { o.onDone({ shown: false, turns: turns, ms: ms, res: res }); return; }
            var clean = faceTurns(it.moves || []);
            var ok = sprint || turns <= clean + 6;
            var lead = sprint ? 'Time: ' + fmt(ms) + ' s, ' + turns + ' turns.'
              : ok ? 'Done in ' + turns + (turns === 1 ? ' turn.' : ' turns.') + (turns <= clean ? ' Clean!' : '')
                : 'You got there, but it took ' + turns + ' turns (the clean way is ' + clean + '). Go for a clean one next time.';
            settle(ok, ok ? res.explain : it.explain, { lead: lead, ms: ms, moves: it.moves, from: it.state });
          }
          function giveUp() {
            if (done) return;
            done = true;
            enable(false);
            settle(false, it.explain, { lead: sprint ? 'Here is one way to do it.' : 'Watch it done, then try the next one yourself.', autoShow: true, noAuto: true });
          }
        }
        function renderPerform() {
          var it = item;
          performUI(it, { rotations: it.drillId === 'sprint' });
        }
        function renderStuckFix() {
          var it = item;
          setMode('3d');
          caption('The stuck slot is highlighted (' + ({ FR: 'front-right', FL: 'front-left', BL: 'back-left', BR: 'back-right' }[it.slot] || '') + '). Drag the cube to look round the back.');
          var oc = options(it.options, function (id) {
            var res = G.check(it, id), ok = res.correct;
            oc.mark(it.answer, id);
            keyHandler = null;
            answerEl.appendChild(note(ok, res.explain));
            var goB = btn('Now do it on the cube', 'cube', function () { doIt(ok); }, 'btn-primary btn-lg');
            answerEl.appendChild(goB);
            keyHandler = function (e) { if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); doIt(ok); } };
            scrollTo(goB, 'nearest');
          }, { layout: 'list' });
          answerEl.appendChild(oc.el);
          keyHandler = digitKeys(oc);
          function doIt(choiceOk) {
            UI.empty(answerEl);
            setPrompt(it.performPrompt || it.prompt);
            performUI(it, {
              rotations: true,
              onDone: function (r) {
                var clean = faceTurns(it.moves || []), tidy = r.turns <= clean + 6;
                var lead = !choiceOk ? 'You got it out. Next time choose “front-right, Right algorithm” straight away.'
                  : tidy ? 'Popped out in ' + r.turns + ' turns. Now it is on top, ready to put in like any other edge.'
                    : 'You got it out, but it took ' + r.turns + ' turns (the clean way is ' + clean + ').';
                settle(choiceOk && tidy, choiceOk && tidy ? r.res.explain : it.explain, { lead: lead, ms: r.ms });
              }
            });
          }
        }

        // Slow motion with a real cube: one move at a time, a checkpoint picture after each half.
        function renderSlowmo() {
          var it = item, A = G.ALGS[it.alg], side = isoSide(it), matched = [null, null];
          var s = strip(A.moves, { words: words(A), halfNames: true, label: 'The ' + A.name + ' algorithm' });
          extraEl.appendChild(s.el);
          intro();
          function intro() {
            setMode('3d');
            stopAnim();
            UI.empty(answerEl);
            matched = [null, null];
            s.done(0); s.current(-1);
            setPrompt(it.prompt);
            show3d(it.state, pieceHl(it.state, it.edge));
            caption('Like this: the edge sits right above its matching centre, at the front. Your colours can be different.');
            var goB = btn('I’m ready: first move', 'arrowRight', function () { stepAt(0); }, 'btn-primary btn-lg');
            answerEl.appendChild(goB);
            keyHandler = function (e) { if ((e.key === 'Enter' || e.key === ' ') && !onControl(e)) { e.preventDefault(); stepAt(0); } };
          }
          function stepAt(i) {
            var st = it.steps[i], before = i === 0 ? it.state : it.steps[i - 1].state;
            setMode('3d');
            UI.empty(answerEl);
            caption(null);
            s.done(i); s.current(i);
            setPrompt('Move ' + (i + 1) + ' of 8' + (i % 4 === 0 ? ' · ' + A.halves[st.half].name : '') + '. Do it on your cube.');
            answerEl.appendChild(h('div', { class: 'gy-slow', 'aria-live': 'polite' },
              h('p', { class: 'gy-big' }, st.token),
              h('p', { class: 'gy-big__plain' }, st.plain),
              st.word ? h('p', { class: 'gy-big__word' }, '“' + st.word + '”') : null));
            var backB = i > 0 ? btn('Back', 'arrowLeft', function () { stepAt(i - 1); }, 'btn-ghost btn-lg') : null;
            var againB = btn('Replay', 'refresh', play, 'btn-secondary btn-lg');
            var nextB = btn(i === 3 || i === 7 ? 'Done: check my cube' : 'Done: next move', 'arrowRight', function () { doneMove(i); }, 'btn-primary btn-lg');
            answerEl.appendChild(h('div', { class: 'gy-row' }, backB, againB, nextB));
            keyHandler = function (e) {
              if ((e.key === 'Enter' || e.key === ' ') && !onControl(e)) { e.preventDefault(); doneMove(i); }
              else if (e.key === 'Backspace' && i > 0) { e.preventDefault(); stepAt(i - 1); }
            };
            function play() {
              show3d(before, pieceHl(before, it.edge));
              playMoves([st.token], { lead: 900 });
            }
            play();
          }
          function doneMove(i) {
            stopAnim();
            if (i === 3) checkpoint(0);
            else if (i === 7) checkpoint(1);
            else stepAt(i + 1);
          }
          function checkpoint(hf) {
            var L = (it.checkpoints || [])[hf] || {}, st = it.steps[hf ? 7 : 3];
            s.done(hf ? 8 : 4); s.current(-1);
            setMode('pics');
            UI.empty(picsEl);
            picsEl.className = 'gy-pics gy-pics--1';
            var pic = h('div', { class: 'gy-pic' });
            isoPic(pic, st.state, { side: side, highlight: st.highlight, size: 'fill', dim: false });
            pic.appendChild(h('p', { class: 'gy-pic__label' }, 'Seen from the front and ' + side));
            picsEl.appendChild(pic);
            caption(null);
            setPrompt((L.title || '') + ': does your cube look like this?');
            UI.empty(answerEl);
            answerEl.appendChild(h('div', { class: 'gy-card' }, h('p', null, L.text || ''), L.note ? h('p', { class: 'small muted' }, L.note) : null));
            var yesB = btn('Yes, it matches', 'check', function () { matched[hf] = true; hf ? finish() : stepAt(4); }, 'btn-primary btn-lg');
            var noB = btn('No, it doesn’t', 'x', function () { matched[hf] = false; recover(hf); }, 'btn-secondary btn-lg');
            answerEl.appendChild(h('div', { class: 'gy-row' }, yesB, noB));
            keyHandler = function (e) {
              if (e.key === 'y' || e.key === 'Enter') { e.preventDefault(); yesB.click(); }
              else if (e.key === 'n') { e.preventDefault(); noB.click(); }
            };
            scrollTo(yesB, 'nearest');
          }
          function recover(hf) {
            UI.empty(answerEl);
            var doneMv = A.moves.slice(0, hf ? 8 : 4), back = Cube().invertAlg(doneMv);
            setPrompt('No problem: it happens to everyone.');
            answerEl.appendChild(h('div', { class: 'gy-card' },
              h('p', null, 'If you think you did the right moves in the wrong order or direction, undo them: do these, each one turned the other way, last move first.'),
              h('p', null, h('span', { class: 'mono strong' }, back.join(' '))),
              h('p', { class: 'small muted' }, 'That takes you back to the T. If the white layer is still broken after that, solve the white layer again before you carry on.')));
            var againB = btn('Start this one again', 'refresh', intro, 'btn-primary btn-lg');
            var onB = btn(hf ? 'Finish' : 'Carry on anyway', 'arrowRight', function () { hf ? finish() : stepAt(4); }, 'btn-secondary btn-lg');
            answerEl.appendChild(h('div', { class: 'gy-row' }, againB, onB));
            keyHandler = null;
          }
          function finish() {
            var ok = matched[0] === true && matched[1] === true;
            var res = G.check(it, ok);
            settle(ok && res.correct, res.explain, { lead: ok ? 'Both checkpoints matched. Well done.' : 'One of the checkpoints didn’t match. Try the next one slowly, checking after each half.' });
          }
        }

        // ============================================================ end of round
        function summary() {
          stopAnim();
          stopTicker();
          if (iscope) iscope.dispose();
          iscope = null;
          keyHandler = null;
          awake(false);
          var right = results.filter(function (r) { return r && r.correct; }).length;
          var total = items.length;
          var ms = now() - roundT0;
          var dd = data(), p = progressOf(dd && dd.gym ? dd.gym[d.id] : null);
          var sug = safe(function () { return G.suggest(dd, { hasCube: hasCube() }); }, null);
          var sd = sug && sug.drillId !== d.id ? G.drill(sug.drillId) : null;
          runEl.hidden = true;
          sumEl.hidden = false;
          UI.empty(sumEl);
          var misses = results.filter(function (r) { return r && !r.correct; }).slice(0, 5);
          var times = d.id === 'sprint' ? results.filter(function (r) { return r && r.correct; }).map(function (r) { return fmt(r.ms); }) : [];
          var againB = btn('Another round', 'refresh', startRound, 'btn-primary btn-lg');
          sumEl.appendChild(h('section', { class: 'card stack' },
            h('p', { class: 'eyebrow m-0' }, d.name),
            h('h2', { class: 'm-0', tabindex: '-1' }, right === total ? 'A perfect round!' : right >= total * 0.8 ? 'Great round' : right >= total / 2 ? 'Good work' : 'Keep at it'),
            h('p', { class: 'gy-score' }, right + ' / ' + total),
            h('p', { class: 'muted m-0' }, [
              bestStreak >= 2 ? 'Best run: ' + bestStreak + ' in a row. ' : '',
              d.id === 'leftright' ? 'Time: ' + fmt(ms) + ' s (' + fmt(ms / Math.max(1, total)) + ' s each). ' : '',
              times.length ? 'Your times: ' + times.join(', ') + '. ' : '',
              p.bestMs != null && (d.id === 'leftright' || d.id === 'sprint') ? 'Best ever: ' + fmt(p.bestMs) + ' s.' : ''
            ].join('')),
            p.strong ? UI.callout('success', 'Strong', p.recentRight + ' of your last ' + p.recentN + ' right. This one is in the bag: keep it fresh now and then.')
              : UI.callout('tip', null, 'Get 8 of your last 10 right to make this drill Strong. Right now: ' + p.recentRight + ' of ' + p.recentN + '.'),
            h('div', { class: 'gy-row' },
              againB,
              sd ? btn('Next: ' + sd.name, 'arrowRight', function () { nav.fromHub = fromHub; App.go(sd.route ? sd.route.id : 'gym', sd.route ? sd.route.params : { drill: sd.id }, { replace: true }); }, 'btn-secondary btn-lg') : null,
              btn('Back to the gym', 'arrowLeft', leave, 'btn-ghost btn-lg'))));
          if (misses.length) {
            sumEl.appendChild(h('section', { class: 'card stack stack-sm' },
              h('h3', { class: 'm-0' }, 'Worth another look'),
              h('ul', { class: 'gy-misses' }, misses.map(function (r) {
                return h('li', null, h('p', { class: 'strong' }, r.item.prompt), r.explain ? h('p', { class: 'muted' }, r.explain) : null);
              }))));
          }
          keyHandler = function (e) { if (e.key === 'Enter' && !onControl(e)) { e.preventDefault(); startRound(); } };
          scrollTo(sumEl, 'start');
          try { againB.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }

        startRound();   // last, so every renderer above is defined
      }
    }
  };

  def._helpers = {
    progressOf: progressOf, roundSize: roundSize, decideParts: decideParts, follow: follow, faceTurns: faceTurns,
    stageFor: stageFor, isoSide: isoSide, pieceHl: pieceHl, sameHeld: sameHeld, isMoveLabel: isMoveLabel, ROUND: ROUND
  };

  var App0 = CC().App;
  if (App0 && App0.registerScreen) App0.registerScreen('gym', def);
  else if (typeof window !== 'undefined') { root.CC = root.CC || {}; (root.CC.PendingScreens = root.CC.PendingScreens || []).push(['gym', def]); }
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
