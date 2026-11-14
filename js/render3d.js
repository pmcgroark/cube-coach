/* Cube Coach — rendering and input: CC.View3D, CC.Net2D, CC.MovePad, CC.Keys.
 *
 * View3D draws the cube with three.js r128 (global THREE). Every sticker mesh is bound for life to
 * the facelet index of its HOME position. A move is animated by gathering the turning cubies into a
 * pivot group and tweening it; when the tween ends every cubie snaps back home and all stickers are
 * recoloured from CC.Cube.applyMove(state, token). So the index mapping never changes and the
 * picture always matches CC.Cube exactly.
 *
 * Coordinates: CC.Cube's frame (x right, y up, z toward the viewer). CC.Cube "points" (2*cubie +
 * normal: sticker centres at 0/±2, face planes at ±3) are used by the pure helpers; the 3D scene
 * uses half that (cubie centres at -1/0/1, face planes at ±1.5).
 *
 * Nothing here touches the DOM or THREE at load time. Pure helpers live on CC.View3D._internal and
 * are unit-tested in node (tests/render3d.test.js).
 */
(function (root) {
  'use strict';

  function Cube() {
    var c = root.CC && root.CC.Cube;
    if (!c) throw new Error('CC.Cube (js/cube.js) must be loaded before render3d.js is used');
    return c;
  }

  // ------------------------------------------------------------------ small vector helpers
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function roundVec(a) { return [Math.round(a[0]) || 0, Math.round(a[1]) || 0, Math.round(a[2]) || 0]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function report(err) { if (root.console && root.console.error) root.console.error('[CC render3d]', err); }

  var DEG = Math.PI / 180;
  var BASE_MS = 280;                                  // one quarter turn at speed 1
  var DEFAULT_VIEW = { az: 34 * DEG, el: 27 * DEG }; // front-top-right: U, F and R visible
  var EL_LIMIT = 82 * DEG;                            // orbit clamp, so the camera never flips
  var FIT_RADIUS = 2.75;                              // scene units the camera keeps in view
  var ACCENT = '#ff2bd6';
  var OUTLINE = '#111216';
  var SINGLE_LAYER = ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'E', 'S'];

  function viewDir(az, el) { return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]; }

  function toState(s) {
    var st = typeof s === 'string' ? Cube().fromString(s) : Array.prototype.slice.call(s || []);
    if (st.length !== 54) throw new Error('A cube state needs 54 stickers');
    return st;
  }

  // ================================================================== pure geometry helpers

  // The two in-plane axes of a face, both signs: the four ways a sticker can be dragged.
  function inPlaneAxes(normal) {
    var out = [];
    for (var k = 0; k < 3; k++) {
      if (Math.round(normal[k])) continue;
      var a = [0, 0, 0]; a[k] = 1; out.push(a);
      var b = [0, 0, 0]; b[k] = -1; out.push(b);
    }
    return out;
  }

  // Which single-layer move carries a sticker (on the face with outward `normal`, belonging to the
  // cubie at `cubie`) along the in-plane unit axis `dragAxis`?
  // The rotation that moves a point on the face along d is counter-clockwise about a = normal × d.
  // A clockwise move is -90° about its MOVE_DEFS axis, so: axis == a -> prime, axis == -a -> plain.
  function dragToToken(normal, dragAxis, cubie) {
    var C = Cube();
    var n = roundVec(normal), d = roundVec(dragAxis), c = roundVec(cubie);
    var a = cross(n, d);
    if (!a[0] && !a[1] && !a[2]) return null;
    for (var i = 0; i < SINGLE_LAYER.length; i++) {
      var base = SINGLE_LAYER[i], def = C.MOVE_DEFS[base];
      var along = dot(def[0], a);
      if (along !== 1 && along !== -1) continue;
      if (def[1].indexOf(dot(c, def[0])) === -1) continue;
      return along > 0 ? base + "'" : base;
    }
    return null;
  }

  // How to animate a token: rotate the cubies whose home position · axis is in `layers` by `angle`
  // (right-hand rule about `axis`). Clockwise = -90°, prime = +90°, double = -180°.
  function turnInfo(token) {
    var C = Cube();
    var tok = C.normalizeToken(token);
    var base = C.baseOf(tok), amount = C.amountOf(tok), def = C.MOVE_DEFS[base];
    var angle = amount === 1 ? -Math.PI / 2 : amount === 2 ? -Math.PI : Math.PI / 2;
    return { token: tok, base: base, amount: amount, axis: def[0].slice(), layers: def[1].slice(), angle: angle };
  }

  // ------------------------------------------------------------------ arrows
  // All arrow geometry is in CC.Cube point units (face planes at ±3). Directions come from PERM:
  // where the stickers actually go, never hand-coded signs.
  var LINE_HALF = 2.6, ARC_R = 2.0, RING_R = 4.9, FLAT_RING_R = 4.75;
  var ARC_SPAN = 135 * DEG, RING_SPAN = 105 * DEG;

  // +1 if the quarter turn `perm` is counter-clockwise about the unit axis e (right-hand rule).
  function senseOf(perm, e) {
    var P = Cube().STICKERS, s = 0;
    for (var i = 0; i < 54; i++) if (perm[i] !== i) s += dot(cross(P[i].point, P[perm[i]].point), e);
    return s > 0 ? 1 : -1;
  }

  // Which way along `lineAxis` do these stickers travel under `perm`?
  function travelSign(perm, stickers, lineAxis) {
    var P = Cube().STICKERS, s = 0;
    stickers.forEach(function (i) { s += dot(sub(P[perm[i]].point, P[i].point), lineAxis); });
    return s > 0 ? 1 : -1;
  }

  function lineArrow(face, stickers, centre, lineAxis, normal, perm) {
    var P = Cube().STICKERS;
    var dir = scale(lineAxis, travelSign(perm, stickers, lineAxis)).map(function (v) { return v || 0; });
    var ordered = stickers.slice().sort(function (a, b) { return dot(P[a].point, dir) - dot(P[b].point, dir); });
    return {
      kind: 'line', faces: [face], stickers: ordered, dir: dir,
      points: [add(centre, scale(dir, -LINE_HALF)), add(centre, scale(dir, LINE_HALF))],
      normals: [normal.slice(), normal.slice()]
    };
  }

  // Curved arrow on the front face, over the top, in the turning sense.
  function arcArrow(sense) {
    var from = sense > 0 ? 90 * DEG - ARC_SPAN : 90 * DEG + ARC_SPAN;
    var to = sense > 0 ? 90 * DEG + ARC_SPAN : 90 * DEG - ARC_SPAN;
    var pts = [], nrm = [], N = 48;
    for (var i = 0; i <= N; i++) {
      var f = from + (to - from) * i / N;
      pts.push([ARC_R * Math.cos(f), ARC_R * Math.sin(f), 3]);
      nrm.push([0, 0, 1]);
    }
    return { kind: 'arc', faces: ['F'], stickers: [18, 19, 20, 23, 26, 25, 24, 21], centre: [0, 0, 3], points: pts, normals: nrm };
  }

  // The S slice has no front stickers: arrow runs along the top middle row and bends down the
  // right face's middle column (both visible from the default view).
  function bendArrow(perm) {
    var d = travelSign(perm, [3, 4, 5], [1, 0, 0]);
    var pts = [[-LINE_HALF, 3, 0], [3, 3, 0]], nrm = [[0, 1, 0], [0, 1, 0]];
    for (var k = 1; k < 6; k++) { var t = k / 6 * 90 * DEG; pts.push([3, 3, 0]); nrm.push([Math.sin(t), Math.cos(t), 0]); }
    pts.push([3, 3, 0], [3, -LINE_HALF, 0]); nrm.push([1, 0, 0], [1, 0, 0]);
    var stickers = [3, 4, 5, 10, 13, 16];
    if (d < 0) { pts.reverse(); nrm.reverse(); stickers.reverse(); }
    return { kind: 'bend', faces: ['U', 'R'], stickers: stickers, points: pts, normals: nrm };
  }

  // Big arrow around the whole cube for x / y / z.
  //   x, y: a band round the cube's middle (like a belt), centred on the side facing the camera.
  //   z:    a flat halo just in front of the front face, over the top (a bigger cousin of F's arrow).
  function ringArrow(e, sense) {
    var flat = e[2] === 1;
    var u, centre;
    if (flat) { u = [0, 1, 0]; centre = [0, 0, 3.1]; } else {
      var cam = viewDir(DEFAULT_VIEW.az, DEFAULT_VIEW.el);
      u = norm(sub(cam, scale(e, dot(cam, e))));
      centre = [0, 0, 0];
    }
    var w = cross(e, u), span = flat ? 120 * DEG : RING_SPAN, R = flat ? FLAT_RING_R : RING_R;
    var from = sense > 0 ? -span : span, to = -from;
    var pts = [], nrm = [], N = 64;
    for (var i = 0; i <= N; i++) {
      var f = from + (to - from) * i / N;
      var r = add(scale(u, Math.cos(f)), scale(w, Math.sin(f)));
      pts.push(add(centre, scale(r, R)));
      nrm.push(flat ? e.slice() : r);
    }
    return { kind: 'ring', faces: [], stickers: [], centre: centre, points: pts, normals: nrm };
  }

  // Arrow for one turning layer, identified by its axis index k (0 x, 1 y, 2 z) and cubie coordinate c.
  function layerArrow(k, c, perm, sense) {
    if (k === 0) { var col = c + 1; return lineArrow('F', [18 + col, 21 + col, 24 + col], [2 * c, 0, 3], [0, 1, 0], [0, 0, 1], perm); }
    if (k === 1) { var row = 1 - c; return lineArrow('F', [18 + 3 * row, 19 + 3 * row, 20 + 3 * row], [0, 2 * c, 3], [1, 0, 0], [0, 0, 1], perm); }
    if (c === 1) return arcArrow(sense);
    if (c === -1) return lineArrow('U', [0, 1, 2], [0, 3, -2], [1, 0, 0], [0, 1, 0], perm);
    return bendArrow(perm);
  }

  // arrowSpec(token) -> { token, base, amount, double, quarter, rotation, axis, sense, arrows:[…] }
  //   arrow = { kind:'line'|'arc'|'bend'|'ring', faces, stickers (in travel order), points, normals, dir? }
  //   Doubles show the clockwise direction plus a "2" marker.
  function arrowSpec(token) {
    var C = Cube();
    var tok = C.normalizeToken(token);
    var base = C.baseOf(tok), amount = C.amountOf(tok);
    var quarter = amount === 2 ? base : tok;
    var perm = C.PERM[quarter];
    var def = C.MOVE_DEFS[base], axis = def[0];
    var k = axis[0] ? 0 : axis[1] ? 1 : 2;
    var e = [0, 0, 0]; e[k] = 1;
    var spec = {
      token: tok, base: base, amount: amount, double: amount === 2, quarter: quarter,
      rotation: C.isRotation(tok), axis: e, sense: senseOf(perm, e), arrows: []
    };
    if (spec.rotation) { spec.arrows.push(ringArrow(e, spec.sense)); return spec; }
    def[1].map(function (l) { return l * axis[k]; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (c) { spec.arrows.push(layerArrow(k, c, perm, spec.sense)); });
    return spec;
  }

  // ================================================================== move sequencer (pure)
  // Queues tokens, runs one timed animation at a time and commits each move to the state.
  // cfg: { state, speed, baseMs, begin(anim), progress(anim, k), end(anim), commit(token, state, job), user(token) }
  function createSequencer(cfg) {
    cfg = cfg || {};
    var C = Cube();
    var state = cfg.state ? toState(cfg.state) : C.solved();
    var jobs = [], anim = null;
    var seq = { speed: cfg.speed || 1, baseMs: cfg.baseMs || BASE_MS };

    function call(fn, a, b, c) { if (typeof fn !== 'function') return; try { fn(a, b, c); } catch (err) { report(err); } }
    function userBacklog() {
      var n = 0;
      jobs.forEach(function (j) { if (j.user) n += j.tokens.length - j.next; });
      return n;
    }
    function duration(tok, job) {
      var ms = seq.baseMs / (job.speed || seq.speed || 1) * (C.amountOf(tok) === 2 ? 1.5 : 1);
      if (job.user) { var b = userBacklog(); if (b > 0) ms /= Math.min(3, 1 + 0.5 * b); } // catch up with fast input
      return Math.max(1, ms);
    }
    function applyOne(job, index, tok) {
      state = C.applyMove(state, tok);
      job.done++;
      call(cfg.commit, tok, state, job);
      call(job.onMove, index, tok);
      if (job.user) call(cfg.user, tok);
      if (job.done === job.tokens.length) {
        var at = jobs.indexOf(job);
        if (at !== -1) jobs.splice(at, 1);
        job.resolve(state.slice());
      }
    }
    function finish() {
      var a = anim; anim = null;
      if (cfg.end) cfg.end(a);
      applyOne(a.job, a.index, a.token);
    }

    seq.enqueue = function (tokens, opts) {
      opts = opts || {};
      var list = C.parseAlg(tokens == null ? [] : tokens);
      var job = { tokens: list, next: 0, done: 0, speed: opts.speed, onMove: opts.onMove, user: !!opts.user };
      var p = new Promise(function (res) { job.resolve = res; });
      if (!list.length) job.resolve(state.slice()); else jobs.push(job);
      return p;
    };
    // Advance to time `t` (ms). Returns true while there is still something to animate.
    seq.step = function (t) {
      for (var guard = 0; guard < 100000; guard++) {
        if (!anim) {
          var job = jobs[0];
          if (!job) return false;
          var k = job.next++;
          anim = { token: job.tokens[k], job: job, index: k, start: t };
          anim.dur = duration(anim.token, job);
          if (cfg.begin) cfg.begin(anim);
        }
        var f = (t - anim.start) / anim.dur;
        if (f < 1) { if (cfg.progress) cfg.progress(anim, ease(f)); return true; }
        finish();
      }
      return true;
    };
    // Jump to the end of everything queued; every pending promise resolves.
    seq.cancel = function () {
      if (anim) finish();
      var list = jobs; jobs = [];
      list.forEach(function (job) {
        while (job.next < job.tokens.length) { var k = job.next++; applyOne(job, k, job.tokens[k]); }
        if (job.done < job.tokens.length) job.resolve(state.slice());
      });
    };
    // Drop everything queued (promises resolve with the new state) and optionally set a new state.
    seq.reset = function (st) {
      if (anim) { var a = anim; anim = null; if (cfg.end) cfg.end(a); }
      var list = jobs; jobs = [];
      if (st) state = toState(st);
      list.forEach(function (j) { j.resolve(state.slice()); });
    };
    seq.getState = function () { return state.slice(); };
    seq.peek = function () { return state; };
    seq.finalState = function () {
      var s = state;
      if (anim) s = C.applyMove(s, anim.token);
      jobs.forEach(function (j) { for (var k = j.next; k < j.tokens.length; k++) s = C.applyMove(s, j.tokens[k]); });
      return s.slice();
    };
    seq.busy = function () { return !!anim || jobs.length > 0; };
    seq.pending = function () {
      var n = anim ? 1 : 0;
      jobs.forEach(function (j) { n += j.tokens.length - j.next; });
      return n;
    };
    return seq;
  }

  // ================================================================== DOM helpers
  function injectStyle(id, css) {
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    var s = document.createElement('style');
    s.id = id; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }
  function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }

  // ================================================================== Net2D
  // Cross layout: U above F; L F R B in a row; D below F. Each face is drawn row-major exactly as the
  // facelet order defines it, which makes neighbouring stickers across a fold belong to one piece.
  var NET_POS = { U: [0, 1], L: [1, 0], F: [1, 1], R: [1, 2], B: [1, 3], D: [2, 1] }; // [faceRow, faceCol]
  function netCell(i) {
    var s = Cube().STICKERS[i], p = NET_POS[s.face];
    return [p[0] * 3 + s.row, p[1] * 3 + s.col];
  }
  var NET_SIZES = { sm: 14, md: 22, lg: 34 };
  var ROW_NAMES = ['top', 'middle', 'bottom'], COL_NAMES = ['left', 'centre', 'right'];
  var LABEL_INK = { W: 'rgba(0,0,0,.62)', Y: 'rgba(0,0,0,.62)', O: 'rgba(0,0,0,.62)', G: '#fff', B: '#fff', R: '#fff' };

  var NET_CSS = [
    '.cc-net{--cc-net-s:22px;--cc-net-gap:max(1px,calc(var(--cc-net-s)*.09));display:inline-grid;grid-template-columns:repeat(4,auto);grid-template-rows:repeat(3,auto);gap:max(2px,calc(var(--cc-net-s)*.2));line-height:1;vertical-align:top}',
    '.cc-net--sm{--cc-net-s:14px}.cc-net--md{--cc-net-s:22px}.cc-net--lg{--cc-net-s:34px}',
    '.cc-net-face{display:grid;grid-template-columns:repeat(3,var(--cc-net-s));grid-template-rows:repeat(3,var(--cc-net-s));gap:var(--cc-net-gap);padding:var(--cc-net-gap);background:var(--cc-net-body,#16171b);border-radius:calc(var(--cc-net-s)*.24);box-shadow:0 0 0 1px var(--cc-net-edge,rgba(128,128,128,.35))}',
    '.cc-net-st{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:var(--cc-net-s);height:var(--cc-net-s);border-radius:calc(var(--cc-net-s)*.18);background:#6b6e78;color:#fff;font:700 calc(var(--cc-net-s)*.5)/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;position:relative;transition:filter .15s ease,transform .15s ease}',
    'button.cc-net-st{cursor:pointer}',
    'button.cc-net-st:hover{transform:scale(1.07)}',
    'button.cc-net-st:focus-visible{outline:2px solid var(--cc-accent,' + ACCENT + ');outline-offset:2px;z-index:2}',
    '.cc-net-st.cc-net-unknown{background:repeating-linear-gradient(45deg,#5a5d66 0 3px,#70737d 3px 6px)}',
    '.cc-net--dim .cc-net-st:not(.cc-net-hl){filter:saturate(.45) brightness(.6)}',
    '.cc-net-st.cc-net-hl{z-index:1;box-shadow:0 0 0 2px var(--cc-net-body,#16171b),0 0 0 4px var(--cc-accent,' + ACCENT + ');animation:cc-net-pulse 1.1s ease-in-out infinite alternate}',
    '@keyframes cc-net-pulse{from{box-shadow:0 0 0 2px var(--cc-net-body,#16171b),0 0 0 3px var(--cc-accent,' + ACCENT + ')}to{box-shadow:0 0 0 2px var(--cc-net-body,#16171b),0 0 0 5px var(--cc-accent,' + ACCENT + '),0 0 10px 3px var(--cc-accent,' + ACCENT + ')}}',
    '.cc-net-fallback{display:flex;flex-direction:column;align-items:center;justify-content:safe center;gap:10px;width:100%;min-height:100%;padding:8px 0;box-sizing:border-box}',
    '.cc-net-caption{font:500 14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--cc-net-caption,inherit);text-align:center;min-height:1.35em;max-width:32em}',
    '@media (prefers-reduced-motion:reduce){.cc-net-st{transition:none}.cc-net-st.cc-net-hl{animation:none}}'
  ].join('\n');

  var Net2D = {
    POS: NET_POS,
    render: function (container, state, opts) {
      if (!container) throw new Error('Net2D.render needs a container element');
      injectStyle('cc-net-style', NET_CSS);
      var C = Cube();
      var o = assign({ size: 'md', labels: false, highlight: null, onSticker: null }, opts);
      var st = toState(state || C.solved());
      var el = document.createElement('div');
      var cells = [], clickable = null, destroyed = false;
      container.appendChild(el);

      function onClick(ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-i]') : null;
        if (!t || !el.contains(t) || typeof o.onSticker !== 'function') return;
        o.onSticker(+t.getAttribute('data-i'));
      }
      el.addEventListener('click', onClick);

      function build() {
        clickable = typeof o.onSticker === 'function';
        el.innerHTML = '';
        cells = [];
        C.FACES.forEach(function (f, fi) {
          var face = document.createElement('div');
          face.className = 'cc-net-face';
          face.setAttribute('data-face', f);
          face.style.gridRow = String(NET_POS[f][0] + 1);
          face.style.gridColumn = String(NET_POS[f][1] + 1);
          for (var k = 0; k < 9; k++) {
            var i = fi * 9 + k;
            var b = document.createElement(clickable ? 'button' : 'span');
            if (clickable) b.type = 'button'; else b.setAttribute('aria-hidden', 'true');
            b.className = 'cc-net-st';
            b.setAttribute('data-i', String(i));
            face.appendChild(b);
            cells[i] = b;
          }
          el.appendChild(face);
        });
        if (clickable) { el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Cube net: all six faces unfolded'); }
        else { el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Cube net: all six faces unfolded'); }
      }

      function paint() {
        var size = o.size;
        el.className = 'cc-net' + (NET_SIZES[size] ? ' cc-net--' + size : '');
        el.style.setProperty('--cc-net-s', typeof size === 'number' ? size + 'px' : '');
        var hl = {}, any = false;
        (o.highlight || []).forEach(function (i) { hl[i] = true; any = true; });
        if (any) el.classList.add('cc-net--dim');
        for (var i = 0; i < 54; i++) {
          var b = cells[i], col = st[i], hex = C.COLOR_HEX[col], s = C.STICKERS[i];
          b.style.background = hex || '';
          b.classList.toggle('cc-net-unknown', !hex);
          b.classList.toggle('cc-net-hl', !!hl[i]);
          var lbl = o.labels && s.row === 1 && s.col === 1 ? s.face : '';
          b.textContent = lbl;
          b.style.color = lbl ? (LABEL_INK[col] || '#fff') : '';
          if (clickable) {
            var pos = s.row === 1 && s.col === 1 ? 'centre' : ROW_NAMES[s.row] + '-' + COL_NAMES[s.col];
            b.setAttribute('aria-label', C.FACE_NAME[s.face] + ' face, ' + pos + ': ' + (C.COLOR_NAME[col] || 'unknown'));
          }
        }
      }

      build();
      paint();
      return {
        el: el,
        update: function (state2, opts2) {
          if (destroyed) return;
          if (state2) st = toState(state2);
          if (opts2) assign(o, opts2);
          if ((typeof o.onSticker === 'function') !== clickable) build();
          paint();
        },
        destroy: function () {
          if (destroyed) return;
          destroyed = true;
          el.removeEventListener('click', onClick);
          removeNode(el);
        }
      };
    }
  };

  // ================================================================== MovePad
  function padRows(opts) {
    opts = opts || {};
    var rows = [["U", "U'", "D", "D'", "R", "R'"], ["L", "L'", "F", "F'", "B", "B'"]];
    if (opts.slices) rows.push(["M", "M'", "E", "E'", "S", "S'"]);
    if (opts.rotations !== false) rows.push(["x", "x'", "y", "y'", "z", "z'"]);
    return rows;
  }

  var PAD_CSS = [
    '.cc-pad{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;max-width:372px}',
    '.cc-pad--compact{gap:4px;max-width:270px}',
    '.cc-pad-btn{appearance:none;-webkit-appearance:none;margin:0;min-width:0;min-height:40px;padding:8px 0;border-radius:8px;border:1px solid var(--cc-pad-border,rgba(128,128,128,.42));background:var(--cc-pad-bg,rgba(128,128,128,.12));color:inherit;font:600 15px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer;touch-action:manipulation;transition:background .12s ease,transform .06s ease}',
    '.cc-pad--compact .cc-pad-btn{min-height:30px;padding:5px 0;font-size:13px;border-radius:6px}',
    '.cc-pad-btn:hover{background:var(--cc-pad-hover,rgba(128,128,128,.24))}',
    '.cc-pad-btn:active{transform:translateY(1px)}',
    '.cc-pad-btn:focus-visible{outline:2px solid var(--cc-accent,' + ACCENT + ');outline-offset:1px}',
    '.cc-pad-btn--slice{border-style:dashed}',
    '.cc-pad-btn--rot{font-style:italic;background:var(--cc-pad-rot-bg,rgba(128,128,128,.05))}'
  ].join('\n');

  var MovePad = {
    rows: padRows,
    render: function (container, opts) {
      if (!container) throw new Error('MovePad.render needs a container element');
      injectStyle('cc-pad-style', PAD_CSS);
      var C = Cube();
      var o = assign({ onMove: null, compact: false, rotations: true, slices: false }, opts);
      var el = document.createElement('div');
      el.className = 'cc-pad' + (o.compact ? ' cc-pad--compact' : '');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Move buttons');
      padRows(o).forEach(function (row) {
        row.forEach(function (tok) {
          var info = C.moveInfo(tok);
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'cc-pad-btn' + (info.rotation ? ' cc-pad-btn--rot' : /^[MES]/.test(tok) ? ' cc-pad-btn--slice' : '');
          b.textContent = tok;
          b.title = info.text;
          b.setAttribute('aria-label', tok + ' — ' + info.text);
          b.setAttribute('data-token', tok);
          el.appendChild(b);
        });
      });
      function onClick(ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-token]') : null;
        if (!t || !el.contains(t)) return;
        if (typeof o.onMove === 'function') o.onMove(t.getAttribute('data-token'));
      }
      el.addEventListener('click', onClick);
      container.appendChild(el);
      return {
        el: el,
        destroy: function () { el.removeEventListener('click', onClick); removeNode(el); }
      };
    }
  };

  // ================================================================== Keys
  var SIMPLE_KEYS = { u: 'U', d: 'D', r: 'R', l: 'L', f: 'F', b: 'B', m: 'M', e: 'E', s: 'S', x: 'x', y: 'y', z: 'z' };
  // csTimer virtual-cube layout (physical QWERTY positions).
  var CSTIMER_KEYS = {
    i: 'R', k: "R'", j: 'U', f: "U'", h: 'F', g: "F'", s: 'D', l: "D'", d: 'L', e: "L'", w: 'B', o: "B'",
    ';': 'y', a: "y'", t: 'x', y: 'x', n: "x'", b: "x'", p: 'z', q: "z'",
    u: 'r', m: "r'", v: 'l', r: "l'", '5': 'M', '6': 'M', x: "M'", '.': "M'"
  };
  var CSTIMER_ORDER = ['i', 'k', 'j', 'f', 'h', 'g', 's', 'l', 'd', 'e', 'w', 'o', ';', 'a', 't', 'y', 'n', 'b', 'p', 'q', 'u', 'm', 'v', 'r', '5', '6', 'x', '.'];
  var CODE_CHARS = { Semicolon: ';', Period: '.', Comma: ',', Slash: '/', Quote: "'" };

  function codeChar(code) {
    if (!code) return null;
    var m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1].toLowerCase();
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    return CODE_CHARS[code] || null;
  }

  function isTypingTarget(t) {
    if (!t) return false;
    var tag = String(t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return t.isContentEditable === true;
  }

  var Keys = {
    SIMPLE: SIMPLE_KEYS,
    CSTIMER: CSTIMER_KEYS,
    toMove: function (e, scheme) {
      if (!e || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return null;
      if (isTypingTarget(e.target)) return null;
      if (scheme === 'cstimer') {
        var ch = codeChar(e.code) || String(e.key || '').toLowerCase();
        return CSTIMER_KEYS[ch] || null;
      }
      var k = String(e.key || '').toLowerCase();
      if (!SIMPLE_KEYS[k]) { var c2 = codeChar(e.code); if (c2 && SIMPLE_KEYS[c2]) k = c2; }
      var t = SIMPLE_KEYS[k];
      if (!t) return null;
      return e.shiftKey ? t + "'" : t;
    },
    legend: function (scheme) {
      if (scheme === 'cstimer') {
        return CSTIMER_ORDER.map(function (k) { return { key: k.toUpperCase(), token: CSTIMER_KEYS[k] }; });
      }
      var out = [];
      Object.keys(SIMPLE_KEYS).forEach(function (k) {
        out.push({ key: k.toUpperCase(), token: SIMPLE_KEYS[k] });
        out.push({ key: 'Shift+' + k.toUpperCase(), token: SIMPLE_KEYS[k] + "'" });
      });
      return out;
    }
  };

  // ================================================================== View3D
  var _webgl = null;
  function supported() {
    if (typeof document === 'undefined' || !root.THREE) return false;
    if (_webgl === null) {
      try {
        var c = document.createElement('canvas');
        var gl = root.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'));
        _webgl = !!gl;
        var lose = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (err) { _webgl = false; }
    }
    return _webgl;
  }

  function create(container, opts) {
    opts = opts || {};
    if (!container) throw new Error('View3D.create needs a container element');
    if (opts.fallback || !supported()) return createFallback(container, opts);
    try { return create3D(container, opts); } catch (err) {
      report(err);
      return createFallback(container, opts);
    }
  }

  // ------------------------------------------------------------------ 2D fallback (no WebGL)
  function createFallback(container, opts) {
    var C = Cube();
    injectStyle('cc-net-style', NET_CSS);
    var wrap = document.createElement('div');
    wrap.className = 'cc-net-fallback';
    var host = document.createElement('div');
    var cap = document.createElement('div');
    cap.className = 'cc-net-caption';
    cap.setAttribute('aria-live', 'polite');
    wrap.appendChild(host); wrap.appendChild(cap);
    container.appendChild(wrap);

    var hl = [], timer = 0, dirty = false, disposed = false;
    var api = { fallback: true, el: wrap, onUserMove: null };
    var seq = createSequencer({
      state: opts.state, speed: opts.speed,
      commit: function (tok) { var p = C.PERM[tok]; hl = hl.map(function (i) { return p[i]; }); dirty = true; },
      user: function (tok) { if (typeof api.onUserMove === 'function') api.onUserMove(tok); }
    });
    // Pick a sticker size that fits the container (12 stickers across, 9 down, plus gaps and a caption).
    function fitSize() {
      if (opts.netSize) return opts.netSize;
      var w = container.clientWidth || 300, h = container.clientHeight || 0;
      var s = (w - 24) / 13.4;
      if (h > 80) s = Math.min(s, (h - 56) / 10.4);
      return Math.max(10, Math.min(40, Math.floor(s)));
    }
    var net = Net2D.render(host, seq.peek(), { size: fitSize(), labels: opts.labels !== false });

    function draw() { dirty = false; net.update(seq.peek(), { highlight: hl }); }
    function tick() {
      timer = 0;
      if (disposed) return;
      var active = seq.step(now());
      if (dirty) draw();
      if (active) timer = setTimeout(tick, 30);
    }
    function kick() { if (!timer && !disposed) timer = setTimeout(tick, 0); }

    api.setState = function (s) { seq.reset(toState(s)); draw(); };
    api.getState = function () { return seq.getState(); };
    api.finalState = function () { return seq.finalState(); };
    api.play = function (tokens, o) { var p = seq.enqueue(tokens, o); kick(); return p; };
    api.userMove = function (tok) { var p = seq.enqueue([tok], { user: true }); kick(); return p; };
    api.cancel = function () { seq.cancel(); draw(); kick(); };
    api.isBusy = function () { return seq.busy(); };
    api.setSpeed = function (s) { seq.speed = +s || 1; };
    api.showArrow = function (token) {
      if (token == null || token === '') { cap.textContent = ''; return; }
      var info = C.moveInfo(token);
      cap.textContent = 'Next: ' + info.token + ' — ' + info.text;
    };
    api.highlight = function (indices) { hl = (indices || []).slice(); draw(); };
    api.setTurnable = function () {};
    api.resetCamera = function () {};
    api.resize = function () { if (!disposed) net.update(null, { size: fitSize() }); };
    api.dispose = function () {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      seq.reset();
      net.destroy();
      removeNode(wrap);
    };
    draw();
    return api;
  }

  // ------------------------------------------------------------------ WebGL view
  function create3D(container, opts) {
    var THREE = root.THREE, C = Cube(), V3 = THREE.Vector3;
    var interactive = opts.interactive !== false;
    var turnable = !!opts.turnable;
    var accent = opts.accent || ACCENT;
    var disposed = false, raf = 0, colorsDirty = true;
    var api = { fallback: false, onUserMove: null };

    function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

    // ---- renderer, scene, camera, lights
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    var canvas = renderer.domElement;
    canvas.className = 'cc-view3d';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', opts.label || 'Virtual Rubik’s cube');
    var cs = canvas.style;
    cs.display = 'block'; cs.width = '100%'; cs.height = '100%'; cs.outline = 'none';
    cs.userSelect = 'none'; cs.webkitUserSelect = 'none'; cs.webkitTapHighlightColor = 'transparent';
    cs.touchAction = (interactive || turnable) ? 'none' : '';
    container.appendChild(canvas);
    api.el = canvas;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3d46, 0.95));
    var keyLight = new THREE.DirectionalLight(0xffffff, 0.75);
    keyLight.position.set(2.5, 4, 1.5);  // relative to the camera: shading stays the same while orbiting
    camera.add(keyLight);

    // ---- cubies and stickers
    var cubeRoot = new THREE.Group();
    scene.add(cubeRoot);
    var pivot = new THREE.Group();
    cubeRoot.add(pivot);

    var bodyGeo = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    var bodyMat = new THREE.MeshStandardMaterial({ color: lin('#17181c'), roughness: 0.6, metalness: 0.05 });
    var stickerGeo = new THREE.ShapeGeometry(roundedRect(THREE, 0.84, 0.84, 0.13), 5);
    var ringShape = roundedRect(THREE, 1.0, 1.0, 0.18);
    ringShape.holes.push(roundedRect(THREE, 0.86, 0.86, 0.14));
    var ringGeo = new THREE.ShapeGeometry(ringShape, 5);
    var ringMat = new THREE.MeshBasicMaterial({ color: lin(accent), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });

    var cubies = [], cubieAt = {}, pickables = [];
    for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) {
      var g = new THREE.Group();
      g.position.set(x, y, z);
      var body = new THREE.Mesh(bodyGeo, bodyMat);
      body.userData.cubie = g;
      g.add(body);
      cubeRoot.add(g);
      var rec = { obj: g, home: [x, y, z] };
      g.userData.home = rec.home;
      cubies.push(rec);
      cubieAt[[x, y, z].join(',')] = g;
      if (x || y || z) pickables.push(body);
    }
    var Z = new V3(0, 0, 1);
    var stickers = C.STICKERS.map(function (s) {
      var g = cubieAt[s.cubie.join(',')];
      var mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.34, metalness: 0 });
      var m = new THREE.Mesh(stickerGeo, mat);
      var n = new V3(s.normal[0], s.normal[1], s.normal[2]);
      m.position.copy(n).multiplyScalar(0.479);
      m.quaternion.setFromUnitVectors(Z, n);
      m.userData = { index: s.index, cubie: g, base: m.position.clone(), normal: n, ring: null };
      g.add(m);
      pickables.push(m);
      return m;
    });

    var COLOR_LIN = {};
    Object.keys(C.COLOR_HEX).forEach(function (k) { COLOR_LIN[k] = lin(C.COLOR_HEX[k]); });
    var UNKNOWN = lin('#5d6069'), DIM = lin('#25272c'), BLACK = new THREE.Color(0);

    // ---- highlight
    var hl = [], hlSet = {};
    function setHl(list) {
      hl = (list || []).filter(function (i) { return i >= 0 && i < 54; });
      hlSet = {};
      hl.forEach(function (i) { hlSet[i] = true; });
      colorsDirty = true;
    }
    function applyColors() {
      colorsDirty = false;
      var st = seq.peek(), dim = hl.length > 0;
      for (var i = 0; i < 54; i++) {
        var m = stickers[i], on = !!hlSet[i], ud = m.userData;
        m.material.color.copy(COLOR_LIN[st[i]] || UNKNOWN);
        if (dim && !on) m.material.color.lerp(DIM, 0.4);
        m.material.emissive.copy(BLACK);
        m.position.copy(ud.base);
        if (on) {
          m.position.addScaledVector(ud.normal, 0.03);
          if (!ud.ring) {
            ud.ring = new THREE.Mesh(ringGeo, ringMat);
            ud.ring.position.z = 0.004;
            ud.ring.renderOrder = 1;
            m.add(ud.ring);
          }
          ud.ring.visible = true;
        } else if (ud.ring) ud.ring.visible = false;
      }
    }
    function pulse(t) {
      var p = 0.5 + 0.5 * Math.sin(t / 1000 * Math.PI * 2 / 1.2);
      ringMat.opacity = 0.55 + 0.45 * p;
      hl.forEach(function (i) {
        var m = stickers[i];
        m.material.emissive.copy(m.material.color).multiplyScalar(0.22 * p);
        if (m.userData.ring) m.userData.ring.scale.setScalar(1 + 0.05 * p);
      });
    }

    // ---- move sequencer wired to the scene
    var seq = createSequencer({
      state: opts.state, speed: opts.speed,
      begin: function (a) {
        var info = turnInfo(a.token);
        a.axisVec = new V3(info.axis[0], info.axis[1], info.axis[2]);
        a.angle = info.angle;
        a.group = [];
        cubies.forEach(function (c) {
          if (info.layers.indexOf(dot(c.home, info.axis)) !== -1) { pivot.add(c.obj); a.group.push(c); }
        });
      },
      progress: function (a, k) { pivot.quaternion.setFromAxisAngle(a.axisVec, a.angle * k); },
      end: function (a) {
        pivot.quaternion.identity();
        a.group.forEach(function (c) { cubeRoot.add(c.obj); });
      },
      commit: function (tok) {
        var p = C.PERM[tok];
        if (hl.length) setHl(hl.map(function (i) { return p[i]; }));
        colorsDirty = true;
      },
      user: function (tok) { if (typeof api.onUserMove === 'function') api.onUserMove(tok); }
    });

    // ---- camera
    var cam = { az: DEFAULT_VIEW.az, el: DEFAULT_VIEW.el, dist: 10, tween: null };
    function placeCamera() {
      var d = viewDir(cam.az, cam.el);
      camera.position.set(d[0] * cam.dist, d[1] * cam.dist, d[2] * cam.dist);
      camera.lookAt(0, 0, 0);
    }
    function updateCamera(t) {
      var tw = cam.tween;
      if (!tw) return false;
      if (tw.start == null) tw.start = t;
      var f = (t - tw.start) / tw.dur;
      if (f >= 1) { cam.az = DEFAULT_VIEW.az; cam.el = DEFAULT_VIEW.el; cam.tween = null; placeCamera(); return false; }
      var k = ease(f);
      cam.az = tw.az0 + (tw.az1 - tw.az0) * k;
      cam.el = tw.el0 + (tw.el1 - tw.el0) * k;
      placeCamera();
      return true;
    }
    api.resetCamera = function () {
      if (disposed) return;
      var twoPi = Math.PI * 2;
      var az1 = DEFAULT_VIEW.az + twoPi * Math.round((cam.az - DEFAULT_VIEW.az) / twoPi);
      if (Math.abs(az1 - cam.az) < 1e-4 && Math.abs(DEFAULT_VIEW.el - cam.el) < 1e-4) return;
      cam.tween = { az0: cam.az, el0: cam.el, az1: az1, el1: DEFAULT_VIEW.el, dur: 480, start: null };
      kick();
    };

    // ---- sizing
    var sizeMode = typeof opts.size === 'number' ? opts.size : 'fill';
    var lastW = 0, lastH = 0;
    function measure() {
      if (typeof sizeMode === 'number') {
        cs.width = sizeMode + 'px'; cs.height = sizeMode + 'px';
        return [sizeMode, sizeMode];
      }
      // Measure the container without the canvas: if it has no height of its own, stay square.
      var prev = cs.display;
      cs.display = 'none';
      var w = container.clientWidth, h = container.clientHeight;
      cs.display = prev;
      if (h < 16) { cs.height = w + 'px'; h = w; } else cs.height = '100%';
      return [w, h];
    }
    api.resize = function () {
      if (disposed) return;
      var wh = measure(), w = Math.max(1, Math.round(wh[0])), h = Math.max(1, Math.round(wh[1]));
      if (w !== lastW || h !== lastH) {
        lastW = w; lastH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        var vf = camera.fov * DEG / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
        cam.dist = FIT_RADIUS / (opts.zoom || 1) / Math.sin(Math.min(vf, hf));
        camera.updateProjectionMatrix();
        placeCamera();
      }
      kick();
    };
    var ro = null;
    if (typeof root.ResizeObserver === 'function') {
      ro = new root.ResizeObserver(function () { api.resize(); });
      ro.observe(container);
    } else root.addEventListener('resize', api.resize);

    // ---- render loop (runs only while something moves)
    function frame(t) {
      raf = 0;
      if (disposed) return;
      var active = seq.step(t);
      if (disposed) return; // a move callback may have disposed the view mid-frame
      if (updateCamera(t)) active = true;
      if (colorsDirty) applyColors();
      if (hl.length) { pulse(t); active = true; }
      renderer.render(scene, camera);
      if (active || drag) raf = root.requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !disposed) raf = root.requestAnimationFrame(frame); }

    // ---- arrows
    var arrowGroup = null;
    var arrowMat = new THREE.MeshBasicMaterial({ color: lin(accent), side: THREE.DoubleSide });
    var outlineMat = new THREE.MeshBasicMaterial({ color: lin(OUTLINE), side: THREE.DoubleSide });

    function ribbonGeometry(pts, nrm, width, headLen, headWidth) {
      var n = pts.length, L = [0], i;
      for (i = 1; i < n; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
      var total = L[n - 1], hb = Math.max(total - headLen, total * 0.3);
      var sp = [], sn = [];
      for (i = 0; i < n; i++) {
        if (L[i] < hb - 1e-6) { sp.push(pts[i]); sn.push(nrm[i]); continue; }
        var seg = L[i] - L[i - 1], f = seg > 0 ? (hb - L[i - 1]) / seg : 0;
        sp.push(pts[i - 1].clone().lerp(pts[i], f));
        sn.push(nrm[i - 1].clone().lerp(nrm[i], f).normalize());
        break;
      }
      var pos = [], idx = [], m = sp.length, prevT = new V3(1, 0, 0);
      for (var k = 0; k < m; k++) {
        var t = sp[Math.min(m - 1, k + 1)].clone().sub(sp[Math.max(0, k - 1)]);
        if (t.lengthSq() < 1e-12) t.copy(prevT); else t.normalize();
        prevT = t;
        var s = new V3().crossVectors(sn[k], t).normalize().multiplyScalar(width / 2);
        pos.push(sp[k].x + s.x, sp[k].y + s.y, sp[k].z + s.z, sp[k].x - s.x, sp[k].y - s.y, sp[k].z - s.z);
        if (k > 0) { var q = 2 * (k - 1); idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      var base = sp[m - 1], tip = pts[n - 1];
      var chord = tip.clone().sub(base).normalize();
      var bs = new V3().crossVectors(sn[m - 1], chord).normalize().multiplyScalar(headWidth / 2);
      var h0 = pos.length / 3;
      pos.push(base.x + bs.x, base.y + bs.y, base.z + bs.z, base.x - bs.x, base.y - bs.y, base.z - bs.z, tip.x, tip.y, tip.z);
      idx.push(h0, h0 + 1, h0 + 2);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      return geo;
    }

    function addArrow(group, a) {
      var ring = a.kind === 'ring';
      var W = ring ? 0.24 : 0.21, HL = ring ? 0.5 : 0.44, HW = ring ? 0.6 : 0.54, O = 0.045;
      var lift = ring ? 0 : 0.05, liftO = ring ? -0.015 : 0.035;
      var n = a.points.length, pts = [], ptsO = [], nrm = [];
      for (var i = 0; i < n; i++) {
        var p = a.points[i], q = a.normals[i];
        var nv = new V3(q[0], q[1], q[2]).normalize();
        nrm.push(nv);
        pts.push(new V3(p[0] / 2, p[1] / 2, p[2] / 2).addScaledVector(nv, lift));
        ptsO.push(new V3(p[0] / 2, p[1] / 2, p[2] / 2).addScaledVector(nv, liftO));
      }
      var t0 = ptsO[1].clone().sub(ptsO[0]).normalize();
      var tn = ptsO[n - 1].clone().sub(ptsO[n - 2]).normalize();
      var oPts = [ptsO[0].clone().addScaledVector(t0, -O)].concat(ptsO, [ptsO[n - 1].clone().addScaledVector(tn, O * 2.4)]);
      var oNrm = [nrm[0]].concat(nrm, [nrm[n - 1]]);
      var outline = new THREE.Mesh(ribbonGeometry(oPts, oNrm, W + 2 * O, HL + 3.2 * O, HW + 4.6 * O), outlineMat);
      outline.renderOrder = 2;
      var fill = new THREE.Mesh(ribbonGeometry(pts, nrm, W, HL, HW), arrowMat);
      fill.renderOrder = 3;
      group.add(outline);
      group.add(fill);
      return { tip: pts[n - 1], tangent: pts[n - 1].clone().sub(pts[n - 2]).normalize(), normal: nrm[n - 1] };
    }

    function makeMarker(text) {
      var c = document.createElement('canvas');
      c.width = c.height = 128;
      var g2 = c.getContext('2d');
      g2.beginPath(); g2.arc(64, 64, 54, 0, Math.PI * 2);
      g2.fillStyle = accent; g2.fill();
      g2.lineWidth = 10; g2.strokeStyle = OUTLINE; g2.stroke();
      g2.font = '800 78px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.lineJoin = 'round'; g2.lineWidth = 10; g2.strokeStyle = OUTLINE; g2.strokeText(text, 64, 68);
      g2.fillStyle = '#ffffff'; g2.fillText(text, 64, 68);
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(0.5, 0.5, 1);
      sprite.renderOrder = 5;
      return sprite;
    }

    function clearArrow() {
      if (!arrowGroup) return;
      scene.remove(arrowGroup);
      arrowGroup.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== arrowMat && o.material !== outlineMat) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      arrowGroup = null;
    }

    api.showArrow = function (token) {
      if (disposed) return;
      clearArrow();
      if (token != null && token !== '') {
        var spec = arrowSpec(token);
        arrowGroup = new THREE.Group();
        var last = null;
        spec.arrows.forEach(function (a) { last = addArrow(arrowGroup, a); });
        if (spec.double && last) {
          var mk = makeMarker('2');
          if (spec.rotation) {
            // Whole-cube rings already sit near the edge of the view: pull the badge inwards.
            var ring = spec.arrows[spec.arrows.length - 1];
            mk.position.copy(last.tip).lerp(new V3().fromArray(ring.centre || [0, 0, 0]), 0.28).addScaledVector(last.normal, 0.18);
          } else {
            mk.position.copy(last.tip).addScaledVector(last.tangent, 0.3).addScaledVector(last.normal, 0.18);
          }
          arrowGroup.add(mk);
        }
        scene.add(arrowGroup);
      }
      kick();
    };

    // ---- picking and pointer input
    var raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    var tmpQ = new THREE.Quaternion(), tmpV = new V3();
    function pick(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      var hits = raycaster.intersectObjects(pickables, false);
      if (!hits.length) return null;
      var h = hits[0], obj = h.object, nv;
      obj.getWorldQuaternion(tmpQ);
      if (obj.userData.index != null) nv = new V3(0, 0, 1).applyQuaternion(tmpQ);
      else if (h.face) nv = h.face.normal.clone().applyQuaternion(tmpQ);
      else return null;
      var nr = roundVec([nv.x, nv.y, nv.z]);
      if (Math.abs(nv.x * nr[0] + nv.y * nr[1] + nv.z * nr[2]) < 0.94) return null; // layer is mid-turn
      var cubieObj = obj.userData.cubie || obj.parent;
      cubieObj.getWorldPosition(tmpV);
      var cub = roundVec([tmpV.x, tmpV.y, tmpV.z]);
      if (Math.abs(tmpV.x - cub[0]) > 0.2 || Math.abs(tmpV.y - cub[1]) > 0.2 || Math.abs(tmpV.z - cub[2]) > 0.2) return null;
      if (dot(cub, nr) !== 1) return null; // an inside face seen through a gap
      return { normal: nr, cubie: cub, point: h.point.clone() };
    }
    function toScreen(v) {
      var p = v.clone().project(camera);
      return { x: (p.x + 1) / 2 * lastW, y: (1 - p.y) / 2 * lastH };
    }
    function tokenForDrag(pk, dx, dy) {
      var p0 = toScreen(pk.point), dl = Math.sqrt(dx * dx + dy * dy), best = null, bestScore = -2;
      inPlaneAxes(pk.normal).forEach(function (a) {
        var p1 = toScreen(pk.point.clone().add(new V3(a[0], a[1], a[2]).multiplyScalar(0.5)));
        var sx = p1.x - p0.x, sy = p1.y - p0.y, sl = Math.sqrt(sx * sx + sy * sy);
        if (sl < 1e-6) return;
        var score = (sx * dx + sy * dy) / (sl * dl);
        if (score > bestScore) { bestScore = score; best = a; }
      });
      return best ? dragToToken(pk.normal, best, pk.cubie) : null;
    }

    var drag = null;
    function setCursor(c) { if (cs.cursor !== c) cs.cursor = c; }
    function idleCursor(e) {
      if (turnable && e && pick(e.clientX, e.clientY)) setCursor('pointer');
      else setCursor(interactive ? 'grab' : '');
    }
    function onDown(e) {
      if (disposed || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var pk = turnable ? pick(e.clientX, e.clientY) : null;
      if (pk) drag = { id: e.pointerId, mode: 'turn', pick: pk, x0: e.clientX, y0: e.clientY };
      else if (interactive) {
        drag = { id: e.pointerId, mode: 'orbit', x0: e.clientX, y0: e.clientY, az0: cam.az, el0: cam.el };
        cam.tween = null;
        setCursor('grabbing');
      } else return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    function onMove(e) {
      if (disposed) return;
      if (!drag) { if (e.pointerType === 'mouse') idleCursor(e); return; }
      if (e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (drag.mode === 'orbit') {
        cam.az = drag.az0 - dx * 0.0085;
        cam.el = clamp(drag.el0 + dy * 0.0085, -EL_LIMIT, EL_LIMIT);
        placeCamera();
        kick();
      } else if (drag.mode === 'turn' && dx * dx + dy * dy > 100) {
        var tok = tokenForDrag(drag.pick, dx, dy);
        drag.mode = 'done';
        if (tok) api.userMove(tok);
      }
    }
    function onUp(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      try { canvas.releasePointerCapture(drag.id); } catch (err) { /* ignore */ }
      drag = null;
      idleCursor(e && e.pointerType === 'mouse' ? e : null);
      kick();
    }
    function onDbl(e) { if (interactive) { e.preventDefault(); api.resetCamera(); } }
    function onLeave() { if (!drag) setCursor(interactive ? 'grab' : ''); }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDbl);
    setCursor(interactive ? 'grab' : '');

    // ---- public API
    api.setState = function (s) { if (disposed) return; seq.reset(toState(s)); colorsDirty = true; kick(); };
    api.getState = function () { return seq.getState(); };
    api.finalState = function () { return seq.finalState(); };
    api.play = function (tokens, o) { var p = seq.enqueue(tokens, o ? { speed: o.speed, onMove: o.onMove } : null); kick(); return p; };
    api.userMove = function (tok) { var p = seq.enqueue([tok], { user: true }); kick(); return p; };
    api.cancel = function () { seq.cancel(); colorsDirty = true; kick(); };
    api.isBusy = function () { return seq.busy(); };
    api.setSpeed = function (s) { seq.speed = +s || 1; };
    api.highlight = function (indices) { if (disposed) return; setHl(indices); kick(); };
    api.setTurnable = function (on) { turnable = !!on; cs.touchAction = (interactive || turnable) ? 'none' : ''; };
    api.dispose = function () {
      if (disposed) return;
      disposed = true;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect(); else root.removeEventListener('resize', api.resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('dblclick', onDbl);
      seq.reset();
      clearArrow();
      var geos = [bodyGeo, stickerGeo, ringGeo], mats = [bodyMat, ringMat, arrowMat, outlineMat];
      stickers.forEach(function (m) { mats.push(m.material); });
      geos.forEach(function (g3) { g3.dispose(); });
      mats.forEach(function (m) { m.dispose(); });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      removeNode(canvas);
    };

    api.resize();
    return api;
  }

  function roundedRect(THREE, w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // ================================================================== exports
  var View3D = {
    supported: supported,
    create: create,
    DEFAULT_VIEW: DEFAULT_VIEW,
    _internal: {
      dragToToken: dragToToken, inPlaneAxes: inPlaneAxes, turnInfo: turnInfo, arrowSpec: arrowSpec,
      createSequencer: createSequencer, ease: ease, viewDir: viewDir, netCell: netCell, padRows: padRows,
      codeChar: codeChar, isTypingTarget: isTypingTarget, BASE_MS: BASE_MS
    }
  };

  root.CC = root.CC || {};
  root.CC.View3D = View3D;
  root.CC.Net2D = Net2D;
  root.CC.MovePad = MovePad;
  root.CC.Keys = Keys;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { View3D: View3D, Net2D: Net2D, MovePad: MovePad, Keys: Keys };
  }
})(typeof window !== 'undefined' ? window : globalThis);
