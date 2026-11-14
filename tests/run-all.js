// node tests/run-all.js [filter]
// Runs every tests/*.test.js in its own node process, prints a summary, exits 1 if any fail.
// Optional filter: only run test files whose name contains it, e.g. `node tests/run-all.js solver`.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const self = path.basename(__filename);
const filter = process.argv[2] || '';
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.js') && f !== self && f.includes(filter))
  .sort();

if (!files.length) {
  console.log(filter ? `No test files match "${filter}".` : 'No test files found in tests/.');
  process.exit(filter ? 1 : 0);
}

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const dim = (s) => paint('2', s);

const results = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    cwd: path.join(dir, '..'),
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024
  });
  const ms = Date.now() - t0;
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const ok = r.status === 0 && !r.error && !r.signal;
  const lines = out ? out.split('\n') : [];
  const last = lines.length ? lines[lines.length - 1] : '';
  results.push({ f, ok, ms });
  console.log(`${ok ? green('PASS') : red('FAIL')} ${f} ${dim(`(${(ms / 1000).toFixed(2)}s)`)}${ok && last ? dim('  ' + last) : ''}`);
  if (!ok) {
    if (r.error) console.log('  ' + red(String(r.error.message || r.error)));
    if (r.signal) console.log('  ' + red('killed by ' + r.signal));
    const shown = lines.slice(-40);
    if (lines.length > shown.length) console.log(dim(`  … ${lines.length - shown.length} earlier lines hidden`));
    shown.forEach((l) => console.log('  ' + l));
  }
}

const failed = results.filter((r) => !r.ok);
const total = results.reduce((s, r) => s + r.ms, 0);
console.log('');
console.log(`${results.length} test file(s): ${green(results.length - failed.length + ' passed')}, ` +
  `${failed.length ? red(failed.length + ' failed') : '0 failed'} ${dim(`in ${(total / 1000).toFixed(2)}s`)}`);
if (failed.length) {
  console.log(red('Failed: ' + failed.map((r) => r.f).join(', ')));
  process.exit(1);
}
