/* Cube Coach — cube pictures as SVG (CC.TopView).
 *
 *   CC.TopView.render(container, state, { highlight, selectable, selected, marks, onSelect, size, caption })
 *       The standard last-layer diagram: the top face (3×3) seen from above with the top row of each
 *       side face folded out around it, FRONT AT THE BOTTOM. Top edges can be tapped when
 *       `selectable` lists their positions ('UF', 'UR', 'UB', 'UL').
 *       -> { el, update(state?, opts?), destroy() }
 *   CC.TopView.renderIso(container, state, { side:'right'|'left', highlight, dim, size, label, caption })
 *       A small flat 3D picture of the cube as held: the top, the front and one side (the right side
 *       by default, the left side with side:'left'). Cheap enough to show several at once (one
 *       WebGL view per screen is the rule, so picture choices use these).
 *       -> { el, update(state?, opts?), destroy() }
 *
 * Pure geometry (node-testable, tests/topview.test.js):
 *   gridCell(i) -> { row, col } on a 5×5 grid (top face rows/cols 1–3, side strips on the border) | null
 *   cells() -> the 21 stickers in the diagram   layout() -> rectangles in viewBox units
 *   POSITIONS / positions() -> the four top edges   positionOf(i)   hitRect(pos)   describe(state, pos)
 *   isoLayout(side) -> sticker polygons for renderIso
 *
 * The grid is derived from CC.Cube's geometry, not typed in: looking straight down on the cube, a
 * sticker on the top layer sits at (x, z) of its cubie, pushed one step outwards along its normal
 * for side stickers. x runs left→right and z back→front, so the back is at the top and the front
 * at the bottom. Nothing here touches the DOM at load time; CC.Cube is looked up when needed.
 */
(function (root) {
  'use strict';

  function Cube() {
    var c = root.CC && root.CC.Cube;
    if (!c && typeof require === 'function') { try { require('./cube.js'); } catch (e) { /* browser */ } c = root.CC && root.CC.Cube; }
    if (!c) throw new Error('CC.TopView needs CC.Cube (js/cube.js) loaded first');
    return c;
  }

  // ------------------------------------------------------------------ diagram geometry
  var S = 10;      // top-face sticker
  var GAP = 1;     // between top-face stickers
  var T = 4;       // thickness of a side strip
  var G = 1.3;     // gap between the top face and a strip
  var P = 1.7;     // margin of the plastic body around everything
  var SIZE = 2 * P + 2 * T + 2 * G + 3 * S + 2 * GAP;   // the diagram is square

  function start(k) {           // k = grid row or column, 0..4
    if (k === 0) return P;
    if (k === 4) return P + T + G + 3 * S + 2 * GAP + G;
    return P + T + G + (k - 1) * (S + GAP);
  }
  function extent(k) { return k === 0 || k === 4 ? T : S; }

  var GRID = null;
  function grid() {
    if (GRID) return GRID;
    var C = Cube(), g = [];
    C.STICKERS.forEach(function (s) {
      var c = s.cubie, n = s.normal;
      if (c[1] !== 1 || n[1] < 0) { g[s.index] = null; return; }        // not on the top layer
      g[s.index] = { row: c[2] + n[2] + 2, col: c[0] + n[0] + 2 };
    });
    GRID = g;
    return g;
  }
  function gridCell(i) { var c = grid()[i]; return c ? { row: c.row, col: c.col } : null; }

  function cells() {
    var C = Cube(), out = [];
    grid().forEach(function (c, i) {
      if (!c) return;
      out.push({ index: i, face: C.STICKERS[i].face, row: c.row, col: c.col, kind: C.STICKERS[i].face === 'U' ? 'top' : 'side' });
    });
    return out;
  }

  var POS_INFO = {
    UF: { label: 'Front', words: 'front' }, UR: { label: 'Right', words: 'right' },
    UB: { label: 'Back', words: 'back' }, UL: { label: 'Left', words: 'left' }
  };
  var POS_ORDER = ['UF', 'UR', 'UB', 'UL'];
  var POSITIONS = null;
  function positions() {
    if (POSITIONS) return POSITIONS;
    var C = Cube(), out = {};
    C.EDGES.forEach(function (e) {
      if (!POS_INFO[e.name]) return;
      out[e.name] = { pos: e.name, stickers: e.stickers.slice(), top: e.stickers[0], side: e.stickers[1],
        label: POS_INFO[e.name].label, words: POS_INFO[e.name].words };
    });
    POSITIONS = out;
    return out;
  }
  function positionOf(i) {
    var ps = positions(), hit = null;
    POS_ORDER.forEach(function (p) { if (ps[p].stickers.indexOf(i) !== -1) hit = p; });
    return hit;
  }

  function cellRect(i) {
    var c = grid()[i];
    if (!c) return null;
    return { x: start(c.col), y: start(c.row), w: extent(c.col), h: extent(c.row) };
  }
  function union(a, b, pad) {
    var x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad;
    var x1 = Math.max(a.x + a.w, b.x + b.w) + pad, y1 = Math.max(a.y + a.h, b.y + b.h) + pad;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // The tappable area of a top edge: both of its stickers and the gap between them.
  function hitRect(pos) {
    var p = positions()[pos];
    if (!p) return null;
    return union(cellRect(p.top), cellRect(p.side), GAP / 2);
  }
  function layout() {
    return {
      width: SIZE, height: SIZE,
      cells: cells().map(function (c) { var r = cellRect(c.index); c.x = r.x; c.y = r.y; c.w = r.w; c.h = r.h; return c; }),
      positions: POS_ORDER.map(function (p) { var r = hitRect(p); r.pos = p; return r; })
    };
  }

  function colourName(c) { var C = Cube(); return C.COLOR_NAME[c] || 'unknown'; }
  // "Front edge: yellow on top, blue on the side"
  function describe(state, pos) {
    var p = positions()[pos];
    if (!p || !state) return '';
    return p.label + ' edge: ' + colourName(state[p.top]) + ' on top, ' + colourName(state[p.side]) + ' on the side';
  }

  // ------------------------------------------------------------------ iso geometry (pure)
  // CC.Cube "points": sticker centres at 0/±2, face planes at ±3. Seen from the front-top-right
  // (the default 3D view) the top, front and right faces show; from the front-top-left the left
  // face shows instead of the right one.
  var COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;
  var ISO_VIEW = { right: [1, 1, 1], left: [-1, 1, 1] };
  function isoProject(side, p) {
    if (side === 'left') return [(p[0] + p[2]) * COS30, (p[2] - p[0]) * SIN30 - p[1]];
    return [(p[0] - p[2]) * COS30, (p[0] + p[2]) * SIN30 - p[1]];
  }
  function axesOf(n) {
    var out = [];
    for (var k = 0; k < 3; k++) { if (n[k]) continue; var a = [0, 0, 0]; a[k] = 1; out.push(a); }
    return out;
  }
  function quad(centre, n, half) {
    var ax = axesOf(n), a = ax[0], b = ax[1], out = [];
    [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(function (sg) {
      out.push([centre[0] + half * (sg[0] * a[0] + sg[1] * b[0]), centre[1] + half * (sg[0] * a[1] + sg[1] * b[1]), centre[2] + half * (sg[0] * a[2] + sg[1] * b[2])]);
    });
    return out;
  }
  var ISO = {};
  function isoLayout(side) {
    side = side === 'left' ? 'left' : 'right';
    if (ISO[side]) return ISO[side];
    var C = Cube(), v = ISO_VIEW[side], faces = [], stickers = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function proj(pts) {
      return pts.map(function (p) {
        var q = isoProject(side, p);
        if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
        if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
        return [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000];
      });
    }
    C.FACES.forEach(function (f) {
      var n = C.NORMAL[f];
      if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] <= 0) return;
      faces.push({ face: f, points: proj(quad([3 * n[0], 3 * n[1], 3 * n[2]], n, 3.04)) });
    });
    var shown = {};
    faces.forEach(function (f) { shown[f.face] = true; });
    C.STICKERS.forEach(function (s) {
      if (!shown[s.face]) return;
      var pts = proj(quad(s.point, s.normal, 0.86));
      var c = isoProject(side, s.point);
      stickers.push({ index: s.index, face: s.face, points: pts, cx: c[0], cy: c[1] });
    });
    var pad = 0.5;
    ISO[side] = { side: side, faces: faces, stickers: stickers,
      viewBox: [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad] };
    return ISO[side];
  }

  // ------------------------------------------------------------------ DOM helpers
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) el.setAttribute(k, String(attrs[k])); });
    return el;
  }
  function r2(x) { return Math.round(x * 100) / 100; }
  function fillOf(c) { var hex = Cube().COLOR_HEX[c]; return hex || '#7a7e88'; }
  function sizePx(size, fallback) {
    if (typeof size === 'number' && size > 0) return size;
    return { xs: 96, sm: 132, md: 200, lg: 280 }[size] || fallback;
  }
  var STYLE_ID = 'cc-style-topview';
  var CSS = [
    '.cc-tv { display: inline-flex; flex-direction: column; align-items: center; gap: 6px; max-width: 100%; vertical-align: top; }',
    '.cc-tv svg, .cc-iso svg { display: block; max-width: 100%; height: auto; overflow: visible; }',
    '.cc-tv--fill, .cc-iso--fill { display: flex; width: 100%; }',
    '.cc-tv--fill svg, .cc-iso--fill svg { width: 100%; }',
    '.cc-tv__body, .cc-iso__face { fill: var(--cube-plastic, #14181d); }',
    '.cc-tv__body { stroke: var(--border-strong, #c3ccd4); stroke-width: 0.35; }',
    '.cc-tv__st, .cc-iso__st { stroke: var(--sticker-edge, rgba(0,0,0,.22)); stroke-width: 0.3; transition: opacity .15s ease; }',
    '.cc-iso__st { stroke-width: 0.06; stroke-linejoin: round; }',
    '.cc-tv.is-dim .cc-tv__st:not(.is-hl), .cc-iso.is-dim .cc-iso__st:not(.is-hl) { opacity: .5; }',
    '.cc-tv__hl { fill: none; stroke: var(--cc-hl, #ff2bd6); stroke-width: 1.1; }',   /* the same pink as the 3D view\'s highlight */
    '.cc-iso__hl { fill: none; stroke: var(--cc-hl, #ff2bd6); stroke-width: 0.24; stroke-linejoin: round; }',
    '.cc-tv__pos { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }',
    '.cc-tv__hit { fill: transparent; stroke: none; }',
    '.cc-tv__ring { fill: none; stroke: transparent; stroke-width: 1.1; }',
    '.cc-tv__pos:hover .cc-tv__ring { stroke: var(--accent-soft-2, #c4e6e1); }',
    '.cc-tv__pos:focus-visible .cc-tv__ring { stroke: var(--accent, #0b7a72); stroke-dasharray: 2 1.2; }',
    '.cc-tv__pos.is-selected .cc-tv__ring { stroke: var(--accent, #0b7a72); stroke-width: 1.2; stroke-dasharray: none; }',
    '.cc-tv__mark .cc-tv__ring { stroke-width: 1.1; }',
    '.cc-tv__mark.is-right .cc-tv__ring { stroke: var(--success, #17803f); }',
    '.cc-tv__mark.is-wrong .cc-tv__ring { stroke: var(--danger, #c0262d); }',
    '.cc-tv__mark.is-missed .cc-tv__ring { stroke: var(--warn, #a35f00); stroke-dasharray: 2 1.2; }',
    '.cc-tv__badge circle { stroke: #fff; stroke-width: 0.5; }',
    '.cc-tv__badge path { fill: none; stroke: #fff; stroke-width: 0.9; stroke-linecap: round; stroke-linejoin: round; }',
    '.is-selected .cc-tv__badge circle { fill: var(--accent, #0b7a72); }',
    '.is-right .cc-tv__badge circle { fill: var(--success, #17803f); }',
    '.is-wrong .cc-tv__badge circle { fill: var(--danger, #c0262d); }',
    '.is-missed .cc-tv__badge circle { fill: var(--warn, #a35f00); }',
    '.cc-tv__cap, .cc-iso__cap { margin: 0; font-size: var(--text-xs, .75rem); font-weight: 600; color: var(--text-3, #63707d); text-align: center; line-height: 1.3; }',
    '.cc-iso { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; max-width: 100%; vertical-align: top; }',
    '@media (prefers-reduced-motion: reduce) { .cc-tv__st, .cc-iso__st { transition: none; } }'
  ].join('\n');
  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function toState(s) {
    var C = Cube();
    if (!s) return C.solved();
    var st = typeof s === 'string' ? C.fromString(s) : Array.prototype.slice.call(s);
    if (st.length !== 54) throw new Error('A cube state needs 54 stickers');
    return st;
  }
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var o = arguments[i];
      if (o) Object.keys(o).forEach(function (k) { t[k] = o[k]; });
    }
    return t;
  }
  // Tick, cross and "!" drawn as strokes (no fonts or emoji), centred on (cx, cy), radius r.
  function badgePath(kind, cx, cy, r) {
    var k = r * 0.48;
    if (kind === 'wrong') return 'M' + r2(cx - k) + ' ' + r2(cy - k) + 'L' + r2(cx + k) + ' ' + r2(cy + k) + 'M' + r2(cx + k) + ' ' + r2(cy - k) + 'L' + r2(cx - k) + ' ' + r2(cy + k);
    if (kind === 'missed') return 'M' + r2(cx) + ' ' + r2(cy - k * 1.2) + 'L' + r2(cx) + ' ' + r2(cy + k * 0.3) + 'M' + r2(cx) + ' ' + r2(cy + k * 1.05) + 'L' + r2(cx) + ' ' + r2(cy + k * 1.1);
    return 'M' + r2(cx - k) + ' ' + r2(cy + 0.05 * r) + 'L' + r2(cx - k * 0.25) + ' ' + r2(cy + k * 0.8) + 'L' + r2(cx + k * 1.05) + ' ' + r2(cy - k * 0.75);
  }
  // Where a position's badge sits: in the middle of the edge's top sticker, so it is clearly that
  // edge's mark and the sticker's colour still shows all round it.
  function badgeAt(pos) {
    var p = positions()[pos], r = cellRect(p.top);
    return [r.x + r.w / 2, r.y + r.h / 2];
  }

  // ------------------------------------------------------------------ the diagram
  function render(container, state, opts) {
    if (!container) throw new Error('TopView.render needs a container element');
    injectStyle();
    var o = assign({ highlight: null, selectable: null, selected: null, marks: null, onSelect: null, size: 'md', caption: true, label: null }, opts);
    var st = toState(state);
    var wrap = document.createElement('div');
    var destroyed = false;
    container.appendChild(wrap);

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-pos]') : null;
      if (!t || !wrap.contains(t) || typeof o.onSelect !== 'function') return;
      o.onSelect(t.getAttribute('data-pos'));
    }
    function onKey(e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var t = e.target && e.target.closest ? e.target.closest('[data-pos]') : null;
      if (!t || !wrap.contains(t) || typeof o.onSelect !== 'function') return;
      e.preventDefault();
      o.onSelect(t.getAttribute('data-pos'));
    }
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('keydown', onKey);

    function paint() {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      var fill = o.size === 'fill';
      wrap.className = 'cc-tv' + (fill ? ' cc-tv--fill' : '');
      var hl = {}, anyHl = false;
      (o.highlight || []).forEach(function (i) { hl[i] = true; anyHl = true; });
      if (anyHl) wrap.classList.add('is-dim');
      var sel = {}; (o.selected || []).forEach(function (p) { sel[p] = true; });
      var marks = o.marks || {};
      var canSelect = typeof o.onSelect === 'function' && Array.isArray(o.selectable) && o.selectable.length > 0;
      var px = sizePx(o.size, 200);
      var el = svg('svg', {
        viewBox: '0 0 ' + r2(SIZE) + ' ' + r2(SIZE), width: fill ? null : px, height: fill ? null : px,
        role: canSelect ? 'group' : 'img', focusable: 'false',
        'aria-label': o.label || ('Top layer seen from above, front at the bottom. ' + POS_ORDER.map(function (p) { return describe(st, p); }).join('. ') + '.')
      });
      el.appendChild(svg('rect', { class: 'cc-tv__body', x: 0, y: 0, width: r2(SIZE), height: r2(SIZE), rx: 3.2 }));
      var g = svg('g', { class: 'cc-tv__stickers', 'aria-hidden': 'true' });
      cells().forEach(function (c) {
        var r = cellRect(c.index);
        g.appendChild(svg('rect', {
          class: 'cc-tv__st' + (hl[c.index] ? ' is-hl' : ''), x: r2(r.x), y: r2(r.y), width: r2(r.w), height: r2(r.h),
          rx: c.kind === 'top' ? 1.4 : 0.9, fill: fillOf(st[c.index]), 'data-i': c.index
        }));
      });
      el.appendChild(g);
      if (anyHl) {
        var hg = svg('g', { 'aria-hidden': 'true' });
        Object.keys(hl).forEach(function (k) {
          var r = cellRect(+k);
          if (!r) return;
          hg.appendChild(svg('rect', { class: 'cc-tv__hl', x: r2(r.x - 0.75), y: r2(r.y - 0.75), width: r2(r.w + 1.5), height: r2(r.h + 1.5), rx: 1.8 }));
        });
        el.appendChild(hg);
      }
      POS_ORDER.forEach(function (p) {
        var selectable = canSelect && o.selectable.indexOf(p) !== -1;
        var mark = marks[p] || null;
        if (!selectable && !mark && !sel[p]) return;
        var r = hitRect(p);
        var attrs = { class: 'cc-tv__pos' + (sel[p] ? ' is-selected' : '') + (mark ? ' cc-tv__mark is-' + mark : ''), 'data-pos': selectable ? p : null };
        if (selectable) {
          attrs.tabindex = 0;
          attrs.role = 'button';
          attrs['aria-label'] = describe(st, p) + (mark ? ' (' + ({ right: 'right', wrong: 'not a middle edge', missed: 'you missed this one' }[mark] || mark) + ')' : '');
          if (Array.isArray(o.selected)) attrs['aria-pressed'] = sel[p] ? 'true' : 'false';
        } else attrs['aria-hidden'] = 'true';
        var pg = svg('g', attrs);
        pg.appendChild(svg('rect', { class: 'cc-tv__hit', x: r2(r.x - 0.6), y: r2(r.y - 0.6), width: r2(r.w + 1.2), height: r2(r.h + 1.2), rx: 2 }));
        pg.appendChild(svg('rect', { class: 'cc-tv__ring', x: r2(r.x), y: r2(r.y), width: r2(r.w), height: r2(r.h), rx: 1.9 }));
        var kind = mark || (sel[p] ? 'selected' : null);
        if (kind) {
          var b = badgeAt(p), bg = svg('g', { class: 'cc-tv__badge' });
          bg.appendChild(svg('circle', { cx: r2(b[0]), cy: r2(b[1]), r: 2.3 }));
          bg.appendChild(svg('path', { d: badgePath(kind === 'selected' ? 'right' : kind, b[0], b[1], 2.3) }));
          pg.appendChild(bg);
        }
        el.appendChild(pg);
      });
      wrap.appendChild(el);
      if (o.caption) {
        var cap = document.createElement('p');
        cap.className = 'cc-tv__cap';
        cap.textContent = typeof o.caption === 'string' ? o.caption : 'Seen from above · front (facing you) at the bottom';
        wrap.appendChild(cap);
      }
    }
    paint();
    return {
      el: wrap,
      update: function (state2, opts2) {
        if (destroyed) return;
        if (state2) st = toState(state2);
        if (opts2) assign(o, opts2);
        paint();
      },
      focus: function (pos) {
        var t = wrap.querySelector('[data-pos="' + pos + '"]');
        if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        wrap.removeEventListener('click', onClick);
        wrap.removeEventListener('keydown', onKey);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  // ------------------------------------------------------------------ the iso picture
  function renderIso(container, state, opts) {
    if (!container) throw new Error('TopView.renderIso needs a container element');
    injectStyle();
    var o = assign({ side: 'right', highlight: null, dim: true, size: 'sm', label: null, caption: null }, opts);
    var st = toState(state);
    var wrap = document.createElement('div');
    var destroyed = false;
    container.appendChild(wrap);
    function paint() {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      var L = isoLayout(o.side), vb = L.viewBox, fill = o.size === 'fill';
      wrap.className = 'cc-iso' + (fill ? ' cc-iso--fill' : '');
      var hl = {}, anyHl = false;
      (o.highlight || []).forEach(function (i) { hl[i] = true; anyHl = true; });
      if (anyHl && o.dim !== false) wrap.classList.add('is-dim');
      var w = sizePx(o.size, 132), hgt = w * vb[3] / vb[2];
      var el = svg('svg', {
        viewBox: vb.map(r2).join(' '), width: fill ? null : r2(w), height: fill ? null : r2(hgt), role: 'img', focusable: 'false',
        'aria-label': o.label || ('The cube seen from the front and ' + (L.side === 'left' ? 'left' : 'right') + ', yellow on top')
      });
      L.faces.forEach(function (f) {
        el.appendChild(svg('polygon', { class: 'cc-iso__face', points: f.points.map(function (p) { return p.join(','); }).join(' ') }));
      });
      L.stickers.forEach(function (s) {
        el.appendChild(svg('polygon', { class: 'cc-iso__st' + (hl[s.index] ? ' is-hl' : ''), fill: fillOf(st[s.index]),
          points: s.points.map(function (p) { return p.join(','); }).join(' '), 'data-i': s.index }));
      });
      if (anyHl) {
        L.stickers.forEach(function (s) {
          if (!hl[s.index]) return;
          el.appendChild(svg('polygon', { class: 'cc-iso__hl', points: s.points.map(function (p) { return p.join(','); }).join(' ') }));
        });
      }
      wrap.appendChild(el);
      if (o.caption) {
        var cap = document.createElement('p');
        cap.className = 'cc-iso__cap';
        cap.textContent = o.caption;
        wrap.appendChild(cap);
      }
    }
    paint();
    return {
      el: wrap,
      update: function (state2, opts2) {
        if (destroyed) return;
        if (state2) st = toState(state2);
        if (opts2) assign(o, opts2);
        paint();
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  var TopView = {
    render: render,
    renderIso: renderIso,
    // pure geometry
    gridCell: gridCell, cells: cells, layout: layout, positions: positions, positionOf: positionOf,
    hitRect: hitRect, describe: describe, isoLayout: isoLayout, isoProject: isoProject,
    POSITIONS: POS_ORDER.slice(), SIZE: SIZE
  };

  root.CC = root.CC || {};
  root.CC.TopView = TopView;
  if (typeof module !== 'undefined' && module.exports) module.exports = TopView;
})(typeof window !== 'undefined' ? window : globalThis);
