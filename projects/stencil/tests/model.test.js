// Unit checks of the metric definitions on small hand-made cases.
'use strict';
var assert = require('assert');
var M = require('../model.js');

function arr(a) { return Uint8Array.from(a); }

// 10 pixels, 2 of them nucleus.
var truth = arr([0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
var nothing = M.empty(10);
var s = M.scores(M.confusion(nothing, truth));
assert.strictEqual(s.accuracy, 0.8, 'predict nothing: accuracy is the background share');
assert.strictEqual(s.dice, 0, 'predict nothing: Dice is zero');
assert.strictEqual(s.iou, 0, 'predict nothing: IoU is zero');

var perfect = M.scores(M.confusion(truth, truth));
assert.deepStrictEqual([perfect.accuracy, perfect.iou, perfect.dice], [1, 1, 1]);

// One TP, one FN, one FP: Dice = 2/(2+1+1) = 0.5, IoU = 1/3, accuracy = 8/10.
var pred = arr([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
var c = M.confusion(pred, truth);
assert.deepStrictEqual(c, { tp: 1, fp: 1, fn: 1, tn: 7 });
s = M.scores(c);
assert.strictEqual(s.dice, 0.5);
assert.ok(Math.abs(s.iou - 1 / 3) < 1e-15);
assert.strictEqual(s.accuracy, 0.8);
// IoU and Dice are tied: IoU = D / (2 - D).
assert.ok(Math.abs(s.iou - s.dice / (2 - s.dice)) < 1e-15);

// Both empty: 1 by convention.
s = M.scores(M.confusion(M.empty(4), M.empty(4)));
assert.strictEqual(s.dice, 1);

// Thresholding rule: byte >= t * 255.
var prob = arr([0, 127, 128, 255]);
assert.deepStrictEqual(Array.from(M.threshold(prob, 0.5)), [0, 0, 1, 1]);
assert.deepStrictEqual(Array.from(M.threshold(prob, 0.01)), [0, 1, 1, 1]);

// Blob counting: 4-connectivity, minimum area.
var w = 6, h = 4;
var mask = arr([
  1, 1, 0, 0, 0, 1,
  1, 1, 0, 0, 0, 0,
  0, 0, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 1
]);
assert.strictEqual(M.countBlobs(mask, w, h, 1), 3, 'diagonal contact does not join blobs');
assert.strictEqual(M.countBlobs(mask, w, h, 4), 2);
assert.strictEqual(M.countBlobs(mask, w, h, 5), 1);

// Otsu on a clean two-level image separates the levels.
var two = new Uint8Array(100);
for (var i = 0; i < 100; i++) two[i] = i < 70 ? 20 : 200;
var t = M.otsuThreshold(two);
assert.ok(t >= 20 && t < 200, 'otsu threshold between the two levels');
assert.strictEqual(Array.from(M.otsuMask(two)).reduce(function (a, b) { return a + b; }, 0), 30);

// Error map codes.
assert.deepStrictEqual(Array.from(M.errorMap(arr([1, 1, 0, 0]), arr([1, 0, 1, 0]))), [1, 2, 3, 0]);

// sweep() equals threshold() + confusion() at every slider value, on random data.
var n = 5000, rp = new Uint8Array(n), rt = new Uint8Array(n), seed = 7;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
for (i = 0; i < n; i++) { rt[i] = rnd() < 0.2 ? 1 : 0; rp[i] = Math.floor(rnd() * 256); }
var ts = M.sliderThresholds();
assert.strictEqual(ts.length, 99);
assert.strictEqual(ts[49], 0.5);
M.sweep(rp, rt, ts).forEach(function (p, j) {
  var d = M.scores(M.confusion(M.threshold(rp, ts[j]), rt));
  assert.strictEqual(p.dice, d.dice);
  assert.strictEqual(p.accuracy, d.accuracy);
  assert.strictEqual(p.iou, d.iou);
});

console.log('model.test.js: ok');
