/* Cube Coach — core cube model (CC.Cube).
 *
 * A cube state is an array of 54 colour letters: W Y G B R O.
 * Stickers are ordered by face U R F D L B, nine per face, row-major as seen
 * when looking straight at that face:
 *   U: looking down from above, BACK edge at the top of the grid
 *   D: looking up from below,   FRONT edge at the top of the grid
 *   R F L B: looking at the face, U face at the top of the grid
 * This is the Kociemba facelet order, so index = faceIndex * 9 + row * 3 + col.
 *
 * The state is always "as the user is holding it": whole-cube rotations
 * (x, y, z) move the centres too, so "U" always means the face currently on top.
 *
 * 3D frame: x → right, y → up, z → toward the viewer (front).
 */
(function (root) {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  var SCHEME = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' }; // standard (Western) colour scheme
  var COLORS = ['W', 'Y', 'G', 'B', 'R', 'O'];
  var OPPOSITE = { W: 'Y', Y: 'W', G: 'B', B: 'G', R: 'O', O: 'R' };
  var COLOR_NAME = { W: 'white', Y: 'yellow', G: 'green', B: 'blue', R: 'red', O: 'orange' };
  var COLOR_HEX = { W: '#f5f5f0', Y: '#ffd500', G: '#009e60', B: '#0051ba', R: '#c8102e', O: '#ff6a13' };
  var FACE_NAME = { U: 'top', D: 'bottom', F: 'front', B: 'back', L: 'left', R: 'right' };

  // ---------------------------------------------------------------- geometry
  function cubieOf(face, r, c) {
    switch (face) {
      case 'U': return [c - 1, 1, r - 1];
      case 'R': return [1, 1 - r, 1 - c];
      case 'F': return [c - 1, 1 - r, 1];
      case 'D': return [c - 1, -1, 1 - r];
      case 'L': return [-1, 1 - r, c - 1];
      case 'B': return [1 - c, 1 - r, -1];
    }
    throw new Error('bad face ' + face);
  }

  // STICKERS[i] = { index, face, row, col, cubie:[x,y,z], normal:[x,y,z], point:[2*cubie+normal] }
  var STICKERS = [];
  var POINT_TO_INDEX = {};
  FACES.forEach(function (face, f) {
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var cubie = cubieOf(face, r, c);
        var n = NORMAL[face];
        var point = [2 * cubie[0] + n[0], 2 * cubie[1] + n[1], 2 * cubie[2] + n[2]];
        var s = { index: f * 9 + r * 3 + c, face: face, row: r, col: c, cubie: cubie, normal: n.slice(), point: point };
        STICKERS.push(s);
        POINT_TO_INDEX[point.join(',')] = s.index;
      }
    }
  });

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  // Rotate v by -90° about unit axis n, i.e. clockwise when looking at the tip of n.
  function quarterTurn(v, n) {
    var d = dot(n, v), c = cross(n, v);
    return [n[0] * d - c[0], n[1] * d - c[1], n[2] * d - c[2]];
  }

  // name: [axis, layers] — layers are values of dot(cubie, axis) that turn.
  // Slices follow WCA conventions: M like L, E like D, S like F.
  var MOVE_DEFS = {
    U: [[0, 1, 0], [1]], D: [[0, -1, 0], [1]], R: [[1, 0, 0], [1]],
    L: [[-1, 0, 0], [1]], F: [[0, 0, 1], [1]], B: [[0, 0, -1], [1]],
    M: [[-1, 0, 0], [0]], E: [[0, -1, 0], [0]], S: [[0, 0, 1], [0]],
    u: [[0, 1, 0], [0, 1]], d: [[0, -1, 0], [0, 1]], r: [[1, 0, 0], [0, 1]],
    l: [[-1, 0, 0], [0, 1]], f: [[0, 0, 1], [0, 1]], b: [[0, 0, -1], [0, 1]],
    x: [[1, 0, 0], [-1, 0, 1]], y: [[0, 1, 0], [-1, 0, 1]], z: [[0, 0, 1], [-1, 0, 1]]
  };

  // PERM[token][i] = index where sticker i ends up after the move.
  var PERM = {};
  function composePerm(p, q) { // p then q
    var out = new Array(54);
    for (var i = 0; i < 54; i++) out[i] = q[p[i]];
    return out;
  }
  Object.keys(MOVE_DEFS).forEach(function (name) {
    var axis = MOVE_DEFS[name][0], layers = MOVE_DEFS[name][1];
    var q1 = new Array(54);
    STICKERS.forEach(function (s) {
      if (layers.indexOf(dot(s.cubie, axis)) === -1) { q1[s.index] = s.index; return; }
      q1[s.index] = POINT_TO_INDEX[quarterTurn(s.point, axis).join(',')];
    });
    var q2 = composePerm(q1, q1), q3 = composePerm(q2, q1);
    PERM[name] = q1; PERM[name + '2'] = q2; PERM[name + "'"] = q3;
  });

  // ---------------------------------------------------------------- notation
  var TOKEN_RE = /([URFDLBMESxyzurfdlb])(w?)(2'|2|'|3)?/g;

  function normalizeToken(tok) {
    var m = /^([URFDLBMESxyzurfdlb])(w?)(2'|2|'|3)?$/.exec(String(tok).trim());
    if (!m) throw new Error('Unknown move: ' + tok);
    var base = m[1];
    if (m[2]) {
      if ('URFDLB'.indexOf(base) === -1) throw new Error('Unknown move: ' + tok);
      base = base.toLowerCase();
    }
    var suf = m[3] === "2'" ? '2' : m[3] === '3' ? "'" : (m[3] || '');
    return base + suf;
  }

  // Accepts "R U R' U'", "RUR'U'", "(R U R' U')", arrays of tokens, and curly/back quotes.
  function parseAlg(alg) {
    if (Array.isArray(alg)) return alg.map(normalizeToken);
    var s = String(alg == null ? '' : alg).replace(/[’‘`´′]/g, "'").replace(/[()\[\]]/g, ' ');
    var out = [], m, consumed = '';
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s)) !== null) {
      out.push(normalizeToken(m[0]));
      consumed += m[0];
    }
    if (consumed.length !== s.replace(/\s+/g, '').length) throw new Error('Could not parse algorithm: ' + alg);
    return out;
  }

  function formatAlg(moves) { return parseAlg(moves).join(' '); }

  function invertMove(tok) {
    tok = normalizeToken(tok);
    if (tok.slice(-1) === "'") return tok.slice(0, -1);
    if (tok.slice(-1) === '2') return tok;
    return tok + "'";
  }

  function invertAlg(alg) { return parseAlg(alg).slice().reverse().map(invertMove); }

  function amountOf(tok) { var l = tok.slice(-1); return l === "'" ? 3 : l === '2' ? 2 : 1; }
  function baseOf(tok) { return tok.replace(/['2]$/, ''); }
  function tokenFor(base, amount) { amount = ((amount % 4) + 4) % 4; return amount === 0 ? null : base + ['', '', '2', "'"][amount]; }

  // Merge runs of the same move ("R R" -> "R2", "U U'" -> nothing).
  function simplifyAlg(alg) {
    var out = [];
    parseAlg(alg).forEach(function (tok) {
      var b = baseOf(tok);
      if (out.length && baseOf(out[out.length - 1]) === b) {
        var merged = tokenFor(b, amountOf(out.pop()) + amountOf(tok));
        if (merged) out.push(merged);
      } else {
        out.push(tok);
      }
    });
    return out;
  }

  function isRotation(tok) { return /^[xyz]/.test(tok); }

  // ---------------------------------------------------------------- state ops
  function solved(scheme) {
    scheme = scheme || SCHEME;
    var s = [];
    FACES.forEach(function (f) { for (var i = 0; i < 9; i++) s.push(scheme[f]); });
    return s;
  }

  function clone(state) { return state.slice(); }

  function applyPerm(state, perm) {
    var out = new Array(54);
    for (var i = 0; i < 54; i++) out[perm[i]] = state[i];
    return out;
  }

  function applyMove(state, tok) {
    var p = PERM[normalizeToken(tok)];
    return applyPerm(state, p);
  }

  function applyAlg(state, alg) {
    var s = state;
    parseAlg(alg).forEach(function (tok) { s = applyPerm(s, PERM[tok]); });
    return s;
  }

  // Composite permutation of an algorithm: result[i] = where sticker i ends up.
  function algPerm(alg) {
    var p = []; for (var i = 0; i < 54; i++) p.push(i);
    parseAlg(alg).forEach(function (tok) { p = composePerm(p, PERM[tok]); });
    return p;
  }

  function stickerAfter(index, alg) {
    var i = index;
    parseAlg(alg).forEach(function (tok) { i = PERM[tok][i]; });
    return i;
  }

  function center(state, face) { return state[FACES.indexOf(face) * 9 + 4]; }

  function centers(state) {
    var c = {};
    FACES.forEach(function (f) { c[f] = center(state, f); });
    return c;
  }

  function isSolved(state) {
    for (var f = 0; f < 6; f++) {
      var c = state[f * 9 + 4];
      for (var i = 0; i < 9; i++) if (state[f * 9 + i] !== c) return false;
    }
    return true;
  }

  function toString(state) { return state.join(''); }
  function fromString(str) {
    var s = String(str).trim().toUpperCase().split('');
    if (s.length !== 54) throw new Error('A cube string needs 54 letters');
    return s;
  }

  // ---------------------------------------------------------------- pieces
  // Kociemba facelet tables. Corners: U/D sticker first, then clockwise.
  // Edges: U/D sticker first; for middle-layer edges the F/B sticker first.
  var CORNERS = [
    { name: 'URF', stickers: [8, 9, 20] },
    { name: 'UFL', stickers: [6, 18, 38] },
    { name: 'ULB', stickers: [0, 36, 47] },
    { name: 'UBR', stickers: [2, 45, 11] },
    { name: 'DFR', stickers: [29, 26, 15] },
    { name: 'DLF', stickers: [27, 44, 24] },
    { name: 'DBL', stickers: [33, 53, 42] },
    { name: 'DRB', stickers: [35, 17, 51] }
  ];
  var EDGES = [
    { name: 'UR', stickers: [5, 10] },
    { name: 'UF', stickers: [7, 19] },
    { name: 'UL', stickers: [3, 37] },
    { name: 'UB', stickers: [1, 46] },
    { name: 'DR', stickers: [32, 16] },
    { name: 'DF', stickers: [28, 25] },
    { name: 'DL', stickers: [30, 43] },
    { name: 'DB', stickers: [34, 52] },
    { name: 'FR', stickers: [23, 12] },
    { name: 'FL', stickers: [21, 41] },
    { name: 'BL', stickers: [50, 39] },
    { name: 'BR', stickers: [48, 14] }
  ];
  CORNERS.forEach(function (c) { c.faces = c.stickers.map(function (i) { return STICKERS[i].face; }); });
  EDGES.forEach(function (e) { e.faces = e.stickers.map(function (i) { return STICKERS[i].face; }); });

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) === -1) return false;
    return true;
  }

  // Where is the edge with colours a,b? -> { position, name, stickers:[index of a, index of b], faces:[face of a, face of b] }
  function findEdge(state, a, b) {
    for (var k = 0; k < EDGES.length; k++) {
      var st = EDGES[k].stickers, cols = [state[st[0]], state[st[1]]];
      if (sameSet(cols, [a, b])) {
        var ia = cols[0] === a ? st[0] : st[1], ib = ia === st[0] ? st[1] : st[0];
        return { position: k, name: EDGES[k].name, stickers: [ia, ib], faces: [STICKERS[ia].face, STICKERS[ib].face] };
      }
    }
    return null;
  }

  // Where is the corner with colours a,b,c? stickers[] are in the same order as the colours asked for.
  function findCorner(state, a, b, c) {
    for (var k = 0; k < CORNERS.length; k++) {
      var st = CORNERS[k].stickers, cols = st.map(function (i) { return state[i]; });
      if (sameSet(cols, [a, b, c])) {
        var ordered = [a, b, c].map(function (col) { return st[cols.indexOf(col)]; });
        return { position: k, name: CORNERS[k].name, stickers: ordered, faces: ordered.map(function (i) { return STICKERS[i].face; }) };
      }
    }
    return null;
  }

  function edgeColors(state, k) { return EDGES[k].stickers.map(function (i) { return state[i]; }); }
  function cornerColors(state, k) { return CORNERS[k].stickers.map(function (i) { return state[i]; }); }

  // ---------------------------------------------------------------- orientation
  var ROTATION_TOKENS = ['y', "y'", 'y2', 'x', "x'", 'x2', 'z', "z'", 'z2'];

  // Shortest whole-cube rotation that puts colour `up` on top and `front` in front.
  // Returns an array of tokens ([] if already there) or null if impossible.
  function rotationTo(state, up, front) {
    var c0 = centers(state);
    function ok(c) { return c.U === up && (front == null || c.F === front); }
    if (ok(c0)) return [];
    var cs = function (alg) { return centers(applyAlg(state, alg)); };
    for (var i = 0; i < ROTATION_TOKENS.length; i++) if (ok(cs([ROTATION_TOKENS[i]]))) return [ROTATION_TOKENS[i]];
    for (i = 0; i < ROTATION_TOKENS.length; i++) {
      for (var j = 0; j < ROTATION_TOKENS.length; j++) {
        if (ROTATION_TOKENS[i][0] === ROTATION_TOKENS[j][0]) continue;
        var seq = [ROTATION_TOKENS[i], ROTATION_TOKENS[j]];
        if (ok(cs(seq))) return seq;
      }
    }
    return null;
  }

  // Shortest y-rotation (y, y', y2 or none) that brings colour `front` to the front.
  function yRotationTo(state, front) {
    var opts = [[], ['y'], ["y'"], ['y2']];
    for (var i = 0; i < opts.length; i++) if (center(applyAlg(state, opts[i]), 'F') === front) return opts[i];
    return null;
  }

  // ---------------------------------------------------------------- validation
  var SOLVED_STD = solved(SCHEME);
  var CORNER_PIECES = CORNERS.map(function (c) { return c.stickers.map(function (i) { return SOLVED_STD[i]; }); });
  var EDGE_PIECES = EDGES.map(function (e) { return e.stickers.map(function (i) { return SOLVED_STD[i]; }); });

  function isCyclicRotation(a, b) {
    for (var r = 0; r < 3; r++) {
      if (a[0] === b[r] && a[1] === b[(r + 1) % 3] && a[2] === b[(r + 2) % 3]) return true;
    }
    return false;
  }

  function permParity(p) {
    var seen = [], parity = 0;
    for (var i = 0; i < p.length; i++) {
      if (seen[i]) continue;
      var len = 0, j = i;
      while (!seen[j]) { seen[j] = true; j = p[j]; len++; }
      parity += len - 1;
    }
    return parity % 2;
  }

  // Checks that a state is a real, solvable cube. Errors carry sticker indices
  // (in the state's own orientation) so a UI can highlight the suspects.
  function validate(state) {
    var errors = [];
    function err(type, message, stickers) { errors.push({ type: type, message: message, stickers: stickers || [] }); }
    if (!state || state.length !== 54) return { ok: false, errors: [{ type: 'length', message: 'A cube needs 54 stickers.', stickers: [] }] };

    var counts = {};
    COLORS.forEach(function (c) { counts[c] = 0; });
    var unknown = [];
    for (var i = 0; i < 54; i++) {
      if (counts[state[i]] === undefined) unknown.push(i); else counts[state[i]]++;
    }
    if (unknown.length) err('unknown', unknown.length + ' sticker(s) have no colour yet.', unknown);
    COLORS.forEach(function (c) {
      if (counts[c] !== 9) {
        var where = [];
        for (var k = 0; k < 54; k++) if (state[k] === c) where.push(k);
        err('count', 'There are ' + counts[c] + ' ' + COLOR_NAME[c] + ' stickers — there should be 9.', counts[c] > 9 ? where : []);
      }
    });
    var cen = centers(state), cenList = FACES.map(function (f) { return cen[f]; });
    var distinct = cenList.filter(function (c, k) { return cenList.indexOf(c) === k; });
    if (distinct.length !== 6) err('centers', 'Two centres have the same colour — every face centre should be different.', [4, 13, 22, 31, 40, 49]);
    if (errors.length) return { ok: false, errors: errors };

    var rot = rotationTo(state, 'W', 'G');
    if (!rot) {
      err('scheme', 'The centres are not arranged like a standard cube (white opposite yellow, green opposite blue, red opposite orange).', [4, 13, 22, 31, 40, 49]);
      return { ok: false, errors: errors };
    }
    var fwd = algPerm(rot), back = new Array(54);
    for (i = 0; i < 54; i++) back[fwd[i]] = i;
    var s = applyAlg(state, rot);
    if (center(s, 'R') !== 'R') {
      err('scheme', 'With white on top and green in front, red should be on the right. This cube’s colour scheme looks mirrored — check the centres.', [4, 13, 22, 31, 40, 49]);
      return { ok: false, errors: errors };
    }
    function orig(list) { return list.map(function (k) { return back[k]; }); }

    var cornerPerm = [], twist = 0, cornerSeen = {};
    for (var k = 0; k < 8; k++) {
      var cols = cornerColors(s, k), id = -1;
      for (var j = 0; j < 8; j++) if (isCyclicRotation(cols, CORNER_PIECES[j])) { id = j; break; }
      if (id === -1) {
        err('corner', 'A corner has colours ' + cols.map(function (c) { return COLOR_NAME[c]; }).join('/') + ', which no real corner has.', orig(CORNERS[k].stickers));
        continue;
      }
      if (cornerSeen[id] !== undefined) err('corner', 'The same corner piece appears twice.', orig(CORNERS[k].stickers.concat(CORNERS[cornerSeen[id]].stickers)));
      cornerSeen[id] = k;
      cornerPerm[k] = id;
      for (var t = 0; t < 3; t++) if (cols[t] === 'W' || cols[t] === 'Y') twist += t;
    }
    var edgePerm = [], flip = 0, edgeSeen = {};
    for (k = 0; k < 12; k++) {
      var ec = edgeColors(s, k), eid = -1;
      for (j = 0; j < 12; j++) if (sameSet(ec, EDGE_PIECES[j])) { eid = j; break; }
      if (eid === -1) {
        err('edge', 'An edge has colours ' + ec.map(function (c) { return COLOR_NAME[c]; }).join('/') + ', which no real edge has.', orig(EDGES[k].stickers));
        continue;
      }
      if (edgeSeen[eid] !== undefined) err('edge', 'The same edge piece appears twice.', orig(EDGES[k].stickers.concat(EDGES[edgeSeen[eid]].stickers)));
      edgeSeen[eid] = k;
      edgePerm[k] = eid;
      var ref = (ec.indexOf('W') !== -1 || ec.indexOf('Y') !== -1) ? (ec.indexOf('W') !== -1 ? 'W' : 'Y') : (ec.indexOf('G') !== -1 ? 'G' : 'B');
      flip += ec.indexOf(ref);
    }
    if (errors.length) return { ok: false, errors: errors };

    var allCorners = [], allEdges = [];
    CORNERS.forEach(function (c) { allCorners = allCorners.concat(orig(c.stickers)); });
    EDGES.forEach(function (e) { allEdges = allEdges.concat(orig(e.stickers)); });
    if (twist % 3 !== 0) err('twist', 'One corner looks twisted in place — a corner sticker was probably misread.', allCorners);
    if (flip % 2 !== 0) err('flip', 'One edge looks flipped — an edge sticker was probably misread.', allEdges);
    if (permParity(cornerPerm) !== permParity(edgePerm)) err('parity', 'Two pieces look swapped — usually two stickers were misread.', []);
    return { ok: errors.length === 0, errors: errors };
  }

  // ---------------------------------------------------------------- scrambles
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Random-move scramble (WCA style face moves, no redundant sequences).
  function scramble(length, seed) {
    length = length || 25;
    var rnd = seed == null ? Math.random : mulberry32(seed);
    var faces = ['U', 'D', 'R', 'L', 'F', 'B'], axis = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
    var out = [], prev = null, prev2 = null;
    while (out.length < length) {
      var f = faces[Math.floor(rnd() * 6)];
      if (f === prev) continue;
      if (prev2 === f && axis[prev] === axis[f]) continue; // e.g. R L R
      out.push(f + ['', "'", '2'][Math.floor(rnd() * 3)]);
      prev2 = prev; prev = f;
    }
    return out;
  }

  // ---------------------------------------------------------------- plain English
  var MOVE_TEXT = {
    U: ['Top layer', 'turn so the front moves to the LEFT', 'turn so the front moves to the RIGHT'],
    D: ['Bottom layer', 'turn so the front moves to the RIGHT', 'turn so the front moves to the LEFT'],
    R: ['Right side', 'turn UP, away from you', 'turn DOWN, toward you'],
    L: ['Left side', 'turn DOWN, toward you', 'turn UP, away from you'],
    F: ['Front face', 'turn clockwise (top goes right)', 'turn anticlockwise (top goes left)'],
    B: ['Back face', 'turn so its top moves to the LEFT (as you look from the front)', 'turn so its top moves to the RIGHT (as you look from the front)'],
    M: ['Middle slice (between left and right)', 'turn DOWN, toward you', 'turn UP, away from you'],
    E: ['Equator slice (middle layer)', 'turn so the front moves to the RIGHT', 'turn so the front moves to the LEFT'],
    S: ['Standing slice (between front and back)', 'turn clockwise (top goes right)', 'turn anticlockwise (top goes left)'],
    x: ['Whole cube', 'roll it so the FRONT face goes up to the TOP (the top goes away from you)', 'roll it so the FRONT face goes down to the BOTTOM (the top comes toward you)'],
    y: ['Whole cube', 'spin it so the RIGHT face comes to the FRONT', 'spin it so the LEFT face comes to the FRONT'],
    z: ['Whole cube', 'tilt it clockwise (top goes to the right)', 'tilt it anticlockwise (top goes to the left)']
  };
  var WIDE_TEXT = { u: 'U', d: 'D', r: 'R', l: 'L', f: 'F', b: 'B' };

  function moveInfo(tok) {
    tok = normalizeToken(tok);
    var b = baseOf(tok), amount = amountOf(tok), wide = !!WIDE_TEXT[b];
    var key = wide ? WIDE_TEXT[b] : b;
    var t = MOVE_TEXT[key];
    var what = (wide ? t[0] + ' plus the middle layer next to it' : t[0]);
    var how;
    if (amount === 2) {
      how = b === 'y' ? 'spin it halfway round so the BACK comes to the FRONT'
        : b === 'x' ? 'roll it halfway so the cube is upside down and the BACK comes to the FRONT'
          : b === 'z' ? 'turn it upside down, keeping the same face toward you'
            : 'turn it twice (a half turn, 180°) — either direction';
    } else {
      how = amount === 1 ? t[1] : t[2];
    }
    return {
      token: tok, base: b, amount: amount, rotation: isRotation(tok), wide: wide,
      face: 'URFDLB'.indexOf(key) !== -1 ? key : null,
      label: what, text: what + ': ' + how, how: how
    };
  }

  var Cube = {
    FACES: FACES, NORMAL: NORMAL, SCHEME: SCHEME, COLORS: COLORS, OPPOSITE: OPPOSITE,
    COLOR_NAME: COLOR_NAME, COLOR_HEX: COLOR_HEX, FACE_NAME: FACE_NAME,
    STICKERS: STICKERS, CORNERS: CORNERS, EDGES: EDGES, PERM: PERM, MOVE_DEFS: MOVE_DEFS,
    solved: solved, clone: clone, applyMove: applyMove, applyAlg: applyAlg, algPerm: algPerm,
    stickerAfter: stickerAfter, parseAlg: parseAlg, formatAlg: formatAlg, normalizeToken: normalizeToken,
    invertMove: invertMove, invertAlg: invertAlg, simplifyAlg: simplifyAlg, isRotation: isRotation,
    amountOf: amountOf, baseOf: baseOf,
    center: center, centers: centers, isSolved: isSolved, toString: toString, fromString: fromString,
    findEdge: findEdge, findCorner: findCorner, edgeColors: edgeColors, cornerColors: cornerColors,
    rotationTo: rotationTo, yRotationTo: yRotationTo, validate: validate,
    scramble: scramble, mulberry32: mulberry32, moveInfo: moveInfo
  };

  root.CC = root.CC || {};
  root.CC.Cube = Cube;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cube;
})(typeof window !== 'undefined' ? window : globalThis);
