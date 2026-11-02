// Runs every offline test. Run: node projects/echo/tests/run-all.js
var spawnSync = require('child_process').spawnSync;
var path = require('path');
var failed = 0;
['dates.test.js', 'wikitext.test.js', 'search.test.js', 'rewording.test.js', 'network.test.js', 'cases.test.js'].forEach(function (f) {
  var r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.status !== 0) { failed++; process.stdout.write(r.stderr); console.log('FAILED: ' + f); }
});
process.exit(failed ? 1 : 0);
