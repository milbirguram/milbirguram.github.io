// Hidden check (b): the JavaScript scorer matches the Python reference scorer
// (build/score.py) on 50 random sentences within 1e-6 bits, token by token.
'use strict';
var assert = require('assert');
var path = require('path');
var H = require('./helpers');

function randomSentences(model, seed) {
  var rand = H.rng(seed);
  var extras = ['Mr.', 'Mrs.', 'don’t', 'Café', 'naïve', 'zorbly', 'qwxv', '1848', '—', '"',
    'o’clock', '...', '?!', 'Æsop', 'straße', '‘tis', 'dogs’'];
  var punct = [',', '.', ';', ':', '!', '?'];
  var out = [];
  for (var i = 0; i < 50; i++) {
    var n = 3 + Math.floor(rand() * 16);
    var s = '';
    for (var k = 0; k < n; k++) {
      var word;
      if (rand() < 0.12) word = extras[Math.floor(rand() * extras.length)];
      else word = model.vocab[3 + Math.floor(rand() * Math.min(model.V - 3, 3000))];
      if (rand() < 0.15) word = word.charAt(0).toUpperCase() + word.slice(1);
      s += (k ? (rand() < 0.05 ? '\n\n' : ' ') : '') + word;
      if (rand() < 0.15) s += punct[Math.floor(rand() * punct.length)];
    }
    out.push(s);
  }
  return out;
}

H.models().forEach(function (m) {
  var sentences = randomSentences(m.model, 1948);
  var ref = JSON.parse(H.python([path.join(H.ROOT, 'build', 'score.py'), m.path],
    JSON.stringify({ sentences: sentences, tokenize: true })));
  var worst = 0, count = 0;
  sentences.forEach(function (text, i) {
    assert.deepStrictEqual(H.Bromide.sentences(text), ref.tokens[i], 'tokenisation differs for ' + JSON.stringify(text));
    var js = m.model.score(text).sentences;
    var py = ref.results[i];
    assert.strictEqual(js.length, py.length);
    js.forEach(function (sent, si) {
      assert.strictEqual(sent.length, py[si].length);
      sent.forEach(function (x, ti) {
        var r = py[si][ti];
        assert.strictEqual(x.tok, r.tok);
        assert.strictEqual(x.id, r.id);
        assert.strictEqual(x.oov, r.oov);
        var d = Math.abs(x.bits - r.bits);
        worst = Math.max(worst, d);
        count++;
        assert.ok(d < 1e-6, m.name + ': ' + x.tok + ' differs by ' + d + ' bits');
      });
    });
  });
  console.log('  ' + m.name + ': ' + count + ' tokens in 50 sentences agree (worst ' + worst.toExponential(2) + ' bits)');
});
console.log('reference: ok');
