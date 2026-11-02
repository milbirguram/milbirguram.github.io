// The shipped files: model size budget, book list, and the preview numbers
// (which must be the shipped model's own scores, not hand-written).
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var H = require('./helpers');

var data = path.dirname(H.SHIPPED);
if (!fs.existsSync(H.SHIPPED)) {
  console.log('shipped: SKIPPED - data/model.bin has not been built from the books yet');
  process.exit(0);
}
var size = fs.statSync(H.SHIPPED).size;
assert.ok(size <= 4000000, 'model.bin is ' + size + ' bytes, over the 4 MB budget');
var model = H.Bromide.load(fs.readFileSync(H.SHIPPED));

var books = JSON.parse(fs.readFileSync(path.join(data, 'books.json'), 'utf8')).books;
assert.strictEqual(books.length, model.header.corpus.books);
if (books.length < 25) console.log('  warning: only ' + books.length + ' books');
books.forEach(function (b) { assert.ok(b.title && b.author, 'book entry complete'); });

var ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(data, 'preview.js'), 'utf8'), ctx);
ctx.window.BROMIDE_PREVIEW.sentences.forEach(function (s) {
  var text = s.words.map(function (w) { return w.pre + w.t; }).join('');
  var r = model.score(text);
  var flat = [].concat.apply([], r.sentences);
  assert.strictEqual(flat.length, s.words.length);
  flat.forEach(function (x, i) {
    var w = s.words[i];
    if (w.bits !== undefined) assert.ok(Math.abs(w.bits - x.bits) < 0.006, 'preview bits for ' + w.t);
    assert.strictEqual(!!w.oov, x.oov && !x.punct);
  });
  if (s.avg !== null) assert.ok(Math.abs(s.avg - r.avgBits) < 0.006);
});

// The preview labels one line "tired" and the other "fresher"; the model has to agree,
// and the fresher line must not get its number by leaving most of its words out.
var byLabel = {};
ctx.window.BROMIDE_PREVIEW.sentences.forEach(function (s) { byLabel[s.label] = s; });
var tired = byLabel.tired, fresh = byLabel.fresh;
var freshUnknown = fresh.words.filter(function (w) { return w.oov; }).length;
console.log('  preview: tired ' + tired.avg + ', fresher ' + fresh.avg + ' bits per word (' + freshUnknown + ' unknown in the fresher line)');
assert.ok(tired.avg !== null && fresh.avg !== null, 'preview averages exist');
assert.ok(tired.avg + 1 < fresh.avg, 'the tired preview line must score clearly below the fresher one');
assert.ok(freshUnknown <= 2, 'too many unknown words in the fresher preview line');

// Rounding: the build measured how far rounding can move any probability
// from the same pruned model unrounded; tests/exact.test.js checks that bound
// on a pruned fixture against an independent exact implementation.
var q = model.header.quant;
assert.ok(q && q.bound <= 0.25, 'rounding bound ' + (q && q.bound));
assert.strictEqual(q.contexts_dropped_off_grid, 0);
console.log('  rounding moves any probability by at most ' + q.bound.toFixed(3) + ' bits');

// Lines the books contain. The build scored each with the shipped model and
// with exact Kneser-Ney trained without it. The page shows these figures when
// the visitor writes one of the lines, and words its verdict with
// Bromide.memoryVerdict: "remembers" only when the line scores under half an
// ordinary sentence's bits per word with most of its runs of three kept.
// Check every probe, that the stored figure is what the page's scorer gives,
// and that no verdict contradicts the score shown beside it.
var held = model.header.heldout.bits_per_word;
var mem = model.header.memory;
assert.ok(mem && mem.length >= 2);
mem.forEach(function (m) {
  var a = model.score(m.text).avgBits;
  assert.ok(Math.abs(a - m.bits) < 1e-6, 'stored memory figure matches the page scorer');
  assert.ok(m.times_in_books >= 1, 'the line was found in the books: ' + m.text);
  var v = H.Bromide.memoryVerdict(m, held);
  console.log('  memory: in the books ' + m.times_in_books + 'x; ' + m.bits.toFixed(2) + ' bits per word, ' +
    m.unread_bits.toFixed(2) + ' had it never been read, ' + m.unpruned_bits.toFixed(2) + ' with nothing pruned; ' +
    m.trigrams_kept + '/' + m.trigrams + ' runs kept -> ' + v.kind + '  ' + m.text.slice(0, 30) + '...');
  if (v.recites) assert.ok(m.bits < held / 2, 'a line said to be remembered must score well below ordinary text');
  else assert.ok(m.bits > 3, 'a line scoring under 3 bits per word is memorised, but the page would not say so: ' + m.text);
  // README.md says none of the shipped probes is recited; Ishmael scores above an ordinary sentence.
  assert.ok(!v.recites, 'README says this line is not recited: ' + m.text);
});
var ishmael = mem.filter(function (m) { return /ishmael/i.test(m.text); })[0];
if (ishmael) assert.ok(H.Bromide.memoryVerdict(ishmael, held).aboveOrdinary, 'Ishmael is more surprising than ordinary text');

// Synthetic probes: the rule says "remembers" for a line the model nearly recites, not for one it merely helped.
var V = H.Bromide.memoryVerdict;
assert.strictEqual(V({ bits: 1.2, unread_bits: 9, trigrams: 10, trigrams_kept: 10 }, 8).kind, 'recites');
assert.strictEqual(V({ bits: 10.1, unread_bits: 12, trigrams: 4, trigrams_kept: 2 }, 8).kind, 'helped');
assert.strictEqual(V({ bits: 3.5, unread_bits: 9, trigrams: 10, trigrams_kept: 3 }, 8).kind, 'helped');
assert.strictEqual(V({ bits: 6.0, unread_bits: 6.1, trigrams: 10, trigrams_kept: 9 }, 8).kind, 'unchanged');

// Matching the visitor's text to a probe: whole line (final punctuation
// ignored) or a text that only opens with it.
function toks(t) { return [].concat.apply([], H.Bromide.sentences(t)); }
var probes = [{ text: 'Call me Ishmael.', times_in_books: 1 }];
var M = H.Bromide.matchLine;
assert.ok(M(toks('Call me Ishmael.'), probes).whole);
assert.ok(M(toks('call me ishmael'), probes).whole);
assert.ok(M(toks('Call me Ishmael!'), probes).whole);
assert.strictEqual(M(toks('Call me Ishmael, said the man who sold me a kettle.'), probes).whole, false);
assert.strictEqual(M(toks('Call me'), probes), null);
assert.strictEqual(M(toks('Call me Ishmaels.'), probes), null);
assert.strictEqual(M(toks('Call me Ishmael.'), [{ text: 'Call me Ishmael.', times_in_books: 0 }]), null);
mem.forEach(function (m) { assert.ok(M(toks(m.text), mem).whole, 'each shipped probe matches itself'); });
console.log('shipped: ok (' + size + ' bytes, ' + books.length + ' books)');
