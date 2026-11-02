// Rounding. The shipped values are rounded (a tenth of a bit for each value, an
// eighth of a bit on a logit grid for each back-off weight), then each
// context's values are scaled to fill exactly what its weight leaves. This
// checks the result against exact, unrounded Kneser-Ney (tests/kn_exact.py,
// written separately), token by token and over whole vocabularies:
//  - unpruned fixture: every probability within 0.15 bits of exact;
//  - pruned fixture (--prune=2,2): within the bound the build computed and
//    wrote into the header (quant.bound), which must itself be at most 0.25
//    bits, against exact Kneser-Ney pruned the same way. Pruning moves mass to
//    the back-off weight; rounding must not inflate or shrink that weight by
//    more than the bound, in either direction.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var H = require('./helpers');

function check(name, modelPath, expectPruned, limit) {
  var model = H.Bromide.load(fs.readFileSync(modelPath));
  var ref = JSON.parse(H.python([path.join(__dirname, 'kn_exact.py'), path.join(__dirname, 'fixture'), modelPath]));
  assert.ok(ref.vocab_matches, name + ': vocabulary differs from the exact reference');
  assert.strictEqual(ref.pruned, expectPruned, name + ': pruned flag');
  var q = model.header.quant;
  assert.ok(q && q.bound <= 0.25, name + ': rounding bound ' + (q && q.bound) + ' over 0.25 bits');
  assert.strictEqual(q.contexts_dropped_off_grid, 0, name + ': a context fell off the back-off grid');
  limit = Math.min(limit, q.bound + 1e-9);

  var worst = 0, worstRow = null, up = 0, down = 0;
  ref.rows.forEach(function (r) {
    var exact = r[3], shipped = model.prob(r[0], r[1], r[2]);
    if (exact === 0) { assert.strictEqual(shipped, 0); return; }
    var d = Math.log2(shipped / exact);
    up = Math.max(up, d);
    down = Math.min(down, d);
    if (Math.abs(d) > worst) { worst = Math.abs(d); worstRow = r; }
  });
  console.log('  ' + name + ': ' + ref.rows.length + ' probabilities; shipped is at most ' + up.toFixed(3) +
    ' bits above and ' + (-down).toFixed(3) + ' below exact (bound ' + q.bound.toFixed(3) + ')' +
    (worstRow ? '; worst ' + model.vocab[worstRow[0]] + ' ' + model.vocab[worstRow[1]] + ' -> ' + model.vocab[worstRow[2]] : ''));
  assert.ok(worst <= limit, name + ': shipped probability is ' + worst.toFixed(3) + ' bits from exact Kneser-Ney (limit ' + limit.toFixed(3) + ')');
  return { model: model, ref: ref };
}

var full = check('fixture', H.fixtureModelPath(), false, 0.15);
check('pruned fixture', H.prunedFixtureModelPath(), true, 0.25);

// Near-certain contexts can say so: the largest probability in some context
// should be able to exceed 0.995 when the exact value does.
var exactMax = 0, shippedMax = 0;
full.ref.rows.forEach(function (r) {
  if (r[3] > exactMax) { exactMax = r[3]; shippedMax = full.model.prob(r[0], r[1], r[2]); }
});
console.log('  most certain prediction: exact ' + exactMax.toFixed(4) + ', shipped ' + shippedMax.toFixed(4));
console.log('exact: ok');
