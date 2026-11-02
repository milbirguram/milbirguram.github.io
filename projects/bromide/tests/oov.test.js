// Hidden check (d): words the model never saw are flagged, are not given a
// score of their own, and are left out of the average. Also checks that the
// Gutenberg header, footer and licence never reach the model.
'use strict';
var assert = require('assert');
var fs = require('fs');
var H = require('./helpers');

H.models().forEach(function (m) {
  var model = m.model;
  var r = model.score('The zorblequat sat by the fire.');
  var toks = r.sentences[0];
  var z = toks[1];
  assert.strictEqual(z.tok, 'zorblequat');
  assert.strictEqual(z.oov, true, 'unknown word flagged');
  assert.strictEqual(z.id, H.Bromide.UNK);
  toks.forEach(function (x) {
    assert.strictEqual(x.oov, !model.index.has(x.tok), 'oov flag matches the vocabulary for ' + x.tok);
  });
  assert.strictEqual(r.unknown, toks.filter(function (x) { return !x.punct && !model.index.has(x.tok); }).length);
  var known = toks.filter(function (x) { return !x.punct && !x.oov; });
  assert.strictEqual(r.known, known.length);
  if (known.length) {
    var avg = known.reduce(function (s, x) { return s + x.bits; }, 0) / known.length;
    assert.ok(Math.abs(r.avgBits - avg) < 1e-12, 'average covers known words only');
  } else {
    assert.strictEqual(r.avgBits, null);
  }

  var none = model.score('Zorblequat qwxvplim!');
  assert.strictEqual(none.known, 0);
  assert.strictEqual(none.avgBits, null, 'no fake average when nothing is known');

  assert.strictEqual(model.score('').sentences.length, 0);
  assert.strictEqual(model.score('  ,,, ... ').sentences.length, 0);

  ['gutenberg', 'trademark', 'transcriber', 'ebook', 'ebooks', 'pglaf', 'www', 'http', 'copyright', 'donations'].forEach(function (w) {
    assert.ok(!model.index.has(w), m.name + ': "' + w + '" from the licence text reached the vocabulary');
  });
  // These are ordinary words in the novels ("a special licence", "poetic
  // license"), so they may be known; but the licence text, repeated in every
  // book, would make them common. Each must stay rarer than 1 in 10,000.
  ['license', 'licence', 'royalty', 'refund'].forEach(function (w) {
    if (!model.index.has(w)) return;
    var p = model.p1[model.index.get(w)];
    assert.ok(p < 1e-4, m.name + ': "' + w + '" is too common (' + p + '); the licence text may have leaked');
  });
  console.log('  ' + m.name + ': unknown words are flagged and unscored');
});

// Fixture only: the front matter and the [Illustration] tag were stripped.
var fx = H.Bromide.load(fs.readFileSync(H.fixtureModelPath()));
['produced', 'illustration', 'updated', 'transcriber'].forEach(function (w) {
  assert.ok(!fx.index.has(w), 'fixture: "' + w + '" should have been stripped');
});
console.log('oov: ok');
