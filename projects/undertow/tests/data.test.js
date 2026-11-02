// Checks that data.js (the figures the page shows) is exactly what model.js computes.
// Run: node projects/undertow/tests/data.test.js   (about 20 s)
'use strict';
var assert = require('assert');
var path = require('path');
var data = require(path.join(__dirname, '..', 'data.js'));
var build = require(path.join(__dirname, '..', 'tools', 'build-data.js'));

var fresh = build.compute();
try {
  assert.deepStrictEqual(data.steps, fresh.steps, 'step figures');
  assert.deepStrictEqual(data.phase, fresh.phase, 'phase map');
  console.log('ok   data.js matches a fresh computation from model.js (' + data.steps.length + ' steps, ' +
    data.phase.rows.length + ' x ' + data.phase.factors.length + ' phase cells)');
} catch (e) {
  console.error('FAIL data.js is stale: run node projects/undertow/tools/build-data.js\n     ' + e.message.split('\n')[0]);
  process.exitCode = 1;
}
