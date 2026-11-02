// Plat page and documentation checks: the words on the page agree with the data and with
// each other, the licence attributions are complete, and the most important caveats sit
// beside the map. Run: node tests/test_page.js
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');

var ROOT = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var html = read('index.html');
var app = read('app.js');
var data = JSON.parse(read('data/plat.json'));

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}
function text(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

var lede = text((html.match(/<p class="kit-lede">([\s\S]*?)<\/p>/) || [])[1] || '');
var credit = text((html.match(/<p class="kit-credit">([\s\S]*?)<\/p>/) || [])[1] || '');
var meta = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
var years = data.meta.years;
var ONES = ['', '-one', '-two', '-three', '-four', '-five', '-six', '-seven', '-eight', '-nine'];
var NUM = {};
for (var i = 0; i < 10; i++) { NUM[20 + i] = 'twenty' + ONES[i]; NUM[30 + i] = 'thirty' + ONES[i]; }

test('the lede is one short paragraph (at most about 90 words)', function () {
  var words = lede.split(' ').length;
  assert.ok(words <= 95, words + ' words');
});

test('the meta description and the lede count the rolls the same way, and match the data', function () {
  var n = NUM[years.length];
  assert.ok(n, 'no word for ' + years.length);
  var span = years[0] + '–' + years[years.length - 1];
  [['meta', meta], ['lede', lede]].forEach(function (p) {
    var t = p[1].toLowerCase();
    assert.ok(t.indexOf(n + ' assessment rolls') >= 0, p[0] + ' does not say "' + n + ' assessment rolls"');
    assert.ok(p[1].indexOf(span) >= 0, p[0] + ' does not give ' + span);
    assert.ok(!/\btwenty years\b/.test(t), p[0] + ' says "twenty years"');
  });
});

test('the paragraph and credit line carry both licence attributions, Statistics Canada in its required form', function () {
  var attribution = lede + ' ' + credit;
  assert.ok(attribution.indexOf('Contains information licensed under the Open Government Licence – Vancouver') >= 0);
  // Statistics Canada Open Licence: "Adapted from Statistics Canada, name of product,
  // reference date. This does not constitute an endorsement by Statistics Canada of this product."
  var cpiYears = Object.keys(data.meta.cpi.values).map(Number).filter(function (y) {
    return y >= years[0] - data.meta.valuation_lag && y <= years[years.length - 1] - data.meta.valuation_lag;
  });
  var ref = Math.min.apply(null, cpiYears) + '–' + Math.max.apply(null, cpiYears);
  assert.ok(attribution.indexOf('Adapted from Statistics Canada, Table 18-10-0005-01 (' + ref + ')') >= 0, 'reference date ' + ref + ' missing');
  assert.ok(/does not constitute an endorsement by Statistics Canada of this product/.test(attribution));
});

test('the two main caveats sit beside the map, before the controls and the ledger', function () {
  var stage = html.slice(html.indexOf('data-kit-stage'));
  var cav = stage.indexOf('class="pl-caveat"');
  assert.ok(cav > 0, 'no caveat line in the stage');
  assert.ok(cav < stage.indexOf('class="pl-book"'), 'caveat comes after the controls');
  var line = text(stage.slice(cav, stage.indexOf('</p>', cav)));
  assert.ok(/not sale prices/.test(line), line);
  assert.ok(/not why/.test(line), line);
  assert.ok(/Strata/.test(line), line);
  assert.ok(/href="#pl-notes-h"/.test(stage.slice(cav, stage.indexOf('</p>', cav))) && /id="pl-notes-h"/.test(html));
});

test('the page describes the CPI the way the model applies it (annual average of the valuation year)', function () {
  var hint = (app.match(/t = 'Real:[^;]*;/) || [''])[0];
  assert.ok(/average consumer price index for the year it was valued/.test(hint), hint);
});

test('the card never stacks the two medians into one bar', function () {
  var pv = app.slice(app.indexOf('function initPreview'));
  assert.ok(pv.indexOf('pairBars') > 0, 'card does not use pairBars');
  assert.ok(!/c\[0\]\s*\+\s*c\[1\]/.test(pv), 'card adds land and building medians');
});

test('every file the pipeline docstrings point to exists', function () {
  ['pipeline/fetch.py', 'pipeline/build.py'].forEach(function (f) {
    var src = read(f);
    var doc = src.slice(src.indexOf('"""') + 3, src.indexOf('"""', src.indexOf('"""') + 3));
    (doc.match(/[\w./-]+\.(?:py|json|yml|md|txt)\b/g) || []).forEach(function (name) {
      if (/^OUT_DIR\//.test(name)) name = 'data/' + name.slice(8);
      var candidates = [path.join(ROOT, 'pipeline', name), path.join(ROOT, name), path.join(ROOT, '..', '..', name)];
      assert.ok(candidates.some(function (p) { return fs.existsSync(p); }), f + ' mentions ' + name + ', which does not exist');
    });
  });
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some failed' : ''));
