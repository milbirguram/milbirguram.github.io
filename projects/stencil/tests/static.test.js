// HIDDEN CHECK: the numbers on the page are computed, not stored. The manifest holds
// provenance only; the page never loads the Python reference or results; the readouts in
// the HTML start empty. Also: no external requests, lede length, size budgets.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var H = require('./helpers.js');

var man = H.manifest();
var banned = /dice|iou|accuracy|jaccard|score/i;
JSON.stringify(man, function (k, v) { assert.ok(!banned.test(k), 'manifest key "' + k + '" looks like a stored metric'); return v; });

var html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
var app = fs.readFileSync(path.join(H.ROOT, 'app.js'), 'utf8');
['python_reference', 'results.json', 'split.json', 'tests/'].forEach(function (s) {
  assert.ok(app.indexOf(s) < 0, 'app.js does not read ' + s);
  assert.ok(html.indexOf(s) < 0, 'index.html does not load ' + s);
});
['v-acc', 'v-iou', 'v-dice', 'pr-acc', 'pr-dice', 'pr-acc0', 'pr-dice0'].forEach(function (id) {
  var m = html.match(new RegExp('id="' + id + '">([^<]*)<'));
  assert.ok(m && !/\d/.test(m[1]), id + ' starts without a number');
});
assert.ok(!/https?:\/\//.test(fs.readFileSync(path.join(H.ROOT, 'style.css'), 'utf8')), 'style.css makes no external requests');
assert.ok(!/fetch\(\s*['"]https?:/.test(app), 'app.js fetches nothing external');
var lede = html.match(/<p class="kit-lede">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
var words = lede.trim().split(/\s+/).length;
assert.ok(words <= 95, 'lede is ' + words + ' words');
var code = ['index.html', 'style.css', 'app.js', 'model.js'].reduce(function (a, f) { return a + fs.statSync(path.join(H.ROOT, f)).size; }, 0);
assert.ok(code < 300 * 1024, 'code is ' + code + ' bytes');
var fonts = fs.readdirSync(path.join(H.ROOT, 'fonts')).filter(function (f) { return /\.woff2$/.test(f); })
  .reduce(function (a, f) { return a + fs.statSync(path.join(H.ROOT, 'fonts', f)).size; }, 0);
assert.ok(fonts <= 155 * 1024, 'fonts are ' + fonts + ' bytes');
assert.ok(fs.existsSync(path.join(H.ROOT, 'fonts', 'OFL.txt')), 'font licence beside the fonts');
console.log('static.test.js: ok (lede ' + words + ' words, code ' + code + ' bytes, fonts ' + fonts + ' bytes)');
