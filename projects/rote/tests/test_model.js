// The browser tokeniser and a few behaviours the page relies on.
const assert = require('assert');
const R = require('../model.js');
const text = 'The crate weighed 3,500 kg and cost £900 on May 20, 2008, at 10:30 a.m. (see www.example.com) for the U.S. and NASA.';
const toks = R.tokenize(text).map(t => t.text);
['3,500 kg', '£900', 'May 20, 2008', '10:30 a.m.', 'www.example.com', 'U.S.', 'NASA'].forEach(t =>
  assert.ok(toks.includes(t), 'tokenised ' + t + ' in ' + JSON.stringify(toks)));
assert.deepStrictEqual(R.tokenize('15 February 1987, 2.5 million and 1/2').map(t => t.text),
  ['15 February 1987', ',', '2.5 million', 'and', '1/2']);
assert.strictEqual(R.tokenize('').length, 0);
// a hyphen after a letter or digit is not a minus sign (verification found "10-20" read "ten minus twenty")
const read = s => { const t = R.tokenize(s).map(x => x.text); return R.runRules(t).map(r => r.out).join(' | '); };
assert.strictEqual(read('pages 10-20'), 'pages | ten | to | twenty');
assert.strictEqual(read('from 1990-1995'), 'from | nineteen ninety | to | nineteen ninety five');
assert.ok(!/minus/.test(read('COVID-19')), read('COVID-19'));
assert.ok(!/minus/.test(read('Boeing 747-400')), read('Boeing 747-400'));
assert.deepStrictEqual(R.tokenize('call 555-1234').map(t => t.text), ['call', '555-1234']);
assert.strictEqual(R.runRules(['555-1234'])[0].cls, 'TELEPHONE');
assert.strictEqual(read('10-20 km'), 'ten | to | twenty kilometers');
// a real minus sign still reads as one
assert.strictEqual(read('-7 at dawn'), 'minus seven | at | dawn');
assert.strictEqual(read('fell to -5'), 'fell | to | minus five');
assert.strictEqual(read('(−3)'), '( | minus three | )');
// emoji stay whole
assert.deepStrictEqual(R.tokenize('a \u{1F600} b').map(t => t.text), ['a', '\u{1F600}', 'b']);
// decades are not seconds
assert.strictEqual(read('the 90s'), 'the | nineties');
assert.strictEqual(read("the 80's"), 'the | eighties');
assert.strictEqual(read("'70s"), "' | seventies");
assert.strictEqual(read('ran 50 s'), 'ran | fifty seconds');
// "in" after a space is the word, not inches
assert.strictEqual(read('20 in the box'), 'twenty | in | the | box');
assert.strictEqual(read('a 12in pipe'), 'a | twelve inches | pipe');
assert.strictEqual(read('3,500 kg'), 'three thousand five hundred kilograms');
// lookup falls back to copying
assert.deepStrictEqual(R.runLookup(['US', 'river'], { US: 'u s' }), ['u s', 'river']);
assert.deepStrictEqual(R.runLookup(['constructor'], {}), ['constructor']);
// rules never throw on odd input
['', ' ', '\u0000', '\u{1F600}', 'x'.repeat(500), '9'.repeat(40), '$', '%', '1/0', '00:00:00', '-', '−',
  'constructor', '__proto__', 'hasOwnProperty'].forEach(s => {
  const r = R.normalize(s, {});
  assert.strictEqual(typeof r.out, 'string', JSON.stringify(s));
});
// the preview's right readings
assert.strictEqual(R.normalize('£900', {}).out, 'nine hundred pounds');
assert.strictEqual(R.normalize('3,500 kg', {}).out, 'three thousand five hundred kilograms');
assert.strictEqual(R.normalize('May 20, 2008', {}).out, 'may twentieth two thousand eight');
console.log('test_model: ok');
