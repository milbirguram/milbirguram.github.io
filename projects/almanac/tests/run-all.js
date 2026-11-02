// Runs every Almanac test: node checks of the page logic and stored data, then the
// Python contract and pipeline tests.
//   node projects/almanac/tests/run-all.js
var spawnSync = require('child_process').spawnSync;
var path = require('path');
var failed = 0;

['model.test.js', 'freshness.test.js', 'recompute-headline.js'].forEach(function (f) {
  var r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('FAILED: ' + f); }
});

var py = spawnSync('python', ['-I', '-m', 'unittest', 'discover', '-s', __dirname, '-p', 'test_*.py'],
  { encoding: 'utf8' });
var out = (py.stderr || '') + (py.stdout || '');
var lines = out.split('\n').filter(function (l) { return /^(Ran |OK|FAILED)/.test(l); }).join('  ');
if (py.error || py.status !== 0) {
  failed++;
  console.error(out);
  console.error('FAILED: python contract tests');
} else {
  console.log('python contract + pipeline tests: ' + lines);
}

if (failed) { console.error(failed + ' test file(s) failed'); process.exit(1); }
console.log('all tests passed');
