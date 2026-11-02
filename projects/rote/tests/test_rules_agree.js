// HIDDEN CHECK: the JS rules (page) and the Python rules (evaluation) agree on a fixed suite,
// on the stored suite outputs, and on every token of the demo sentences.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../model.js');
const py = require('./py.js');

const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules_suite.json'), 'utf8'));
const live = py("import rules\nprint(json.dumps([[list(x) for x in rules.run_rules(c['tokens'])] for c in data]))", suite);
let n = 0;
suite.forEach((c, k) => {
  const js = R.runRules(c.tokens);
  js.forEach((r, i) => {
    n++;
    const where = JSON.stringify(c.tokens) + ' #' + i;
    assert.strictEqual(r.out, c.out[i], 'stored suite: ' + where);
    assert.strictEqual(r.cls, c.cls[i], 'stored suite class: ' + where);
    assert.strictEqual(r.out, live[k][i][1], 'live python: ' + where);
    assert.strictEqual(r.cls, live[k][i][0], 'live python class: ' + where);
  });
});

// a few readings checked by hand against the conventions of the Kestrel references
const want = {
  '£900': 'nine hundred pounds', '3,500 kg': 'three thousand five hundred kilograms',
  'May 20, 2008': 'may twentieth two thousand eight', '15 February 1987': 'the fifteenth of february nineteen eighty seven',
  '2010': 'twenty ten', '1905': 'nineteen o five', '$11.50': 'eleven dollars and fifty cents', '7/4': 'seven quarters',
  '07:00': "seven o'clock", '92.10': 'ninety two point one o', 'NGOs': "n g o's", '1990s': 'nineteen nineties',
  '90s': 'nineties', "20's": 'twenties', '10s': 'tens',
};
Object.keys(want).forEach(k => assert.strictEqual(R.normalize(k, {}).out, want[k], k));

// demo sentences: the JS rules reproduce the Python rules' verdict on every stored token
const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'demo.json'), 'utf8'));
let m = 0;
demo.sentences.forEach(s => {
  const toks = s.map(t => typeof t === 'string' ? t : t[0]);
  const out = R.runRules(toks);
  s.forEach((t, i) => {
    m++;
    if (typeof t === 'string') { assert.ok(R.exactMatch(out[i].out, t), 'plain token ' + t); return; }
    const ref = t[2] === 0 ? t[0] : t[2];
    assert.strictEqual(R.exactMatch(out[i].out, ref) ? 1 : 0, t[6], 'demo token ' + t[0]);
  });
});
console.log('test_rules_agree: ok (%d suite tokens, %d demo tokens)', n, m);
