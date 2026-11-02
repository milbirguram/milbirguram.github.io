// Hidden check (c): common cliches score lower (more predictable) than
// shuffled versions of themselves. Needs the shipped model trained on the
// books; the fixture corpus is far too small for this to mean anything.
'use strict';
var assert = require('assert');
var fs = require('fs');
var H = require('./helpers');

if (!fs.existsSync(H.SHIPPED)) {
  console.log('cliche: SKIPPED - data/model.bin has not been built from the books yet');
  process.exit(0);
}
var model = H.Bromide.load(fs.readFileSync(H.SHIPPED));
var CLICHES = [
  'At the end of the day, it was all for the best.',
  'She was as cold as ice.',
  'He was as quiet as a mouse.',
  'It was a dark and stormy night.',
  'Time heals all wounds.',
  'Last but not least, I would like to thank you all.',
  'He had a heart of gold.',
  'The sun rose slowly over the hills.',
  'In the blink of an eye, it was over.',
  'She could not believe her eyes.'
];

function avg(text) { return model.score(text).avgBits; }
function shuffle(words, rand) {
  var a = words.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

var rand = H.rng(1995);
CLICHES.forEach(function (c) {
  var words = H.Bromide.sentences(c)[0].filter(function (t) { return !/^[.,;:!?]$/.test(t); });
  var base = avg(c);
  var lower = 0, sum = 0, n = 30;
  for (var i = 0; i < n; i++) {
    var s = avg(shuffle(words, rand).join(' ') + '.');
    sum += s;
    if (base < s) lower++;
  }
  console.log('  ' + base.toFixed(2) + ' vs shuffled ' + (sum / n).toFixed(2) + ' (' + lower + '/' + n + ' lower)  ' + c);
  assert.ok(base < sum / n, 'cliche not more predictable than its shuffles: ' + c);
  assert.ok(lower >= 0.8 * n, 'cliche beat fewer than 80% of its shuffles: ' + c);
});
console.log('cliche: ok');
