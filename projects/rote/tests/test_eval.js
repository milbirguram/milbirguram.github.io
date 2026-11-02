// HIDDEN CHECKS on the evaluation output: the copy baseline matches the PLAIN+PUNCT share,
// seen/unseen comes from train inputs, and the numbers hang together.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../model.js');
const D = path.join(__dirname, '..', 'data');
const ev = JSON.parse(fs.readFileSync(path.join(D, 'eval.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(path.join(D, 'demo.json'), 'utf8'));
const lookup = JSON.parse(fs.readFileSync(path.join(D, 'lookup.json'), 'utf8'));
const SYS = ['copy', 'lookup', 'rules', 'neural', 'gated'];
assert.deepStrictEqual(ev.systems, SYS);

// copy baseline: exact match over all test tokens is about the share of PLAIN + PUNCT
const copyAll = ev.scores['10'].copy.exact;
const share = ev.test.plain_punct_share;
assert.ok(Math.abs(copyAll - share) < 0.01, 'copy ' + copyAll + ' vs PLAIN+PUNCT share ' + share);
assert.ok(share > 0.9 && share < 0.95, 'share in the expected range');
// with PLAIN/PUNCT set aside, copy gets only the non-trivial tokens Kestrel leaves as written
assert.ok(ev.scores['00'].copy.exact < 0.2, 'copy on non-trivial tokens');

// keys: first digit = PLAIN/PUNCT included, second = unseen only
assert.strictEqual(ev.scores['10'].copy.n, ev.test.tokens);
assert.strictEqual(ev.scores['00'].copy.n, ev.test.nontrivial_tokens);
assert.strictEqual(ev.scores['01'].copy.n, ev.test.unseen_nontrivial);
assert.strictEqual(ev.scores['11'].copy.n, ev.test.unseen_all);
assert.strictEqual(ev.test.seen_nontrivial + ev.test.unseen_nontrivial, ev.test.nontrivial_tokens);
assert.strictEqual(Object.values(ev.test.class_counts).reduce((a, b) => a + b, 0), ev.test.tokens);
SYS.forEach(s => {
  const pc = Object.values(ev.per_class[s]);
  assert.strictEqual(pc.reduce((a, c) => a + c.n, 0), ev.test.nontrivial_tokens, s + ' per-class total');
  assert.strictEqual(pc.reduce((a, c) => a + c.unseen_n, 0), ev.test.unseen_nontrivial, s + ' per-class unseen');
  const correct = pc.reduce((a, c) => a + c.c, 0);
  assert.ok(Math.abs(correct / ev.test.nontrivial_tokens - ev.scores['00'][s].exact) < 1e-9, s + ' per-class agrees with the scoreboard');
  Object.keys(ev.scores).forEach(k => {
    const v = ev.scores[k][s];
    assert.ok(v.exact >= 0 && v.exact <= 1 && v.padded >= v.exact - 1e-9, 'padding never lowers a score: ' + s + ' ' + k);
  });
  const wrong = Object.values(ev.silly[s]).reduce((a, b) => a + b, 0);
  assert.strictEqual(wrong, ev.test.nontrivial_tokens - correct, s + ' error kinds add up to the wrong readings');
});
assert.ok(ev.scores['10'].copy.padded > 0.95, 'even copying scores above 95% under the old metric');
// lookup can only fall back to copying on unseen inputs
assert.ok(Math.abs(ev.scores['01'].lookup.exact - ev.scores['01'].copy.exact) < 1e-9, 'lookup equals copy on unseen tokens');
// gated (the neural model behind the rules' own choice of what to read) leaves unread what the rules leave unread
assert.strictEqual(ev.silly_unseen.gated.unread, ev.silly_unseen.rules.unread, 'gated and rules leave the same unseen tokens unread');
assert.ok(ev.gate.trivial_sent_to_model > 0 && ev.gate.nontrivial_not_sent > 0, 'gate counts recorded');
// the oracle helps: told which tokens need reading, neural never scores below gated on non-trivial tokens
assert.ok(ev.scores['00'].neural.exact >= ev.scores['00'].gated.exact && ev.scores['01'].neural.exact >= ev.scores['01'].gated.exact, 'oracle advantage');

// seen/unseen is about train inputs: an input the train lookup holds must be marked seen,
// and on an unseen input lookup can only copy
let inTable = 0;
demo.sentences.forEach(s => s.forEach(t => {
  if (typeof t === 'string') return;
  if (Object.prototype.hasOwnProperty.call(lookup, t[0])) { assert.strictEqual(t[3], 1, t[0] + ' is in the train lookup'); inTable++; }
  if (t[3] === 0) {
    const ref = t[2] === 0 ? t[0] : t[2];
    assert.ok(t[4] === 0 || (t[4] === 1 && R.exactMatch(t[0], ref)), 'an unseen input gets a copy from lookup: ' + t[0]);
  }
}));
assert.ok(inTable > 100, 'enough demo tokens found in the lookup table');
assert.ok(demo.sentences.length >= 1000, 'demo sentences');
assert.ok(fs.statSync(path.join(D, 'demo.json')).size <= 300 * 1024, 'demo.json within budget');
assert.ok(fs.statSync(path.join(D, 'lookup.json')).size <= 160 * 1024, 'lookup.json within budget');
console.log('test_eval: ok (copy %s vs share %s)', copyAll.toFixed(4), share.toFixed(4));
