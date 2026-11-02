// The page's prose must say what the shipped data shows. An earlier version claimed that
// Dice and IoU "swing" across the threshold slider while pixel accuracy holds; on these
// fields both move only a little and peak close together. These checks recompute the facts
// the lede, meta description and hints rely on, from the shipped PNGs, with model.js.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../model.js');
var png = require('./png.js');
var H = require('./helpers.js');

var man = H.manifest();
var ts = M.sliderThresholds();
var html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
var app = fs.readFileSync(path.join(H.ROOT, 'app.js'), 'utf8');

var maxDiceRange = 0, maxPeakGap = 0, maxDiceLost = 0, nothingAcc = [];
man.images.forEach(function (meta) {
  var d = function (k) { return png.decode(path.join(H.ROOT, 'data', meta.files[k])).data; };
  var truth = M.binarise(d('truth')), prob = d('prob');
  var sw = M.sweep(prob, truth, ts);
  var dice = sw.map(function (p) { return p.dice; });
  maxDiceRange = Math.max(maxDiceRange, Math.max.apply(null, dice) - Math.min.apply(null, dice));
  var best = M.bestThresholds(sw);
  maxPeakGap = Math.max(maxPeakGap, Math.abs(best.dice - best.accuracy));
  // bestThresholds really is the first maximum.
  var bd = 0;
  sw.forEach(function (p, j) { if (p.dice > sw[bd].dice) bd = j; });
  assert.strictEqual(best.dice, sw[bd].t, meta.id + ' best Dice threshold');
  // Dice given up by choosing the cut with pixel accuracy instead.
  maxDiceLost = Math.max(maxDiceLost, sw[bd].dice - sw[M.sweepIndex(best.accuracy)].dice);
  nothingAcc.push(M.scores(M.confusion(M.empty(truth.length), truth)).accuracy);
});

// 1. No "swing" claim unless Dice really moves a lot across the slider.
if (maxDiceRange < 0.3) {
  assert.ok(!/swing/i.test(html), 'index.html claims a swing; Dice moves at most ' + maxDiceRange.toFixed(3) + ' across the slider');
  assert.ok(!/swing/i.test(app), 'app.js hints claim a swing; Dice moves at most ' + maxDiceRange.toFixed(3));
}

// 2. "agree on the best cut": choosing the threshold by pixel accuracy costs almost no Dice.
var lede = html.match(/<p class="kit-lede">([\s\S]*?)<\/p>/)[1];
if (/agree on the best cut/.test(lede)) assert.ok(maxDiceLost <= 0.005, 'choosing by accuracy loses up to ' + maxDiceLost.toFixed(4) + ' Dice');

// 3. The predict-nothing range quoted in the lede and the meta description is the real one.
var lo = Math.min.apply(null, nothingAcc).toFixed(2), hi = Math.max.apply(null, nothingAcc).toFixed(2);
var m = lede.match(/(\d\.\d\d)–(\d\.\d\d)/);
assert.ok(m, 'lede quotes the predict-nothing pixel accuracy range');
assert.deepStrictEqual([m[1], m[2]], [lo, hi], 'lede range vs computed ' + lo + '–' + hi);
var desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
var md = desc.match(/(\d\.\d\d) to (\d\.\d\d)/);
assert.ok(md && md[1] === lo && md[2] === hi, 'meta description range vs computed ' + lo + '–' + hi);

// 4. The card's still frame (paused, and all a reduced-motion visitor sees) shows the
//    predict-nothing contrast, with both rows of the readout in the markup.
assert.ok(/function still\(\) \{\s*state\.source = 'nothing'/.test(app), 'preview still frame predicts nothing');
['pr-unet', 'pr-none'].forEach(function (id) { assert.ok(html.indexOf('id="' + id + '"') >= 0, id + ' row present'); });

// 5. The slider path does no per-pixel work on the fields not on view.
var table = app.slice(app.indexOf('function updateTable'), app.indexOf('function fillCounts'));
assert.ok(table.length > 0 && !/countBlobs|M\.threshold\(|confusion\(|evaluate\(/.test(table), 'updateTable reads cached scores only');

console.log('claims.test.js: ok (Dice moves at most ' + maxDiceRange.toFixed(3) + ' across the slider; choosing the cut by pixel accuracy loses at most ' +
  maxDiceLost.toFixed(4) + ' Dice, peaks up to ' + maxPeakGap.toFixed(2) + ' apart; predicting nothing ' + lo + '–' + hi + ')');
