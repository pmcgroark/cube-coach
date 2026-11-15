// node tests/platform.test.js            — the iPhone / offline platform: progress codes (CC.Store),
//                                          service worker + precache list, manifest, icons, three.js,
//                                          CC.App keepAwake / swDecision / platform helpers.
// node tests/platform.test.js --stamp    — writes PRECACHE (every app file) and VERSION (date + content
//                                          hash) into sw.js. Run it before publishing an update: a new
//                                          VERSION is what makes installed copies fetch the new files.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const rel = (...p) => path.join(ROOT, ...p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

// ------------------------------------------------------------------ precache list (shared with --stamp)
const PRECACHE_DIRS = ['css', 'js', 'vendor', 'icons'];
const PRECACHE_TOP = ['index.html', 'manifest.webmanifest'];

function walk(dir) {
  const abs = rel(dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return []; // .DS_Store & co
    const p = dir + '/' + e.name;
    return e.isDirectory() ? walk(p) : [p];
  });
}
function appFiles() {
  return PRECACHE_TOP.concat(...PRECACHE_DIRS.map((d) => walk(d).sort()));
}
function contentHash(files) {
  const h = crypto.createHash('sha256');
  files.slice().sort().forEach((f) => { h.update(f + '\0'); h.update(fs.readFileSync(rel(f))); h.update('\0'); });
  return h.digest('hex').slice(0, 8);
}
function loadSW() {
  const src = read('sw.js');
  const m = {};
  vm.runInNewContext(src + '\n;__out.VERSION = VERSION; __out.PRECACHE = PRECACHE; __out.CACHE = CACHE; __out.CACHE_PREFIX = CACHE_PREFIX;', { __out: m, URL });
  return { src, ...m };
}

if (process.argv.includes('--stamp')) {
  const files = appFiles();
  const sw = loadSW();
  const hash = contentHash(files);
  const sameList = JSON.stringify(sw.PRECACHE) === JSON.stringify(files);
  const sameHash = String(sw.VERSION).split('.')[1] === hash;
  if (sameList && sameHash) { console.log('sw.js is already up to date (' + sw.VERSION + ', ' + files.length + ' files).'); process.exit(0); }
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const version = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.' + hash;
  let src = sw.src.replace(/var VERSION = '[^']*';/, "var VERSION = '" + version + "';");
  src = src.replace(/var PRECACHE = \[[\s\S]*?\];/, 'var PRECACHE = [\n' + files.map((f) => "  '" + f + "'").join(',\n') + '\n];');
  fs.writeFileSync(rel('sw.js'), src);
  console.log('sw.js stamped: VERSION ' + version + ', ' + files.length + ' files precached.');
  process.exit(0);
}

// ------------------------------------------------------------------ runner
let passed = 0;
const pendingTests = [];
function test(name, fn) {
  pendingTests.push(async () => {
    try { await fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack); process.exitCode = 1; }
  });
}

require('../js/cube.js');
const Store = require('../js/storage.js');
const Coach = require('../js/coach.js');
const { App } = require('../js/app.js');
App._stopPracticeTimer();

// ------------------------------------------------------------------ realistic progress data
function rng(seed) { return globalThis.CC.Cube.mulberry32(seed); }
const DAY = 864e5;
function makeData(seed, nSolves, startMs) {
  const r = rng(seed);
  const d = Store.defaults(new Date(startMs));
  const stages = Store.STAGE_IDS;
  for (let i = 0; i < nSolves; i++) {
    const t = new Date(startMs + i * DAY / 3 + Math.floor(r() * 3e6));
    const device = r() < 0.5 ? 'virtual' : 'physical';
    stages.forEach((st) => Coach.recordStage(d, st, { level: Math.floor(r() * 4), hints: Math.floor(r() * 3), ms: 5000 + Math.floor(r() * 60000), quizRight: 1, quizTotal: 2, device }, t));
    const splits = {}, levels = {}, hints = {};
    stages.forEach((st) => { splits[st] = 4000 + Math.floor(r() * 50000); levels[st] = Math.floor(r() * 4); hints[st] = Math.floor(r() * 2); });
    Coach.recordSolve(d, {
      at: t.toISOString(), device, source: r() < 0.7 ? 'scramble' : 'scan', stage: null,
      scramble: globalThis.CC.Cube.scramble(20, seed * 1000 + i).join(' '),
      totalMs: Object.keys(splits).reduce((s, k) => s + splits[k], 0), splits, levels, hints,
      quiz: { right: 2, total: 3 }, completed: r() < 0.9
    }, t);
    if (i % 3 === 0) Coach.recordDrill(d, ['notation', 'recognise', 'reps'][i % 3 === 0 ? (i / 3) % 3 : 0], r() < 0.7, t);
    if (i % 4 === 0) Coach.gradeAlg(d, ['rtrigger', 'mid-right', 'mid-left', 'sune'][i % 4 === 0 ? (i / 4) % 4 : 0], r() < 0.8, t);
    Coach.logPractice(d, 5 + Math.floor(r() * 20), t);
  }
  d.gym = {
    spot: { right: 7, total: 10, streak: 3, best: 5, bestMs: 2100, lastAt: new Date(startMs + 2 * DAY).toISOString(), recent: [1, 1, 0, 1, 1, 1, 0, 1, 1, 0] },
    lineup: { right: 2, total: 3, streak: 0, best: 2, bestMs: null, lastAt: new Date(startMs + DAY).toISOString(), recent: [1, 1, 0] }
  };
  d.settings.cameraId = 'laptop-cam-' + seed;
  d.settings.theme = 'dark';
  d.settings.welcomeDismissed = true;
  return d;
}
const T0 = Date.UTC(2026, 9, 1, 9);
const norm = (d) => Store.normalize(Store.migrate(JSON.parse(JSON.stringify(d))));
const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

// ------------------------------------------------------------------ deflate / inflate / base64
test('deflate output is valid raw deflate (checked by node zlib) for many inputs', () => {
  const r = rng(7);
  const inputs = [new Uint8Array(0), new Uint8Array([65]), new Uint8Array(70000).fill(97)];
  for (let i = 0; i < 40; i++) {
    const n = Math.floor(r() * 5000);
    const a = new Uint8Array(n);
    const alpha = 1 + Math.floor(r() * 255);
    for (let j = 0; j < n; j++) a[j] = Math.floor(r() * alpha);
    inputs.push(a);
  }
  // long-distance repeats (> 32 KB apart) and long runs
  const big = Buffer.from(JSON.stringify(makeData(3, 150, T0)));
  inputs.push(new Uint8Array(big), new Uint8Array(Buffer.concat([big.subarray(0, 40000), crypto.randomBytes(40000), big.subarray(0, 40000)])));
  for (const a of inputs) {
    const d = Store._deflateRaw(a);
    assert.ok(Buffer.from(zlib.inflateRawSync(Buffer.from(d))).equals(Buffer.from(a)), 'zlib inflates our deflate (n=' + a.length + ')');
    const back = Store._inflateRaw(d);
    assert.ok(Buffer.from(back.out).equals(Buffer.from(a)), 'own round trip');
    assert.strictEqual(back.used, d.length);
  }
});

test('inflate reads what node zlib writes: stored, fixed and dynamic blocks', () => {
  const samples = [Buffer.from(JSON.stringify(makeData(5, 60, T0))), crypto.randomBytes(3000), Buffer.alloc(0), Buffer.from('a')];
  const opts = [{ level: 0 }, { level: 1 }, { level: 6 }, { level: 9 }, { strategy: zlib.constants.Z_FIXED }, { strategy: zlib.constants.Z_HUFFMAN_ONLY }, { strategy: zlib.constants.Z_RLE }, { level: 9, memLevel: 1, windowBits: 9 }];
  for (const s of samples) for (const o of opts) {
    const z = zlib.deflateRawSync(s, o);
    assert.ok(Buffer.from(Store._inflateRaw(new Uint8Array(z)).out).equals(s), JSON.stringify(o) + ' n=' + s.length);
    const zz = zlib.deflateSync(s, o);
    assert.ok(Buffer.from(Store._zlibUnwrap(new Uint8Array(zz))).equals(s), 'zlib wrapper ' + JSON.stringify(o));
  }
  const ours = Store._zlibWrap(new Uint8Array(samples[0]));
  assert.ok(zlib.inflateSync(Buffer.from(ours)).equals(samples[0]), 'node reads our zlib stream (header + Adler-32)');
  const bad = Uint8Array.from(ours); bad[bad.length - 1] ^= 1;
  assert.throws(() => Store._zlibUnwrap(bad), /checksum/);
  assert.throws(() => Store._inflateRaw(ours.subarray(2, 30)), /truncated|bad|distance/);
});

test('base64 matches node, and decoding forgives junk and missing padding', () => {
  const r = rng(11);
  for (let n = 0; n < 200; n++) {
    const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
    const enc = Store._b64Encode(b);
    assert.strictEqual(enc, Buffer.from(b).toString('base64'));
    assert.ok(Buffer.from(Store._b64Decode(enc)).equals(Buffer.from(b)));
    assert.ok(Buffer.from(Store._b64Decode(enc.replace(/=+$/, ''))).equals(Buffer.from(b)), 'no padding');
  }
  assert.strictEqual(Buffer.from(Store._b64Decode('SGV s\nbG8=')).toString(), 'Hello');
});

// ------------------------------------------------------------------ progress codes
test('progress code round trip: realistic data comes back identical', () => {
  for (const [seed, n] of [[1, 0], [2, 1], [3, 40], [4, 300]]) {
    const d = makeData(seed, n, T0);
    const code = Store.exportCode(d);
    assert.ok(code.startsWith('CUBE1.'), 'prefix');
    assert.ok(/^CUBE1\.[A-Za-z0-9+/]+=*$/.test(code), 'only base64 characters after the prefix');
    same(Store.importCode(code), norm(d));
  }
  // also unicode in unknown keys / labels
  const u = makeData(9, 3, T0); u.settings.cameraLabel = 'Caméra FaceTime HD — “avant” ✓'; u.extra = { note: 'naïve café 🧊' };
  same(Store.importCode(Store.exportCode(u)), norm(u));
});

test('progress codes stay short enough for messaging apps (300 solves < 50 K characters)', () => {
  const d = makeData(4, 300, T0);
  const code = Store.exportCode(d);
  const json = JSON.stringify(norm(d));
  assert.ok(code.length < 50000, 'code length ' + code.length);
  assert.ok(code.length * 4 < json.length, 'at least 4x smaller than the JSON (' + json.length + ' -> ' + code.length + ')');
  // close to zlib's best (dynamic Huffman + lazy matching)
  const ours = Store._deflateRaw(new Uint8Array(Buffer.from(json))).length;
  const best = zlib.deflateRawSync(Buffer.from(json), { level: 9 }).length;
  assert.ok(ours < best * 1.1, 'within 10% of zlib -9 (' + ours + ' vs ' + best + ')');
  // dynamic block for real data, fixed block when that is smaller (tiny inputs)
  assert.strictEqual((Store._deflateRaw(new Uint8Array(Buffer.from(json)))[0] >> 1) & 3, 2, 'dynamic Huffman block');
  assert.strictEqual((Store._deflateRaw(new Uint8Array(Buffer.from('hi')))[0] >> 1) & 3, 1, 'fixed Huffman block');
  console.log('  (300 solves: JSON ' + json.length + ' chars -> code ' + code.length + ' chars)');
});

test('codes survive Messages / WhatsApp / Notes mangling', () => {
  const d = makeData(6, 25, T0);
  const code = Store.exportCode(d);
  const want = norm(d);
  const wrap = (s, n, sep) => s.replace(new RegExp('(.{' + n + '})', 'g'), '$1' + sep);
  const variants = [
    code,
    '  ' + code + '\n',
    wrap(code, 60, '\n'),
    wrap(code, 33, '\r\n'),
    wrap(code, 17, ' '),
    wrap(code, 40, ' '),          // non-breaking spaces
    wrap(code, 25, '​'),          // zero-width spaces
    '“' + code + '”',        // smart double quotes
    '‘' + code + '’',        // smart single quotes
    '"' + code + '"',
    '`' + code + '`',
    'Here’s my Cube Coach code: ' + code,
    'cube1.' + code.slice(6),          // auto-lowercased prefix
    code + '\n\nSent from my iPhone',  // junk after it
    code + ' Thanks!',
    '﻿' + wrap(code, 50, '\n') + '\n'
  ];
  variants.forEach((v, i) => same(Store.importCode(v), want, 'variant ' + i));
});

test('damaged or wrong codes give a friendly error, never wrong data', () => {
  const d = makeData(8, 12, T0);
  const code = Store.exportCode(d);
  const want = JSON.stringify(norm(d));
  assert.throws(() => Store.importCode(''), /Paste your progress code/);
  assert.throws(() => Store.importCode('   \n '), /Paste your progress code/);
  assert.throws(() => Store.importCode('hello there'), /doesn’t look like a Cube Coach progress code/);
  assert.throws(() => Store.importCode('CUBE2.abcd'), /newer version/);
  assert.throws(() => Store.importCode(code.slice(0, Math.floor(code.length / 2))), /damaged or cut short/);
  assert.throws(() => Store.importCode('CUBE1.'), /damaged/);
  // change one character at many positions: either an error or (padding bits) the very same data
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let p = 6; p < code.length; p += 7) {
    const c = code.charAt(p);
    if (c === '=') continue;
    const repl = B.charAt((B.indexOf(c) + 1 + (p % 61)) % 64);
    const broken = code.slice(0, p) + repl + code.slice(p + 1);
    let got = null;
    try { got = JSON.stringify(Store.importCode(broken)); } catch (e) { assert.ok(/damaged|Cube Coach/.test(e.message), e.message); continue; }
    assert.strictEqual(got, want, 'a changed character at ' + p + ' must not give different data');
  }
  // a JSON backup's text is accepted too; a plain base64-JSON code also works
  same(Store.importCode(Store.exportJSON(d)), norm(d));
  same(Store.importCode('CUBE1.' + Buffer.from(JSON.stringify(d)).toString('base64')), norm(d));
  assert.throws(() => Store.importCode('CUBE1.' + Buffer.from('{"foo":1}').toString('base64')), /does not contain any Cube Coach progress/);
});

// ------------------------------------------------------------------ merge / replace / summary
test('merge: union of solves by id, idempotent and order-independent', () => {
  const a = makeData(21, 30, T0);
  const b = makeData(22, 25, T0 + 5 * DAY);
  // a few solves on both devices (same id), one of them completed only on b
  const shared = JSON.parse(JSON.stringify(a.solves.slice(5, 9)));
  shared[0].completed = false;
  b.solves = b.solves.concat(shared);
  const ab = Store.merge(a, b), ba = Store.merge(b, a);
  const ids = (d) => d.solves.map((s) => s.id);
  assert.strictEqual(new Set(ids(ab)).size, ab.solves.length, 'no duplicate ids');
  assert.strictEqual(ab.solves.length, 30 + 25, 'union');
  same(ab.solves, ba.solves);
  same(ab.skills, ba.skills); same(ab.drills, ba.drills); same(ab.algs, ba.algs);
  same(ab.practiceLog, ba.practiceLog); same(ab.milestones, ba.milestones); same(ab.gym, ba.gym);
  same(Store.merge(ab, b), ab); same(Store.merge(ab, a), ab); same(Store.merge(a, a), norm(a));
  same(Store.merge(Store.merge(a, b), Store.merge(b, a)), ab);
  for (let i = 1; i < ab.solves.length; i++) assert.ok(Date.parse(ab.solves[i - 1].at) <= Date.parse(ab.solves[i].at), 'sorted by time');
  assert.strictEqual(ab.solves.find((s) => s.id === shared[0].id).completed, a.solves[5].completed !== false || false, 'the completed copy wins');
});

test('merge rules for skills, drills, gym, practice log, milestones and algs', () => {
  const a = Store.defaults(new Date(T0)), b = Store.defaults(new Date(T0 - 9 * DAY));
  a.skills.middle = { mastery: 40, sessions: 9, soloClean: 1, lastLevel: 2, lastPracticed: '2026-10-05T10:00:00.000Z' };
  b.skills.middle = { mastery: 55, sessions: 4, soloClean: 0, lastLevel: 1, lastPracticed: '2026-10-03T10:00:00.000Z' };
  a.drills.notation = { right: 8, total: 10, lastAt: '2026-10-09T00:00:00.000Z' };
  b.drills.notation = { right: 15, total: 30, lastAt: '2026-10-01T00:00:00.000Z' };
  b.drills.reps = { right: 1, total: 1, lastAt: null };
  a.gym = { spot: { right: 9, total: 12, streak: 4, best: 6, bestMs: 1800, lastAt: '2026-10-08T00:00:00.000Z', recent: [1] } };
  b.gym = { spot: { right: 5, total: 20, streak: 1, best: 3, bestMs: 2500, lastAt: '2026-10-02T00:00:00.000Z', recent: [0] }, mirror: { right: 1, total: 2 } };
  a.practiceLog = { '2026-10-01': 12, '2026-10-02': 5 };
  b.practiceLog = { '2026-10-01': 20, '2026-10-03': 7 };
  a.milestones = { 'first-solve': '2026-10-04T00:00:00.000Z' };
  b.milestones = { 'first-solve': '2026-10-02T00:00:00.000Z', 'streak-7': '2026-10-09T00:00:00.000Z' };
  a.algs = { sune: { box: 4, due: '2026-10-20T00:00:00.000Z', right: 3, total: 4 } };
  b.algs = { sune: { box: 2, due: '2026-10-10T00:00:00.000Z', right: 9, total: 14 } };
  for (const m of [Store.merge(a, b), Store.merge(b, a)]) {
    assert.deepStrictEqual([m.skills.middle.mastery, m.skills.middle.sessions, m.skills.middle.soloClean], [55, 9, 1]);
    assert.strictEqual(m.skills.middle.lastPracticed, '2026-10-05T10:00:00.000Z');
    assert.strictEqual(m.skills.middle.lastLevel, 1, 'level comes with the higher mastery');
    assert.deepStrictEqual([m.drills.notation.right, m.drills.notation.total], [15, 30]);
    assert.strictEqual(m.drills.notation.lastAt, '2026-10-09T00:00:00.000Z');
    assert.deepStrictEqual(m.drills.reps, { right: 1, total: 1, lastAt: null });
    assert.deepStrictEqual([m.gym.spot.total, m.gym.spot.right, m.gym.spot.best, m.gym.spot.bestMs], [20, 5, 6, 1800]);
    assert.strictEqual(m.gym.spot.lastAt, '2026-10-08T00:00:00.000Z');
    assert.deepStrictEqual(m.gym.mirror, { right: 1, total: 2 });
    assert.deepStrictEqual(m.practiceLog, { '2026-10-01': 20, '2026-10-02': 5, '2026-10-03': 7 });
    assert.deepStrictEqual(m.milestones, { 'first-solve': '2026-10-02T00:00:00.000Z', 'streak-7': '2026-10-09T00:00:00.000Z' });
    assert.strictEqual(m.algs.sune.box, 4);
    assert.strictEqual(m.algs.sune.due, '2026-10-20T00:00:00.000Z');
    assert.deepStrictEqual([m.algs.sune.right, m.algs.sune.total], [9, 14]);
    assert.strictEqual(m.createdAt, new Date(T0 - 9 * DAY).toISOString(), 'earliest start date');
  }
});

test('merge keeps this device’s settings, never touches its inputs, caps solves', () => {
  const phone = makeData(31, 5, T0);
  phone.settings.cameraId = 'rear'; phone.settings.cameraFacing = 'environment'; phone.settings.theme = 'light'; phone.settings.animSpeed = 1.5;
  delete phone.settings.welcomeDismissed;
  const laptop = makeData(32, 8, T0);
  laptop.settings.hasCube = true; laptop.settings.animSpeed = 0.5; laptop.settings.cameraFacing = 'user';
  laptop.unknownTopLevel = { keep: 1 };
  const before = JSON.stringify([phone, laptop]);
  const m = Store.merge(phone, laptop);
  assert.strictEqual(JSON.stringify([phone, laptop]), before, 'inputs unchanged');
  assert.strictEqual(m.settings.cameraId, 'rear');
  assert.strictEqual(m.settings.cameraFacing, 'environment');
  assert.strictEqual(m.settings.theme, 'light');
  assert.strictEqual(m.settings.animSpeed, 1.5, 'local preference kept');
  assert.strictEqual(m.settings.hasCube, true, 'missing non-device keys filled in');
  assert.strictEqual(m.settings.welcomeDismissed, true);
  assert.deepStrictEqual(m.unknownTopLevel, { keep: 1 });
  // replace: incoming progress, this device's camera/theme/keyboard
  const r = Store.replace(phone, laptop);
  same(r.solves, norm(laptop).solves);
  assert.strictEqual(r.settings.cameraId, 'rear');
  assert.strictEqual(r.settings.cameraFacing, 'environment');
  assert.strictEqual(r.settings.theme, 'light');
  assert.strictEqual(r.settings.animSpeed, 0.5, 'learning settings come with the progress');
  const noCam = Store.defaults(); delete noCam.settings.theme;
  assert.ok(!('cameraId' in Store.replace(noCam, laptop).settings), 'the other device’s camera never comes along');
  // the solve cap
  const many = Store.defaults(), more = Store.defaults();
  for (let i = 0; i < Store.MAX_SOLVES; i++) many.solves.push({ id: 'a' + i, at: new Date(T0 + i * 1000).toISOString(), totalMs: 1000 });
  for (let i = 0; i < 10; i++) more.solves.push({ id: 'b' + i, at: new Date(T0 + 1e9 + i).toISOString(), totalMs: 1000 });
  const capped = Store.merge(many, more);
  assert.strictEqual(capped.solves.length, Store.MAX_SOLVES);
  assert.strictEqual(capped.solves[capped.solves.length - 1].id, 'b9', 'the newest are kept');
});

test('summary counts what a code holds', () => {
  const d = Store.defaults(new Date(T0));
  d.solves = [
    { id: '1', at: '2026-10-02T10:00:00.000Z', totalMs: 300000, completed: true, stage: null, source: 'scramble' },
    { id: '2', at: '2026-10-03T10:00:00.000Z', totalMs: 200000, completed: true, stage: null, source: 'scan' },
    { id: '3', at: '2026-10-04T10:00:00.000Z', totalMs: 9000, completed: true, stage: 'middle', source: 'drill' },
    { id: '4', at: '2026-10-05T10:00:00.000Z', totalMs: 100000, completed: false, stage: null, source: 'scramble' }
  ];
  d.practiceLog = { '2026-10-02': 20, '2026-10-03': 15, '2026-10-06': 0 };
  d.milestones = { 'first-solve': '2026-10-02T10:00:00.000Z' };
  d.skills.daisy.mastery = 90; d.skills.cross.mastery = 80; d.skills.corners.mastery = 50;
  d.drills = { notation: { right: 5, total: 9, lastAt: null } };
  const s = Store.summary(d);
  assert.deepStrictEqual([s.solves, s.completed, s.fullSolves, s.bestMs], [4, 3, 2, 200000]);
  assert.deepStrictEqual([s.practiceDays, s.practiceMinutes, s.milestones, s.strongStages, s.drillAnswers], [2, 35, 1, 2, 9]);
  assert.strictEqual(s.lastActive, '2026-10-05T10:00:00.000Z');
  assert.strictEqual(Store.summary(Store.defaults()).bestMs, null);
});

// ------------------------------------------------------------------ service worker & precache
function htmlRefs() {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).map((tag) => ({
    rel: (/\brel="([^"]+)"/.exec(tag) || [])[1], href: (/\bhref="([^"]+)"/.exec(tag) || [])[1]
  })).filter((l) => l.href && !/^data:/.test(l.href));
  return { html, scripts, links };
}

test('index.html uses relative paths only and no CDN', () => {
  const { html, scripts, links } = htmlRefs();
  for (const u of scripts.concat(links.map((l) => l.href))) {
    assert.ok(!/^(\/|https?:|\/\/)/.test(u), 'relative, local URL: ' + u);
    assert.ok(fs.existsSync(rel(u)), 'exists: ' + u);
  }
  assert.ok(scripts.includes('vendor/three.min.js'), 'three.js is loaded from vendor/');
  assert.ok(scripts.indexOf('vendor/three.min.js') < scripts.indexOf('js/render3d.js'));
  assert.ok(!/cdnjs|unpkg|jsdelivr/.test(html), 'no CDN');
  for (const s of ['js/gym.js', 'js/topview.js', 'js/screens/gym.js']) assert.ok(scripts.includes(s), 'gym script kept: ' + s);
  assert.ok(links.some((l) => l.rel === 'manifest' && l.href === 'manifest.webmanifest'));
  assert.ok(links.some((l) => l.rel === 'apple-touch-icon' && l.href === 'icons/apple-touch-icon.png'));
  assert.ok(/<meta name="apple-mobile-web-app-capable" content="yes">/.test(html));
  assert.ok(/<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+">/.test(html));
  assert.ok(/<meta name="apple-mobile-web-app-title" content="Cube Coach">/.test(html));
  assert.ok(/viewport-fit=cover/.test(html), 'safe-area insets need viewport-fit=cover');
  // nothing in the app code points at an absolute /js/ path or a CDN
  for (const f of walk('js').concat(walk('css'))) {
    const src = read(f);
    assert.ok(!/["'(]\/(js|css|vendor|icons)\//.test(src), 'no absolute app paths in ' + f);
    assert.ok(!/cdnjs\.cloudflare|unpkg\.com|jsdelivr/.test(src), 'no CDN in ' + f);
  }
});

test('every app file is precached under a versioned cache name', () => {
  const sw = loadSW();
  const { scripts, links } = htmlRefs();
  const list = new Set(sw.PRECACHE);
  assert.ok(/^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}$/.test(sw.VERSION), 'VERSION is date.hash: ' + sw.VERSION);
  assert.strictEqual(sw.CACHE, sw.CACHE_PREFIX + sw.VERSION);
  assert.ok(sw.CACHE_PREFIX === 'cube-coach-');
  const fix = 'run: node tests/platform.test.js --stamp';
  for (const u of scripts) assert.ok(list.has(u), '<script src="' + u + '"> is not in sw.js PRECACHE — ' + fix);
  for (const l of links) assert.ok(list.has(l.href), '<link href="' + l.href + '"> is not in sw.js PRECACHE — ' + fix);
  for (const f of appFiles()) assert.ok(list.has(f), f + ' is not in sw.js PRECACHE — ' + fix);
  for (const u of sw.PRECACHE) {
    assert.ok(!/^(\/|https?:)/.test(u), 'relative: ' + u);
    assert.ok(fs.existsSync(rel(u)), 'precached file exists: ' + u + ' — ' + fix);
  }
  assert.strictEqual(list.size, sw.PRECACHE.length, 'no duplicates');
  assert.ok(!list.has('sw.js'), 'the worker itself is not precached');
  for (const must of ['index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/three.min.js', 'icons/apple-touch-icon.png']) assert.ok(list.has(must), must);
});

// A fake service-worker global to run sw.js's handlers in node.
function swHarness() {
  const SCOPE = 'https://example.test/cube-coach/';
  const listeners = {};
  const net = { online: true, log: [] };
  const store = new Map();
  const abs = (u) => new URL(typeof u === 'string' ? u : u.url, SCOPE + 'sw.js').href;
  class Req { constructor(u, o = {}) { this.url = abs(u); this.cache = o.cache || 'default'; this.method = o.method || 'GET'; this.mode = o.mode || 'cors'; } }
  const respond = (url) => {
    const p = new URL(url).pathname.replace(/^\/cube-coach\//, '');
    const file = p === '' ? 'index.html' : p;
    const ok = fs.existsSync(rel(file)) && fs.statSync(rel(file)).isFile();
    return { ok, status: ok ? 200 : 404, type: 'basic', url, file, clone() { return this; } };
  };
  const fetchFn = async (r) => {
    const req = typeof r === 'string' ? new Req(r) : r;
    net.log.push({ url: req.url, cache: req.cache });
    if (!net.online) throw new TypeError('Failed to fetch');
    return respond(req.url);
  };
  const cacheApi = (m) => ({
    addAll: async (reqs) => { for (const r of reqs) { const res = await fetchFn(r); if (!res.ok) throw new TypeError('bad response ' + r.url); m.set(r.url, res); } },
    put: async (req, res) => { m.set(abs(req), res); },
    match: async (req, opts) => {
      const u = abs(req);
      if (m.has(u)) return m.get(u);
      if (opts && opts.ignoreSearch) { for (const [k, v] of m) if (k.split('?')[0] === u.split('?')[0]) return v; }
      return undefined;
    }
  });
  const caches = {
    open: async (n) => { if (!store.has(n)) store.set(n, new Map()); return cacheApi(store.get(n)); },
    keys: async () => [...store.keys()],
    delete: async (n) => store.delete(n)
  };
  const self = {
    location: new URL(SCOPE + 'sw.js'), registration: { scope: SCOPE },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => { self.skipped = true; return Promise.resolve(); },
    clients: { claim: () => { self.claimed = true; return Promise.resolve(); } }
  };
  const ctx = { self, caches, fetch: fetchFn, Request: Req, URL, Promise, console };
  vm.runInNewContext(read('sw.js'), ctx);
  const fire = async (type, extra) => {
    let p = null, responded = null;
    const ev = Object.assign({ waitUntil(x) { p = x; }, respondWith(x) { responded = x; } }, extra);
    listeners[type](ev);
    if (p) await p;
    return responded ? await responded : undefined;
  };
  return { SCOPE, self, net, store, fire, Req, ctx };
}

test('service worker: install precaches everything fresh, activate removes old versions', async () => {
  const sw = loadSW();
  const H = swHarness();
  H.store.set('cube-coach-2000-01-01.deadbeef', new Map());
  H.store.set('some-other-app', new Map());
  await H.fire('install');
  const cache = H.store.get(sw.CACHE);
  assert.ok(cache, 'versioned cache created');
  assert.strictEqual(cache.size, sw.PRECACHE.length, 'every file cached');
  assert.ok(H.net.log.every((r) => r.cache === 'reload'), 'install bypasses the HTTP cache');
  assert.ok(!H.self.skipped, 'a new version waits until the app says Reload');
  await H.fire('activate');
  assert.deepStrictEqual([...H.store.keys()].sort(), [sw.CACHE, 'some-other-app'].sort());
  assert.ok(H.self.claimed);
  await H.fire('message', { data: { type: 'SKIP_WAITING' } });
  assert.ok(H.self.skipped);
});

test('service worker: offline, every page and app file comes from the cache', async () => {
  const sw = loadSW();
  const H = swHarness();
  await H.fire('install'); await H.fire('activate');
  H.net.online = false;
  const nav = (u) => H.fire('fetch', { request: new H.Req(u, { mode: 'navigate' }) });
  for (const u of [H.SCOPE, H.SCOPE + '?sw=1', H.SCOPE + 'index.html', H.SCOPE + 'index.html?r=3', H.SCOPE + 'dev/render-demo.html']) {
    const res = await nav(u);
    assert.ok(res && res.ok && res.file === 'index.html', 'navigation ' + u + ' -> cached index.html');
  }
  for (const f of sw.PRECACHE) {
    const res = await H.fire('fetch', { request: new H.Req(H.SCOPE + f + (f.endsWith('.js') ? '?r=9' : '')) });
    assert.ok(res && res.ok && res.file === f, 'cached: ' + f);
  }
  // other origins and non-GET requests are left alone
  assert.strictEqual(await H.fire('fetch', { request: new H.Req('https://cdnjs.cloudflare.com/x.js') }), undefined);
  assert.strictEqual(await H.fire('fetch', { request: new H.Req(H.SCOPE + 'x', { method: 'POST' }) }), undefined);
  // status report for Settings
  let reply = null;
  await H.fire('message', { data: { type: 'STATUS' }, ports: [{ postMessage: (m) => { reply = m; } }] });
  assert.deepStrictEqual([reply.ready, reply.cached, reply.total, reply.version], [true, sw.PRECACHE.length, sw.PRECACHE.length, sw.VERSION]);
  // online: an uncached same-origin file is fetched (and kept for next time)
  H.net.online = true;
  const extra = await H.fire('fetch', { request: new H.Req(H.SCOPE + 'README.md') });
  assert.ok(extra.ok && extra.file === 'README.md');
  H.net.online = false;
  assert.ok((await H.fire('fetch', { request: new H.Req(H.SCOPE + 'README.md') })).ok, 'runtime-cached');
});

// ------------------------------------------------------------------ manifest & icons
function readPNG(file) {
  const b = fs.readFileSync(rel(file));
  assert.ok(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), file + ' PNG signature');
  const { crc32 } = require('../tools/make-icons.js');
  let p = 8, ihdr = null; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    assert.strictEqual(b.readUInt32BE(p + 8 + len), crc32(b.subarray(p + 4, p + 8 + len)), file + ' ' + type + ' CRC');
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colour: data[9] };
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = ihdr.colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.strictEqual(raw.length, (ihdr.w * ch + 1) * ihdr.h);
  const px = (x, y) => { const o = y * (ihdr.w * ch + 1) + 1 + x * ch; return [raw[o], raw[o + 1], raw[o + 2], ch === 4 ? raw[o + 3] : 255]; };
  return { ...ihdr, px };
}

test('manifest: installable, relative, colours from the CSS tokens, icons present', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(m.name, 'Cube Coach');
  assert.strictEqual(m.short_name, 'Cube Coach');
  assert.strictEqual(m.start_url, '.');
  assert.strictEqual(m.scope, '.');
  assert.strictEqual(m.display, 'standalone');
  const css = read('css/app.css');
  const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(css)[1];
  assert.strictEqual(m.background_color.toLowerCase(), bg.toLowerCase());
  assert.strictEqual(m.theme_color.toLowerCase(), bg.toLowerCase());
  assert.ok(read('index.html').includes('<meta name="theme-color" content="' + bg + '" media="(prefers-color-scheme: light)">'));
  const sizes = (purpose) => m.icons.filter((i) => (i.purpose || 'any').split(' ').includes(purpose)).map((i) => i.sizes);
  assert.ok(sizes('any').includes('192x192') && sizes('any').includes('512x512'));
  assert.ok(sizes('maskable').includes('512x512') && sizes('maskable').includes('192x192'));
  for (const ic of m.icons) {
    assert.ok(!/^(\/|https?:)/.test(ic.src));
    const png = readPNG(ic.src);
    assert.strictEqual(png.w + 'x' + png.h, ic.sizes, ic.src + ' size');
    assert.strictEqual(ic.type, 'image/png');
  }
});

test('icons: the brand mark, maskable art inside the safe circle, opaque apple-touch-icon', () => {
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const near = (a, b, tol = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
  const { PLATE, STICKERS, ICONS } = require('../tools/make-icons.js');
  const apple = readPNG('icons/apple-touch-icon.png');
  assert.strictEqual(apple.w, 180); assert.strictEqual(apple.colour, 2, 'RGB: no transparency (iOS would turn it black)');
  for (const ic of ICONS) {
    const png = readPNG('icons/' + ic.file);
    const c = png.w / 2;
    assert.ok(near(png.px(c, c), hex(STICKERS[1][1])), ic.file + ' centre sticker is yellow');
    const corner = png.px(0, 0);
    if (ic.opaque) assert.ok(near(corner, hex(PLATE)) && corner[3] === 255, ic.file + ' full-bleed plate');
    else assert.strictEqual(corner[3], 0, ic.file + ' transparent outside the rounded plate');
    if (/maskable/.test(ic.file)) {
      const plate = hex(PLATE), r = 0.4 * png.w;
      for (let y = 0; y < png.h; y += 2) for (let x = 0; x < png.w; x += 2) {
        if (!near(png.px(x, y), plate, 2)) assert.ok(Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r, ic.file + ': art at ' + x + ',' + y + ' outside the safe zone');
      }
    }
  }
  // the PNGs on disk are what tools/make-icons.js makes today
  const built = require('../tools/make-icons.js').build();
  for (const b of built) assert.ok(fs.readFileSync(rel('icons/' + b.file)).equals(b.png), 'icons/' + b.file + ' is up to date (node tools/make-icons.js)');
});

test('QR code of the hosted link: valid Reed-Solomon blocks, format info, payload', () => {
  const M = require('../tools/make-icons.js');
  const url = M.hostedUrl();
  assert.strictEqual(url, App.HOSTED_URL, 'the QR code points at CC.App.HOSTED_URL');
  assert.strictEqual(read('icons/' + M.QR_FILE), M.qrSvg(url), 'icons/' + M.QR_FILE + ' is up to date (node tools/make-icons.js)');
  for (const text of [url, 'a', 'Cube Coach — naïve ✓', 'x'.repeat(100)]) for (const forced of [undefined, 0, 3, 7]) {
    const q = M.qrMatrix(text, { mask: forced });
    const n = q.size, m = q.modules, bit = (x, y) => (m[y][x] ? 1 : 0);
    assert.strictEqual(n, 17 + 4 * q.version);
    // finder patterns in three corners
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        assert.strictEqual(bit(cx + dx, cy + dy), Math.max(Math.abs(dx), Math.abs(dy)) === 2 ? 0 : 1, 'finder at ' + cx + ',' + cy);
      }
    }
    // format info: both copies agree, the BCH code checks out, level M, the chosen mask
    const a1 = [], a2 = [];
    for (let i = 0; i <= 5; i++) a1[i] = bit(8, i);
    a1[6] = bit(8, 7); a1[7] = bit(8, 8); a1[8] = bit(7, 8);
    for (let i = 9; i < 15; i++) a1[i] = bit(14 - i, 8);
    for (let i = 0; i < 8; i++) a2[i] = bit(n - 1 - i, 8);
    for (let i = 8; i < 15; i++) a2[i] = bit(8, n - 15 + i);
    assert.deepStrictEqual(a1, a2, 'two copies of the format bits');
    const f = a1.reduce((v, b, i) => v | (b << i), 0) ^ 0x5412;
    let rem = f;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    assert.strictEqual(rem, 0, 'format BCH');
    assert.strictEqual(f >>> 13, 0, 'error correction level M');
    if (forced !== undefined) assert.strictEqual((f >>> 10) & 7, forced);
    // every block is a Reed-Solomon codeword: zero syndromes at alpha^0..alpha^(ecc-1)
    const { codewords: cw, eccLen, nBlocks, dataPerBlock } = q;
    for (let b = 0; b < nBlocks; b++) {
      const block = [];
      for (let i = 0; i < dataPerBlock; i++) block.push(cw[i * nBlocks + b]);
      for (let i = 0; i < eccLen; i++) block.push(cw[dataPerBlock * nBlocks + i * nBlocks + b]);
      let alpha = 1;
      for (let i = 0; i < eccLen; i++) {
        let syn = 0;
        for (const c of block) syn = M.gfMul(syn, alpha) ^ c;
        assert.strictEqual(syn, 0, 'syndrome ' + i + ' of block ' + b);
        alpha = M.gfMul(alpha, 2);
      }
    }
    // the payload: byte mode, the length, the text
    const data = [];
    for (let i = 0; i < dataPerBlock; i++) for (let b = 0; b < nBlocks; b++) data[b * dataPerBlock + i] = cw[i * nBlocks + b];
    const bits = data.map((v) => v.toString(2).padStart(8, '0')).join('');
    assert.strictEqual(bits.slice(0, 4), '0100', 'byte mode');
    const len = parseInt(bits.slice(4, 12), 2);
    const bytes = []; for (let i = 0; i < len; i++) bytes.push(parseInt(bits.slice(12 + i * 8, 20 + i * 8), 2));
    assert.strictEqual(Buffer.from(bytes).toString('utf8'), text);
  }
});

test('three.js r128 is vendored with its licence header', () => {
  const src = read('vendor/three.min.js');
  const head = src.slice(0, 300);
  assert.ok(/@license/.test(head) && /MIT/.test(head) && /Three\.js Authors/.test(head), 'MIT licence header kept');
  assert.ok(/const e="128"/.test(src.slice(0, 2000)), 'revision 128');
  assert.ok(src.length > 500000);
});

// ------------------------------------------------------------------ CC.App helpers
test('swDecision: offline copy on https only, never on localhost unless ?sw=1', () => {
  const d = (href) => { const u = new URL(href); return App.swDecision({ protocol: u.protocol, hostname: u.hostname, search: u.search }); };
  assert.strictEqual(d('https://pmcgroark.github.io/cube-coach/'), 'register');
  assert.strictEqual(d('https://pmcgroark.github.io/cube-coach/?x=1#/home'), 'register');
  assert.strictEqual(d('http://localhost:8765/'), 'dev');
  assert.strictEqual(d('http://127.0.0.1:8765/#/solve'), 'dev');
  assert.strictEqual(d('http://[::1]:8765/'), 'dev');
  assert.strictEqual(d('https://localhost:8443/'), 'dev');
  assert.strictEqual(d('http://localhost:9000/?sw=1'), 'register');
  assert.strictEqual(d('http://localhost:9000/?a=2&sw=1'), 'register');
  assert.strictEqual(d('https://pmcgroark.github.io/cube-coach/?sw=0'), 'off');
  assert.strictEqual(d('http://example.com/cube-coach/'), 'insecure');
  assert.strictEqual(d('file:///Users/x/cube-coach/index.html'), 'unavailable');
  assert.strictEqual(App.HOSTED_URL, 'https://pmcgroark.github.io/cube-coach/');
});

test('keepAwake: takes the wake lock, re-takes it when the page comes back, no-op when unsupported', async () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let visible = true, requests = 0, refuseNext = false;
  const live = new Set();
  const fakeLock = {
    request(type) {
      assert.strictEqual(type, 'screen');
      requests++;
      if (refuseNext) { refuseNext = false; return Promise.reject(Object.assign(new Error('needs a tap'), { name: 'NotAllowedError' })); }
      const ls = {};
      const s = { released: false, addEventListener: (t, fn) => { ls[t] = fn; }, release() { if (!s.released) { s.released = true; live.delete(s); if (ls.release) ls.release(); } return Promise.resolve(); } };
      live.add(s);
      return Promise.resolve(s);
    }
  };
  const k = App._createWakeKeeper({ wakeLock: () => fakeLock, visible: () => visible });
  assert.strictEqual(k.set(true), true);
  await flush();
  assert.ok(k.isAwake()); assert.strictEqual(live.size, 1);
  k.set(true, 'scan'); await flush();
  assert.strictEqual(requests, 1, 'one lock for several reasons');
  k.set(false, 'scan'); await flush();
  assert.ok(k.isAwake(), 'still wanted by the default reason');
  // the page is hidden: the browser drops the lock; back again: we take it again
  visible = false; [...live].forEach((s) => s.release()); k.sync(); await flush();
  assert.ok(!k.isAwake());
  visible = true; k.sync(); await flush();
  assert.ok(k.isAwake()); assert.strictEqual(requests, 2);
  k.set(false); await flush();
  assert.ok(!k.isAwake()); assert.strictEqual(live.size, 0, 'released');
  // refused (needs a user gesture): the next tap retries
  refuseNext = true; k.set(true); await flush();
  assert.ok(!k.isAwake());
  k.onTap(); await flush();
  assert.ok(k.isAwake());
  k.reset(); await flush();
  assert.strictEqual(live.size, 0, 'route change releases it');
  // released before the request resolved
  k.set(true); k.set(false); await flush(); await flush();
  assert.strictEqual(live.size, 0);
  // unsupported browser: silently nothing
  const none = App._createWakeKeeper({ wakeLock: () => undefined, visible: () => true });
  assert.strictEqual(none.set(true), false);
  assert.ok(!none.isAwake());
  assert.strictEqual(App.keepAwake(true), false, 'node has no wake lock: no-op');
  App.keepAwake(false);
});

test('platform detection for the Add to Home Screen steps', () => {
  const iPhoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
  const iPhoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const iPad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const p = App._platformFrom;
  assert.deepStrictEqual([p(iPhoneChrome).ios, p(iPhoneChrome).browser, p(iPhoneChrome).phone], [true, 'chrome', true]);
  assert.deepStrictEqual([p(iPhoneSafari).ios, p(iPhoneSafari).browser], [true, 'safari']);
  assert.deepStrictEqual([p(iPad, 5).ios, p(iPad, 5).ipad, p(iPad, 0).ios], [true, true, false]);
  assert.deepStrictEqual([p(macChrome, 0).ios, p(macChrome, 0).browser, p(macChrome, 0).phone], [false, 'chrome', false]);
  assert.deepStrictEqual([p(android).android, p(android).phone, p(android).ios], [true, true, false]);
  assert.strictEqual(App.isStandalone(), false);
});

test('home: the Middle Layer Gym tile shows for a learner stuck on the middle layer', () => {
  const home = require('../js/screens/home.js');
  const show = home._showGymTile;
  const now = Date.UTC(2026, 10, 15, 12);
  const day = (n) => new Date(now - n * DAY);
  // brand new: no tile
  assert.strictEqual(show(Store.defaults(day(30)), Coach, now), false);
  // three stages learned, middle practised but weak, later stages untouched (at 0): tile shows even
  // though the journey has moved on, because middle is the weakest stage practised so far
  const d = Store.defaults(day(30));
  for (let i = 0; i < 12; i++) ['daisy', 'cross', 'corners'].forEach((st) => Coach.recordStage(d, st, { level: Coach.levelFor(d, st, day(20 - i)), hints: 0, quizRight: 2, quizTotal: 2 }, day(20 - i)));
  assert.strictEqual(Coach.journey(d, new Date(now)).focusStage, 'middle');
  assert.strictEqual(show(d, Coach, now), true, 'middle layer is next: tile');
  // a few coached goes later the journey points at the yellow cross, but the middle layer is still weak
  for (let i = 0; i < 6; i++) Coach.recordStage(d, 'middle', { level: Coach.levelFor(d, 'middle', day(10 - i)), hints: 2, quizRight: 1, quizTotal: 2 }, day(10 - i));
  assert.notStrictEqual(Coach.journey(d, new Date(now)).focusStage, 'middle', 'journey has moved on');
  assert.ok(Coach.masteryOf(d, 'middle', new Date(now)) < 50);
  assert.ok(Coach.masteryOf(d, 'ycross', new Date(now)) === 0, 'later stages untouched (0, but not practised)');
  assert.strictEqual(show(d, Coach, now), true, 'weakest practised stage: tile');
  // once the middle layer is mastered (and the gym not used lately) the tile goes away
  const m = JSON.parse(JSON.stringify(d));
  m.skills.middle.mastery = 90; m.skills.middle.lastPracticed = day(1).toISOString();
  m.skills.daisy.mastery = 95; m.skills.cross.mastery = 95; m.skills.corners.mastery = 95;
  ['daisy', 'cross', 'corners'].forEach((st) => { m.skills[st].lastPracticed = day(1).toISOString(); });
  if (Coach.journey(m, new Date(now)).focusStage !== 'middle') assert.strictEqual(show(m, Coach, now), false);
  // used the gym in the last fortnight: the tile stays handy
  m.gym = { spot: { right: 3, total: 4, recent: [1, 1, 0, 1], lastAt: day(5).toISOString() } };
  assert.strictEqual(show(m, Coach, now), true);
  m.gym.spot.lastAt = day(20).toISOString();
  if (Coach.journey(m, new Date(now)).focusStage !== 'middle') assert.strictEqual(show(m, Coach, now), false);
  assert.strictEqual(show(null, Coach, now), false);
});

test('practice › stages: "weakest" means weakest of the stages practised, not one not started yet', () => {
  const drills = require('../js/screens/drills.js');
  const list = Store.STAGE_IDS.map((id) => ({ id }));
  const d = Store.defaults(new Date(T0));
  const mast = {}; list.forEach((s) => { mast[s.id] = 0; });
  assert.strictEqual(drills._weakestPractised(list, mast, d), 'daisy', 'nothing practised: the first stage');
  ['daisy', 'cross', 'corners', 'middle'].forEach((id, i) => { d.skills[id].sessions = 5; mast[id] = [95, 90, 81, 28][i]; });
  assert.strictEqual(drills._weakestPractised(list, mast, d), 'middle', 'stuck on the middle layer: middle, not the untouched yellow cross');
  mast.cross = 20;
  assert.strictEqual(drills._weakestPractised(list, mast, d), 'cross');
});

test('progress merge keeps the fastest perfect gym round (bestRoundMs) from either device', () => {
  const a = Store.defaults(), b = Store.defaults();
  a.gym = { leftright: { right: 10, total: 10, streak: 10, best: 10, bestMs: null, bestRoundMs: 15000, lastAt: '2026-11-10T09:00:00.000Z', recent: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } };
  b.gym = { leftright: { right: 40, total: 48, streak: 3, best: 12, bestMs: null, bestRoundMs: 18000, lastAt: '2026-11-12T09:00:00.000Z', recent: [1, 0, 1, 1, 1, 1, 1, 0, 1, 1] } };
  for (const m of [Store.merge(a, b), Store.merge(b, a)]) {
    assert.strictEqual(m.gym.leftright.bestRoundMs, 15000);
    assert.strictEqual(m.gym.leftright.total, 48, 'larger totals kept');
  }
  b.gym.leftright.bestRoundMs = 0; delete a.gym.leftright.bestRoundMs;
  assert.ok(!(Store.merge(a, b).gym.leftright.bestRoundMs > 0), 'no made-up time');
});

test('View3D camera sides match the gym screen (setView)', () => {
  require('../js/render3d.js');
  assert.deepStrictEqual(globalThis.CC.View3D.VIEW_SIDES, { right: 34, left: -34, 'back-right': 146, 'back-left': -146 });
});

test('stats: Middle Layer Gym answers show as one named row, never as raw "gym-spot" ids', () => {
  const stats = require('../js/screens/stats.js');
  require('../js/solver.js');
  const Gym = require('../js/gym.js');
  assert.strictEqual(stats._gymSummary({ notation: { right: 3, total: 4 } }, Gym), null, 'no gym yet');
  const d = Store.defaults(new Date(T0));
  [['spot', [1, 1, 1, 1, 1]], ['halves', [1, 0, 0, 1]], ['landmark', [0, 0, 1]], ['nextmove', [1]]].forEach(([id, rs], k) =>
    rs.forEach((c, j) => Gym.record(d, id, !!c, {}, new Date(T0 + (k * 10 + j) * 60000))));
  const g = stats._gymSummary(d.drills, Gym);
  assert.strictEqual(g.total, 13); assert.strictEqual(g.right, 9);
  assert.deepStrictEqual(g.tried.map((t) => t.name), ['spot', 'halves', 'landmark', 'nextmove'].map((id) => Gym.drill(id).name));
  assert.ok(g.tried.every((t) => !/^gym-/.test(t.name)));
  assert.strictEqual(g.weakest.id, 'landmark', 'weakest with 3+ answers');
  assert.strictEqual(g.lastAt, d.drills['gym-nextmove'].lastAt);
});

// ------------------------------------------------------------------ run
(async () => {
  for (const t of pendingTests) await t();
  // Not a failure: a reminder that installed copies only update when VERSION changes.
  const sw = loadSW();
  const hash = contentHash(sw.PRECACHE.filter((f) => fs.existsSync(rel(f))));
  const stale = String(sw.VERSION).split('.')[1] !== hash || JSON.stringify(sw.PRECACHE) !== JSON.stringify(appFiles());
  console.log(passed + ' platform tests passed' + (process.exitCode ? ' (some FAILED)' : '') +
    (stale && !process.exitCode ? ' · NOTE: app files changed since sw.js was stamped — run `node tests/platform.test.js --stamp` before publishing' : ''));
})();
