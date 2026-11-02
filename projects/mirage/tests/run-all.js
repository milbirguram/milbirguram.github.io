// Run every test file; exit non-zero if any fails.
//   node projects/mirage/tests/run-all.js
'use strict';
var cp = require('child_process'), path = require('path');
var files = ['stats.test.js', 'showcase.test.js', 'null.test.js'];
var bad = 0;
files.forEach(function (f) {
  console.log('\n== ' + f);
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
});
console.log(bad ? '\n' + bad + ' test file(s) failed' : '\nall test files passed');
process.exit(bad ? 1 : 0);
