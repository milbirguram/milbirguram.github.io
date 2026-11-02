// Hidden check (a): for 100 random contexts, the next-word probabilities over
// the whole vocabulary sum to 1 within 1e-6.
'use strict';
var assert = require('assert');
var H = require('./helpers');

H.models().forEach(function (m) {
  var model = m.model, rand = H.rng(1951);
  var dist = new Float64Array(model.V);
  var worst = 0;
  for (var i = 0; i < 100; i++) {
    var u, v;
    if (i % 2 === 0 && model.tri.keys.length) {
      // A context the trigram table knows, so all three levels are exercised.
      var key = model.tri.keys[Math.floor(rand() * model.tri.keys.length)];
      u = Math.floor(key / model.V);
      v = key % model.V;
    } else {
      u = Math.floor(rand() * model.V);
      v = Math.floor(rand() * model.V);
    }
    model.distribution(u, v, dist);
    assert.strictEqual(dist[H.Bromide.START], 0, '<s> is never predicted');
    var sum = 0;
    for (var w = 0; w < model.V; w++) {
      assert.ok(dist[w] >= 0, 'negative probability');
      sum += dist[w];
    }
    worst = Math.max(worst, Math.abs(sum - 1));
    assert.ok(Math.abs(sum - 1) < 1e-6, m.name + ': context ' + u + ',' + v + ' sums to ' + sum);
    // The pointwise scorer agrees with the full distribution.
    var probe = Math.floor(rand() * model.V);
    assert.ok(Math.abs(model.prob(u, v, probe) - dist[probe]) < 1e-15);
  }
  console.log('  ' + m.name + ': 100 contexts sum to 1 (worst error ' + worst.toExponential(2) + ')');
});
console.log('normalisation: ok');
