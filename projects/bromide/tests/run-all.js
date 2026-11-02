// Runs every Bromide test: node projects/bromide/tests/run-all.js
'use strict';
var cp = require('child_process');
var path = require('path');
var tests = ['strip', 'normalisation', 'reference', 'exact', 'oov', 'cliche', 'shipped'];
var failed = 0;
tests.forEach(function (t) {
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, t + '.test.js')], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(t + ': FAILED'); }
});
console.log(failed ? failed + ' test file(s) failed' : 'all tests passed');
process.exit(failed ? 1 : 0);
