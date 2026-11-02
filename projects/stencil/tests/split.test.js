// HIDDEN CHECK: the shipped fields come from the test split, which shares no image with
// training or validation. Compared by SHA-256 of the original files, recorded by train.py.
// If STENCIL_RAW points at the BBBC039 folder, the hashes are recomputed from the files.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var H = require('./helpers.js');

var split = H.readJSON('train/split.json').splits;
var man = H.manifest();

function hashes(part, key) { return new Set(split[part].map(function (x) { return x[key]; })); }
var train = hashes('train', 'image_sha256'), val = hashes('val', 'image_sha256'), test = hashes('test', 'image_sha256');
assert.strictEqual(train.size + val.size + test.size, 200, 'all 200 BBBC039 images split, no duplicate content');
[[train, val], [train, test], [val, test]].forEach(function (p) {
  p[0].forEach(function (h) { assert.ok(!p[1].has(h), 'an image appears in two splits'); });
});
var trainMasks = hashes('train', 'mask_sha256'), valMasks = hashes('val', 'mask_sha256');

man.images.forEach(function (m) {
  assert.ok(test.has(m.source_sha256), m.id + ' is a test image');
  assert.ok(!train.has(m.source_sha256) && !val.has(m.source_sha256), m.id + ' never seen in training or validation');
  assert.ok(!trainMasks.has(m.mask_sha256) && !valMasks.has(m.mask_sha256), m.id + ' mask not used in training');
  var rec = split.test.filter(function (x) { return x.image_sha256 === m.source_sha256; })[0];
  assert.strictEqual(rec.name + '.tif', m.source, m.id + ' name matches its hash record');
});

var raw = process.env.STENCIL_RAW;
if (raw && fs.existsSync(path.join(raw, 'images'))) {
  var checked = 0;
  ['train', 'val', 'test'].forEach(function (part) {
    split[part].forEach(function (x) {
      var h = crypto.createHash('sha256').update(fs.readFileSync(path.join(raw, 'images', x.name + '.tif'))).digest('hex');
      assert.strictEqual(h, x.image_sha256, x.name + ' hash');
      var hm = crypto.createHash('sha256').update(fs.readFileSync(path.join(raw, 'masks', x.name + '.png'))).digest('hex');
      assert.strictEqual(hm, x.mask_sha256, x.name + ' mask hash');
      checked++;
    });
  });
  console.log('split.test.js: recomputed ' + checked + ' image and mask hashes from ' + raw);
}
console.log('split.test.js: ok');
