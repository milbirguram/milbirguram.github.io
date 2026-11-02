// Checks the recorded case-file results in tests/cases.json: every documented incident is flagged
// as a possible echo, no control is, and no whole-sentence run of a reworded incident comes out
// "Source came first". The results come from tests/run-cases.js (live API) or the page's
// "Re-run the case files" button. Run: node projects/echo/tests/cases.test.js
var assert = require('assert');
var C = require('../cases.js');
var data = require('./cases.json');
var R = require('../recorded.js');
var documented = C.CASES.filter(function (c) { return c.kind === 'documented'; });
var controls = C.CASES.filter(function (c) { return c.kind === 'control'; });
assert.ok(documented.length >= 2 && documented.length <= 4, '2 to 4 documented cases');
assert.strictEqual(controls.length, 2, 'two controls');
var runs = C.runs();
runs.forEach(function (run) {
  var c = C.CASES.filter(function (x) { return x.id === run.caseId; })[0];
  var r = data.results.filter(function (x) { return x.id === run.id; })[0];
  assert.ok(r, 'recorded result for ' + run.id);
  assert.ok(!r.error, run.id + ' ran without error');
  assert.strictEqual(r.oldid, c.oldid, run.id + ' pinned revision');
  assert.strictEqual(r.trace, run.trace || r.sentence, run.id + ' traced text');
  if (run.expect === 'echo') assert.strictEqual(r.code, 'echo', run.id + ' must be flagged');
  else if (run.expect === 'clean') assert.notStrictEqual(r.code, 'echo', run.id + ' must not be flagged');
  else assert.notStrictEqual(r.code, run.expect.slice(4), run.id + ' must not be ' + run.expect.slice(4));
  assert.ok(r.pass, run.id + ' pass');
  assert.ok(R[run.id] && R[run.id].code === r.code, run.id + ' recorded.js matches cases.json');
});
// A case that traces shorter words uses the words Echo itself suggests from the earlier wording
// its whole-sentence run found, so the trace is not hand-picked.
C.CASES.filter(function (c) { return c.trace; }).forEach(function (c) {
  var whole = data.results.filter(function (x) { return x.id === c.id + ':whole'; })[0];
  assert.ok(whole && whole.earlierWording, c.id + ': the whole-sentence run found an earlier wording');
  assert.ok(whole.earlierWording.suggestions.indexOf(c.trace) >= 0, c.id + ': the trace is Echo\'s own suggestion');
});
console.log('cases: ' + documented.length + ' documented flagged, ' + controls.length + ' controls clear, ' +
  (runs.length - C.CASES.length) + ' whole-sentence runs not cleared (recorded ' + data.ranAt.slice(0, 10) + ')');
