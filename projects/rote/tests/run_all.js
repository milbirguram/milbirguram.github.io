// Run every node test; exit non-zero if any fails.  Usage: node tests/run_all.js
const { spawnSync } = require('child_process');
const path = require('path');
const tests = ['test_model.js', 'test_metrics.js', 'test_rules_agree.js', 'test_eval.js', 'test_numbers.js'];
let failed = 0;
tests.forEach(t => {
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('FAILED', t); }
});
console.log(failed ? failed + ' test file(s) failed' : 'all tests passed');
process.exit(failed ? 1 : 0);
