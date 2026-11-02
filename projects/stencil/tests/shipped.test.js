// HIDDEN CHECKS on the shipped images:
//  - JS metrics match Python's (train/export.py) on every shipped field, at every slider
//    threshold, to 1e-6 (the confusion counts must match exactly);
//  - predicting nothing gives Dice 0 and pixel accuracy = 1 - nucleus share, as stated;
//  - Otsu baseline and blob counts agree with Python.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../model.js');
var png = require('./png.js');
var H = require('./helpers.js');

var man = H.manifest();
var ref = H.readJSON('tests/python_reference.json');
var TOL = 1e-6;
var W = man.crop[1], Ht = man.crop[0];
assert.strictEqual(man.images.length, 8, 'eight shipped fields');
assert.deepStrictEqual(ref.thresholds, M.sliderThresholds(), 'same threshold doubles as Python');

function close(a, b, what) { assert.ok(Math.abs(a - b) <= TOL, what + ': JS ' + a + ' vs Python ' + b); }

var compared = 0, totalBytes = 0;
man.images.forEach(function (meta) {
  var r = ref.images.filter(function (x) { return x.id === meta.id; })[0];
  assert.ok(r, 'python reference for ' + meta.id);
  var files = {};
  Object.keys(meta.files).forEach(function (k) {
    var p = path.join(H.ROOT, 'data', meta.files[k]);
    totalBytes += fs.statSync(p).size;
    files[k] = png.decode(p);
    assert.strictEqual(files[k].width, W);
    assert.strictEqual(files[k].height, Ht);
    assert.strictEqual(files[k].colourType, 0, meta.files[k] + ' is 8-bit grayscale');
    ['gAMA', 'iCCP', 'sRGB', 'cHRM'].forEach(function (c) {
      assert.ok(files[k].chunks.indexOf(c) < 0, meta.files[k] + ' carries no colour-management chunk (' + c + ')');
    });
  });
  var truth = M.binarise(files.truth.data), prob = files.prob.data, raw = files.raw.data;

  r.unet.forEach(function (row) {
    var c = M.confusion(M.threshold(prob, row.t), truth);
    assert.deepStrictEqual([c.tp, c.fp, c.fn, c.tn], [row.tp, row.fp, row.fn, row.tn], meta.id + ' counts at t=' + row.t);
    var s = M.scores(c);
    close(s.accuracy, row.accuracy, meta.id + ' accuracy t=' + row.t);
    close(s.iou, row.iou, meta.id + ' IoU t=' + row.t);
    close(s.dice, row.dice, meta.id + ' Dice t=' + row.t);
    compared += 3;
  });
  // The chart's fast path agrees too.
  M.sweep(prob, truth, ref.thresholds).forEach(function (p, j) {
    close(p.dice, r.unet[j].dice, meta.id + ' sweep Dice');
    close(p.accuracy, r.unet[j].accuracy, meta.id + ' sweep accuracy');
  });

  ref.count_thresholds.forEach(function (t, j) {
    assert.strictEqual(M.countBlobs(M.threshold(prob, t), W, Ht, man.min_area_px), r.unet_counts[j], meta.id + ' blob count t=' + t);
  });
  assert.strictEqual(M.countBlobs(truth, W, Ht, man.min_area_px), r.truth_blobs, meta.id + ' truth blobs');

  // model.js's Otsu matches Python's on the crop; the page uses the whole field's cut,
  // recorded in the manifest, and its scores on the crop match Python's.
  assert.strictEqual(M.otsuThreshold(raw), r.otsu_threshold_crop, meta.id + ' Otsu threshold (crop)');
  assert.strictEqual(meta.otsu_cut_whole_field, r.otsu_cut_whole_field, meta.id + ' whole-field Otsu cut');
  var om = M.aboveCut(raw, meta.otsu_cut_whole_field);
  var so = M.scores(M.confusion(om, truth));
  close(so.accuracy, r.otsu.accuracy, meta.id + ' Otsu accuracy');
  close(so.dice, r.otsu.dice, meta.id + ' Otsu Dice');
  close(so.iou, r.otsu.iou, meta.id + ' Otsu IoU');
  assert.strictEqual(M.countBlobs(om, W, Ht, man.min_area_px), r.otsu_count, meta.id + ' Otsu blobs');

  // The table and the preview read U-Net scores from the sweep by slider index.
  var sw = M.sweep(prob, truth, ref.thresholds);
  ref.thresholds.forEach(function (t) {
    var row = sw[M.sweepIndex(t)];
    assert.strictEqual(row.t, t, 'sweepIndex(' + t + ')');
    var direct = M.scores(M.confusion(M.threshold(prob, t), truth));
    assert.strictEqual(row.dice, direct.dice, meta.id + ' sweep row = direct Dice at ' + t);
    assert.strictEqual(row.accuracy, direct.accuracy, meta.id + ' sweep row = direct accuracy at ' + t);
  });

  // Predict nothing.
  var sn = M.scores(M.confusion(M.empty(W * Ht), truth));
  var fg = 0;
  for (var i = 0; i < truth.length; i++) fg += truth[i];
  assert.strictEqual(sn.dice, 0, meta.id + ' predict nothing: Dice 0');
  assert.strictEqual(sn.iou, 0, meta.id + ' predict nothing: IoU 0');
  close(sn.accuracy, 1 - fg / truth.length, meta.id + ' predict nothing: accuracy = background share');
  close(sn.accuracy, r.nothing.accuracy, meta.id + ' predict nothing accuracy vs Python');
  close(fg / truth.length, r.foreground_share, meta.id + ' share vs Python');
  assert.ok(sn.accuracy > 0.6, meta.id + ' predicting nothing still scores well on pixel accuracy');
});

assert.ok(totalBytes > 0.3e6 && totalBytes < 2.2e6, 'shipped images total ' + totalBytes + ' bytes, about 1-2 MB');
console.log('shipped.test.js: ok (' + compared + ' metric values matched; images ' + (totalBytes / 1e6).toFixed(2) + ' MB)');
