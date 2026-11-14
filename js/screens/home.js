/* Cube Coach — Home screen.
 *
 * Data-driven dashboard:
 *   - first-visit welcome ("how this works", dismissible: data.settings.welcomeDismissed)
 *   - hero: headline, method summary and the learner's journey (CC.Coach.journey)
 *   - small stats strip (CC.Coach.stats): streak, minutes this week, last, best, average of 5
 *   - "Today's 20 minutes" (CC.Coach.todayPlan) with an "I have my cube / No cube today" switch
 *     (data.settings.hasCube). The plan is snapshotted once per day in data.settings.plan =
 *     { v, day, createdAt, round, items, done:{index:true|false} } so it stays stable while the learner
 *     works through it; items tick off automatically from recorded activity, or by hand.
 *   - skill track: the 8 stages with mastery bars and guidance level (Show → Coach → Nudge → Solo)
 *   - quick-start tiles (with / without a cube) and recent milestones.
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'cc-style-home';
  var CSS = [
    '.cc-home .hero { padding-bottom: var(--space-5); }',
    '.cc-home__lead { max-width: 60ch; }',
    '.cc-journey { margin-top: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-journey__top { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); }',
    '.cc-journey__title { margin: 0; font-size: var(--text-lg); }',
    '.cc-journey__pct { font-weight: 700; color: var(--accent-text); font-variant-numeric: tabular-nums; }',
    '.cc-journey__next { margin: 0; padding: var(--space-3); border-radius: var(--radius); background: var(--accent-soft); color: var(--text); font-size: var(--text-sm); }',
    '.cc-phases { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; list-style: none; margin: 0; padding: 0; }',
    '.cc-phases > li { margin: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 0.75rem; line-height: 1.25; color: var(--text-3); }',
    '.cc-phases > li::before { content: ""; display: block; height: 6px; border-radius: 999px; background: var(--surface-3); }',
    '.cc-phases > li.is-done::before { background: var(--accent); }',
    '.cc-phases > li.is-current::before { background: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft-2); }',
    '.cc-phases > li.is-current { color: var(--accent-text); font-weight: 700; }',
    '.cc-phases > li.is-done { color: var(--text-2); }',
    '@media (max-width: 520px) { .cc-phases > li:not(.is-current) .cc-phases__name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; } }',

    '.cc-welcome__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }',
    '.cc-welcome__steps > li { margin: 0; display: flex; gap: var(--space-3); align-items: flex-start; }',
    '.cc-welcome__num { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-weight: 700; }',

    '.cc-strip { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); }',
    '.cc-strip .stat__value { font-size: var(--text-xl); }',
    '.cc-strip__tile { text-align: left; font: inherit; color: inherit; cursor: pointer; }',
    '.cc-strip__tile:hover { border-color: var(--accent-soft-2); }',

    '.cc-home__cols { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); align-items: start; }',
    '@media (min-width: 980px) { .cc-home__cols { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); } }',

    '.cc-plan { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }',
    '.cc-plan > li + li { margin-top: 0; }',
    '.cc-plan__item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: start; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }',
    '.cc-plan__item.is-next { border-color: var(--accent-soft-2); box-shadow: 0 0 0 1px var(--accent-soft-2); }',
    '.cc-plan__item.is-done { background: var(--surface-2); }',
    '.cc-plan__item.is-done .cc-plan__title { color: var(--text-2); text-decoration: line-through; text-decoration-thickness: 1px; }',
    '.cc-plan__check { flex: none; display: grid; place-items: center; width: 32px; height: 32px; margin-top: 2px; padding: 0; border-radius: 50%; border: 2px solid var(--border-strong); background: var(--surface); color: transparent; cursor: pointer; transition: background var(--dur-1), border-color var(--dur-1), color var(--dur-1); }',
    '.cc-plan__check:hover { border-color: var(--accent); color: var(--text-3); }',
    '.cc-plan__check[aria-pressed="true"] { background: var(--success); border-color: var(--success); color: var(--surface); }',
    '.cc-plan__check .icon { width: 18px; height: 18px; }',
    '.cc-plan__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 4px; font-size: var(--text-xs); color: var(--text-3); font-weight: 600; }',
    '.cc-plan__meta .icon { width: 14px; height: 14px; }',
    '.cc-plan__title { margin: 0 0 2px; font-size: 1rem; font-weight: 650; line-height: 1.3; }',
    '.cc-plan__why { margin: 0; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-plan__tip { margin: 6px 0 0; font-size: var(--text-sm); color: var(--text-2); padding-left: 10px; border-left: 3px solid var(--accent-soft-2); }',
    '.cc-plan__actions { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }',
    '.cc-plan__alt { font-size: var(--text-xs); }',
    '@media (max-width: 600px) { .cc-plan__item { grid-template-columns: auto minmax(0, 1fr); } .cc-plan__actions { grid-column: 2; flex-direction: row; flex-wrap: wrap; align-items: center; } }',
    '.cc-plan__summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }',
    '.cc-plan__summary .progress { flex: 1 1 140px; }',

    '.cc-skills { list-style: none; margin: 0; padding: 0; }',
    '.cc-skills > li + li { margin-top: 2px; }',
    '.cc-skill { width: 100%; display: grid; grid-template-columns: 1.5em minmax(0, 1fr) auto; gap: 6px var(--space-2); align-items: center; padding: 8px var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }',
    '.cc-skill:hover { background: var(--surface-2); }',
    '.cc-skill.is-focus { background: var(--accent-soft); }',
    '.cc-skill__num { font-weight: 700; color: var(--text-3); font-variant-numeric: tabular-nums; }',
    '.cc-skill__name { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.cc-skill__tags { display: inline-flex; gap: 4px; align-items: center; }',
    '.cc-skill__bar { grid-column: 2 / -1; display: flex; align-items: center; gap: var(--space-2); }',
    '.cc-skill__bar .cc-meter { flex: 1 1 auto; }',
    '.cc-skill__pct { flex: none; width: 3ch; text-align: right; font-size: var(--text-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }',
    '.cc-meter { position: relative; height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }',
    '.cc-meter__fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: inherit; background: var(--accent); transition: width var(--dur-3) var(--ease); }',
    '.cc-meter__tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--surface); }',
    '.cc-lvl { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); font-size: var(--text-xs); font-weight: 700; line-height: 1.5; white-space: nowrap; }',
    '.cc-lvl[data-level="2"] { background: var(--accent-soft); border-color: var(--accent-soft-2); color: var(--accent-text); }',
    '.cc-lvl[data-level="1"] { background: var(--accent-soft-2); border-color: transparent; color: var(--accent-text); }',
    '.cc-lvl[data-level="0"] { background: var(--accent); border-color: transparent; color: var(--on-accent); }',
    '.cc-levels { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-3); }',
    '.cc-levels .icon { width: 14px; height: 14px; }',

    '.cc-quick { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); }',
    '@media (min-width: 760px) { .cc-quick { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '.cc-ms { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }',
    '.cc-ms > li { margin: 0; display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); }',
    '.cc-ms__icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-text); }',
    '.cc-ms > li.is-locked { background: var(--surface-2); border-style: dashed; }',
    '.cc-ms > li.is-locked .cc-ms__icon { background: var(--surface-3); color: var(--text-3); }',
    '.cc-ms__name { margin: 0; font-weight: 650; line-height: 1.3; }',
    '.cc-ms__desc { margin: 2px 0 0; font-size: var(--text-sm); color: var(--text-2); }'
  ].join('\n');

  var KIND = {
    lesson: { icon: 'learn', label: 'Lesson', start: 'Open lesson' },
    watch: { icon: 'watch', label: 'Watch', start: 'Watch' },
    drill: { icon: 'zap', label: 'Drill', start: 'Start drill' },
    virtual: { icon: 'cube', label: 'Virtual cube', start: 'Start' },
    solve: { icon: 'camera', label: 'Your cube', start: 'Scan my cube' },
    timed: { icon: 'timer', label: 'Timed', start: 'Start timer' },
    algs: { icon: 'tip', label: 'Flashcards', start: 'Review' }
  };
  var LEVEL_NAMES = ['Solo', 'Nudge', 'Coach', 'Show'];
  var THRESHOLDS = [78, 50, 25];
  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];

  // ------------------------------------------------------------ helpers (no DOM)
  function CCx() { return root.CC || {}; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function attempt(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayKey(d) {
    var C = CCx().Coach;
    if (C && C.dayKey) return C.dayKey(d);
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function ms(v) { var t = Date.parse(v); return isFinite(t) ? t : NaN; }
  function fmtClock(msv) { // m:ss for goals
    var s = Math.round(msv / 1000);
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }
  function fmtDay(iso, now) {
    var t = ms(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t), today = dayKey(now), k = dayKey(d);
    if (k === today) return 'today';
    if (k === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'yesterday';
    try {
      return d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return k; }
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
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  // The item as shown: with no cube, real-cube items swap for their no-cube alternative.
  function shownItem(item, hasCube) {
    if (hasCube || !item || !item.alt) return item;
    var a = {};
    Object.keys(item.alt).forEach(function (k) { a[k] = item.alt[k]; });
    a.minutes = item.minutes;
    return a;
  }

  // Did the learner do this item since the plan was made? (lesson/watch tick when started.)
  function evidence(item, data, sinceIso, now) {
    var t0 = ms(sinceIso);
    if (!isFinite(t0)) t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var solves = (Array.isArray(data.solves) ? data.solves : []).filter(function (s) {
      return isObj(s) && ms(s.at) >= t0 && s.completed !== false;
    });
    var st = item.stageId || null;
    switch (item.kind) {
      case 'drill': {
        var d = isObj(data.drills) ? data.drills[item.drillType || item.target] : null;
        return !!(isObj(d) && d.lastAt && ms(d.lastAt) >= t0);
      }
      case 'virtual':
        return solves.some(function (s) { return s.device === 'virtual' && (st ? (!s.stage || s.stage === st) : !s.stage); });
      case 'solve':
        return solves.some(function (s) { return s.device !== 'virtual' && (st ? (!s.stage || s.stage === st) : !s.stage); });
      case 'timed': {
        // "Average of 5 on your real cube" needs five solves, not one.
        var need = /\bof 5\b/i.test(String(item.title || '')) ? 5 : 1;
        return solves.filter(function (s) { return s.device !== 'virtual' && !s.stage && hintTotal(s) === 0; }).length >= need;
      }
      case 'algs': {
        var ids = Array.isArray(item.algIds) && item.algIds.length ? item.algIds : [item.target];
        return ids.every(function (id) {
          var a = isObj(data.algs) ? data.algs[id] : null;
          return isObj(a) && ms(a.due) > now.getTime() && Number(a.total) > 0;
        });
      }
      default: return false;
    }
  }

  // Where each kind of plan item goes. Exported for tests.
  function routeFor(item) {
    var st = item.stageId || null;
    switch (item.kind) {
      case 'lesson': return ['lesson', { id: item.stageId || item.target || 'notation' }];
      case 'watch':
        // The speed phase's "Speed tip" item has no stage: the tips live on the Learn page.
        if (!st && item.target === 'speed-tips') return ['learn', { section: 'tips' }];
        return ['watch', st ? { stage: st } : {}];
      case 'drill': {
        var p = { tab: 'drills' };
        if (item.drillType || item.target) p.type = item.drillType || item.target;
        if (st) p.stage = st;
        return ['drills', p];
      }
      case 'virtual': {
        var v = { device: 'virtual', source: st ? 'drill' : 'scramble' };
        if (st) v.stage = st;
        if (item.timed) v.timed = true;
        return ['solve', v];
      }
      case 'solve': return ['scan', {}];
      case 'timed': return ['solve', { device: 'physical', source: 'scramble', timed: true }];
      case 'algs': return ['drills', { tab: 'algs' }];
      default: return ['learn', {}];
    }
  }

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------ screen
  var def = {
    title: 'Home',
    mount: function (el) {
      injectStyle();
      var CC = root.CC, UI = CC.UI, h = UI.h, App = CC.App, Coach = CC.Coach || null;
      var data = App.data;
      var settings = data.settings;
      var listeners = [];
      var disposed = false;

      function go(id, params) { return function () { App.go(id, params || {}); }; }
      function on(target, type, fn) { target.addEventListener(type, fn); listeners.push([target, type, fn]); }
      function hasCube() { return settings.hasCube !== false; }
      function goalText() { return fmtClock(goalMs(data)); }

      // ---------------------------------------------- plan snapshot
      // force: 'more' = another round today; 'refresh' = rebuild this round from the latest progress
      // (same round, and activity since the round began still ticks items off).
      function getPlan(force) {
        var now = new Date();
        var p = settings.plan;
        var today = dayKey(now);
        if (!force && isObj(p) && p.v === 1 && p.day === today && Array.isArray(p.items) && p.items.length &&
          p.items.every(function (it) { return isObj(it) && typeof it.kind === 'string'; })) return p;
        var items = [];
        if (Coach && Coach.todayPlan) items = attempt(function () { return clone(Coach.todayPlan(data, now)); }, []);
        var sameDay = isObj(p) && p.day === today;
        var round = sameDay ? (Number(p.round) || 1) : 1;
        var keepStart = force === 'refresh' && sameDay && isFinite(ms(p.createdAt));
        p = {
          v: 1, day: today, createdAt: keepStart ? p.createdAt : now.toISOString(),
          round: sameDay && force === 'more' ? round + 1 : round,
          items: items, done: {}
        };
        settings.plan = p;
        App.save();
        return p;
      }
      function isDone(p, i, item, now) {
        var d = isObj(p.done) ? p.done[i] : undefined;
        if (d === true || d === false) return d;
        return evidence(item, data, p.createdAt, now);
      }
      function setDone(p, i, val) {
        if (!isObj(p.done)) p.done = {};
        p.done[i] = val;
        App.save();
      }

      // ---------------------------------------------- sections
      var root$ = h('div', { class: 'cc-home stack stack-lg' });
      var stripHost = h('div');
      var planHost = h('section', { class: 'card stack', 'aria-labelledby': 'cc-plan-title' });
      var quickHost = h('div');

      function welcomeCard() {
        if (settings.welcomeDismissed) return null;
        var card;
        function dismiss() {
          settings.welcomeDismissed = true;
          App.save();
          if (card && card.parentNode) card.parentNode.removeChild(card);
          var t = document.getElementById('cc-plan-title');
          if (t) { t.setAttribute('tabindex', '-1'); try { t.focus(); } catch (e) { /* ignore */ } }
        }
        function step(n, title, text) {
          return h('li', null, h('span', { class: 'cc-welcome__num', 'aria-hidden': 'true' }, String(n)),
            h('div', null, h('p', { class: 'strong m-0' }, title), h('p', { class: 'small muted m-0' }, text)));
        }
        card = h('section', { class: 'card card-accent stack', 'aria-labelledby': 'cc-welcome-title' },
          h('div', { class: 'row row-between row-top' },
            h('div', null,
              h('p', { class: 'eyebrow' }, 'Welcome'),
              h('h2', { class: 'h3 m-0', id: 'cc-welcome-title' }, 'How Cube Coach works')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Dismiss the welcome', onClick: dismiss }, UI.icon('x', 18))),
          h('ol', { class: 'cc-welcome__steps' },
            step(1, 'Learn 8 short stages', 'The solve is split into 8 stages. At first the coach shows every move and you simply copy it.'),
            step(2, 'Help fades as you improve', 'Each time you get a stage right, the coach steps back: Show, then Coach, then Nudge, then Solo.'),
            step(3, 'Then get faster', 'Once you can solve on your own, the timer takes over. The goal: any cube in under ' + goalText() + '.')),
          h('p', { class: 'small muted m-0' }, 'About 20 minutes a day is plenty. No cube with you? Demos, drills and the on-screen cube all count.'),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-primary', onClick: dismiss }, 'Got it, let’s start')));
        return card;
      }

      function hero() {
        var j = Coach && Coach.journey ? attempt(function () { return Coach.journey(data); }, null) : null;
        var phases = [
          { id: 'learn', name: 'Learn the method' },
          { id: 'practice', name: 'Practise with a coach' },
          { id: 'independent', name: 'Solve on your own' },
          { id: 'speed', name: 'Get under ' + goalText() }
        ];
        var pi = j ? Math.max(0, phases.map(function (p) { return p.id; }).indexOf(j.phase)) : 0;
        var pct = j ? Math.round((Number(j.progress) || 0) * 100) : 0;
        var journey = null;
        if (j) {
          var focus = j.focusStage;
          journey = h('div', { class: 'cc-journey', role: 'group', 'aria-label': 'Your journey' },
            h('ol', { class: 'cc-phases', 'aria-label': 'Phases' }, phases.map(function (p, i) {
              return h('li', {
                class: i < pi ? 'is-done' : i === pi ? 'is-current' : null,
                'aria-current': i === pi ? 'step' : null
              }, h('span', { class: 'cc-phases__name' }, (i + 1) + '. ' + p.name),
              h('span', { class: 'sr-only' }, i < pi ? ' (done)' : i === pi ? ' (you are here)' : ''));
            })),
            h('div', { class: 'cc-journey__top' },
              h('h2', { class: 'cc-journey__title' }, 'Phase ' + (pi + 1) + ' of 4: ' + j.title),
              h('span', { class: 'cc-journey__pct' }, pct + '%')),
            h('div', {
              class: 'progress', role: 'progressbar', 'aria-label': 'Progress through this phase',
              'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct
            }, h('div', { class: 'progress__bar', style: { width: pct + '%' } })),
            h('p', { class: 'small muted m-0' }, j.description),
            j.next ? h('p', { class: 'cc-journey__next' }, /^(next|keep going)\b/i.test(j.next) ? null : h('strong', null, 'Next: '), j.next) : null,
            focus && j.phase === 'learn' ? h('div', { class: 'row row-sm' },
              h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: go('lesson', { id: focus }) }, UI.icon('learn', 16), 'Lesson: ' + stageName(focus)),
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: go('watch', { stage: focus }) }, UI.icon('watch', 16), 'Watch the demo')) : null);
        }
        return h('section', { class: 'hero stack', 'aria-labelledby': 'cc-hero-title' },
          h('p', { class: 'eyebrow m-0' }, 'Your Rubik’s cube coach'),
          h('h1', { class: 'm-0', id: 'cc-hero-title' }, 'Learn to solve the cube, then do it on your own in under ' + goalText() + '.'),
          h('p', { class: 'lead m-0 cc-home__lead' },
            'One beginner method in 8 short stages, holding the cube with YELLOW on top the whole way. ',
            'The coach shows every move at first, then gives less help as you master each stage.'),
          journey);
      }

      function statTile(label, value, sub, title, params) {
        return h('button', { type: 'button', class: 'card card-sm stat cc-strip__tile', title: title || null, onClick: go('stats', params) },
          h('span', { class: 'stat__label' }, label),
          h('span', { class: 'stat__value' }, value),
          sub ? h('span', { class: 'stat__sub' }, sub) : null);
      }
      function renderStrip() {
        UI.empty(stripHost);
        var all = Coach && Coach.stats ? attempt(function () { return Coach.stats(data); }, null) : null;
        if (!all) return;
        // Times come from one kind of cube (like the Stats page): real-cube solves when there are any,
        // otherwise the virtual cube. Mixing mouse-and-keyboard solves into a real-cube average misleads.
        var real = attempt(function () { return Coach.stats(data, { device: 'physical' }); }, null);
        var virt = attempt(function () { return Coach.stats(data, { device: 'virtual' }); }, null);
        var useVirtual = !(real && real.attempts) && !!(virt && virt.attempts);
        var s = useVirtual ? virt : (real || all);
        var where = !s.attempts ? null : useVirtual ? 'virtual cube' : 'real cube';
        var dev = { device: useVirtual ? 'virtual' : 'physical' };
        var t = UI.fmtTime;
        var mins = Math.round(Number(all.weekMinutes) || 0);
        var toGo = Math.max(1, 5 - (s.attempts || s.count || 0));
        stripHost.appendChild(h('section', { 'aria-label': 'Your numbers' },
          h('div', { class: 'cc-strip' },
            statTile('Streak', String(all.streak || 0), (all.streak === 1 ? 'day' : 'days') + ' in a row'),
            statTile('This week', String(mins), 'minutes practised'),
            statTile('Last solve', s.last != null ? t(s.last) : '—', s.last != null ? where : 'no solves yet', null, dev),
            statTile('Best', s.best != null ? t(s.best) : '—',
              !useVirtual && s.unaided && s.unaided.best != null
                ? (s.unaided.best === s.best ? 'unaided: no help, no hints' : 'unaided ' + t(s.unaided.best)) : where, null, dev),
            statTile('Average of 5', s.ao5Dnf ? 'DNF' : s.ao5 != null ? t(s.ao5) : '—',
              s.ao5 != null || s.ao5Dnf ? 'goal ' + goalText() : (s.count < 5 ? toGo + ' more solve' + (toGo === 1 ? '' : 's') + ' to go' : null),
              'Average of your last 5 ' + (where ? where + ' ' : '') + 'solves, dropping the best and the worst', dev))));
      }

      function renderPlan(focusKey) {
        UI.empty(planHost);
        var now = new Date();
        var p = getPlan(false);
        var cube = hasCube();
        var items = p.items.map(function (it) { return shownItem(it, cube); });
        var states = items.map(function (it, i) { return isDone(p, i, it, now); });
        var doneCount = states.filter(Boolean).length;
        var total = 0, doneMin = 0;
        items.forEach(function (it, i) { total += Number(it.minutes) || 0; if (states[i]) doneMin += Number(it.minutes) || 0; });
        var nextIdx = states.indexOf(false);

        var seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Is your cube with you?' },
          [[true, 'I have my cube'], [false, 'No cube today']].map(function (o) {
            return h('button', {
              type: 'button', 'aria-pressed': cube === o[0], dataset: { focus: 'cube-' + o[0] },
              onClick: function () {
                if (hasCube() === o[0]) return;
                settings.hasCube = o[0];
                App.save();
                renderPlan('cube-' + o[0]);
                renderQuick();
              }
            }, UI.icon(o[0] ? 'cube' : 'watch', 16), o[1]);
          }));

        var list = h('ol', { class: 'cc-plan' });
        items.forEach(function (it, i) {
          var k = it.kind === 'watch' && !it.stageId && it.target === 'speed-tips'
            ? { icon: 'tip', label: 'Speed tips', start: 'Read the tips' }
            : KIND[it.kind] || { icon: 'info', label: it.kind, start: 'Start' };
          var done = states[i];
          var route = routeFor(it);
          function start() {
            if (it.kind === 'lesson' || it.kind === 'watch' || it.kind === 'algs') setDone(p, i, true);
            App.go(route[0], route[1]);
          }
          var tip = isObj(it.tip) && it.tip.text ? h('p', { class: 'cc-plan__tip' }, it.tip.title ? h('strong', null, it.tip.title + ': ') : null, it.tip.text) : null;
          list.appendChild(h('li', { class: ['cc-plan__item', done ? 'is-done' : null, i === nextIdx ? 'is-next' : null] },
            h('button', {
              type: 'button', class: 'cc-plan__check', 'aria-pressed': done, dataset: { focus: 'check-' + i },
              'aria-label': (done ? 'Done: ' : 'Mark as done: ') + it.title,
              title: done ? 'Done. Click to untick.' : 'Mark as done',
              onClick: function () { setDone(p, i, !done); renderPlan('check-' + i); }
            }, UI.icon('check', 18)),
            h('div', { class: 'cc-plan__body' },
              h('div', { class: 'cc-plan__meta' },
                h('span', { class: 'badge' }, (it.minutes || 0) + ' min'),
                h('span', { class: 'row row-xs row-nowrap' }, UI.icon(k.icon, 14), k.label),
                it.needsCube ? h('span', { class: 'badge badge-info' }, 'Needs your cube') : null,
                done ? h('span', { class: 'badge badge-success' }, 'Done') : null),
              h('h3', { class: 'cc-plan__title' }, it.title),
              it.why ? h('p', { class: 'cc-plan__why' }, it.why) : null,
              tip),
            h('div', { class: 'cc-plan__actions' },
              h('button', {
                type: 'button', class: ['btn', 'btn-sm', i === nextIdx ? 'btn-primary' : 'btn-secondary'],
                dataset: { focus: 'start-' + i }, onClick: start,
                'aria-label': k.start + ': ' + it.title
              }, done ? 'Again' : k.start, UI.icon('arrowRight', 16)),
              it.kind === 'solve' ? h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm cc-plan__alt',
                onClick: function () {
                  App.go('solve', it.stageId ? { device: 'physical', source: 'scramble', stage: it.stageId } : { device: 'physical', source: 'scramble' });
                }
              }, 'or use a practice scramble') : null)));
        });

        var allDone = items.length > 0 && doneCount === items.length;
        var pct = total ? Math.round(doneMin / total * 100) : 0;
        planHost.appendChild(h('div', { class: 'card__head m-0' },
          h('div', null,
            h('p', { class: 'eyebrow' }, p.round > 1 ? 'Today · extra round ' + (p.round - 1) : 'Today'),
            h('h2', { class: 'card__title', id: 'cc-plan-title' }, 'Today’s ' + (total || 20) + ' minutes')),
          seg));
        planHost.appendChild(h('p', { class: 'small muted m-0' }, cube
          ? 'A short session picked for where you are now. Items tick off by themselves as you do them, or tick them yourself.'
          : 'No cube? No problem: everything below works on screen. Demos, drills and the virtual cube all build the same skills.'));
        if (items.length) {
          planHost.appendChild(h('div', { class: 'cc-plan__summary' },
            h('div', {
              class: ['progress', allDone ? 'progress-success' : null], role: 'progressbar', 'aria-label': 'Today’s plan',
              'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct
            }, h('div', { class: 'progress__bar', style: { width: pct + '%' } })),
            h('span', { class: 'small muted num' }, doneCount + ' of ' + items.length + ' done · ' + doneMin + ' of ' + total + ' min')));
          planHost.appendChild(list);
        } else {
          planHost.appendChild(UI.callout('info', 'Your plan isn’t ready', 'The coach couldn’t build today’s plan. Start with the Learn tab: the notation lesson, then the Daisy.'));
        }
        if (allDone) {
          planHost.appendChild(UI.callout('success', 'That’s today’s session done. Well played.',
            'Short daily practice beats long weekly sessions. Come back tomorrow to keep your streak going, or carry on now if you’re enjoying it.',
            h('div', { class: 'mt-2' }, h('button', {
              type: 'button', class: 'btn btn-sm btn-primary', dataset: { focus: 'more' },
              onClick: function () { getPlan('more'); renderPlan('start-0'); }
            }, UI.icon('refresh', 16), 'Plan another 20 minutes'))));
        } else if (items.length) {
          planHost.appendChild(h('div', { class: 'row row-end' }, h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', dataset: { focus: 'refresh' },
            title: 'Builds a fresh plan from your latest progress',
            onClick: function () { getPlan('refresh'); renderPlan('refresh'); App.toast('Fresh plan ready, based on your latest progress.'); }
          }, UI.icon('refresh', 16), 'Refresh plan')));
        }
        if (focusKey) {
          var f = planHost.querySelector('[data-focus="' + focusKey + '"]');
          if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        }
      }

      function skillsCard() {
        var j = Coach && Coach.journey ? attempt(function () { return Coach.journey(data); }, null) : null;
        var focus = j && j.phase !== 'speed' ? j.focusStage : null;
        var override = settings.guidanceOverride;
        var list = h('ol', { class: 'cc-skills' });
        stageList().forEach(function (s, i) {
          var m = Coach && Coach.masteryOf ? attempt(function () { return Coach.masteryOf(data, s.id); }, 0) : ((data.skills && data.skills[s.id] && data.skills[s.id].mastery) || 0);
          var lvl = Coach && Coach.autoLevel ? attempt(function () { return Coach.autoLevel(data, s.id); }, 3) : 3;
          var sk = data.skills && data.skills[s.id];
          var started = sk && sk.sessions > 0;
          var mr = Math.floor(Math.max(0, Math.min(100, Number(m) || 0)));
          list.appendChild(h('li', null, h('button', {
            type: 'button', class: ['cc-skill', s.id === focus ? 'is-focus' : null],
            'aria-label': (i + 1) + '. ' + stageName(s.id) + ': ' + LEVEL_NAMES[lvl] + ' level, mastery ' + mr + ' out of 100' +
              (started ? '' : ', not tried yet') + (s.id === focus ? ', up next' : '') + '. Open the lesson.',
            onClick: go('lesson', { id: s.id })
          },
          h('span', { class: 'cc-skill__num', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'cc-skill__name' }, stageName(s.id)),
          h('span', { class: 'cc-skill__tags' },
            s.id === focus ? h('span', { class: 'badge badge-accent' }, 'Up next') : null,
            h('span', { class: 'cc-lvl', dataset: { level: lvl } }, started ? LEVEL_NAMES[lvl] : 'New')),
          h('span', { class: 'cc-skill__bar', 'aria-hidden': 'true' },
            h('span', { class: 'cc-meter' },
              h('span', { class: 'cc-meter__fill', style: { width: mr + '%' } }),
              THRESHOLDS.map(function (t) { return h('span', { class: 'cc-meter__tick', style: { left: t + '%' } }); })),
            h('span', { class: 'cc-skill__pct' }, String(mr))))));
        });
        var levelsLegend = h('div', { class: 'cc-levels', 'aria-label': 'Guidance levels, from most help to least' },
          h('span', { class: 'cc-lvl', dataset: { level: 3 } }, 'Show'), UI.icon('arrowRight', 14),
          h('span', { class: 'cc-lvl', dataset: { level: 2 } }, 'Coach'), UI.icon('arrowRight', 14),
          h('span', { class: 'cc-lvl', dataset: { level: 1 } }, 'Nudge'), UI.icon('arrowRight', 14),
          h('span', { class: 'cc-lvl', dataset: { level: 0 } }, 'Solo'));
        return h('section', { class: 'card stack', 'aria-labelledby': 'cc-skills-title' },
          h('div', { class: 'card__head m-0' },
            h('h2', { class: 'card__title', id: 'cc-skills-title' }, 'Your 8 stages'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: go('stats') }, UI.icon('stats', 16), 'Stats')),
          h('p', { class: 'small muted m-0' }, 'Every stage starts at Show: each move is shown and you copy it. As you get a stage right, the coach steps back, until it’s just you and the timer.'),
          levelsLegend,
          list,
          typeof override === 'number' && override >= 0 && override <= 3
            ? UI.callout('info', null, 'Guidance is fixed at ' + LEVEL_NAMES[override] + ' in Settings. The bars still show what you’ve earned. ',
              h('a', { href: '#/settings' }, 'Change it'))
            : h('p', { class: 'xsmall subtle m-0' }, 'Tick marks show where help steps down: 25 Coach, 50 Nudge, 78 Solo. Tap a stage to open its lesson.'));
      }

      // The tiles for today's situation (cube or no cube) come first; re-ordered when the switch changes.
      function renderQuick() { UI.empty(quickHost); quickHost.appendChild(quickStart()); }
      function quickStart() {
        var withCube = h('section', { class: 'stack stack-sm', 'aria-labelledby': 'cc-qs-cube' },
          h('h2', { class: 'h3 m-0', id: 'cc-qs-cube' }, 'With your cube'),
          UI.tile({ icon: 'camera', title: 'Scan & solve', desc: 'Show the camera each face, then follow coaching made for your cube.', onClick: go('scan') }),
          UI.tile({ icon: 'cube', title: 'Practice scramble', desc: 'Scramble your cube with the moves shown, then solve it with as much help as you need.', onClick: go('solve', { device: 'physical', source: 'scramble' }) }),
          UI.tile({ icon: 'timer', title: 'Timed solve', desc: 'No help, just inspection and a timer. Every unaided solve counts towards ' + goalText() + '.', onClick: go('solve', { device: 'physical', source: 'scramble', timed: true }) }));
        var noCube = h('section', { class: 'stack stack-sm', 'aria-labelledby': 'cc-qs-nocube' },
          h('h2', { class: 'h3 m-0', id: 'cc-qs-nocube' }, 'No cube to hand'),
          UI.tile({ icon: 'watch', title: 'Watch & learn', desc: 'Narrated 3D demos of every stage. Pause and guess the next move.', badge: 'No cube needed', onClick: go('watch') }),
          UI.tile({ icon: 'zap', title: 'Drills', desc: 'Two-minute quizzes: move names, spotting cases, what comes next.', onClick: go('drills', { tab: 'drills' }) }),
          UI.tile({ icon: 'cube', title: 'Virtual cube', desc: 'Solve the on-screen cube. The coach can check every single move.', onClick: go('solve', { device: 'virtual', source: 'scramble' }) }),
          UI.tile({ icon: 'tip', title: 'Algorithms', desc: 'Flashcards for the 7 move sequences, spaced so they stick.', onClick: go('drills', { tab: 'algs' }) }));
        return h('div', { class: 'cc-quick' }, hasCube() ? [withCube, noCube] : [noCube, withCube]);
      }

      // Middle Layer Gym: offered when the middle layer is the stage to work on (or the gym was used lately).
      function gymTile() {
        if (!CC.Gym || !App.screens || App.screens().indexOf('gym') === -1) return null;
        var focus = Coach && Coach.journey ? attempt(function () { return Coach.journey(data).focusStage; }, null) : null;
        var weakest = null, low = Infinity;
        if (Coach && Coach.masteryOf) stageList().forEach(function (s) { var m = attempt(function () { return Coach.masteryOf(data, s.id); }, 0); if (m < low) { low = m; weakest = s.id; } });
        var recent = isObj(data.gym) && Object.keys(data.gym).some(function (k) { var t = ms(data.gym[k] && data.gym[k].lastAt); return isFinite(t) && Date.now() - t < 7 * 864e5; });
        if (focus !== 'middle' && weakest !== 'middle' && !recent) return null;
        return UI.tile({ icon: 'zap', title: 'Middle Layer Gym', badge: 'Stage 4', onClick: go('gym'),
          desc: 'Stuck on the middle layer? Short exercises for remembering the moves, seeing what to do, stuck edges and keeping your place.' });
      }

      function milestonesCard() {
        var all = Coach && Coach.milestones ? attempt(function () { return Coach.milestones(data); }, []) : [];
        if (!all.length) return null;
        var now = new Date();
        var earned = all.filter(function (m) { return m.earnedAt; })
          .sort(function (a, b) { return (ms(b.earnedAt) || 0) - (ms(a.earnedAt) || 0); });
        var next = all.filter(function (m) { return !m.earnedAt; })[0] || null;
        var items = earned.slice(0, 3).map(function (m) {
          return h('li', null, h('span', { class: 'cc-ms__icon', 'aria-hidden': 'true' }, UI.icon('trophy', 20)),
            h('div', null, h('p', { class: 'cc-ms__name' }, m.name),
              h('p', { class: 'cc-ms__desc' }, 'Earned ' + fmtDay(m.earnedAt, now) + '. ' + (m.desc || ''))));
        });
        if (next) {
          items.push(h('li', { class: 'is-locked' }, h('span', { class: 'cc-ms__icon', 'aria-hidden': 'true' }, UI.icon('trophy', 20)),
            h('div', null, h('p', { class: 'cc-ms__name' }, (earned.length ? 'Next: ' : 'Your first milestone: ') + next.name),
              h('p', { class: 'cc-ms__desc' }, next.desc || ''))));
        }
        return h('section', { class: 'stack stack-sm', 'aria-labelledby': 'cc-ms-title' },
          h('div', { class: 'row row-between' },
            h('h2', { class: 'h3 m-0', id: 'cc-ms-title' }, earned.length ? 'Recent milestones' : 'Milestones'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: go('stats') },
              earned.length + ' of ' + all.length + ' earned', UI.icon('arrowRight', 16))),
          h('ul', { class: 'cc-ms' }, items));
      }

      // ---------------------------------------------- assemble
      var welcome = welcomeCard();
      if (welcome) root$.appendChild(welcome);
      root$.appendChild(hero());
      var gym$ = gymTile();
      if (gym$) root$.appendChild(gym$);
      root$.appendChild(stripHost);
      renderStrip();
      renderPlan();
      root$.appendChild(h('div', { class: 'cc-home__cols' }, planHost, skillsCard()));
      root$.appendChild(quickHost);
      renderQuick();
      var ms$ = milestonesCard();
      if (ms$) root$.appendChild(ms$);
      el.appendChild(root$);

      // Keep the numbers fresh while the screen is open (the shell logs a practice minute each minute).
      on(root, 'cc:practice', function () { if (!disposed) renderStrip(); });
      // Coming back to the tab later in the day (or the next day) refreshes the plan's ticks.
      if (typeof document !== 'undefined') {
        on(document, 'visibilitychange', function () {
          if (disposed || document.visibilityState !== 'visible') return;
          renderStrip();
          renderPlan();
        });
      }

      return function cleanup() {
        disposed = true;
        listeners.forEach(function (l) { try { l[0].removeEventListener(l[1], l[2]); } catch (e) { /* ignore */ } });
        listeners = [];
      };
    }
  };

  def._routeFor = routeFor;
  def._evidence = evidence;
  def._shownItem = shownItem;

  if (root.CC && root.CC.App) root.CC.App.registerScreen('home', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
