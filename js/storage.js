/* Cube Coach — persistence (CC.Store).
 *
 * Everything the app remembers lives in ONE object (`data`, shape below) saved as JSON
 * under localStorage key 'cubecoach.v1'. Loading never throws:
 *   - nothing stored            -> fresh defaults()
 *   - corrupt JSON / not object -> defaults(), and the bad text is kept under 'cubecoach.v1.corrupt'
 *   - older/partial data        -> migrated, then merged over defaults (unknown keys are kept,
 *                                  so data written by a newer version survives a round trip)
 *   - localStorage missing or throwing (node, private mode, quota) -> an in-memory fallback
 *
 * data = {
 *   version: 1, createdAt: ISO,
 *   settings: { mirror, autoCapture, animSpeed, anticipate, guidanceOverride:null|0..3,
 *               keyboard:'simple'|'cstimer', inspection, goalSeconds, splitTaps },
 *   skills: { [stageId]: { mastery:0..100, sessions, soloClean, lastLevel:0..3, lastPracticed:ISO|null } },
 *   solves: [{ id, at, device, source, stage, scramble, totalMs, splits, levels, hints, quiz, completed }],
 *   drills: { [drillType]: { right, total, lastAt } },
 *   algs: { [algId]: { box:1..5, due:ISO, right, total } },
 *   practiceLog: { 'YYYY-MM-DD': minutes },
 *   milestones: { [id]: ISO }
 * }
 *
 * Moving progress between devices (laptop <-> phone are different browsers, so nothing is shared):
 *   exportCode(data) -> 'CUBE1.…'   importCode(text) -> data   (text survives Messages/WhatsApp)
 *   merge(local, incoming) -> data   replace(local, incoming) -> data   summary(data) -> counts
 */
(function (root) {
  'use strict';

  var KEY = 'cubecoach.v1';
  var CORRUPT_KEY = 'cubecoach.v1.corrupt';
  var VERSION = 1;
  var MAX_SOLVES = 2000;
  var STAGE_IDS = ['daisy', 'cross', 'corners', 'middle', 'ycross', 'yedges', 'ycorners', 'yorient'];
  var ALG_IDS = ['rtrigger', 'mid-right', 'mid-left', 'ycross', 'sune', 'corner-cycle', 'twist'];

  var DEFAULT_SETTINGS = {
    mirror: true, autoCapture: true, animSpeed: 1, anticipate: true, guidanceOverride: null,
    keyboard: 'simple', inspection: true, goalSeconds: 180, splitTaps: true
  };

  // ------------------------------------------------------------ backend
  // injected: undefined = auto-detect localStorage; null = memory only; object = a Storage-like
  var injected;
  var memory = {};
  var memoryNewer = false; // last save could not reach localStorage, so memory holds the newest copy

  function detectStorage() {
    if (injected !== undefined) return injected;
    try {
      if (typeof window === 'undefined') {
        // Node 22+ exposes a localStorage getter that only warns unless --localstorage-file is set.
        var d = Object.getOwnPropertyDescriptor(root, 'localStorage');
        if (!d || (d.get && !('value' in d))) return null;
      }
      var ls = root.localStorage;
      return ls && typeof ls.getItem === 'function' ? ls : null;
    } catch (e) {
      return null;
    }
  }

  function rawGet(key) {
    if (memoryNewer && Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
    var ls = detectStorage();
    if (ls) {
      try { return ls.getItem(key); } catch (e) { /* fall through to memory */ }
    }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  // Returns true when the value reached real (persistent) storage.
  function rawSet(key, value) {
    memory[key] = value;
    var ls = detectStorage();
    if (!ls) return false;
    try { ls.setItem(key, value); return true; } catch (e) { return false; }
  }

  function rawRemove(key) {
    delete memory[key];
    var ls = detectStorage();
    if (ls) { try { ls.removeItem(key); } catch (e) { /* ignore */ } }
  }

  // ------------------------------------------------------------ helpers
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function num(v, dflt) { return typeof v === 'number' && isFinite(v) ? v : dflt; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // Keys copied from stored/imported JSON: never '__proto__' & co (JSON.parse makes them own keys,
  // and assigning them would swap an object's prototype).
  function safeKey(k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }
  function keys(o) { return Object.keys(o).filter(safeKey); }
  function shallow(o) { var out = {}; keys(o).forEach(function (k) { out[k] = o[k]; }); return out; }
  // A non-negative number from a number or numeric string, else null.
  function nonNeg(v) {
    if (typeof v === 'string' && v.trim() !== '') v = Number(v);
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
  }
  function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function nowIso(now) {
    var d = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function defaultSkill() {
    return { mastery: 0, sessions: 0, soloClean: 0, lastLevel: 3, lastPracticed: null };
  }

  function defaults(now) {
    var skills = {};
    STAGE_IDS.forEach(function (id) { skills[id] = defaultSkill(); });
    return {
      version: VERSION,
      createdAt: nowIso(now),
      settings: copy(DEFAULT_SETTINGS),
      skills: skills,
      solves: [],
      drills: {},
      algs: {},
      practiceLog: {},
      milestones: {}
    };
  }

  // ------------------------------------------------------------ migration
  // MIGRATIONS[n] upgrades data from version n to n+1. Data without a version is version 0.
  var MIGRATIONS = {
    0: function (d) {
      // Pre-release shapes: allow `history` as an old name for `solves`, `practice` for `practiceLog`.
      if (!d.solves && Array.isArray(d.history)) { d.solves = d.history; delete d.history; }
      if (!d.practiceLog && isObj(d.practice)) { d.practiceLog = d.practice; delete d.practice; }
      d.version = 1;
      return d;
    }
  };

  function migrate(d) {
    if (!isObj(d)) return d;
    var v = typeof d.version === 'number' && isFinite(d.version) ? Math.max(0, Math.floor(d.version)) : 0;
    d.version = v;
    var guard = 0;
    while (d.version < VERSION && MIGRATIONS[d.version] && guard++ < 50) {
      var from = d.version;
      d = MIGRATIONS[from](d) || d;
      if (d.version === from) d.version = from + 1;
    }
    if (d.version < VERSION) d.version = VERSION;
    return d;
  }

  // ------------------------------------------------------------ normalise (merge over defaults)
  function normSettings(s) {
    var out = copy(DEFAULT_SETTINGS);
    if (!isObj(s)) return out;
    keys(s).forEach(function (k) {
      var v = s[k];
      if (!has(DEFAULT_SETTINGS, k)) { out[k] = v; return; }       // forward compatible
      if (k === 'guidanceOverride') {
        out[k] = (typeof v === 'number' && v >= 0 && v <= 3) ? Math.round(v) : null;
      } else if (k === 'keyboard') {
        out[k] = (v === 'simple' || v === 'cstimer') ? v : DEFAULT_SETTINGS.keyboard;
      } else if (k === 'goalSeconds') {
        out[k] = num(v, 0) > 0 ? v : DEFAULT_SETTINGS.goalSeconds;
      } else if (k === 'animSpeed') {
        out[k] = num(v, 0) > 0 ? v : DEFAULT_SETTINGS.animSpeed;
      } else if (typeof v === typeof DEFAULT_SETTINGS[k]) {
        out[k] = v;
      }
    });
    return out;
  }

  function normSkill(s) {
    var out = defaultSkill();
    if (!isObj(s)) return out;
    keys(s).forEach(function (k) { if (!has(out, k)) out[k] = s[k]; });
    out.mastery = clamp(num(s.mastery, 0), 0, 100);
    out.sessions = Math.max(0, Math.floor(num(s.sessions, 0)));
    out.soloClean = Math.max(0, Math.floor(num(s.soloClean, 0)));
    out.lastLevel = [0, 1, 2, 3].indexOf(s.lastLevel) !== -1 ? s.lastLevel : 3;
    out.lastPracticed = typeof s.lastPracticed === 'string' ? s.lastPracticed : null;
    return out;
  }

  function normSolve(s) {
    if (!isObj(s) || !(typeof s.totalMs === 'number' && isFinite(s.totalMs))) return null;
    var out = shallow(s);
    out.device = s.device === 'virtual' ? 'virtual' : 'physical';
    out.splits = isObj(s.splits) ? shallow(s.splits) : {};
    // levels / hints written as one number for the whole solve are kept (as an object), so a
    // hinted or coached solve can never turn into an "unaided" one on reload.
    out.levels = isObj(s.levels) ? shallow(s.levels) : ([0, 1, 2, 3].indexOf(s.levels) !== -1 ? { all: s.levels } : {});
    out.hints = isObj(s.hints) ? shallow(s.hints) : (nonNeg(s.hints) ? { total: nonNeg(s.hints) } : {});
    out.quiz = isObj(s.quiz) ? s.quiz : { right: 0, total: 0 };
    out.completed = s.completed !== false;
    if (out.stage === undefined) out.stage = null;
    if (out.scramble === undefined) out.scramble = null;
    return out;
  }

  function normMap(m, fn) {
    var out = {};
    if (!isObj(m)) return out;
    keys(m).forEach(function (k) {
      var v = fn ? fn(m[k]) : m[k];
      if (v !== undefined && v !== null) out[k] = v;
    });
    return out;
  }

  function normalize(d, now) {
    var base = defaults(now);
    if (!isObj(d)) return base;
    var out = shallow(d); // keep unknown top-level keys
    out.version = typeof d.version === 'number' && d.version >= VERSION ? d.version : VERSION;
    out.createdAt = typeof d.createdAt === 'string' ? d.createdAt : base.createdAt;
    out.settings = normSettings(d.settings);
    out.skills = {};
    var skills = isObj(d.skills) ? d.skills : {};
    STAGE_IDS.forEach(function (id) { out.skills[id] = normSkill(skills[id]); });
    keys(skills).forEach(function (id) { if (!has(out.skills, id)) out.skills[id] = normSkill(skills[id]); });
    var solves = Array.isArray(d.solves) ? d.solves.map(normSolve).filter(Boolean) : [];
    if (solves.length > MAX_SOLVES) solves = solves.slice(solves.length - MAX_SOLVES);
    out.solves = solves;
    out.drills = normMap(d.drills, function (v) {
      if (!isObj(v)) return null;
      v = shallow(v);
      v.right = Math.max(0, num(v.right, 0)); v.total = Math.max(v.right, num(v.total, 0));
      if (v.lastAt === undefined) v.lastAt = null;
      return v;
    });
    out.algs = normMap(d.algs, function (v) {
      if (!isObj(v)) return null;
      v = shallow(v);
      v.box = clamp(Math.round(num(v.box, 1)), 1, 5);
      if (typeof v.due !== 'string') v.due = base.createdAt;
      v.right = Math.max(0, num(v.right, 0)); v.total = Math.max(v.right, num(v.total, 0));
      return v;
    });
    out.practiceLog = normMap(d.practiceLog, nonNeg);
    out.milestones = normMap(d.milestones, function (v) { return typeof v === 'string' ? v : null; });
    return out;
  }

  // ------------------------------------------------------------ public API
  function load() {
    var raw = rawGet(KEY);
    if (raw == null || raw === '') return defaults();
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = undefined; }
    if (!isObj(parsed)) {
      rawSet(CORRUPT_KEY, String(raw)); // keep the bad copy so nothing is silently lost
      return defaults();
    }
    try {
      return normalize(migrate(parsed));
    } catch (e2) {
      rawSet(CORRUPT_KEY, String(raw));
      return defaults();
    }
  }

  // Returns true if the data reached localStorage, false if it is only held in memory.
  function save(data) {
    if (!isObj(data)) return false;
    if (Array.isArray(data.solves) && data.solves.length > MAX_SOLVES) {
      data.solves.splice(0, data.solves.length - MAX_SOLVES);
    }
    var json;
    try { json = JSON.stringify(data); } catch (e) { return false; }
    var ok = rawSet(KEY, json);
    if (!ok && Array.isArray(data.solves) && data.solves.length > 200 && detectStorage()) {
      // Probably over quota: keep the most recent solves and try once more.
      var slim = {};
      Object.keys(data).forEach(function (k) { slim[k] = data[k]; });
      slim.solves = data.solves.slice(-200);
      ok = rawSet(KEY, JSON.stringify(slim));
      memory[KEY] = json; // the full copy stays available for this session
    }
    memoryNewer = !ok;
    return ok;
  }

  function reset() {
    rawRemove(KEY);
    memoryNewer = false;
    return defaults();
  }

  function exportJSON(data) {
    return JSON.stringify(normalize(migrate(copy(data))), null, 2);
  }

  // Parses and validates a backup. Throws an Error with a friendly message if it is not
  // Cube Coach data. Does NOT save — call save() with the result.
  function importJSON(str) {
    var parsed;
    try { parsed = JSON.parse(String(str == null ? '' : str).replace(/^\uFEFF/, '')); } catch (e) {
      throw new Error('That file is not a Cube Coach backup (it is not valid JSON).');
    }
    if (!isObj(parsed)) throw new Error('That file is not a Cube Coach backup.');
    var known = ['settings', 'skills', 'solves', 'drills', 'algs', 'practiceLog', 'milestones', 'history'];
    if (!known.some(function (k) { return has(parsed, k); })) {
      throw new Error('That file does not contain any Cube Coach progress.');
    }
    if (has(parsed, 'solves') && !Array.isArray(parsed.solves)) throw new Error('The backup is damaged: "solves" should be a list.');
    if (has(parsed, 'skills') && !isObj(parsed.skills)) throw new Error('The backup is damaged: "skills" should be an object.');
    if (has(parsed, 'settings') && !isObj(parsed.settings)) throw new Error('The backup is damaged: "settings" should be an object.');
    return normalize(migrate(parsed));
  }

  // ------------------------------------------------------------ progress codes (move between devices)
  // A progress code is 'CUBE1.' + base64 of a zlib stream (RFC 1950: deflate + Adler-32 checksum) of
  // the compact store JSON. It is plain text, so it can travel through Messages, WhatsApp, Notes or
  // email. importCode() tolerates what those apps do to text: line breaks and spaces inserted,
  // smart quotes or zero-width characters added, words before the code ("Here's my code: …"), a
  // lower-case prefix, or junk after it. A code whose base64 is plain JSON ('{…') also imports.
  var CODE_PREFIX = 'CUBE1.';

  // UTF-8 <-> string (TextEncoder where available; a manual fallback keeps node 10 / old WebKit happy).
  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var bin = unescape(encodeURIComponent(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return decodeURIComponent(escape(s));
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_INDEX = (function () { var m = {}; for (var i = 0; i < 64; i++) m[B64.charAt(i)] = i; return m; })();

  function b64Encode(bytes) {
    var out = [], i = 0, n = bytes.length;
    for (; i + 2 < n; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out.push(B64.charAt(v >> 18), B64.charAt((v >> 12) & 63), B64.charAt((v >> 6) & 63), B64.charAt(v & 63));
    }
    if (n - i === 1) {
      var a = bytes[i] << 16;
      out.push(B64.charAt(a >> 18), B64.charAt((a >> 12) & 63), '==');
    } else if (n - i === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out.push(B64.charAt(b >> 18), B64.charAt((b >> 12) & 63), B64.charAt((b >> 6) & 63), '=');
    }
    return out.join('');
  }

  // Forgiving: skips anything that is not a base64 character and stops at the first '=' (padding).
  // A trailing partial group is decoded as far as it goes.
  function b64Decode(text) {
    var out = [], acc = 0, bits = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '=') break;
      var v = B64_INDEX[c];
      if (v === undefined) continue;
      acc = ((acc << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
    }
    return new Uint8Array(out);
  }

  function adler32(bytes) {
    var a = 1, b = 0;
    for (var i = 0; i < bytes.length;) {
      var end = Math.min(i + 3800, bytes.length);
      for (; i < end; i++) { a += bytes[i]; b += a; }
      a %= 65521; b %= 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  // --- deflate (RFC 1951): hash-chain LZ77 + one Huffman-coded block. Small, no dependencies, and
  // about as good as zlib on our JSON (4-6x smaller). Verified against node's zlib in tests.
  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  function BitWriter() { this.out = []; this.acc = 0; this.n = 0; }
  BitWriter.prototype.bits = function (value, count) { // LSB first (deflate's bit order)
    for (var i = 0; i < count; i++) {
      this.acc |= ((value >>> i) & 1) << this.n;
      if (++this.n === 8) { this.out.push(this.acc); this.acc = 0; this.n = 0; }
    }
  };
  BitWriter.prototype.code = function (code, len) { // Huffman codes go MSB first
    for (var i = len - 1; i >= 0; i--) this.bits((code >>> i) & 1, 1);
  };
  BitWriter.prototype.finish = function () { if (this.n) { this.out.push(this.acc); this.acc = 0; this.n = 0; } return this.out; };

  function fixedLiteral(w, sym) {
    if (sym < 144) w.code(0x30 + sym, 8);
    else if (sym < 256) w.code(0x190 + sym - 144, 9);
    else if (sym < 280) w.code(sym - 256, 7);
    else w.code(0xc0 + sym - 280, 8);
  }
  function findIndex(table, v) { var i = table.length - 1; while (table[i] > v) i--; return i; }

  // LZ77 with hash chains and one-step lazy matching. Returns parallel arrays: lit[i] is a byte
  // (when len[i] === 0) or len[i] >= 3 and dist[i] describe a back-reference.
  function lz77(data) {
    var n = data.length, WSIZE = 32768, HSIZE = 1 << 15, MAX_CHAIN = 128, NICE = 128;
    var head = new Int32Array(HSIZE), prev = new Int32Array(WSIZE);
    for (var k = 0; k < HSIZE; k++) head[k] = -1;
    var lit = [], len = [], dist = [];
    var mLen = 0, mDist = 0;
    function hashAt(p) { return (((data[p] << 10) ^ (data[p + 1] << 5) ^ data[p + 2]) & (HSIZE - 1)); }
    function insert(p) { if (p + 2 < n) { var hh = hashAt(p); prev[p & (WSIZE - 1)] = head[hh]; head[hh] = p; } }
    function longest(p) {
      mLen = 0; mDist = 0;
      if (p + 2 >= n) return;
      var cand = head[hashAt(p)], chain = 0, maxLen = Math.min(258, n - p);
      while (cand >= 0 && p - cand <= WSIZE && chain++ < MAX_CHAIN) {
        if (data[cand + mLen] === data[p + mLen]) {
          var l = 0;
          while (l < maxLen && data[cand + l] === data[p + l]) l++;
          if (l > mLen) { mLen = l; mDist = p - cand; if (l === maxLen) return; }
        }
        var nx = prev[cand & (WSIZE - 1)];
        if (nx >= cand) return; // the slot was reused by a newer position: end of this chain
        cand = nx;
      }
    }
    var pos = 0;
    while (pos < n) {
      longest(pos);
      var L = mLen, D = mDist;
      insert(pos);
      while (L >= 3 && L < NICE && pos + 1 < n) { // a longer match one byte later? take a literal first
        longest(pos + 1);
        if (mLen <= L) break;
        lit.push(data[pos]); len.push(0); dist.push(0);
        pos++; insert(pos);
        L = mLen; D = mDist;
      }
      if (L >= 3) {
        lit.push(0); len.push(L); dist.push(D);
        for (var j = 1; j < L; j++) insert(pos + j);
        pos += L;
      } else {
        lit.push(data[pos]); len.push(0); dist.push(0);
        pos++;
      }
    }
    return { lit: lit, len: len, dist: dist };
  }

  // Huffman code lengths for these symbol frequencies, no code longer than `limit` bits.
  function huffLengths(freqs, limit) {
    var f = Array.prototype.slice.call(freqs);
    for (;;) {
      var lengths = new Uint8Array(f.length), leaves = [], i;
      for (i = 0; i < f.length; i++) if (f[i]) leaves.push({ w: f[i], s: i });
      if (leaves.length === 1) { lengths[leaves[0].s] = 1; return lengths; }
      leaves.sort(function (a, b) { return a.w - b.w || a.s - b.s; });
      var inner = [], li = 0, ii = 0;
      var take = function () { return (li < leaves.length && (ii >= inner.length || leaves[li].w <= inner[ii].w)) ? leaves[li++] : inner[ii++]; };
      while ((leaves.length - li) + (inner.length - ii) > 1) { var a = take(), b = take(); inner.push({ w: a.w + b.w, l: a, r: b }); }
      var stack = inner.length ? [[inner[inner.length - 1], 0]] : [], max = 0;
      while (stack.length) {
        var top = stack.pop(), node = top[0], depth = top[1];
        if (node.l) { stack.push([node.l, depth + 1], [node.r, depth + 1]); }
        else { lengths[node.s] = depth; if (depth > max) max = depth; }
      }
      if (max <= limit) return lengths;
      for (i = 0; i < f.length; i++) if (f[i]) f[i] = (f[i] + 1) >>> 1; // flatten and try again
    }
  }

  function canonicalCodes(lengths) {
    var count = new Uint16Array(16), next = new Uint16Array(16), codes = new Uint16Array(lengths.length), i, code = 0;
    for (i = 0; i < lengths.length; i++) count[lengths[i]]++;
    count[0] = 0;
    for (var bitsN = 1; bitsN < 16; bitsN++) { code = (code + count[bitsN - 1]) << 1; next[bitsN] = code; }
    for (i = 0; i < lengths.length; i++) if (lengths[i]) codes[i] = next[lengths[i]]++;
    return codes;
  }

  function atLeastTwo(freqs) { // a one-symbol code is "incomplete" for some decoders: add a dummy
    var used = 0;
    for (var i = 0; i < freqs.length; i++) if (freqs[i]) used++;
    for (i = 0; used < 2 && i < freqs.length; i++) if (!freqs[i]) { freqs[i] = 1; used++; }
  }

  var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function writeTokens(w, t, litCode, litLen, distCode, distLen) {
    for (var i = 0; i < t.len.length; i++) {
      if (!t.len[i]) { litCode(w, t.lit[i]); continue; }
      var L = t.len[i], D = t.dist[i];
      var li = findIndex(LEN_BASE, L);
      litCode(w, 257 + li);
      if (LEN_EXTRA[li]) w.bits(L - LEN_BASE[li], LEN_EXTRA[li]);
      var di = findIndex(DIST_BASE, D);
      if (distCode) w.code(distCode[di], distLen[di]); else w.code(di, 5);
      if (DIST_EXTRA[di]) w.bits(D - DIST_BASE[di], DIST_EXTRA[di]);
    }
    litCode(w, 256); // end of block
  }

  function encodeFixed(t) {
    var w = new BitWriter();
    w.bits(1, 1); w.bits(1, 2); // BFINAL = 1, BTYPE = 01 (fixed Huffman)
    writeTokens(w, t, fixedLiteral, null, null, null);
    return w.finish();
  }

  function encodeDynamic(t) {
    var litFreq = new Uint32Array(286), distFreq = new Uint32Array(30), i;
    for (i = 0; i < t.len.length; i++) {
      if (!t.len[i]) litFreq[t.lit[i]]++;
      else { litFreq[257 + findIndex(LEN_BASE, t.len[i])]++; distFreq[findIndex(DIST_BASE, t.dist[i])]++; }
    }
    litFreq[256] = 1;
    atLeastTwo(litFreq); atLeastTwo(distFreq);
    var litLen = huffLengths(litFreq, 15), distLen = huffLengths(distFreq, 15);
    var litCodes = canonicalCodes(litLen), distCodes = canonicalCodes(distLen);
    var hlit = 286; while (hlit > 257 && !litLen[hlit - 1]) hlit--;
    var hdist = 30; while (hdist > 1 && !distLen[hdist - 1]) hdist--;
    var all = Array.prototype.slice.call(litLen, 0, hlit).concat(Array.prototype.slice.call(distLen, 0, hdist));
    var rle = [], extra = []; // run-length coded code lengths (16 = repeat previous, 17/18 = zeros)
    for (i = 0; i < all.length;) {
      var v = all[i], run = 1;
      while (i + run < all.length && all[i + run] === v) run++;
      if (v === 0 && run >= 11) { var z = Math.min(run, 138); rle.push(18); extra.push(z - 11); i += z; }
      else if (v === 0 && run >= 3) { var z2 = Math.min(run, 10); rle.push(17); extra.push(z2 - 3); i += z2; }
      else if (v !== 0 && run >= 4) {
        rle.push(v); extra.push(0); i++; run--;
        while (run >= 3) { var r = Math.min(run, 6); rle.push(16); extra.push(r - 3); i += r; run -= r; }
      } else { rle.push(v); extra.push(0); i++; }
    }
    var clFreq = new Uint32Array(19);
    rle.forEach(function (sym) { clFreq[sym]++; });
    atLeastTwo(clFreq);
    var clLen = huffLengths(clFreq, 7), clCodes = canonicalCodes(clLen);
    var hclen = 19; while (hclen > 4 && !clLen[CL_ORDER[hclen - 1]]) hclen--;
    var w = new BitWriter();
    w.bits(1, 1); w.bits(2, 2); // BFINAL = 1, BTYPE = 10 (dynamic Huffman)
    w.bits(hlit - 257, 5); w.bits(hdist - 1, 5); w.bits(hclen - 4, 4);
    for (i = 0; i < hclen; i++) w.bits(clLen[CL_ORDER[i]], 3);
    for (i = 0; i < rle.length; i++) {
      w.code(clCodes[rle[i]], clLen[rle[i]]);
      if (rle[i] === 16) w.bits(extra[i], 2);
      else if (rle[i] === 17) w.bits(extra[i], 3);
      else if (rle[i] === 18) w.bits(extra[i], 7);
    }
    writeTokens(w, t, function (bw, sym) { bw.code(litCodes[sym], litLen[sym]); }, null, distCodes, distLen);
    return w.finish();
  }

  // Raw deflate: one block, Huffman codes fitted to the data (or the fixed code when that is smaller).
  function deflateRaw(data) {
    var t = lz77(data);
    var dyn = encodeDynamic(t), fixed = encodeFixed(t);
    return new Uint8Array(dyn.length < fixed.length ? dyn : fixed);
  }

  // --- inflate (RFC 1951): stored, fixed and dynamic blocks (canonical Huffman, puff-style decoding).
  // Returns { out: Uint8Array, used: bytes consumed }. Throws on a damaged stream.
  function inflateRaw(src) {
    var bytePos = 0, bitBuf = 0, bitCnt = 0;
    var out = new Uint8Array(Math.max(1024, src.length * 4)), outLen = 0;
    function need(k) {
      while (bitCnt < k) {
        if (bytePos >= src.length) throw new Error('truncated');
        bitBuf |= src[bytePos++] << bitCnt; bitCnt += 8;
      }
    }
    function bits(k) { need(k); var v = bitBuf & ((1 << k) - 1); bitBuf >>>= k; bitCnt -= k; return v; }
    function put(b) {
      if (outLen === out.length) { var bigger = new Uint8Array(out.length * 2); bigger.set(out); out = bigger; }
      out[outLen++] = b;
    }
    function build(lengths, count) {
      var h = { count: new Uint16Array(16), symbol: new Uint16Array(count) }, offs = new Uint16Array(16), s;
      for (s = 0; s < count; s++) h.count[lengths[s]]++;
      if (h.count[0] === count) return h; // no codes: fine as long as it is never used
      var left = 1;
      for (var len = 1; len < 16; len++) { left <<= 1; left -= h.count[len]; if (left < 0) throw new Error('bad code lengths'); }
      for (len = 1; len < 15; len++) offs[len + 1] = offs[len] + h.count[len];
      for (s = 0; s < count; s++) if (lengths[s]) h.symbol[offs[lengths[s]]++] = s;
      return h;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        code |= bits(1);
        var c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('bad code');
    }
    var fixedLit = null, fixedDist = null;
    function fixedTables() {
      if (fixedLit) return;
      var l = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      fixedLit = build(l, 288);
      var d = new Uint8Array(30); for (i = 0; i < 30; i++) d[i] = 5;
      fixedDist = build(d, 30);
    }
    var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    function codes(lit, dist) {
      for (;;) {
        var sym = decode(lit);
        if (sym < 256) put(sym);
        else if (sym === 256) return;
        else {
          sym -= 257;
          if (sym >= 29) throw new Error('bad length');
          var len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
          var ds = decode(dist);
          if (ds >= 30) throw new Error('bad distance');
          var dd = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
          if (dd > outLen) throw new Error('distance too far');
          for (var i = 0; i < len; i++) put(out[outLen - dd]);
        }
      }
    }
    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        if (bytePos + 4 > src.length) throw new Error('truncated');
        var len = src[bytePos] | (src[bytePos + 1] << 8), nlen = src[bytePos + 2] | (src[bytePos + 3] << 8);
        bytePos += 4;
        if (len !== (~nlen & 0xffff)) throw new Error('bad stored block');
        if (bytePos + len > src.length) throw new Error('truncated');
        for (var i = 0; i < len; i++) put(src[bytePos++]);
      } else if (type === 1) {
        fixedTables();
        codes(fixedLit, fixedDist);
      } else if (type === 2) {
        var nlit = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlit > 286 || ndist > 30) throw new Error('bad counts');
        var cl = new Uint8Array(19);
        for (i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
        var lencode = build(cl, 19);
        var lengths = new Uint8Array(nlit + ndist), idx = 0;
        while (idx < nlit + ndist) {
          var sy = decode(lencode);
          if (sy < 16) lengths[idx++] = sy;
          else {
            var rep, val = 0;
            if (sy === 16) { if (!idx) throw new Error('bad repeat'); val = lengths[idx - 1]; rep = 3 + bits(2); }
            else if (sy === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (idx + rep > nlit + ndist) throw new Error('too many lengths');
            while (rep--) lengths[idx++] = val;
          }
        }
        if (!lengths[256]) throw new Error('no end code');
        codes(build(lengths.subarray(0, nlit), nlit), build(lengths.subarray(nlit), ndist));
      } else {
        throw new Error('bad block type');
      }
    } while (!last);
    return { out: out.subarray(0, outLen), used: bytePos };
  }

  function zlibWrap(bytes) {
    var body = deflateRaw(bytes);
    var out = new Uint8Array(body.length + 6);
    out[0] = 0x78; out[1] = 0x01; // deflate, 32K window, fastest-level flag ((0x78<<8|0x01) % 31 === 0)
    out.set(body, 2);
    var a = adler32(bytes), p = body.length + 2;
    out[p] = a >>> 24; out[p + 1] = (a >>> 16) & 255; out[p + 2] = (a >>> 8) & 255; out[p + 3] = a & 255;
    return out;
  }

  function zlibUnwrap(bytes) {
    if (bytes.length < 7 || (bytes[0] & 0x0f) !== 8 || ((bytes[0] << 8) | bytes[1]) % 31 !== 0 || (bytes[1] & 0x20)) throw new Error('not zlib');
    var r = inflateRaw(bytes.subarray(2));
    var p = 2 + r.used;
    if (p + 4 > bytes.length) throw new Error('truncated');
    var want = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    if (adler32(r.out) !== want) throw new Error('checksum');
    return r.out;
  }

  var DAMAGED = 'This code looks damaged or cut short. Copy the whole code again (it starts with CUBE1.) and paste all of it here.';

  // Strips what messaging apps add: whitespace and line breaks (incl. non-breaking spaces), zero-width
  // characters, straight/smart quotes and backticks. Returns '' when there is nothing left.
  function cleanCode(text) {
    return String(text == null ? '' : text)
      .replace(/[\s​-‍⁠﻿­]+/g, '')
      .replace(/["'`‘’‚‛“”„‟«»′″´]/g, '');
  }

  function exportCode(data) {
    var json = JSON.stringify(normalize(migrate(copy(data))));
    return CODE_PREFIX + b64Encode(zlibWrap(utf8Encode(json)));
  }

  // Parses a progress code (see above). Throws an Error with a friendly message. Does NOT save.
  function importCode(text) {
    var raw = String(text == null ? '' : text).replace(/^[\s﻿]+/, '');
    if (raw.charAt(0) === '{') return importJSON(raw); // the text of a JSON backup: fine too
    var t = cleanCode(raw);
    if (!t) throw new Error('Paste your progress code first. It starts with CUBE1.');
    var at = t.toUpperCase().indexOf(CODE_PREFIX);
    if (at === -1) {
      if (/^CUBE\d+\./i.test(t)) throw new Error('This code is from a newer version of Cube Coach. Update Cube Coach on this device (reload it), then try again.');
      throw new Error('That doesn’t look like a Cube Coach progress code. It should start with CUBE1.');
    }
    var bytes = b64Decode(t.slice(at + CODE_PREFIX.length));
    if (bytes.length < 2) throw new Error(DAMAGED);
    var json;
    if (bytes[0] === 0x7b) { // '{': plain base64 JSON
      try { json = utf8Decode(bytes); } catch (e) { throw new Error(DAMAGED); }
      var end = json.lastIndexOf('}'); // forgive junk decoded from text after the code
      if (end !== -1) json = json.slice(0, end + 1);
    } else {
      try { json = utf8Decode(zlibUnwrap(bytes)); } catch (e2) { throw new Error(DAMAGED); }
    }
    try { return importJSON(json); } catch (e3) {
      throw new Error(/JSON/.test(e3.message) ? DAMAGED : e3.message.replace('That file', 'That code').replace('The backup', 'The code'));
    }
  }

  // ------------------------------------------------------------ merging progress from two devices
  // Settings that belong to one device and never travel with progress (camera, theme, keyboard).
  var DEVICE_SETTINGS = ['theme', 'mirror', 'autoCapture', 'cameraId', 'cameraLabel', 'cameraFacing', 'keyboard'];

  function time(iso) { var t = typeof iso === 'string' ? Date.parse(iso) : NaN; return isFinite(t) ? t : null; }
  function laterIso(a, b) { var ta = time(a), tb = time(b); if (ta == null) return tb == null ? (a || b || null) : b; if (tb == null) return a; return tb > ta ? b : a; }
  function earlierIso(a, b) { var ta = time(a), tb = time(b); if (ta == null) return tb == null ? (a || b || null) : b; if (tb == null) return a; return tb < ta ? b : a; }
  function stableJSON(v) {
    if (Array.isArray(v)) return '[' + v.map(stableJSON).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJSON(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  // Deterministic choice between two records, independent of argument order.
  function pick(a, b, cmp) {
    var c = cmp(a, b);
    if (c > 0) return a;
    if (c < 0) return b;
    return stableJSON(a) >= stableJSON(b) ? a : b;
  }
  function solveKey(s) { return s.id != null && s.id !== '' ? 'id:' + s.id : 'at:' + s.at + '|' + s.totalMs + '|' + s.device; }
  function cmpNum(x, y) { x = num(x, -Infinity); y = num(y, -Infinity); return x > y ? 1 : x < y ? -1 : 0; }
  function cmpTime(x, y) { var a = time(x), b = time(y); a = a == null ? -Infinity : a; b = b == null ? -Infinity : b; return a > b ? 1 : a < b ? -1 : 0; }

  function mergeSolves(a, b) {
    var byKey = {};
    a.concat(b).forEach(function (s) {
      var k = solveKey(s);
      byKey[k] = has(byKey, k) ? pick(byKey[k], s, function (x, y) {
        return (x.completed === y.completed ? 0 : x.completed ? 1 : -1) || (Object.keys(x).length - Object.keys(y).length);
      }) : s;
    });
    var list = Object.keys(byKey).map(function (k) { return byKey[k]; });
    list.sort(function (x, y) {
      return (cmpTime(x.at, y.at)) || (solveKey(x) < solveKey(y) ? -1 : solveKey(x) > solveKey(y) ? 1 : 0);
    });
    if (list.length > MAX_SOLVES) list = list.slice(list.length - MAX_SOLVES);
    return list;
  }

  function mergeMap(a, b, fn) {
    var out = {};
    keys(a).forEach(function (k) { out[k] = has(b, k) ? fn(a[k], b[k]) : a[k]; });
    keys(b).forEach(function (k) { if (!has(out, k)) out[k] = b[k]; });
    return out;
  }

  function mergeSkill(x, y) {
    var top = pick(x, y, function (p, q) { return cmpNum(p.mastery, q.mastery) || cmpNum(p.sessions, q.sessions) || -cmpNum(p.lastLevel, q.lastLevel); });
    var other = top === x ? y : x;
    var out = {};
    keys(other).forEach(function (k) { out[k] = other[k]; });
    keys(top).forEach(function (k) { out[k] = top[k]; });
    out.mastery = Math.max(num(x.mastery, 0), num(y.mastery, 0));
    out.sessions = Math.max(num(x.sessions, 0), num(y.sessions, 0));
    out.soloClean = Math.max(num(x.soloClean, 0), num(y.soloClean, 0));
    out.lastPracticed = laterIso(x.lastPracticed, y.lastPracticed);
    return out;
  }

  function mergeCounts(x, y) { // drills: { right, total, lastAt } — keep the larger totals
    if (!isObj(x)) return y; if (!isObj(y)) return x;
    var top = pick(x, y, function (p, q) { return cmpNum(p.total, q.total) || cmpNum(p.right, q.right) || cmpTime(p.lastAt, q.lastAt); });
    var out = shallow(top);
    out.lastAt = laterIso(x.lastAt, y.lastAt);
    return out;
  }

  function mergeGymDrill(x, y) { // gym: { right, total, streak, best, bestMs, bestRoundMs, lastAt, recent }
    var out = mergeCounts(x, y);
    if (!isObj(x) || !isObj(y)) return out;
    var best = Math.max(num(x.best, -Infinity), num(y.best, -Infinity));
    if (isFinite(best)) out.best = best;
    var ms = [x.bestMs, y.bestMs].filter(function (v) { return typeof v === 'number' && isFinite(v) && v > 0; });
    if (ms.length) out.bestMs = Math.min.apply(null, ms);
    var rm = [x.bestRoundMs, y.bestRoundMs].filter(function (v) { return typeof v === 'number' && isFinite(v) && v > 0; });
    if (rm.length) out.bestRoundMs = Math.min.apply(null, rm);   // fastest perfect round on either device
    return out;
  }

  function mergeAlg(x, y) { // algs: { box, due, right, total } — keep the higher box
    if (!isObj(x)) return y; if (!isObj(y)) return x;
    var top = pick(x, y, function (p, q) { return cmpNum(p.box, q.box) || cmpNum(p.total, q.total) || cmpTime(p.due, q.due); });
    var counts = pick(x, y, function (p, q) { return cmpNum(p.total, q.total) || cmpNum(p.right, q.right); });
    var out = shallow(top);
    out.right = num(counts.right, 0);
    out.total = num(counts.total, 0);
    return out;
  }

  // merge(local, incoming) -> new data. Pure (inputs untouched). Progress from both is kept:
  //   solves: union by id (the same solve on both sides counts once); skills: higher mastery, larger
  //   session count, latest practice date; drills & gym: the record with the larger total (best
  //   streak and best time kept); practiceLog: per day the larger minutes; milestones: earliest date;
  //   algs: the higher Leitner box. Settings stay this device's (keys it lacks are filled in).
  // Idempotent (merging the same code twice changes nothing) and order-independent for progress.
  function merge(local, incoming) {
    var a = normalize(migrate(copy(local))), b = normalize(migrate(copy(incoming)));
    var out = {};
    keys(b).forEach(function (k) { out[k] = b[k]; });   // unknown top-level keys: local wins,
    keys(a).forEach(function (k) { out[k] = a[k]; });   // incoming fills the gaps
    out.version = Math.max(num(a.version, VERSION), num(b.version, VERSION));
    out.createdAt = earlierIso(a.createdAt, b.createdAt) || a.createdAt;
    var settings = {};
    keys(b.settings).forEach(function (k) { if (DEVICE_SETTINGS.indexOf(k) === -1) settings[k] = b.settings[k]; });
    keys(a.settings).forEach(function (k) { settings[k] = a.settings[k]; });
    out.settings = settings;
    out.skills = mergeMap(a.skills, b.skills, mergeSkill);
    out.solves = mergeSolves(a.solves, b.solves);
    out.drills = mergeMap(a.drills, b.drills, mergeCounts);
    if (isObj(a.gym) || isObj(b.gym)) out.gym = mergeMap(isObj(a.gym) ? a.gym : {}, isObj(b.gym) ? b.gym : {}, mergeGymDrill);
    out.algs = mergeMap(a.algs, b.algs, mergeAlg);
    out.practiceLog = mergeMap(a.practiceLog, b.practiceLog, function (x, y) { return Math.max(x, y); });
    out.milestones = mergeMap(a.milestones, b.milestones, earlierIso);
    return normalize(out);
  }

  // replace(local, incoming) -> incoming progress, keeping this device's own settings (camera, theme,
  // keyboard). Pure.
  function replace(local, incoming) {
    var a = normalize(migrate(copy(local))), out = normalize(migrate(copy(incoming)));
    DEVICE_SETTINGS.forEach(function (k) {
      if (has(a.settings, k)) out.settings[k] = a.settings[k]; else delete out.settings[k];
    });
    return out;
  }

  // A plain summary for previews: "this code has 42 solves, 18 practice days…". Pure.
  function summary(data) {
    var d = normalize(migrate(copy(data)));
    var completed = d.solves.filter(function (s) { return s.completed !== false; });
    var full = completed.filter(function (s) { return !s.stage && s.source !== 'drill'; });
    var best = null;
    full.forEach(function (s) { if (best == null || s.totalMs < best) best = s.totalMs; });
    var days = keys(d.practiceLog).filter(function (k) { return d.practiceLog[k] > 0; });
    var minutes = days.reduce(function (t, k) { return t + d.practiceLog[k]; }, 0);
    var last = null;
    d.solves.forEach(function (s) { last = laterIso(last, s.at); });
    days.forEach(function (k) { var iso = k + 'T12:00:00.000Z'; if (time(iso) != null) last = laterIso(last, iso); });
    keys(d.skills).forEach(function (k) { last = laterIso(last, d.skills[k].lastPracticed); });
    var strong = STAGE_IDS.filter(function (id) { return d.skills[id] && d.skills[id].mastery >= 78; });
    var drillAnswers = keys(d.drills).reduce(function (t, k) { return t + num(d.drills[k].total, 0); }, 0);
    return {
      solves: d.solves.length, completed: completed.length, fullSolves: full.length, bestMs: best,
      practiceDays: days.length, practiceMinutes: minutes, milestones: keys(d.milestones).length,
      strongStages: strong.length, drillAnswers: drillAnswers, createdAt: d.createdAt, lastActive: last
    };
  }

  // Test / embedding hook: pass a Storage-like object, null for memory-only, or undefined to auto-detect.
  function useStorage(storage) {
    injected = storage;
    memory = {};
    memoryNewer = false;
  }

  function persistent() { return !!detectStorage() && !memoryNewer; }

  var Store = {
    KEY: KEY, CORRUPT_KEY: CORRUPT_KEY, VERSION: VERSION, MAX_SOLVES: MAX_SOLVES,
    STAGE_IDS: STAGE_IDS, ALG_IDS: ALG_IDS, MIGRATIONS: MIGRATIONS,
    defaults: defaults, load: load, save: save, reset: reset,
    exportJSON: exportJSON, importJSON: importJSON,
    exportCode: exportCode, importCode: importCode, merge: merge, replace: replace, summary: summary,
    CODE_PREFIX: CODE_PREFIX, DEVICE_SETTINGS: DEVICE_SETTINGS,
    migrate: migrate, normalize: normalize, defaultSkill: defaultSkill,
    useStorage: useStorage, persistent: persistent,
    // exposed for tests
    _deflateRaw: deflateRaw, _inflateRaw: inflateRaw, _zlibWrap: zlibWrap, _zlibUnwrap: zlibUnwrap,
    _b64Encode: b64Encode, _b64Decode: b64Decode, _cleanCode: cleanCode, _adler32: adler32
  };

  root.CC = root.CC || {};
  root.CC.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
