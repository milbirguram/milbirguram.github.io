// Run every test: node projects/stencil/tests/run.js
'use strict';
var cp = require('child_process');
var path = require('path');
var failed = 0;
['model.test.js', 'shipped.test.js', 'split.test.js', 'static.test.js', 'claims.test.js'].forEach(function (f) {
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('FAILED: ' + f); }
});
if (failed) process.exit(1);
console.log('all stencil tests passed');
