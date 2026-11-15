/* Cube Coach — Stats screen.
 *
 * Tabs: Real cube / Virtual (CC.Coach.stats(data, { device })). For the chosen cube:
 *   - headline tiles: best, ao5, ao12, mean, solves, unaided best, streak, minutes this week
 *   - trend chart (inline SVG, no libraries): every solve as a dot, rolling average of 5 as a line,
 *     dashed goal line (data.settings.goalSeconds), m:ss axis, hover/keyboard tooltip, theme-aware
 *   - where the time goes: average split per stage as a stacked bar + list, slowest stage advice
 *   - solve history table (newest first, 20 per page)
 * Then, for all practice: mastery per stage, drill accuracy per type, milestones.
 * params: { device?: 'physical'|'virtual' }
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'cc-style-stats';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
  var LEVEL_NAMES = ['Solo', 'Nudge', 'Coach', 'Show'];
  var THRESHOLDS = [78, 50, 25];
  var PAGE = 20;
  var DRILL_NAMES = {
    notation: 'Move names', perform: 'Copy the move', predict: 'What comes next?',
    recognise: 'Spot the case', reps: 'How many times?', algorithm: 'Algorithm recall'
  };
  var lastDevice = null; // remembered while the app is open

  // Stage colours: a validated 8-slot categorical palette (fixed order, so a stage keeps its colour),
  // stepped separately for light and dark surfaces.
  var LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  function vars(list) { return list.map(function (c, i) { return '--cc-s' + (i + 1) + ': ' + c + ';'; }).join(' '); }

  var CSS = [
    '.cc-stats { ' + vars(LIGHT) + ' }',
    '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .cc-stats { ' + vars(DARK) + ' } }',
    ':root[data-theme="dark"] .cc-stats { ' + vars(DARK) + ' }',

    '.cc-stats .tabs { margin-bottom: 0; }',
    '.cc-tiles { display: grid; gap: var(--space-3); grid-template-columns: repeat(2, minmax(0, 1fr)); }',
    '@media (min-width: 700px) { .cc-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }',
    '.cc-tiles .stat__value { font-size: var(--text-xl); }',
    '.cc-tiles .stat__value.is-goal { color: var(--success-text); }',

    '.cc-chart { position: relative; }',
    '.cc-chart svg { display: block; width: 100%; height: auto; overflow: visible; touch-action: pan-y; }',
    '.cc-chart svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }',
    '.cc-chart__grid { stroke: var(--border); stroke-width: 1; }',
    '.cc-chart__base { stroke: var(--border-strong); stroke-width: 1; }',
    '.cc-chart__tick { fill: var(--text-3); font-size: 11px; font-family: var(--font); font-variant-numeric: tabular-nums; }',
    '.cc-chart__goal { stroke: var(--success); stroke-width: 1.5; stroke-dasharray: 6 4; fill: none; }',
    '.cc-chart__goal-text { fill: var(--success-text); font-size: 11px; font-weight: 700; font-family: var(--font); paint-order: stroke; stroke: var(--surface); stroke-width: 4px; stroke-linejoin: round; }',
    '.cc-chart__dot { fill: var(--text-3); stroke: var(--surface); stroke-width: 2; }',
    '.cc-chart__line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }',
    '.cc-chart__cross { stroke: var(--border-strong); stroke-width: 1; }',
    '.cc-chart__hl { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }',
    '.cc-chart__tip { position: absolute; z-index: 2; pointer-events: none; transform: translate(-50%, calc(-100% - 12px)); padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow-2); font-size: var(--text-sm); line-height: 1.35; white-space: nowrap; color: var(--text); }',
    '.cc-chart__tip strong { font-variant-numeric: tabular-nums; }',
    '.cc-chart__tip span { color: var(--text-2); }',
    '.cc-legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-legend > span { display: inline-flex; align-items: center; gap: 6px; }',
    '.cc-legend__dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-3); }',
    '.cc-legend__line { width: 18px; height: 2px; border-radius: 2px; background: var(--accent); }',
    '.cc-legend__goal { width: 18px; height: 0; border-top: 2px dashed var(--success); }',

    '.cc-split { display: flex; gap: 2px; height: 22px; border-radius: 6px; overflow: hidden; background: var(--surface); }',
    '.cc-split > span { display: block; min-width: 3px; height: 100%; }',
    '.cc-split > span:first-child { border-radius: 4px 0 0 4px; }',
    '.cc-split > span:last-child { border-radius: 0 4px 4px 0; }',
    '.cc-split > span.is-slow { outline: 2px solid var(--text); outline-offset: -2px; }',
    '.cc-splits { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px var(--space-5); grid-template-columns: minmax(0, 1fr); }',
    '@media (min-width: 640px) { .cc-splits { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '.cc-splits > li { margin: 0; display: grid; grid-template-columns: 12px minmax(0, 1fr) auto auto; gap: var(--space-2); align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }',
    '.cc-splits__sw { width: 12px; height: 12px; border-radius: 3px; }',
    '.cc-splits__name { min-width: 0; overflow-wrap: anywhere; font-weight: 600; }',
    '.cc-splits__ms { font-variant-numeric: tabular-nums; }',
    '.cc-splits__pct { width: 4ch; text-align: right; color: var(--text-3); font-variant-numeric: tabular-nums; }',

    '.cc-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-bars > li { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px var(--space-3); align-items: center; }',
    '.cc-bars__name { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.cc-bars__val { font-size: var(--text-sm); color: var(--text-2); font-variant-numeric: tabular-nums; text-align: right; }',
    '.cc-bars__meter { grid-column: 1 / -1; }',
    '.cc-bars__sub { grid-column: 1 / -1; margin: 0; font-size: var(--text-xs); color: var(--text-3); }',
    '.cc-meter { position: relative; height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }',
    '.cc-meter__fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: inherit; background: var(--accent); }',
    '.cc-meter__tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--surface); }',
    '.cc-lvl { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); font-size: var(--text-xs); font-weight: 700; line-height: 1.5; white-space: nowrap; }',
    '.cc-lvl[data-level="2"] { background: var(--accent-soft); border-color: var(--accent-soft-2); color: var(--accent-text); }',
    '.cc-lvl[data-level="1"] { background: var(--accent-soft-2); border-color: transparent; color: var(--accent-text); }',
    '.cc-lvl[data-level="0"] { background: var(--accent); border-color: transparent; color: var(--on-accent); }',

    '.cc-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }',
    '.cc-table-wrap:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.cc-table { width: 100%; min-width: 600px; border-collapse: collapse; font-size: var(--text-sm); }',
    '.cc-table th, .cc-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }',
    '.cc-table thead th { position: sticky; top: 0; background: var(--surface-2); color: var(--text-2); font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }',
    '.cc-table tbody tr:last-child td { border-bottom: 0; }',
    '.cc-table tbody tr:hover { background: var(--surface-2); }',
    '.cc-table .is-num { text-align: right; font-variant-numeric: tabular-nums; }',
    '.cc-table .cc-dnf { color: var(--danger-text); font-weight: 700; }',
    '.cc-table .cc-time { font-weight: 700; font-variant-numeric: tabular-nums; }',

    '.cc-msgrid { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); }',
    '.cc-msgrid > li { margin: 0; display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); }',
    '.cc-msgrid__icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-text); }',
    '.cc-msgrid > li.is-locked { background: var(--surface-2); border-style: dashed; }',
    '.cc-msgrid > li.is-locked .cc-msgrid__icon { background: var(--surface-3); color: var(--text-3); }',
    '.cc-msgrid__name { margin: 0; font-weight: 650; line-height: 1.3; }',
    '.cc-msgrid__desc { margin: 2px 0 0; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-msgrid__when { margin: 4px 0 0; font-size: var(--text-xs); font-weight: 700; color: var(--success-text); }',
    '.cc-msgrid > li.is-locked .cc-msgrid__when { color: var(--text-3); font-weight: 600; }',
    // phones & touch: the "Change goal" text link gets a 44 px tap target
    '@media (pointer: coarse) { .cc-goal-link { display: inline-flex; align-items: center; min-height: 44px; } }'
  ].join('\n');

  // ------------------------------------------------------------ helpers (no DOM)
  function CCx() { return root.CC || {}; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function attempt(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function tms(v) { var t = Date.parse(v); return isFinite(t) ? t : NaN; }
  function clock(ms) { // m:ss (axis labels, goals)
    var s = Math.round(Math.max(0, ms) / 1000);
    if (s >= 3600) return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }
  function fmt(ms) { var UI = CCx().UI; return ms == null ? '—' : (UI && UI.fmtTime ? UI.fmtTime(ms) : clock(ms)); }
  function fmtDate(iso, withTime) {
    var t = tms(iso);
    if (!isFinite(t)) return '—';
    var d = new Date(t), now = new Date();
    var o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    var s;
    try { s = d.toLocaleDateString('en-GB', o); } catch (e) { s = d.getDate() + '/' + (d.getMonth() + 1); }
    return withTime ? s + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s;
  }
  function stageList() {
    var UI = CCx().UI;
    var list = UI && UI.stages ? UI.stages() : null;
    if (Array.isArray(list) && list.length) return list;
    return STAGE_IDS.map(function (id) { return { id: id, name: id, short: id }; });
  }
  function stageName(id) {
    var L = CCx().Lessons;
    if (L && L.STAGES && L.STAGES[id] && L.STAGES[id].title) return L.STAGES[id].title;
    var list = stageList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return String(id);
  }
  function hintTotal(s) {
    if (!s) return 0;
    if (isObj(s.hints)) return Object.keys(s.hints).reduce(function (a, k) { return a + (Number(s.hints[k]) || 0); }, 0);
    return Number(s.hints) || 0;
  }
  function goalMs(data) {
    var g = data && data.settings && Number(data.settings.goalSeconds);
    return (g > 0 ? g : 180) * 1000;
  }
  function deviceOf(s) { return s && s.device === 'virtual' ? 'virtual' : 'physical'; }
  function sourceLabel(s) {
    if (s.stage || s.source === 'drill') return 'Stage practice' + (s.stage ? ': ' + stageName(s.stage) : '');
    var base = s.source === 'scan' ? 'Scanned cube' : 'Scramble';
    return base + (s.timed ? ' · timed' : '');
  }
  // "Show 2 · Coach 6" (most help first), "All Solo", or "Timer only".
  function levelsSummary(s) {
    var lv = s.levels;
    if (!isObj(lv) || !Object.keys(lv).length) return s.device === 'virtual' ? '—' : 'Timer only';
    var keys = Object.keys(lv);
    if (keys.length === 1 && keys[0] === 'all' && LEVEL_NAMES[lv.all]) return 'All ' + LEVEL_NAMES[lv.all];
    var counts = [0, 0, 0, 0];
    keys.forEach(function (k) { var l = Number(lv[k]); if (l >= 0 && l <= 3) counts[Math.round(l)]++; });
    var parts = [];
    for (var l = 3; l >= 0; l--) if (counts[l]) parts.push(LEVEL_NAMES[l] + (counts[l] > 1 ? ' ' + counts[l] : ''));
    if (parts.length === 1 && counts.reduce(function (a, b) { return a + b; }, 0) > 1) return 'All ' + parts[0].split(' ')[0];
    return parts.join(' · ') || '—';
  }
  // Tick step for a time axis that tops out at maxMs: aims for 3–5 gridlines on round values.
  function niceStep(maxMs) {
    var steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200].map(function (s) { return s * 1000; });
    for (var i = 0; i < steps.length; i++) if (maxMs / steps[i] <= 5) return steps[i];
    return steps[steps.length - 1];
  }

  // Pure: the Middle Layer Gym's answers, which Coach also counts as drills under 'gym-<drillId>'.
  // Folded into ONE row on the drill card (17 rows of raw ids like "gym-spot" told the learner nothing).
  // -> null when the gym hasn't been used; else { right, total, lastAt, tried:[{ id, name, right, total, acc }], weakest }
  function gymSummary(drills, Gym) {
    if (!isObj(drills)) return null;
    var tried = Object.keys(drills).filter(function (k) { return /^gym-/.test(k) && isObj(drills[k]) && drills[k].total > 0; }).map(function (k) {
      var id = k.slice(4), d = drills[k];
      var info = Gym && typeof Gym.drill === 'function' ? attempt(function () { return Gym.drill(id); }, null) : null;
      var right = Math.max(0, Number(d.right) || 0), total = Math.max(0, Number(d.total) || 0);
      return { id: id, name: info && info.name ? info.name : id, right: right, total: total, acc: total ? Math.round(right / total * 100) : 0, lastAt: d.lastAt || null };
    });
    if (!tried.length) return null;
    var out = { right: 0, total: 0, lastAt: null, tried: tried, weakest: null };
    tried.forEach(function (t) {
      out.right += t.right; out.total += t.total;
      if (t.lastAt && (!out.lastAt || tms(t.lastAt) > tms(out.lastAt))) out.lastAt = t.lastAt;
      if (t.total >= 3 && t.acc < 80 && (!out.weakest || t.acc < out.weakest.acc)) out.weakest = t;
    });
    return out;
  }

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function svg(tag, attrs, kids) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) el.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  // ------------------------------------------------------------ trend chart
  // points: [{ at, ms, ao5, n }] (n = 1-based solve number). Returns { el, destroy() }.
  function trendChart(points, goal) {
    var UI = CCx().UI, h = UI.h;
    var host = h('div', { class: 'cc-chart' });
    var live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    var tip = h('div', { class: 'cc-chart__tip', hidden: true, 'aria-hidden': 'true' });
    var ro = null, raf = 0, width = 0, sel = -1;
    var geom = null, svgEl = null, crossEl = null, hlEl = null;

    function pointText(i) {
      var p = points[i];
      return 'Solve ' + p.n + ', ' + fmtDate(p.at, true) + ': ' + fmt(p.ms) + (p.ao5 != null ? '. Average of 5: ' + fmt(p.ao5) : '');
    }

    function draw() {
      raf = 0;
      var w = Math.max(280, Math.round(host.clientWidth || 600));
      if (w === width && svgEl) return;
      width = w;
      var H = w < 480 ? 220 : 280;
      var ml = 48, mr = 14, mt = 18, mb = 28;
      var pw = w - ml - mr, ph = H - mt - mb;
      var max = goal;
      points.forEach(function (p) { if (p.ms > max) max = p.ms; if (p.ao5 != null && p.ao5 > max) max = p.ao5; });
      var step = niceStep(max * 1.06);
      var yMax = Math.ceil(max * 1.06 / step) * step;
      var n = points.length;
      function x(i) { return ml + (n === 1 ? pw / 2 : i * pw / (n - 1)); }
      function y(v) { return mt + ph - (v / yMax) * ph; }
      geom = { x: x, y: y, ml: ml, pw: pw, n: n, w: w, H: H };

      var g = [];
      for (var v = 0; v <= yMax + 1; v += step) {
        g.push(svg('line', { class: v === 0 ? 'cc-chart__base' : 'cc-chart__grid', x1: ml, x2: w - mr, y1: y(v), y2: y(v) }));
        g.push(svg('text', { class: 'cc-chart__tick', x: ml - 8, y: y(v) + 4, 'text-anchor': 'end' }, [clock(v)]));
      }
      // x labels: first and last solve (and the middle one when there is room)
      var xl = [0];
      if (n > 2 && w >= 520) xl.push(Math.floor((n - 1) / 2));
      if (n > 1) xl.push(n - 1);
      xl.forEach(function (i, k) {
        var anchor = n === 1 ? 'middle' : k === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        g.push(svg('text', { class: 'cc-chart__tick', x: x(i), y: H - 8, 'text-anchor': anchor }, ['#' + points[i].n + ' · ' + fmtDate(points[i].at)]));
      });
      // goal
      g.push(svg('line', { class: 'cc-chart__goal', x1: ml, x2: w - mr, y1: y(goal), y2: y(goal) }));
      // Label at the left: times start slow and come down towards the goal, so the right end is where
      // the dots crowd the goal line.
      g.push(svg('text', { class: 'cc-chart__goal-text', x: ml + 6, y: y(goal) - 6, 'text-anchor': 'start' }, ['Goal ' + clock(goal)]));
      // rolling average of 5 (broken where it doesn't exist, e.g. a DNF in the window)
      var d = '', pen = false;
      points.forEach(function (p, i) {
        if (p.ao5 == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.ao5).toFixed(1);
        pen = true;
      });
      crossEl = svg('line', { class: 'cc-chart__cross', x1: 0, x2: 0, y1: mt, y2: mt + ph, visibility: 'hidden' });
      g.push(crossEl);
      var r = n > 150 ? 3 : 4;
      var dots = svg('g', null, points.map(function (p, i) {
        return svg('circle', { class: 'cc-chart__dot', cx: x(i).toFixed(1), cy: y(p.ms).toFixed(1), r: r }, [svg('title', null, [pointText(i)])]);
      }));
      g.push(dots);
      if (d) g.push(svg('path', { class: 'cc-chart__line', d: d }));
      hlEl = svg('circle', { class: 'cc-chart__hl', r: 6, cx: -20, cy: -20, visibility: 'hidden' });
      g.push(hlEl);
      g.push(svg('rect', { x: ml, y: mt, width: pw, height: ph, fill: 'transparent' }));

      var next = svg('svg', {
        viewBox: '0 0 ' + w + ' ' + H, width: w, height: H, tabindex: 0, role: 'img', focusable: 'true',
        'aria-label': 'Chart of your last ' + n + ' solve times' + (n ? ', from ' + fmt(points[0].ms) + ' to ' + fmt(points[n - 1].ms) : '') +
          '. Goal ' + clock(goal) + '. Use the left and right arrow keys to read each solve.'
      }, g);
      next.addEventListener('pointermove', onMove);
      next.addEventListener('pointerdown', onMove);
      next.addEventListener('pointerleave', function () { if (document.activeElement !== next) hide(); });
      next.addEventListener('keydown', onKey);
      next.addEventListener('focus', function () { show(sel >= 0 ? sel : n - 1, false); });
      next.addEventListener('blur', hide);
      if (svgEl && svgEl.parentNode) svgEl.parentNode.replaceChild(next, svgEl); else host.insertBefore(next, host.firstChild);
      svgEl = next;
      if (sel >= 0 && !tip.hidden) show(sel, false);
    }

    function show(i, announce) {
      if (!geom || i < 0 || i >= points.length) return;
      sel = i;
      var p = points[i], cx = geom.x(i), cy = geom.y(p.ms);
      crossEl.setAttribute('x1', cx); crossEl.setAttribute('x2', cx); crossEl.setAttribute('visibility', 'visible');
      hlEl.setAttribute('cx', cx); hlEl.setAttribute('cy', cy); hlEl.setAttribute('visibility', 'visible');
      UI.empty(tip);
      tip.appendChild(h('div', null, h('strong', null, fmt(p.ms)), ' ', h('span', null, '· solve ' + p.n)));
      tip.appendChild(h('div', null, h('span', null, fmtDate(p.at, true))));
      if (p.ao5 != null) tip.appendChild(h('div', null, h('span', null, 'Average of 5: '), h('strong', null, fmt(p.ao5))));
      tip.hidden = false;
      var scale = svgEl && svgEl.getBoundingClientRect ? (svgEl.getBoundingClientRect().width || geom.w) / geom.w : 1;
      var left = Math.max(70, Math.min(geom.w * scale - 70, cx * scale));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(40, cy * scale) + 'px';
      if (announce) live.textContent = pointText(i);
    }
    function hide() {
      tip.hidden = true;
      if (crossEl) crossEl.setAttribute('visibility', 'hidden');
      if (hlEl) hlEl.setAttribute('visibility', 'hidden');
    }
    function onMove(e) {
      if (!geom || !svgEl) return;
      var rect = svgEl.getBoundingClientRect();
      var px = (e.clientX - rect.left) * (geom.w / (rect.width || geom.w));
      var i = geom.n === 1 ? 0 : Math.round((px - geom.ml) / geom.pw * (geom.n - 1));
      show(Math.max(0, Math.min(geom.n - 1, i)), false);
    }
    function onKey(e) {
      var UIx = CCx().UI;
      if (UIx && UIx.shortcutsBlocked && UIx.shortcutsBlocked(e)) return;
      var n = points.length, i = sel < 0 ? n - 1 : sel;
      if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      show(i, true);
    }
    function schedule() { if (!raf) raf = (root.requestAnimationFrame || setTimeout)(draw); }

    host.appendChild(tip);
    host.appendChild(live);
    if (typeof root.ResizeObserver === 'function') {
      ro = new root.ResizeObserver(schedule);
      ro.observe(host);
    } else {
      root.addEventListener('resize', schedule);
    }
    schedule();
    return {
      el: host,
      destroy: function () {
        if (ro) ro.disconnect(); else root.removeEventListener('resize', schedule);
        if (raf) (root.cancelAnimationFrame || clearTimeout)(raf);
        raf = 0;
      }
    };
  }

  // ------------------------------------------------------------ screen
  var def = {
    title: 'Stats',
    mount: function (el, params) {
      injectStyle();
      params = params || {};
      var CC = root.CC, UI = CC.UI, h = UI.h, App = CC.App, Coach = CC.Coach || null;
      var data = App.data;
      var solves = Array.isArray(data.solves) ? data.solves : [];
      var goal = goalMs(data);
      var disposers = [];
      var page = 0;
      var range = null;

      function go(id, p) { return function () { App.go(id, p || {}); }; }
      function statsFor(device) {
        if (Coach && Coach.stats) return attempt(function () { return Coach.stats(data, { device: device }); }, null);
        return null;
      }
      function fullCount(device) {
        var s = statsFor(device);
        if (s) return s.count;
        return solves.filter(function (x) { return x && x.completed !== false && !x.stage && deviceOf(x) === device; }).length;
      }

      var counts = { physical: fullCount('physical'), virtual: fullCount('virtual') };
      var anySolve = solves.length > 0;
      var device = params.device === 'virtual' || params.device === 'physical' ? params.device
        : lastDevice || (counts.physical || !counts.virtual ? 'physical' : 'virtual');

      // ---------------------------------------------- tabs
      var TABS = [['physical', 'Real cube', 'cube'], ['virtual', 'Virtual', 'watch']];
      var tabButtons = [];
      var panel = h('div', { class: 'stack stack-lg', role: 'tabpanel', id: 'cc-stats-panel', tabindex: '-1' });
      var tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Which cube' }, TABS.map(function (t) {
        var b = h('button', {
          type: 'button', role: 'tab', class: 'tab', id: 'cc-stats-tab-' + t[0], 'aria-controls': 'cc-stats-panel',
          'aria-selected': device === t[0], tabindex: device === t[0] ? '0' : '-1',
          onClick: function () { select(t[0]); },
          onKeydown: function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
            e.preventDefault();
            var i = TABS.map(function (x) { return x[0]; }).indexOf(t[0]);
            var j = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
            select(TABS[j][0]);
            tabButtons[j].focus();
          }
        }, UI.icon(t[2], 16), t[1], h('span', { class: 'badge' }, String(counts[t[0]])));
        tabButtons.push(b);
        return b;
      }));
      function select(id) {
        if (id === device && panel.firstChild) return;
        device = id;
        lastDevice = id;
        page = 0; range = null;
        tabButtons.forEach(function (b, i) {
          var on = TABS[i][0] === id;
          b.setAttribute('aria-selected', String(on));
          b.setAttribute('tabindex', on ? '0' : '-1');
        });
        panel.setAttribute('aria-labelledby', 'cc-stats-tab-' + id);
        renderPanel();
      }

      // ---------------------------------------------- pieces
      function tile(label, value, sub, opts) {
        opts = opts || {};
        return h('div', { class: 'card card-sm stat', title: opts.title || null },
          h('span', { class: 'stat__label' }, label),
          h('span', { class: ['stat__value', opts.goal ? 'is-goal' : null] }, value),
          sub ? h('span', { class: 'stat__sub' }, sub) : null);
      }

      function tiles(s) {
        var u = s.unaided || {};
        var phys = device === 'physical';
        return h('section', { 'aria-label': 'Headline numbers' }, h('div', { class: 'cc-tiles' },
          tile('Best', fmt(s.best), s.best != null && s.best < goal ? (phys ? 'under your goal!' : 'under ' + clock(goal) + ' on screen') : null, { goal: s.best != null && s.best < goal }),
          tile('Average of 5', s.ao5Dnf ? 'DNF' : fmt(s.ao5), s.ao5 == null && !s.ao5Dnf ? 'after 5 solves' : 'last 5, best & worst dropped',
            { title: 'Average of your last 5 solves, dropping the best and the worst. A solve you didn’t finish counts as the worst.', goal: s.ao5 != null && s.ao5 < goal }),
          tile('Average of 12', s.ao12Dnf ? 'DNF' : fmt(s.ao12), s.ao12 == null && !s.ao12Dnf ? 'after 12 solves' : 'last 12'),
          tile('Mean', fmt(s.mean), 'all finished solves'),
          tile('Solves', String(s.count), s.dnf ? s.dnf + ' not finished' : 'finished'),
          tile('Unaided best', phys ? fmt(u.best) : '—', phys ? (u.count ? u.count + ' with no help' : 'no help, no hints') : 'real cube only',
            { goal: phys && u.best != null && u.best < goal, title: 'A real-cube solve with every stage at Solo level and no hints' }),
          tile('Streak', String(s.streak || 0), (s.streak === 1 ? 'day' : 'days') + ' in a row'),
          tile('This week', String(Math.round(Number(s.weekMinutes) || 0)), 'minutes practised')));
      }

      function chartCard(s) {
        var all = (s.trend || []).map(function (p, i) { return { at: p.at, ms: p.ms, ao5: p.ao5, n: i + 1 }; });
        var card = h('section', { class: 'card stack', 'aria-labelledby': 'cc-trend-title' });
        var head = h('div', { class: 'card__head m-0' }, h('h2', { class: 'card__title', id: 'cc-trend-title' }, 'Your times'));
        card.appendChild(head);
        if (!all.length) return null;
        if (range == null) range = all.length > 100 ? 100 : 0;
        if (all.length > 25) {
          var opts = [[25, 'Last 25'], [100, 'Last 100'], [0, 'All']].filter(function (o) { return o[0] === 0 || o[0] < all.length; });
          head.appendChild(h('div', { class: 'segmented', role: 'group', 'aria-label': 'How many solves to show' }, opts.map(function (o) {
            return h('button', {
              type: 'button', 'aria-pressed': range === o[0],
              onClick: function () { range = o[0]; renderPanel('chart'); }
            }, o[1]);
          })));
        }
        var pts = range ? all.slice(-range) : all;
        card.appendChild(h('div', { class: 'cc-legend', 'aria-hidden': 'true' },
          h('span', null, h('span', { class: 'cc-legend__dot' }), 'Each solve'),
          h('span', null, h('span', { class: 'cc-legend__line' }), 'Average of 5'),
          h('span', null, h('span', { class: 'cc-legend__goal' }), 'Goal ' + clock(goal))));
        var chart = trendChart(pts, goal);
        disposers.push(chart.destroy);
        card.appendChild(chart.el);
        // one-line takeaway. On the real cube the goal is about unaided solves, so compare those.
        var msg;
        var u = s.unaided || {};
        var gap = function (d) { d = Math.abs(d); return d < 60000 ? (Math.round(d / 100) / 10) + ' seconds' : clock(d); };
        if (device === 'physical' && u.ao5 != null) {
          var ud = u.ao5 - goal;
          msg = ud <= 0 ? 'Your unaided average of 5 (' + fmt(u.ao5) + ') beats your ' + clock(goal) + ' goal by ' + gap(ud) + '. Brilliant.'
            : 'Your unaided average of 5 is ' + fmt(u.ao5) + ': ' + gap(ud) + ' to go to reach ' + clock(goal) + '.';
        } else if (s.ao5 != null) {
          var diff = s.ao5 - goal;
          msg = diff <= 0 ? 'Your average of 5 (' + fmt(s.ao5) + ') beats your ' + clock(goal) + ' goal by ' + gap(diff) + '. Brilliant.'
            : 'Your average of 5 is ' + fmt(s.ao5) + ': ' + gap(diff) + ' to go to reach ' + clock(goal) + '.';
        } else if (s.ao5Dnf) {
          msg = 'Two of your last 5 solves weren’t finished, so there’s no average right now. Finishing every solve, even a slow one, is a skill too.';
        } else {
          msg = 'Best so far: ' + fmt(s.best) + '. ' + Math.max(1, 5 - (s.attempts || s.count)) + ' more solve' + (5 - (s.attempts || s.count) === 1 ? '' : 's') + ' and you’ll see your average of 5.';
        }
        if (device === 'physical') msg += u.ao5 != null ? ' Unaided means every stage at Solo and no hints.' : ' The goal counts unaided solves: every stage at Solo, no hints.';
        card.appendChild(h('p', { class: 'small muted m-0' }, msg));
        return card;
      }

      function splitsCard(s) {
        var ids = stageList().map(function (x) { return x.id; });
        var by = isObj(s.byStage) ? s.byStage : {};
        var have = ids.filter(function (id) { return isObj(by[id]) && by[id].avgMs > 0; });
        var card = h('section', { class: 'card stack', 'aria-labelledby': 'cc-split-title' },
          h('div', { class: 'card__head m-0' },
            h('h2', { class: 'card__title', id: 'cc-split-title' }, 'Where the time goes'),
            have.length ? h('span', { class: 'small muted' }, 'Average per stage, recent solves') : null));
        if (!have.length) {
          card.appendChild(h('p', { class: 'muted m-0' }, device === 'physical'
            ? 'Stage times appear after a coached solve on your cube, or a timed solve with “Split taps” turned on in Settings (tap at the end of each stage).'
            : 'Stage times appear after your first full solve on the virtual cube. The app spots the end of each stage for you.'));
          return card;
        }
        var slow = s.slowestStage;
        var colour = function (id) { return 'var(--cc-s' + (ids.indexOf(id) + 1) + ')'; };
        var totalAvg = have.reduce(function (a, id) { return a + by[id].avgMs; }, 0);
        card.appendChild(h('div', {
          class: 'cc-split', role: 'img',
          'aria-label': 'Share of solve time by stage: ' + have.map(function (id) { return stageName(id) + ' ' + Math.round(by[id].share * 100) + '%'; }).join(', ')
        }, have.map(function (id) {
          return h('span', {
            class: id === slow ? 'is-slow' : null,
            title: stageName(id) + ': ' + fmt(by[id].avgMs) + ' (' + Math.round(by[id].share * 100) + '%)',
            style: { flex: by[id].avgMs + ' 1 0', background: colour(id) }
          });
        })));
        card.appendChild(h('ol', { class: 'cc-splits' }, have.map(function (id) {
          return h('li', null,
            h('span', { class: 'cc-splits__sw', style: { background: colour(id) }, 'aria-hidden': 'true' }),
            h('span', { class: 'cc-splits__name' }, stageName(id), id === slow ? [' ', h('span', { class: 'badge badge-warn' }, 'Slowest for its size')] : null),
            h('span', { class: 'cc-splits__ms' }, fmt(by[id].avgMs)),
            h('span', { class: 'cc-splits__pct' }, Math.round(by[id].share * 100) + '%'));
        })));
        card.appendChild(h('p', { class: 'xsmall subtle m-0' }, 'Total of the averages: ' + fmt(totalAvg) + '. Some stages are naturally longer (the white corners and the middle layer take the most moves), so the coach compares each stage with how long it usually takes.'));
        if (slow) {
          var L = CC.Lessons, ls = L && L.STAGES && L.STAGES[slow];
          var advice = ls && ((ls.speedTips && ls.speedTips[0]) || (ls.mistakes && ls.mistakes[0]) || (ls.hints && ls.hints[0]));
          card.appendChild(UI.callout('tip', 'Your biggest win: ' + stageName(slow),
            h('p', { class: 'm-0' }, 'It takes ' + Math.round(by[slow].share * 100) + '% of your solve time, which is more than it should for its size. A few focused runs on just this stage will pay off fastest.'),
            advice ? h('p', { class: 'm-0 mt-2' }, h('strong', null, 'Tip: '), advice) : null,
            h('div', { class: 'row row-sm mt-2' },
              h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: go('solve', { device: 'virtual', source: 'drill', stage: slow }) }, UI.icon('cube', 16), 'Practise this stage'),
              h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: go('drills', { tab: 'stages', stage: slow }) }, UI.icon('zap', 16), 'Stage drills'))));
        }
        return card;
      }

      function historyCard() {
        var list = solves.filter(function (x) { return isObj(x) && deviceOf(x) === device; })
          .map(function (x, i) { return { s: x, i: i, t: tms(x.at) }; })
          .sort(function (a, b) { return ((b.t || 0) - (a.t || 0)) || (b.i - a.i); })
          .map(function (x) { return x.s; });
        var card = h('section', { class: 'card stack', 'aria-labelledby': 'cc-hist-title', dataset: { part: 'history' } });
        card.appendChild(h('div', { class: 'card__head m-0' },
          h('h2', { class: 'card__title', id: 'cc-hist-title' }, 'Solve history'),
          list.length ? h('span', { class: 'small muted' }, list.length + ' ' + (list.length === 1 ? 'entry' : 'entries') + ', newest first') : null));
        if (!list.length) {
          card.appendChild(h('p', { class: 'muted m-0' }, 'Nothing here yet. Every solve and stage practice you finish is listed here.'));
          return card;
        }
        var pages = Math.ceil(list.length / PAGE);
        if (page >= pages) page = pages - 1;
        var rows = list.slice(page * PAGE, page * PAGE + PAGE);
        var table = h('table', { class: 'cc-table' },
          h('caption', { class: 'sr-only' }, 'Your ' + (device === 'virtual' ? 'virtual' : 'real-cube') + ' solves, newest first'),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col', class: 'is-num' }, 'Time'), h('th', { scope: 'col' }, 'Cube'),
            h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col', class: 'is-num' }, 'Hints'), h('th', { scope: 'col' }, 'Help level'))),
          h('tbody', null, rows.map(function (x) {
            var dnf = x.completed === false;
            return h('tr', null,
              h('td', null, fmtDate(x.at, true)),
              h('td', { class: 'is-num' }, dnf
                ? h('span', { class: 'cc-dnf', title: 'Did not finish' + (x.totalMs ? ' (stopped at ' + fmt(x.totalMs) + ')' : '') }, 'DNF')
                : h('span', { class: 'cc-time' }, fmt(x.totalMs))),
              h('td', null, deviceOf(x) === 'virtual' ? 'Virtual' : 'Real'),
              h('td', null, sourceLabel(x)),
              h('td', { class: 'is-num' }, String(hintTotal(x))),
              h('td', null, levelsSummary(x)));
          })));
        card.appendChild(h('div', { class: 'cc-table-wrap', tabindex: '0', role: 'region', 'aria-labelledby': 'cc-hist-title' }, table));
        if (pages > 1) {
          card.appendChild(h('div', { class: 'row row-between' },
            h('button', {
              type: 'button', class: 'btn btn-secondary btn-sm', disabled: page === 0, dataset: { focus: 'newer' },
              onClick: function () { page = Math.max(0, page - 1); renderHistory('newer'); }
            }, UI.icon('arrowLeft', 16), 'Newer'),
            h('span', { class: 'small muted num' }, (page * PAGE + 1) + '–' + Math.min(list.length, (page + 1) * PAGE) + ' of ' + list.length),
            h('button', {
              type: 'button', class: 'btn btn-secondary btn-sm', disabled: page >= pages - 1, dataset: { focus: 'older' },
              onClick: function () { page = Math.min(pages - 1, page + 1); renderHistory('older'); }
            }, 'Older', UI.icon('arrowRight', 16))));
        }
        return card;
      }
      function renderHistory(focusKey) {
        var old = panel.querySelector('[data-part="history"]');
        var next = historyCard();
        if (old && old.parentNode) old.parentNode.replaceChild(next, old);
        var f = focusKey && next.querySelector('[data-focus="' + focusKey + '"]');
        if (f && f.disabled) f = next.querySelector('[data-focus="' + (focusKey === 'older' ? 'newer' : 'older') + '"]');
        if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }

      function deviceEmpty() {
        var phys = device === 'physical';
        return h('section', { class: 'card empty-state' },
          h('div', { class: 'empty-state__icon' }, UI.icon(phys ? 'camera' : 'cube', 28)),
          h('h2', { class: 'h3' }, phys ? 'No real-cube solves yet' : 'No virtual solves yet'),
          h('p', null, phys
            ? 'When you solve your own cube, your times land here. Scan it and the coach will walk you through every stage.'
            : 'The virtual cube is the easiest place for a first full solve: the coach checks every move for you.'),
          h('div', { class: 'row row-center' },
            phys
              ? h('button', { type: 'button', class: 'btn btn-primary', onClick: go('scan') }, UI.icon('camera', 18), 'Scan my cube')
              : h('button', { type: 'button', class: 'btn btn-primary', onClick: go('solve', { device: 'virtual', source: 'scramble' }) }, UI.icon('cube', 18), 'Solve the virtual cube'),
            h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { select(phys ? 'virtual' : 'physical'); } }, phys ? 'See virtual stats' : 'See real-cube stats')));
      }

      function renderPanel(focusPart) {
        disposers.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
        disposers = [];
        UI.empty(panel);
        panel.setAttribute('aria-labelledby', 'cc-stats-tab-' + device);
        var s = statsFor(device);
        if (!s) {
          panel.appendChild(UI.callout('warn', 'Stats aren’t available', 'The coaching engine didn’t load, so there’s nothing to add up. Try reloading the page.'));
          return;
        }
        panel.appendChild(tiles(s));
        var hasHistory = solves.some(function (x) { return isObj(x) && deviceOf(x) === device; });
        if (!s.count && !s.dnf) {
          if (anySolve || counts.physical + counts.virtual) panel.appendChild(deviceEmpty());
        } else {
          var c = chartCard(s);
          if (c) panel.appendChild(c);
          panel.appendChild(splitsCard(s));
        }
        if (hasHistory) panel.appendChild(historyCard());
        if (focusPart === 'chart') {
          var b = panel.querySelector('#cc-trend-title');
          var seg = b && b.parentNode.parentNode.querySelector('[aria-pressed="true"]');
          if (seg) { try { seg.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        }
      }

      // ---------------------------------------------- device-independent sections
      function masteryCard() {
        var list = h('ol', { class: 'cc-bars' });
        stageList().forEach(function (st, i) {
          var m = Coach && Coach.masteryOf ? attempt(function () { return Coach.masteryOf(data, st.id); }, 0) : ((data.skills && data.skills[st.id] && data.skills[st.id].mastery) || 0);
          var lvl = Coach && Coach.autoLevel ? attempt(function () { return Coach.autoLevel(data, st.id); }, 3) : 3;
          var sk = (data.skills && data.skills[st.id]) || {};
          var mr = Math.floor(Math.max(0, Math.min(100, Number(m) || 0)));
          var sub = sk.sessions ? sk.sessions + ' practice run' + (sk.sessions === 1 ? '' : 's') +
            (sk.soloClean ? ' · ' + sk.soloClean + ' clean at Solo' : '') + (sk.lastPracticed ? ' · last ' + fmtDate(sk.lastPracticed) : '') : 'Not tried yet';
          list.appendChild(h('li', null,
            h('span', { class: 'cc-bars__name' }, (i + 1) + '. ' + stageName(st.id)),
            h('span', { class: 'cc-bars__val' }, h('span', { class: 'cc-lvl', dataset: { level: lvl } }, LEVEL_NAMES[lvl]), ' ', mr),
            h('span', {
              class: 'cc-meter cc-bars__meter', role: 'meter', 'aria-label': stageName(st.id) + ' mastery',
              'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': mr, 'aria-valuetext': mr + ' out of 100, ' + LEVEL_NAMES[lvl] + ' level'
            },
            h('span', { class: 'cc-meter__fill', style: { width: mr + '%' } }),
            THRESHOLDS.map(function (t) { return h('span', { class: 'cc-meter__tick', style: { left: t + '%' } }); })),
            h('p', { class: 'cc-bars__sub' }, sub)));
        });
        return h('section', { class: 'card stack', 'aria-labelledby': 'cc-mastery-title' },
          h('div', { class: 'card__head m-0' },
            h('h2', { class: 'card__title', id: 'cc-mastery-title' }, 'Mastery per stage'),
            h('span', { class: 'small muted' }, 'Real and virtual practice')),
          h('p', { class: 'small muted m-0' }, 'Help steps down at 25 (Coach), 50 (Nudge) and 78 (Solo): the tick marks on each bar. Clean runs without hints move a stage up fastest.'),
          list);
      }

      function drillsCard() {
        var D = CC.Drills;
        var types = D && Array.isArray(D.TYPES) && D.TYPES.length ? D.TYPES.map(function (t) { return { id: t.id, name: t.name || DRILL_NAMES[t.id] || t.id }; })
          : Object.keys(DRILL_NAMES).map(function (k) { return { id: k, name: DRILL_NAMES[k] }; });
        var drills = isObj(data.drills) ? data.drills : {};
        Object.keys(drills).forEach(function (k) { if (!/^gym-/.test(k) && !types.some(function (t) { return t.id === k; })) types.push({ id: k, name: DRILL_NAMES[k] || k }); });
        var done = types.filter(function (t) { return isObj(drills[t.id]) && drills[t.id].total > 0; });
        var gym = gymSummary(drills, CC.Gym);
        var card = h('section', { class: 'card stack', 'aria-labelledby': 'cc-drill-title' },
          h('div', { class: 'card__head m-0' },
            h('h2', { class: 'card__title', id: 'cc-drill-title' }, 'Drill accuracy'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: go('drills', { tab: 'drills' }) }, UI.icon('zap', 16), 'Drills')));
        if (!done.length && !gym) {
          card.appendChild(h('p', { class: 'muted m-0' }, 'No drills yet. They take two minutes, need no cube, and train your eye to spot what to do next.'));
          return card;
        }
        function bar(name, right, total, sub) {
          var acc = Math.round(right / total * 100);
          return h('li', null,
            h('span', { class: 'cc-bars__name' }, name),
            h('span', { class: 'cc-bars__val' }, right + ' of ' + total + ' right · ' + acc + '%'),
            h('span', {
              class: 'cc-meter cc-bars__meter', role: 'meter', 'aria-label': name + ' accuracy',
              'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': acc
            }, h('span', { class: 'cc-meter__fill', style: { width: acc + '%' } })),
            h('p', { class: 'cc-bars__sub' }, sub));
        }
        function verdict(acc) { return acc >= 80 ? 'Solid. ' : acc >= 60 ? 'Getting there. ' : 'Worth another go. '; }
        var rows = done.map(function (t) {
          var d = drills[t.id], acc = Math.round(d.right / d.total * 100);
          return bar(t.name, d.right, d.total, verdict(acc) + (d.lastAt ? 'Last practised ' + fmtDate(d.lastAt) + '.' : ''));
        });
        if (gym) {
          var gacc = Math.round(gym.right / gym.total * 100);
          rows.push(bar('Middle Layer Gym', gym.right, gym.total,
            (gym.tried.length === 1 ? '1 exercise tried. ' : gym.tried.length + ' exercises tried. ') +
            (gym.weakest ? 'Worth another go: ' + gym.weakest.name + ' (' + gym.weakest.acc + '%). ' : verdict(gacc)) +
            (gym.lastAt ? 'Last practised ' + fmtDate(gym.lastAt) + '.' : '')));
        }
        card.appendChild(h('ul', { class: 'cc-bars' }, rows));
        if (gym && CC.Gym) {
          card.appendChild(h('div', { class: 'row row-sm' },
            h('button', { type: 'button', class: 'btn btn-soft btn-sm', onClick: go('gym', gym.weakest ? { drill: gym.weakest.id } : {}) },
              UI.icon('zap', 16), gym.weakest ? 'Practise: ' + gym.weakest.name : 'Open the Middle Layer Gym')));
        }
        return card;
      }

      function milestonesCard() {
        var all = Coach && Coach.milestones ? attempt(function () { return Coach.milestones(data); }, []) : [];
        if (!all.length) return null;
        var earned = all.filter(function (m) { return m.earnedAt; }).length;
        return h('section', { class: 'card stack', 'aria-labelledby': 'cc-ms-title' },
          h('div', { class: 'card__head m-0' },
            h('h2', { class: 'card__title', id: 'cc-ms-title' }, 'Milestones'),
            h('span', { class: 'small muted' }, earned + ' of ' + all.length + ' earned')),
          h('ul', { class: 'cc-msgrid' }, all.map(function (m) {
            return h('li', { class: m.earnedAt ? null : 'is-locked' },
              h('span', { class: 'cc-msgrid__icon', 'aria-hidden': 'true' }, UI.icon('trophy', 20)),
              h('div', null,
                h('p', { class: 'cc-msgrid__name' }, m.name),
                h('p', { class: 'cc-msgrid__desc' }, m.desc || ''),
                h('p', { class: 'cc-msgrid__when' }, m.earnedAt ? 'Earned ' + fmtDate(m.earnedAt) : 'Not yet')));
          })));
      }

      function firstSolveCard() {
        return h('section', { class: 'card empty-state' },
          h('div', { class: 'empty-state__icon' }, UI.icon('stats', 28)),
          h('h2', { class: 'h3' }, 'Your first solve is the big one'),
          h('p', null, 'No solves yet, and that’s exactly where everyone starts. With full guidance a first solve takes about 15 to 20 minutes. After that, this page fills up with your times, your fastest stages and your slowest.'),
          h('div', { class: 'row row-center' },
            h('button', { type: 'button', class: 'btn btn-primary', onClick: go('scan') }, UI.icon('camera', 18), 'Scan my cube'),
            h('button', { type: 'button', class: 'btn btn-secondary', onClick: go('solve', { device: 'virtual', source: 'scramble' }) }, UI.icon('cube', 18), 'Virtual cube'),
            h('button', { type: 'button', class: 'btn btn-ghost', onClick: go('watch') }, UI.icon('watch', 18), 'Watch a demo first')));
      }

      // ---------------------------------------------- assemble
      var noSolvesAtAll = !anySolve;
      el.appendChild(h('div', { class: 'cc-stats stack stack-lg' },
        h('header', { class: 'page-head' },
          h('div', null,
            h('p', { class: 'eyebrow' }, 'Progress'),
            h('h1', null, 'Your stats'),
            h('p', { class: 'muted' }, 'Goal: any cube, on your own, in under ' + clock(goal) + '. ',
              h('a', { class: 'cc-goal-link', href: '#/settings?section=timer' }, 'Change goal')))),
        noSolvesAtAll ? firstSolveCard() : null,
        h('div', { class: 'stack' }, tabBar, panel),
        masteryCard(),
        drillsCard(),
        milestonesCard()));
      panel.setAttribute('aria-labelledby', 'cc-stats-tab-' + device);
      renderPanel();

      return function cleanup() {
        disposers.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
        disposers = [];
      };
    }
  };

  def._levelsSummary = levelsSummary;
  def._gymSummary = gymSummary;
  def._niceStep = niceStep;
  def._clock = clock;

  if (root.CC && root.CC.App) root.CC.App.registerScreen('stats', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
