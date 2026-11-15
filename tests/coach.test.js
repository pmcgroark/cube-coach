// node tests/coach.test.js  — CC.Store + CC.Coach
const assert = require('assert');
require('../js/cube.js');
const Store = require('../js/storage.js');
const Coach = require('../js/coach.js');
const Cube = globalThis.CC.Cube;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack); process.exitCode = 1; }
}

const STAGES = Coach.STAGE_IDS;
const H = 3600e3, DAY = 24 * H;
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi); // local time
function fakeStorage() {
  const m = {};
  return {
    m,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }
  };
}
const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); }
};

// Run `n` attempts at one stage, each at the coach's current level unless the policy says otherwise.
function simulate(n, policy, { device = 'physical', start = null, stage = 'corners', data = null } = {}) {
  const d = data || Store.defaults(at(2026, 1, 1));
  if (start) Object.assign(d.skills[stage], start);
  let t = at(2026, 1, 1, 9).getTime();
  const trace = [];
  for (let i = 0; i < n; i++) {
    t += 20 * H;
    const lvl = Coach.levelFor(d, stage, t);
    const o = Object.assign({ level: lvl, device }, policy(lvl, i));
    const r = Coach.recordStage(d, stage, o, t);
    trace.push(r);
  }
  return { data: d, trace, levels: trace.map((r) => r.level) };
}
const perfect = (lvl) => ({ hints: 0, quizRight: lvl === 2 ? 2 : 0, quizTotal: lvl === 2 ? 2 : 0 });

// ------------------------------------------------------------------ levels & hysteresis
test('natural level thresholds', () => {
  const L = Coach.naturalLevel;
  assert.deepStrictEqual([0, 24.9, 25, 49.9, 50, 77.9, 78, 100].map(L), [3, 3, 2, 2, 1, 1, 0, 0]);
});

test('hysteresis: promote at the threshold, demote only 5 below it', () => {
  const h = Coach.hysteresisLevel;
  assert.strictEqual(h(25, 3), 2);
  assert.strictEqual(h(78, 1), 0);
  assert.strictEqual(h(73, 0), 0);
  assert.strictEqual(h(72.9, 0), 1);
  assert.strictEqual(h(45, 1), 1);
  assert.strictEqual(h(44.9, 1), 2);
  assert.strictEqual(h(20, 2), 2);
  assert.strictEqual(h(19.9, 2), 3);
  assert.strictEqual(h(40, 0), 2, 'a big drop demotes past Nudge');
  assert.strictEqual(h(60, null), 1, 'no previous level: plain thresholds');
});

test('levelFor uses the stored level as the hysteresis anchor', () => {
  const d = Store.defaults();
  d.skills.middle = { mastery: 75, sessions: 9, soloClean: 3, lastLevel: 0, lastPracticed: new Date().toISOString() };
  assert.strictEqual(Coach.levelFor(d, 'middle'), 0);
  d.skills.middle.lastLevel = 1;
  assert.strictEqual(Coach.levelFor(d, 'middle'), 1);
  assert.strictEqual(Coach.levelFor(d, 'daisy'), 3, 'fresh stage starts at Show');
  assert.strictEqual(Coach.levelFor({}, 'cross'), 3, 'survives missing skills');
});

test('guidance override wins for every stage, and is used by recordStage', () => {
  const d = Store.defaults();
  d.skills.cross.mastery = 90; d.skills.cross.lastLevel = 0;
  d.settings.guidanceOverride = 2;
  STAGES.forEach((id) => assert.strictEqual(Coach.levelFor(d, id), 2));
  d.settings.guidanceOverride = 3;
  const r = Coach.recordStage(d, 'daisy', { hints: 0 }, at(2026, 3, 1));
  assert.ok(r.mastery <= 45, 'done at Show (override) scores like Show');
  assert.strictEqual(r.level, 3, 'returned level is the automatic one');
  d.settings.guidanceOverride = null;
  assert.strictEqual(Coach.levelFor(d, 'cross'), 0);
  d.settings.guidanceOverride = 0;
  assert.strictEqual(Coach.levelFor(d, 'daisy'), 0);
});

// ------------------------------------------------------------------ progression simulations
test('perfect learner reaches Solo in 6-10 attempts, through every level in order', () => {
  const { levels } = simulate(14, perfect);
  const first = levels.indexOf(0) + 1;
  assert.ok(first >= 6 && first <= 10, 'reached Solo after ' + first);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1], 'never demoted: ' + levels);
  [3, 2, 1].forEach((l) => assert.ok(levels.indexOf(l) !== -1 || l === 3, 'passed through level ' + l));
  assert.ok(levels.indexOf(2) !== -1 && levels.indexOf(1) !== -1);
});

test('virtual attempts count less (slower, but still reach Solo)', () => {
  const phys = simulate(20, perfect).levels.indexOf(0);
  const virt = simulate(20, perfect, { device: 'virtual' }).levels.indexOf(0);
  assert.ok(virt > phys, 'virtual ' + virt + ' vs physical ' + phys);
  assert.ok(virt !== -1 && virt + 1 <= 14);
});

test('learner who always needs a hint plateaus at Nudge; two hints plateaus at Coach', () => {
  const one = simulate(60, (l) => ({ hints: l === 3 ? 0 : 1 })).levels;
  assert.ok(one.indexOf(0) === -1, 'never Solo');
  assert.strictEqual(one[one.length - 1], 1);
  const two = simulate(60, (l) => ({ hints: l === 3 ? 0 : 2 })).levels;
  assert.ok(two.every((l) => l >= 2), 'never beyond Coach');
  assert.strictEqual(two[two.length - 1], 2);
});

test('Show-level exposure alone cannot get past Coach', () => {
  const { data, levels } = simulate(80, () => ({ level: 3, hints: 0 }));
  assert.ok(levels.every((l) => l >= 2));
  assert.ok(data.skills.corners.mastery < 50);
  assert.strictEqual(Coach.levelFor(data, 'corners', at(2026, 3, 20)), 2);
});

test('heavy hint use at Solo demotes to Nudge (not instantly: hysteresis)', () => {
  const { levels } = simulate(6, (l) => ({ level: l, hints: 3 }), { start: { mastery: 90, lastLevel: 0, sessions: 20 } });
  assert.strictEqual(levels[0], 0, 'one bad solve does not demote');
  const k = levels.indexOf(1);
  assert.ok(k > 0 && k <= 4, 'demoted to Nudge at attempt ' + (k + 1) + ': ' + levels);
  // light hint use at Solo keeps Solo
  const light = simulate(20, (l) => ({ level: l, hints: 1 }), { start: { mastery: 90, lastLevel: 0, sessions: 20 } }).levels;
  assert.ok(light.every((l) => l === 0));
});

test('mastery rises faster than it falls; clean attempts with extra help never lower it', () => {
  const d = Store.defaults();
  d.skills.middle.mastery = 50; d.skills.middle.lastLevel = 1;
  const up = Coach.recordStage(d, 'middle', { level: 0, hints: 0 }, at(2026, 2, 1)).delta;   // perf 100: gap +50
  d.skills.middle.mastery = 50;
  const down = Coach.recordStage(d, 'middle', { level: 0, hints: 50 }, at(2026, 2, 2)).delta; // perf 40: gap -10 → smaller
  assert.ok(up > 0 && down < 0 && up / 50 > -down / 10);
  d.skills.middle.mastery = 90;
  const r = Coach.recordStage(d, 'middle', { level: 2, hints: 0 }, at(2026, 2, 3));
  assert.strictEqual(r.mastery, 90);
});

test('quiz accuracy and hints lower the performance score', () => {
  const p = Coach.performance;
  assert.ok(p({ level: 2, quizRight: 4, quizTotal: 4 }) > p({ level: 2, quizRight: 1, quizTotal: 4 }));
  assert.ok(p({ level: 1, hints: 0 }) > p({ level: 1, hints: 2 }));
  assert.strictEqual(p({ level: 0, hints: 0 }), 100);
  assert.ok(p({ level: 0, hints: 99 }) >= 0);
});

test('recordStage bookkeeping', () => {
  const d = Store.defaults();
  const t = at(2026, 4, 10, 8);
  const r = Coach.recordStage(d, 'ycross', { level: 0, hints: 0, ms: 9000 }, t);
  assert.deepStrictEqual(Object.keys(r).slice(0, 3), ['mastery', 'delta', 'level']);
  assert.strictEqual(d.skills.ycross.sessions, 1);
  assert.strictEqual(d.skills.ycross.soloClean, 1);
  assert.strictEqual(d.skills.ycross.lastPracticed, t.toISOString());
  assert.ok(Object.prototype.hasOwnProperty.call(d.practiceLog, '2026-04-10'));
  Coach.recordStage(d, 'ycross', { level: 0, hints: 1 }, t);
  assert.strictEqual(d.skills.ycross.soloClean, 1);
  // unknown stage id / missing skills object does not throw
  const e = {}; Coach.recordStage(e, 'cross', {}, t);
  assert.strictEqual(e.skills.cross.sessions, 1);
});

test('gentle decay after 7 days, computed without mutating', () => {
  const d = Store.defaults();
  const last = at(2026, 5, 1);
  d.skills.corners = { mastery: 85, sessions: 30, soloClean: 10, lastLevel: 0, lastPracticed: last.toISOString() };
  const snap = JSON.stringify(d);
  assert.strictEqual(Coach.masteryOf(d, 'corners', at(2026, 5, 7)), 85);
  assert.strictEqual(Coach.levelFor(d, 'corners', at(2026, 5, 20)), 0, '19 days: still Solo');
  assert.strictEqual(Coach.masteryOf(d, 'corners', new Date(last.getTime() + 40 * DAY)), 68.5);
  assert.strictEqual(Coach.levelFor(d, 'corners', new Date(last.getTime() + 40 * DAY)), 1);
  assert.strictEqual(Coach.masteryOf(d, 'corners', new Date(last.getTime() + 400 * DAY)), 65, 'decay is capped');
  assert.strictEqual(JSON.stringify(d), snap, 'levelFor/masteryOf do not mutate');
  // the decay is baked in when they practise again
  const r = Coach.recordStage(d, 'corners', { level: 1, hints: 0 }, new Date(last.getTime() + 40 * DAY));
  assert.ok(r.mastery < 85 && r.mastery > 68.5);
});

// ------------------------------------------------------------------ stats
function solve(totalMs, when, extra = {}) {
  return Object.assign({ at: when.toISOString(), device: 'physical', source: 'scramble', stage: null, scramble: null,
    totalMs, splits: {}, levels: {}, hints: {}, quiz: { right: 0, total: 0 }, completed: true }, extra);
}

test('averageOf: WCA-style drop best and worst', () => {
  assert.strictEqual(Coach.averageOf([10, 50, 20, 40, 30].map((x) => x * 1000)), 30000);
  const twelve = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 500].map((x) => x * 1000);
  // drop 5 and 500 -> mean of 10..100 = 55
  assert.strictEqual(Coach.averageOf(twelve), 55000);
  assert.strictEqual(Coach.averageOf([1, 2]), null);
});

test('stats: only completed full solves, device filter, ao5/ao12, trend', () => {
  const d = Store.defaults();
  const t0 = at(2026, 6, 1, 10);
  const times = [300, 280, 260, 250, 240, 230, 220, 210, 205, 200, 190, 185, 180].map((x) => x * 1000);
  times.forEach((ms, i) => Coach.recordSolve(d, solve(ms, new Date(t0.getTime() + i * H)), t0));
  Coach.recordSolve(d, solve(5000, new Date(t0.getTime() + 20 * H), { source: 'drill', stage: 'cross' }), t0);
  Coach.recordSolve(d, solve(4000, new Date(t0.getTime() + 21 * H), { completed: false }), t0);   // a DNF
  Coach.recordSolve(d, solve(1500, new Date(t0.getTime() + 21.5 * H), { completed: false }), t0); // abandoned at once: not an attempt
  Coach.recordSolve(d, solve(100000, new Date(t0.getTime() + 22 * H), { device: 'virtual' }), t0);
  const all = Coach.stats(d, {}, t0);
  assert.strictEqual(all.count, 14);
  assert.strictEqual(all.best, 100000);
  assert.strictEqual(all.last, 100000);
  const p = Coach.stats(d, { device: 'physical' }, t0);
  assert.strictEqual(p.count, 13);
  assert.strictEqual(p.attempts, 14);
  assert.strictEqual(p.dnf, 1);
  assert.strictEqual(p.best, 180000);
  assert.strictEqual(p.last, 180000);
  assert.strictEqual(p.mean, Math.round(times.reduce((a, b) => a + b) / 13));
  // last 5 attempts: 200 190 185 180 DNF -> the DNF is the dropped worst, 180 the dropped best
  assert.strictEqual(p.ao5, Math.round((200 + 190 + 185) / 3 * 1000));
  // last 12 attempts: 260..180 + DNF -> drop 180 & DNF
  const l12 = times.slice(2, 12);
  assert.strictEqual(p.ao12, Math.round(l12.reduce((a, b) => a + b) / 10));
  assert.strictEqual(p.trend.length, 13);
  assert.strictEqual(p.trend[0].ms, 300000);
  assert.strictEqual(p.trend[3].ao5, null);
  assert.strictEqual(p.trend[4].ao5, Math.round((280 + 260 + 250) / 3 * 1000));
  const v = Coach.stats(d, { device: 'virtual' }, t0);
  assert.strictEqual(v.count, 1);
  assert.strictEqual(v.ao5, null);
  const empty = Coach.stats(Store.defaults(), {}, t0);
  assert.strictEqual(empty.count, 0);
  assert.strictEqual(empty.best, null);
  assert.strictEqual(empty.slowestStage, null);
});

test('stats: byStage shares and slowest stage (relative to its usual size)', () => {
  const d = Store.defaults();
  const t0 = at(2026, 6, 1, 10);
  const splits = { daisy: 10000, cross: 12000, corners: 30000, middle: 33000, ycross: 30000, yedges: 12000, ycorners: 12000, yorient: 15000 };
  for (let i = 0; i < 3; i++) Coach.recordSolve(d, solve(154000, new Date(t0.getTime() + i * H), { splits }), t0);
  const s = Coach.stats(d, {}, t0);
  assert.strictEqual(s.byStage.middle.avgMs, 33000);
  const shares = Object.values(s.byStage).reduce((a, b) => a + b.share, 0);
  assert.ok(Math.abs(shares - 1) < 0.01);
  assert.strictEqual(s.slowestStage, 'ycross', 'yellow cross is 3x its usual share');
});

test('streak: midnight boundaries, gaps, today or yesterday', () => {
  const d = Store.defaults();
  Coach.logPractice(d, 5, at(2026, 1, 30, 23, 59));
  Coach.logPractice(d, 5, at(2026, 1, 31, 0, 1));
  Coach.logPractice(d, 5, at(2026, 2, 1, 7));                    // across a month boundary
  assert.strictEqual(Coach.stats(d, {}, at(2026, 2, 1, 23, 59)).streak, 3);
  assert.strictEqual(Coach.stats(d, {}, at(2026, 2, 2, 0, 30)).streak, 3, 'ending yesterday still counts');
  assert.strictEqual(Coach.stats(d, {}, at(2026, 2, 3, 0, 0)).streak, 0, 'a missed day breaks it');
  Coach.logPractice(d, 5, at(2026, 2, 3, 9));
  Coach.logPractice(d, 5, at(2026, 2, 4, 9));
  assert.strictEqual(Coach.stats(d, {}, at(2026, 2, 4, 21)).streak, 2, 'gap on 2 Feb');
  assert.strictEqual(Coach.stats(Store.defaults(), {}, at(2026, 2, 4)).streak, 0);
  // a solve or drill alone marks the day as practised
  const e = Store.defaults();
  Coach.recordDrill(e, 'notation', true, at(2026, 3, 1, 23, 50));
  Coach.recordSolve(e, solve(200000, at(2026, 3, 2, 0, 10)), at(2026, 3, 2, 0, 10));
  assert.strictEqual(Coach.stats(e, {}, at(2026, 3, 2, 12)).streak, 2);
});

test('todayMinutes and weekMinutes', () => {
  const d = Store.defaults();
  for (let i = 0; i < 9; i++) Coach.logPractice(d, 10, at(2026, 7, 1 + i, 18));
  Coach.logPractice(d, 2.5, at(2026, 7, 9, 19));
  const s = Coach.stats(d, {}, at(2026, 7, 9, 20));
  assert.strictEqual(s.todayMinutes, 12.5);
  assert.strictEqual(s.weekMinutes, 72.5, 'today + previous 6 days only');
  Coach.logPractice(d, -5, at(2026, 7, 9, 20));
  Coach.logPractice(d, 'abc', at(2026, 7, 9, 20));
  assert.strictEqual(Coach.stats(d, {}, at(2026, 7, 9, 20)).todayMinutes, 12.5, 'bad minutes ignored');
});

// ------------------------------------------------------------------ milestones
test('milestones from solves', () => {
  const d = Store.defaults();
  const t = at(2026, 8, 1, 10);
  let r = Coach.recordSolve(d, solve(900000, t, { device: 'virtual', levels: { cross: 3, corners: 2 } }), t);
  assert.deepStrictEqual(r.newMilestones.sort(), ['first-solve', 'first-virtual']);
  assert.strictEqual(d.milestones['first-solve'], t.toISOString());
  r = Coach.recordSolve(d, solve(800000, t, { levels: { cross: 2, corners: 1 }, hints: { corners: 1 } }), t);
  assert.deepStrictEqual(r.newMilestones, ['first-coach']);
  // fast virtual and hinted solves do not count as unaided
  r = Coach.recordSolve(d, solve(100000, t, { device: 'virtual', levels: { cross: 0 } }), t);
  assert.deepStrictEqual(r.newMilestones, []);
  r = Coach.recordSolve(d, solve(100000, t, { levels: { cross: 0 }, hints: { cross: 1 } }), t);
  assert.deepStrictEqual(r.newMilestones, []);
  r = Coach.recordSolve(d, solve(100000, t, { stage: 'cross', source: 'drill' }), t);
  assert.deepStrictEqual(r.newMilestones, [], 'drills are not solves');
  const solo = {}; STAGES.forEach((id) => { solo[id] = 0; });
  r = Coach.recordSolve(d, solve(179000, t, { levels: solo }), t);
  assert.deepStrictEqual(r.newMilestones, ['first-solo', 'sub-10', 'sub-5', 'sub-3']);
  r = Coach.recordSolve(d, solve(89000, t, { levels: solo }), t);
  assert.deepStrictEqual(r.newMilestones, ['sub-2', 'sub-90']);
  r = Coach.recordSolve(d, solve(80000, t, { levels: solo }), t);
  assert.deepStrictEqual(r.newMilestones, [], 'awarded once');
  const list = Coach.milestones(d);
  assert.strictEqual(list.length, 13);
  assert.ok(list.every((m) => m.id && m.name && m.desc && 'earnedAt' in m));
  assert.strictEqual(list.find((m) => m.id === 'streak-7').earnedAt, null);
});

test('milestones: streaks, all-mastered, 100 solves', () => {
  const d = Store.defaults();
  let fresh = [];
  for (let i = 0; i < 7; i++) fresh = fresh.concat(Coach.logPractice(d, 20, at(2026, 9, 1 + i, 20)).newMilestones);
  assert.deepStrictEqual(fresh, ['streak-7']);
  STAGES.forEach((id, i) => { d.skills[id].mastery = i < 7 ? 80 : 70; d.skills[id].lastLevel = 1; });
  let r = Coach.recordStage(d, 'yorient', { level: 0, hints: 0 }, at(2026, 9, 7, 21));
  assert.ok(r.mastery >= 78 && r.newMilestones.indexOf('all-mastered') !== -1);
  for (let i = 0; i < 99; i++) Coach.recordSolve(d, solve(400000, at(2026, 9, 7, 21), { levels: { cross: 1 } }), at(2026, 9, 7, 21));
  assert.ok(!d.milestones['solves-100']);
  r = Coach.recordSolve(d, solve(400000, at(2026, 9, 7, 21), { levels: { cross: 1 } }), at(2026, 9, 7, 21));
  assert.ok(r.newMilestones.indexOf('solves-100') !== -1);
});

// ------------------------------------------------------------------ Leitner
test('Leitner: unlocking, boxes, intervals, ordering', () => {
  const d = Store.defaults();
  const t = at(2026, 10, 1, 20);
  assert.deepStrictEqual(Coach.algDue(d, t), [], 'nothing before any stage is practised');
  Coach.recordStage(d, 'corners', { level: 3 }, t);
  assert.deepStrictEqual(Coach.algDue(d, t), ['rtrigger']);
  let e = Coach.gradeAlg(d, 'rtrigger', true, t);
  assert.strictEqual(e.box, 2);
  assert.strictEqual(e.due, at(2026, 10, 2, 0, 0).toISOString(), 'due at the start of tomorrow');
  assert.deepStrictEqual(Coach.algDue(d, at(2026, 10, 1, 23, 59)), []);
  assert.deepStrictEqual(Coach.algDue(d, at(2026, 10, 2, 7)), ['rtrigger']);
  e = Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 2, 7));
  assert.strictEqual(e.box, 3);
  assert.strictEqual(e.due, at(2026, 10, 5, 0, 0).toISOString());
  e = Coach.gradeAlg(d, 'rtrigger', false, at(2026, 10, 5, 7));
  assert.strictEqual(e.box, 1);
  assert.deepStrictEqual(Coach.algDue(d, at(2026, 10, 5, 7)), ['rtrigger'], 'wrong -> due again now');
  assert.strictEqual(e.right, 2); assert.strictEqual(e.total, 3);
  // cramming: right answers on a card that is not due yet do not move it up
  for (let i = 0; i < 6; i++) e = Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 5, 8 + i));
  assert.strictEqual(e.box, 2, 'one promotion per due review');
  assert.strictEqual(e.due, at(2026, 10, 6, 0, 0).toISOString());
  assert.strictEqual(e.right, 8); assert.strictEqual(e.total, 9);
  e = Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 6, 9));  // due -> box 3, +3 days
  assert.strictEqual(e.due, at(2026, 10, 9, 0, 0).toISOString());
  e = Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 9, 9));  // box 4, +7 days
  assert.strictEqual(e.due, at(2026, 10, 16, 0, 0).toISOString());
  e = Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 16, 21)); // box 5, +14 days
  assert.strictEqual(e.box, 5);
  assert.strictEqual(e.due, at(2026, 10, 30, 0, 0).toISOString(), 'box 5 = 14 days');
  e = Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 30, 9));
  assert.strictEqual(e.box, 5, 'box 5 is the top');
  e = Coach.gradeAlg(d, 'rtrigger', false, at(2026, 10, 30, 10)); // early-review mistake still demotes
  assert.strictEqual(e.box, 1);
  Coach.gradeAlg(d, 'rtrigger', true, at(2026, 10, 30, 11));
  // ordering: never-seen (box 0) before box 1 before higher boxes
  Coach.recordStage(d, 'middle', { level: 3 }, t);
  Coach.gradeAlg(d, 'mid-left', false, at(2026, 10, 6, 9));
  const due = Coach.algDue(d, at(2026, 11, 1));
  assert.deepStrictEqual(due, ['mid-right', 'mid-left', 'rtrigger']);
  // junk boxes / dates never throw
  d.algs.sune = { box: 2.5, due: 'soon', right: 0, total: 0 };
  assert.doesNotThrow(() => Coach.gradeAlg(d, 'sune', true, at(2026, 11, 1)));
  assert.strictEqual(d.algs.sune.box, 4);
  assert.strictEqual(Coach.gradeAlg(d, '__proto__', true, at(2026, 11, 1)), null);
  assert.strictEqual(({}).box, undefined, 'no prototype pollution');
});

// ------------------------------------------------------------------ hint ladder
test('hintLadder without CC.Lessons falls back to the step itself', () => {
  assert.deepStrictEqual(Coach.hintLadder(null), []);
  const step = {
    id: 'corners-1', stage: 'corners', kind: 'repeat', title: 'Drop the white–red–green corner in',
    explain: 'The corner is above its spot, so the right trigger brings it down.',
    moves: ['y', 'R', 'U', "R'", "U'", 'R', 'U', "R'", "U'", 'R', 'U', "R'", "U'"],
    segments: [{ label: 'Turn the cube so green faces you', moves: ['y'] }, { label: 'Right trigger ×3', moves: ['R', 'U', "R'", "U'", 'R', 'U', "R'", "U'", 'R', 'U', "R'", "U'"] }],
    alg: { id: 'rtrigger', name: 'Right trigger', notation: "R U R' U'", reps: 3 },
    case: { id: 'corner-white-front', name: 'White sticker facing you' }
  };
  const h = Coach.hintLadder(step);
  assert.deepStrictEqual(h.map((x) => x.level), [1, 2, 3]);
  assert.ok(/R U R' U'/.test(h[0].text), 'level 1: fallback concept for the stage');
  assert.ok(h[1].text.includes('White sticker facing you'));
  assert.ok(h[1].text.includes("Right trigger: R U R' U', 3 times"));
  assert.ok(h[1].text.includes('Turn the cube so green faces you'), 'level 2 says how to hold it');
  assert.deepStrictEqual(h[2].moves, step.moves);
  assert.ok(h[2].text.includes(step.explain));
  assert.strictEqual(h[2].plain.length, step.moves.length);
  // intuitive step, rotation not in a segment of its own
  const h2 = Coach.hintLadder({ stage: 'cross', title: 'Bring the white–red petal down', moves: ["y'", 'F2'], explain: 'x' });
  assert.ok(h2[1].text.includes('Bring the white–red petal down'));
  assert.ok(h2[1].text.includes('LEFT face comes to the FRONT'));
});

test('hintLadder uses CC.Lessons hints when present', () => {
  globalThis.CC.Lessons = { STAGES: { middle: { title: 'Middle Layer', hints: ['Concept from lessons', 'Case from lessons', 'exact'] } } };
  try {
    const h = Coach.hintLadder({ stage: 'middle', title: 'Insert the edge', moves: ['U'], explain: '' });
    assert.strictEqual(h[0].text, 'Concept from lessons');
    assert.ok(h[1].text.includes('Case from lessons'), 'no case/alg on the step -> lesson level-2 hint');
  } finally { delete globalThis.CC.Lessons; }
});

// The fallback concept hints make claims about moves; prove them with CC.Cube.
test('fallback hint facts hold on the simulated cube (yellow on top)', () => {
  const Y = Cube.applyAlg(Cube.solved(), 'z2');
  const UFR = [8, 9, 20];
  // White Corners: the corner above its spot needs 1, 3 or 5 right triggers, one count per twist.
  const whiteFace = new Set();
  [1, 3, 5].forEach((k) => {
    let s = Y; for (let i = 0; i < 6 - k; i++) s = Cube.applyAlg(s, "R U R' U'");
    whiteFace.add(UFR.find((i) => s[i] === 'W'));
    for (let i = 0; i < k; i++) s = Cube.applyAlg(s, "R U R' U'");
    assert.ok(Cube.isSolved(s));
  });
  assert.strictEqual(whiteFace.size, 3, 'the three counts cover the three twists');
  // Yellow Corners: Twist — 2 or 4 goes of R' D' R D, never more (order 6).
  let s = Y; const seen = [];
  for (let k = 1; k <= 6; k++) { s = Cube.applyAlg(s, "R' D' R D"); seen.push(UFR.map((i) => s[i]).indexOf('Y')); }
  assert.deepStrictEqual(seen.filter((x, k) => k % 2 === 1), [2, 1, 0], 'after 2/4/6 goes yellow is on F/R/U');
  assert.ok(Cube.isSolved(s));
  // Corner cycle keeps the front-right-top corner where it is.
  const p = Cube.algPerm("U R U' L' U R' U' L");
  assert.deepStrictEqual(UFR.map((i) => p[i]), UFR);
  // White Cross: F2 sends the top-front edge to the bottom-front, top sticker to the bottom.
  assert.strictEqual(Cube.stickerAfter(7, 'F2'), 28);
  // Yellow Cross: horizontal line -> cross, L at back-left -> line (search states made from the alg + U).
  const A = "F R U R' U' F'";
  const pat = (t) => [1, 5, 7, 3].map((i) => (t[i] === 'Y' ? 1 : 0)).join(''); // B R F L
  const seenStates = new Map([[Y.join(''), Y]]); const q = [Y];
  while (q.length && seenStates.size < 3000) {
    const t = q.shift();
    [A, 'U'].forEach((g) => { const u = Cube.applyAlg(t, g); const k = u.join(''); if (!seenStates.has(k)) { seenStates.set(k, u); q.push(u); } });
  }
  let lines = 0, Ls = 0;
  for (const t of seenStates.values()) {
    if (pat(t) === '0101') { lines++; assert.strictEqual(pat(Cube.applyAlg(t, A)), '1111'); }
    if (pat(t) === '1001') { Ls++; assert.strictEqual(pat(Cube.applyAlg(t, A)), '0101'); }
  }
  assert.ok(lines > 10 && Ls > 10);
  // Yellow Edges: back and right matched -> Sune + U matches all four.
  const S = "R U R' U R U2 R' U";
  const m = (t) => [[46, 49], [10, 13], [19, 22], [37, 40]].map(([a, c]) => (t[a] === t[c] ? 1 : 0)).join('');
  let pairs = 0;
  const st = new Map([[Y.join(''), Y]]); const q2 = [Y];
  while (q2.length && st.size < 4000) {
    const t = q2.shift();
    [S, 'U'].forEach((g) => { const u = Cube.applyAlg(t, g); const k = u.join(''); if (!st.has(k)) { st.set(k, u); q2.push(u); } });
  }
  for (const t of st.values()) if (m(t) === '1100') { pairs++; assert.strictEqual(m(Cube.applyAlg(t, S)), '1111'); }
  assert.ok(pairs > 0);
});

// ------------------------------------------------------------------ journey & today's plan
function phaseData(phase, now) {
  const d = Store.defaults(now);
  const iso = new Date(now.getTime() - DAY).toISOString();
  const set = (m, l) => STAGES.forEach((id) => Object.assign(d.skills[id], { mastery: m, lastLevel: l, sessions: 10, lastPracticed: iso }));
  if (phase === 'learn') {
    set(30, 2); d.skills.ycross.mastery = 0; d.skills.ycross.sessions = 0; d.skills.ycross.lastLevel = 3;
    d.skills.yedges.mastery = 0; d.skills.yedges.sessions = 0;
    d.drills.notation = { right: 20, total: 20, lastAt: iso };
  }
  if (phase === 'practice') { set(80, 0); d.skills.middle.mastery = 55; d.skills.middle.lastLevel = 1; }
  if (phase === 'independent' || phase === 'speed') set(90, 0);
  const solo = {}; STAGES.forEach((id) => { solo[id] = 0; });
  const splits = { daisy: 15000, cross: 20000, corners: 40000, middle: 45000, ycross: 30000, yedges: 15000, ycorners: 15000, yorient: 20000 };
  if (phase === 'independent') Coach.recordSolve(d, solve(240000, new Date(now.getTime() - 2 * H), { levels: solo, splits }), now);
  if (phase === 'speed') [200, 175, 190, 185, 195, 180].forEach((x, i) => Coach.recordSolve(d, solve(x * 1000, new Date(now.getTime() - (10 - i) * H), { levels: solo, splits }), now));
  return d;
}
const KINDS = ['lesson', 'watch', 'drill', 'virtual', 'solve', 'timed', 'algs'];

test('journey phases, progress and learner text', () => {
  const now = at(2026, 10, 2, 9);
  const fresh = Coach.journey(Store.defaults(now), now);
  assert.strictEqual(fresh.phase, 'learn');
  assert.strictEqual(fresh.focusStage, 'daisy');
  assert.strictEqual(fresh.progress, 0);
  const learn = Coach.journey(phaseData('learn', now), now);
  assert.strictEqual(learn.phase, 'learn');
  assert.strictEqual(learn.focusStage, 'ycross');
  assert.ok(learn.progress > 0.5 && learn.progress < 1);
  const pr = Coach.journey(phaseData('practice', now), now);
  assert.strictEqual(pr.phase, 'practice');
  assert.strictEqual(pr.focusStage, 'middle');
  assert.ok(/Nudge/.test(pr.next));
  const ind = Coach.journey(phaseData('independent', now), now);
  assert.strictEqual(ind.phase, 'independent');
  assert.strictEqual(ind.progress, 0.75);
  assert.ok(/4:00/.test(ind.next));
  const sp = Coach.journey(phaseData('speed', now), now);
  assert.strictEqual(sp.phase, 'speed');
  // unaided ao5 of last five: 175 190 185 195 180 -> drop 175 & 195 -> 185
  assert.strictEqual(sp.progress, Math.round(180 / 185 * 1000) / 1000);
  [fresh, learn, pr, ind, sp].forEach((j) => {
    assert.ok(j.title && j.description && j.next, 'texts for ' + j.phase);
    assert.ok(j.progress >= 0 && j.progress <= 1);
  });
  // independent requires every stage at Solo
  const d = phaseData('independent', now); d.skills.cross.mastery = 60; d.skills.cross.lastLevel = 1;
  assert.strictEqual(Coach.journey(d, now).phase, 'practice');
});

test('todayPlan: ~20 minutes for every phase, always with no-cube items', () => {
  const now = at(2026, 10, 2, 9);
  const datas = { fresh: Store.defaults(now) };
  ['learn', 'practice', 'independent', 'speed'].forEach((p) => { datas[p] = phaseData(p, now); });
  Object.keys(datas).forEach((name) => {
    for (let day = 0; day < 5; day++) {
      const when = new Date(now.getTime() + day * DAY);
      const plan = Coach.todayPlan(datas[name], when);
      const total = plan.reduce((a, b) => a + b.minutes, 0);
      assert.ok(total >= 18 && total <= 22, name + ' total ' + total);
      plan.forEach((it) => {
        assert.ok(KINDS.indexOf(it.kind) !== -1, it.kind);
        assert.ok(it.minutes > 0 && it.title && it.why && 'target' in it, JSON.stringify(it));
        if (it.needsCube) assert.ok(it.alt && ['virtual', 'drill'].includes(it.alt.kind) && !it.alt.needsCube && it.alt.minutes === it.minutes);
      });
      assert.ok(plan.some((it) => it.kind === 'watch'), name + ': has a watch item');
      assert.ok(plan.some((it) => it.kind === 'drill' || it.kind === 'virtual'), name + ': has a drill/virtual item');
      const noCube = Coach.todayPlan(datas[name], when, { cube: false });
      assert.ok(noCube.every((it) => !it.needsCube), name + ': no-cube plan');
      assert.ok(noCube.some((it) => it.kind === 'watch') && noCube.some((it) => it.kind === 'drill' || it.kind === 'algs'),
        name + ': no-cube plan has something to watch and something to drill');
      assert.strictEqual(noCube.reduce((a, b) => a + b.minutes, 0), total);
    }
  });
  const kinds = (p) => Coach.todayPlan(datas[p], now).map((it) => it.kind);
  assert.deepStrictEqual(kinds('fresh').slice(0, 2), ['drill', 'lesson'], 'a total beginner starts with move names and a lesson');
  assert.strictEqual(Coach.todayPlan(datas.fresh, now)[1].target, 'daisy');
  assert.ok(kinds('learn').indexOf('lesson') !== -1);
  assert.strictEqual(Coach.todayPlan(datas.learn, now).find((it) => it.kind === 'lesson').target, 'ycross');
  assert.ok(kinds('learn').indexOf('algs') !== -1, 'due algorithms appear');
  assert.ok(kinds('practice').indexOf('solve') !== -1);
  assert.ok(Coach.todayPlan(datas.practice, now).some((it) => it.stageId === 'middle'), 'targets the weakest stage');
  assert.ok(kinds('independent').indexOf('timed') !== -1);
  const sp = Coach.todayPlan(datas.speed, now);
  assert.ok(sp.find((it) => it.kind === 'timed').minutes >= 10);
  assert.ok(sp.some((it) => it.stageId === 'ycross'), 'targets the slowest stage for its size');
});

// ------------------------------------------------------------------ Store
test('store: defaults shape', () => {
  const d = Store.defaults(at(2026, 1, 1));
  assert.strictEqual(d.version, 1);
  assert.strictEqual(d.settings.goalSeconds, 180);
  assert.strictEqual(d.settings.guidanceOverride, null);
  assert.deepStrictEqual(Object.keys(d.skills), STAGES);
  assert.deepStrictEqual(d.skills.daisy, { mastery: 0, sessions: 0, soloClean: 0, lastLevel: 3, lastPracticed: null });
  ['solves', 'drills', 'algs', 'practiceLog', 'milestones'].forEach((k) => assert.ok(k in d));
});

test('store: round trip through (fake) localStorage', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    const d = Store.load();
    Coach.recordStage(d, 'cross', { level: 2, hints: 1 }, at(2026, 2, 2));
    Coach.recordSolve(d, solve(123456, at(2026, 2, 2)), at(2026, 2, 2));
    d.settings.keyboard = 'cstimer';
    assert.strictEqual(Store.save(d), true);
    assert.ok(ls.m[Store.KEY]);
    assert.strictEqual(Store.persistent(), true);
    const back = Store.load();
    assert.deepStrictEqual(back, JSON.parse(JSON.stringify(d)));
    const fresh = Store.reset();
    assert.ok(!(Store.KEY in ls.m));
    assert.strictEqual(fresh.solves.length, 0);
  } finally { Store.useStorage(undefined); }
});

test('store: memory fallback when storage is missing or throws', () => {
  [null, throwingStorage].forEach((backend) => {
    Store.useStorage(backend);
    try {
      const d = Store.load();
      d.settings.goalSeconds = 150;
      assert.strictEqual(Store.save(d), false, 'not persistent');
      assert.strictEqual(Store.persistent(), false);
      assert.strictEqual(Store.load().settings.goalSeconds, 150, 'kept in memory for the session');
    } finally { Store.useStorage(undefined); }
  });
  // In plain node (no --localstorage-file) auto-detection must not throw.
  const d = Store.load();
  assert.strictEqual(d.version, 1);
});

test('store: a failed save does not resurrect older stored data', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    const d = Store.load(); d.settings.goalSeconds = 170; Store.save(d);
    ls.setItem = () => { throw new Error('QuotaExceededError'); };
    d.settings.goalSeconds = 160;
    assert.strictEqual(Store.save(d), false);
    assert.strictEqual(Store.load().settings.goalSeconds, 160);
  } finally { Store.useStorage(undefined); }
});

test('store: corrupt data -> defaults, with a backup copy', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    ls.setItem(Store.KEY, '{"version":1, "skills": {');
    const d = Store.load();
    assert.deepStrictEqual(d.skills.cross, Store.defaults().skills.cross);
    assert.strictEqual(ls.m[Store.CORRUPT_KEY], '{"version":1, "skills": {');
    ls.setItem(Store.KEY, '[1,2,3]');
    assert.strictEqual(Store.load().version, 1);
    ls.setItem(Store.KEY, 'null');
    assert.strictEqual(Store.load().version, 1);
  } finally { Store.useStorage(undefined); }
});

test('store: partial / old / future data merges over defaults', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    ls.setItem(Store.KEY, JSON.stringify({
      version: 1, settings: { mirror: false, goalSeconds: 'fast', guidanceOverride: 7, futureSetting: 'x' },
      skills: { cross: { mastery: 140, sessions: 3 }, newStage: { mastery: 5 } },
      solves: [{ totalMs: 1000, at: '2026-01-01T00:00:00.000Z' }, { bad: true }, 'junk'],
      practiceLog: { '2026-01-01': 12, '2026-01-02': 'x' }, futureTopLevel: { a: 1 }
    }));
    const d = Store.load();
    assert.strictEqual(d.settings.mirror, false);
    assert.strictEqual(d.settings.autoCapture, true, 'missing settings filled in');
    assert.strictEqual(d.settings.goalSeconds, 180, 'bad value -> default');
    assert.strictEqual(d.settings.guidanceOverride, null);
    assert.strictEqual(d.settings.futureSetting, 'x', 'unknown keys kept');
    assert.strictEqual(d.skills.cross.mastery, 100);
    assert.strictEqual(d.skills.cross.lastLevel, 3);
    assert.ok(d.skills.newStage && d.skills.daisy);
    assert.strictEqual(d.solves.length, 1);
    assert.strictEqual(d.solves[0].completed, true);
    assert.deepStrictEqual(d.practiceLog, { '2026-01-01': 12 });
    assert.deepStrictEqual(d.futureTopLevel, { a: 1 });
    // version 0 (no version) migrates
    ls.setItem(Store.KEY, JSON.stringify({ history: [{ totalMs: 5000, at: '2026-01-01T00:00:00.000Z' }] }));
    const m = Store.load();
    assert.strictEqual(m.version, 1);
    assert.strictEqual(m.solves.length, 1);
    assert.ok(!('history' in m));
  } finally { Store.useStorage(undefined); }
});

test('store: solves history is capped', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    const d = Store.defaults();
    for (let i = 0; i < Store.MAX_SOLVES + 50; i++) d.solves.push({ id: 'x' + i, at: '2026-01-01T00:00:00.000Z', totalMs: i });
    Store.save(d);
    assert.strictEqual(d.solves.length, Store.MAX_SOLVES);
    assert.strictEqual(d.solves[0].id, 'x50', 'oldest dropped');
    assert.strictEqual(Store.load().solves.length, Store.MAX_SOLVES);
    const e = Store.defaults();
    for (let i = 0; i < Store.MAX_SOLVES + 5; i++) Coach.recordSolve(e, solve(1000, at(2026, 1, 1)), at(2026, 1, 1));
    assert.strictEqual(e.solves.length, Store.MAX_SOLVES);
  } finally { Store.useStorage(undefined); }
});

test('store: export / import with validation', () => {
  const d = Store.defaults();
  Coach.recordSolve(d, solve(99000, at(2026, 2, 2)), at(2026, 2, 2));
  Coach.gradeAlg(d, 'sune', true, at(2026, 2, 2));
  const json = Store.exportJSON(d);
  assert.ok(typeof json === 'string' && json.length > 50);
  const back = Store.importJSON(json);
  assert.deepStrictEqual(back, JSON.parse(JSON.stringify(d)));
  assert.throws(() => Store.importJSON('not json'), /not a Cube Coach backup/);
  assert.throws(() => Store.importJSON('42'), /not a Cube Coach backup/);
  assert.throws(() => Store.importJSON('{"hello":1}'), /does not contain/);
  assert.throws(() => Store.importJSON('{"solves":{}}'), /damaged/);
  // an older export without a version is migrated
  assert.strictEqual(Store.importJSON('{"history":[]}').version, 1);
});

// ================================================================== review: bugs found and fixed
const solo8 = () => { const o = {}; STAGES.forEach((id) => { o[id] = 0; }); return o; };

test('Show never traps a learner: hints or wrong quizzes at Show still lead to Coach', () => {
  [{ hints: 2 }, { hints: 9 }, { quizRight: 0, quizTotal: 3 }, { hints: Infinity, quizRight: 0, quizTotal: 2 }].forEach((pol) => {
    const { levels } = simulate(12, () => Object.assign({ level: 3 }, pol));
    assert.ok(levels.indexOf(2) !== -1 && levels.indexOf(2) <= 4, JSON.stringify(pol) + ' reached Coach: ' + levels);
    assert.ok(levels.every((l) => l >= 2), 'but never past Coach');
  });
  assert.strictEqual(Coach.performance({ level: 3, hints: 99 }), Coach.PARAMS.showFloor);
});

test('no rounding trap: a score exactly on a threshold reaches it', () => {
  const d = Store.defaults();
  Object.assign(d.skills.cross, { mastery: 30, lastLevel: 2, sessions: 5 });
  const o = { level: 2, hints: 1, quizRight: 4, quizTotal: 5 };
  assert.strictEqual(Coach.performance(o), 50);
  let t = at(2026, 1, 1).getTime();
  for (let i = 0; i < 80; i++) { t += DAY; Coach.recordStage(d, 'cross', o, t); }
  assert.strictEqual(d.skills.cross.mastery, 50);
  assert.strictEqual(Coach.levelFor(d, 'cross', t), 1);
});

test('Solo needs clean Nudge/Solo work: Show or Coach practice alone never reaches it', () => {
  const show = simulate(200, () => ({ level: 3, hints: 0 }));
  assert.ok(show.levels.every((l) => l >= 2));
  const coach = simulate(200, () => ({ level: 2, hints: 0, quizRight: 2, quizTotal: 2 }));
  assert.ok(coach.levels.every((l) => l >= 1), 'Coach-only tops out at Nudge');
  assert.ok(coach.data.skills.corners.mastery < Coach.PARAMS.thresholds[0]);
});

test('recordStage input validation', () => {
  const d = Store.defaults(), t = at(2026, 3, 3);
  const snap = JSON.stringify(d);
  ['nope', '__proto__', 'constructor', undefined, null, 3].forEach((id) => {
    const r = Coach.recordStage(d, id, { level: 0 }, t);
    assert.ok(r.ignored && r.level === 3 && r.newMilestones.length === 0);
  });
  assert.strictEqual(JSON.stringify(d), snap, 'unknown stages write nothing');
  assert.strictEqual(({}).mastery, undefined, 'no prototype pollution');
  assert.ok(Coach.recordStage(undefined, 'cross', {}, t).ignored);
  // NaN / negative / Infinity / junk numbers
  const a = Coach.recordStage(Store.defaults(), 'cross', { level: 0, hints: NaN, ms: NaN, quizRight: -1, quizTotal: NaN }, t);
  assert.strictEqual(a.performance, 100);
  const b = Coach.recordStage(Store.defaults(), 'cross', { level: 0, hints: -4, ms: -500 }, t);
  assert.strictEqual(b.performance, 100, 'negative hints are no hints; negative ms is ignored');
  assert.strictEqual(Coach.recordStage(Store.defaults(), 'cross', { level: 0, hints: Infinity }, t).performance, 40, 'Infinity hints = max penalty, not zero');
  assert.strictEqual(Coach.recordStage(Store.defaults(), 'cross', { level: '0', hints: '3' }, t).performance, 58, 'numeric strings are read');
  assert.strictEqual(Coach.recordStage(Store.defaults(), 'cross', { level: 'solo' }, t).performance, 45, 'bad level -> the coach level (Show)');
  const c = Coach.recordStage(Store.defaults(), 'cross', { level: 2, quizRight: 9, quizTotal: 3 }, t);
  assert.strictEqual(c.performance, 68, 'quizRight is capped at quizTotal');
  [a, b, c].forEach((r) => assert.ok(Number.isFinite(r.mastery) && r.mastery >= 0 && r.mastery <= 100));
  // bad `now` falls back to the clock instead of writing "Invalid Date"
  const e = Store.defaults();
  Coach.recordStage(e, 'cross', { level: 3 }, 'not a date');
  assert.ok(!isNaN(new Date(e.skills.cross.lastPracticed).getTime()));
});

test('recordSolve validation: no time, tiny times and junk never award milestones', () => {
  const t = at(2026, 4, 4);
  [undefined, null, {}, { totalMs: 0 }, { totalMs: NaN }, { totalMs: -5 }, { totalMs: 'fast' }, { totalMs: 800 }, { totalMs: 2999 }].forEach((x) => {
    const d = Store.defaults();
    const r = Coach.recordSolve(d, x, t);
    assert.deepStrictEqual(r.newMilestones, [], JSON.stringify(x));
    assert.strictEqual(Coach.stats(d, {}, t).count, 0);
    assert.ok(r.solve.totalMs >= 0);
  });
  // a Date `at` is stored as an ISO string; a missing one is "now"
  const d = Store.defaults();
  assert.strictEqual(Coach.recordSolve(d, { totalMs: 200000, at: at(2026, 4, 3) }, t).solve.at, at(2026, 4, 3).toISOString());
  assert.strictEqual(Coach.recordSolve(d, { totalMs: 200000 }, t).solve.at, t.toISOString());
});

test('unaided definition: hints/levels in any shape are never lost', () => {
  const t = at(2026, 5, 5);
  const cases = [
    [{ hints: 2 }, false], [{ hints: '1' }, false], [{ hints: { cross: 1 } }, false],
    [{ levels: 2 }, false], [{ levels: { cross: 'Show' } }, false], [{ levels: { cross: '1' } }, false],
    [{ levels: { cross: 0, corners: null } }, true], [{ levels: solo8() }, true], [{}, true],
    [{ device: 'virtual' }, false], [{ completed: false }, false]
  ];
  cases.forEach(([extra, want]) => {
    const d = Store.defaults();
    const r = Coach.recordSolve(d, Object.assign({ totalMs: 170000, at: t.toISOString() }, extra), t);
    assert.strictEqual(r.newMilestones.indexOf('sub-3') !== -1, want, JSON.stringify(extra));
    assert.strictEqual(Coach.isUnaided(r.solve), want);
  });
  // ...and survive a save/load round trip
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    const d = Store.defaults();
    d.solves.push({ id: 'a', at: t.toISOString(), totalMs: 170000, hints: 3, levels: 1, completed: true });
    Store.save(d);
    const back = Store.load();
    assert.strictEqual(Coach.isUnaided(back.solves[0]), false, 'numeric hints/levels kept on load');
    assert.deepStrictEqual(back.solves[0].hints, { total: 3 });
  } finally { Store.useStorage(undefined); }
});

test('milestone thresholds are strict and each is awarded once', () => {
  const d = Store.defaults(), t = at(2026, 6, 6);
  let r = Coach.recordSolve(d, solve(180000, t, { levels: solo8() }), t);
  assert.ok(r.newMilestones.indexOf('sub-3') === -1, 'exactly 3:00 is not under 3:00');
  r = Coach.recordSolve(d, solve(179999, t, { levels: solo8() }), t);
  assert.deepStrictEqual(r.newMilestones, ['sub-3']);
  const seen = Object.keys(d.milestones).length;
  for (let i = 0; i < 5; i++) { Coach.checkMilestones(d, t); Coach.recordSolve(d, solve(170000, t, { levels: solo8() }), t); }
  assert.strictEqual(Object.keys(d.milestones).length, seen, 'no duplicates');
  // a Nudge-level stage (even with no hints) is not "unaided"
  const e = Store.defaults();
  r = Coach.recordSolve(e, solve(170000, t, { levels: Object.assign(solo8(), { middle: 1 }) }), t);
  assert.deepStrictEqual(r.newMilestones.sort(), ['first-coach', 'first-solve']);
  // milestones() always has every awardable id once
  const ids = Coach.milestones(d).map((m) => m.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('streak milestone counts any past 7-day run (e.g. from an imported backup)', () => {
  const d = Store.defaults();
  for (let i = 0; i < 8; i++) d.practiceLog[Coach.dayKey(at(2026, 2, 1 + i))] = 15;
  d.practiceLog.junk = 5; d.practiceLog['2026-13-45'] = 1;
  assert.strictEqual(Coach.longestStreak(d), 8);
  assert.strictEqual(Coach.stats(d, {}, at(2026, 5, 1)).streak, 0, 'the current streak is over');
  assert.deepStrictEqual(Coach.checkMilestones(d, at(2026, 5, 1)), ['streak-7']);
});

test('logPractice: zero, negative and junk minutes do not mark the day', () => {
  const d = Store.defaults(), t = at(2026, 7, 7, 23, 59);
  [0, -5, 'abc', NaN, null, undefined].forEach((m) => assert.strictEqual(Coach.logPractice(d, m, t).today, 0));
  assert.deepStrictEqual(d.practiceLog, {});
  assert.strictEqual(Coach.stats(d, {}, t).streak, 0);
  assert.strictEqual(Coach.logPractice(d, 1e9, t).today, 1440, 'capped at one day');
  assert.strictEqual(Coach.logPractice(d, '2', at(2026, 7, 8, 0, 1)).today, 2, 'after midnight is a new day');
  assert.strictEqual(Coach.stats(d, {}, at(2026, 7, 8, 12)).streak, 2);
});

test('averages: fewer than 5, DNFs, device filters, undated solves', () => {
  const t0 = at(2026, 8, 1, 10);
  const mk = (list, extra = {}) => {
    const d = Store.defaults();
    list.forEach((x, i) => Coach.recordSolve(d, solve(x === 'DNF' ? 60000 : x * 1000, new Date(t0.getTime() + i * H),
      Object.assign({ completed: x !== 'DNF' }, extra)), t0));
    return d;
  };
  let s = Coach.stats(mk([200, 210, 190, 205]), {}, t0);
  assert.strictEqual(s.ao5, null); assert.strictEqual(s.ao5Dnf, false);
  assert.strictEqual(s.mean, Math.round((200 + 210 + 190 + 205) / 4 * 1000));
  assert.strictEqual(s.best, 190000);
  s = Coach.stats(mk([200, 'DNF', 190, 205, 220]), {}, t0);
  assert.strictEqual(s.ao5, Math.round((200 + 205 + 220) / 3 * 1000), 'one DNF is the dropped worst');
  assert.strictEqual(s.count, 4); assert.strictEqual(s.dnf, 1);
  assert.strictEqual(s.mean, Math.round((200 + 190 + 205 + 220) / 4 * 1000), 'mean is over finished solves');
  s = Coach.stats(mk([200, 'DNF', 190, 'DNF', 220]), {}, t0);
  assert.strictEqual(s.ao5, null); assert.strictEqual(s.ao5Dnf, true, 'two DNFs: the average is a DNF');
  assert.strictEqual(s.best, 190000); assert.strictEqual(s.trend.length, 3);
  // the unaided average counts unaided DNFs too (giving up on slow solves cannot fake the goal)
  s = Coach.stats(mk([170, 'DNF', 175, 'DNF', 172], { levels: solo8() }), {}, t0);
  assert.strictEqual(s.unaided.count, 3); assert.strictEqual(s.unaided.ao5, null); assert.strictEqual(s.unaided.ao5Dnf, true);
  // device filter applies to DNFs as well
  const d = mk([200, 'DNF', 190, 205, 220]);
  Coach.recordSolve(d, solve(60000, new Date(t0.getTime() + 9 * H), { device: 'virtual', completed: false }), t0);
  assert.strictEqual(Coach.stats(d, { device: 'virtual' }, t0).dnf, 1);
  assert.strictEqual(Coach.stats(d, { device: 'physical' }, t0).dnf, 1);
  assert.strictEqual(Coach.stats(d, { device: 'banana' }, t0).dnf, 2, 'unknown filter = all');
  // undated / garbage-dated solves sort first instead of scrambling the order
  const e = Store.defaults();
  [['x', 300], [at(2026, 1, 2).toISOString(), 200], [null, 250], [at(2026, 1, 1).toISOString(), 100]]
    .forEach(([a, ms]) => e.solves.push({ at: a, totalMs: ms * 1000, completed: true, device: 'physical', source: 'scramble', stage: null, levels: {}, hints: {}, splits: {} }));
  assert.deepStrictEqual(Coach.stats(e, {}, at(2026, 1, 3)).trend.map((p) => p.ms / 1000), [300, 250, 100, 200]);
  assert.strictEqual(Coach.averageOf([1, 2, Infinity, Infinity, 3]), null);
  assert.strictEqual(Coach.averageOf([5, null, 1, 3, 4]), 4);
});

test('solving keeps stages fresh: timer-only solves stop decay (order-independent)', () => {
  const d = Store.defaults();
  STAGES.forEach((id) => Object.assign(d.skills[id], { mastery: 85, lastLevel: 0, sessions: 30, lastPracticed: at(2026, 1, 1).toISOString() }));
  for (let i = 1; i <= 60; i++) Coach.recordSolve(d, solve(200000, at(2026, 1, 1 + i), {}), at(2026, 1, 1 + i));
  assert.strictEqual(Coach.levelFor(d, 'cross', at(2026, 3, 3)), 0, 'still Solo after two months of timed solves');
  assert.strictEqual(Coach.journey(d, at(2026, 3, 3)).phase, 'independent');
  // decay already earned is kept, whichever of recordStage/recordSolve the UI calls first
  const mkd = () => { const x = Store.defaults(); Object.assign(x.skills.middle, { mastery: 85, lastLevel: 0, sessions: 9, lastPracticed: at(2026, 1, 1).toISOString() }); return x; };
  const back = at(2026, 2, 10), o = { level: 0, hints: 0 };
  const a = mkd(); Coach.recordSolve(a, solve(200000, back), back); Coach.recordStage(a, 'middle', o, back);
  const b = mkd(); Coach.recordStage(b, 'middle', o, back); Coach.recordSolve(b, solve(200000, back), back);
  assert.strictEqual(a.skills.middle.mastery, b.skills.middle.mastery);
  // stages never practised are left alone; drills and DNFs do not refresh
  const c = Store.defaults(); Coach.recordSolve(c, solve(200000, back), back);
  assert.strictEqual(c.skills.cross.lastPracticed, null);
  const f = mkd(); Coach.recordSolve(f, solve(200000, back, { completed: false }), back);
  assert.strictEqual(f.skills.middle.lastPracticed, at(2026, 1, 1).toISOString());
});

test('recordDrill accepts a Drills.check() result and rejects unsafe ids', () => {
  const d = Store.defaults(), t = at(2026, 9, 9);
  Coach.recordDrill(d, 'recognise', { correct: false, explain: 'x' }, t);
  Coach.recordDrill(d, 'recognise', { correct: true }, t);
  assert.deepStrictEqual([d.drills.recognise.right, d.drills.recognise.total], [1, 2]);
  const r = Coach.recordDrill(d, '__proto__', true, t);
  assert.strictEqual(r.drill, null);
  assert.strictEqual(({}).total, undefined);
});

test('journey phase follows the levels (hysteresis), so it does not flicker', () => {
  const now = at(2026, 10, 2, 9);
  const d = Store.defaults(now);
  STAGES.forEach((id) => Object.assign(d.skills[id], { mastery: 30, lastLevel: 2, sessions: 3, lastPracticed: now.toISOString() }));
  d.skills.middle.mastery = 22;                     // dipped below 25 but still Coach (demotes below 20)
  assert.strictEqual(Coach.levelFor(d, 'middle', now), 2);
  assert.strictEqual(Coach.journey(d, now).phase, 'practice');
  d.skills.middle.mastery = 19;
  assert.strictEqual(Coach.journey(d, now).phase, 'learn');
  assert.strictEqual(Coach.journey(d, now).focusStage, 'middle');
  ['{}', 'null'].forEach((x) => assert.strictEqual(Coach.journey(JSON.parse(x), now).phase, 'learn'));
});

test('todayPlan details: first warm-up, stalled stage, distinct drills, tips, empty data', () => {
  const now = at(2026, 10, 2, 9);
  const d = Store.defaults(now);
  d.drills.notation = { right: 10, total: 10, lastAt: null };
  const first = Coach.todayPlan(d, now)[0];
  assert.strictEqual(first.kind, 'drill');
  assert.ok(!/look back/.test(first.why) && first.stageId === null, 'nothing to look back on before the first stage');
  // a stage practised 10+ times and still at Coach gets a lesson recap
  const p = phaseData('practice', now);
  Object.assign(p.skills.middle, { mastery: 35, lastLevel: 2, sessions: 14 });
  const plan = Coach.todayPlan(p, now);
  const recap = plan.find((it) => it.kind === 'lesson');
  assert.ok(recap && recap.stageId === 'middle' && recap.stalled);
  assert.strictEqual(plan.reduce((a, b) => a + b.minutes, 0), 20);
  // two drills in one plan are different types
  for (let k = 0; k < 7; k++) {
    const q = phaseData('practice', now); q.drills.recognise = { right: 1, total: 9, lastAt: null };  // weak
    const dr = Coach.todayPlan(q, new Date(now.getTime() + k * DAY)).filter((it) => it.kind === 'drill');
    if (dr.length === 2 && dr[0].stageId === dr[1].stageId) assert.notStrictEqual(dr[0].drillType, dr[1].drillType);
  }
  // every watch item carries a tip (fallback content when CC.Lessons is absent)
  ['learn', 'practice', 'independent'].forEach((ph) => {
    const w = Coach.todayPlan(phaseData(ph, now), now).find((it) => it.kind === 'watch');
    assert.ok(w.tip && w.tip.title && w.tip.text, ph);
  });
  // missing or empty data never throws and still gives a full no-cube option
  [{}, undefined, null].forEach((x) => {
    const pl = Coach.todayPlan(x, now, { cube: false });
    assert.strictEqual(pl.reduce((a, b) => a + b.minutes, 0), 20);
    assert.ok(pl.every((it) => !it.needsCube));
  });
});

test('todayPlan uses CC.Lessons / CC.Drills when present', () => {
  const now = at(2026, 10, 2, 9);
  globalThis.CC.Lessons = {
    STAGES: { cross: { title: 'The White Cross', mnemonics: ['Match, then flip'], mistakes: [], speedTips: [] } },
    SPEED_TIPS: [{ title: 'Look ahead', text: 'Find the next piece while you turn.' }],
    ALGORITHMS: { rtrigger: { name: 'Right trigger', notation: "R U R' U'", usedIn: ['corners', 'yorient'] } }
  };
  globalThis.CC.Drills = { TYPES: [{ id: 'notation', name: 'Name that move', stageIds: null }, { id: 'recognise', name: 'Spot it', stageIds: ['cross'] }] };
  try {
    const d = Store.defaults(now);
    Object.assign(d.skills.daisy, { mastery: 30, lastLevel: 2, sessions: 2 });
    const plan = Coach.todayPlan(d, now);
    assert.strictEqual(plan[0].title, 'Warm-up: Name that move');
    const w = plan.find((it) => it.kind === 'watch');
    assert.ok(/The White Cross/.test(w.title));
    assert.deepStrictEqual(w.tip, { title: 'Memory aid', text: 'Match, then flip' });
    assert.strictEqual(Coach.todayPlan(phaseData('speed', now), now).find((it) => it.kind === 'watch').tip.title, 'Look ahead');
    // usedIn from lessons unlocks the trainer card from either stage
    const e = Store.defaults(now); Coach.recordStage(e, 'yorient', { level: 3 }, now);
    assert.ok(Coach.algDue(e, now).indexOf('rtrigger') !== -1);
  } finally { delete globalThis.CC.Lessons; delete globalThis.CC.Drills; }
});

test('hintLadder: notation fallback, clean punctuation, stage from the step id', () => {
  const h = Coach.hintLadder({ id: 'corners-2', title: 'Drop it in.', moves: ['R', 'U'], alg: { id: 'rtrigger', reps: '3' },
    segments: [{ label: 'Turn the cube so red faces you.', moves: ['y'] }] });
  assert.ok(h[1].text.includes("Right trigger: R U R' U', 3 times."), h[1].text);
  assert.ok(!/\.\./.test(h.map((x) => x.text).join(' ')), 'no double full stops');
  assert.ok(/R U R' U'/.test(h[0].text), 'stage worked out from the id');
  assert.ok(Coach.hintLadder({ stage: 'yedges', moves: ['Q'] })[2].plain === undefined, 'unknown token: no plain list, no throw');
  assert.deepStrictEqual(Coach.hintLadder('x'), []);
  globalThis.CC.Lessons = { STAGES: {}, ALGORITHMS: { sune: { name: 'Sune', notation: "R U R' U R U2 R'" } } };
  try {
    const s = Coach.hintLadder({ stage: 'yedges', moves: ['R'], alg: { id: 'sune' } });
    assert.ok(s[1].text.includes("Use the Sune: R U R' U R U2 R'."));
    assert.ok(/R U R' U R U2 R' U/.test(s[0].text), 'no lesson hint -> fallback concept');
  } finally { delete globalThis.CC.Lessons; }
});

test('store: hostile and odd JSON', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    ls.setItem(Store.KEY, '{"version":-3,"__proto__":{"polluted":1},"settings":{"__proto__":{"x":1},"mirror":false},' +
      '"skills":{"__proto__":{"mastery":99}},"drills":{"__proto__":{"right":1,"total":1}},"practiceLog":{"2026-01-01":"7.5","2026-01-02":1e-7,"2026-01-03":-1}}');
    const d = Store.load();
    assert.strictEqual(Object.getPrototypeOf(d), Object.prototype);
    assert.strictEqual(Object.getPrototypeOf(d.settings), Object.prototype);
    assert.strictEqual(Object.getPrototypeOf(d.drills), Object.prototype);
    assert.strictEqual(d.polluted, undefined); assert.strictEqual(({}).polluted, undefined);
    assert.strictEqual(d.settings.mirror, false);
    assert.strictEqual(d.version, 1);
    assert.deepStrictEqual(d.practiceLog, { '2026-01-01': 7.5, '2026-01-02': 1e-7 });
    // a backup saved with a byte-order mark still imports
    const back = Store.importJSON('﻿' + Store.exportJSON(d));
    assert.strictEqual(back.settings.mirror, false);
    assert.throws(() => Store.importJSON(undefined), /not a Cube Coach backup/);
  } finally { Store.useStorage(undefined); }
});

test('store: unknown nested fields survive save/load and export/import', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    const d = Store.defaults();
    d.solves.push({ id: 'n1', at: '2026-01-01T00:00:00.000Z', totalMs: 99000, smartCube: { moves: 61 }, levels: {}, hints: {} });
    d.skills.cross.bestMs = 4000; d.drills.reps = { right: 3, total: 4, lastAt: null, streak: 2 };
    d.algs.sune = { box: 3, due: '2026-01-04T00:00:00.000Z', right: 2, total: 2, ease: 2.5 }; d.settings.theme = 'dark';
    d.futureThing = [1, 2];
    Store.save(d);
    [Store.load(), Store.importJSON(Store.exportJSON(d))].forEach((b) => {
      assert.deepStrictEqual(b.solves[0].smartCube, { moves: 61 });
      assert.strictEqual(b.skills.cross.bestMs, 4000);
      assert.strictEqual(b.drills.reps.streak, 2);
      assert.strictEqual(b.algs.sune.ease, 2.5);
      assert.strictEqual(b.settings.theme, 'dark');
      assert.deepStrictEqual(b.futureThing, [1, 2]);
    });
    // a newer file version is kept as-is (not downgraded)
    ls.setItem(Store.KEY, JSON.stringify(Object.assign({}, d, { version: 2 })));
    assert.strictEqual(Store.load().version, 2);
  } finally { Store.useStorage(undefined); }
});

test('store: quota error with a long history keeps the newest solves', () => {
  const ls = fakeStorage(); Store.useStorage(ls);
  try {
    const d = Store.defaults();
    for (let i = 0; i < 500; i++) d.solves.push({ id: 'q' + i, at: '2026-01-01T00:00:00.000Z', totalMs: 100000 + i, completed: true });
    const real = ls.setItem;
    ls.setItem = (k, v) => { if (v.length > 30000) throw new Error('QuotaExceededError'); real(k, v); };
    assert.strictEqual(Store.save(d), true, 'the slimmed copy fits');
    assert.strictEqual(d.solves.length, 500, 'the in-memory data is untouched');
    const stored = JSON.parse(ls.m[Store.KEY]);
    assert.strictEqual(stored.solves.length, 200);
    assert.strictEqual(stored.solves[199].id, 'q499');
  } finally { Store.useStorage(undefined); }
});

// ------------------------------------------------------------------ simulated learners
// A learner with a hidden skill per stage that grows with practice. How much help they need
// at each level follows that skill. Prints nothing; asserts the journeys feel right.
function learnerRun({ days, perDay = 2, device = 'physical', caps = {}, override = null, data = null, start = at(2026, 1, 5, 18) }) {
  const d = data || Store.defaults(start);
  if (override !== null) d.settings.guidanceOverride = override;
  const skill = {}; STAGES.forEach((id) => { skill[id] = 0; });
  const rows = [];
  for (let day = 0; day < days; day++) {
    const t = start.getTime() + day * DAY;
    for (let n = 0; n < perDay; n++) {
      STAGES.forEach((id, i) => {
        const when = t + n * H + i * 60e3, lvl = Coach.levelFor(d, id, when), s = skill[id];
        const o = { level: lvl, device };
        if (lvl === 2) Object.assign(o, { quizTotal: 2, quizRight: s > 0.75 ? 2 : s > 0.4 ? 1 : 0, hints: s < 0.35 ? 2 : s < 0.55 ? 1 : 0 });
        if (lvl === 1) o.hints = s < 0.5 ? 2 : s < 0.7 ? 1 : 0;
        if (lvl === 0) o.hints = s < 0.45 ? 3 : s < 0.6 ? 2 : s < 0.8 ? 1 : 0;
        Coach.recordStage(d, id, o, when);
        skill[id] = Math.min(caps[id] ?? 1, s + [0.2, 0.18, 0.15, 0.1][lvl] * (1 - s));
      });
    }
    rows.push(STAGES.map((id) => 'SNCX'[Coach.autoLevel(d, id, t + 3 * H)]).join(''));
  }
  return { d, rows, end: start.getTime() + (days - 1) * DAY + 3 * H };
}

test('simulated: day-1 beginner, a fortnight of guided solves, virtual-only learner', () => {
  const t = at(2026, 1, 5, 18);
  const d = Store.defaults(t);
  Coach.recordStage(d, 'daisy', { level: Coach.levelFor(d, 'daisy', t), device: 'virtual' }, t);
  Coach.recordStage(d, 'daisy', { level: Coach.levelFor(d, 'daisy', t) }, t.getTime() + 600e3);
  assert.strictEqual(Coach.levelFor(d, 'daisy', t.getTime() + H), 2, 'day 1: the daisy steps back to Coach');
  assert.strictEqual(Coach.journey(d, t.getTime() + H).focusStage, 'cross', 'and tomorrow moves on to the cross');
  const g = learnerRun({ days: 14 });
  assert.strictEqual(g.rows[0], 'CCCCCCCC', 'two copied solves: every stage at Coach');
  const firstSolo = g.rows.indexOf('SSSSSSSS');
  assert.ok(firstSolo >= 3 && firstSolo <= 9, 'all Solo on day ' + (firstSolo + 1) + ': ' + g.rows);
  g.rows.forEach((r, i) => i && STAGES.forEach((_, k) => assert.ok('SNCX'.indexOf(r[k]) <= 'SNCX'.indexOf(g.rows[i - 1][k]), 'never demoted: ' + g.rows)));
  const v = learnerRun({ days: 14, device: 'virtual' });
  assert.ok(v.rows.indexOf('SSSSSSSS') >= firstSolo, 'virtual-only is no faster');
  assert.ok(v.rows.indexOf('SSSSSSSS') !== -1, 'but gets there');
});

test('simulated: a learner who stalls on one stage, and one who takes three weeks off', () => {
  const st = learnerRun({ days: 21, caps: { middle: 0.4 } });
  const last = st.rows[st.rows.length - 1];
  assert.strictEqual(last.replace(/S/g, ''), 'C', 'everything else is Solo; middle stays at Coach: ' + last);
  const j = Coach.journey(st.d, st.end);
  assert.strictEqual(j.phase, 'practice'); assert.strictEqual(j.focusStage, 'middle');
  const plan = Coach.todayPlan(st.d, st.end + DAY);
  assert.ok(plan.some((it) => it.kind === 'lesson' && it.stageId === 'middle'), 'stalled: recap the lesson');
  assert.ok(plan.filter((it) => it.stageId === 'middle').length >= 3);
  // a marginal Solo stage slips to Nudge after 3 weeks off; solid ones do not; one good day restores it
  const t = at(2026, 3, 1, 18);
  const d = Store.defaults(t);
  STAGES.forEach((id) => Object.assign(d.skills[id], { mastery: id === 'middle' ? 79 : 90, lastLevel: 0, sessions: 20, lastPracticed: t.toISOString() }));
  const back = new Date(t.getTime() + 21 * DAY);
  assert.strictEqual(Coach.levelFor(d, 'middle', back), 1);
  assert.strictEqual(Coach.levelFor(d, 'cross', back), 0);
  assert.strictEqual(Coach.journey(d, back).focusStage, 'middle');
  assert.strictEqual(Coach.stats(d, {}, back).streak, 0);
  Coach.recordStage(d, 'middle', { level: 1, hints: 0 }, back);
  assert.strictEqual(Coach.levelFor(d, 'middle', back), 0, 'one clean Nudge attempt and it is back at Solo');
});

test('simulated: overriding guidance', () => {
  // a beginner who forces Solo but leans on hints is not credited as Solo
  const o = learnerRun({ days: 3, override: 0, perDay: 1 });
  assert.ok(o.rows[0].indexOf('S') === -1, 'day 1 with 3 hints a stage: ' + o.rows[0]);
  STAGES.forEach((id) => assert.ok(Coach.autoLevel(o.d, id, o.end) >= 1));
  assert.strictEqual(Coach.levelFor(o.d, 'cross', o.end), 0, 'the override itself is respected');
  // a strong learner who picks Show to relax keeps their mastery
  const g = learnerRun({ days: 14 });
  const before = STAGES.map((id) => g.d.skills[id].mastery);
  g.d.settings.guidanceOverride = 3;
  for (let k = 1; k <= 10; k++) STAGES.forEach((id) => Coach.recordStage(g.d, id, { hints: 0 }, g.end + k * DAY));
  assert.deepStrictEqual(STAGES.map((id) => g.d.skills[id].mastery), before);
  g.d.settings.guidanceOverride = null;
  assert.ok(STAGES.every((id) => Coach.levelFor(g.d, id, g.end + 10 * DAY) === 0));
});

// ------------------------------------------------------------------ with the real Solver / Lessons (when present)
let ranSolverSteps = 0;
test('hintLadder on real solver steps (with and without CC.Lessons)', () => {
  let Solver, Lessons;
  try { require('../js/solver.js'); Solver = globalThis.CC.Solver; } catch (e) { Solver = null; }
  if (!Solver || typeof Solver.solve !== 'function') { delete globalThis.CC.Solver; return; }   // solver not written yet
  try {
    const checkAll = (label) => {
      let steps = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const st = Cube.applyAlg(Cube.applyAlg(Cube.solved(), 'z2'), Cube.scramble(25, seed));
        Solver.solve(st).stages.forEach((sg) => sg.steps.forEach((step) => {
          steps++;
          const h = Coach.hintLadder(step);
          assert.deepStrictEqual(h.map((x) => x.level), [1, 2, 3]);
          assert.ok(h.every((x) => typeof x.text === 'string' && x.text.length > 10), label + ' empty hint');
          assert.ok(!/\.\.|undefined|null/.test(h.map((x) => x.text).join(' ')), label + ': ' + h[1].text);
          assert.deepStrictEqual(h[2].moves, step.moves);
          assert.strictEqual(h[2].plain.length, step.moves.length);
          if (step.moves.some((t) => /^[xyz]/.test(t))) assert.ok(!/just as it is/.test(h[1].text), label + ' rotation not mentioned: ' + step.moves.join(' '));
          if (step.alg) assert.ok(h[1].text.includes(step.alg.notation || ''), label + ' alg');
        }));
      }
      assert.ok(steps > 200);
      ranSolverSteps += steps;
    };
    checkAll('fallback');
    try { require('../js/lessons.js'); Lessons = globalThis.CC.Lessons; } catch (e) { Lessons = null; }
    if (Lessons && Lessons.STAGES) checkAll('lessons');
  } finally { delete globalThis.CC.Solver; delete globalThis.CC.Lessons; }
});

test('local days across daylight-saving changes (both hemispheres)', () => {
  const d = Store.defaults();
  const start = at(2026, 1, 1);
  for (let i = 0; i < 400; i++) {
    Coach.logPractice(d, 5, at(2026, 1, 1 + i, 0, 30));
    Coach.logPractice(d, 5, at(2026, 1, 1 + i, 23, 30));
  }
  assert.strictEqual(Object.keys(d.practiceLog).length, 400, 'one entry per local day');
  assert.ok(Object.values(d.practiceLog).every((m) => m === 10));
  const end = at(2026, 1, 400, 22);
  assert.strictEqual(Coach.stats(d, {}, end).streak, 400);
  assert.strictEqual(Coach.longestStreak(d), 400);
  assert.strictEqual(Coach.stats(d, {}, end).weekMinutes, 70);
  // Leitner due dates land on the start of the local day whatever the offset that day
  const e = Store.defaults();
  for (let i = 0; i < 365; i += 3) {
    const t = new Date(start.getTime() + i * DAY + 20 * H);
    delete e.algs.twist;
    const c = Coach.gradeAlg(e, 'twist', true, t);
    // (the start of the local day: midnight, or 01:00 where DST begins at midnight, e.g. Chile)
    assert.strictEqual(c.due, new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).toISOString(), 'start of tomorrow: ' + c.due);
  }
  void start;
});

test('todayPlan: a Middle Layer Gym block while stuck on the middle layer (and only then)', () => {
  require('../js/gym.js');
  try {
    const now = new Date(2026, 10, 15, 9);
    const d = Store.defaults();
    ['daisy', 'cross', 'corners'].forEach((id) => { d.skills[id] = Object.assign({}, d.skills[id], { mastery: 85, sessions: 12, lastAt: now.toISOString() }); });
    d.skills.middle = Object.assign({}, d.skills.middle, { mastery: 28, sessions: 6, lastAt: now.toISOString() });
    for (const cube of [true, false]) {
      const plan = Coach.todayPlan(d, now, { cube });
      const gym = plan.filter((it) => it.kind === 'gym');
      assert.strictEqual(gym.length, 1, 'one gym item');
      assert.strictEqual(gym[0].stageId, 'middle');
      assert.ok(globalThis.CC.Gym.drill(gym[0].drillId), 'suggested drill exists: ' + gym[0].drillId);
      assert.strictEqual(plan.reduce((a, it) => a + it.minutes, 0), 20, 'still 20 minutes');
      assert.ok(!gym[0].needsCube);
    }
    d.skills.middle.mastery = 60;
    assert.ok(!Coach.todayPlan(d, now).some((it) => it.kind === 'gym'), 'no gym once past Nudge');
    d.skills.middle.mastery = 10; d.skills.middle.sessions = 0;
    assert.ok(!Coach.todayPlan(d, now).some((it) => it.kind === 'gym'), 'no gym before the middle layer is tried');
  } finally { delete globalThis.CC.Gym; }
});

if (!process.exitCode) console.log('(hint ladders checked on ' + ranSolverSteps + ' real solver steps)');
console.log(passed + ' coach/store tests passed' + (process.exitCode ? ' (some FAILED)' : ''));
