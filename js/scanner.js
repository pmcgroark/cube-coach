/* Cube Coach — camera scanner (CC.Scanner).
 *
 * Reads the six faces of a real cube through the laptop camera and turns them into a
 * 54-letter state in the facelet order of js/cube.js (U R F D L B, row-major).
 *
 * WHY THESE HOLDS (SCAN_ORDER)
 * ----------------------------
 * cube.js defines each face's 3x3 grid "as seen looking straight at that face":
 *   R F L B head-on with U at the top;  U from above with B at the top;  D from below with F at the top.
 * A camera pointed at a face sees exactly that kind of view (the face head-on, from outside),
 * and the RAW, unmirrored frame keeps the camera's own left/right: something on the camera's
 * right is on the right of the raw image. So if the cube is held with the face named below on
 * top, raw-frame cell (row, col) IS sticker (face, row, col), with no flipping or rotating:
 *   F, R, B, L : that colour facing the camera, WHITE (U) on top      -> "U at the top"
 *   U          : WHITE facing the camera, BLUE (B) on top              -> "B at the top"
 *   D          : YELLOW facing the camera, GREEN (F) on top            -> "F at the top"
 * In numbers (checked in tests/scanner.test.js against CC.Cube.STICKERS): put the camera on
 * +z looking back at the cube, world +y up, world +x = the camera's right = the right of the
 * raw image. For a hold with face normal n toward the camera and up-face normal u, a
 * cube-frame point p lands at world (p.(u x n), p.u, p.n). For every sticker of the shown face
 * col = x + 1 and row = 1 - y reproduce STICKERS[i].row / .col exactly. The same numbers show
 * that the next face in the F -> R -> B -> L sequence is always at world +x, i.e. on the
 * LEARNER'S LEFT (they face the camera), which is what the tips say.
 * A beginner who turns the other way shows ORANGE second and RED fourth. Both are held WHITE on
 * top, so each face still arrives in its own orientation, just in the other slot; the session
 * accepts either at those two steps and swaps them once both are in (the redder centre is RED).
 *
 * Only the on-screen preview is mirrored (selfie style). Sampling always reads the raw frame;
 * the overlay mirrors cell columns so each swatch sits on the sticker the learner sees.
 *
 * Pure parts (colour maths, Hungarian assignment, classifyCube, sampleCells, the auto-capture
 * session) run in node. The camera controller and the fake camera need a browser and touch
 * the DOM only when called.
 */
(function (root) {
  'use strict';

  function CubeLib() { return root.CC && root.CC.Cube; }

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var COLORS = ['W', 'Y', 'G', 'B', 'R', 'O'];
  var NAME = { W: 'WHITE', Y: 'YELLOW', G: 'GREEN', B: 'BLUE', R: 'RED', O: 'ORANGE' };
  var FALLBACK_HEX = { W: '#f5f5f0', Y: '#ffd500', G: '#009e60', B: '#0051ba', R: '#c8102e', O: '#ff6a13' };

  var SCAN_ORDER = [
    { face: 'F', center: 'G', up: 'W', say: 'Show the GREEN centre to the camera, WHITE on top',
      tip: 'Hold the cube with WHITE on top and GREEN facing the camera. Fill the square with that face.' },
    { face: 'R', center: 'R', up: 'W', say: 'Show the RED centre to the camera, WHITE on top',
      tip: 'Keep WHITE on top. RED is on your left-hand side: turn the cube a quarter turn so RED faces the camera.' },
    { face: 'B', center: 'B', up: 'W', say: 'Show the BLUE centre to the camera, WHITE on top',
      tip: 'Keep WHITE on top and turn the same way again: BLUE (now on your left) comes round to face the camera.' },
    { face: 'L', center: 'O', up: 'W', say: 'Show the ORANGE centre to the camera, WHITE on top',
      tip: 'Keep WHITE on top and turn the same way once more: ORANGE comes round to face the camera.' },
    { face: 'U', center: 'W', up: 'B', say: 'Show the WHITE centre to the camera, BLUE on top',
      tip: 'Turn the same way once more so GREEN faces the camera (white on top), then tip the top of the cube toward the camera: WHITE now faces it and BLUE is on top.' },
    { face: 'D', center: 'Y', up: 'G', say: 'Show the YELLOW centre to the camera, GREEN on top',
      tip: 'Flip the cube over, top over bottom, so YELLOW faces the camera and GREEN is on top.' }
  ];

  // Typical sticker colours as a webcam sees them under neutral light (sRGB 0..255).
  var DEFAULT_RGB = {
    W: [225, 228, 222], Y: [225, 205, 40], G: [20, 155, 75],
    B: [15, 75, 175], R: [185, 25, 40], O: [240, 105, 25]
  };

  // ------------------------------------------------------------------ tuning
  var GUIDE_FRAC = 0.55;      // guide square = 55% of the shorter side, centred
  var SAMPLE_FRAC = 0.5;      // sample the central 50% (each way) of every cell
  var DARK_CUT = 0.45;        // sampling: pixels darker than 45% of the cell's 60th-percentile luminance are gap / body
  var GLARE_SAT = 0.5;        // sampling: on a coloured sticker, bright pixels with < half its saturation are glare
  var SAMPLE_WIDTH = 320;     // raw frame is shrunk to this width before sampling
  var WL = 0.25;              // plain distance: weight of (dL)^2 (used for "has the picture changed?" checks)
  // classification distance (cdist2): lightness, log-compressed chroma and hue weighted separately
  var CL_L = 0.35, CL_C = 0.5, CL_H = 2, CHROMA_C0 = 8, CHROMA_K = 68;
  var STABLE_MS = 600;        // hold this long (all 9 cells steady) before auto-capture
  var STABLE_TOL = 9;         // max colour drift of any cell that still counts as "steady"
  var UNIFORM_STD = 22;       // a sticker is a flat patch: luminance std-dev in its sample stays below this
  var PLAUSIBLE_D = 45;       // a cell this far (plain distance) from every reference colour is not a sticker
  var REARM_D = 18;           // mean change needed (vs the last capture) before auto-capture re-arms
  var DISTINCT_D = 14;        // ...or a centre change this big
  var CHROMA_EPS = 0.003;     // linear-light floor for the log-chromaticity ratios
  var CHROMA_SAME = 0.4;      // two centres closer than this in log-chromaticity are the same face again
  var UNSURE_GAP = 12;        // accept the expected centre as a close second this near the best (plain distance)
  var GAP_DIP = 0.3;          // a dark seam between two cells: luminance dips at least 30% below the darker cell
  var MIN_GRID = 4;           // a face of (almost) one colour must show at least this many seams of 12 to be a cube
  var UNCERTAIN_CONF = 0.25;  // classifyCube: stickers below this confidence are reported as uncertain
  var WRONG_FACE_MARGIN = 250; // squared plain-distance margin before warning that a centre looks like another colour
  var PAIR = { R: 'O', O: 'R' }; // red and orange: told apart by comparing the two faces, not by absolute colour

  // ------------------------------------------------------------------ colour maths
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function srgbToLin(v) { v = v / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function linToSrgb(v) {
    v = clamp(v, 0, 1);
    v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return v * 255;
  }
  var LAB_E = 216 / 24389, LAB_K = 24389 / 27;
  function labF(t) { return t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116; }
  // linear sRGB (0..1) -> CIE Lab (D65)
  function linToLab(r, g, b) {
    var X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    var Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    var Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    var fx = labF(X), fy = labF(Y), fz = labF(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  // sRGB 0..255 -> [L, a, b]. Also accepts one [r, g, b] array.
  function rgbToLab(r, g, b) {
    if (Array.isArray(r)) { b = r[2]; g = r[1]; r = r[0]; }
    return linToLab(srgbToLin(r), srgbToLin(g), srgbToLin(b));
  }
  function lumLin(v) { return 0.2126729 * v[0] + 0.7151522 * v[1] + 0.0721750 * v[2]; }
  // Plain weighted Lab distance (lightness counts half): used to ask "has the picture changed?".
  function dist2(p, q) { var dl = p[0] - q[0], da = p[1] - q[1], db = p[2] - q[2]; return WL * dl * dl + da * da + db * db; }
  function dist(p, q) { return Math.sqrt(dist2(p, q)); }
  // Classification distance: which sticker colour is this? Exposure, shadow and glare mostly change
  // lightness and chroma, while hue (what separates red from orange) survives them, so hue counts most.
  // Chroma is compared on a log-like scale because glare and shadow scale it: a washed-out yellow
  // keeps far more chroma than any white, and a glare-pale orange stays orange in hue.
  function chromaT(c) { return CHROMA_K * Math.log(1 + c / CHROMA_C0); }
  function cdist2(p, q) {
    var dl = p[0] - q[0], da = p[1] - q[1], db = p[2] - q[2];
    var c1 = Math.sqrt(p[1] * p[1] + p[2] * p[2]), c2 = Math.sqrt(q[1] * q[1] + q[2] * q[2]);
    var dc = c1 - c2, dh2 = Math.max(0, da * da + db * db - dc * dc), dt = chromaT(c1) - chromaT(c2);
    return CL_L * dl * dl + CL_C * dt * dt + CL_H * dh2;
  }
  // Exposure-independent chromaticity of an sRGB sample: [ln(G/R), ln(B/G)] in linear light. A colour
  // cast multiplies every sample's ratios by the same factors, so comparing two samples this way
  // survives casts and exposure changes: red always has a far lower G/R than orange.
  function chromaOf(rgb) {
    var r = srgbToLin(rgb[0]) + CHROMA_EPS, g = srgbToLin(rgb[1]) + CHROMA_EPS, b = srgbToLin(rgb[2]) + CHROMA_EPS;
    return [Math.log(g / r), Math.log(b / g)];
  }
  function chromaDist(p, q) { return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])); }
  function median(list) {
    if (!list.length) return 1;
    var s = list.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  var CANON_LIN = {}, CANON_LAB = {};
  COLORS.forEach(function (c) {
    CANON_LIN[c] = DEFAULT_RGB[c].map(srgbToLin);
    CANON_LAB[c] = rgbToLab(DEFAULT_RGB[c]);
  });

  function toRGB(x) {
    var v = x;
    if (v && !Array.isArray(v) && v.rgb) v = v.rgb;
    if (v && !Array.isArray(v) && v.r != null) v = [v.r, v.g, v.b];
    if (!v || v.length < 3 || !isFinite(v[0]) || !isFinite(v[1]) || !isFinite(v[2])) throw new Error('Bad colour sample: ' + JSON.stringify(x));
    return [clamp(+v[0], 0, 255), clamp(+v[1], 0, 255), clamp(+v[2], 0, 255)];
  }

  // ------------------------------------------------------------------ Hungarian algorithm
  // Minimum-cost assignment for an n x m cost matrix (n <= m). Returns rowToCol[n].
  // O(n^2 m) shortest-augmenting-path version with row/column potentials.
  function hungarian(cost) {
    var n = cost.length;
    if (!n) return [];
    var m = cost[0].length;
    if (m < n) throw new Error('hungarian: need at least as many columns as rows');
    for (var r0 = 0; r0 < n; r0++) {
      for (var c0 = 0; c0 < m; c0++) if (!isFinite(cost[r0][c0])) throw new Error('hungarian: costs must be finite numbers');
    }
    var u = new Float64Array(n + 1), v = new Float64Array(m + 1);
    var p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    var minv = new Float64Array(m + 1), used = new Uint8Array(m + 1);
    for (var i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0, j;
      for (j = 0; j <= m; j++) { minv[j] = Infinity; used[j] = 0; }
      do {
        used[j0] = 1;
        var i0 = p[j0], delta = Infinity, j1 = 0, row = cost[i0 - 1];
        for (j = 1; j <= m; j++) {
          if (used[j]) continue;
          var cur = row[j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var jp = way[j0]; p[j0] = p[jp]; j0 = jp; } while (j0);
    }
    var out = new Array(n);
    for (j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
    return out;
  }

  // ------------------------------------------------------------------ whole-cube classification
  var CENTRE_OF_FACE = {};
  SCAN_ORDER.forEach(function (e) { CENTRE_OF_FACE[e.face] = e.center; });
  var STEP_OF_FACE = {};
  SCAN_ORDER.forEach(function (e, i) { STEP_OF_FACE[e.face] = i; });

  // Assign the 48 non-centre stickers to 6 colours x 8 slots (centres are pinned).
  function assignStickers(labs, refs, movable, pinned) {
    var per = movable.length / 6;
    var cost = movable.map(function (i) {
      var row = new Array(movable.length);
      for (var c = 0; c < 6; c++) {
        var d = cdist2(labs[i], refs[c]);
        for (var s = 0; s < per; s++) row[c * per + s] = d;
      }
      return row;
    });
    var a = hungarian(cost), letters = new Array(54);
    for (var f = 0; f < 6; f++) letters[f * 9 + 4] = pinned[f];
    movable.forEach(function (i, r) { letters[i] = COLORS[Math.floor(a[r] / per)]; });
    return letters;
  }

  function colourMeans(labs, letters, fallback) {
    return COLORS.map(function (c, ci) {
      var s = [0, 0, 0], n = 0;
      for (var i = 0; i < 54; i++) if (letters[i] === c) { s[0] += labs[i][0]; s[1] += labs[i][1]; s[2] += labs[i][2]; n++; }
      return n ? [s[0] / n, s[1] / n, s[2] / n] : fallback[ci];
    });
  }

  function rotateFaceGrid(state, f, quarterTurns) {
    var out = state.slice();
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var rr = r, cc = c;
        for (var t = 0; t < quarterTurns; t++) { var tmp = rr; rr = cc; cc = 2 - tmp; } // (r,c) -> (c, 2-r): clockwise
        out[f * 9 + rr * 3 + cc] = state[f * 9 + r * 3 + c];
      }
    }
    return out;
  }

  var MOVABLE = [];
  (function () { for (var i = 0; i < 54; i++) if (i % 9 !== 4) MOVABLE.push(i); })();
  var PINNED = FACES.map(function (f) { return CENTRE_OF_FACE[f]; });
  var COLOUR_INDEX = {};
  COLORS.forEach(function (c, i) { COLOUR_INDEX[c] = i; });

  /* Constrained clustering of 54 samples (sRGB, facelet order). Linear light -> "known palette"
   * white balance (exactly 9 of each colour, so the mean of all 54 should equal the mean of the
   * 6 reference colours) -> Hungarian assignment of the 48 non-centre stickers to 6 colours x 8
   * slots (centres pinned), with colour means and per-face exposure re-estimated until nothing
   * changes. Returns { letters, labs, d2 (54 x 6 classification distances), wb, gain, iterations }. */
  function clusterSamples(rgb, opts) {
    var lin = rgb.map(function (p) { return [srgbToLin(p[0]), srgbToLin(p[1]), srgbToLin(p[2])]; });
    var obsMean = [0, 0, 0], canMean = [0, 0, 0], ch;
    lin.forEach(function (v) { for (var c = 0; c < 3; c++) obsMean[c] += v[c] / 54; });
    COLORS.forEach(function (c) { for (var k = 0; k < 3; k++) canMean[k] += CANON_LIN[c][k] / 6; });
    var wb = [1, 1, 1];
    if (opts.whiteBalance !== false) for (ch = 0; ch < 3; ch++) wb[ch] = obsMean[ch] > 1e-6 ? clamp(canMean[ch] / obsMean[ch], 0.25, 4) : 1;
    lin = lin.map(function (v) { return [v[0] * wb[0], v[1] * wb[1], v[2] * wb[2]]; });

    // per-face exposure: each face is captured separately and the camera's auto-exposure changes
    // between them. Start from the centres (their colour is known), then refine from all stickers.
    var gain = [1, 1, 1, 1, 1, 1];
    if (opts.faceGain !== false) {
      gain = PINNED.map(function (c, fi) {
        var want = lumLin(CANON_LIN[c]), got = lumLin(lin[fi * 9 + 4]);
        return want > 1e-4 && got > 1e-5 ? clamp(got / want, 0.33, 3) : 1;
      });
      normaliseGains();
    }
    function normaliseGains() {
      var lg = 0;
      gain.forEach(function (g) { lg += Math.log(g) / 6; });
      gain = gain.map(function (g) { return clamp(g / Math.exp(lg), 0.33, 3); });
    }
    function labsNow() {
      return lin.map(function (v, i) { var g = gain[Math.floor(i / 9)]; return linToLab(v[0] / g, v[1] / g, v[2] / g); });
    }
    var labs = labsNow();
    var refs = COLORS.map(function (c) {
      var cl = labs[PINNED.indexOf(c) * 9 + 4], k = CANON_LAB[c];
      return [(cl[0] + k[0]) / 2, (cl[1] + k[1]) / 2, (cl[2] + k[2]) / 2];
    });

    function updateGains(letters) {
      var sum = {}, n = {};
      COLORS.forEach(function (c) { sum[c] = 0; n[c] = 0; });
      for (var i = 0; i < 54; i++) { sum[letters[i]] += lumLin(lin[i]) / gain[Math.floor(i / 9)]; n[letters[i]]++; }
      gain = gain.map(function (g, fi) {
        var ratios = [];
        for (var k = 0; k < 9; k++) {
          var j = fi * 9 + k, ref = sum[letters[j]] / n[letters[j]];
          if (ref > 1e-4) ratios.push(lumLin(lin[j]) / g / ref);
        }
        return g * clamp(median(ratios), 0.5, 2);
      });
      normaliseGains();
    }

    var letters = null, iterations = 0;
    for (var iter = 0; iter < 25; iter++) {
      iterations = iter + 1;
      var next = assignStickers(labs, refs, MOVABLE, PINNED);
      var same = !!letters && next.every(function (l, k) { return l === letters[k]; });
      letters = next;
      if (same && iter >= 2) break;
      if (opts.faceGain !== false) { updateGains(letters); labs = labsNow(); }
      refs = colourMeans(labs, letters, refs);
    }
    var d2 = labs.map(function (l) { return refs.map(function (r) { return cdist2(l, r); }); });
    return { letters: letters, labs: labs, d2: d2, wb: wb, gain: gain, iterations: iterations };
  }

  /* classifyCube({U:[9 rgb], R:[...], F, D, L, B}, opts?) -> result
   * rgb = [r,g,b] 0..255 (or {r,g,b}, or a sampleCells() cell). Each face's 9 samples are in
   * facelet order, i.e. raw camera (row, col) for the hold in SCAN_ORDER.
   * clusterSamples -> CC.Cube.validate -> (if not a real cube) RED/ORANGE faces swapped? -> repair.
   * opts: { whiteBalance:false, faceGain:false, swapCheck:false, repair:false } switch steps off (for tests). */
  function classifyCube(faces, opts) {
    opts = opts || {};
    var Cube = CubeLib();
    if (!faces) throw new Error('classifyCube needs the six scanned faces');
    var rgb = [];
    FACES.forEach(function (f) {
      var arr = faces[f];
      if (!arr || arr.length !== 9) throw new Error('classifyCube needs 9 colour samples for face ' + f);
      for (var k = 0; k < 9; k++) rgb.push(toRGB(arr[k]));
    });
    var pinned = PINNED, colourIndex = COLOUR_INDEX, movable = MOVABLE;
    var warnings = [], suspectSteps = [];

    var cl = clusterSamples(rgb, opts);
    var validation = Cube ? Cube.validate(cl.letters) : { ok: false, errors: [{ type: 'missing', message: 'CC.Cube is not loaded.', stickers: [] }] };

    // The RED and ORANGE faces are both shown with WHITE on top, so if the learner turned the cube
    // the other way round (ORANGE second, RED fourth) the two faces simply arrive in each other's
    // slot. The session normally sorts this out by comparing the two centres; this catches the rest.
    var swappedRL = false;
    if (Cube && !validation.ok && opts.swapCheck !== false) {
      var fr = FACES.indexOf('R'), fl = FACES.indexOf('L'), rgb2 = rgb.slice();
      for (var q = 0; q < 9; q++) { rgb2[fr * 9 + q] = rgb[fl * 9 + q]; rgb2[fl * 9 + q] = rgb[fr * 9 + q]; }
      var cl2 = clusterSamples(rgb2, opts), v2 = Cube.validate(cl2.letters);
      if (v2.ok) {
        cl = cl2; validation = v2; swappedRL = true;
        warnings.push('The RED and ORANGE faces looked swapped (the cube was probably turned the other way round), so they were swapped back automatically.');
      }
    }

    var labs = cl.labs, d2 = cl.d2;
    // per-sticker confidence: margin between the assigned colour and the nearest other colour
    function confidences(st) {
      return st.map(function (letter, i) {
        if (i % 9 === 4) return 1;
        var own = Math.sqrt(d2[i][colourIndex[letter]]), other = Infinity;
        for (var c = 0; c < 6; c++) if (COLORS[c] !== letter) other = Math.min(other, Math.sqrt(d2[i][c]));
        return clamp((other - own) / (other + own + 1e-9), 0, 1);
      });
    }
    var state = cl.letters.slice();
    var confidence = confidences(state);

    // repair if needed
    var repaired = false, changed = [], alsoCheck = [];
    if (Cube && !validation.ok && opts.repair !== false) {
      var fix = repairState(state, d2, confidence, movable, colourIndex, Cube);
      if (fix) {
        state = fix.state; changed = fix.indices; repaired = true; alsoCheck = fix.alsoCheck || [];
        validation = Cube.validate(state);
        confidence = confidences(state);
        changed.forEach(function (k) { confidence[k] = Math.min(confidence[k], 0.05); });
        if (fix.kind === 'rotate') {
          warnings.push('The ' + NAME[pinned[fix.face]] + ' face looks like it was held turned round, so it was straightened automatically. Check it on the net.');
          suspectSteps.push(STEP_OF_FACE[FACES[fix.face]]);
        } else {
          warnings.push('Some colours were hard to tell apart, so ' + fix.indices.length + ' stickers were corrected automatically to make a real cube. Please check the highlighted stickers.');
        }
      }
    }

    // did the learner show the wrong face? Only asked when the read is not a real cube (a
    // wrong face practically never gives a valid cube, while odd lighting can make a correct
    // centre look like its neighbour colour). Each centre (white-balanced and
    // exposure-corrected) is compared with the reference colours; a centre much nearer another
    // colour than its own is reported. Per-centre rather than a best permutation, because
    // showing the same face twice gives two identical centres, which a permutation can tie.
    var centreMismatch = [];
    if (!validation.ok) {
      for (var f3 = 0; f3 < 6; f3++) {
        var cen = labs[f3 * 9 + 4], exp = pinned[f3], near = exp, dNear = Infinity;
        COLORS.forEach(function (c) { var dc = dist2(cen, CANON_LAB[c]); if (dc < dNear) { dNear = dc; near = c; } });
        if (near !== exp && dist2(cen, CANON_LAB[exp]) - dNear > WRONG_FACE_MARGIN) {
          var step = STEP_OF_FACE[FACES[f3]];
          centreMismatch.push(step);
          if (suspectSteps.indexOf(step) === -1) suspectSteps.push(step);
          warnings.push('The face scanned as the ' + NAME[exp] + ' face has a centre that looks ' + NAME[near] +
            '. Was the wrong face shown, or is there glare on it? Rescan it with the ' + NAME[exp] + ' centre facing the camera.');
        }
      }
    }
    if (!validation.ok && !centreMismatch.length) {
      warnings.push('These colours do not make a real cube. Check the highlighted stickers, or rescan the faces in good, even light.');
    }

    // uncertain stickers: repaired ones first, then other stickers a similar-cost repair would
    // have changed, then the least confident, then (still not a real cube) the stickers of pieces
    // whose colours no real piece has (twist / flip / parity errors name every piece, so not those)
    var uncertain = changed.slice();
    function flag(k) { if (k % 9 !== 4 && uncertain.indexOf(k) === -1) uncertain.push(k); }
    alsoCheck.forEach(flag);
    movable.filter(function (k) { return confidence[k] < UNCERTAIN_CONF; })
      .sort(function (a, b) { return confidence[a] - confidence[b]; })
      .forEach(flag);
    if (!validation.ok) {
      validation.errors.forEach(function (e) {
        if (e.type === 'corner' || e.type === 'edge') (e.stickers || []).forEach(flag);
      });
    }

    return {
      state: state, confidence: confidence, uncertain: uncertain, validation: validation,
      warnings: warnings, repaired: repaired, swappedRedOrange: swappedRL,
      suspectSteps: suspectSteps.sort(function (a, b) { return a - b; }),
      lighting: { whiteBalance: cl.wb, faceGain: cl.gain, iterations: cl.iterations }
    };
  }

  // Cheapest small change that turns an invalid read into a real cube. First: one face held turned
  // round (a quarter or half turn of its grid). Then one pool, cheapest first, of: swapping two of
  // the 10 least-confident stickers, 3-cycles and two separate swaps among the 8 least confident
  // (one pool, so that when two pairs were misread the right double swap is not beaten by some
  // cheaper single swap that happens to give a valid cube). Swaps keep exactly 9 of each colour.
  // Other valid repairs that cost almost as much are reported too (alsoCheck), so their stickers
  // get highlighted: the learner is asked to check every sticker that is genuinely in doubt.
  function repairState(state, d2, confidence, movable, colourIndex, Cube) {
    var i, j, k, a, b, c, f, t;
    for (f = 0; f < 6; f++) {
      for (t = 1; t <= 3; t++) {
        var s2 = rotateFaceGrid(state, f, t);
        if (s2.join('') === state.join('')) continue;
        if (Cube.validate(s2).ok) {
          var idx = [];
          for (k = 0; k < 9; k++) if (s2[f * 9 + k] !== state[f * 9 + k]) idx.push(f * 9 + k);
          return { state: s2, indices: idx, kind: 'rotate', face: f, turns: t, cost: 0 };
        }
      }
    }

    var order = movable.slice().sort(function (x, y) { return confidence[x] - confidence[y]; });
    function delta(changes) {
      var sum = 0;
      changes.forEach(function (ch) { sum += d2[ch[0]][colourIndex[ch[1]]] - d2[ch[0]][colourIndex[state[ch[0]]]]; });
      return sum;
    }
    var cands = [], top = order.slice(0, 10);
    for (i = 0; i < top.length; i++) for (j = i + 1; j < top.length; j++) {
      a = top[i]; b = top[j];
      if (state[a] === state[b]) continue;
      var ch2 = [[a, state[b]], [b, state[a]]];
      cands.push({ changes: ch2, cost: delta(ch2) });
    }
    top = order.slice(0, 8);
    for (i = 0; i < top.length; i++) for (j = i + 1; j < top.length; j++) for (k = j + 1; k < top.length; k++) {
      a = top[i]; b = top[j]; c = top[k];
      if (state[a] === state[b] || state[b] === state[c] || state[a] === state[c]) continue;
      var cy1 = [[a, state[b]], [b, state[c]], [c, state[a]]], cy2 = [[a, state[c]], [b, state[a]], [c, state[b]]];
      cands.push({ changes: cy1, cost: delta(cy1) }, { changes: cy2, cost: delta(cy2) });
    }
    var pairs = [];
    for (i = 0; i < top.length; i++) for (j = i + 1; j < top.length; j++) if (state[top[i]] !== state[top[j]]) pairs.push([top[i], top[j]]);
    for (i = 0; i < pairs.length; i++) for (j = i + 1; j < pairs.length; j++) {
      var p = pairs[i], q = pairs[j];
      if (p[0] === q[0] || p[0] === q[1] || p[1] === q[0] || p[1] === q[1]) continue;
      var dd = [[p[0], state[p[1]]], [p[1], state[p[0]]], [q[0], state[q[1]]], [q[1], state[q[0]]]];
      cands.push({ changes: dd, cost: delta(dd) });
    }
    cands.sort(function (x, y) { return x.cost - y.cost; });
    var best = null, also = [];
    for (k = 0; k < cands.length; k++) {
      if (best && cands[k].cost > best.cost * 1.5 + 25) break;
      var st = state.slice();
      cands[k].changes.forEach(function (ch) { st[ch[0]] = ch[1]; });
      if (!Cube.validate(st).ok) continue;
      var ids = cands[k].changes.map(function (ch) { return ch[0]; });
      if (!best) best = { state: st, indices: ids, kind: 'swap', cost: cands[k].cost };
      else ids.forEach(function (x) { if (best.indices.indexOf(x) === -1 && also.indexOf(x) === -1) also.push(x); });
    }
    if (best) best.alsoCheck = also;
    return best;
  }

  // ------------------------------------------------------------------ live (per-frame) classification
  // References for the live guesses: the default palette at first; each captured centre then
  // gives the true look of that colour under the real lighting, and the captured centres
  // together give a per-channel cast that adjusts the colours not yet seen.
  // captured[step] = { rgb:[9], seen? } (seen = the colour the centre was classified as when captured).
  function liveRefs(captured) {
    captured = captured || [];
    // While only one of the RED / ORANGE steps is captured, that face may really be the other one
    // (the cube turned the other way round), so it calibrates the colour it looked like.
    var pending = !captured[1] !== !captured[3];
    var num = [0, 0, 0], den = [0, 0, 0], K = 0.08, lab = {}, calibrated = {};
    captured.forEach(function (cap, step) {
      if (!cap || !SCAN_ORDER[step]) return;
      var c = SCAN_ORDER[step].center;
      if (pending && PAIR[c] && cap.seen && PAIR[cap.seen]) c = cap.seen;
      if (lab[c]) return;
      var centreRGB = toRGB(cap.rgb[4]), obs = centreRGB.map(srgbToLin), can = CANON_LIN[c];
      for (var ch = 0; ch < 3; ch++) { num[ch] += obs[ch]; den[ch] += can[ch]; }
      lab[c] = rgbToLab(centreRGB);
      calibrated[c] = true;
    });
    var cast = [0, 1, 2].map(function (ch) { return clamp((num[ch] + K) / (den[ch] + K), 0.4, 2.5); });
    COLORS.forEach(function (c) {
      if (!lab[c]) {
        var v = CANON_LIN[c];
        lab[c] = linToLab(v[0] * cast[0], v[1] * cast[1], v[2] * cast[2]);
        calibrated[c] = false;
      }
    });
    return { lab: lab, calibrated: calibrated, cast: cast };
  }

  // -> { letter, confidence, dist:{letter: distance}, order:[letters, nearest first], plain }
  // Live guesses use the plain distance: the references here are rough (one captured centre per
  // colour, or a default colour adjusted by a guessed cast), and under a strong cast the plain
  // distance keeps white and yellow further apart. classifyCube, whose references are the measured
  // cluster means, uses the glare-robust classification distance instead.
  function classifyLab(lab, refs) {
    var d = {};
    COLORS.forEach(function (c) { d[c] = dist(lab, refs.lab[c]); });
    var order = COLORS.slice().sort(function (a, b) { return d[a] - d[b]; });
    var d1 = d[order[0]], d2v = d[order[1]];
    return { letter: order[0], confidence: clamp((d2v - d1) / (d2v + d1 + 1e-9), 0, 1), dist: d, order: order, plain: d1 };
  }

  // Classify one colour sample: classifyColour([r,g,b], refs?) -> { letter, confidence, dist, order, plain }
  function classifyColour(rgb, refs) { return classifyLab(rgbToLab(toRGB(rgb)), refs || liveRefs([])); }

  // ------------------------------------------------------------------ sampling (pure)
  function guideRect(w, h) {
    var size = GUIDE_FRAC * Math.min(w, h);
    return { x: (w - size) / 2, y: (h - size) / 2, size: size, cell: size / 3 };
  }

  function histMedian(hist, n) {
    var half = n / 2, acc = 0;
    for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= half) return v; }
    return 255;
  }

  function histPercentile(hist, n, q) {
    var want = q * n, acc = 0;
    for (var v = 0; v < hist.length; v++) { acc += hist[v]; if (acc > want) return v; }
    return hist.length - 1;
  }

  /* sampleCells({data, width, height}) -> 9 cells in RAW frame order (row-major):
   *   { rgb:[r,g,b] per-channel median, std: luminance std-dev, mean: luminance, at:[x, y] cell centre (px) }
   * Each cell is read from its central 50% (each way). Before the median, two kinds of pixel that
   * are not the sticker's own colour are dropped: much darker ones (the black gaps and body, when
   * the cube is held a little off the guide) and, on a coloured sticker, bright washed-out ones
   * (glare). std and mean describe the pixels kept. The array also carries .grid = how many of the
   * 12 borders between neighbouring cells show a dark seam (a real cube shows its black gaps; a
   * wall, a shirt or a sheet of paper does not). */
  function sampleCells(img) {
    var w = img.width, h = img.height, data = img.data, g = guideRect(w, h), cells = [];
    var half = g.cell * SAMPLE_FRAC / 2, maxN = (Math.ceil(2 * half) + 2) * (Math.ceil(2 * half) + 2);
    var bufL = new Uint8Array(maxN), bufS = new Uint8Array(maxN), bufO = new Uint32Array(maxN);
    var hL = new Uint32Array(256), hS = new Uint32Array(101), hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var cx = g.x + (c + 0.5) * g.cell, cy = g.y + (r + 0.5) * g.cell;
        var x0 = Math.max(0, Math.round(cx - half)), x1 = Math.min(w, Math.round(cx + half));
        var y0 = Math.max(0, Math.round(cy - half)), y1 = Math.min(h, Math.round(cy + half));
        var n = 0, x, y, k, o;
        hL.fill(0);
        for (y = y0; y < y1; y++) {
          o = (y * w + x0) * 4;
          for (x = x0; x < x1; x++, o += 4) {
            var R = data[o], G = data[o + 1], B = data[o + 2];
            var mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
            var L = Math.round(0.299 * R + 0.587 * G + 0.114 * B);
            bufL[n] = L; bufS[n] = mx ? Math.round(100 * (mx - mn) / mx) : 0; bufO[n] = o; hL[L]++; n++;
          }
        }
        if (!n) { cells.push({ rgb: [0, 0, 0], std: 999, mean: 0, at: [cx, cy] }); continue; }
        // dark: below 45% of the cell's 60th-percentile luminance (a percentile that glare covering part of
        // the cell cannot push up, unlike the brightest pixels)
        var darkCut = DARK_CUT * histPercentile(hL, n, 0.6), m = 0;
        hL.fill(0); hS.fill(0);
        for (k = 0; k < n; k++) if (bufL[k] >= darkCut) { hL[bufL[k]]++; hS[bufS[k]]++; m++; }
        // glare: on a clearly coloured sticker, brighter than the median and far less saturated
        var sMed = m ? histPercentile(hS, m, 0.5) : 0, lMed = m ? histPercentile(hL, m, 0.5) : 0;
        var glareOn = sMed > 45, satCut = GLARE_SAT * sMed;
        for (var pass = 0; pass < 2; pass++) {
          hr.fill(0); hg.fill(0); hb.fill(0);
          var kept = 0, sl = 0, sl2 = 0;
          for (k = 0; k < n; k++) {
            var Lk = bufL[k];
            if (!pass && (Lk < darkCut || (glareOn && Lk > lMed && bufS[k] < satCut))) continue;
            o = bufO[k]; hr[data[o]]++; hg[data[o + 1]]++; hb[data[o + 2]]++;
            sl += Lk; sl2 += Lk * Lk; kept++;
          }
          if (kept >= 0.25 * n) break;   // too little left: fall back to every pixel
        }
        var mean = sl / kept;
        cells.push({
          rgb: [histMedian(hr, kept), histMedian(hg, kept), histMedian(hb, kept)],
          std: Math.sqrt(Math.max(0, sl2 / kept - mean * mean)), mean: mean, at: [cx, cy]
        });
      }
    }

    // dark seams: luminance profile from one cell centre to its neighbour's, averaged across a narrow
    // band (narrow so that a slightly tilted 1-pixel seam is not smeared away; the averaging already
    // keeps sensor noise far below the dip a seam makes, so the profile is not smoothed further)
    var band = Math.max(1, Math.round(g.cell * 0.08)), seams = 0;
    function seam(a, b, horizontal) {
      var A = cells[a], B = cells[b], n0 = horizontal ? A.at[0] : A.at[1], n1 = horizontal ? B.at[0] : B.at[1];
      var across = horizontal ? (A.at[1] + B.at[1]) / 2 : (A.at[0] + B.at[0]) / 2, prof = [];
      for (var t = Math.round(n0); t <= Math.round(n1); t++) {
        var sum = 0, n = 0;
        for (var q = Math.round(across) - band; q <= Math.round(across) + band; q++) {
          var x = horizontal ? t : q, y = horizontal ? q : t;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          var o = (y * w + x) * 4;
          sum += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; n++;
        }
        if (n) prof.push(sum / n);
      }
      var lo = Infinity;
      for (var k = 0; k < prof.length; k++) lo = Math.min(lo, prof[k]);
      var ref = Math.min(A.mean, B.mean);
      return lo < Infinity && ref > 8 && 1 - lo / ref >= GAP_DIP;
    }
    for (var rr = 0; rr < 3; rr++) {
      for (var cc = 0; cc < 3; cc++) {
        if (cc < 2 && seam(rr * 3 + cc, rr * 3 + cc + 1, true)) seams++;
        if (rr < 2 && seam(rr * 3 + cc, rr * 3 + cc + 3, false)) seams++;
      }
    }
    cells.grid = seams;
    return cells;
  }

  // ------------------------------------------------------------------ auto-capture session (pure)
  /* createSession({autoCapture}) — the scanning state machine, no DOM. Feed it the 9 sampled cells
   * every frame: frame(cells, nowMs) -> { info, event } where event is null or
   * { type:'capture', step, letters:[9], updates:[{step, letters}], result:null|classifyCube result (after the 6th face) }.
   * updates lists every step whose colours changed: normally just this one, but when the RED and
   * ORANGE faces turn out to have come in the other order (the cube was turned the other way round)
   * they are swapped and both are listed.
   * RED and ORANGE are hard to tell apart by colour alone under unknown light, so the RED step and
   * the ORANGE step each accept either; once both are in, the redder centre (lower green/red ratio,
   * which no colour cast or exposure change can reverse) is RED. */
  function createSession(opts) {
    opts = opts || {};
    var S = {
      step: 0, captured: [null, null, null, null, null, null], auto: opts.autoCapture !== false,
      armed: true, anchor: null, stableSince: 0, last: null, lastCap: null, refs: null, result: null
    };
    function refs() { if (!S.refs) S.refs = liveRefs(S.captured); return S.refs; }
    function nextStep() { for (var i = 0; i < 6; i++) if (!S.captured[i]) return i; return 6; }

    function analyse(cells) {
      var R = refs();
      var rgbs = cells.map(function (c) { return toRGB(c.rgb || c); });
      var labs = rgbs.map(function (p) { return rgbToLab(p); });
      var cls = labs.map(function (l) { return classifyLab(l, R); });
      var uniform = cells.map(function (c) { return c.std == null || c.std <= UNIFORM_STD; });
      var plausible = cls.map(function (k) { return k.plain <= PLAUSIBLE_D; });
      var bright = 0, counts = {}, most = 0;
      cells.forEach(function (c, k) { bright += (c.mean != null ? c.mean : labs[k][0] * 2.55) / 9; });
      cls.forEach(function (k) { counts[k.letter] = (counts[k.letter] || 0) + 1; most = Math.max(most, counts[k.letter]); });
      // (almost) one colour everywhere and no dark seams: a wall, a shirt or a sheet of paper, not a cube face
      var flat = cells.grid != null && most >= 8 && cells.grid < MIN_GRID;
      return {
        cells: cells, rgbs: rgbs, labs: labs, cls: cls, chroma: chromaOf(rgbs[4]), uniform: uniform, plausible: plausible,
        brightness: bright, flat: flat,
        nUniform: uniform.filter(Boolean).length, nPlausible: plausible.filter(Boolean).length
      };
    }

    function acceptable(step) {
      var exp = SCAN_ORDER[step].center;
      return PAIR[exp] ? [exp, PAIR[exp]] : [exp];
    }

    function centreCheck(a) {
      if (S.step >= 6) return { ok: false, sameAs: null };
      var exp = SCAN_ORDER[S.step].center, k = a.cls[4], sameAs = null, accept = acceptable(S.step);
      // the same face again? Compared by chromaticity, which exposure changes cannot fool
      S.captured.forEach(function (cap, j) {
        if (cap && sameAs === null && chromaDist(a.chroma, cap.chroma) < CHROMA_SAME) sameAs = cap.seen || SCAN_ORDER[j].center;
      });
      var best = k.letter, second = k.order[1];
      var matches = accept.indexOf(best) !== -1;
      // the expected colour as a close second: the references are not calibrated for this light yet
      // (the expected colour has, by definition, not been captured), so a near tie is accepted
      var unsure = !matches && accept.indexOf(second) !== -1 && k.dist[second] - k.dist[best] < UNSURE_GAP;
      return { ok: sameAs === null && (matches || unsure), sameAs: sameAs, matches: matches, unsure: unsure, expected: exp };
    }

    function message(a, cc, stability) {
      if (S.step >= 6) return 'All six faces scanned.';
      var exp = SCAN_ORDER[S.step];
      if (a.brightness < 35) return 'It is too dark. Turn on a light or face a window.';
      // Right after a capture, say so; if the same face is still showing ~1.5 s later, fall through
      // to the centre check, which tells the learner which face to show instead.
      if (!S.armed && (!S.lastCap || S.clock - S.lastCap.at < 1500)) return 'Got it. Now turn to the next face.';
      if (a.nPlausible < 5 || a.flat) return exp.say + ', filling the square.';
      if (a.nUniform < 8) return 'Hold still. If there is glare, tilt the cube slightly.';
      if (!cc.ok) {
        if (cc.sameAs) return 'You already scanned the ' + NAME[cc.sameAs] + ' face. ' + exp.say + '.';
        return 'That centre looks ' + NAME[a.cls[4].letter] + '. ' + exp.say + '.';
      }
      if (a.nPlausible < 7) return 'Line the stickers up with the squares.';
      if (!S.auto) return 'Looks good. Press Capture.';
      return stability < 1 ? 'Hold still...' : 'Captured!';
    }

    // When both the RED and the ORANGE step are captured, make sure the redder centre is in the RED slot.
    function resolvePair() {
      var a = S.captured[1], b = S.captured[3];
      if (!a || !b || a.chroma[0] <= b.chroma[0]) return false;
      S.captured[1] = b; S.captured[3] = a;
      b.letters[4] = SCAN_ORDER[1].center; a.letters[4] = SCAN_ORDER[3].center;
      return true;
    }

    function capture(a, now) {
      var step = S.step;
      if (step >= 6 || !a) return null;
      var letters = a.cls.map(function (k) { return k.letter; });
      letters[4] = SCAN_ORDER[step].center;
      var accept = acceptable(step), seen = a.cls[4].letter;
      S.captured[step] = {
        rgb: a.rgbs.slice(), labs: a.labs, chroma: a.chroma, letters: letters,
        seen: accept.indexOf(seen) !== -1 ? seen : SCAN_ORDER[step].center,
        confidence: a.cls.map(function (k) { return k.confidence; }), at: now
      };
      S.lastCap = S.captured[step];
      S.armed = false; S.refs = null; S.result = null;
      var updates = [{ step: step, letters: null }];
      if (PAIR[SCAN_ORDER[step].center] && resolvePair()) updates.push({ step: step === 1 ? 3 : 1, letters: null });
      updates.forEach(function (u) { u.letters = S.captured[u.step].letters.slice(); });
      S.step = nextStep();
      if (S.step >= 6) {
        try { S.result = classifyCube(faces()); } catch (e) { S.result = null; if (typeof console !== 'undefined') console.error(e); }
      }
      return { type: 'capture', step: step, letters: updates[0].letters, updates: updates, swapped: updates.length > 1, result: S.result };
    }

    function faces() {
      var out = {};
      SCAN_ORDER.forEach(function (e, i) { out[e.face] = S.captured[i] ? S.captured[i].rgb : null; });
      return out;
    }

    function makeInfo(a, cc, stability) {
      return {
        step: S.step, expected: SCAN_ORDER[S.step] || null,
        live: a.cls.map(function (k) { return k.letter; }),
        confidence: a.cls.map(function (k) { return k.confidence; }),
        centerMatches: !!cc.ok, seenCenter: a.cls[4].letter, stability: stability,
        captured: S.captured.map(function (c) { return !!c; }),
        ready: isReady(a, cc),
        armed: S.armed, autoCapture: S.auto, complete: S.step >= 6,
        uniform: a.uniform, brightness: a.brightness, looksLikeCube: !a.flat, message: message(a, cc, stability)
      };
    }

    function isReady(a, cc) { return S.step < 6 && a.nUniform >= 8 && a.nPlausible >= 7 && !a.flat && !!cc.ok; }

    function frame(cells, now) {
      S.clock = now;
      var a = analyse(cells);
      S.last = a;
      if (!S.anchor) { S.anchor = a.labs; S.stableSince = now; }
      else {
        var maxd = 0;
        for (var k = 0; k < 9; k++) maxd = Math.max(maxd, dist(a.labs[k], S.anchor[k]));
        if (maxd > STABLE_TOL) { S.anchor = a.labs; S.stableSince = now; }
      }
      var stability = clamp((now - S.stableSince) / STABLE_MS, 0, 1);
      // after a capture, wait for a big change (or a different centre) before arming again
      if (!S.armed && S.lastCap) {
        var md = 0;
        for (var j = 0; j < 9; j++) md += dist(a.labs[j], S.lastCap.labs[j]) / 9;
        if (md > REARM_D || dist(a.labs[4], S.lastCap.labs[4]) > DISTINCT_D || a.nPlausible < 5) S.armed = true;
      }
      var cc = centreCheck(a), event = null;
      if (S.auto && S.armed && isReady(a, cc) && stability >= 1) {
        event = capture(a, now);
        cc = centreCheck(a);
      }
      return { info: makeInfo(a, cc, stability), event: event };
    }

    return {
      frame: frame,
      captureNow: function (now) { return capture(S.last, now == null ? 0 : now); },
      redo: function (step) {
        step = Math.floor(step);
        if (!(step >= 0 && step < 6)) return false;
        S.captured[step] = null; S.step = step; S.armed = true; S.refs = null; S.result = null;
        S.anchor = null;               // a fresh, steady hold is needed: never re-capture on the very next frame
        return true;
      },
      reset: function () {
        S.step = 0; S.captured = [null, null, null, null, null, null]; S.armed = true;
        S.anchor = null; S.lastCap = null; S.refs = null; S.result = null;
      },
      setAutoCapture: function (b) { S.auto = !!b; },
      result: function () { return S.result; },
      faces: faces,
      get step() { return S.step; },
      get captured() { return S.captured.map(function (c) { return !!c; }); }
    };
  }

  // ------------------------------------------------------------------ camera support
  var CAMERA_MESSAGES = {
    denied: 'The camera is blocked for this page. In Chrome: click the camera (or padlock) icon in the address bar, choose Allow, then reload the page. ' +
      'In Safari: open the Safari menu > Settings for This Website > Camera > Allow. Still blocked? Open Apple menu > System Settings > ' +
      'Privacy & Security > Camera, switch your browser on, then quit and reopen the browser.',
    notfound: 'No camera was found. Check that the camera is connected and not covered, or pick another camera. You can also use the on-screen virtual cube.',
    insecure: 'The camera only works when Cube Coach is opened from http://localhost:8765, not straight from the file (file://). ' +
      'Double-click "Start Cube Coach.command" (or run python3 -m http.server 8765 in the cube-coach folder) and open http://localhost:8765.',
    unsupported: 'This browser cannot use the camera. Use a recent Chrome, Safari, Edge or Firefox, or use the on-screen virtual cube.',
    busy: 'The camera is being used by another app (FaceTime, Zoom, Teams, Photo Booth) or another browser tab. Close it, then try again.',
    other: 'The camera could not start. Reload the page and try again, or pick another camera.',
    ended: 'The camera stopped sending pictures. Check that it is still connected and that no other app (FaceTime, Zoom, Teams) has taken it, then start the camera again.'
  };

  function pageIsInsecure() {
    if (typeof window === 'undefined') return false;
    if (window.location && window.location.protocol === 'file:') return true;
    return window.isSecureContext === false;
  }

  function isSupported() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return { ok: false, code: 'unsupported', reason: CAMERA_MESSAGES.unsupported };
    var gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    if (window.isSecureContext === false || (!gum && pageIsInsecure())) return { ok: false, code: 'insecure', reason: CAMERA_MESSAGES.insecure };
    if (!gum) return { ok: false, code: 'unsupported', reason: CAMERA_MESSAGES.unsupported };
    return { ok: true, code: null, reason: '' };
  }

  // Map a getUserMedia error to { code, message, name }.
  function mapCameraError(e) {
    var name = String((e && (e.name || e.code)) || '');
    var code;
    if (/NotAllowed|PermissionDenied|Security/i.test(name)) code = pageIsInsecure() ? 'insecure' : 'denied';
    else if (/NotFound|DevicesNotFound|Overconstrained|ConstraintNotSatisfied/i.test(name)) code = 'notfound';
    else if (/NotReadable|TrackStart|DeviceInUse|Abort/i.test(name)) code = 'busy';
    else if (/NotSupported/i.test(name)) code = 'unsupported';
    else code = 'other';
    var msg = CAMERA_MESSAGES[code];
    if (code === 'other' && e && e.message) msg += ' (' + e.message + ')';
    return { code: code, message: msg, name: name };
  }

  function listCameras() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      return list.filter(function (d) { return d.kind === 'videoinput'; })
        .map(function (d, i) { return { deviceId: d.deviceId, label: d.label || ('Camera ' + (i + 1)) }; });
    }, function () { return []; });
  }

  // ------------------------------------------------------------------ drawing helpers (DOM, call-time only)
  function hexFor(letter) {
    var Cube = CubeLib();
    return (Cube && Cube.COLOR_HEX && Cube.COLOR_HEX[letter]) || FALLBACK_HEX[letter] || '#888';
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Overlay drawn on top of the (possibly mirrored) video frame.
  function drawOverlay(ctx, W, H, info, o) {
    var g = guideRect(W, H), rad = g.cell * 0.14, now = o.now;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // dimmed surround
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    roundRectPath(ctx, g.x, g.y, g.size, g.size, rad);
    ctx.fill('evenodd');
    // cells: outline + small swatch of the live guess (no guesses on a dark or cube-less frame)
    var showGuess = !(info && (info.brightness < 35 || info.looksLikeCube === false));
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 3; col++) {
        var k = row * 3 + col, dc = o.mirror ? 2 - col : col;
        var x = g.x + dc * g.cell, y = g.y + row * g.cell, pad = g.cell * 0.06;
        var letter = showGuess && info && info.live ? info.live[k] : null, conf = info && info.confidence ? info.confidence[k] : 0;
        ctx.beginPath();
        roundRectPath(ctx, x + pad, y + pad, g.cell - 2 * pad, g.cell - 2 * pad, rad * 0.8);
        ctx.lineWidth = Math.max(1.5, g.cell * 0.025);
        ctx.strokeStyle = letter ? hexFor(letter) : 'rgba(255,255,255,0.6)';
        ctx.globalAlpha = letter ? 0.5 + 0.5 * conf : 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (letter) {
          var s = g.cell * 0.24, cx = x + g.cell / 2, cy = y + g.cell / 2;
          ctx.beginPath();
          roundRectPath(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.22);
          ctx.fillStyle = hexFor(letter);
          ctx.globalAlpha = 0.55 + 0.45 * conf;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = Math.max(1, g.cell * 0.015);
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.stroke();
        }
      }
    }
    // outer guide + pulsing progress ring while "stable" builds up
    ctx.beginPath();
    roundRectPath(ctx, g.x, g.y, g.size, g.size, rad);
    ctx.lineWidth = Math.max(2, g.size * 0.008);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    var prog = info && info.ready && info.armed ? info.stability : 0;
    if (prog > 0) {
      var pulse = 0.5 + 0.5 * Math.sin(now / 110), inset = -g.size * 0.025;
      var x0 = g.x + inset, s0 = g.size - 2 * inset, r0 = rad - inset;
      var perim = 4 * (s0 - 2 * r0) + 2 * Math.PI * r0;
      ctx.beginPath();
      roundRectPath(ctx, x0, g.y + inset, s0, s0, r0);
      ctx.setLineDash([perim * prog, perim]);
      ctx.lineWidth = g.size * (0.012 + 0.01 * pulse);
      ctx.strokeStyle = info.expected ? hexFor(info.expected.center) : '#4ade80';
      ctx.shadowColor = 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 6 + 10 * pulse;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
    // capture flash
    var ft = now - o.flashAt;
    if (ft >= 0 && ft < 450) {
      ctx.beginPath();
      roundRectPath(ctx, g.x, g.y, g.size, g.size, rad);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.75 * (1 - ft / 450)).toFixed(3) + ')';
      ctx.fill();
    }
    // tiny HUD: step and the centre colour wanted
    if (o.hud && info && info.expected) {
      var fs = Math.max(12, Math.round(H * 0.032));
      ctx.font = '600 ' + fs + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
      var label = (info.step + 1) + '/6  ' + NAME[info.expected.center] + ' centre, ' + NAME[info.expected.up] + ' on top';
      var tw = ctx.measureText(label).width, ph = fs * 1.7, px = g.x, py = Math.max(4, g.y - ph - fs * 0.5);
      ctx.beginPath();
      roundRectPath(ctx, px, py, tw + fs * 2.6, ph, ph / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + fs * 0.95, py + ph / 2, fs * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = hexFor(info.expected.center);
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px + fs * 1.8, py + ph / 2);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ controller (DOM)
  function createController(opts) {
    opts = opts || {};
    var canvas = opts.canvas || null, ctx = canvas ? canvas.getContext('2d') : null;
    var mirror = opts.mirror !== false;
    var session = createSession({ autoCapture: opts.autoCapture !== false });
    var maxWidth = opts.maxWidth || 1280;
    var video = null, stream = null, ownStream = false, raf = 0, running = false, token = 0;
    var sCanvas = null, sCtx = null, flashAt = -1e9, lastInfo = null;

    function emit(name, a, b) {
      if (typeof opts[name] !== 'function') return;
      try { opts[name](a, b); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    }
    function fail(err) { emit('onError', err); return Promise.reject(err); }
    function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }

    function ensureVideo() {
      if (video) return video;
      video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.muted = true;
      video.autoplay = true;
      // kept in the document (some browsers will not decode a detached video) but invisible
      video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
      (document.body || document.documentElement).appendChild(video);
      return video;
    }

    function stopStream() {
      if (stream && ownStream && stream.getTracks) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
      stream = null; ownStream = false;
    }

    // settles the promise of an attach() still waiting for its first frame (stop() or a new stream)
    var pending = null;
    function settlePending() { if (pending) pending(null); }

    // a camera that is unplugged or taken over by another app ends its track: say so
    function watchTracks(st, my) {
      if (!st || !st.getVideoTracks) return;
      st.getVideoTracks().forEach(function (t) {
        if (!t || !t.addEventListener) return;
        t.addEventListener('ended', function () {
          if (my !== token) return;   // stop() does not fire 'ended', but a replaced stream might
          emit('onError', { code: 'notfound', name: 'Ended', message: CAMERA_MESSAGES.ended });
        });
      });
    }

    function attach(st, own) {
      stopStream();
      settlePending();
      stream = st; ownStream = own;
      var v = ensureVideo(), my = ++token;
      v.srcObject = st;
      watchTracks(st, my);
      startLoop();
      return new Promise(function (resolve, reject) {
        var timer = 0;
        function finish(err) {
          if (pending !== finish) return;
          pending = null;
          clearTimeout(timer);
          v.removeEventListener('loadeddata', onData);
          if (err) { emit('onError', err); reject(err); } else resolve();
        }
        function onData() { if (my === token) finish(null); }
        pending = finish;
        v.addEventListener('loadeddata', onData);
        if (v.readyState >= 2) finish(null);
        var pp = v.play();
        if (pp && pp.then) pp.then(onData, function () { /* loadeddata or the timeout decides */ });
        timer = setTimeout(function () {
          finish({ code: 'busy', message: 'The camera is on but no picture is arriving. ' + CAMERA_MESSAGES.busy, name: 'Timeout' });
        }, opts.startTimeout || 10000);
      });
    }

    function start(deviceId) {
      var sup = isSupported();
      if (!sup.ok) return fail({ code: sup.code, message: sup.reason, name: 'Unsupported' });
      var v = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
      if (deviceId) { v.deviceId = { exact: deviceId }; delete v.facingMode; }
      var my = ++token;
      return navigator.mediaDevices.getUserMedia({ video: v, audio: false }).then(function (st) {
        if (my !== token) { st.getTracks().forEach(function (t) { t.stop(); }); return; } // stop() was called meanwhile
        return attach(st, true);
      }, function (e) {
        if (my !== token) return;   // stopped (or restarted) meanwhile: nobody is waiting for this error
        return fail(mapCameraError(e));
      });
    }

    function stop() {
      token++;
      settlePending();
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stopStream();
      if (video) {
        try { video.pause(); } catch (e) { /* ignore */ }
        video.srcObject = null;
        if (video.parentNode) video.parentNode.removeChild(video);
        video = null;
      }
    }

    function startLoop() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }
    function loop() {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      try { tick(now()); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    }

    function drawWaiting() {
      if (!ctx) return;
      var W = canvas.width || 640, H = canvas.height || 360;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '500 ' + Math.max(12, Math.round(H * 0.045)) + 'px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for the camera...', W / 2, H / 2);
      ctx.restore();
    }

    function handleEvent(ev, t) {
      flashAt = t;
      // normally one update; two when the RED and ORANGE faces turned out to be the other way round
      (ev.updates || [{ step: ev.step, letters: ev.letters }]).forEach(function (u) { emit('onCapture', u.step, u.letters); });
      if (ev.result) emit('onComplete', ev.result);
    }

    function tick(t) {
      if (!video || video.readyState < 2 || !video.videoWidth) { drawWaiting(); return; }
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!sCanvas) {
        sCanvas = document.createElement('canvas');
        sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
      }
      var sw = SAMPLE_WIDTH, sh = Math.max(1, Math.round(sw * vh / vw));
      if (sCanvas.width !== sw || sCanvas.height !== sh) { sCanvas.width = sw; sCanvas.height = sh; }
      sCtx.drawImage(video, 0, 0, sw, sh);              // RAW frame, never mirrored
      var cells = sampleCells(sCtx.getImageData(0, 0, sw, sh));
      var out = session.frame(cells, t);
      lastInfo = out.info;
      if (out.event) handleEvent(out.event, t);
      if (ctx) {
        var cw = Math.min(vw, maxWidth), chh = Math.round(cw * vh / vw);
        if (canvas.width !== cw || canvas.height !== chh) { canvas.width = cw; canvas.height = chh; }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, 0, 0, cw, chh);
        ctx.restore();
        drawOverlay(ctx, cw, chh, out.info, { mirror: mirror, now: t, flashAt: flashAt, hud: opts.hud !== false });
      }
      emit('onFrame', out.info);
    }

    return {
      start: start,
      stop: stop,
      useStream: function (st) {
        if (!st) return fail({ code: 'notfound', message: CAMERA_MESSAGES.notfound, name: 'NoStream' });
        return attach(st, false);
      },
      captureNow: function () {
        var t = now(), ev = session.captureNow(t);
        if (ev) handleEvent(ev, t);
        return !!ev;
      },
      redo: function (step) { return session.redo(step); },
      reset: function () { session.reset(); },
      setMirror: function (b) { mirror = !!b; },
      setAutoCapture: function (b) { session.setAutoCapture(!!b); },
      listCameras: listCameras,
      getInfo: function () { return lastInfo; },
      getResult: function () { return session.result(); },
      session: session
    };
  }

  // ------------------------------------------------------------------ fake camera (DOM)
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* createFakeCamera(state, opts?) -> { stream, canvas, showFace(step), current(), hideCube(bool), set(opts), setState(state), destroy() }
   * A 1280x720 synthetic webcam (canvas.captureStream(30)) showing a person holding the cube with
   * SCAN_ORDER[step]'s face toward the camera, drawn UNMIRRORED like a real camera frame.
   * state is in the standard scan frame (white top, green front).
   * opts: { cast: number (>0 warm/tungsten, <0 cool) | [r,g,b] multipliers, exposure: 1, noise: 1,
   *         glare: 1, jitter: 1, face: 0, seed, palette: {W:[r,g,b],...} } */
  function createFakeCamera(state, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') throw new Error('createFakeCamera needs a browser');
    var Cube = CubeLib();
    var W = 1280, H = 720, TRANS_MS = 800;
    state = (state || (Cube ? Cube.solved() : null)).slice();
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var P = { cast: 0, exposure: 1, noise: 1, glare: 1, jitter: 1, palette: DEFAULT_RGB };
    function setParams(o) {
      ['cast', 'exposure', 'noise', 'glare', 'jitter', 'palette'].forEach(function (k) { if (o && o[k] != null) P[k] = o[k]; });
    }
    setParams(opts);
    var rnd = rng(opts.seed || 20261002);
    var cur = clamp(Math.floor(opts.face || 0), 0, 5), prev = null, t0 = -1e9, dir = 1, kind = 'h', hidden = false;
    var stickerVar = [], i;
    for (i = 0; i < 54; i++) stickerVar.push(0.94 + 0.12 * rnd());
    var stepGain = [1.0, 1.07, 0.94, 1.04, 1.09, 0.92];       // auto-exposure differs a little per face
    var glareSpots = SCAN_ORDER.map(function () {
      return { k: Math.floor(rnd() * 9), dx: (rnd() < 0.5 ? -1 : 1) * (0.2 + 0.1 * rnd()), dy: (rnd() < 0.5 ? -1 : 1) * (0.2 + 0.1 * rnd()) };
    });

    // the 3 stickers of the top face visible as a thin strip above the shown face
    var topRow = SCAN_ORDER.map(function (e) {
      if (!Cube) return [null, null, null];
      var faceOfColour = {};
      Object.keys(Cube.SCHEME).forEach(function (f) { faceOfColour[Cube.SCHEME[f]] = f; });
      var n = Cube.NORMAL[e.face], u = Cube.NORMAL[faceOfColour[e.up]];
      var r = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
      var upFace = faceOfColour[e.up], out = [];
      for (var k = 0; k < 3; k++) {
        var x = k - 1, cub = [x * r[0] + u[0] + n[0], x * r[1] + u[1] + n[1], x * r[2] + u[2] + n[2]];
        var hit = null;
        Cube.STICKERS.forEach(function (s) { if (s.face === upFace && s.cubie[0] === cub[0] && s.cubie[1] === cub[1] && s.cubie[2] === cub[2]) hit = s.index; });
        out.push(hit);
      }
      return out;
    });

    function castMul() {
      if (Array.isArray(P.cast)) return P.cast;
      var w = +P.cast || 0;
      return [1 + 0.12 * w, 1 + 0.01 * w, 1 - 0.30 * w];
    }
    function tone(rgb, gain) {
      var m = castMul(), e = (+P.exposure || 1) * (gain == null ? 1 : gain);
      return [0, 1, 2].map(function (ch) { return Math.round(linToSrgb(srgbToLin(rgb[ch]) * m[ch] * e)); });
    }
    function css(rgb, gain, alpha) {
      var t = tone(rgb, gain);
      return alpha == null ? 'rgb(' + t.join(',') + ')' : 'rgba(' + t.join(',') + ',' + alpha + ')';
    }

    function makeNoiseTile() {
      var c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      var x = c.getContext('2d'), img = x.createImageData(256, 256), r2 = rng(99);
      for (var k = 0; k < img.data.length; k += 4) {
        var v = 128 + (r2() + r2() + r2() - 1.5) * 70;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = clamp(Math.round(v), 0, 255);
        img.data[k + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      return c;
    }
    var noiseTile = makeNoiseTile(), noisePattern = ctx.createPattern(noiseTile, 'repeat');

    var bg = null;
    function renderBackground() {
      bg = document.createElement('canvas');
      bg.width = W; bg.height = H;
      var b = bg.getContext('2d');
      var grad = b.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, css([96, 90, 84]));
      grad.addColorStop(1, css([146, 134, 118]));
      b.fillStyle = grad;
      b.fillRect(0, 0, W, H);
      var win = b.createRadialGradient(W * 0.86, H * 0.08, 10, W * 0.86, H * 0.08, W * 0.5);
      win.addColorStop(0, css([252, 248, 236], 1, 0.8));
      win.addColorStop(1, css([252, 248, 236], 1, 0));
      b.fillStyle = win;
      b.fillRect(0, 0, W, H);
      // a bookshelf on the left
      b.fillStyle = css([70, 52, 40]);
      b.fillRect(40, 70, 210, 520);
      var books = [[150, 60, 50], [60, 90, 120], [180, 150, 90], [80, 110, 70], [120, 70, 110], [200, 190, 170]];
      for (var row = 0; row < 3; row++) {
        var x = 52;
        for (var k = 0; x < 236; k++) {
          var bw = 14 + ((row * 7 + k * 5) % 13), bh = 120 - ((k * 11 + row * 3) % 30);
          b.fillStyle = css(books[(k + row * 2) % books.length], 0.8);
          b.fillRect(x, 80 + row * 170 + (150 - bh), bw, bh);
          x += bw + 2;
        }
        b.fillStyle = css([56, 40, 30]);
        b.fillRect(40, 80 + row * 170 + 150, 210, 14);
      }
      // the learner, behind the cube
      b.fillStyle = css([58, 76, 104]);
      b.beginPath(); b.ellipse(W * 0.5, H * 1.08, W * 0.33, H * 0.42, 0, 0, Math.PI * 2); b.fill();
      b.fillStyle = css([196, 152, 124]);
      b.beginPath(); b.ellipse(W * 0.5, H * 0.38, 150, 190, 0, 0, Math.PI * 2); b.fill();
      var shade = b.createRadialGradient(W * 0.46, H * 0.3, 20, W * 0.5, H * 0.38, 200);
      shade.addColorStop(0, 'rgba(255,255,255,0.10)');
      shade.addColorStop(1, 'rgba(0,0,0,0.18)');
      b.fillStyle = shade;
      b.beginPath(); b.ellipse(W * 0.5, H * 0.38, 150, 190, 0, 0, Math.PI * 2); b.fill();
      b.fillStyle = css([50, 36, 28]);
      b.beginPath(); b.ellipse(W * 0.5, H * 0.17, 160, 95, 0, Math.PI, Math.PI * 2); b.fill();
      // static sensor pattern + vignette
      b.globalAlpha = 0.12;
      b.globalCompositeOperation = 'overlay';
      b.fillStyle = b.createPattern(noiseTile, 'repeat');
      b.fillRect(0, 0, W, H);
      b.globalAlpha = 1;
      b.globalCompositeOperation = 'source-over';
      var vig = b.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      b.fillStyle = vig;
      b.fillRect(0, 0, W, H);
    }
    renderBackground();

    var faceSize = GUIDE_FRAC * Math.min(W, H);
    function holdPose(t) {
      var s = t / 1000, j = +P.jitter;
      return {
        x: W / 2 + j * (7 * Math.sin(s * 0.61) + 3 * Math.sin(s * 1.9 + 1) + (rnd() - 0.5) * 2.4),
        y: H / 2 + j * (6 * Math.sin(s * 0.47 + 2) + 2.5 * Math.sin(s * 2.3) + (rnd() - 0.5) * 2.4),
        rot: j * (0.022 * Math.sin(s * 0.37) + 0.006 * Math.sin(s * 2.9)),
        skewX: j * 0.018 * Math.sin(s * 0.29 + 0.5),
        skewY: j * 0.014 * Math.sin(s * 0.33 + 1.2)
      };
    }

    function rr(x, y, w, h, r) { ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); }

    function drawHands(pose) {
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.rot);
      var half = faceSize / 2;
      [-1, 1].forEach(function (side) {
        ctx.fillStyle = css([204, 160, 132]);
        rr(side > 0 ? half - 6 : -half - 104, -70, 110, 260, 48);
        ctx.fill();
        ctx.fillStyle = css([178, 132, 106]);
        for (var k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(side * (half + 22), -50 + k * 50, 28, 21, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.restore();
    }

    // Draws SCAN_ORDER[step]'s face. (ox, oy) offset and (sx, sy) squash fake a turning cube.
    function drawFace(step, pose, ox, oy, sx, sy, light, withTop) {
      var fi = FACES.indexOf(SCAN_ORDER[step].face), half = faceSize / 2, pitch = faceSize / 3;
      var bh = half + faceSize * 0.035, gain = stepGain[step] * light;
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.rot);
      ctx.transform(1, pose.skewY, pose.skewX, 1, 0, 0);
      ctx.translate(ox, oy);
      ctx.scale(Math.max(sx, 0.001), Math.max(sy, 0.001));
      if (withTop) {
        // a sliver of the top face, seen slightly from below/above
        var depth = faceSize * 0.11;
        ctx.fillStyle = css([16, 16, 18], 0.8 * light);
        ctx.beginPath();
        ctx.moveTo(-bh, -bh); ctx.lineTo(bh, -bh); ctx.lineTo(bh * 0.93, -bh - depth); ctx.lineTo(-bh * 0.93, -bh - depth);
        ctx.closePath(); ctx.fill();
        topRow[step].forEach(function (idx, k) {
          if (idx == null) return;
          var xl = -bh * 0.93 + 8 + k * (bh * 1.86 - 16) / 3, wl = (bh * 1.86 - 16) / 3 - 8;
          ctx.fillStyle = css(P.palette[state[idx]] || [128, 128, 128], 0.62 * light);
          ctx.beginPath();
          ctx.moveTo(xl + 4, -bh - 5); ctx.lineTo(xl + wl + 4, -bh - 5);
          ctx.lineTo(xl + wl, -bh - depth + 6); ctx.lineTo(xl, -bh - depth + 6);
          ctx.closePath(); ctx.fill();
        });
      }
      ctx.fillStyle = css([20, 20, 23], light);
      rr(-bh, -bh, 2 * bh, 2 * bh, faceSize * 0.06);
      ctx.fill();
      for (var k = 0; k < 9; k++) {
        var r = Math.floor(k / 3), c = k % 3, idx = fi * 9 + k;
        var x = -half + c * pitch + pitch * 0.06, y = -half + r * pitch + pitch * 0.06, w = pitch * 0.88;
        var base = P.palette[state[idx]] || [128, 128, 128];
        ctx.fillStyle = css(base, gain * stickerVar[idx]);
        rr(x, y, w, w, pitch * 0.1);
        ctx.fill();
        var sheen = ctx.createLinearGradient(x, y, x + w, y + w);
        sheen.addColorStop(0, 'rgba(255,255,255,' + (0.10 * P.glare).toFixed(3) + ')');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fill();
      }
      if (P.glare > 0) {
        var gs = glareSpots[step], gr = Math.floor(gs.k / 3), gc = gs.k % 3;
        var gx = -half + (gc + 0.5 + gs.dx) * pitch, gy = -half + (gr + 0.5 + gs.dy) * pitch;
        var spot = ctx.createRadialGradient(gx, gy, 1, gx, gy, pitch * 0.17);
        spot.addColorStop(0, 'rgba(255,255,255,' + Math.min(0.9, 0.6 * P.glare).toFixed(3) + ')');
        spot.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = spot;
        ctx.fillRect(gx - pitch * 0.2, gy - pitch * 0.2, pitch * 0.4, pitch * 0.4);
      }
      var lg = ctx.createLinearGradient(-half, -half, half, half);
      lg.addColorStop(0, 'rgba(255,255,255,0.05)');
      lg.addColorStop(1, 'rgba(0,0,0,0.14)');
      ctx.fillStyle = lg;
      rr(-bh, -bh, 2 * bh, 2 * bh, faceSize * 0.06);
      ctx.fill();
      ctx.restore();
    }

    function ease(q) { return q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2; }

    // a whole-cube turn: the old face swings away while the next one swings in
    function drawTurn(p, pose) {
      var th = ease(clamp(p, 0, 1)) * Math.PI / 2, h = faceSize / 2, co = Math.cos(th), si = Math.sin(th);
      if (kind === 'h') {
        drawFace(prev, pose, -dir * h * si, 0, co, 1, 0.55 + 0.45 * co, false);
        drawFace(cur, pose, dir * h * co, 0, si, 1, 0.55 + 0.45 * si, false);
      } else {
        drawFace(prev, pose, 0, h * si, 1, co, 0.55 + 0.45 * co, false);
        drawFace(cur, pose, 0, -h * co, 1, si, 0.55 + 0.45 * si, false);
      }
    }

    function draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(bg, 0, 0);
      var pose = holdPose(t), p = (t - t0) / TRANS_MS;
      if (!hidden) {                                         // hidden: just the learner (the scanner must not capture that)
        drawHands(pose);
        if (prev != null && p < 1) {
          for (var s = 4; s >= 0; s--) {                    // motion blur: earlier sub-frames as ghosts
            ctx.globalAlpha = s === 0 ? 0.65 : 0.3;
            drawTurn(p - s * 0.03, pose);
          }
          ctx.globalAlpha = 1;
        } else {
          drawFace(cur, pose, 0, 0, 1, 1, 1, true);
        }
      }
      // sensor noise, different every frame
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = clamp(0.22 * P.noise, 0, 1);
      ctx.translate(-Math.floor(rnd() * 256), -Math.floor(rnd() * 256));
      ctx.fillStyle = noisePattern;
      ctx.fillRect(0, 0, W + 256, H + 256);
      ctx.restore();
    }

    var timer = setInterval(function () { draw(performance.now()); }, 33);
    draw(performance.now());
    var stream = canvas.captureStream ? canvas.captureStream(30) : null;

    return {
      stream: stream,
      canvas: canvas,
      current: function () { return cur; },
      showFace: function (step) {
        step = clamp(Math.floor(step), 0, 5);
        if (step === cur && (prev == null || performance.now() - t0 >= TRANS_MS)) return;
        prev = cur; cur = step; t0 = performance.now();
        kind = (Math.abs(cur - prev) === 1 && cur <= 3 && prev <= 3) ? 'h' : 'v';
        dir = cur >= prev ? 1 : -1;
      },
      hideCube: function (b) { hidden = !!b; },
      set: function (o) { setParams(o); renderBackground(); },
      setState: function (s) { state = s.slice(); },
      destroy: function () {
        clearInterval(timer);
        if (stream && stream.getTracks) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) { /* ignore */ } });
      }
    };
  }

  // ------------------------------------------------------------------ exports
  var Scanner = {
    SCAN_ORDER: SCAN_ORDER,
    DEFAULT_RGB: DEFAULT_RGB,
    CAMERA_MESSAGES: CAMERA_MESSAGES,
    isSupported: isSupported,
    createController: createController,
    classifyCube: classifyCube,
    rgbToLab: rgbToLab,
    createFakeCamera: createFakeCamera,
    // extras (pure, used by tests and the dev page)
    createSession: createSession,
    sampleCells: sampleCells,
    guideRect: guideRect,
    classifyColour: classifyColour,
    liveRefs: liveRefs,
    colourDistance: dist,
    classificationDistance: function (p, q) { return Math.sqrt(cdist2(p, q)); },
    chromaticity: chromaOf,
    hungarian: hungarian,
    mapCameraError: mapCameraError,
    listCameras: listCameras,
    drawOverlay: drawOverlay
  };

  root.CC = root.CC || {};
  root.CC.Scanner = Scanner;
  if (typeof module !== 'undefined' && module.exports) module.exports = Scanner;
})(typeof window !== 'undefined' ? window : globalThis);
