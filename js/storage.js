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
    migrate: migrate, normalize: normalize, defaultSkill: defaultSkill,
    useStorage: useStorage, persistent: persistent
  };

  root.CC = root.CC || {};
  root.CC.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
