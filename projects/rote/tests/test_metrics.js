// HIDDEN CHECK: the metric code reproduces padding inflation on a toy example (JS and Python twins agree).
const assert = require('assert');
const R = require('../model.js');
const py = require('./py.js');

// one token of each kind: a wrong unit, a correct reading, a reading left unread, a plain word
const toy = [
  ['nine hundred euros', 'nine hundred pounds'],
  ['three thousand five hundred kilograms', 'three thousand five hundred kilograms'],
  ['£900', 'nine hundred pounds'],
  ['river', 'river'],
];
const exact = R.accuracy(toy, { padding: false });
const padded = R.accuracy(toy, { padding: true });
assert.strictEqual(exact, 0.5, 'exact match: 2 of 4');
// slots: euros 19/20, kg 20/20, £900 17/20 (one word against three, right-aligned), river 20/20 -> 76/80
assert.strictEqual(R.slotScores(toy[0][0], toy[0][1], 20, true).correct, 19);
assert.strictEqual(R.slotScores(toy[2][0], toy[2][1], 20, true).correct, 17);
assert.strictEqual(padded, 76 / 80, 'padded per-slot accuracy');
assert.ok(padded > 0.9 && exact <= 0.5, 'padding inflates a coin flip into 95%');
// with padding not counted, the same slot metric falls to the real slots only
const noPad = toy.reduce((a, p) => { const s = R.slotScores(p[0], p[1], 20, false); return [a[0] + s.correct, a[1] + s.total]; }, [0, 0]);
assert.deepStrictEqual(noPad, [8, 12]);
// keras pad_sequences pads at the front: "b" against "a b" agrees on the last slot
assert.strictEqual(R.slotScores('b', 'a b', 20, true).correct, 19);
assert.strictEqual(R.slotScores('b', 'a b', 20, false).correct, 1);
// long readings keep their last 20 words (truncating='pre')
const long = Array.from({ length: 25 }, (_, i) => 'w' + i).join(' ');
assert.strictEqual(R.slotScores(long, long, 20, true).total, 20);
// case and spacing do not matter to exact match
assert.ok(R.exactMatch(' Nine  hundred ', 'nine hundred'));

const p = py([
  'import metrics',
  'out = {',
  "  'exact': metrics.accuracy(data, padding=False),",
  "  'padded': metrics.accuracy(data, padding=True),",
  "  'slots': [list(metrics.slot_scores(a, b, 20, True)) for a, b in data] + [list(metrics.slot_scores('b', 'a b', 20, True))],",
  '}',
  'print(json.dumps(out))'].join('\n'), toy);
assert.strictEqual(p.exact, exact);
assert.strictEqual(p.padded, padded);
assert.deepStrictEqual(p.slots, toy.map(t => { const s = R.slotScores(t[0], t[1], 20, true); return [s.correct, s.total]; }).concat([[19, 20]]));

// error typing agrees too (input and, optionally, the reference class)
const errCases = [
  ['nine hundred euros', 'nine hundred pounds', '£900', 'MONEY'],
  ['hundred hundred five meters', 'three thousand five hundred kilograms', '3,500 kg', 'MEASURE'],
  ['december twentieth two thousand eight', 'may twentieth two thousand eight', 'May 20, 2008', 'DATE'],
  ['£900', 'nine hundred pounds', '£900', 'MONEY'],
  ['twenty six', 'twenty seven', '27', 'CARDINAL'],
  ['u s a', 'u s', 'U.S.', 'LETTERS'],
  ['nine hundred pounds', 'nine hundred pounds', '£900', 'MONEY'],
  // cases the first error typer got wrong: a mangled web address is a spelling error, not a "wrong unit" ("c" is no unit)
  ['a m e r i c a n t h e a t r e w i n g dot c o m', 'a m e r i c a n t h e a t r e w i n g dot o r g', 'americantheatrewing.org', 'ELECTRONIC'],
  ['a m e r i c a n t h e a t r e w i n g dot c o m', 'a m e r i c a n t h e a t r e w i n g dot o r g', 'americantheatrewing.org', null],
  // "second" is an ordinal here, not a unit
  ['two', 'the second', 'II', 'ORDINAL'],
  // a repeated two-word phrase is a stutter
  ['two hours eleven minutes eleven minutes and twenty five seconds', 'two hours eleven minutes and twenty five seconds', '2:11:25', 'TIME'],
  // reading digits one by one is a number error, not a stutter
  ['one nine nine five', 'nineteen ninety five', '1995', 'DATE'],
  ['one one five', 'one hundred fifteen', '115', 'CARDINAL'],
  // a date read as digits loses its month
  ['one nine nine five sil seven sil three o', 'the thirtieth of july nineteen ninety five', '1995-7-30', 'DATE'],
  // same letters, different word breaks
  ['twenty five kilovolts', 'twenty five kilo volts', '25 kV', 'MEASURE'],
  // a missing unit
  ['two hundred twenty five thousand', 'two hundred twenty five thousand yen', '¥225,000', 'MONEY'],
  // "c" after a number is not counted as a unit word
  ['three c', 'three c c', '3cc', 'MEASURE'],
];
const jsTypes = errCases.map(c => R.errorType(c[0], c[1], c[2], c[3] || undefined));
assert.deepStrictEqual(jsTypes, ['unit', 'repeat', 'month', 'unread', 'number', 'spelling', null,
  'spelling', 'spelling', 'number', 'repeat', 'number', 'number', 'month', 'other', 'unit', 'other']);
const pyTypes = py('import metrics\nprint(json.dumps([metrics.error_type(a, b, c, d) for a, b, c, d in data]))', errCases);
assert.deepStrictEqual(pyTypes, jsTypes);
console.log('test_metrics: ok (exact %s, padded %s)', exact, padded);
