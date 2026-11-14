/* Cube Coach — app shell (CC.App) and tiny UI kit (CC.UI).
 *
 * CC.App: screen registry, hash routing (#/screen?key=value), modal, toast, notices, data + save,
 *         active-practice tracker, error boundary around every screen mount.
 * CC.UI:  h() hyperscript plus small shared widgets (alg chips, stage track, colour dots, icons).
 *
 * Nothing here touches the DOM at load time: everything DOM-related runs inside functions, and
 * CC.App.boot() (called from index.html on DOMContentLoaded) wires up the page.
 */
(function (root) {
  'use strict';

  // ================================================================ environment
  function hasDOM() {
    return typeof document !== 'undefined' && typeof window !== 'undefined' && !!document.createElement;
  }
  function CC() { return root.CC || {}; }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = {
    svg: 1, path: 1, circle: 1, rect: 1, g: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1,
    defs: 1, use: 1, text: 1, tspan: 1, linearGradient: 1, radialGradient: 1, stop: 1, clipPath: 1, mask: 1
  };
  var PROP_ATTRS = { value: 1, checked: 1, selected: 1, muted: 1, indeterminate: 1 };

  // ================================================================ CC.UI
  function appendChildren(el, kids) {
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) { appendChildren(el, c); continue; }
      if (typeof c === 'object' && typeof c.nodeType === 'number') { el.appendChild(c); continue; }
      el.appendChild(document.createTextNode(String(c)));
    }
  }

  function classString(v) {
    if (v == null || v === false) return '';
    if (Array.isArray(v)) return v.map(classString).filter(Boolean).join(' ');
    if (typeof v === 'object') return Object.keys(v).filter(function (k) { return v[k]; }).join(' ');
    return String(v);
  }

  function isAttrsObject(a) {
    return a != null && typeof a === 'object' && !Array.isArray(a) && typeof a.nodeType !== 'number';
  }

  // h('button', { class:'btn btn-primary', onClick: fn, disabled: false, dataset:{id:1}, style:{gap:'4px'} }, 'Go')
  function h(tag, attrs) {
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs != null && !isAttrsObject(attrs)) { kids.unshift(attrs); attrs = null; }
    var el = SVG_TAGS[tag] ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class' || k === 'className') {
          var cls = classString(v);
          if (cls) el.setAttribute('class', cls);
        } else if (k === 'style') {
          if (v == null) return;
          if (typeof v === 'string') { el.setAttribute('style', v); return; }
          Object.keys(v).forEach(function (p) {
            if (v[p] == null || v[p] === false) return;
            if (p.indexOf('-') !== -1) el.style.setProperty(p, String(v[p]));
            else el.style[p] = v[p];
          });
        } else if (k === 'dataset') {
          if (!v) return;
          Object.keys(v).forEach(function (d) { if (v[d] != null) el.dataset[d] = String(v[d]); });
        } else if (k === 'ref') {
          if (typeof v === 'function') v(el);
        } else if (/^on[A-Za-z]/.test(k) && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (PROP_ATTRS[k] && !SVG_TAGS[tag]) {
          if (v != null) el[k] = v;
        } else if (k === 'htmlFor') {
          if (v != null) el.setAttribute('for', v);
        } else if (v == null || v === false) {
          if (/^aria-/.test(k) && v === false) el.setAttribute(k, 'false');
        } else if (v === true) {
          el.setAttribute(k, /^aria-/.test(k) ? 'true' : '');
        } else {
          el.setAttribute(k, String(v));
        }
      });
    }
    appendChildren(el, kids);
    return el;
  }

  function empty(el) {
    if (!el) return el;
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // 9.05 · 59.99 · 1:23.45 · 1:02:03.04 (times are truncated to centiseconds, like a cube timer)
  function fmtTime(ms) {
    if (typeof ms === 'string' && ms.trim() !== '') ms = Number(ms);
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    if (ms < 0) ms = 0;
    var cs = Math.floor(ms / 10 + 1e-6);
    var c = cs % 100, total = Math.floor(cs / 100);
    var s = total % 60, m = Math.floor(total / 60) % 60, hr = Math.floor(total / 3600);
    if (hr) return hr + ':' + pad2(m) + ':' + pad2(s) + '.' + pad2(c);
    if (m) return m + ':' + pad2(s) + '.' + pad2(c);
    return s + '.' + pad2(c);
  }

  function toTokens(tokens) {
    if (tokens == null) return [];
    var Cube = CC().Cube;
    try {
      if (Cube && Cube.parseAlg) return Cube.parseAlg(tokens);
    } catch (e) { /* fall through to a forgiving split */ }
    if (Array.isArray(tokens)) return tokens.map(String);
    return String(tokens).trim().split(/\s+/).filter(Boolean);
  }

  function moveInfoSafe(tok) {
    var Cube = CC().Cube;
    try { return Cube && Cube.moveInfo ? Cube.moveInfo(tok) : null; } catch (e) { return null; }
  }

  function isRotationToken(tok) {
    var Cube = CC().Cube;
    if (Cube && Cube.isRotation) return Cube.isRotation(tok);
    return /^[xyz]/.test(tok);
  }

  // <ol class="alg-chips"> with one chip per move. opts: { current:index, done:count|[indices]|true,
  // size:'sm'|'lg', label }. Moves before `current` count as done unless `done` is given.
  // The returned element has .update({ current, done }) for live coaching.
  function algChips(tokens, opts) {
    opts = opts || {};
    var list = toTokens(tokens);
    var ol = h('ol', {
      class: ['alg-chips', opts.size ? 'alg-chips--' + opts.size : null, opts.class],
      'aria-label': opts.label || 'Moves'
    });
    var chips = list.map(function (tok, i) {
      var info = moveInfoSafe(tok);
      var rot = info ? info.rotation : isRotationToken(tok);
      var li = h('li', {
        class: ['alg-chip', rot ? 'is-rotation' : null],
        title: info ? info.text : tok,
        dataset: { index: i, token: tok }
      }, tok, h('span', { class: 'sr-only' }, info ? ' — ' + info.text : ''));
      ol.appendChild(li);
      return li;
    });
    ol.tokens = list;
    ol.update = function (o) {
      o = o || {};
      var cur = typeof o.current === 'number' ? o.current : -1;
      var doneTest;
      if (o.done === true) doneTest = function () { return true; };
      else if (typeof o.done === 'number') doneTest = function (i) { return i < o.done; };
      else if (Array.isArray(o.done)) doneTest = function (i) { return o.done.indexOf(i) !== -1; };
      else doneTest = function (i) { return cur >= 0 && i < cur; };
      chips.forEach(function (li, i) {
        var isCur = i === cur;
        li.classList.toggle('is-current', isCur);
        li.classList.toggle('is-done', !isCur && doneTest(i));
        if (isCur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
      return ol;
    };
    ol.update(opts);
    return ol;
  }

  var FALLBACK_STAGES = [
    { id: 'daisy', name: 'The Daisy', short: 'Daisy', algorithm: null },
    { id: 'cross', name: 'White Cross', short: 'Cross', algorithm: null },
    { id: 'corners', name: 'White Corners', short: 'Corners', algorithm: 'rtrigger' },
    { id: 'middle', name: 'Middle Layer', short: 'Middle', algorithm: 'mid-right' },
    { id: 'ycross', name: 'Yellow Cross', short: 'Y cross', algorithm: 'ycross' },
    { id: 'yedges', name: 'Yellow Edges', short: 'Y edges', algorithm: 'sune' },
    { id: 'ycorners', name: 'Yellow Corners: Position', short: 'Y corners', algorithm: 'corner-cycle' },
    { id: 'yorient', name: 'Yellow Corners: Twist', short: 'Y twist', algorithm: 'twist' }
  ];

  function stages() {
    var S = CC().Solver;
    if (S && Array.isArray(S.STAGES) && S.STAGES.length) return S.STAGES;
    return FALLBACK_STAGES;
  }

  // Eight connected segments. doneIds (array) marks stages done; when omitted, every stage before
  // currentId is done. currentId 'solved' marks all done. opts: { caption:false } hides the caption.
  function stageTrack(currentId, doneIds, opts) {
    opts = opts || {};
    var list = stages();
    var idx = -1;
    list.forEach(function (s, i) { if (s.id === currentId) idx = i; });
    var allDone = currentId === 'solved';
    var done = {};
    if (Array.isArray(doneIds)) doneIds.forEach(function (id) { done[id] = true; });
    else list.forEach(function (s, i) { if (idx >= 0 && i < idx) done[s.id] = true; });
    if (allDone) list.forEach(function (s) { done[s.id] = true; });
    var doneCount = 0;
    var ol = h('ol', { class: 'stage-track__list' });
    list.forEach(function (s, i) {
      var st = s.id === currentId ? 'current' : done[s.id] ? 'done' : 'upcoming';
      if (done[s.id]) doneCount++;
      ol.appendChild(h('li', {
        class: ['stage-seg', 'is-' + st],
        title: (i + 1) + '. ' + s.name + (st === 'done' ? ' — done' : st === 'current' ? ' — now' : ''),
        'aria-current': st === 'current' ? 'step' : null,
        dataset: { stage: s.id }
      },
      h('span', { class: 'stage-seg__bar', 'aria-hidden': 'true' }),
      h('span', { class: 'stage-seg__label' },
        h('span', { class: 'stage-seg__num', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'stage-seg__name' }, s.short || s.name)),
      h('span', { class: 'sr-only' }, st === 'done' ? ' (done)' : st === 'current' ? ' (current stage)' : '')));
    });
    var caption = allDone ? 'All ' + list.length + ' stages done — solved!'
      : idx >= 0 ? 'Stage ' + (idx + 1) + ' of ' + list.length + ': ' + list[idx].name
        : doneCount + ' of ' + list.length + ' stages done';
    return h('div', { class: ['stage-track', opts.class], role: 'group', 'aria-label': 'Solve progress' },
      ol, opts.caption === false ? null : h('p', { class: 'stage-track__caption' }, caption));
  }

  function colourDot(letter, opts) {
    opts = opts || {};
    var Cube = CC().Cube;
    var L = String(letter || '').toUpperCase();
    var name = (Cube && Cube.COLOR_NAME && Cube.COLOR_NAME[L]) || L;
    return h('span', {
      class: ['colour-dot', opts.size ? 'colour-dot--' + opts.size : null],
      dataset: { c: L }, title: name, role: 'img', 'aria-label': name
    });
  }

  // True when a key event belongs to a text field (so global shortcuts must ignore it).
  var NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'];
  function isTyping(e) {
    if (e && e.isComposing) return true;
    var t = e && e.target !== undefined ? e.target : e;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    var tag = String(t.tagName).toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return NON_TEXT_INPUTS.indexOf(String(t.type || 'text').toLowerCase()) === -1;
    return false;
  }

  // Convenience for screens: ignore shortcuts while typing, while a modal is open, or with Cmd/Ctrl/Alt.
  function shortcutsBlocked(e) {
    return isTyping(e) || modalStack.length > 0 || !!(e && (e.metaKey || e.ctrlKey || e.altKey));
  }

  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  // 24×24 stroke icons. Each entry: path strings, or [tag, attrs].
  var ICONS = {
    home: ['M3 10.5 12 3l9 7.5', 'M5.5 9v11.5h4.5v-6h4v6h4.5V9'],
    learn: ['M2.5 5.5c3-1.6 6.3-1.6 9.5.6 3.2-2.2 6.5-2.2 9.5-.6v14c-3-1.6-6.3-1.6-9.5.6-3.2-2.2-6.5-2.2-9.5-.6z', 'M12 6.1v14'],
    practice: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], ['circle', { cx: 12, cy: 12, r: 1.2 }]],
    stats: ['M3.5 20.5h17', 'M6.5 17v-5', 'M11 17V6', 'M15.5 17v-8', 'M20 17v-3'],
    settings: ['M4 7h9', 'M17 7h3', 'M4 12h3', 'M11 12h9', 'M4 17h11', 'M19 17h1',
      ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 17, cy: 17, r: 2 }]],
    cube: ['M12 2.5 20.5 7v10L12 21.5 3.5 17V7z', 'M3.5 7 12 11.5 20.5 7', 'M12 11.5v10'],
    camera: ['M3 8.5A2 2 0 0 1 5 6.5h2.2l1.6-2.5h6.4l1.6 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', ['circle', { cx: 12, cy: 13, r: 3.8 }]],
    play: ['M7 4.5v15l12-7.5z'],
    pause: ['M8 5v14', 'M16 5v14'],
    watch: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', ['circle', { cx: 12, cy: 12, r: 3 }]],
    zap: ['M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z'],
    timer: [['circle', { cx: 12, cy: 13.5, r: 7.5 }], 'M12 9.5v4l2.5 2', 'M9.5 2.5h5', 'M19 6l1.5-1.5'],
    check: ['M4.5 12.5 9.5 17.5 19.5 6.5'],
    x: ['M6 6l12 12', 'M18 6 6 18'],
    arrowLeft: ['M19 12H5', 'M11 6l-6 6 6 6'],
    arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
    tip: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z'],
    alert: ['M12 3.5 2.5 20h19z', 'M12 10v4.5', 'M12 17.5v.01'],
    info: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 11v5.5', 'M12 7.5v.01'],
    refresh: ['M20 11.5a8 8 0 1 0-2.4 5.9', 'M20 4.5v7h-7'],
    trophy: ['M8 21h8', 'M12 17v4', 'M7 4h10v5a5 5 0 0 1-10 0z', 'M17 5.5h3V7a3 3 0 0 1-3 3', 'M7 5.5H4V7a3 3 0 0 0 3 3'],
    keyboard: ['M3 6.5h18v11H3z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M7.5 14h9'],
    hand: ['M8 13V5.5a1.5 1.5 0 0 1 3 0V11', 'M11 10V4a1.5 1.5 0 0 1 3 0v6', 'M14 10V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3 14.5a1.6 1.6 0 0 1 2.4-2L8 15']
  };

  function icon(name, size) {
    var spec = ICONS[name] || ICONS.info;
    var s = size || 20;
    var svg = h('svg', {
      class: 'icon icon-' + name, viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'
    });
    spec.forEach(function (d) { svg.appendChild(typeof d === 'string' ? h('path', { d: d }) : h(d[0], d[1])); });
    return svg;
  }

  var CALLOUT_ICON = { tip: 'tip', warn: 'alert', success: 'check', danger: 'alert', info: 'info' };

  // callout('tip'|'warn'|'success'|'danger'|'info', title|null, ...body) -> <div class="callout …">
  function callout(kind, title) {
    var body = Array.prototype.slice.call(arguments, 2);
    kind = CALLOUT_ICON[kind] ? kind : 'info';
    return h('div', { class: ['callout', 'callout-' + kind], role: 'note' },
      h('span', { class: 'callout__icon' }, icon(CALLOUT_ICON[kind], 20)),
      h('div', { class: 'callout__body' }, title ? h('p', { class: 'callout__title' }, title) : null, body));
  }

  // tile({ icon, title, desc, onClick, badge }) -> a big tappable entry-point button
  function tile(o) {
    o = o || {};
    return h('button', { type: 'button', class: ['tile', o.class], onClick: o.onClick, disabled: !!o.disabled },
      o.icon ? h('span', { class: 'tile__icon' }, icon(o.icon, 22)) : null,
      h('span', { class: 'tile__body' },
        h('span', { class: 'tile__title' }, o.title, o.badge ? [' ', h('span', { class: 'badge badge-accent' }, o.badge)] : null),
        o.desc ? h('span', { class: 'tile__desc' }, o.desc) : null),
      h('span', { class: 'tile__arrow' }, icon('arrowRight', 18)));
  }

  var UI = {
    h: h, empty: empty, fmtTime: fmtTime, algChips: algChips, stageTrack: stageTrack, colourDot: colourDot,
    isTyping: isTyping, shortcutsBlocked: shortcutsBlocked, reducedMotion: reducedMotion,
    icon: icon, ICONS: ICONS, stages: stages, FALLBACK_STAGES: FALLBACK_STAGES, callout: callout, tile: tile
  };

  // ================================================================ data
  var STAGE_IDS = FALLBACK_STAGES.map(function (s) { return s.id; });

  function fallbackData() {
    var skills = {};
    STAGE_IDS.forEach(function (id) {
      skills[id] = { mastery: 0, sessions: 0, soloClean: 0, lastLevel: 3, lastPracticed: null };
    });
    return {
      version: 1, createdAt: new Date().toISOString(),
      settings: {
        mirror: true, autoCapture: true, animSpeed: 1, anticipate: true, guidanceOverride: null,
        keyboard: 'simple', inspection: true, goalSeconds: 180, splitTaps: true
      },
      skills: skills, solves: [], drills: {}, algs: {}, practiceLog: {}, milestones: {}
    };
  }

  // Fill in any missing top-level pieces so screens never crash on a partial object.
  function ensureShape(d) {
    var base = fallbackData();
    if (!d || typeof d !== 'object') return base;
    Object.keys(base).forEach(function (k) { if (d[k] == null) d[k] = base[k]; });
    if (typeof d.settings !== 'object') d.settings = base.settings;
    Object.keys(base.settings).forEach(function (k) { if (!(k in d.settings)) d.settings[k] = base.settings[k]; });
    if (!Array.isArray(d.solves)) d.solves = [];
    return d;
  }

  var _data = null;
  var storeWarned = false;

  function loadData() {
    var S = CC().Store;
    if (S && typeof S.load === 'function') {
      try { return ensureShape(S.load()); } catch (e) { console.error('[CC] Store.load failed', e); }
    }
    if (S && typeof S.defaults === 'function') {
      try { return ensureShape(S.defaults()); } catch (e) { console.error('[CC] Store.defaults failed', e); }
    }
    if (!storeWarned) { storeWarned = true; console.warn('[CC] CC.Store is not available — progress is kept in memory only.'); }
    return fallbackData();
  }

  function getData() {
    if (!_data) _data = loadData();
    return _data;
  }

  var saveErrorShown = false;
  function save() {
    var S = CC().Store;
    if (!S || typeof S.save !== 'function') return false;
    try { S.save(getData()); return true; } catch (e) {
      console.error('[CC] save failed', e);
      if (!saveErrorShown) { saveErrorShown = true; toast('Couldn’t save your progress on this device.', { kind: 'error' }); }
      return false;
    }
  }

  // ================================================================ routing
  var screens = {};
  var current = { id: null, params: {} };
  var mounted = null;          // { id, def, el, cleanup }
  var renderedHash = null;
  var booted = false;
  var paramCache = {};         // routeKey -> params (keeps complex params, e.g. cube states, in memory)
  var paramCacheOrder = [];
  var NAV_MAP = {
    home: 'home', learn: 'learn', lesson: 'learn', watch: 'learn',
    drills: 'practice', solve: 'practice', scan: 'practice', stats: 'stats', settings: 'settings'
  };

  function isSimple(v) { return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'; }

  function simpleParams(params) {
    var out = {};
    Object.keys(params || {}).sort().forEach(function (k) {
      var v = params[k];
      if (isSimple(v) && String(v).length <= 200) out[k] = String(v);
    });
    return out;
  }

  function buildHash(id, params) {
    var sp = simpleParams(params);
    var q = Object.keys(sp).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(sp[k]); }).join('&');
    return '#/' + encodeURIComponent(id) + (q ? '?' + q : '');
  }

  function routeKey(id, params) {
    var sp = simpleParams(params);
    return id + '?' + Object.keys(sp).map(function (k) { return k + '=' + sp[k]; }).join('&');
  }

  // '#/lesson?stage=cross' -> { id:'lesson', params:{ stage:'cross' } }; non-route hashes -> id null
  function parseHash(hash) {
    hash = String(hash || '');
    var m = /^#?\/([^?]*)(?:\?(.*))?$/.exec(hash);
    if (!m) return { id: null, params: {} };
    var id;
    try { id = decodeURIComponent(m[1]).replace(/\/+$/, ''); } catch (e) { id = m[1]; }
    var params = {};
    (m[2] || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i === -1 ? pair : pair.slice(0, i), v = i === -1 ? '' : pair.slice(i + 1);
      try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { params[k] = v; }
    });
    return { id: id || 'home', params: params };
  }

  function cacheParams(id, params) {
    var key = routeKey(id, params);
    if (!(key in paramCache)) paramCacheOrder.push(key);
    paramCache[key] = params;
    while (paramCacheOrder.length > 40) delete paramCache[paramCacheOrder.shift()];
  }

  function registerScreen(id, def) {
    if (!id || !def || typeof def.mount !== 'function') throw new Error('registerScreen(id, { mount(el, params) }) needs a mount function');
    screens[id] = def;
    // A screen that registers late (e.g. after a slow script) replaces the "not found" card.
    if (booted && current.id === id && mounted && !mounted.def) render(id, current.params, { keepScroll: true });
    return def;
  }

  function historyDepth() {
    try { var st = root.history && root.history.state; return st && st.cc ? (st.depth || 0) : 0; } catch (e) { return 0; }
  }

  function go(id, params, opts) {
    id = String(id || 'home').replace(/^#?\/?/, '') || 'home';
    params = params || {};
    opts = opts || {};
    cacheParams(id, params);
    if (!hasDOM() || !booted) { current = { id: id, params: params }; return; }
    var hash = buildHash(id, params);
    var depth = historyDepth();
    try {
      if (opts.replace) root.history.replaceState({ cc: 1, depth: depth }, '', hash);
      else if (root.location.hash !== hash) root.history.pushState({ cc: 1, depth: depth + 1 }, '', hash);
    } catch (e) {
      if (root.location.hash !== hash) root.location.hash = hash; // sandboxed: fall back to plain hash links
    }
    render(id, params);
  }

  function back() {
    if (!hasDOM() || !booted) return;
    if (historyDepth() > 0) root.history.back();
    else go('home', {}, { replace: true });
  }

  function onLocationChange() {
    if (root.location.hash === renderedHash) return;
    var r = parseHash(root.location.hash);
    if (!r.id) return; // e.g. '#screen' from a skip link — not a route
    var cached = paramCache[routeKey(r.id, r.params)];
    var params = cached || r.params;
    try {
      var st = root.history.state;
      if (!st || !st.cc) root.history.replaceState({ cc: 1, depth: (mounted ? mounted.depth : 0) + 1 }, '', root.location.hash);
    } catch (e) { /* ignore */ }
    render(r.id, params);
  }

  function resolveTitle(def, params) {
    if (!def) return 'Not found';
    try { return typeof def.title === 'function' ? def.title(params || {}) : def.title; } catch (e) { return ''; }
  }

  function mainEl() {
    var m = document.getElementById('screen');
    if (!m) {
      m = h('main', { id: 'screen', class: 'screen-root container', tabindex: '-1' });
      document.body.appendChild(m);
    }
    return m;
  }

  function updateNav(key) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      var on = links[i].getAttribute('data-nav') === key;
      links[i].classList.toggle('is-active', on);
      if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
    }
  }

  function unmountCurrent() {
    if (!mounted) return;
    var m = mounted;
    mounted = null;
    try {
      if (typeof m.cleanup === 'function') m.cleanup();
      if (m.def && typeof m.def.unmount === 'function') m.def.unmount();
    } catch (e) { console.error('[CC] unmount of "' + m.id + '" failed', e); }
  }

  function render(id, params, opts) {
    opts = opts || {};
    params = params || {};
    var main = mainEl();
    closeAllModals();
    unmountCurrent();
    empty(main);
    var def = screens[id] || null;
    current = { id: id, params: params };
    renderedHash = root.location.hash;
    updateNav((def && def.nav) || NAV_MAP[id] || id);
    var title = resolveTitle(def, params);
    document.title = (!title || id === 'home') ? 'Cube Coach' : title + ' · Cube Coach';
    var el = h('div', { class: 'screen screen--' + id, dataset: { screen: id } });
    main.appendChild(el);
    if (!opts.keepScroll) { try { root.scrollTo(0, 0); } catch (e) { /* ignore */ } }
    if (opts.focus !== false && booted && main.focus) { try { main.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    var record = { id: id, def: def, el: el, cleanup: null, depth: historyDepth() };
    mounted = record;
    if (!def) { el.appendChild(notFoundCard(id)); return; }
    try {
      var ret = def.mount(el, params);
      if (typeof ret === 'function') record.cleanup = ret;
      else if (ret && typeof ret.then === 'function') {
        ret.then(function (fn) { if (typeof fn === 'function') { if (mounted === record) record.cleanup = fn; else fn(); } },
          function (err) { if (mounted === record) showScreenError(record, err, title); });
      }
    } catch (err) {
      showScreenError(record, err, title);
    }
    dispatch('cc:screen', { id: id, params: params });
  }

  function showScreenError(record, err, title) {
    console.error('[CC] screen "' + record.id + '" failed to open', err);
    empty(record.el);
    record.el.appendChild(errorCard(err, title || record.id, function () { render(record.id, current.params); }));
  }

  function errorCard(err, title, retry) {
    var msg = (err && (err.message || String(err))) || 'Unknown error';
    return h('section', { class: 'card error-card stack', role: 'alert' },
      h('div', { class: 'row row-nowrap' },
        h('span', { class: 'error-card__icon' }, icon('alert', 22)),
        h('h2', { class: 'h3 m-0' }, 'Sorry — this screen hit a problem')),
      h('p', { class: 'muted' }, 'Something went wrong while opening “' + title + '”. Your saved progress is safe.'),
      h('pre', { class: 'error-card__msg' }, msg),
      err && err.stack ? h('details', { class: 'error-card__details' },
        h('summary', null, 'Technical details'), h('pre', { class: 'error-card__stack' }, String(err.stack))) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', onClick: retry }, icon('refresh', 18), 'Try again'),
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { go('home'); } }, 'Go home')));
  }

  function notFoundCard(id) {
    return h('section', { class: 'card empty-state' },
      h('div', { class: 'empty-state__icon' }, icon('cube', 28)),
      h('h2', { class: 'h3' }, 'Nothing here yet'),
      h('p', { class: 'muted' }, 'The “' + id + '” screen isn’t available. It may still be loading, or the link is out of date.'),
      h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { go('home'); } }, 'Go home'));
  }

  function dispatch(name, detail) {
    try { root.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* old browser / node */ }
  }

  // ================================================================ modal
  var modalStack = [];
  var uid = 0;

  function paragraphs(text) {
    return String(text).split(/\n{2,}/).map(function (p) { return h('p', null, p); });
  }

  function focusables(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  // modal({ title, body: Node|string, actions:[{ label, primary?, danger?, onClick? }], dismissible?, wide? })
  //   -> Promise<label>  (null when dismissed with Escape, the × button or a backdrop click).
  // An action's onClick may return false to keep the modal open. The promise also has .close(label).
  function modal(opts) {
    opts = opts || {};
    if (!hasDOM()) { var p0 = Promise.resolve(null); p0.close = function () {}; return p0; }
    var resolveFn;
    var promise = new Promise(function (resolve) { resolveFn = resolve; });
    var dismissible = opts.dismissible !== false;
    var actions = opts.actions && opts.actions.length ? opts.actions : [{ label: 'OK', primary: true }];
    var titleId = 'cc-modal-title-' + (++uid);
    var prevFocus = document.activeElement;
    var entry = { closed: false, dismissible: dismissible };

    function close(label) {
      if (entry.closed) return;
      entry.closed = true;
      var i = modalStack.indexOf(entry);
      if (i !== -1) modalStack.splice(i, 1);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (!modalStack.length) document.documentElement.classList.remove('has-modal');
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      resolveFn(label === undefined ? null : label);
    }
    entry.close = close;

    var buttons = actions.map(function (a) {
      return h('button', {
        type: 'button',
        class: ['btn', a.danger ? 'btn-danger' : a.primary ? 'btn-primary' : 'btn-secondary'],
        dataset: { primary: a.primary ? '1' : null },
        onClick: function () {
          var r;
          try { r = a.onClick ? a.onClick() : undefined; } catch (e) { console.error(e); }
          if (r === false) return;
          close(a.label);
        }
      }, a.label);
    });
    var body = opts.body == null ? null : (typeof opts.body === 'string' ? paragraphs(opts.body) : opts.body);
    var dialog = h('div', {
      class: ['modal', opts.wide ? 'modal--wide' : null], role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': opts.title ? titleId : null, 'aria-label': opts.title ? null : 'Dialog'
    },
    dismissible ? h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm modal__close', 'aria-label': 'Close', onClick: function () { close(null); } }, icon('x', 18)) : null,
    opts.title ? h('h2', { class: 'modal__title', id: titleId }, opts.title) : null,
    body ? h('div', { class: 'modal__body' }, body) : null,
    h('div', { class: 'modal__actions' }, buttons));
    var downOnBackdrop = false;
    var backdrop = h('div', {
      class: 'modal-backdrop',
      onMousedown: function (e) { downOnBackdrop = e.target === backdrop; },
      onClick: function (e) { if (dismissible && downOnBackdrop && e.target === backdrop) close(null); downOnBackdrop = false; }
    }, dialog);
    entry.el = backdrop;
    entry.dialog = dialog;
    modalStack.push(entry);
    document.body.appendChild(backdrop);
    document.documentElement.classList.add('has-modal');
    // Focus the primary action; never default-focus a destructive one (Enter shouldn't delete things).
    var safe = actions.map(function (a, i) { return a.danger ? null : buttons[i]; }).filter(Boolean);
    var first = dialog.querySelector('[data-primary]:not(.btn-danger)') || safe[safe.length - 1] || buttons[0];
    try { (first || dialog).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    promise.close = close;
    return promise;
  }

  function closeAllModals() {
    modalStack.slice().forEach(function (m) { m.close(null); });
  }

  function onKeyDown(e) {
    if (!modalStack.length) return;
    var top = modalStack[modalStack.length - 1];
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      if (top.dismissible) top.close(null);
      return;
    }
    if (e.key === 'Tab') {
      var f = focusables(top.dialog);
      if (!f.length) { e.preventDefault(); return; }
      var firstEl = f[0], lastEl = f[f.length - 1];
      if (!top.dialog.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }
  }

  // ================================================================ toast & notices
  var TOAST_ICON = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };

  function toastRegion() {
    var r = document.getElementById('toasts');
    if (!r) {
      r = h('div', { id: 'toasts', class: 'toast-region', 'aria-live': 'polite' });
      document.body.appendChild(r);
    }
    return r;
  }

  // toast(text, kind | { kind:'info'|'success'|'warn'|'error', ms, action:{ label, onClick } }) -> { close() }
  function toast(text, opts) {
    if (typeof opts === 'string') opts = { kind: opts };
    opts = opts || {};
    if (!hasDOM()) { if (typeof console !== 'undefined') console.log('[toast]', text); return { close: function () {} }; }
    var kind = opts.kind || 'info';
    var timer = null;
    var el = h('div', { class: ['toast', 'toast--' + kind], role: kind === 'error' ? 'alert' : null },
      h('span', { class: 'toast__icon' }, icon(TOAST_ICON[kind] || 'info', 18)),
      h('div', { class: 'toast__text' }, text),
      opts.action ? h('button', {
        type: 'button', class: 'toast__action',
        onClick: function () { try { opts.action.onClick && opts.action.onClick(); } finally { close(); } }
      }, opts.action.label) : null,
      h('button', { type: 'button', class: 'toast__close', 'aria-label': 'Dismiss', onClick: function () { close(); } }, icon('x', 16)));
    function close() {
      clearTimeout(timer);
      if (el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reducedMotion() ? 0 : 180);
    }
    var region = toastRegion();
    region.appendChild(el);
    while (region.children.length > 3) region.removeChild(region.firstChild);
    var ms = opts.ms || (String(text).length > 70 ? 5500 : 3200);
    if (ms !== Infinity) timer = setTimeout(close, ms);
    return { close: close, el: el };
  }

  // A slim dismissible banner under the top bar. notice(text, { kind:'info'|'warn', id }) -> { close() }
  function notice(text, opts) {
    opts = opts || {};
    if (!hasDOM()) return { close: function () {} };
    var host = document.getElementById('notices');
    if (!host) { host = h('div', { id: 'notices', class: 'notices' }); document.body.insertBefore(host, mainEl()); }
    if (opts.id && host.querySelector('[data-notice="' + opts.id + '"]')) return { close: function () {} };
    var el = h('div', { class: ['notice', 'notice--' + (opts.kind || 'info')], role: 'status', dataset: { notice: opts.id || null } },
      h('div', { class: 'notice__inner container' },
        h('span', { class: 'notice__icon' }, icon(opts.kind === 'warn' ? 'alert' : 'info', 18)),
        h('span', { class: 'notice__text' }, text),
        h('button', { type: 'button', class: 'notice__close', 'aria-label': 'Dismiss', onClick: close }, icon('x', 16))));
    function close() { if (el.parentNode) el.parentNode.removeChild(el); }
    host.appendChild(el);
    return { close: close, el: el };
  }

  // ================================================================ theme
  // 'light' | 'dark' | anything else = follow the system. Stored (optionally) as data.settings.theme.
  function applyTheme(theme) {
    if (!hasDOM()) return;
    var r = document.documentElement;
    if (theme === 'light' || theme === 'dark') r.setAttribute('data-theme', theme);
    else r.removeAttribute('data-theme');
  }

  // ================================================================ active-practice tracker
  var PRACTICE_TICK_MS = 60000;
  var ACTIVE_WINDOW_MS = 120000;
  var lastInteraction = 0;
  var practiceTimer = null;

  function markActive(now) { lastInteraction = typeof now === 'number' ? now : Date.now(); }

  // Called every minute: one practice minute if the tab is visible and the learner did something
  // in the last two minutes. Returns true when a minute was logged.
  function practiceTick(now) {
    now = typeof now === 'number' ? now : Date.now();
    if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return false;
    if (!lastInteraction || now - lastInteraction > ACTIVE_WINDOW_MS) return false;
    var Coach = CC().Coach;
    if (!Coach || typeof Coach.logPractice !== 'function') return false;
    try {
      Coach.logPractice(getData(), 1);
      save();
      dispatch('cc:practice', { minutes: 1 });
      return true;
    } catch (e) {
      console.error('[CC] logPractice failed', e);
      return false;
    }
  }

  // ================================================================ boot
  var lastGlobalErrorToast = 0;
  function onGlobalError(ev) {
    var err = ev && (ev.error || ev.reason);
    var msg = err ? (err.message || String(err)) : (ev && ev.message) || '';
    if (/ResizeObserver loop/i.test(msg)) return;
    var now = Date.now();
    if (now - lastGlobalErrorToast < 8000) return;
    lastGlobalErrorToast = now;
    toast('Something went wrong: ' + (msg || 'unexpected error') + '. If the page misbehaves, reload it.', { kind: 'error' });
  }

  function onDocumentClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    var href = a.getAttribute('href');
    if (href === '#screen') { // skip link
      e.preventDefault();
      try { mainEl().focus(); } catch (err) { /* ignore */ }
      return;
    }
    if (href.indexOf('#/') !== 0) return;
    e.preventDefault();
    var r = parseHash(href);
    go(r.id, r.params);
  }

  function fillNavIcons() {
    var slots = document.querySelectorAll('[data-icon]');
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].firstChild) continue;
      slots[i].appendChild(icon(slots[i].getAttribute('data-icon'), Number(slots[i].getAttribute('data-size')) || 20));
    }
  }

  function check3D() {
    var threeMissing = typeof root.THREE === 'undefined';
    var View3D = CC().View3D;
    var noWebGL = false;
    if (!threeMissing && View3D && typeof View3D.supported === 'function') {
      try { noWebGL = !View3D.supported(); } catch (e) { noWebGL = true; }
    }
    document.documentElement.classList.toggle('no-3d', threeMissing || noWebGL);
    if (threeMissing) {
      notice('The 3D cube couldn’t load (are you offline?). Cube Coach will show a flat cube instead — everything else still works.', { kind: 'warn', id: 'three' });
    } else if (noWebGL) {
      notice('This browser can’t draw 3D graphics here, so Cube Coach will show a flat cube instead.', { kind: 'warn', id: 'webgl' });
    }
  }

  function boot() {
    if (booted || !hasDOM()) return;
    booted = true;
    var data = getData();
    applyTheme(data && data.settings && data.settings.theme);
    fillNavIcons();

    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('popstate', onLocationChange);
    root.addEventListener('hashchange', onLocationChange);
    root.addEventListener('error', onGlobalError);
    root.addEventListener('unhandledrejection', onGlobalError);
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function (t) {
      document.addEventListener(t, function () { markActive(); }, { passive: true, capture: true });
    });
    practiceTimer = setInterval(function () { practiceTick(); }, PRACTICE_TICK_MS);

    check3D();

    var r = parseHash(root.location.hash);
    var id = r.id || 'home';
    var start = buildHash(id, r.params);
    try { root.history.replaceState({ cc: 1, depth: historyDepth() }, '', start); } catch (e) { /* ignore */ }
    var cached = paramCache[routeKey(id, r.params)];
    render(id, cached || r.params, { focus: false });
    document.documentElement.classList.add('is-booted');
    dispatch('cc:boot', {});
  }

  // ================================================================ export
  var App = {
    registerScreen: registerScreen,
    go: go,
    back: back,
    get current() { return { id: current.id, params: current.params }; },
    get data() { return getData(); },
    set data(v) { _data = ensureShape(v); },
    save: save,
    toast: toast,
    modal: modal,
    notice: notice,
    applyTheme: applyTheme,
    markActive: markActive,
    boot: boot,
    screens: function () { return Object.keys(screens); },
    // exposed for tests / debugging
    _parseHash: parseHash,
    _buildHash: buildHash,
    _practiceTick: practiceTick,
    _fallbackData: fallbackData,
    _stopPracticeTimer: function () { if (practiceTimer) clearInterval(practiceTimer); practiceTimer = null; }
  };

  root.CC = root.CC || {};
  root.CC.App = App;
  root.CC.UI = UI;
  if (typeof module !== 'undefined' && module.exports) module.exports = { App: App, UI: UI };
})(typeof window !== 'undefined' ? window : globalThis);
